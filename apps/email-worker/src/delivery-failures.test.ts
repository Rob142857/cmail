import { describe, expect, it, vi } from 'vitest';

// Storage and database failures after an inbound message has been accepted:
// nothing half-written may stay behind, and the mailbox's pending quota
// charge must be released unless the message really was stored.

vi.mock('@cmail/shared/push', async (original) => ({
  ...(await original<typeof import('@cmail/shared/push')>()),
  sendNewMailNotifications: vi.fn(async () => ({})),
}));

const { default: worker } = await import('./index');

interface Statement {
  query: string;
  values: unknown[];
}

type Recheck = 'none' | 'ours' | 'another' | 'throws';

function failingDelivery(options: { failPut?: 'body' | 'attachment'; batchFails?: boolean; recheck?: Recheck } = {}) {
  const statements: Statement[] = [];
  const putKeys: string[] = [];
  const deletedKeys: string[] = [];
  let deliveryLookups = 0;

  const database = {
    prepare(query: string) {
      const statement: Statement & Record<string, unknown> = {
        query,
        values: [],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
        async first() {
          statements.push(statement);
          if (query.includes('FROM mailboxes')) return { id: 'mailbox-1', status: 'active' };
          if (query.includes('SELECT id, body_r2_key FROM messages')) {
            deliveryLookups += 1;
            // The first lookup is the duplicate check before any work starts.
            if (deliveryLookups === 1) return null;
            const recheck = options.recheck ?? 'none';
            if (recheck === 'throws') throw new Error('D1_ERROR: network connection lost');
            if (recheck === 'ours') return { id: 'message-1', body_r2_key: putKeys[0] };
            if (recheck === 'another') return { id: 'message-2', body_r2_key: 'messages/other/body' };
          }
          return null;
        },
        async all() {
          statements.push(statement);
          return { results: [] };
        },
        async run() {
          statements.push(statement);
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(list: Statement[]) {
      statements.push(...list);
      if (options.batchFails) throw new Error('D1_ERROR: database is locked');
      return list.map(() => ({ meta: { changes: 1 } }));
    },
  };

  const storage = {
    put: vi.fn(async (key: string) => {
      putKeys.push(key);
      const isBody = putKeys.length === 1;
      if ((options.failPut === 'body' && isBody) || (options.failPut === 'attachment' && !isBody)) {
        throw new Error('R2 put failed');
      }
    }),
    delete: vi.fn(async (key: string) => {
      deletedKeys.push(key);
    }),
  };

  const released = () => statements.some((statement) =>
    statement.query.includes('UPDATE mailbox_reservations') && statement.query.includes('storage_pending = 0'));
  const inserted = () => statements.some((statement) => statement.query.includes('INSERT INTO messages'));

  return { database, storage, statements, putKeys, deletedKeys, released, inserted };
}

const PLAIN = [
  'From: Ann Partner <ann@partner.example>',
  'To: mailbox@example.test',
  'Subject: Quarterly figures',
  'Message-ID: <figures-1@partner.example>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Figures attached next time.',
  '',
].join('\r\n');

const WITH_ATTACHMENT = [
  'From: Ann Partner <ann@partner.example>',
  'To: mailbox@example.test',
  'Subject: Quarterly figures',
  'Message-ID: <figures-2@partner.example>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Figures attached.',
  '--b1',
  'Content-Type: text/csv; name="figures.csv"',
  'Content-Disposition: attachment; filename="figures.csv"',
  '',
  'quarter,total',
  'q3,42',
  '--b1--',
  '',
].join('\r\n');

async function deliver(setup: ReturnType<typeof failingDelivery>, raw = PLAIN) {
  const messageIdHeader = /^Message-ID: (.*)$/m.exec(raw)?.[1] ?? '';
  const message = {
    from: 'bounce@partner.example',
    to: 'mailbox@example.test',
    rawSize: raw.length,
    headers: new Headers({ 'message-id': messageIdHeader }),
    raw: new Blob([raw]).stream(),
    setReject: vi.fn(),
    forward: vi.fn(),
    reply: vi.fn(),
  };
  const handler = worker as unknown as {
    email(value: unknown, environment: Record<string, unknown>, context: { waitUntil(promise: Promise<unknown>): void }): Promise<void>;
  };
  const run = handler.email(message, {
    DB: setup.database,
    STORAGE: setup.storage,
    // Any non-zero limit turns the reservation (and its pending quota charge) on.
    INBOUND_MAILBOX_MESSAGES_PER_HOUR: '100',
    INBOUND_MAILBOX_BYTES_PER_HOUR: '0',
    INBOUND_SENDER_MESSAGES_PER_HOUR: '0',
    MAILBOX_STORAGE_QUOTA_BYTES: '0',
  }, { waitUntil: () => undefined });
  return { run, message };
}

describe('inbound delivery after a storage failure', () => {
  it('stores and indexes a message normally, settling the reservation (control)', async () => {
    const setup = failingDelivery();
    const { run, message } = await deliver(setup);
    await run;
    expect(message.setReject).not.toHaveBeenCalled();
    expect(setup.inserted()).toBe(true);
    expect(setup.deletedKeys).toEqual([]);
    expect(setup.released()).toBe(false);
  });

  it('removes what was written, releases the reservation and fails when the body write fails', async () => {
    const setup = failingDelivery({ failPut: 'body' });
    const { run } = await deliver(setup);
    await expect(run).rejects.toThrow('R2 put failed');
    expect(setup.deletedKeys).toContain(setup.putKeys[0]);
    expect(setup.inserted()).toBe(false);
    expect(setup.released()).toBe(true);
  });

  it('removes the body too when an attachment write fails', async () => {
    const setup = failingDelivery({ failPut: 'attachment' });
    const { run } = await deliver(setup, WITH_ATTACHMENT);
    await expect(run).rejects.toThrow('R2 put failed');
    expect(setup.putKeys.length).toBe(2);
    expect(setup.deletedKeys).toEqual(expect.arrayContaining(setup.putKeys));
    expect(setup.inserted()).toBe(false);
    expect(setup.released()).toBe(true);
  });
});

describe('inbound delivery after the database write fails', () => {
  it('deletes the stored objects, releases the reservation and fails when nothing was committed', async () => {
    const setup = failingDelivery({ batchFails: true, recheck: 'none' });
    const { run } = await deliver(setup);
    await expect(run).rejects.toThrow('database is locked');
    expect(setup.deletedKeys).toEqual(expect.arrayContaining(setup.putKeys));
    expect(setup.released()).toBe(true);
  });

  it('keeps the stored objects when it cannot tell whether the write committed', async () => {
    const setup = failingDelivery({ batchFails: true, recheck: 'throws' });
    const { run } = await deliver(setup);
    await expect(run).rejects.toThrow('database is locked');
    expect(setup.deletedKeys).toEqual([]);
    expect(setup.released()).toBe(true);
  });

  it('treats the message as delivered when the recheck finds its own body key', async () => {
    const setup = failingDelivery({ batchFails: true, recheck: 'ours' });
    const { run, message } = await deliver(setup);
    await run;
    expect(message.setReject).not.toHaveBeenCalled();
    expect(setup.deletedKeys).toEqual([]);
    expect(setup.released()).toBe(false);
  });

  it('drops its own copy quietly when a concurrent delivery of the same Message-ID won', async () => {
    const setup = failingDelivery({ batchFails: true, recheck: 'another' });
    const { run, message } = await deliver(setup);
    await run;
    expect(message.setReject).not.toHaveBeenCalled();
    expect(setup.deletedKeys).toEqual(expect.arrayContaining(setup.putKeys));
    expect(setup.released()).toBe(true);
  });
});
