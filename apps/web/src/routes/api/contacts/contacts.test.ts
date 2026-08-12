import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

describe('mail identity contacts', () => {
  it('queries mailbox identities only, never user sign-in addresses', async () => {
    const all = vi.fn().mockResolvedValue({
      results: [{ address: 'person@org.example', display_name: 'Person', type: 'personal' }],
    });
    const calls: string[] = [];
    const prepare = (sql: string) => {
      calls.push(sql);
      return { all };
    };
    const response = await GET({
      locals: { user: { id: 'user-1' } },
      platform: { env: { DB: { prepare } } },
    } as never);

    const sql = calls[0] || '';
    expect(sql).toContain('FROM mailboxes m');
    expect(sql).not.toMatch(/users\s|u\.email|user_identities/i);
    await expect(response.json()).resolves.toEqual([
      { email: 'person@org.example', name: 'Person', type: 'mailbox' },
    ]);
  });
});
