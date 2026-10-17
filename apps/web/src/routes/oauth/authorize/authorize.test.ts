import { describe, expect, it } from 'vitest';
import { actions, load } from './+page.server';
import { APP_URL, createFixture, type Fixture } from '$lib/server/mcp/testing/harness';
import { REDIRECT, authorizeParams, challenge, register, userRow } from '$lib/server/mcp/testing/flow';
import { MCP_AUTHORIZE_COOKIE, MCP_RESUME_PATH } from '$lib/server/mcp/resume';

function cookieJar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (name: string) => values.get(name),
    set: (name: string, value: string) => { values.set(name, value); },
    delete: (name: string) => { values.delete(name); },
  };
}

async function run<T>(fn: () => Promise<T>): Promise<{ value?: T; redirect?: { status: number; location: string } }> {
  try {
    return { value: await fn() };
  } catch (caught) {
    if (caught && typeof caught === 'object' && 'location' in caught) {
      return { redirect: caught as { status: number; location: string } };
    }
    throw caught;
  }
}

async function start(fixture: Fixture, cookies: ReturnType<typeof cookieJar>, userId: string | null) {
  const client = await register(fixture);
  const url = new URL(`${APP_URL}/oauth/authorize?${authorizeParams(client.client_id, { code_challenge: await challenge() })}`);
  const locals = { user: userId ? await userRow(fixture, userId) : null, sessionId: null };
  const first = await run(() => (load as any)({ url, locals, platform: fixture.platform, cookies, request: new Request(url), setHeaders() {} }));
  return { client, locals, first };
}

function resume(fixture: Fixture, cookies: ReturnType<typeof cookieJar>, locals: unknown) {
  const url = new URL(`${APP_URL}${MCP_RESUME_PATH}`);
  return run(() => (load as any)({ url, locals, platform: fixture.platform, cookies, request: new Request(url), setHeaders() {} }));
}

function decide(fixture: Fixture, cookies: ReturnType<typeof cookieJar>, locals: unknown, fields: Array<[string, string]>) {
  const form = new FormData();
  for (const [key, value] of fields) form.append(key, value);
  return run(() => (actions.decide as any)({
    request: new Request(`${APP_URL}/oauth/authorize?/decide`, { method: 'POST', body: form }),
    locals,
    platform: fixture.platform,
    cookies,
  }));
}

