import { describe, expect, it, vi } from 'vitest';
import { LINK_BLOCKLIST_META_KEY, buildShards, parseDomainList, shardKey } from '@cmail/shared/link-blocklist';
import { checkLinkHost, linkSignature, verifyLinkSignature } from './link-check';
import { sanitizeEmailHtmlWithLinkGuard } from './sanitize-email';

const SECRET = 's'.repeat(48);

function listStorage(domains: string[], options: { meta?: boolean; failGet?: boolean; fetchedAt?: string } = {}) {
  const objects = new Map<string, string>();
  for (const [shard, text] of buildShards(domains)) objects.set(shardKey(shard), text);
  if (options.meta !== false) objects.set(LINK_BLOCKLIST_META_KEY, JSON.stringify({ fetchedAt: options.fetchedAt ?? new Date().toISOString() }));
  return {
    head: vi.fn(async (key: string) => (objects.has(key) ? { key } : null)),
    get: vi.fn(async (key: string) => {
      if (options.failGet) throw new Error('R2 unavailable');
      return objects.has(key) ? { text: async () => objects.get(key)! } : null;
    }),
  } as unknown as R2Bucket;
}

describe('link signatures', () => {
  const NOW = Date.UTC(2026, 9, 31);
  const WEEK = 7 * 24 * 60 * 60 * 1000;

  it('verifies only the exact link, for the same reader, with the right secret', () => {
    const signature = linkSignature(SECRET, 'user-1', 'https://example.com/a', NOW);
    expect(signature).toHaveLength(22);
    expect(verifyLinkSignature(SECRET, 'user-1', 'https://example.com/a', signature, NOW)).toBe(true);
    expect(verifyLinkSignature(SECRET, 'user-1', 'https://example.com/b', signature, NOW)).toBe(false);
    expect(verifyLinkSignature(SECRET, 'user-2', 'https://example.com/a', signature, NOW)).toBe(false);
    expect(verifyLinkSignature(`${SECRET}x`, 'user-1', 'https://example.com/a', signature, NOW)).toBe(false);
    expect(verifyLinkSignature(SECRET, 'user-1', 'https://example.com/a', null, NOW)).toBe(false);
    expect(verifyLinkSignature(SECRET, 'user-1', 'https://example.com/a', `${signature}x`, NOW)).toBe(false);
    expect(verifyLinkSignature('', 'user-1', 'https://example.com/a', signature, NOW)).toBe(false);
  });

  it('expires within two weeks', () => {
    const signature = linkSignature(SECRET, 'user-1', 'https://example.com/a', NOW);
    expect(verifyLinkSignature(SECRET, 'user-1', 'https://example.com/a', signature, NOW + WEEK)).toBe(true);
    expect(verifyLinkSignature(SECRET, 'user-1', 'https://example.com/a', signature, NOW + 2 * WEEK)).toBe(false);
  });
});

