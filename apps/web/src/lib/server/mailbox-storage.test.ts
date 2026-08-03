import { describe, expect, it } from 'vitest';
import {
  mailboxStorageQuotaBytes,
  reserveMailboxStorage,
} from '@cmail/shared/mailbox-storage';

interface CapturedStatement {
  query: string;
  values: unknown[];
  bind: (...values: unknown[]) => CapturedStatement;
}

function mockDb(
  batchHandler: (call: number, statements: CapturedStatement[]) => Promise<Array<{ meta: { changes: number } }>>,
) {
  const batches: CapturedStatement[][] = [];
  const db = {
    prepare(query: string) {
      const statement: CapturedStatement = {
        query,
        values: [],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
      };
      return statement;
    },
    async batch(statements: CapturedStatement[]) {
      batches.push(statements);
      return batchHandler(batches.length, statements);
    },
  } as unknown as D1Database;
  return { db, batches };
}

describe('shared mailbox storage reservations', () => {
  it('uses conservative bounded configuration with an explicit disable', () => {
    expect(mailboxStorageQuotaBytes({})).toBe(1024 ** 3);
    expect(mailboxStorageQuotaBytes({ MAILBOX_STORAGE_QUOTA_BYTES: '0' })).toBe(0);
    expect(mailboxStorageQuotaBytes({ MAILBOX_STORAGE_QUOTA_BYTES: '2048.9' })).toBe(2048);
    expect(mailboxStorageQuotaBytes({ MAILBOX_STORAGE_QUOTA_BYTES: Number.MAX_SAFE_INTEGER })).toBe(1024 ** 4);
  });

  it('submits multi-mailbox and same-mailbox copies in one ordered D1 batch', async () => {
    const { db, batches } = mockDb(async (_call, statements) =>
      statements.map(() => ({ meta: { changes: 1 } })));

    const result = await reserveMailboxStorage(db, { MAILBOX_STORAGE_QUOTA_BYTES: 100 }, [
      { mailboxId: 'mailbox-a', deliveryKey: 'sent-copy', bytes: 40 },
      { mailboxId: 'mailbox-b', deliveryKey: 'internal-copy', bytes: 40 },
      { mailboxId: 'mailbox-b', deliveryKey: 'second-internal-copy', bytes: 40 },
    ]);

    expect(result.status).toBe('accepted');
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect(batches[0].map((statement) => statement.values[3])).toEqual(['mailbox-a', 'mailbox-b', 'mailbox-b']);
    expect(batches[0].map((statement) => statement.values[6])).toEqual([40, 40, 40]);
    expect(batches[0].every((statement) => statement.values[7] === 100)).toBe(true);
  });

  it('releases every successful row when any quota check or delivery-key uniqueness check is denied', async () => {
    const { db, batches } = mockDb(async (call, statements) => {
      if (call === 1) return [{ meta: { changes: 1 } }, { meta: { changes: 0 } }];
      return statements.map(() => ({ meta: { changes: 1 } }));
    });

    const result = await reserveMailboxStorage(db, { MAILBOX_STORAGE_QUOTA_BYTES: 100 }, [
      { mailboxId: 'mailbox-a', deliveryKey: 'copy-a', bytes: 60 },
      { mailboxId: 'mailbox-b', deliveryKey: 'existing-delivery-key', bytes: 60 },
    ]);

    expect(result).toEqual({ status: 'rejected', reservations: [] });
    expect(batches).toHaveLength(2);
    expect(batches[1]).toHaveLength(2);
    expect(batches[1].every((statement) => statement.query.includes('SET storage_pending = 0'))).toBe(true);
  });

  it('fails closed and attempts opaque-id cleanup after an ambiguous D1 batch error', async () => {
    const { db, batches } = mockDb(async (call, statements) => {
      if (call === 1) throw new Error('ambiguous transport result');
      return statements.map(() => ({ meta: { changes: 1 } }));
    });

    await expect(reserveMailboxStorage(db, { MAILBOX_STORAGE_QUOTA_BYTES: 100 }, [
      { mailboxId: 'mailbox-a', deliveryKey: 'copy-a', bytes: 10 },
    ])).resolves.toEqual({ status: 'unavailable', reservations: [] });
    expect(batches).toHaveLength(2);
    expect(batches[1][0].query).toContain('UPDATE mailbox_reservations');
  });

  it('still reserves an atomic draft slot when the byte quota is disabled', async () => {
    const { db, batches } = mockDb(async (_call, statements) =>
      statements.map(() => ({ meta: { changes: 1 } })));

    const result = await reserveMailboxStorage(db, { MAILBOX_STORAGE_QUOTA_BYTES: 0 }, [{
      mailboxId: 'mailbox-a',
      deliveryKey: 'draft-a',
      bytes: 25,
      draftOwnerId: 'user-a',
      draftRowLimit: 100,
    }]);

    expect(result.status).toBe('accepted');
    expect(batches[0][0].values.slice(2, 8)).toEqual(['draft', 'mailbox-a', 'user-a', 100, 25, 0]);
  });
});
