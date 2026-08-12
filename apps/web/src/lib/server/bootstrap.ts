import { assertStrongBootstrapToken, assertStrongSessionSecret } from './config';
import { normalizeEmail } from './validation';
import type { AuthProvider, User } from '@cmail/shared/types';

export const BOOTSTRAP_PROOF_COOKIE = 'cmail_bootstrap_proof';
export const BOOTSTRAP_PROOF_TTL_SECONDS = 10 * 60;

const ENCODER = new TextEncoder();

interface BootstrapPayload {
  version: 1;
  email: string;
  expiresAt: number;
  nonce: string;
}

export class BootstrapConflictError extends Error {
  constructor() {
    super('Bootstrap identity could not be provisioned');
    this.name = 'BootstrapConflictError';
  }
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

export function bootstrapConfiguration(env: Record<string, unknown>): { email: string; token: string; sessionSecret: string } | null {
  const email = normalizeEmail(env.BOOTSTRAP_ADMIN_EMAIL);
  try {
    assertStrongBootstrapToken(env.BOOTSTRAP_ADMIN_TOKEN);
    assertStrongSessionSecret(env.SESSION_SECRET);
    if (env.BOOTSTRAP_ADMIN_TOKEN === env.SESSION_SECRET) return null;
  } catch {
    return null;
  }
  return email
    ? { email, token: env.BOOTSTRAP_ADMIN_TOKEN, sessionSecret: env.SESSION_SECRET }
    : null;
}

export async function secretsEqual(candidate: string, expected: string): Promise<boolean> {
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', ENCODER.encode(candidate)),
    crypto.subtle.digest('SHA-256', ENCODER.encode(expected)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function createBootstrapProof(
  email: string,
  sessionSecret: string,
  nowEpoch = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: BootstrapPayload = {
    version: 1,
    email: normalizeEmail(email) || '',
    expiresAt: nowEpoch + BOOTSTRAP_PROOF_TTL_SECONDS,
    nonce: crypto.randomUUID(),
  };
  const encoded = base64Url(ENCODER.encode(JSON.stringify(payload)));
  return `${encoded}.${base64Url(await hmac(encoded, sessionSecret))}`;
}

export async function verifyBootstrapProof(
  proof: string | undefined,
  sessionSecret: string,
  nowEpoch = Math.floor(Date.now() / 1000),
): Promise<BootstrapPayload | null> {
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
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<BootstrapPayload>;
    const email = normalizeEmail(payload.email);
    if (
      payload.version !== 1 || !email || typeof payload.expiresAt !== 'number' ||
      !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= nowEpoch ||
      payload.expiresAt > nowEpoch + BOOTSTRAP_PROOF_TTL_SECONDS ||
      typeof payload.nonce !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.nonce)
    ) return null;
    return { version: 1, email, expiresAt: payload.expiresAt, nonce: payload.nonce };
  } catch {
    return null;
  }
}

/**
 * Provision and bind the first manager after the caller has verified the
 * signed bootstrap proof and its provider-asserted email. Email lookup is
 * intentionally confined to this one authorised bootstrap operation.
 */
export async function provisionBootstrapManager(
  db: D1Database,
  options: {
    email: string;
    displayName: string;
    provider: AuthProvider;
    subject: string;
    mailDomain: string;
  },
): Promise<User> {
  const email = normalizeEmail(options.email);
  if (!email) throw new BootstrapConflictError();

  const existing = await db.prepare(
    `SELECT u.*,
            CASE WHEN EXISTS (
              SELECT 1 FROM user_identities identity WHERE identity.user_id = u.id
            ) THEN 1 ELSE 0 END AS identity_bound
     FROM users u WHERE lower(u.email) = ? LIMIT 1`,
  ).bind(email).first<User & { identity_bound: number }>();
  if (existing?.identity_bound || existing?.status === 'paused' || existing?.status === 'offboarded') {
    throw new BootstrapConflictError();
  }

  const userId = existing?.id || crypto.randomUUID();
  const displayName = options.displayName.slice(0, 200);
  const statements: D1PreparedStatement[] = [];
  if (existing) {
    statements.push(db.prepare(
      `UPDATE users
       SET role = 'manager', status = 'active', auth_provider = ?,
           display_name = CASE WHEN display_name = '' THEN ? ELSE display_name END,
           updated_at = datetime('now')
       WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'manager')
         AND NOT EXISTS (SELECT 1 FROM user_identities WHERE user_id = ?)`,
    ).bind(options.provider, displayName, userId, userId));
  } else {
    statements.push(db.prepare(
      `INSERT INTO users
         (id, email, display_name, role, status, auth_provider, created_at, updated_at)
       SELECT ?, ?, ?, 'manager', 'active', ?, datetime('now'), datetime('now')
       WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'manager')
         AND NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = ?)`,
    ).bind(userId, email, displayName, options.provider, email));
  }

  statements.push(db.prepare(
    `INSERT INTO user_identities (provider, subject, user_id, created_at)
     SELECT ?, ?, ?, datetime('now') WHERE changes() = 1`,
  ).bind(options.provider, options.subject, userId));

  const assignedMailbox = existing
    ? await db.prepare(
      `SELECT m.id FROM mailboxes m
       WHERE m.owner_user_id = ? AND m.type = 'personal' LIMIT 1`,
    ).bind(userId).first<{ id: string }>()
    : null;
  if (options.mailDomain && !assignedMailbox) {
    const baseLocalPart = email.split('@')[0].replace(/[^a-z0-9._-]/g, '-').slice(0, 54) || 'admin';
    let mailboxAddress = `${baseLocalPart}@${options.mailDomain}`;
    const occupied = await db.prepare('SELECT id FROM mailboxes WHERE lower(address) = ? LIMIT 1')
      .bind(mailboxAddress).first<{ id: string }>();
    if (occupied) mailboxAddress = `${baseLocalPart}-${userId.slice(0, 8)}@${options.mailDomain}`;
    const mailboxId = crypto.randomUUID();
    statements.push(
      db.prepare(
        `INSERT INTO mailboxes (id, address, display_name, type, status, owner_user_id, created_at)
         SELECT ?, ?, ?, 'personal', 'active', ?, datetime('now') WHERE changes() = 1`,
      ).bind(mailboxId, mailboxAddress, displayName || email, userId),
      db.prepare(
        `INSERT INTO mailbox_assignments
           (mailbox_id, user_id, permissions, assigned_at, assigned_by)
         SELECT ?, ?, 'full', datetime('now'), ? WHERE changes() = 1`,
      ).bind(mailboxId, userId, userId),
    );
  }

  let results: D1Result[];
  try {
    results = await db.batch(statements);
  } catch {
    throw new BootstrapConflictError();
  }
  if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
    throw new BootstrapConflictError();
  }
  if (statements.length === 4 && (!results[2]?.meta.changes || !results[3]?.meta.changes)) {
    throw new BootstrapConflictError();
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User>();
  if (!user) throw new BootstrapConflictError();
  return user;
}
