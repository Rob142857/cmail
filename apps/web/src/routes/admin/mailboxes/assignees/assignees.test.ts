import { describe, expect, it } from 'vitest';
import { GET } from './+server';

function user(role: 'standard' | 'manager') {
  return { id: 'user-1', role };
}

function requestEvent(options: {
  role?: 'standard' | 'manager';
  query?: string;
  rows?: unknown[];
}) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const call = { sql, values: [] as unknown[] };
      calls.push(call);
      const statement = {
        bind(...values: unknown[]) {
          call.values = values;
          return statement;
        },
        async all() {
          return { results: options.rows || [] };
        },
      };
      return statement;
    },
  };
  return {
    event: {
      locals: { user: options.role ? user(options.role) : null },
      platform: { env: { DB: db, MAIL_DOMAIN: 'maatara.io' } },
      url: new URL(`https://mail.maatara.io/admin/mailboxes/assignees?q=${encodeURIComponent(options.query || '')}`),
    },
    calls,
  };
}

describe('manager mailbox assignee search', () => {
  it('rejects unauthenticated and non-manager callers without querying', async () => {
    const anonymous = requestEvent({ query: 'a' });
    const anonymousResponse = await GET(anonymous.event as never);
    expect(anonymousResponse.status).toBe(401);
    expect(anonymous.calls).toHaveLength(0);

    const standard = requestEvent({ role: 'standard', query: 'a' });
    const standardResponse = await GET(standard.event as never);
    expect(standardResponse.status).toBe(403);
    expect(standard.calls).toHaveLength(0);
  });

  it('requires 1-100 characters', async () => {
    const blank = requestEvent({ role: 'manager', query: '   ' });
    expect((await GET(blank.event as never)).status).toBe(400);
    expect(blank.calls).toHaveLength(0);

    const long = requestEvent({ role: 'manager', query: 'x'.repeat(101) });
    expect((await GET(long.event as never)).status).toBe(400);
    expect(long.calls).toHaveLength(0);
  });

  it('returns only the public picker contract with private no-store caching', async () => {
    const captured = requestEvent({
      role: 'manager',
      query: 'alex',
      rows: [{
        user_id: 'user-2',
        display_name: 'Alex Example',
        mailbox_address: 'alex@maatara.io',
        sign_in_email: 'private@example.net',
      }],
    });
    const response = await GET(captured.event as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual([{
      userId: 'user-2',
      displayName: 'Alex Example',
      mailboxAddress: 'alex@maatara.io',
    }]);
    expect(captured.calls[0].values).toEqual(['maatara.io', '%alex%', '%alex%', 8]);
  });
});
