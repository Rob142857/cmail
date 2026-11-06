import { describe, expect, it, vi } from 'vitest';
import {
  UNMATCHED_RETRY_ATTEMPTS,
  UNMATCHED_RETRY_DELAY_SECONDS,
  applyDeliveryEvent,
  errorRetryDelaySeconds,
  handleDeliveryEventBatch,
  isDeliveryFailure,
  parseDeliveryEvent,
} from './delivery-events';
import { migratedDatabase } from './testing/sqlite-d1';

// Email Sending event payloads follow the Cloudflare event-subscription
// reference; every address and ID here is a fixture.

function sendingEvent(type: string, overrides: Record<string, unknown> = {}, payloadOverrides: Record<string, unknown> = {}) {
  return {
    type: `cf.email.sending.message.${type}`,
    source: { type: 'email.sending', zoneId: 'zone-fixture', domain: 'send.example.test' },
    payload: {
      eventId: `event-${type}`,
      messageId: 'provider-1',
      sender: 'sender@example.test',
      recipient: 'Missing@Example.net',
      subject: 'Fixture subject',
      terminal: type !== 'deferred',
      delivery: {
        status: type,
        smtpStatusCode: '550',
        smtpEnhancedStatusCode: '5.1.1',
        smtpResponse: '550 5.1.1 User unknown',
        deliveryTimeMs: 1840,
        provider: 'Example Mail',
      },
      ...(type === 'bounced' ? { bounce: { type: 'hard', classification: 'permanent_failure', reason: '550 5.1.1 User unknown' } } : {}),
      ...payloadOverrides,
    },
    metadata: { eventSchemaVersion: 1, eventTimestamp: '2026-11-06T01:02:03.000Z' },
    ...overrides,
  };
}

function setup() {
  const { d1, sqlite } = migratedDatabase();
  sqlite.prepare("INSERT INTO mailboxes (id, address, type) VALUES ('mailbox-1', 'sender@example.test', 'shared')").run();
  sqlite.prepare(
    `INSERT INTO mail_trace (trace_id, message_id_header, provider_message_ids, direction, status, envelope_from, envelope_to)
     VALUES ('trace-1', NULL, '["provider-1"]', 'outbound', 'sent', 'sender@example.test', 'missing@example.net')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO messages (id, mailbox_id, message_id_header, provider_message_ids, direction, from_address, folder)
     VALUES ('message-1', 'mailbox-1', NULL, '["provider-1"]', 'outbound', 'sender@example.test', 'sent')`,
  ).run();
  const failedOn = (table: 'mail_trace' | 'messages', id: string) => JSON.parse(
    (sqlite.prepare(`SELECT failed_recipients FROM ${table} WHERE ${table === 'mail_trace' ? 'trace_id' : 'id'} = ?`).get(id) as { failed_recipients: string }).failed_recipients,
  ) as string[];
  const eventCount = () => Number((sqlite.prepare('SELECT COUNT(*) AS n FROM delivery_events').get() as { n: number }).n);
  return { d1, sqlite, failedOn, eventCount };
}

function queueMessage(body: unknown, attempts = 1) {
  return { id: 'q', timestamp: new Date(), body, attempts, ack: vi.fn(), retry: vi.fn() };
}

function envOf(db: D1Database) {
  const objects = new Map<string, string>();
  const STORAGE = { put: vi.fn(async (key: string, value: string) => { objects.set(key, value); }) } as unknown as R2Bucket;
  return { DB: db, STORAGE, objects };
}

function batchOf(...messages: ReturnType<typeof queueMessage>[]) {
  return { queue: 'cmail-email-events', messages, ackAll: vi.fn(), retryAll: vi.fn() } as unknown as MessageBatch<unknown>;
}

