import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { GET } from './[provider]/+server';

const mocks = vi.hoisted(() => ({ consumeRateLimit: vi.fn() }));
vi.mock('$lib/server/rate-limit', () => ({ consumeRateLimit: mocks.consumeRateLimit }));

function loginEvent(provider = 'google', search = '?sso=1', cookieValues: Record<string, string> = {}) {
  const url = new URL(`https://mail.example.com/auth/login/${provider}${search}`);
  return {
    params: { provider }, url,
    request: new Request(url),
    locals: { user: null as null | { id: string } },
    platform: { env: {
      DB: {} as D1Database,
      APP_URL: 'https://mail.example.com',
      SESSION_SECRET: crypto.randomUUID(),
      GOOGLE_CLIENT_ID: 'google-id', GOOGLE_CLIENT_SECRET: 'google-secret',
      MICROSOFT_CLIENT_ID: 'microsoft-id', MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
    } },
    cookies: {
      get: vi.fn((name: string) => cookieValues[name]),
      set: vi.fn(),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
});

describe('optional staff SSO entry', () => {
  it.each(['google', 'microsoft'])('starts %s OAuth with fresh state and PKCE and no forced chooser', async (provider) => {
    const event = loginEvent(provider);
    const response = await GET(event as never) as Response;
    const authorization = new URL(response.headers.get('Location')!);
    expect(response.status).toBe(302);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(authorization.searchParams.has('prompt')).toBe(false);
    expect(authorization.searchParams.get('redirect_uri')).toBe(`https://mail.example.com/auth/callback/${provider}`);
    const saved = Object.fromEntries(event.cookies.set.mock.calls.map(([name, value]) => [name, value]));
    expect(saved[`cmail_oauth_state_${provider}`]).toBe(authorization.searchParams.get('state'));
    expect(saved[`cmail_oauth_state_${provider}`]).toMatch(/^[0-9a-f-]{36}$/);
    const verifier = saved[`cmail_oauth_verifier_${provider}`];
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    for (const [, , options] of event.cookies.set.mock.calls) {
      expect(options).toEqual({ path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600 });
    }
    const next = loginEvent(provider);
    await GET(next as never);
    expect(next.cookies.set.mock.calls[0][1]).not.toBe(saved[`cmail_oauth_state_${provider}`]);
    expect(next.cookies.set.mock.calls[1][1]).not.toBe(verifier);
  });

  it.each(['', '?sso=0', '?sso=true', '?prompt=none'])('keeps the default chooser for %s', async (search) => {
    const response = await GET(loginEvent('google', search) as never) as Response;
    expect(new URL(response.headers.get('Location')!).searchParams.get('prompt')).toBe('select_account');
  });

  it.each(['cmail_enrollment', 'cmail_bootstrap_proof'])('keeps account selection and intent with %s', async (cookie) => {
    const event = loginEvent('google', '?sso=1', { [cookie]: 'synthetic-intent' });
    event.locals.user = { id: 'existing-user' };
    const response = await GET(event as never) as Response;
    const authorization = new URL(response.headers.get('Location')!);
    expect(response.status).toBe(302);
    expect(authorization.searchParams.get('prompt')).toBe('select_account');
    expect(authorization.toString()).not.toContain('synthetic-intent');
    expect(event.cookies.set).not.toHaveBeenCalledWith(cookie, expect.anything(), expect.anything());
  });

  it.each(['google', 'microsoft'])('opens mail directly for an already validated cmail session via %s', async (provider) => {
    const event = loginEvent(provider, '?sso=1&returnTo=https://other.example');
    event.locals.user = { id: 'existing-user' };
    const response = await GET(event as never) as Response;
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/mail');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(event.cookies.set).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it('does not accept Access headers or URL identity/redirect hints as cmail authentication', async () => {
    const event = loginEvent('google', '?sso=1&email=manager@example.com&login_hint=manager@example.com&returnTo=https://other.example');
    event.request.headers.set('Cf-Access-Authenticated-User-Email', 'manager@example.com');
    event.request.headers.set('Cf-Access-Jwt-Assertion', 'unverified-assertion');
    const response = await GET(event as never) as Response;
    expect(response.status).toBe(302);
    const location = response.headers.get('Location')!;
    expect(location).not.toContain('manager');
    expect(location).not.toContain('other.example');
    expect(location).not.toContain('unverified-assertion');
    expect(event.locals.user).toBeNull();
  });

  it('retains rate limiting on provider SSO', async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfter: 120 });
    const event = loginEvent();
    await expect(GET(event as never)).rejects.toMatchObject({ status: 303, location: '/?error=rate_limited&retry=2' });
    expect(event.cookies.set).not.toHaveBeenCalled();
  });

  it.each(['email', 'access', 'unknown'])('rejects unsupported provider %s', async (provider) => {
    await expect(GET(loginEvent(provider) as never)).rejects.toMatchObject({ status: 303, location: '/?error=provider_not_configured' });
  });

  it('fails closed when the provider or session configuration is missing', async () => {
    const event = loginEvent();
    event.platform.env.GOOGLE_CLIENT_SECRET = '';
    await expect(GET(event as never)).rejects.toMatchObject({ location: '/?error=provider_not_configured' });
    event.platform.env.SESSION_SECRET = '';
    await expect(GET(event as never)).rejects.toMatchObject({ location: '/?error=configuration' });
    expect(event.cookies.set).not.toHaveBeenCalled();
  });
});
