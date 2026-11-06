import { describe, expect, it, vi } from 'vitest';
import { applyDeliveryEvent, type DeliveryEvent } from './delivery-events';
import { bounceAdvice, bounceNoticeContent, deliverBounceNotices, derivedId, enhancedCode, type SentCopy } from './bounce-notice';
import { migratedDatabase } from './testing/sqlite-d1';

// Every address, domain and ID here is a fixture.

function bounceEvent(overrides: Partial<DeliveryEvent> = {}): DeliveryEvent {
  return {
    eventId: 'event-1',
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
    reason: null,
    rejectionParty: null,
    ...overrides,
  };
}

const copy: SentCopy = {
  id: 'message-1',
  mailbox_id: 'mailbox-1',
  from_address: 'sender@example.test',
  from_name: 'Sender',
  to_addresses: '["missing@example.net"]',
  cc_addresses: '[]',
  subject: 'Quarterly report',
  thread_id: 'thread-1',
  received_at: '2026-11-06 01:01:40',
};

function setup({ withSentCopy = true } = {}) {
  const { d1, sqlite } = migratedDatabase();
  sqlite.prepare("INSERT INTO mailboxes (id, address, type) VALUES ('mailbox-1', 'sender@example.test', 'shared')").run();
  sqlite.prepare(
    `INSERT INTO mail_trace (trace_id, provider_message_ids, direction, status, envelope_from, envelope_to)
     VALUES ('trace-1', '["provider-1"]', 'outbound', 'sent', 'sender@example.test', 'missing@example.net')`,
  ).run();
  if (withSentCopy) {
    sqlite.prepare(
      `INSERT INTO messages (id, mailbox_id, provider_message_ids, direction, from_address, to_addresses, subject, thread_id, folder)
       VALUES ('message-1', 'mailbox-1', '["provider-1"]', 'outbound', 'sender@example.test', '["missing@example.net"]', 'Quarterly report', 'thread-1', 'sent')`,
    ).run();
  }
  const objects = new Map<string, string>();
  const storage = {
    put: vi.fn(async (key: string, value: string) => { objects.set(key, value); }),
    delete: vi.fn(async (key: string) => { objects.delete(key); }),
  } as unknown as R2Bucket;
  const inbox = () => sqlite.prepare(
    `SELECT id, direction, from_address, from_name, to_addresses, subject, folder, is_read, importance, thread_id, body_r2_key
     FROM messages WHERE folder = 'inbox'`,
  ).all() as Record<string, unknown>[];
  return { d1, sqlite, storage, objects, inbox };
}

describe('Undeliverable notice (real migrations)', () => {
  it('puts one notice in the sender mailbox Inbox, threaded with the Sent copy', async () => {
    const { d1, storage, objects, inbox } = setup();
    const onNotice = vi.fn(async () => {});
    expect(await applyDeliveryEvent(d1, bounceEvent(), { storage, onNotice })).toBe('stored');
    const notices = inbox();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      direction: 'internal',
      from_address: 'mailer-daemon@example.test',
      from_name: 'Mail Delivery System',
      to_addresses: '["sender@example.test"]',
      subject: 'Undeliverable: Quarterly report',
      folder: 'inbox',
      is_read: 0,
      importance: 'high',
      thread_id: 'thread-1',
    });
    expect(onNotice).toHaveBeenCalledWith('mailbox-1', notices[0].id);
    const body = objects.get(String(notices[0].body_r2_key));
    expect(body).toContain('missing@example.net');
    expect(body).toContain('5.1.1');
    expect(body).toContain('How to fix it');
  });

  it('makes no second notice for a redelivered event', async () => {
    const { d1, storage, inbox } = setup();
    const onNotice = vi.fn(async () => {});
    await applyDeliveryEvent(d1, bounceEvent(), { storage, onNotice });
    expect(await applyDeliveryEvent(d1, bounceEvent(), { storage, onNotice })).toBe('duplicate');
    expect(inbox()).toHaveLength(1);
    expect(onNotice).toHaveBeenCalledOnce();
  });

  it('waits for the Sent copy while the queue can retry, then stores the event alone', async () => {
    const { d1, inbox, storage, sqlite } = setup({ withSentCopy: false });
    expect(await applyDeliveryEvent(d1, bounceEvent(), { storage, waitForSentCopy: true })).toBe('unmatched');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM delivery_events').get()).toEqual({ n: 0 });
    expect(await applyDeliveryEvent(d1, bounceEvent(), { storage, waitForSentCopy: false })).toBe('stored');
    expect(inbox()).toHaveLength(0);
  });

  it('never brings back a notice the user deleted', async () => {
    const { d1, sqlite, storage, inbox } = setup();
    const onNotice = vi.fn(async () => {});
    await applyDeliveryEvent(d1, bounceEvent(), { storage, onNotice });
    sqlite.prepare("DELETE FROM messages WHERE folder = 'inbox'").run();
    await applyDeliveryEvent(d1, bounceEvent(), { storage, onNotice });
    expect(inbox()).toHaveLength(0);
    expect(onNotice).toHaveBeenCalledOnce();
  });

  it('removes the stored body when the mailbox is gone', async () => {
    const { d1, storage, objects } = setup();
    const created = await deliverBounceNotices({ DB: d1, STORAGE: storage }, bounceEvent(), [{ ...copy, mailbox_id: 'mailbox-gone' }]);
    expect(created).toEqual([]);
    expect(objects.size).toBe(0);
  });

  it('makes no notice for a delivery, a deferral or without storage', async () => {
    const { d1, storage, inbox } = setup();
    await applyDeliveryEvent(d1, bounceEvent({ eventId: 'e-ok', type: 'delivered', bounceType: null }), { storage });
    await applyDeliveryEvent(d1, bounceEvent({ eventId: 'e-later', type: 'deferred', terminal: false }), { storage });
    await applyDeliveryEvent(d1, bounceEvent({ eventId: 'e-bare' }));
    expect(inbox()).toHaveLength(0);
  });
});

