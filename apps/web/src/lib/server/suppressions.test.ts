import { describe, expect, it, vi } from 'vitest';
import { blockedMessage, findBlockedRecipients, suppressionApiAvailable, unblockRecipient } from './suppressions';

const env = { CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', CLOUDFLARE_EMAIL_API_TOKEN: 'test-token-0123456789' };

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sup-1',
    email: 'missing@example.net',
    reason: 'hard_bounce',
    read_only: false,
    expires_at: null,
    scope: { type: 'sending_domain', value: 'example.test' },
    ...overrides,
  };
}

function api(entries: unknown[], deleteStatus = 200) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return new Response('{}', { status: deleteStatus });
    const email = new URL(url).searchParams.get('email');
    return Response.json({ result: entries.filter((item) => (item as { email: string }).email === email) });
  });
}

function fallbackDb(rows: Array<{ address: string; complained: number }>) {
  const bind = vi.fn(() => ({ all: async () => ({ results: rows }) }));
  return { db: { prepare: vi.fn(() => ({ bind })) } as unknown as D1Database, bind };
}

describe('findBlockedRecipients', () => {
  it('names the blocked address from the Cloudflare list and lets a bounce be lifted', async () => {
    const { db } = fallbackDb([]);
    const blocked = await findBlockedRecipients(
      db, env, 'desk@example.test', ['Missing@example.net', 'ok@example.net'], api([entry()]) as unknown as typeof fetch,
    );
    expect(blocked).toEqual([{ address: 'missing@example.net', reason: 'hard_bounce', expiresAt: null, canUnblock: true }]);
  });

  it('ignores a block for another sending domain', async () => {
    const { db } = fallbackDb([]);
    const other = entry({ scope: { type: 'sending_domain', value: 'other.test' } });
    expect(await findBlockedRecipients(
      db, env, 'desk@example.test', ['missing@example.net'], api([other]) as unknown as typeof fetch,
    )).toEqual([]);
  });

  it('skips an expired block', async () => {
    const { db } = fallbackDb([]);
    const old = entry({ expires_at: '2020-01-01T00:00:00Z' });
    expect(await findBlockedRecipients(
      db, env, 'desk@example.test', ['missing@example.net'], api([old]) as unknown as typeof fetch,
    )).toEqual([]);
  });

  it('never offers to lift a complaint, a read-only or an account-wide block', async () => {
    const { db } = fallbackDb([]);
    for (const blockedEntry of [
      entry({ reason: 'complaint' }),
      entry({ read_only: true }),
      entry({ scope: { type: 'account' } }),
    ]) {
      const [result] = await findBlockedRecipients(
        db, env, 'desk@example.test', ['missing@example.net'], api([blockedEntry]) as unknown as typeof fetch,
      );
      expect(result.canUnblock).toBe(false);
    }
  });

  it('falls back to cmail bounce records without the API', async () => {
    const { db, bind } = fallbackDb([{ address: 'missing@example.net', complained: 0 }]);
    const fetcher = vi.fn();
    const blocked = await findBlockedRecipients(db, {}, 'desk@example.test', ['missing@example.net'], fetcher as unknown as typeof fetch);
    expect(fetcher).not.toHaveBeenCalled();
    expect(bind).toHaveBeenCalledWith('missing@example.net', 'example.test');
    expect(blocked).toEqual([{ address: 'missing@example.net', reason: 'bounced', expiresAt: null, canUnblock: false }]);
  });

  it('falls back to cmail records when the lookup fails', async () => {
    const { db } = fallbackDb([{ address: 'missing@example.net', complained: 1 }]);
    const failing = vi.fn(async () => new Response('', { status: 403 }));
    const [result] = await findBlockedRecipients(
      db, env, 'desk@example.test', ['missing@example.net'], failing as unknown as typeof fetch,
    );
    expect(result).toMatchObject({ reason: 'complaint', canUnblock: false });
  });
});

describe('unblockRecipient', () => {
  it('deletes the bounce block', async () => {
    const fetcher = api([entry()]);
    expect(await unblockRecipient(env, 'desk@example.test', 'missing@example.net', fetcher as unknown as typeof fetch)).toBe('lifted');
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/email/sending/suppressions/sup-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it.each([
    ['a complaint', { reason: 'complaint' }],
    ['an account-wide block', { scope: { type: 'account' } }],
  ])('refuses %s and makes no delete', async (_label, overrides) => {
    const fetcher = api([entry(overrides)]);
    expect(await unblockRecipient(env, 'desk@example.test', 'missing@example.net', fetcher as unknown as typeof fetch)).toBe('not_allowed');
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('reports a failed delete and a missing setup', async () => {
    expect(await unblockRecipient(
      env, 'desk@example.test', 'missing@example.net', api([entry()], 500) as unknown as typeof fetch,
    )).toBe('unavailable');
    expect(await unblockRecipient(
      {}, 'desk@example.test', 'missing@example.net', api([entry()]) as unknown as typeof fetch,
    )).toBe('unavailable');
    expect(suppressionApiAvailable({})).toBe(false);
  });

  it('says not blocked when the list has no entry', async () => {
    expect(await unblockRecipient(
      env, 'desk@example.test', 'missing@example.net', api([]) as unknown as typeof fetch,
    )).toBe('not_blocked');
  });
});

describe('blockedMessage', () => {
  it('names the address and the reason', () => {
    expect(blockedMessage([{ address: 'missing@example.net', reason: 'hard_bounce', expiresAt: null, canUnblock: true }]))
      .toContain('missing@example.net: an earlier email to them bounced');
    expect(blockedMessage([])).toContain('one of the recipients');
  });
});
