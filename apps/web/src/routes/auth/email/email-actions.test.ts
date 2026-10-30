import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@cmail/shared/types';

// The email one-time-code sign-in actions. Every pre-authentication refusal
// must look exactly like success to the caller; the real reason goes to the
// audit log only.

const mocks = vi.hoisted(() => ({
  assertStrongSessionSecret: vi.fn(),
  audit: vi.fn(),
  detectEmailProvider: vi.fn(),
  createOtpProof: vi.fn(),
  issueOtp: vi.fn(),
  verifyOtp: vi.fn(),
  verifyOtpProof: vi.fn(),
  bindEnrolledIdentity: vi.fn(),
  findBoundUser: vi.fn(),
  findEnrollment: vi.fn(),
  loadOrgSettings: vi.fn(),
  detectProvider: vi.fn(),
  sendEmail: vi.fn(),
  consumeRateLimit: vi.fn(),
  createSessionToken: vi.fn(),
  countryAllowed: vi.fn(),
  recordTravelRequest: vi.fn(),
  signInCountryGate: vi.fn(),
  turnstileEnabled: vi.fn(),
  verifyTurnstile: vi.fn(),
}));

vi.mock('#lib/server/config.js', () => ({
  assertStrongSessionSecret: mocks.assertStrongSessionSecret,
  emailOtpEnabled: vi.fn(() => true),
  maxSessionsPerUser: vi.fn(() => 5),
  otpSessionTtlMs: vi.fn(() => 3_600_000),
}));
vi.mock('#lib/server/db.js', () => ({ audit: mocks.audit }));
vi.mock('#lib/server/email-provider.js', () => ({ detectEmailProvider: mocks.detectEmailProvider }));
vi.mock('#lib/server/email-otp.js', () => ({
  OTP_PROOF_COOKIE: 'cmail_otp_proof',
  OTP_PROOF_TTL_SECONDS: 600,
  createOtpProof: mocks.createOtpProof,
  generateOtpEmail: vi.fn(() => ({ subject: 'Your code', html: '<p>code</p>', text: 'code' })),
  issueOtp: mocks.issueOtp,
  verifyOtp: mocks.verifyOtp,
  verifyOtpProof: mocks.verifyOtpProof,
}));
vi.mock('#lib/server/identity.js', () => ({
  ENROLLMENT_COOKIE: 'cmail_enrollment',
  bindEnrolledIdentity: mocks.bindEnrolledIdentity,
  findBoundUser: mocks.findBoundUser,
  findEnrollment: mocks.findEnrollment,
}));
vi.mock('#lib/server/org-settings.js', () => ({ loadOrgSettings: mocks.loadOrgSettings }));
vi.mock('#lib/server/outbound.js', () => ({ detectProvider: mocks.detectProvider, sendEmail: mocks.sendEmail }));
vi.mock('#lib/server/rate-limit.js', () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock('#lib/server/session.js', () => ({
  SESSION_COOKIE: 'cmail_session',
  SESSION_COOKIE_MAX_AGE_SECONDS: 3600,
  createSessionToken: mocks.createSessionToken,
}));
vi.mock('#lib/server/travel.js', () => ({
  COUNTRY_PENDING_MESSAGE: 'Sign-in from this country needs approval.',
  countryAllowed: mocks.countryAllowed,
  recordTravelRequest: mocks.recordTravelRequest,
  requestCountry: vi.fn(() => 'AU'),
  signInCountryGate: mocks.signInCountryGate,
}));
vi.mock('#lib/server/turnstile.js', () => ({
  turnstileEnabled: mocks.turnstileEnabled,
  turnstileSiteKey: vi.fn(() => ''),
  verifyTurnstile: mocks.verifyTurnstile,
}));
vi.mock('#lib/server/validation.js', () => ({
  normalizeEmail: vi.fn((value: unknown) => typeof value === 'string' && value.includes('@') ? value.trim().toLowerCase() : null),
}));
vi.mock('#lib/server/mcp/resume.js', () => ({
  MCP_AUTHORIZE_COOKIE: 'cmail_mcp_authorize',
  mcpResumeLocation: vi.fn((_cookie: string | undefined, fallback: string) => fallback),
}));

const { actions } = await import('./+page.server');

const NEUTRAL_REQUEST = { requestSent: true, purpose: 'signin', message: 'If this address is registered for email sign-in, a code is on its way.' };
const NEUTRAL_VERIFY = "That code didn't work or has expired.";

function person(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'person@example.com',
    display_name: 'Example Person',
    role: 'standard',
    status: 'active',
    auth_provider: 'email',
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    last_sign_in: null,
    last_auth_country: null,
    ...overrides,
  } as User;
}