describe('notice content', () => {
  it('escapes everything the provider or sender supplied', () => {
    const { html, subject } = bounceNoticeContent(
      bounceEvent({ smtpResponse: '550 <script>alert(1)</script>', reason: '"><img src=x onerror=alert(1)>' }),
      { ...copy, subject: '<b>Hi</b>' },
      '2026-11-06T01:03:00.000Z',
    );
    expect(html).not.toMatch(/<script|<img|<b>Hi/i);
    expect(html).toContain('&lt;script&gt;');
    expect(subject).toBe('Undeliverable: <b>Hi</b>');
  });

  it('lists the admin details and hops it has, and skips what it lacks', () => {
    const { html } = bounceNoticeContent(bounceEvent(), copy, '2026-11-06T01:03:00.000Z');
    for (const text of ['More info for email admins', 'Original message details', 'Error details', 'Message hops',
      'sender@example.test', 'Quarterly report', 'Example Mail', '1.8 s', 'Fri, 06 Nov 2026 01:01:40 UTC']) {
      expect(html).toContain(text);
    }
    expect(bounceNoticeContent(bounceEvent({ provider: null }), copy, '2026-11-06T01:03:00.000Z').html)
      .not.toContain('Receiving provider');
  });
});

describe('bounceAdvice', () => {
  const advice = (overrides: Partial<DeliveryEvent>) => bounceAdvice(bounceEvent(overrides));

  it('reads an unknown address as the sender\'s fix', () => {
    expect(advice({})).toMatchObject({ owner: 'sender' });
    expect(advice({}).cause).toContain("wasn't found");
    expect(advice({ smtpStatus: '5.4.1', smtpResponse: '550 5.4.1 Recipient address rejected: Access denied.' }).cause)
      .toContain("wasn't found");
  });

  it('covers full mailboxes, size, authentication, spam and policy', () => {
    expect(advice({ smtpStatus: '5.2.2', smtpResponse: '552 5.2.2 Mailbox full' }).cause).toContain('full');
    expect(advice({ smtpStatus: '5.3.4', smtpResponse: '552 5.3.4 Message too big' })).toMatchObject({ owner: 'sender' });
    expect(advice({ smtpStatus: '5.7.23', smtpResponse: '550 5.7.23 SPF fail' }).cause).toContain('SPF');
    expect(advice({ smtpStatus: '5.7.1', smtpResponse: '550 5.7.1 Message rejected as spam' }).cause).toContain('spam');
    expect(advice({ smtpStatus: '5.7.1', smtpResponse: '550 5.7.1 Delivery not authorized' })).toMatchObject({ owner: 'recipient' });
  });

  it('reads soft bounces, failures and suppression', () => {
    expect(advice({ bounceType: 'soft', smtpStatus: '4.4.7', smtpResponse: 'Message expired' }).cause).toContain('temporary');
    expect(advice({ type: 'failed', smtpStatus: null, smtpResponse: null })).toMatchObject({ owner: 'service' });
    expect(advice({ type: 'rejected', smtpStatus: null, smtpResponse: null }).cause).toContain('suppression');
  });
});

describe('helpers', () => {
  it('finds the enhanced status code in the status or the reply', () => {
    expect(enhancedCode({ smtpStatus: '550', smtpResponse: '550 5.4.1 Access denied' })).toBe('5.4.1');
    expect(enhancedCode({ smtpStatus: '5.1.10', smtpResponse: null })).toBe('5.1.10');
    expect(enhancedCode({ smtpStatus: null, smtpResponse: 'no code here' })).toBeNull();
  });

  it('derives a stable UUID-shaped ID', async () => {
    const first = await derivedId('seed');
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await derivedId('seed')).toBe(first);
    expect(await derivedId('other')).not.toBe(first);
  });
});
