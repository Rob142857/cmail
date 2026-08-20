// Session management: JWT-like tokens whose signature is verified locally,
// backed by a D1 session row that is the sole authority on expiry (sliding
// TTL — see shouldRenewSession below). Uses Web Crypto for HMAC-SHA256
// signing (available in Workers).

const DEFAULT_SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
// The token carries no expiry of its own — the DB row does — but a token
// claiming to be impossibly old can never match a live, non-expired row
// anyway. This sanity bound just rejects that shape early, and doubles as the
// upper edge matching the cookie's own fixed 400-day Max-Age (Chrome's cap).
const MAX_TOKEN_AGE_MS = 400 * 24 * 60 * 60 * 1000;
// Sliding-renewal threshold: a session is pushed back out to a fresh TTL once
// its remaining lifetime drops within this margin, so continued use extends
// access by at most one DB write per session roughly every 6 hours.
const RENEWAL_THRESHOLD_MS = 6 * 60 * 60 * 1000;
// Exported so routes/auth/email's form actions — which must use SvelteKit's
// cookies.set() rather than a raw Set-Cookie header, since a form action
// can't return a Response the way the OAuth callback's +server.ts does —
// can issue an identical cookie without duplicating its name/lifetime here.
export const SESSION_COOKIE_MAX_AGE_SECONDS = MAX_TOKEN_AGE_MS / 1000; // 34,560,000
const ENCODER = new TextEncoder();
export const SESSION_COOKIE = 'cmail_session';

export async function createSessionToken(
  userId: string,
  secret: string,
  durationMs = DEFAULT_SESSION_DURATION_MS,
): Promise<{ token: string; hash: string; expiresAt: Date; sessionId: string }> {
  const sessionId = crypto.randomUUID();
  const issuedAt = Date.now();
  // durationMs seeds the DB row's expires_at (the real expiry authority) but
  // is intentionally not embedded in the token itself.
  const expiresAt = new Date(issuedAt + durationMs);
  const payload = `${sessionId}.${userId}.${issuedAt}`;

  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(payload));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  const token = `${payload}.${sigHex}`;

  // Hash for DB storage (don't store the raw token)
  const hashBuf = await crypto.subtle.digest('SHA-256', ENCODER.encode(token));
  const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  return { token, hash, expiresAt, sessionId };
}

/**
 * Verifies signature and shape only. Expiry is intentionally not this
 * function's job — the caller must still check the D1 session row's
 * expires_at, which is the only authority for whether a session is live.
 */
export async function verifySessionToken(token: string, secret: string): Promise<{ sessionId: string; userId: string; issuedAt: Date } | null> {
  if (!token || token.length > 1024 || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;

  const [sessionId, userId, issuedStr, sigHex] = parts;
  if (!sessionId || !userId || !/^\d{10,16}$/.test(issuedStr) || !/^[\da-f]{64}$/i.test(sigHex)) return null;
  const issuedAt = new Date(Number(issuedStr));
  if (isNaN(issuedAt.getTime()) || Date.now() - issuedAt.getTime() > MAX_TOKEN_AGE_MS) return null;

  const payload = `${sessionId}.${userId}.${issuedStr}`;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      ENCODER.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const pairs = sigHex.match(/.{2}/g);
    if (!pairs) return null;
    const sigBytes = new Uint8Array(pairs.map((hex) => Number.parseInt(hex, 16)));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, ENCODER.encode(payload));
    if (!valid) return null;
  } catch {
    return null;
  }

  return { sessionId, userId, issuedAt };
}

/**
 * Pure sliding-renewal decision, extracted so hooks.server.ts's per-request
 * check is unit-testable without a database. Renew once the remaining time
 * before expiresAtMs falls within RENEWAL_THRESHOLD_MS of a full fresh TTL.
 * Non-finite input (e.g. an unparsable expires_at) safely means "don't renew".
 */
export function shouldRenewSession(expiresAtMs: number, nowMs: number, ttlMs: number): boolean {
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(ttlMs)) return false;
  return (expiresAtMs - nowMs) < (ttlMs - RENEWAL_THRESHOLD_MS);
}

export async function hashToken(token: string): Promise<string> {
  const hashBuf = await crypto.subtle.digest('SHA-256', ENCODER.encode(token));
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Max-Age is always the fixed 400-day ceiling, regardless of the configured
 * session TTL: the D1 session row's expires_at is what actually governs
 * access, and sliding renewal (see shouldRenewSession) keeps it current while
 * a session is used. Sign-out still clears this cookie immediately.
 */
export function buildSessionCookie(token: string, secure = true): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`,
    'Priority=High',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(secure = true): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; ${secure ? 'Secure; ' : ''}Max-Age=0`;
}

export function getSessionTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=') || null;
  }
  return null;
}