describe('parseDeliveryEvent', () => {
  it('reads a bounce event and lower-cases the recipient', () => {
    expect(parseDeliveryEvent(sendingEvent('bounced'))).toEqual({
      eventId: 'event-bounced',
      providerMessageId: 'provider-1',
      recipient: 'missing@example.net',
      type: 'bounced',
      terminal: true,
      bounceType: 'hard',
      smtpStatus: '5.1.1',
      smtpResponse: '550 5.1.1 User unknown',
      eventTimestamp: '2026-11-06T01:02:03.000Z',
      deliveryTimeMs: 1840,
      provider: 'Example Mail',
      bounceClassification: 'permanent_failure',
      reason: '550 5.1.1 User unknown',
      rejectionParty: null,
    });
  });

  it('reads failure and rejection reasons and drops a bad delivery time', () => {
    const failed = parseDeliveryEvent(sendingEvent('failed', {}, {
      delivery: { status: 'failed', deliveryTimeMs: -5 },
      failure: { reason: 'Internal\r\nerror' },
    }));
    expect(failed).toMatchObject({ reason: 'Internal error', deliveryTimeMs: null, provider: null, smtpResponse: null });
    const rejected = parseDeliveryEvent(sendingEvent('rejected', {}, {
      delivery: { status: 'rejected', deliveryTimeMs: Number.NaN },
      rejection: { reason: 'suppressed', party: 'sender', detail: 'Recipient is on the suppression list' },
    }));
    expect(rejected).toMatchObject({
      reason: 'suppressed: Recipient is on the suppression list',
      rejectionParty: 'sender',
      deliveryTimeMs: null,
    });
  });

  it('rejects other sources, unknown types and malformed payloads', () => {
    expect(parseDeliveryEvent(sendingEvent('bounced', { source: { type: 'kv' } }))).toBeNull();
    expect(parseDeliveryEvent(sendingEvent('opened'))).toBeNull();
    expect(parseDeliveryEvent(sendingEvent('bounced', {}, { eventId: '' }))).toBeNull();
    expect(parseDeliveryEvent(sendingEvent('bounced', {}, { messageId: 'a b' }))).toBeNull();
    expect(parseDeliveryEvent(sendingEvent('bounced', {}, { recipient: 'not-an-address' }))).toBeNull();
    expect(parseDeliveryEvent(sendingEvent('bounced', {}, { recipient: 'a@b@example.net' }))).toBeNull();
    expect(parseDeliveryEvent(null)).toBeNull();
    expect(parseDeliveryEvent('text')).toBeNull();
  });

  it('strips control characters and bounds the SMTP response', () => {
    const event = parseDeliveryEvent(sendingEvent('bounced', {}, {
      delivery: { smtpResponse: `550\r\nInjected ${'x'.repeat(600)}` },
    }));
    expect(event?.smtpResponse).toMatch(/^550 Injected x+$/);
    expect(event?.smtpResponse?.length).toBe(500);
    expect(event?.smtpStatus).toBeNull();
  });

  it('counts only terminal bounced, failed and rejected events as failures', () => {
    expect(isDeliveryFailure({ type: 'bounced', terminal: true })).toBe(true);
    expect(isDeliveryFailure({ type: 'failed', terminal: true })).toBe(true);
    expect(isDeliveryFailure({ type: 'rejected', terminal: true })).toBe(true);
    expect(isDeliveryFailure({ type: 'bounced', terminal: false })).toBe(false);
    expect(isDeliveryFailure({ type: 'deferred', terminal: false })).toBe(false);
    expect(isDeliveryFailure({ type: 'complained', terminal: true })).toBe(false);
    expect(isDeliveryFailure({ type: 'delivered', terminal: true })).toBe(false);
  });
});

