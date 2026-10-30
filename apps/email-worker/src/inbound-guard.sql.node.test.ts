import { describe, expect, it } from 'vitest';
import { releaseInboundReservation, reserveInboundDelivery, type InboundGuardEnv } from './inbound-guard';
import { migratedDatabase } from './testing/sqlite-d1';

// The inbound limits are enforced by the BEFORE INSERT trigger on
// mailbox_reservations (migration 0001), not by JavaScript. These tests run
// the real reservation SQL against every real migration.

const HASH_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const LIMITS_OFF = {
  INBOUND_MAILBOX_MESSAGES_PER_HOUR: 0,
  INBOUND_MAILBOX_BYTES_PER_HOUR: 0,
  INBOUND_SENDER_MESSAGES_PER_HOUR: 0,
  MAILBOX_STORAGE_QUOTA_BYTES: 0,
};

function setup(limits: Partial<InboundGuardEnv>) {
  const { d1, sqlite } = migratedDatabase();
  sqlite.prepare("INSERT INTO mailboxes (id, address, type) VALUES ('mailbox-1', 'mailbox@example.test', 'shared')").run();
  const env = { DB: d1, INBOUND_SENDER_HASH_KEY: HASH_KEY, ...LIMITS_OFF, ...limits } as InboundGuardEnv;
  const reserve = (deliveryKey: string, messageBytes = 10, senderAddress = 'sender@example.test') =>
    reserveInboundDelivery(env, { mailboxId: 'mailbox-1', senderAddress, deliveryKey, messageBytes });
  return { d1, sqlite, reserve };
}

describe('inbound reservation SQL (real migrations)', () => {
  it('enforces the hourly message count per mailbox', async () => {
    const { reserve } = setup({ INBOUND_MAILBOX_MESSAGES_PER_HOUR: 2 });
    expect((await reserve('m1')).status).toBe('accepted');
    expect((await reserve('m2')).status).toBe('accepted');
    expect((await reserve('m3')).status).toBe('rejected');
  });

  it('enforces the hourly byte budget, allowing exactly the limit', async () => {
    const { reserve } = setup({ INBOUND_MAILBOX_BYTES_PER_HOUR: 100 });
    expect((await reserve('b1', 60)).status).toBe('accepted');
    expect((await reserve('b2', 40)).status).toBe('accepted');
    expect((await reserve('b3', 1)).status).toBe('rejected');
  });

  it('limits each sender separately, keyed by the sender hash', async () => {
    const { reserve, sqlite } = setup({ INBOUND_SENDER_MESSAGES_PER_HOUR: 1 });
    expect((await reserve('s1', 10, 'first@example.test')).status).toBe('accepted');
    expect((await reserve('s2', 10, 'first@example.test')).status).toBe('rejected');
    expect((await reserve('s3', 10, 'second@example.test')).status).toBe('accepted');
    // The address itself never reaches the table.
    const hashes = sqlite.prepare('SELECT sender_hash FROM mailbox_reservations').all() as Array<{ sender_hash: string }>;
    expect(hashes.every((row) => /^[0-9a-f]{64}$/.test(row.sender_hash))).toBe(true);
  });

  it('counts only the last hour', async () => {
    const { reserve, sqlite } = setup({ INBOUND_MAILBOX_MESSAGES_PER_HOUR: 1 });
    sqlite.prepare(
      `INSERT INTO mailbox_reservations (id, delivery_key, mailbox_id, message_bytes, mailbox_message_limit, mailbox_byte_limit,
         sender_message_limit, storage_quota_bytes, storage_pending, pending_expires_at, created_epoch)
       VALUES ('old', NULL, 'mailbox-1', 10, 1, 0, 0, 0, 0, 0, unixepoch() - 3601)`,
    ).run();
    expect((await reserve('fresh')).status).toBe('accepted');
  });

  it('charges pending deliveries and stored mail against the storage quota until released', async () => {
    const { reserve, d1, sqlite } = setup({ MAILBOX_STORAGE_QUOTA_BYTES: 100 });
    const first = await reserve('q1', 80);
    expect(first.status).toBe('accepted');
    // 80 pending + 30 would exceed 100.
    expect((await reserve('q2', 30)).status).toBe('rejected');
    // A failed delivery releases its pending charge.
    await releaseInboundReservation(d1, first.reservationId);
    expect((await reserve('q3', 30)).status).toBe('accepted');

    // Stored messages count too.
    sqlite.prepare(
      `INSERT INTO messages (id, mailbox_id, direction, from_address, to_addresses, subject, snippet, body_r2_key, size_bytes, folder)
       VALUES ('stored-1', 'mailbox-1', 'inbound', 'a@example.test', '[]', 's', 's', 'k', 60, 'inbox')`,
    ).run();
    // 30 pending + 60 stored + 11 = 101.
    expect((await reserve('q4', 11)).status).toBe('rejected');
    expect((await reserve('q5', 10)).status).toBe('accepted');
  });

  it('turns a pending charge into the stored message when the message row is inserted', async () => {
    const { reserve, sqlite } = setup({ MAILBOX_STORAGE_QUOTA_BYTES: 1000 });
    const reservation = await reserve('message-9', 50);
    sqlite.prepare(
      `INSERT INTO messages (id, mailbox_id, direction, from_address, to_addresses, subject, snippet, body_r2_key, size_bytes, folder)
       VALUES ('message-9', 'mailbox-1', 'inbound', 'a@example.test', '[]', 's', 's', 'k', 50, 'inbox')`,
    ).run();
    const row = sqlite.prepare('SELECT storage_pending FROM mailbox_reservations WHERE id = ?').get(reservation.reservationId!) as { storage_pending: number };
    expect(row.storage_pending).toBe(0);
  });

  it('reports a second delivery of the same key as a duplicate', async () => {
    const { reserve } = setup({ INBOUND_MAILBOX_MESSAGES_PER_HOUR: 10 });
    expect((await reserve('same-key')).status).toBe('accepted');
    expect(await reserve('same-key')).toEqual({ status: 'duplicate', reservationId: null });
  });

  it('lets a retry through once a failed delivery has released its key', async () => {
    const { reserve, d1 } = setup({ INBOUND_MAILBOX_MESSAGES_PER_HOUR: 10 });
    const first = await reserve('retry-key');
    await releaseInboundReservation(d1, first.reservationId);
    expect((await reserve('retry-key')).status).toBe('accepted');
  });
});
