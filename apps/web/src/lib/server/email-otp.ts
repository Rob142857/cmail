// Invitation-scoped email one-time-code (OTP) sign-in: code generation,
// hashing, issuance/verification against auth_otp_codes, and the signed
// proof cookie that binds one browser's request to its verify attempt.
// Mirrors bootstrap.ts's HMAC/base64url proof-cookie mechanics.
//
// This module deliberately does not decide WHETHER a code should be issued
// (invite-only gating, rate limits, Turnstile, geo) — that policy lives in
// the request/verify actions in routes/auth/email/+page.server.ts, which is
// also where every event is audited. This module only owns safe storage and
// constant-time verification of the code itself.

import { escapeHtml } from './validation';

const ENCODER = new TextEncoder();

const OTP_CODE_DIGITS = 8;
const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;

export const OTP_PROOF_COOKIE = 'cmail_otp_proof';
export const OTP_PROOF_TTL_SECONDS = 10 * 60;

export type OtpPurpose = 'enroll' | 'signin';
export type OtpVerifyResult = 'ok' | 'expired' | 'mismatch' | 'locked' | 'unknown';

export interface OtpProofPayload {
  v: 1;
  purpose: OtpPurpose;
  address: string;
  requestId: string;
  exp: number;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(payload: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, ENCODER.encode(payload)));
}

/**
 * Eight random decimal digits from crypto.getRandomValues, using rejection
 * sampling per digit so every digit 0-9 is uniformly distributed (a plain
 * `byte % 10` would bias 0-5 slightly, since 256 is not a multiple of 10).
 */
export function generateOtpCode(): string {
  const byte = new Uint8Array(1);
  let code = '';
  for (let position = 0; position < OTP_CODE_DIGITS; position += 1) {
    let value: number;
    do {
      crypto.getRandomValues(byte);
      value = byte[0];
    } while (value >= 250); // 250 = 25 * 10: reject the biased tail (250-255)
    code += (value % 10).toString();
  }
  return code;
}

