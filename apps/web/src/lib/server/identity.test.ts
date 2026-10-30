import { describe, expect, it, vi } from 'vitest';
import type { OAuthUserInfo } from './auth';
import {
  bindEnrolledIdentity,
  enrollmentFailure,
  findBoundUser,
  findEnrollment,
  hashEnrollmentToken,
  issueEnrollmentToken,
  type EnrollmentRecord,
} from './identity';

const userInfo: OAuthUserInfo = {
  subject: 'immutable-subject',
  email: 'person@example.com',
  name: 'Example Person',
  provider: 'google',
  emailVerified: true,
};

const enrollment: EnrollmentRecord = {
  enrollment_id: 'enrollment-1',
  user_id: 'user-1',
  email: 'person@example.com',
  role: 'standard',
  status: 'pending',
  expires_at: 2_000,
  consumed_at: null,
  bound_provider: null,
};

function batchDb(changes: number[]) {
  const captured: Array<{ sql: string; args: unknown[] }> = [];
  const prepare = vi.fn((sql: string) => {
    const statement = {
      sql,
      args: [] as unknown[],
      bind(...args: unknown[]) {
        statement.args = args;
        return statement;
      },
    };
    captured.push(statement);
    return statement;
  });
  const batch = vi.fn().mockResolvedValue(changes.map((value) => ({ meta: { changes: value } })));
  return { db: { prepare, batch } as unknown as D1Database, captured, batch };
}

describe('OIDC identity enrollment', () => {
  it('resolves a returning account only with provider and exact subject', async () => {
    const first = vi.fn().mockResolvedValue({ id: 'user-1' });
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn((_sql: string) => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    await expect(findBoundUser(db, 'google', 'Case-Sensitive-Sub')).resolves.toEqual({ id: 'user-1' });
    const sql = prepare.mock.calls[0][0] as string;
    expect(sql).toContain('identity.provider = ? AND identity.subject = ?');
    expect(sql).not.toMatch(/WHERE[^]*email\s*=/i);
    expect(bind).toHaveBeenCalledWith('google', 'Case-Sensitive-Sub');
  });

  it.each([
    ['missing', null, userInfo, 'enrollment_required'],
    ['expired', { ...enrollment, expires_at: 999 }, userInfo, 'enrollment_expired'],
    ['reused', { ...enrollment, consumed_at: '2026-08-03 00:00:00' }, userInfo, 'enrollment_expired'],
    ['email mismatch', enrollment, { ...userInfo, email: 'other@example.com' }, 'enrollment_email_mismatch'],
    ['unverified email', enrollment, { ...userInfo, emailVerified: false }, 'unverified_email'],
    ['paused user', { ...enrollment, status: 'paused' as const }, userInfo, 'account_suspended'],
    ['offboarded user', { ...enrollment, status: 'offboarded' as const }, userInfo, 'account_suspended'],
    ['provider conflict', { ...enrollment, bound_provider: 'microsoft' as const }, userInfo, 'identity_conflict'],
  ])('rejects %s enrollment', (_label, record, info, expected) => {
    expect(enrollmentFailure(record, info, 1_000)).toBe(expected);
  });

  it('accepts only a live, unbound invitation with the matching normalised email', () => {
    expect(enrollmentFailure(enrollment, { ...userInfo, email: 'Person@Example.COM' }, 1_000)).toBeNull();
  });

  it('persists only a SHA-256 invitation hash and rotates the previous token', async () => {
    const { db, captured, batch } = batchDb([1, 1]);
    const issued = await issueEnrollmentToken(db, 'user-1', 'manager-1', 10_000);
    const expectedHash = await hashEnrollmentToken(issued.token);

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt).toBe(10_000 + 72 * 60 * 60);
    expect(captured[0].sql).toContain('DELETE FROM enrollment_tokens WHERE user_id = ?');
    expect(captured[1].sql).toContain('INSERT INTO enrollment_tokens');
    expect(captured[1].args).toContain(expectedHash);
    expect(captured.flatMap((statement) => statement.args)).not.toContain(issued.token);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('consumes and binds in one ordered D1 batch', async () => {
    const { db, captured } = batchDb([1, 1, 1]);
    await expect(bindEnrolledIdentity(
      db,
      enrollment,
      'google',
      'immutable-subject',
      'Example Person',
    )).resolves.toBeUndefined();

    expect(captured[0].sql).toContain('consumed_at IS NULL');
    expect(captured[0].sql).toContain("expires_at > unixepoch('now')");
    expect(captured[1].sql).toContain('WHERE changes() = 1');
    expect(captured[2].sql).toContain('WHERE id = ? AND changes() = 1');
    expect(captured[1].args).toEqual(['google', 'immutable-subject', 'user-1']);
  });

  it('fails closed when a concurrent attempt has already consumed the invitation', async () => {
    const { db } = batchDb([0, 0, 0]);
    await expect(bindEnrolledIdentity(
      db,
      enrollment,
      'google',
      'immutable-subject',
      'Example Person',
    )).rejects.toThrow('did not complete');
  });

  it.each([
    ['the identity insert did nothing', [1, 0, 0]],
    ['the user update did nothing', [1, 1, 0]],
    ['D1 returned fewer results than statements', [1, 1]],
  ])('fails closed when %s', async (_label, changes) => {
    const { db } = batchDb(changes);
    await expect(bindEnrolledIdentity(db, enrollment, 'google', 'immutable-subject', 'Example Person'))
      .rejects.toThrow('did not complete');
  });

  it('leaves auth_provider alone for an email identity and caps the display name', async () => {
    const { db, captured } = batchDb([1, 1, 1]);
    await bindEnrolledIdentity(db, enrollment, 'email', 'person@example.com', 'n'.repeat(250));
    expect(captured[2].sql).toContain("CASE WHEN ? = 'email' THEN auth_provider ELSE ? END");
    expect(captured[2].args).toEqual(['email', 'email', 'n'.repeat(200), 'user-1']);
  });

  it.each([
    ['used and paused (used wins)', { ...enrollment, consumed_at: '2026-08-03 00:00:00', status: 'paused' as const }, userInfo, 'enrollment_expired'],
    ['expiring exactly now', { ...enrollment, expires_at: 1_000 }, userInfo, 'enrollment_expired'],
    ['a provider with no email', enrollment, { ...userInfo, email: '' }, 'enrollment_email_mismatch'],
  ])('rejects an enrollment that is %s', (_label, record, info, expected) => {
    expect(enrollmentFailure(record, info, 1_000)).toBe(expected);
  });
});

describe('findEnrollment', () => {
  function lookupDb() {
    const first = vi.fn().mockResolvedValue(null);
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn((_sql: string) => ({ bind }));
    return { db: { prepare } as unknown as D1Database, prepare, bind };
  }

  it.each([
    ['42 characters', 'a'.repeat(42)],
    ['129 characters', 'a'.repeat(129)],
    ['a character outside base64url', `${'a'.repeat(42)}+`],
    ['not a string', 42 as unknown as string],
  ])('never queries D1 for a token with %s', async (_label, token) => {
    const { db, prepare } = lookupDb();
    await expect(findEnrollment(db, token)).resolves.toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('looks a well-formed token up by its hash, never the raw token', async () => {
    const { db, bind } = lookupDb();
    const token = `${'a'.repeat(40)}-_Z`;
    await findEnrollment(db, token);
    expect(bind).toHaveBeenCalledWith(await hashEnrollmentToken(token));
    expect(bind.mock.calls.flat()).not.toContain(token);
  });
});