describe('applyDeliveryEvent (real migrations)', () => {
  it('stores a bounce and marks the recipient failed on the trace and the Sent copy', async () => {
    const { d1, sqlite, failedOn } = setup();
    const event = parseDeliveryEvent(sendingEvent('bounced'))!;
    expect(await applyDeliveryEvent(d1, event)).toBe('stored');
    expect(failedOn('mail_trace', 'trace-1')).toEqual(['missing@example.net']);
    expect(failedOn('messages', 'message-1')).toEqual(['missing@example.net']);
    expect(sqlite.prepare(
      `SELECT trace_id, event_type, terminal, bounce_type, smtp_status, delivery_time_ms, provider,
              bounce_classification, reason, rejection_party
       FROM delivery_events`,
    ).get()).toEqual({
      trace_id: 'trace-1', event_type: 'bounced', terminal: 1, bounce_type: 'hard', smtp_status: '5.1.1',
      delivery_time_ms: 1840, provider: 'Example Mail', bounce_classification: 'permanent_failure',
      reason: '550 5.1.1 User unknown', rejection_party: null,
    });
  });

  it('is a no-op for a redelivered event', async () => {
    const { d1, failedOn, eventCount } = setup();
    const event = parseDeliveryEvent(sendingEvent('bounced'))!;
    await applyDeliveryEvent(d1, event);
    expect(await applyDeliveryEvent(d1, event)).toBe('duplicate');
    expect(eventCount()).toBe(1);
    expect(failedOn('mail_trace', 'trace-1')).toEqual(['missing@example.net']);
    expect(failedOn('messages', 'message-1')).toEqual(['missing@example.net']);
  });

  it('does not add a recipient the send path already listed as failed', async () => {
    const { d1, sqlite, failedOn } = setup();
    sqlite.prepare(`UPDATE mail_trace SET failed_recipients = '["missing@example.net"]'`).run();
    await applyDeliveryEvent(d1, parseDeliveryEvent(sendingEvent('failed'))!);
    expect(failedOn('mail_trace', 'trace-1')).toEqual(['missing@example.net']);
  });

  it('records deliveries, deferrals and complaints without marking a failure', async () => {
    const { d1, failedOn, eventCount } = setup();
    for (const type of ['delivered', 'deferred', 'complained']) {
      expect(await applyDeliveryEvent(d1, parseDeliveryEvent(sendingEvent(type))!)).toBe('stored');
    }
    expect(eventCount()).toBe(3);
    expect(failedOn('mail_trace', 'trace-1')).toEqual([]);
    expect(failedOn('messages', 'message-1')).toEqual([]);
  });

  it('stores nothing for mail cmail did not send', async () => {
    const { d1, eventCount } = setup();
    const event = parseDeliveryEvent(sendingEvent('bounced', {}, { messageId: 'someone-else' }))!;
    expect(await applyDeliveryEvent(d1, event)).toBe('unmatched');
    expect(eventCount()).toBe(0);
  });

  it('ignores inbound traces and traces outside the match window', async () => {
    const { d1, sqlite, eventCount } = setup();
    sqlite.prepare(`UPDATE mail_trace SET direction = 'inbound'`).run();
    expect(await applyDeliveryEvent(d1, parseDeliveryEvent(sendingEvent('bounced'))!)).toBe('unmatched');
    sqlite.prepare(`UPDATE mail_trace SET direction = 'outbound', timestamp = datetime('now', '-40 days')`).run();
    expect(await applyDeliveryEvent(d1, parseDeliveryEvent(sendingEvent('bounced'))!)).toBe('unmatched');
    expect(eventCount()).toBe(0);
  });

  it('leaves Sent copies of other messages alone', async () => {
    const { d1, sqlite, failedOn } = setup();
    sqlite.prepare(
      `INSERT INTO messages (id, mailbox_id, message_id_header, provider_message_ids, direction, from_address, folder)
       VALUES ('message-2', 'mailbox-1', NULL, '["provider-other"]', 'outbound', 'sender@example.test', 'sent')`,
    ).run();
    await applyDeliveryEvent(d1, parseDeliveryEvent(sendingEvent('bounced'))!);
    expect(failedOn('messages', 'message-2')).toEqual([]);
  });

  it('finds the Sent copy after its mailbox is renamed, and skips older copies', async () => {
    const { d1, sqlite, failedOn } = setup();
    sqlite.prepare(`UPDATE mailboxes SET address = 'renamed@example.test' WHERE id = 'mailbox-1'`).run();
    sqlite.prepare(
      `INSERT INTO messages (id, mailbox_id, provider_message_ids, direction, from_address, folder, received_at)
       VALUES ('message-old', 'mailbox-1', '["provider-1"]', 'outbound', 'sender@example.test', 'sent', datetime('now', '-3 days')),
              ('message-inbound', 'mailbox-1', '["provider-1"]', 'inbound', 'sender@example.test', 'inbox', datetime('now'))`,
    ).run();
    await applyDeliveryEvent(d1, parseDeliveryEvent(sendingEvent('bounced'))!);
    expect(failedOn('messages', 'message-1')).toEqual(['missing@example.net']);
    expect(failedOn('messages', 'message-old')).toEqual([]);
    expect(failedOn('messages', 'message-inbound')).toEqual([]);
  });

  it('deletes events with their trace row', async () => {
    const { d1, sqlite, eventCount } = setup();
    await applyDeliveryEvent(d1, parseDeliveryEvent(sendingEvent('bounced'))!);
    sqlite.prepare(`DELETE FROM mail_trace WHERE trace_id = 'trace-1'`).run();
    expect(eventCount()).toBe(0);
  });
});

describe('errorRetryDelaySeconds', () => {
  it('backs off from 30 seconds to a 5 minute cap', () => {
    expect([1, 2, 3, 4, 5, 9].map(errorRetryDelaySeconds)).toEqual([30, 60, 120, 240, 300, 300]);
  });
});

describe('handleDeliveryEventBatch', () => {
  it('acks stored and invalid messages, and logs counts only', async () => {
    const { d1 } = setup();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const good = queueMessage(sendingEvent('bounced'));
    const bad = queueMessage({ type: 'nonsense' });
    const env = envOf(d1);
    await handleDeliveryEventBatch(batchOf(good, bad), env);
    expect(good.ack).toHaveBeenCalledOnce();
    expect(bad.ack).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('Delivery events processed', expect.objectContaining({ stored: 1, invalid: 1 }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/example\.net|provider-1/);
    // The bounce also left an Undeliverable notice in the sender's Inbox.
    expect(env.objects.size).toBe(1);
    log.mockRestore();
  });

  it('retries an unmatched event with a delay, then drops it', async () => {
    const { d1 } = setup();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const body = sendingEvent('bounced', {}, { messageId: 'not-yet-traced' });
    const early = queueMessage(body, 1);
    const third = queueMessage(body, UNMATCHED_RETRY_ATTEMPTS);
    const last = queueMessage(body, UNMATCHED_RETRY_ATTEMPTS + 1);
    await handleDeliveryEventBatch(batchOf(early, third, last), envOf(d1));
    expect(early.retry).toHaveBeenCalledWith({ delaySeconds: UNMATCHED_RETRY_DELAY_SECONDS });
    expect(third.retry).toHaveBeenCalledWith({ delaySeconds: UNMATCHED_RETRY_DELAY_SECONDS });
    expect(early.ack).not.toHaveBeenCalled();
    expect(last.ack).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it('retries when the database fails', async () => {
    const failing = { prepare: () => { throw new Error('D1 unavailable'); } } as unknown as D1Database;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const message = queueMessage(sendingEvent('bounced'));
    await handleDeliveryEventBatch(batchOf(message), envOf(failing));
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Delivery event failed', { error: 'Error' });
    log.mockRestore();
    error.mockRestore();
  });
});