/** HMAC-SHA-256, hex-encoded (64 chars), matching auth_otp_codes.code_hash's CHECK. */
export async function hashOtpCode(purpose: OtpPurpose, address: string, code: string, sessionSecret: string): Promise<string> {
  const payload = `cmail-otp-v1\0${purpose}\0${address}\0${code}`;
  const digest = await hmac(payload, sessionSecret);
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time comparison of two hex hash strings. Both operands here are
 * always exactly 64 characters (our own HMAC-SHA-256 hex output), so — unlike
 * bootstrap.ts's secretsEqual, which first hashes variable-length secrets to
 * normalise their length — a direct same-length XOR loop is already safe.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

/**
 * Issues a fresh code for (address, purpose), deleting any previous active
 * code for that same pair first — only one code is ever live at a time.
 * Returns the raw code (to email) and the opaque request id (to bind into
 * the proof cookie); neither is ever persisted in plaintext except via the
 * HMAC hash stored in the row.
 */
export async function issueOtp(
  db: D1Database,
  options: { purpose: OtpPurpose; address: string; sessionSecret: string },
  nowEpoch = Math.floor(Date.now() / 1000),
): Promise<{ code: string; requestId: string }> {
  const address = options.address.trim().toLowerCase();
  const code = generateOtpCode();
  const requestId = crypto.randomUUID();
  const codeHash = await hashOtpCode(options.purpose, address, code, options.sessionSecret);
  const expiresEpoch = nowEpoch + OTP_TTL_SECONDS;

  await db.batch([
    db.prepare('DELETE FROM auth_otp_codes WHERE address = ? AND purpose = ?').bind(address, options.purpose),
    db.prepare(
      `INSERT INTO auth_otp_codes (id, purpose, address, code_hash, request_id, attempts, created_epoch, expires_epoch)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(crypto.randomUUID(), options.purpose, address, codeHash, requestId, nowEpoch, expiresEpoch),
  ]);

  return { code, requestId };
}

/**
 * Verifies a submitted code against the live row for (address, purpose,
 * requestId) — the requestId must match both the signed proof cookie and
 * the stored row, so a code can only ever be redeemed by the browser that
 * requested it. `attempts` is incremented in the same atomic UPDATE that
 * reads the row, so a burst of concurrent verify calls can never
 * collectively exceed OTP_MAX_ATTEMPTS real code comparisons — every call
 * that lands on attempt (OTP_MAX_ATTEMPTS + 1) or later is locked out
 * without even looking at the submitted code.
 */
export async function verifyOtp(
  db: D1Database,
  options: { purpose: OtpPurpose; address: string; code: string; requestId: string; sessionSecret: string },
  nowEpoch = Math.floor(Date.now() / 1000),
): Promise<OtpVerifyResult> {
  const address = options.address.trim().toLowerCase();

  const row = await db.prepare(
    `UPDATE auth_otp_codes
     SET attempts = attempts + 1
     WHERE address = ? AND purpose = ? AND request_id = ?
     RETURNING id, code_hash, attempts, expires_epoch`,
  ).bind(address, options.purpose, options.requestId)
    .first<{ id: string; code_hash: string; attempts: number; expires_epoch: number }>();

  if (!row) return 'unknown';

  if (row.attempts > OTP_MAX_ATTEMPTS) {
    await db.prepare('DELETE FROM auth_otp_codes WHERE id = ?').bind(row.id).run();
    return 'locked';
  }

  if (row.expires_epoch <= nowEpoch) return 'expired';

  const candidateHash = await hashOtpCode(options.purpose, address, options.code, options.sessionSecret);
  if (constantTimeEqualHex(candidateHash, row.code_hash)) {
    await db.prepare('DELETE FROM auth_otp_codes WHERE id = ?').bind(row.id).run();
    return 'ok';
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await db.prepare('DELETE FROM auth_otp_codes WHERE id = ?').bind(row.id).run();
    return 'locked';
  }

  return 'mismatch';
}

/**
 * Signed payload proving this browser is the one that made the OTP request,
 * mirroring bootstrap.ts's createBootstrapProof. httpOnly/secure/sameSite=lax
 * are set by the caller when writing the cookie.
 */
export async function createOtpProof(
  purpose: OtpPurpose,
  address: string,
  requestId: string,
  sessionSecret: string,
  nowEpoch = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: OtpProofPayload = {
    v: 1,
    purpose,
    address: address.trim().toLowerCase(),
    requestId,
    exp: nowEpoch + OTP_PROOF_TTL_SECONDS,
  };
  const encoded = base64Url(ENCODER.encode(JSON.stringify(payload)));
  return `${encoded}.${base64Url(await hmac(encoded, sessionSecret))}`;
}

export async function verifyOtpProof(
  proof: string | undefined,
  sessionSecret: string,
  nowEpoch = Math.floor(Date.now() / 1000),
): Promise<OtpProofPayload | null> {
  if (!proof || proof.length > 2048) return null;
  const [encoded, suppliedSignature, extra] = proof.split('.');
  if (!encoded || !suppliedSignature || extra) return null;
  const signature = decodeBase64Url(suppliedSignature);
  const payloadBytes = decodeBase64Url(encoded);
  if (!signature || signature.length !== 32 || !payloadBytes) return null;

  const expected = await hmac(encoded, sessionSecret);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ signature[index];
  if (difference !== 0) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<OtpProofPayload>;
    if (
      payload.v !== 1 ||
      (payload.purpose !== 'enroll' && payload.purpose !== 'signin') ||
      typeof payload.address !== 'string' || !payload.address || payload.address.length > 320 ||
      typeof payload.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.requestId) ||
      typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) ||
      payload.exp <= nowEpoch || payload.exp > nowEpoch + OTP_PROOF_TTL_SECONDS
    ) return null;
    return { v: 1, purpose: payload.purpose, address: payload.address, requestId: payload.requestId, exp: payload.exp };
  } catch {
    return null;
  }
}

/**
 * Minimal system email carrying the code itself — deliberately not styled
 * like the invitation email (invite-email.ts): no branding chrome, no
 * links, nothing for a recipient to click. Sent via the same outbound path
 * as invitations (see the request action's use of outbound.ts's sendEmail).
 */
export function generateOtpEmail(options: { code: string; orgName: string }): { subject: string; html: string; text: string } {
  const org = escapeHtml(options.orgName);
  const subject = 'Your sign-in code';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <title>${escapeHtml(subject)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; background: #f7f8fa; margin: 0; padding: 0; }
    .container { max-width: 480px; margin: 0 auto; padding: 32px 20px; }
    .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px; text-align: center; }
    p { margin: 12px 0; color: #374151; }
    .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 32px; font-weight: 700; letter-spacing: 0.12em; color: #111827; margin: 20px 0; }
    .muted { color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <p>Your ${org} sign-in code:</p>
      <div class="code">${escapeHtml(options.code)}</div>
      <p class="muted">This code expires in 5 minutes.</p>
      <p class="muted">If you didn't request this, ignore this email — no further action is needed.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `Your ${options.orgName} sign-in code:

${options.code}

This code expires in 5 minutes.
If you didn't request this, ignore this email — no further action is needed.`;

  return { subject, html, text };
}
