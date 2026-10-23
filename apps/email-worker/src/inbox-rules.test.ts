import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboxRuleRow } from '@cmail/shared/inbox-rules';

const pushMocks = vi.hoisted(() => ({ sendNewMailNotifications: vi.fn(async () => ({})) }));
vi.mock('@cmail/shared/push', async (original) => ({
  ...(await original<typeof import('@cmail/shared/push')>()),
  sendNewMailNotifications: pushMocks.sendNewMailNotifications,
}));

const { default: worker, inboxRuleTraceDetail } = await import('./index');

interface Statement {
  query: string;
  values: unknown[];
}

function deliveryDatabase(options: { rules?: InboxRuleRow[]; rulesFail?: boolean; blockSender?: boolean } = {}) {
  const statements: Statement[] = [];
  const batched: Statement[] = [];
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
          return query.includes('FROM mailboxes') ? { id: 'mailbox-1', status: 'active' } : null;
        },
        async all() {
          statements.push(statement);
          if (query.includes('FROM inbox_rules')) {
            if (options.rulesFail) throw new Error('D1_ERROR: no such table: inbox_rules');
            return { results: options.rules ?? [] };
          }
          if (query.includes('FROM sender_rules') && options.blockSender) {
            return { results: [{ pattern: 'partner.example', action: 'block' }] };
          }
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
      batched.push(...list);
      return list.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return { database, statements, batched };
}

/** Column name to value for an INSERT, matching literals as well as bound values. */
function insertedRow(statements: Statement[], table: string): Record<string, unknown> {
  const insert = statements.find((statement) => statement.query.includes(`INSERT INTO ${table}`));
  if (!insert) throw new Error(`Nothing was inserted into ${table}`);
  const columns = new RegExp(`INSERT INTO ${table} \\(([^)]*)\\)`).exec(insert.query)?.[1].split(',').map((column) => column.trim()) ?? [];
  const tokens = /VALUES \(([\s\S]*)\)\s*$/.exec(insert.query.trim())?.[1].split(/,\s*/) ?? [];
  const values = [...insert.values];
  return Object.fromEntries(columns.map((column, index) => [column, tokens[index] === '?' ? values.shift() : tokens[index]]));
}

function insertedMessage(batched: Statement[]): Record<string, unknown> {
  return insertedRow(batched, 'messages');
}

function rule(id: string, name: string, definition: Record<string, unknown>, stopProcessing = 1): InboxRuleRow {
  return { id, name, is_enabled: 1, stop_processing: stopProcessing, definition: JSON.stringify(definition) };
}

const RAW = [
  'From: Ann Partner <ann@partner.example>',
  'To: mailbox@example.test',
  'Subject: Weekly newsletter',
  'Message-ID: <weekly-1@partner.example>',
  'List-Id: Partner news <news.partner.example>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Read online, or unsubscribe at any time.',
  '',
].join('\r\n');

async function deliver(database: unknown, raw = RAW) {
  const headers = new Headers({ 'message-id': '<weekly-1@partner.example>' });
  const message = {
    from: 'bounce@partner.example',
    to: 'mailbox@example.test',
    rawSize: raw.length,
    headers,
    raw: new Blob([raw]).stream(),
    setReject: vi.fn(),
    forward: vi.fn(),
    reply: vi.fn(),
  };
  const handler = worker as unknown as {
    email(value: unknown, environment: Record<string, unknown>, context: { waitUntil(promise: Promise<unknown>): void }): Promise<void>;
  };
  await handler.email(message, {
    DB: database,
    STORAGE: { put: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) },
    INBOUND_MAILBOX_MESSAGES_PER_HOUR: '0',
    INBOUND_MAILBOX_BYTES_PER_HOUR: '0',
    INBOUND_SENDER_MESSAGES_PER_HOUR: '0',
    MAILBOX_STORAGE_QUOTA_BYTES: '0',
  }, { waitUntil: () => undefined });
  expect(message.setReject).not.toHaveBeenCalled();
}

function traceDetail(statements: Statement[]): unknown {
  return insertedRow(statements, 'mail_trace').status_detail;
}

afterEach(() => {
  pushMocks.sendNewMailNotifications.mockClear();
});