function fakeDb(enrolledUser: User | null = null) {
  const runs: string[] = [];
  const prepare = vi.fn((sql: string) => {
    const statement = {
      bind: vi.fn(() => statement),
      run: vi.fn(async () => {
        runs.push(sql);
        return { meta: { changes: 1 } };
      }),
      first: vi.fn(async () => (sql.includes('SELECT * FROM users WHERE id = ?') ? enrolledUser : null)),
    };
    return statement;
  });
  return { db: { prepare } as unknown as D1Database, runs };
}

function cookieJar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: vi.fn((name: string) => values.get(name)),
    set: vi.fn((name: string, value: string) => {
      values.set(name, value);
    }),
    delete: vi.fn((name: string) => {
      values.delete(name);
    }),
  };
}

function event(action: 'request' | 'verify', fields: Record<string, string>, options: { cookies?: Record<string, string>; db?: D1Database } = {}) {
  const url = new URL(`https://mail.example.com/auth/email?/${action}`);
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const cookies = cookieJar(options.cookies);
  return {
    cookies,
    event: {
      url,
      request: new Request(url, { method: 'POST', body, headers: { 'cf-connecting-ip': '192.0.2.10' } }),
      platform: { env: { DB: options.db ?? fakeDb().db, SESSION_SECRET: 's'.repeat(48) } },
      cookies,
    },
  };
}

const auditedTypes = () => mocks.audit.mock.calls.map((call) => call[1].event_type);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createOtpProof.mockResolvedValue('signed-proof');
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
  mocks.loadOrgSettings.mockResolvedValue({ signInCountries: [], systemEmail: 'no-reply@example.com', systemFromName: 'Mail', orgName: 'Example', appName: 'cmail', appUrl: '' });
  mocks.countryAllowed.mockReturnValue(true);
  mocks.turnstileEnabled.mockReturnValue(false);
  mocks.findBoundUser.mockResolvedValue(person());
  mocks.issueOtp.mockResolvedValue({ requestId: '11111111-1111-1111-1111-111111111111', code: '12345678' });
  mocks.detectProvider.mockReturnValue('resend');
  mocks.sendEmail.mockResolvedValue({ success: true });
  mocks.verifyOtpProof.mockResolvedValue({ v: 1, purpose: 'signin', address: 'person@example.com', requestId: '11111111-1111-1111-1111-111111111111', exp: 0 });
  mocks.verifyOtp.mockResolvedValue('ok');
  mocks.signInCountryGate.mockResolvedValue({ allowed: true });
  mocks.createSessionToken.mockResolvedValue({ token: 'session-token', hash: 'hash', expiresAt: new Date('2026-12-01T00:00:00Z'), sessionId: 'session-1' });
});

