import { describe, expect, it, vi } from 'vitest';
import { handle, isCrossSiteFormSubmission } from './hooks.server';

const ORIGIN = 'https://mail.example.com';

async function send(path: string, init: RequestInit): Promise<{ status: number; resolved: boolean }> {
  const url = new URL(path, ORIGIN);
  const resolve = vi.fn(async () => new Response('resolved', { status: 200 }));
  const response = await (handle as any)({
    event: { url, request: new Request(url, init), locals: { user: null, sessionId: null }, platform: undefined },
    resolve,
  });
  return { status: response.status, resolved: resolve.mock.calls.length > 0 };
}

describe('CSRF guard (replaces SvelteKit\'s built-in origin check)', () => {
  it.each([
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'text/plain',
    'application/x-sveltekit-formdata',
  ])('blocks a %s POST with no Origin, exactly like SvelteKit', async (contentType) => {
    const result = await send('/mail/compose?/send', { method: 'POST', headers: { 'content-type': contentType }, body: 'a=b' });
    expect(result).toEqual({ status: 403, resolved: false });
  });

  it('blocks a form POST from another origin, including to the consent page', async () => {
    for (const path of ['/oauth/authorize?/decide', '/admin/settings?/mcp', '/mail/connected-apps?/revoke']) {
      const result = await send(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' }, body: 'a=b' });
      expect(result.status).toBe(403);
      expect(result.resolved).toBe(false);
    }
  });

  it('allows a same-origin form POST, and non-form or safe requests', async () => {
    expect(await send('/mail/compose?/send', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }, body: 'a=b' }))
      .toEqual({ status: 200, resolved: true });
    expect((await send('/api/messages/bulk', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' })).resolved).toBe(true);
    expect((await send('/mail', { method: 'GET' })).resolved).toBe(true);
  });

  it('exempts only the cookie-less OAuth token and revocation endpoints', async () => {
    for (const path of ['/oauth/token', '/oauth/revoke']) {
      const result = await send(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=x' });
      expect(result.resolved).toBe(true);
    }
    for (const path of ['/oauth/token/', '/oauth/tokens', '/oauth/authorize', '/oauth/register']) {
      const url = new URL(path, ORIGIN);
      const request = new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=b' });
      expect(isCrossSiteFormSubmission(request, url)).toBe(true);
    }
  });

  it('still blocks a browser cross-site POST to the token endpoint through the existing origin rule', async () => {
    const result = await send('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      body: 'grant_type=x',
    });
    expect(result).toEqual({ status: 403, resolved: false });
  });
});
