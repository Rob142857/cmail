import type { AuthProvider, User, UserStatus } from '@cmail/shared/types';
import type { OAuthUserInfo } from './auth';
import { normalizeEmail } from './validation';

export const ENROLLMENT_COOKIE = 'cmail_enrollment';
export const ENROLLMENT_COOKIE_TTL_SECONDS = 15 * 60;
export const ENROLLMENT_TOKEN_TTL_SECONDS = 72 * 60 * 60;

const ENCODER = new TextEncoder();

export interface EnrollmentRecord {
  enrollment_id: string;
  user_id: string;
  email: string;
  role: User['role'];
  status: UserStatus;
  expires_at: number;
  consumed_at: string | null;
  bound_provider: AuthProvider | null;
}
export type EnrollmentFailure =
  | 'enrollment_required'
  | 'enrollment_expired'
  | 'enrollment_email_mismatch'
  | 'unverified_email'
  | 'account_suspended'
  | 'identity_conflict';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function validEnrollmentToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

export async function hashEnrollmentToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ENCODER.encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function issueEnrollmentToken(
  db: D1Database,
  userId: string,
  createdBy: string,
  nowEpoch = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresAt: number }> {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await hashEnrollmentToken(token);
  const expiresAt = nowEpoch + ENROLLMENT_TOKEN_TTL_SECONDS;
  await db.batch([
    db.prepare('DELETE FROM enrollment_tokens WHERE user_id = ?').bind(userId),
    db.prepare(
      `INSERT INTO enrollment_tokens
         (id, user_id, token_hash, expires_at, created_at, created_by)
       VALUES (?, ?, ?, ?, datetime('now'), ?)`,
    ).bind(crypto.randomUUID(), userId, tokenHash, expiresAt, createdBy),
  ]);
  return { token, expiresAt };
}

export async function findBoundUser(
  db: D1Database,
  provider: AuthProvider,
  subject: string,
): Promise<User | null> {
  return db.prepare(
    `SELECT u.*
     FROM user_identities identity
     INNER JOIN users u ON u.id = identity.user_id
     WHERE identity.provider = ? AND identity.subject = ?`,
  ).bind(provider, subject).first<User>();
}

export async function findEnrollment(
  db: D1Database,
  rawToken: string,
): Promise<EnrollmentRecord | null> {
  if (!validEnrollmentToken(rawToken)) return null;
  const tokenHash = await hashEnrollmentToken(rawToken);
  return db.prepare(
    `SELECT token.id AS enrollment_id, token.user_id, token.expires_at, token.consumed_at,
            u.email, u.role, u.status, identity.provider AS bound_provider
     FROM enrollment_tokens token
     INNER JOIN users u ON u.id = token.user_id
     LEFT JOIN user_identities identity ON identity.user_id = u.id
     WHERE token.token_hash = ?`,
  ).bind(tokenHash).first<EnrollmentRecord>();
}

export function enrollmentFailure(
  enrollment: EnrollmentRecord | null,
  userInfo: OAuthUserInfo,
  nowEpoch = Math.floor(Date.now() / 1000),
): EnrollmentFailure | null {
  if (!enrollment) return 'enrollment_required';
  if (enrollment.consumed_at || enrollment.expires_at <= nowEpoch) return 'enrollment_expired';
  if (enrollment.status === 'paused' || enrollment.status === 'offboarded') return 'account_suspended';
  if (enrollment.bound_provider) return 'identity_conflict';
  if (!userInfo.emailVerified) return 'unverified_email';
  const providerEmail = normalizeEmail(userInfo.email);
  if (!providerEmail || providerEmail !== normalizeEmail(enrollment.email)) {
    return 'enrollment_email_mismatch';
  }
  return null;
}

export async function bindEnrolledIdentity(
  db: D1Database,
  enrollment: EnrollmentRecord,
  provider: AuthProvider,
  subject: string,
  displayName: string,
): Promise<void> {
  const results = await db.batch([
    db.prepare(
      `UPDATE enrollment_tokens
       SET consumed_at = datetime('now')
       WHERE id = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > unixepoch('now')`,
    ).bind(enrollment.enrollment_id, enrollment.user_id),
    db.prepare(
      `INSERT INTO user_identities (provider, subject, user_id, created_at)
       SELECT ?, ?, ?, datetime('now') WHERE changes() = 1`,
    ).bind(provider, subject, enrollment.user_id),
    db.prepare(
      `UPDATE users
       SET auth_provider = ?,
           display_name = CASE WHEN display_name = '' THEN ? ELSE display_name END,
           status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
           updated_at = datetime('now')
       WHERE id = ? AND changes() = 1`,
    ).bind(provider, displayName.slice(0, 200), enrollment.user_id),
  ]);
  if (!results[0]?.meta.changes || !results[1]?.meta.changes || !results[2]?.meta.changes) {
    throw new Error('Enrollment identity binding did not complete');
  }
}
