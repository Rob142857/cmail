import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@cmail/shared/types';

const mocks = vi.hoisted(() => ({
  exchangeCode: vi.fn(),
  fetchUserInfo: vi.fn(),
  findBoundUser: vi.fn(),
  findEnrollment: vi.fn(),
  enrollmentFailure: vi.fn(),
  bindEnrolledIdentity: vi.fn(),
  bootstrapConfiguration: vi.fn(),
  verifyBootstrapProof: vi.fn(),
  provisionBootstrapManager: vi.fn(),
  createSessionToken: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('$lib/server/auth', () => ({
  exchangeCode: mocks.exchangeCode,
  fetchUserInfo: mocks.fetchUserInfo,
  getOAuthCallbackUrl: vi.fn(() => 'https://mail.example.com/auth/callback/google'),
  isAuthProvider: vi.fn((value: string) => value === 'google' || value === 'microsoft'),
}));
vi.mock('$lib/server/identity', () => ({
  ENROLLMENT_COOKIE: 'cmail_enrollment',
  bindEnrolledIdentity: mocks.bindEnrolledIdentity,
  enrollmentFailure: mocks.enrollmentFailure,
  findBoundUser: mocks.findBoundUser,
  findEnrollment: mocks.findEnrollment,
}));
vi.mock('$lib/server/bootstrap', () => ({
  BOOTSTRAP_PROOF_COOKIE: 'cmail_bootstrap_proof',
  bootstrapConfiguration: mocks.bootstrapConfiguration,
  provisionBootstrapManager: mocks.provisionBootstrapManager,
  verifyBootstrapProof: mocks.verifyBootstrapProof,
}));
vi.mock('$lib/server/session', () => ({
  buildSessionCookie: vi.fn(() => 'cmail_session=signed; Path=/; HttpOnly'),
  createSessionToken: mocks.createSessionToken,
}));
vi.mock('$lib/server/config', () => ({
  assertStrongSessionSecret: vi.fn(),
  maxSessionsPerUser: vi.fn(() => 5),
  sessionTtlMs: vi.fn(() => 3_600_000),
}));
vi.mock('$lib/server/validation', () => ({
  normalizeDomain: vi.fn((value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : null),
  normalizeEmail: vi.fn((value: unknown) => typeof value === 'string' && value.includes('@') ? value.trim().toLowerCase() : null),
}));
vi.mock('$lib/server/db', () => ({ audit: mocks.audit }));

import { GET } from './[provider]/+server';

const returningUser: User = {
  id: 'user-1',
  email: 'original@example.com',
  display_name: 'Returning User',
  role: 'standard',
  status: 'active',
  auth_provider: 'google',
  created_at: '2026-08-03 00:00:00',
  updated_at: '2026-08-03 00:00:00',
  last_sign_in: null,
  last_auth_country: null,
};

function fakeDb(options: { existingManager?: { id: string } | null; enrolledUser?: User | null } = {}) {
  const prepare = vi.fn((sql: string) => {
    const statement = {
      bind: vi.fn(() => statement),
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      first: vi.fn(async () => {
        if (sql.includes("role = 'manager'")) return options.existingManager ?? null;
        if (sql.includes('SELECT * FROM users WHERE id = ?')) return options.enrolledUser ?? null;
        if (sql.includes('FROM ict_policy_versions')) return null;
        return null;
      }),
    };
    return statement;
  });
  return { prepare } as unknown as D1Database;
}

function callbackEvent(cookieValues: Record<string, string> = {}, db = fakeDb()) {
  const cookies = {
    get: vi.fn((name: string) => {
      if (name === 'cmail_oauth_state_google') return 'state-value';
      if (name === 'cmail_oauth_verifier_google') return 'verifier-value';
      return cookieValues[name];
    }),
    delete: vi.fn(),
  };
  return {
    event: {
      params: { provider: 'google' },
      url: new URL('https://mail.example.com/auth/callback/google?code=code-value&state=state-value'),
      platform: {
        env: {
          DB: db,
          APP_URL: 'https://mail.example.com',
          SESSION_SECRET: '9b31cc4df6ca42c3a60cedd53d63a90f8de45aae0b72a749',
          MAIL_DOMAIN: 'example.com',
        },
      },
      cookies,
      request: new Request('https://mail.example.com/auth/callback/google', {
        headers: { 'cf-connecting-ip': '192.0.2.10' },
      }),
    },
    cookies,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchangeCode.mockResolvedValue({ access_token: 'access-token', expires_in: 3600 });
  mocks.fetchUserInfo.mockResolvedValue({
    subject: 'immutable-subject',
    email: 'changed@example.net',
    name: 'Returning User',
    provider: 'google',
    emailVerified: false,
  });
  mocks.findBoundUser.mockResolvedValue(null);
  mocks.findEnrollment.mockResolvedValue(null);
  mocks.enrollmentFailure.mockReturnValue(null);
  mocks.bindEnrolledIdentity.mockResolvedValue(undefined);
  mocks.bootstrapConfiguration.mockReturnValue(null);
  mocks.verifyBootstrapProof.mockResolvedValue(null);
  mocks.provisionBootstrapManager.mockResolvedValue(returningUser);
  mocks.createSessionToken.mockResolvedValue({
    token: 'signed-session',
    hash: 'session-hash',
    expiresAt: new Date('2026-08-03T01:00:00Z'),
    sessionId: 'session-1',
  });
  mocks.audit.mockResolvedValue(undefined);
});

describe('OAuth callback authorization branches', () => {
  it('allows a returning identity by provider + subject even when UserInfo email changed or is unverified', async () => {
    const db = fakeDb();
    mocks.findBoundUser.mockResolvedValue(returningUser);
    const { event } = callbackEvent({}, db);

    const response = await GET(event as never) as Response;
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/mail');
    expect(mocks.findBoundUser).toHaveBeenCalledWith(db, 'google', 'immutable-subject');
    expect(mocks.findEnrollment).not.toHaveBeenCalled();
  });

  it('rejects an unbound identity when no secure enrollment or bootstrap intent exists', async () => {
    const { event } = callbackEvent();
    await expect(GET(event as never)).rejects.toMatchObject({
      status: 303,
      location: '/?error=enrollment_required',
    });
    expect(mocks.findBoundUser).toHaveBeenCalledWith(expect.anything(), 'google', 'immutable-subject');
  });

  it('rejects an enrollment email mismatch without binding or auditing capabilities', async () => {
    const rawToken = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
    const record = {
      enrollment_id: 'enrollment-1',
      user_id: 'pending-user',
      email: 'invited@example.com',
      role: 'standard',
      status: 'pending',
      expires_at: 2_000_000_000,
      consumed_at: null,
      bound_provider: null,
    };
    mocks.findEnrollment.mockResolvedValue(record);
    mocks.enrollmentFailure.mockReturnValue('enrollment_email_mismatch');
    const { event } = callbackEvent({ cmail_enrollment: rawToken });

    await expect(GET(event as never)).rejects.toMatchObject({
      status: 303,
      location: '/?error=enrollment_email_mismatch',
    });
    expect(mocks.bindEnrolledIdentity).not.toHaveBeenCalled();
    const audited = JSON.stringify(mocks.audit.mock.calls);
    expect(audited).not.toContain(rawToken);
    expect(audited).not.toContain('immutable-subject');
    expect(audited).not.toContain('changed@example.net');
  });

  it('maps a concurrent enrollment binding failure to an identity conflict', async () => {
    const record = {
      enrollment_id: 'enrollment-1', user_id: 'pending-user', email: 'changed@example.net',
      role: 'standard', status: 'pending', expires_at: 2_000_000_000,
      consumed_at: null, bound_provider: null,
    };
    mocks.findEnrollment.mockResolvedValue(record);
    mocks.bindEnrolledIdentity.mockRejectedValue(new Error('unique constraint'));
    const { event } = callbackEvent({
      cmail_enrollment: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
    });

    await expect(GET(event as never)).rejects.toMatchObject({
      status: 303,
      location: '/?error=identity_conflict',
    });
  });

  it('provisions the first manager only from a matching signed proof and provider email', async () => {
    const configuration = {
      email: 'admin@example.com', token: 'strong-token', sessionSecret: 'session-secret',
    };
    const manager = { ...returningUser, id: 'manager-1', email: configuration.email, role: 'manager' as const };
    mocks.fetchUserInfo.mockResolvedValue({
      subject: 'bootstrap-subject', email: configuration.email, name: 'First Manager',
      provider: 'google', emailVerified: true,
    });
    mocks.bootstrapConfiguration.mockReturnValue(configuration);
    mocks.verifyBootstrapProof.mockResolvedValue({
      version: 1, email: configuration.email, expiresAt: 2_000_000_000, nonce: crypto.randomUUID(),
    });
    mocks.provisionBootstrapManager.mockResolvedValue(manager);
    const db = fakeDb({ existingManager: null });
    const { event } = callbackEvent({ cmail_bootstrap_proof: 'signed-proof' }, db);

    const response = await GET(event as never) as Response;
    expect(response.status).toBe(303);
    expect(mocks.provisionBootstrapManager).toHaveBeenCalledWith(db, expect.objectContaining({
      email: configuration.email,
      provider: 'google',
      subject: 'bootstrap-subject',
    }));
  });

  it('rejects bootstrap when UserInfo email does not match the proof', async () => {
    const configuration = {
      email: 'admin@example.com', token: 'strong-token', sessionSecret: 'session-secret',
    };
    mocks.fetchUserInfo.mockResolvedValue({
      subject: 'bootstrap-subject', email: 'other@example.com', name: 'Other Person',
      provider: 'google', emailVerified: true,
    });
    mocks.bootstrapConfiguration.mockReturnValue(configuration);
    mocks.verifyBootstrapProof.mockResolvedValue({
      version: 1, email: configuration.email, expiresAt: 2_000_000_000, nonce: crypto.randomUUID(),
    });
    const { event } = callbackEvent({ cmail_bootstrap_proof: 'signed-proof' });

    await expect(GET(event as never)).rejects.toMatchObject({
      status: 303,
      location: '/?error=bootstrap_invalid',
    });
    expect(mocks.provisionBootstrapManager).not.toHaveBeenCalled();
  });
});