describe('checkLinkHost', () => {
  it('finds a listed host and any subdomain of it', async () => {
    const storage = listStorage(['evil.example', 'phish.example.org']);
    expect(await checkLinkHost(storage, 'evil.example')).toBe('listed');
    expect(await checkLinkHost(storage, 'login.secure.evil.example')).toBe('listed');
    expect(await checkLinkHost(storage, 'notevil.example')).toBe('not_listed');
    expect(await checkLinkHost(storage, 'example.org')).toBe('not_listed');
  });

  it('reports unavailable when the list has never been fetched or cannot be read', async () => {
    expect(await checkLinkHost(listStorage(['evil.example'], { meta: false }), 'evil.example')).toBe('unavailable');
    expect(await checkLinkHost(listStorage(['evil.example'], { failGet: true }), 'evil.example')).toBe('unavailable');
  });

  it('treats a list older than two days as unavailable', async () => {
    const stale = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(await checkLinkHost(listStorage(['evil.example'], { fetchedAt: stale }), 'evil.example')).toBe('unavailable');
  });

  it('checks hosts with underscores against their listed parent', async () => {
    expect(await checkLinkHost(listStorage(['evil.example']), 'x_y.evil.example')).toBe('listed');
  });

  it.each(['a-.evil.example', '-a.evil.example', 'a$b.evil.example', 'a~b.evil.example'])('still finds the listed parent of the odd host %s', async (host) => {
    expect(await checkLinkHost(listStorage(['evil.example']), host)).toBe('listed');
  });

  it('checks at most the 10 closest parents of a very deep host', async () => {
    const storage = listStorage(['evil.example']);
    const deep = `${Array.from({ length: 120 }, (_, i) => `l${i}`).join('.')}.evil.example`;
    expect(await checkLinkHost(storage, deep)).toBe('listed');
    expect((storage.get as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeLessThanOrEqual(11);
  });

  it('marks a web host with no checkable name as uncheckable, never not_listed', async () => {
    expect(await checkLinkHost(listStorage(['evil.example']), 'a$b')).toBe('uncheckable');
  });

  it('matches punycode hosts against Unicode entries in the list', async () => {
    const domains = parseDomainList('пример.example\n' + Array.from({ length: 3 }, (_, i) => `p${i}.example`).join('\n'));
    expect(domains).toContain(new URL('http://пример.example/').hostname);
  });

  it('treats IP-literal hosts as not listed (the list holds domain names only)', async () => {
    expect(await checkLinkHost(listStorage(['evil.example']), '192.0.2.10')).toBe('not_listed');
  });
});

describe('sanitizer link routing', () => {
  const sign = (href: string) => linkSignature(SECRET, 'user-1', href);

  it('routes ordinary web links through /link with a signature, and leaves mailto alone', () => {
    const { html } = sanitizeEmailHtmlWithLinkGuard(
      '<p><a href="https://example.com/news">example.com/news</a> <a href="mailto:team@example.com">mail us</a></p>',
      'https://mail.example.test/link',
      sign,
    );
    const href = /href="([^"]+)"/.exec(html)![1].replace(/&amp;|&#x26;|&#38;/g, '&');
    const routed = new URL(href);
    expect(routed.origin + routed.pathname).toBe('https://mail.example.test/link');
    expect(routed.searchParams.get('u')).toBe('https://example.com/news');
    expect(verifyLinkSignature(SECRET, 'user-1', 'https://example.com/news', routed.searchParams.get('s'))).toBe(true);
    expect(html).toContain('href="mailto:team@example.com"');
  });

  it('routes long links too, up to the sanitizer limit, so padding cannot skip the check', () => {
    const long = `https://example.com/track?${'x'.repeat(3000)}`;
    const { html } = sanitizeEmailHtmlWithLinkGuard(`<a href="${long}">read more</a>`, 'https://mail.example.test/link', sign);
    expect(html).not.toContain(`href="${long}"`);
    expect(new URL(/href="([^"]+)"/.exec(html)![1].replace(/&amp;|&#x26;|&#38;/g, '&')).searchParams.get('u')).toBe(long);
  });

  it('keeps risky links on the warning page, unsigned', () => {
    const { html, riskyLinks } = sanitizeEmailHtmlWithLinkGuard(
      '<a href="https://evil.example/login">https://bank.example</a>',
      'https://mail.example.test/link',
      sign,
    );
    expect(riskyLinks).toHaveLength(1);
    const routed = new URL(/href="([^"]+)"/.exec(html)![1].replace(/&amp;|&#x26;|&#38;/g, '&'));
    expect(routed.searchParams.get('r')).toBe('mismatch');
    expect(routed.searchParams.has('s')).toBe(false);
  });

  it('leaves links untouched when no signer is given (previews, drafts)', () => {
    const { html } = sanitizeEmailHtmlWithLinkGuard('<a href="https://example.com/">example.com</a>', 'https://mail.example.test/link');
    expect(html).toContain('href="https://example.com/"');
  });
});