describe('/oauth/authorize page', () => {
  it('parks a valid request behind an HttpOnly cookie and continues on a clean URL', async () => {
    const fixture = createFixture();
    const cookies = cookieJar();
    const { first } = await start(fixture, cookies, null);
    expect(first.redirect).toMatchObject({ status: 303, location: MCP_RESUME_PATH });
    expect(cookies.get(MCP_AUTHORIZE_COOKIE)).toMatch(/^cmar_/);
  });

  it('asks a signed-out user to sign in, then shows consent with safe defaults', async () => {
    const fixture = createFixture();
    const cookies = cookieJar();
    await start(fixture, cookies, null);
    const signedOut = await resume(fixture, cookies, { user: null, sessionId: null });
    expect(signedOut.value).toMatchObject({ view: 'signin', clientName: 'Test Agent' });

    const consent = await resume(fixture, cookies, { user: await userRow(fixture, 'user-alice'), sessionId: null });
    const data = consent.value as any;
    expect(data.view).toBe('consent');
    expect(data.client).toMatchObject({ name: 'Test Agent', verifiedHost: null });
    expect(data.returnTo).toBe('an app on this computer (localhost)');
    const checked = Object.fromEntries(data.scopes.map((scope: { id: string; checked: boolean }) => [scope.id, scope.checked]));
    expect(checked).toEqual({ 'mail.read': true, 'mail.draft': true, 'mail.send': false, 'mailbox.manage': false, 'calendar.read': false });
    expect(data.mailboxes.map((mailbox: { id: string; checked: boolean }) => [mailbox.id, mailbox.checked]))
      .toEqual([['mb-alice', true], ['mb-desk', false]]);
  });

  it('sends a user with an unsigned policy to /policy first', async () => {
    const fixture = createFixture();
    fixture.db.sqlite.exec("INSERT INTO ict_policy_versions (id, version_label, body_text) VALUES ('p1', 'v1', 'Rules')");
    const cookies = cookieJar();
    const { locals } = await start(fixture, cookies, 'user-alice');
    expect((await resume(fixture, cookies, locals)).redirect).toMatchObject({ location: '/policy' });
  });

  it('approves only when the form request id matches this browser\'s cookie', async () => {
    const fixture = createFixture();
    const cookies = cookieJar();
    const { locals } = await start(fixture, cookies, 'user-alice');
    const requestId = cookies.get(MCP_AUTHORIZE_COOKIE) as string;

    const otherBrowser = await decide(fixture, cookieJar(), locals, [['request_id', requestId], ['decision', 'approve'], ['scope', 'mail.read'], ['mailbox', 'mb-alice']]);
    expect((otherBrowser.value as any).status).toBe(400);

    const approved = await decide(fixture, cookies, locals, [['request_id', requestId], ['decision', 'approve'], ['scope', 'mail.read'], ['mailbox', 'mb-alice']]);
    const data = approved.value as any;
    expect(data).toMatchObject({ done: true, approved: true, clientName: 'Test Agent' });
    const redirect = new URL(data.redirectTo);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT);
    expect(redirect.searchParams.get('code')).toMatch(/^cmac_/);
    expect(redirect.searchParams.get('state')).toBe('state-123');
    expect(redirect.searchParams.get('iss')).toBe(APP_URL);
    expect(cookies.get(MCP_AUTHORIZE_COOKIE)).toBeUndefined();
    expect(fixture.db.sqlite.prepare("SELECT event_type FROM audit_log WHERE event_type = 'mcp.grant_created'").get()).toBeTruthy();
  });

  it('returns access_denied to the app when the user denies', async () => {
    const fixture = createFixture();
    const cookies = cookieJar();
    const { locals } = await start(fixture, cookies, 'user-alice');
    const denied = await decide(fixture, cookies, locals, [['request_id', cookies.get(MCP_AUTHORIZE_COOKIE) as string], ['decision', 'deny']]);
    expect(new URL((denied.value as any).redirectTo).searchParams.get('error')).toBe('access_denied');
    expect(fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM mcp_grants').get()).toEqual({ n: 0 });
  });

  it('never issues a grant while the organisation switch is off', async () => {
    const fixture = createFixture();
    const cookies = cookieJar();
    const { locals } = await start(fixture, cookies, 'user-alice');
    fixture.db.sqlite.exec("UPDATE org_settings SET value = 'false' WHERE key = 'mcp_enabled'");
    expect((await resume(fixture, cookies, locals)).value).toMatchObject({ view: 'disabled' });
    const attempt = await decide(fixture, cookies, locals, [['request_id', cookies.get(MCP_AUTHORIZE_COOKIE) as string], ['decision', 'approve'], ['scope', 'mail.read'], ['mailbox', 'mb-alice']]);
    expect((attempt.value as any).approved).toBe(false);
    expect(fixture.db.sqlite.prepare('SELECT COUNT(*) AS n FROM mcp_grants').get()).toEqual({ n: 0 });
  });

  it('shows an error page for an invalid client instead of redirecting', async () => {
    const fixture = createFixture();
    const url = new URL(`${APP_URL}/oauth/authorize?${authorizeParams('cmc_nobody000000000000000', { code_challenge: await challenge() })}`);
    const result = await run(() => (load as any)({ url, locals: { user: null }, platform: fixture.platform, cookies: cookieJar(), request: new Request(url), setHeaders() {} }));
    expect(result.value).toMatchObject({ view: 'error' });
  });
});