describe('request a code', () => {
  async function request(fields: Record<string, string> = { address: 'Person@Example.com' }) {
    const { event: requestEvent, cookies } = event('request', fields);
    const result = await (actions.request as any)(requestEvent);
    return { result, cookies };
  }

  it('sends a code to an enrolled, active address (control)', async () => {
    const { result, cookies } = await request();
    expect(result).toEqual(NEUTRAL_REQUEST);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(auditedTypes()).toContain('otp.sent');
    expect(cookies.set).toHaveBeenCalledWith('cmail_otp_proof', 'signed-proof', expect.objectContaining({ httpOnly: true, maxAge: 600 }));
  });

  it.each([
    ['the address is rate limited', () => mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: false }), null],
    ['the country is not allowed', () => mocks.countryAllowed.mockReturnValue(false), 'otp.geo_refused'],
    ['Turnstile fails', () => {
      mocks.turnstileEnabled.mockReturnValue(true);
      mocks.verifyTurnstile.mockResolvedValue(false);
    }, 'otp.turnstile_failed'],
    ['the address is not enrolled', () => mocks.findBoundUser.mockResolvedValue(null), null],
    ['the account is paused', () => mocks.findBoundUser.mockResolvedValue(person({ status: 'paused' })), null],
  ])('answers exactly as for success, sends nothing and issues no code when %s', async (_label, arrange, auditType) => {
    arrange();
    const { result, cookies } = await request();
    expect(result).toEqual(NEUTRAL_REQUEST);
    expect(mocks.issueOtp).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    // A decoy proof is still set, so verify can't tell the cases apart either.
    expect(cookies.set).toHaveBeenCalledWith('cmail_otp_proof', 'signed-proof', expect.anything());
    if (auditType) expect(auditedTypes()).toContain(auditType);
  });

  it('refuses a missing Turnstile token without calling siteverify', async () => {
    mocks.turnstileEnabled.mockReturnValue(true);
    const { result } = await request();
    expect(result).toEqual(NEUTRAL_REQUEST);
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(auditedTypes()).toContain('otp.turnstile_failed');
  });

  it('audits, but does not reveal, a deployment that cannot send mail', async () => {
    mocks.detectProvider.mockReturnValue('none');
    const { result } = await request();
    expect(result).toEqual(NEUTRAL_REQUEST);
    expect(mocks.issueOtp).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(auditedTypes()).toContain('email.failed');
  });

  it('stays neutral when sending throws', async () => {
    mocks.sendEmail.mockRejectedValue(new Error('provider down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { result } = await request();
      expect(result).toEqual(NEUTRAL_REQUEST);
      expect(auditedTypes()).toContain('email.failed');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('rejects an address that is not an email address', async () => {
    const { result } = await request({ address: 'not-an-address' });
    expect(result.status).toBe(400);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });
});

describe('verify a code', () => {
  async function verify(code: string, options: { proof?: string | null; db?: D1Database; cookies?: Record<string, string> } = {}) {
    const proof = options.proof === undefined ? 'signed-proof' : options.proof;
    const { event: verifyEvent, cookies } = event('verify', { code }, {
      cookies: { ...(proof ? { cmail_otp_proof: proof } : {}), ...options.cookies },
      db: options.db,
    });
    try {
      return { result: await (actions.verify as any)(verifyEvent), cookies };
    } catch (thrown) {
      return { result: thrown as { status: number; location: string }, cookies };
    }
  }
  const proofCleared = (cookies: ReturnType<typeof cookieJar>) =>
    cookies.delete.mock.calls.some((call) => call[0] === 'cmail_otp_proof');

  it('signs in with a correct code and redirects to the mailbox (control)', async () => {
    const { result, cookies } = await verify('1234 5678');
    expect(result).toMatchObject({ status: 303, location: '/mail' });
    expect(mocks.verifyOtp).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: '12345678' }));
    expect(cookies.set).toHaveBeenCalledWith('cmail_session', 'session-token', expect.objectContaining({ httpOnly: true }));
    expect(proofCleared(cookies)).toBe(true);
  });

  it('refuses with 503 when the session secret is weak', async () => {
    mocks.assertStrongSessionSecret.mockImplementationOnce(() => {
      throw new Error('weak');
    });
    const { result } = await verify('12345678');
    expect(result).toMatchObject({ status: 503, data: { verifyError: NEUTRAL_VERIFY } });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it.each([['missing', null], ['invalid', 'tampered']])('refuses and clears a %s proof cookie', async (_label, proof) => {
    mocks.verifyOtpProof.mockResolvedValue(null);
    const { result, cookies } = await verify('12345678', { proof });
    expect(result).toMatchObject({ status: 400, data: { verifyError: NEUTRAL_VERIFY } });
    expect(proofCleared(cookies)).toBe(true);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it.each(['1234567', '123456789', 'abcdefgh', ''])('treats %j as a mismatch without checking it, and keeps the proof for a retry', async (code) => {
    const { result, cookies } = await verify(code);
    expect(result).toMatchObject({ status: 400, data: { verifyError: NEUTRAL_VERIFY } });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(proofCleared(cookies)).toBe(false);
  });

  it('keeps the proof after a wrong code, so the person can retype it', async () => {
    mocks.verifyOtp.mockResolvedValue('mismatch');
    const { cookies } = await verify('87654321');
    expect(proofCleared(cookies)).toBe(false);
    expect(auditedTypes()).toContain('otp.verify_failed');
  });

  it.each([['expired', 'otp.verify_failed'], ['unknown', 'otp.verify_failed'], ['locked', 'otp.locked']])('clears the proof when the code is %s', async (outcome, auditType) => {
    mocks.verifyOtp.mockResolvedValue(outcome);
    const { result, cookies } = await verify('87654321');
    expect(result).toMatchObject({ status: 400, data: { verifyError: NEUTRAL_VERIFY } });
    expect(proofCleared(cookies)).toBe(true);
    expect(auditedTypes()).toContain(auditType);
    expect(mocks.createSessionToken).not.toHaveBeenCalled();
  });

  it.each([
    ['no longer bound to anyone', null],
    ['paused', person({ status: 'paused' })],
    ['offboarded', person({ status: 'offboarded' })],
  ])('refuses a correct code for an account that is %s', async (_label, user) => {
    mocks.findBoundUser.mockResolvedValue(user);
    const { result } = await verify('12345678');
    expect(result).toMatchObject({ status: 400, data: { verifyError: NEUTRAL_VERIFY } });
    expect(mocks.createSessionToken).not.toHaveBeenCalled();
    expect(mocks.audit.mock.calls.some((call) => String(call[1].detail).includes('reason=account_unavailable'))).toBe(true);
  });

  it('never signs a manager in with an email code', async () => {
    mocks.findBoundUser.mockResolvedValue(person({ role: 'manager' }));
    const { result } = await verify('12345678');
    expect(result).toMatchObject({ status: 400 });
    expect(auditedTypes()).toContain('auth.otp.manager_blocked');
    expect(mocks.createSessionToken).not.toHaveBeenCalled();
  });

  it('explains a country refusal only after the code is proven', async () => {
    mocks.signInCountryGate.mockResolvedValue({ allowed: false });
    const { result } = await verify('12345678');
    expect(result).toMatchObject({ status: 400, data: { verifyError: 'Sign-in from this country needs approval.' } });
    expect(mocks.recordTravelRequest).toHaveBeenCalledTimes(1);
    expect(mocks.createSessionToken).not.toHaveBeenCalled();
  });

  it('refuses an enrollment proof without a live enrollment', async () => {
    mocks.verifyOtpProof.mockResolvedValue({ v: 1, purpose: 'enroll', address: 'person@example.com', requestId: '11111111-1111-1111-1111-111111111111', exp: 0 });
    mocks.findEnrollment.mockResolvedValue(null);
    const { result } = await verify('12345678', { cookies: { cmail_enrollment: 'enrollment-token' } });
    expect(result).toMatchObject({ status: 400, data: { verifyError: NEUTRAL_VERIFY } });
    expect(mocks.bindEnrolledIdentity).not.toHaveBeenCalled();
    expect(mocks.audit.mock.calls.some((call) => String(call[1].detail).includes('reason=enrollment_invalid'))).toBe(true);
  });
});
