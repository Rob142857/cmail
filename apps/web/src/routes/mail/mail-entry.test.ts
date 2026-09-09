import { describe, expect, it, vi } from 'vitest';
import { load as mailEntry } from './+layout.server';
import { load as chooser } from '../+page.server';
import { POST as logout } from '../auth/logout/+server';
import { PROVIDER_PREFERENCE_COOKIE } from '$lib/server/provider-preference';

function entry(preference = 'google') {
  const values: Record<string, string> = { [PROVIDER_PREFERENCE_COOKIE]: preference };
  const statement = {
    bind: vi.fn(() => statement),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
    run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
  };
  return {
    locals: { user: null as null | { id: string; role: 'standard' }, sessionId: null as null | string },
    platform: { env: {
      DB: { prepare: vi.fn(() => statement) },
      APP_URL: 'https://mail.example.com',
      SESSION_SECRET: crypto.randomUUID(),
      GOOGLE_CLIENT_ID: 'google-id', GOOGLE_CLIENT_SECRET: 'google-secret',
      MICROSOFT_CLIENT_ID: 'microsoft-id', MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
    } },
    url: new URL('https://mail.example.com/mail'),
    request: new Request('https://mail.example.com/mail'),
    isDataRequest: false,
    cookies: { get: vi.fn((name: string) => values[name]), delete: vi.fn() },
    setHeaders: vi.fn(),
    values,
  };
}

describe('remembered provider mailbox entry', () => {
  it.each(['google', 'microsoft'])('uses %s only to start fresh OAuth on a direct signed-out GET /mail', async (provider) => {
    const event = entry(provider);
    await expect(mailEntry(event as never)).rejects.toMatchObject({ status: 303, location: `/auth/login/${provider}?sso=1` });
    expect(event.setHeaders).toHaveBeenCalledWith({ 'Cache-Control': 'no-store', Vary: 'Cookie' });
    expect(event.locals.user).toBeNull();
    expect(event.platform.env.DB.prepare).not.toHaveBeenCalled();
  });

  it.each(['', 'email', 'access', 'Google', 'google microsoft', 'https://other.example', 'x'.repeat(300)])('sends an absent or invalid preference to the chooser', async (preference) => {
    await expect(mailEntry(entry(preference) as never)).rejects.toMatchObject({ location: '/' });
  });

  it.each(['cmail_enrollment', 'cmail_bootstrap_proof'])('keeps %s intent on the controlled chooser path', async (cookie) => {
    const event = entry();
    event.values[cookie] = 'synthetic-intent';
    await expect(mailEntry(event as never)).rejects.toMatchObject({ location: '/' });
  });

  it('falls back when the remembered provider is no longer configured', async () => {
    const event = entry();
    event.platform.env.GOOGLE_CLIENT_SECRET = '';
    await expect(mailEntry(event as never)).rejects.toMatchObject({ location: '/' });
  });

  it.each(['POST', 'HEAD', 'data', 'deep-link'])('does not start OAuth for %s requests', async (kind) => {
    const event = entry();
    if (kind === 'data') event.isDataRequest = true;
    else if (kind === 'deep-link') event.url.pathname = '/mail/message-1';
    else event.request = new Request(event.url, { method: kind });
    await expect(mailEntry(event as never)).rejects.toMatchObject({ location: '/' });
  });

  it('lets an active cmail session reach the assignment query regardless of the preference', async () => {
    const event = entry('microsoft');
    event.locals.user = { id: 'user-1', role: 'standard' };
    const result = await mailEntry(event as never);
    expect(result).toMatchObject({ user: event.locals.user, mailboxes: [] });
    expect(event.platform.env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE ma.user_id = ?'));
    expect(event.cookies.get).not.toHaveBeenCalled();
  });

  it.each(['', '?error=oauth_failed', '?error=invalid_state', '?error=enrollment_required', '?error=country_pending'])('keeps root %s on the normal chooser even with a remembered provider', async (search) => {
    const event = entry();
    event.url = new URL(`https://mail.example.com/${search}`);
    await expect(chooser(event as never)).resolves.toMatchObject({ bootstrapReady: false });
  });

  it.each([false, true])('explicit logout clears both cookies, including when session active is %s', async (active) => {
    const event = entry();
    if (active) {
      event.locals.user = { id: 'user-1', role: 'standard' };
      event.locals.sessionId = 'session-1';
    }
    const response = await logout(event as never) as Response;
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.getSetCookie()).toContain(`${PROVIDER_PREFERENCE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    expect(response.headers.getSetCookie().some((value) => value.startsWith('cmail_session=;') && value.includes('Max-Age=0'))).toBe(true);
    if (active) expect(event.platform.env.DB.prepare).toHaveBeenCalledWith('UPDATE sessions SET revoked = 1 WHERE id = ?');
    event.values[PROVIDER_PREFERENCE_COOKIE] = '';
    event.locals.user = null;
    await expect(mailEntry(event as never)).rejects.toMatchObject({ location: '/' });
  });
});
