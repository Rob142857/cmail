import { describe, expect, it } from 'vitest';
import {
  ELIGIBLE_MAILBOX_ASSIGNEE_EXISTS_SQL,
  getEligibleMailboxAssignee,
  searchEligibleMailboxAssignees,
} from './mailbox-assignees';

function capturedDatabase(rows: unknown[] = []) {
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
          return { results: rows };
        },
        async first() {
          return rows[0] || null;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, calls };
}

describe('canonical mailbox assignees', () => {
  it('searches only active owned personal mailboxes at the exact configured domain', async () => {
    const captured = capturedDatabase([{
      user_id: 'user-1',
      display_name: 'Alex Example',
      mailbox_address: 'alex@maatara.io',
    }]);

    await expect(searchEligibleMailboxAssignees(captured.db, '@MAATARA.IO.', ' Al%_ ')).resolves.toEqual([{
      userId: 'user-1',
      displayName: 'Alex Example',
      mailboxAddress: 'alex@maatara.io',
    }]);

    expect(captured.calls[0].sql).toContain("u.status IN ('active', 'pending')");
    expect(captured.calls[0].sql).toContain("personal.type = 'personal'");
    expect(captured.calls[0].sql).toContain("personal.status = 'active'");
    expect(captured.calls[0].sql).toContain('personal.owner_user_id = u.id');
    expect(captured.calls[0].sql).toContain('HAVING COUNT(*) = 1');
    expect(captured.calls[0].values).toEqual(['maatara.io', '%al\\%\\_%', '%al\\%\\_%', 8]);
  });

  it('looks up forged action ids through the same eligibility boundary', async () => {
    const captured = capturedDatabase();
    await expect(getEligibleMailboxAssignee(captured.db, 'maatara.io', 'offboarded-user')).resolves.toBeNull();
    expect(captured.calls[0].values).toEqual(['maatara.io', 'offboarded-user']);
    expect(ELIGIBLE_MAILBOX_ASSIGNEE_EXISTS_SQL).toContain('HAVING COUNT(*) = 1');
  });

  it('does not query for a blank search or invalid domain', async () => {
    const captured = capturedDatabase();
    await expect(searchEligibleMailboxAssignees(captured.db, 'maatara.io', '   ')).resolves.toEqual([]);
    await expect(searchEligibleMailboxAssignees(captured.db, 'not a domain', 'alex')).resolves.toEqual([]);
    expect(captured.calls).toHaveLength(0);
  });
});