describe('inbox rules on inbound delivery', () => {
  it('delivers to the Inbox, unread, with an alert, when the mailbox has no rules', async () => {
    const db = deliveryDatabase();
    await deliver(db.database);
    expect(insertedMessage(db.batched)).toMatchObject({ folder: 'inbox', is_read: 0, is_starred: 0, importance: 'normal' });
    expect(traceDetail(db.statements)).toBe('OK');
    expect(pushMocks.sendNewMailNotifications).toHaveBeenCalledTimes(1);
  });

  it('files, marks read, stars and sets importance as the rules say, and records it in the trace', async () => {
    const db = deliveryDatabase({
      rules: [
        rule('r1', 'Newsletters', { conditions: { headerContains: ['list-id'] }, actions: { moveTo: 'archive', markAsRead: true } }, 0),
        rule('r2', 'Unsubscribe mail', { conditions: { bodyContains: ['UNSUBSCRIBE'] }, actions: { star: true, setImportance: 'low' } }),
        rule('r3', 'Never reached', { appliesToAll: true, actions: { moveTo: 'trash' } }),
      ],
    });
    await deliver(db.database);
    expect(insertedMessage(db.batched)).toMatchObject({ folder: 'archive', is_read: 1, is_starred: 1, importance: 'low' });
    expect(traceDetail(db.statements)).toBe('Inbox rules "Newsletters", "Unsubscribe mail": moved to Archive, marked read, starred');
    expect(pushMocks.sendNewMailNotifications).not.toHaveBeenCalled();
  });

  it('tests the To line as sent, not the Bcc fallback, for "I\'m not on the To line"', async () => {
    const db = deliveryDatabase({
      rules: [rule('r1', 'Not to me', { conditions: { myPosition: 'not-to' }, actions: { star: true } })],
    });
    await deliver(db.database, RAW.replace('To: mailbox@example.test', 'To: list@partner.example'));
    const inserted = insertedMessage(db.batched);
    expect(inserted).toMatchObject({ folder: 'inbox', is_starred: 1 });
    // The stored To line still gets the envelope recipient as its fallback.
    expect(inserted.to_addresses).toBe(JSON.stringify(['list@partner.example']));
    expect(pushMocks.sendNewMailNotifications).toHaveBeenCalledTimes(1);
  });

  it('never runs rules on mail the organisation quarantined', async () => {
    const db = deliveryDatabase({
      blockSender: true,
      rules: [rule('r1', 'Rescue', { appliesToAll: true, actions: { moveTo: 'archive' } })],
    });
    await deliver(db.database);
    expect(insertedMessage(db.batched)).toMatchObject({ folder: 'spam', quarantine_reason: 'blocked-sender' });
    expect(db.statements.some((statement) => statement.query.includes('FROM inbox_rules'))).toBe(false);
  });

  it('delivers normally when the rules cannot be read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const db = deliveryDatabase({ rulesFail: true });
      await deliver(db.database);
      expect(insertedMessage(db.batched)).toMatchObject({ folder: 'inbox', is_read: 0 });
      expect(error).toHaveBeenCalledWith('Inbox rules were skipped for a delivery');
      expect(pushMocks.sendNewMailNotifications).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });

  it('ignores a stored rule that no longer validates and still runs the others', async () => {
    const db = deliveryDatabase({
      rules: [
        { id: 'bad', name: 'Bad', is_enabled: 1, stop_processing: 1, definition: '{"appliesToAll":true,"actions":{"forwardTo":"x@evil.example"}}' },
        rule('good', 'Good', { conditions: { from: ['partner.example'] }, actions: { moveTo: 'trash' } }),
      ],
    });
    await deliver(db.database);
    expect(insertedMessage(db.batched)).toMatchObject({ folder: 'trash' });
  });
});

describe('inboxRuleTraceDetail', () => {
  it('names the rules even when they changed nothing visible', () => {
    expect(inboxRuleTraceDetail({
      folder: 'inbox',
      isRead: false,
      isStarred: false,
      importance: 'high',
      applied: [{ id: 'a', name: 'Boss' }],
    })).toBe('Inbox rules "Boss"');
  });
});
