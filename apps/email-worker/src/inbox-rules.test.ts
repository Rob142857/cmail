import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboxRuleRow } from '@cmail/shared/inbox-rules';
import { GUARDS_OFF, deliverInbound, deliveryDatabase, insertedRow, memoryStorage, type Statement } from './testing/delivery';

const pushMocks = vi.hoisted(() => ({ sendNewMailNotifications: vi.fn(async () => ({})) }));
vi.mock('@cmail/shared/push', async (original) => ({
  ...(await original<typeof import('@cmail/shared/push')>()),
  sendNewMailNotifications: pushMocks.sendNewMailNotifications,
}));

const { default: worker, inboxRuleTraceDetail } = await import('./index');

function rulesDatabase(options: { rules?: InboxRuleRow[]; rulesFail?: boolean; blockSender?: boolean } = {}) {
  return deliveryDatabase({
    all(query) {
      if (query.includes('FROM inbox_rules')) {
        if (options.rulesFail) throw new Error('D1_ERROR: no such table: inbox_rules');
        return { results: options.rules ?? [] };
      }
      if (query.includes('FROM sender_rules') && options.blockSender) {
        return { results: [{ pattern: 'partner.example', action: 'block' }] };
      }
      return undefined;
    },
  });
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
  const { storage } = memoryStorage();
  const { error, message } = await deliverInbound(worker, raw, { DB: database, STORAGE: storage, ...GUARDS_OFF });
  expect(error).toBeNull();
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
    const db = rulesDatabase();
    await deliver(db.database);
    expect(insertedMessage(db.batched)).toMatchObject({ folder: 'inbox', is_read: 0, is_starred: 0, importance: 'normal' });
    expect(traceDetail(db.statements)).toBe('OK');
    expect(pushMocks.sendNewMailNotifications).toHaveBeenCalledTimes(1);
  });

  it('files, marks read, stars and sets importance as the rules say, and records it in the trace', async () => {
    const db = rulesDatabase({
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
    const db = rulesDatabase({
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
    const db = rulesDatabase({
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
      const db = rulesDatabase({ rulesFail: true });
      await deliver(db.database);
      expect(insertedMessage(db.batched)).toMatchObject({ folder: 'inbox', is_read: 0 });
      expect(error).toHaveBeenCalledWith('Inbox rules were skipped for a delivery');
      expect(pushMocks.sendNewMailNotifications).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });

  it('ignores a stored rule that no longer validates and still runs the others', async () => {
    const db = rulesDatabase({
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
