import { describe, expect, it } from 'vitest';
import { MERGE_LATE_DELIVERY_FAILURES_SQL } from './outbound-journal';
import { createFixture } from './mcp/testing/harness';

// The Sent-copy merge runs on the real migrated schema, so json_each, UNION
// and the delivery_events foreign key behave as they do on D1.

function setup(failedRecipients = '[]') {
  const fixture = createFixture();
  fixture.db.sqlite.exec(`
    INSERT INTO mail_trace (trace_id, provider_message_ids, direction, status)
      VALUES ('trace-1', '["provider-1"]', 'outbound', 'sent');
    INSERT INTO messages (id, mailbox_id, provider_message_ids, failed_recipients, direction, from_address, folder)
      VALUES ('sent-1', 'mb-alice', '["provider-1"]', '${failedRecipients}', 'outbound', 'alice@example.test', 'sent');
  `);
  const addEvent = (eventId: string, recipient: string, eventType: string, terminal: number) => fixture.db.sqlite.prepare(
    `INSERT INTO delivery_events (event_id, trace_id, provider_message_id, recipient, event_type, terminal)
     VALUES (?, 'trace-1', 'provider-1', ?, ?, ?)`,
  ).run(eventId, recipient, eventType, terminal);
  const merge = () => fixture.db.d1.prepare(MERGE_LATE_DELIVERY_FAILURES_SQL).bind('sent-1').run();
  const failed = () => JSON.parse((fixture.db.sqlite.prepare(
    `SELECT failed_recipients FROM messages WHERE id = 'sent-1'`,
  ).get() as { failed_recipients: string }).failed_recipients) as string[];
  return { addEvent, merge, failed };
}

describe('merging stored bounces into a new Sent copy', () => {
  it('adds terminal failures and keeps the ones already listed', async () => {
    const { addEvent, merge, failed } = setup('["first@example.net"]');
    addEvent('e1', 'late@example.net', 'bounced', 1);
    addEvent('e2', 'first@example.net', 'failed', 1);
    expect((await merge()).meta.changes).toBe(1);
    expect(failed().sort()).toEqual(['first@example.net', 'late@example.net']);
  });

  it('ignores deliveries, complaints and non-terminal events', async () => {
    const { addEvent, merge, failed } = setup();
    addEvent('e1', 'ok@example.net', 'delivered', 1);
    addEvent('e2', 'spam@example.net', 'complained', 1);
    addEvent('e3', 'retry@example.net', 'deferred', 0);
    addEvent('e4', 'soft@example.net', 'bounced', 0);
    expect((await merge()).meta.changes).toBe(0);
    expect(failed()).toEqual([]);
  });

  it('is a no-op once every failure is listed', async () => {
    const { addEvent, merge, failed } = setup();
    addEvent('e1', 'late@example.net', 'rejected', 1);
    await merge();
    expect((await merge()).meta.changes).toBe(0);
    expect(failed()).toEqual(['late@example.net']);
  });
});
