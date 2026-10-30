import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@cmail/shared/types';
import type { EnrollmentRecord } from '#lib/server/identity.js';

// The email one-time-code sign-in actions. Every pre-authentication refusal
// must look exactly like success to the caller; the real reason goes to the
// audit log only. Address normalisation uses the real validation module.

const mocks = vi.hoisted(() => ({
  emailOtpEnabled: vi.fn(),
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
  emailOtpEnabled: mocks.emailOtpEnabled,
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
vi.mock('#lib/server/mcp/resume.js', () => ({
  MCP_AUTHORIZE_COOKIE: 'cmail_mcp_authorize',
  mcpResumeLocation: vi.fn((_cookie: string | undefined, fallback: string) => fallback),
}));

const { actions } = await import('./+page.server');

const ISSUED_REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const NEUTRAL_MESSAGE = 'If this address is registered for email sign-in, a code is on its way.';
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

function enrollment(overrides: Partial<EnrollmentRecord> = {}): EnrollmentRecord {
  return {
    enrollment_id: 'enrollment-1',
    user_id: 'user-1',
    email: 'person@example.com',
    role: 'standard',
    status: 'pending',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    consumed_at: null,
    bound_provider: null,
    ...overrides,
  } as EnrollmentRecord;
}

function fakeDb(options: { enrolledUser?: User | null; publishedPolicy?: boolean; signedPolicy?: boolean } = {}) {
  const runs: string[] = [];
  const prepare = vi.fn((sql: string) => {
    const statement = {
      bind: vi.fn(() => statement),
      run: vi.fn(async () => {
        runs.push(sql);
        return { meta: { changes: 1 } };
      }),
      first: vi.fn(async () => {
        if (sql.includes('SELECT * FROM users WHERE id = ?')) return options.enrolledUser ?? null;
        if (sql.includes('FROM ict_policy_versions')) return options.publishedPolicy ? { id: 'policy-1' } : null;
        if (sql.includes('FROM ict_policy_signatures')) return options.signedPolicy ? { id: 'signature-1' } : null;
        return null;
      }),
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
const auditedDetail = (text: string) => mocks.audit.mock.calls.some((call) => String(call[1].detail).includes(text));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.emailOtpEnabled.mockReturnValue(true);
  mocks.createOtpProof.mockResolvedValue('signed-proof');
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
  mocks.loadOrgSettings.mockResolvedValue({ signInCountries: [], systemEmail: 'no-reply@example.com', systemFromName: 'Mail', orgName: 'Example', appName: 'cmail', appUrl: '' });
  mocks.countryAllowed.mockReturnValue(true);
  mocks.turnstileEnabled.mockReturnValue(false);
  mocks.verifyTurnstile.mockResolvedValue(true);
  mocks.findBoundUser.mockResolvedValue(person());
  mocks.findEnrollment.mockResolvedValue(enrollment());
  mocks.detectEmailProvider.mockResolvedValue('unknown');
  mocks.issueOtp.mockResolvedValue({ requestId: ISSUED_REQUEST_ID, code: '12345678' });
  mocks.detectProvider.mockReturnValue('resend');
  mocks.sendEmail.mockResolvedValue({ success: true });
  mocks.verifyOtpProof.mockResolvedValue({ v: 1, purpose: 'signin', address: 'person@example.com', requestId: ISSUED_REQUEST_ID, exp: 0 });
  mocks.verifyOtp.mockResolvedValue('ok');
  mocks.signInCountryGate.mockResolvedValue({ allowed: true });
  mocks.createSessionToken.mockResolvedValue({ token: 'session-token', hash: 'hash', expiresAt: new Date('2026-12-01T00:00:00Z'), sessionId: 'session-1' });
});

describe('request a code', () => {
  async function request(fields: Record<string, string> = { address: ' Person@Example.com ' }, cookies: Record<string, string> = {}) {
    const { event: requestEvent, cookies: jar } = event('request', fields, { cookies });
    const result = await (actions.request as any)(requestEvent);
    return { result, cookies: jar };
  }
  const proofRequestId = () => mocks.createOtpProof.mock.calls[0]?.[2];

  it('sends a code to an enrolled, active address and binds the proof to it (control)', async () => {
    const { result, cookies } = await request();
    expect(result).toStrictEqual({ requestSent: true, purpose: 'signin', message: NEUTRAL_MESSAGE });
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(expect.anything(), 'otp_addr', 'person@example.com', 3, 900);
    expect(mocks.issueOtp).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ purpose: 'signin', address: 'person@example.com' }));
    expect(proofRequestId()).toBe(ISSUED_REQUEST_ID);
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'person@example.com' }), expect.anything());
    expect(auditedTypes()).toContain('otp.sent');
    expect(cookies.set).toHaveBeenCalledWith('cmail_otp_proof', 'signed-proof', expect.objectContaining({ httpOnly: true, maxAge: 600 }));
  });

  it.each([
    ['the address is rate limited', () => mocks.consumeRateLimit.mockImplementation(async (_db: unknown, bucket: string) => ({ allowed: bucket !== 'otp_addr' })), null, 'loadOrgSettings'],
    ['the IP is rate limited', () => mocks.consumeRateLimit.mockImplementation(async (_db: unknown, bucket: string) => ({ allowed: bucket !== 'otp_ip' })), null, 'loadOrgSettings'],
    ['the country is not allowed', () => mocks.countryAllowed.mockReturnValue(false), 'otp.geo_refused', 'findBoundUser'],
    ['the address is not enrolled', () => mocks.findBoundUser.mockResolvedValue(null), null, null],
    ['the account is paused', () => mocks.findBoundUser.mockResolvedValue(person({ status: 'paused' })), null, null],
  ])('answers exactly as for success, and issues and sends nothing, when %s', async (_label, arrange, auditType, notReached) => {
    arrange();
    const refused = await request();
    // Same value as the control, and a decoy request id (never the issued one) with identical cookie options.
    expect(refused.result).toStrictEqual({ requestSent: true, purpose: 'signin', message: NEUTRAL_MESSAGE });
    expect(proofRequestId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(proofRequestId()).not.toBe(ISSUED_REQUEST_ID);
    expect(refused.cookies.set.mock.calls).toStrictEqual([['cmail_otp_proof', 'signed-proof', { path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 600 }]]);
    if (auditType) expect(auditedTypes()).toContain(auditType);
    if (notReached === 'loadOrgSettings') expect(mocks.loadOrgSettings).not.toHaveBeenCalled();
    if (notReached === 'findBoundUser') expect(mocks.findBoundUser).not.toHaveBeenCalled();
    if (!notReached) expect(mocks.findBoundUser).toHaveBeenCalledWith(expect.anything(), 'email', 'person@example.com');
    expect(mocks.issueOtp).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('checks a submitted Turnstile token and stays neutral when it fails', async () => {
    mocks.turnstileEnabled.mockReturnValue(true);
    mocks.verifyTurnstile.mockResolvedValue(false);
    const { result } = await request({ address: 'person@example.com', 'cf-turnstile-response': 'token-value' });
    expect(result).toStrictEqual({ requestSent: true, purpose: 'signin', message: NEUTRAL_MESSAGE });
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith(expect.anything(), 'token-value', '192.0.2.10');
    expect(auditedTypes()).toContain('otp.turnstile_failed');
    expect(mocks.issueOtp).not.toHaveBeenCalled();
  });

  it('refuses a missing Turnstile token without calling siteverify', async () => {
    mocks.turnstileEnabled.mockReturnValue(true);
    const { result } = await request();
    expect(result).toStrictEqual({ requestSent: true, purpose: 'signin', message: NEUTRAL_MESSAGE });
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(auditedTypes()).toContain('otp.turnstile_failed');
  });

  it.each([
    ['there is no outbound provider', () => mocks.detectProvider.mockReturnValue('none')],
    ['there is no system From address', () => mocks.loadOrgSettings.mockResolvedValue({ signInCountries: [], systemEmail: '', orgName: 'Example', appName: 'cmail' })],
  ])('audits, but does not reveal, a deployment that cannot send mail because %s', async (_label, arrange) => {
    arrange();
    const { result } = await request();
    expect(result).toStrictEqual({ requestSent: true, purpose: 'signin', message: NEUTRAL_MESSAGE });
    expect(mocks.issueOtp).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(auditedTypes()).toContain('email.failed');
  });

  it('stays neutral when sending fails or throws', async () => {
    mocks.sendEmail.mockResolvedValueOnce({ success: false });
    expect((await request()).result).toStrictEqual({ requestSent: true, purpose: 'signin', message: NEUTRAL_MESSAGE });
    expect(auditedTypes()).toContain('email.failed');
    expect(auditedTypes()).not.toContain('otp.sent');

    mocks.audit.mockClear();
    mocks.sendEmail.mockRejectedValueOnce(new Error('provider down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect((await request()).result).toStrictEqual({ requestSent: true, purpose: 'signin', message: NEUTRAL_MESSAGE });
      expect(auditedTypes()).toContain('email.failed');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('refuses an address that is not an email address, before any rate-limit charge', async () => {
    const { result } = await request({ address: 'not-an-address' });
    expect(result.status).toBe(400);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it('says plainly when email sign-in is switched off', async () => {
    mocks.emailOtpEnabled.mockReturnValue(false);
    const { result } = await request();
    expect(result).toMatchObject({ status: 400, data: { requestError: 'Email sign-in is not available.' } });
  });

  describe('for an invitation (purpose=enroll)', () => {
    const enrollFields = { address: 'person@example.com', purpose: 'enroll' };

    it('sends a code for a live invitation to this address (control)', async () => {
      const { result } = await request(enrollFields, { cmail_enrollment: 'enrollment-token' });
      expect(result).toStrictEqual({ requestSent: true, purpose: 'enroll', message: NEUTRAL_MESSAGE });
      expect(mocks.findEnrollment).toHaveBeenCalledWith(expect.anything(), 'enrollment-token');
      expect(mocks.issueOtp).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ purpose: 'enroll' }));
    });

    it.each([
      ['no invitation cookie', null, {}],
      ['an unknown invitation', null, { cmail_enrollment: 'enrollment-token' }],
      ['a used invitation', enrollment({ consumed_at: '2026-10-01 00:00:00' }), { cmail_enrollment: 'enrollment-token' }],
      ['an expired invitation', enrollment({ expires_at: Math.floor(Date.now() / 1000) - 1 }), { cmail_enrollment: 'enrollment-token' }],
      ['an invitation already bound to a provider', enrollment({ bound_provider: 'google' }), { cmail_enrollment: 'enrollment-token' }],
      ['an invitation for a paused account', enrollment({ status: 'paused' }), { cmail_enrollment: 'enrollment-token' }],
      ['an invitation for another address', enrollment({ email: 'someone@example.com' }), { cmail_enrollment: 'enrollment-token' }],
    ])('issues nothing for %s', async (_label, record, cookies) => {
      mocks.findEnrollment.mockResolvedValue(record);
      const { result } = await request(enrollFields, cookies);
      expect(result).toStrictEqual({ requestSent: true, purpose: 'enroll', message: NEUTRAL_MESSAGE });
      expect(mocks.issueOtp).not.toHaveBeenCalled();
    });

    it('issues nothing when the invited address turns out to be Google or Microsoft hosted', async () => {
      mocks.detectEmailProvider.mockResolvedValue('google');
      const { result } = await request(enrollFields, { cmail_enrollment: 'enrollment-token' });
      expect(result).toStrictEqual({ requestSent: true, purpose: 'enroll', message: NEUTRAL_MESSAGE });
      expect(mocks.issueOtp).not.toHaveBeenCalled();
    });
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

  it('signs in with a correct code, records the session and redirects to the mailbox (control)', async () => {
    const { db, runs } = fakeDb();
    const { result, cookies } = await verify('1234 5678', { db });
    expect(result).toMatchObject({ status: 303, location: '/mail' });
    expect(mocks.verifyOtp).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: '12345678', requestId: ISSUED_REQUEST_ID }));
    expect(runs.some((sql) => sql.includes('INSERT INTO sessions'))).toBe(true);
    expect(runs.some((sql) => sql.includes('UPDATE sessions SET revoked = 1'))).toBe(true);
    expect(runs.some((sql) => sql.includes("WHEN status = 'pending' THEN 'active'"))).toBe(true);
    expect(cookies.set).toHaveBeenCalledWith('cmail_session', 'session-token', expect.objectContaining({ httpOnly: true }));
    expect(proofCleared(cookies)).toBe(true);
  });

  it('sends a signed-in person to the usage policy when the latest one is unsigned', async () => {
    const { result } = await verify('12345678', { db: fakeDb({ publishedPolicy: true }).db });
    expect(result).toMatchObject({ status: 303, location: '/policy' });
    const signed = await verify('12345678', { db: fakeDb({ publishedPolicy: true, signedPolicy: true }).db });
    expect(signed.result).toMatchObject({ status: 303, location: '/mail' });
  });

  it('audits a change of sign-in country', async () => {
    mocks.findBoundUser.mockResolvedValue(person({ last_auth_country: 'NZ' }));
    await verify('12345678');
    expect(auditedTypes()).toContain('auth.otp.country_changed');
  });

  it('says plainly when email sign-in is switched off', async () => {
    mocks.emailOtpEnabled.mockReturnValue(false);
    const { result } = await verify('12345678');
    expect(result).toMatchObject({ status: 400, data: { verifyError: 'Email sign-in is not available.' } });
  });

  it('refuses with 503 when the session secret is weak', async () => {
    mocks.assertStrongSessionSecret.mockImplementationOnce(() => {
      throw new Error('weak');
    });
    const { result } = await verify('12345678');
    expect(result).toMatchObject({ status: 503, data: { verifyError: NEUTRAL_VERIFY } });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it.each([['missing', null, undefined], ['invalid', 'tampered', 'tampered']])('refuses and clears a %s proof cookie', async (_label, proof, seen) => {
    mocks.verifyOtpProof.mockResolvedValue(null);
    const { result, cookies } = await verify('12345678', { proof });
    expect(mocks.verifyOtpProof).toHaveBeenCalledWith(seen, expect.any(String));
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
    expect(auditedDetail('reason=account_unavailable')).toBe(true);
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

  describe('for an invitation (purpose=enroll)', () => {
    beforeEach(() => {
      mocks.verifyOtpProof.mockResolvedValue({ v: 1, purpose: 'enroll', address: 'person@example.com', requestId: ISSUED_REQUEST_ID, exp: 0 });
    });

    it('binds the email identity, drops the invitation cookie and signs the invitee in (control)', async () => {
      const { db } = fakeDb({ enrolledUser: person({ status: 'pending' }) });
      const { result, cookies } = await verify('12345678', { db, cookies: { cmail_enrollment: 'enrollment-token' } });
      expect(result).toMatchObject({ status: 303, location: '/mail' });
      expect(mocks.bindEnrolledIdentity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enrollment_id: 'enrollment-1' }), 'email', 'person@example.com', 'person@example.com');
      expect(cookies.delete.mock.calls.some((call) => call[0] === 'cmail_enrollment')).toBe(true);
      expect(auditedTypes()).toContain('auth.identity_bound');
    });

    it('refuses an enrollment proof without a live invitation', async () => {
      mocks.findEnrollment.mockResolvedValue(null);
      const { result } = await verify('12345678', { cookies: { cmail_enrollment: 'enrollment-token' } });
      expect(result).toMatchObject({ status: 400, data: { verifyError: NEUTRAL_VERIFY } });
      expect(mocks.bindEnrolledIdentity).not.toHaveBeenCalled();
      expect(auditedDetail('reason=enrollment_invalid')).toBe(true);
    });

    it('refuses neutrally when binding the identity fails', async () => {
      mocks.bindEnrolledIdentity.mockRejectedValue(new Error('UNIQUE constraint failed'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const { result } = await verify('12345678', { cookies: { cmail_enrollment: 'enrollment-token' } });
        expect(result).toMatchObject({ status: 400, data: { verifyError: NEUTRAL_VERIFY } });
        expect(mocks.createSessionToken).not.toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    });
  });
});
