import { describe, expect, it } from 'vitest';
import { loadDeliveryBadges } from './delivery-badges';
import { listBadge, deliveryStatus } from '#lib/mail/delivery-status.js';
import { createFixture } from './mcp/testing/harness';

function sent(id: string, providerIds: string[], extra: Partial<Record<'failed_recipients' | 'to_addresses', string>> = {}) {
  return {
    id,
    direction: 'outbound' as const,
    provider_message_ids: JSON.stringify(providerIds),
    failed_recipients: extra.failed_recipients ?? '[]',
    to_addresses: extra.to_addresses ?? '["one@example.net"]',
    cc_addresses: '[]',
    bcc_addresses: '[]',
  };
}

function seedEvents(fixture: ReturnType<typeof createFixture>, rows: Array<[string, string, string, number]>) {
  fixture.db.sqlite.exec(`INSERT INTO mail_trace (trace_id, direction, timestamp, status) VALUES ('trace-1', 'outbound', datetime('now'), 'sent')`);
  const insert = fixture.db.sqlite.prepare(
    `INSERT INTO delivery_events (event_id, trace_id, provider_message_id, recipient, event_type, terminal, event_timestamp)
     VALUES (?, 'trace-1', ?, ?, ?, ?, ?)`,
  );
  rows.forEach(([providerId, recipient, type, terminal], index) => {
    insert.run(`event-${index}`, providerId, recipient, type, terminal, `2026-11-08T0${index}:00:00Z`);
  });
}

describe('loadDeliveryBadges', () => {
  it('tags delivered, bounced and delayed sends in one lookup', async () => {
    const fixture = createFixture();
    seedEvents(fixture, [
      ['p-ok', 'one@example.net', 'delivered', 1],
      ['p-bad', 'one@example.net', 'bounced', 1],
      ['p-slow', 'one@example.net', 'deferred', 0],
    ]);
    const badges = await loadDeliveryBadges(fixture.db.d1, [
      sent('m-ok', ['p-ok']), sent('m-bad', ['p-bad']), sent('m-slow', ['p-slow']), sent('m-none', ['p-unknown']),
    ]);
    expect(badges['m-ok']).toEqual({ text: 'Delivered', title: 'Delivered', tone: 'ok' });
    expect(badges['m-bad']).toMatchObject({ text: 'Bounced', tone: 'danger' });
    expect(badges['m-slow']).toMatchObject({ text: 'Delayed', tone: 'warning' });
    expect(badges['m-none']).toBeUndefined();
  });

  it('marks a send refused at send time as bounced without a lookup', async () => {
    const fixture = createFixture();
    const badges = await loadDeliveryBadges(fixture.db.d1, [sent('m-1', [], { failed_recipients: '["one@example.net"]' })]);
    expect(badges['m-1']).toMatchObject({ text: 'Bounced', tone: 'danger', title: 'Not delivered' });
    const partial = await loadDeliveryBadges(fixture.db.d1, [
      sent('m-2', [], { failed_recipients: '["one@example.net"]', to_addresses: '["one@example.net","two@example.net"]' }),
    ]);
    expect(partial['m-2'].title).toBe('Not delivered to 1 of 2');
  });

  it('reads a delay that later arrived as delivered, with a repeated id', async () => {
    const fixture = createFixture();
    seedEvents(fixture, [
      ['p-1', 'one@example.net', 'deferred', 0],
      ['p-1', 'one@example.net', 'delivered', 1],
    ]);
    const badges = await loadDeliveryBadges(fixture.db.d1, [sent('m-1', ['p-1', 'p-1'])]);
    expect(badges['m-1']).toMatchObject({ text: 'Delivered', tone: 'ok' });
  });

  it('skips inbound mail and survives a failed lookup', async () => {
    const fixture = createFixture();
    const inbound = { ...sent('m-in', ['p-1']), direction: 'inbound' as const };
    expect(await loadDeliveryBadges(fixture.db.d1, [inbound])).toEqual({});
    const broken = { prepare() { throw new Error('down'); } } as unknown as D1Database;
    expect(await loadDeliveryBadges(broken, [sent('m-1', ['p-1'])])).toEqual({});
  });

  it('keeps the partial picture in the title', async () => {
    const fixture = createFixture();
    seedEvents(fixture, [['p-1', 'one@example.net', 'delivered', 1]]);
    const badges = await loadDeliveryBadges(fixture.db.d1, [
      sent('m-1', ['p-1'], { to_addresses: '["one@example.net","two@example.net"]' }),
    ]);
    expect(badges['m-1']).toEqual({ text: 'Delivered', title: 'Delivered to 1 of 2', tone: 'ok' });
  });
});

describe('listBadge', () => {
  it('is empty without a status and names a spam report', () => {
    expect(listBadge(null)).toBeNull();
    const status = deliveryStatus([{
      recipient: 'one@example.net', event_type: 'complained', terminal: 1, bounce_type: null,
      smtp_status: null, smtp_response: null, reason: null, delivery_time_ms: null, occurred_at: '2026-11-08 01:00:00',
    }], 1);
    expect(listBadge(status)).toMatchObject({ text: 'Spam report', tone: 'warning' });
  });
});
