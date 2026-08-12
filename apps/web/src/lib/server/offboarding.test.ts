import { describe, expect, it } from 'vitest';
import { offboardingCleanupStatements } from './offboarding';

describe('offboarding lifecycle cleanup', () => {
  it('revokes every access capability while retaining the personal mailbox record', () => {
    const captured: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          sql,
          args: [] as unknown[],
          bind(...args: unknown[]) {
            statement.args = args;
            return statement;
          },
        };
        captured.push(statement);
        return statement;
      },
    } as unknown as D1Database;

    const statements = offboardingCleanupStatements(db, 'departing-user');

    expect(statements).toHaveLength(6);
    expect(captured[0].sql).toContain('UPDATE sessions SET revoked = 1');
    expect(captured[1].sql).toContain('DELETE FROM enrollment_tokens');
    expect(captured[2].sql).toContain('DELETE FROM push_subscriptions');
    expect(captured[3].sql).toContain("UPDATE mailboxes SET status = 'disabled'");
    expect(captured[3].sql).not.toMatch(/DELETE\s+FROM\s+mailboxes/i);
    expect(captured[4].sql).toContain('DELETE FROM mailbox_assignments');
    expect(captured[4].sql).toContain("type = 'shared'");
    expect(captured[5].sql).toContain("SET visibility = 'internal'");
    for (const statement of captured) {
      expect(statement.sql).toContain("status = 'offboarded'");
      expect(statement.args).toEqual(['departing-user', 'departing-user']);
    }
  });
});
