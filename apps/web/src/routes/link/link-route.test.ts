import { describe, expect, it, vi } from 'vitest';
import { LINK_BLOCKLIST_META_KEY, buildShards, shardKey } from '@cmail/shared/link-blocklist';
import { linkSignature } from '#lib/server/link-check.js';
import { load } from './+page.server';

const SECRET = 's'.repeat(48);

function storage(domains: string[], available = true) {
  const objects = new Map<string, string>();
  for (const [shard, text] of buildShards(domains)) objects.set(shardKey(shard), text);
  if (available) objects.set(LINK_BLOCKLIST_META_KEY, JSON.stringify({ fetchedAt: new Date().toISOString() }));
  return {
    head: vi.fn(async (key: string) => (objects.has(key) ? { key } : null)),
    get: vi.fn(async (key: string) => (objects.has(key) ? { text: async () => objects.get(key)! } : null)),
  } as unknown as R2Bucket;
}

async function visit(params: Record<string, string>, options: { signedIn?: boolean; listed?: string[]; available?: boolean; userId?: string } = {}) {
  const url = new URL('https://mail.example.test/link');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const event = {
    url,
    locals: { user: options.signedIn === false ? null : { id: options.userId ?? 'user-1' } },
    setHeaders: vi.fn(),
    platform: { env: { SESSION_SECRET: SECRET, STORAGE: storage(options.listed ?? [], options.available ?? true) } },
  };
  try {
    return { data: await (load as any)(event) };
  } catch (thrown) {
    return { redirect: thrown as { status: number; location: string } };
  }
}

const signed = (href: string, userId = 'user-1') => ({ u: href, s: linkSignature(SECRET, userId, href) });

describe('/link click check', () => {
  it('redirects a cmail-signed link that is not on the list', async () => {
    const result = await visit(signed('https://example.com/news?id=1'));
    expect(result.redirect).toMatchObject({ status: 303, location: 'https://example.com/news?id=1' });
  });

  it('warns instead of redirecting when the site is on the known-bad list, even when signed', async () => {
    const result = await visit(signed('https://login.evil.example/reset'), { listed: ['evil.example'] });
    expect(result.data).toMatchObject({ risk: 'listed', host: 'login.evil.example', href: 'https://login.evil.example/reset' });
  });

  it('never redirects an unsigned or wrongly signed link: it shows the check page', async () => {
    expect((await visit({ u: 'https://example.com/' })).data).toMatchObject({ risk: 'unverified' });
    expect((await visit({ u: 'https://example.com/', s: linkSignature(SECRET, 'user-1', 'https://other.example/') })).data).toMatchObject({ risk: 'unverified' });
    // A link signed for another reader is not redirected for this one.
    expect((await visit(signed('https://example.com/', 'user-2'))).data).toMatchObject({ risk: 'unverified' });
  });

  it('shows the check page, never a silent redirect, for a host it cannot check', async () => {
    expect((await visit(signed('https://a$b/'))).data).toMatchObject({ risk: 'unverified' });
  });

  it('fails open for a signed link when the list is unavailable', async () => {
    const result = await visit(signed('https://example.com/'), { available: false });
    expect(result.redirect).toMatchObject({ status: 303, location: 'https://example.com/' });
  });

  it('keeps the existing risk warnings for disguised links', async () => {
    expect((await visit({ u: 'https://evil.example/', r: 'mismatch' })).data).toMatchObject({ risk: 'mismatch' });
  });

  it('logs the decision only, and the host only for a listed site', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await visit(signed('https://u123.track.example.com/private?token=abc'));
      expect(log).toHaveBeenCalledWith('Link check', { decision: 'not_listed' });
      await visit(signed('https://login.evil.example/'), { listed: ['evil.example'] });
      expect(log).toHaveBeenCalledWith('Link check', { decision: 'listed', host: 'login.evil.example' });
      expect(JSON.stringify(log.mock.calls)).not.toContain('token=abc');
      expect(JSON.stringify(log.mock.calls)).not.toContain('u123');
    } finally {
      log.mockRestore();
    }
  });

  it.each([['javascript:alert(1)'], ['data:text/html,hi'], [`https://${['user', 'pw'].join(':')}@example.com/`]])('refuses %s', async (target) => {
    expect((await visit({ u: target, s: linkSignature(SECRET, 'user-1', target) })).redirect).toMatchObject({ location: '/mail' });
  });

  it('is signed-in only', async () => {
    expect((await visit(signed('https://example.com/'), { signedIn: false })).redirect).toMatchObject({ location: '/' });
  });
});
