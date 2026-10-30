import { describe, expect, it, vi } from 'vitest';
import { GUARDS_OFF, deliverInbound, deliveryDatabase, memoryStorage } from './testing/delivery';

// Storage and database failures after an inbound message has been accepted:
// nothing half-written may stay behind, and the mailbox's pending quota
// charge must be released unless the message really was stored.

vi.mock('@cmail/shared/push', async (original) => ({
  ...(await original<typeof import('@cmail/shared/push')>()),
  sendNewMailNotifications: vi.fn(async () => ({})),
}));

const { default: worker } = await import('./index');

type Recheck = 'none' | 'ours' | 'another' | 'throws';

function failingDelivery(options: { failPut?: 'body' | 'attachment'; batchFails?: boolean; recheck?: Recheck } = {}) {
  // Writes go body first, then attachments.
  const { storage, putKeys, deletedKeys } = memoryStorage((_key, index) =>
    (options.failPut === 'body' && index === 0) || (options.failPut === 'attachment' && index > 0));
  let deliveryLookups = 0;
  const { database, statements, batched } = deliveryDatabase({
    first(query) {
      if (!query.includes('SELECT id, body_r2_key FROM messages')) return undefined;
      deliveryLookups += 1;
      // The first lookup is the duplicate check before any work starts.
      if (deliveryLookups === 1) return null;
      const recheck = options.recheck ?? 'none';
      if (recheck === 'throws') throw new Error('D1_ERROR: network connection lost');
      if (recheck === 'ours') return { id: 'message-1', body_r2_key: putKeys[0] };
      if (recheck === 'another') return { id: 'message-2', body_r2_key: 'messages/other/body' };
      return null;
    },
    batch() {
      if (options.batchFails) throw new Error('D1_ERROR: database is locked');
    },
  });

  const released = () => statements.some((statement) =>
    statement.query.includes('UPDATE mailbox_reservations') && statement.query.includes('storage_pending = 0'));
  const inserted = () => batched.some((statement) => statement.query.includes('INSERT INTO messages'));
  const reserved = () => statements.some((statement) => statement.query.includes('INSERT OR IGNORE INTO mailbox_reservations'));

  return { database, storage, statements, putKeys, deletedKeys, released, inserted, reserved };
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
  return deliverInbound(worker, raw, {
    DB: setup.database,
    STORAGE: setup.storage,
    ...GUARDS_OFF,
    // Any non-zero limit turns the reservation (and its pending quota charge) on.
    INBOUND_MAILBOX_MESSAGES_PER_HOUR: '100',
  });
}

describe('inbound delivery after a storage failure', () => {
  it('stores and indexes a message normally, settling the reservation (control)', async () => {
    const setup = failingDelivery();
    const { error, message } = await deliver(setup);
    expect(error).toBeNull();
    expect(message.setReject).not.toHaveBeenCalled();
    expect(setup.reserved()).toBe(true);
    expect(setup.inserted()).toBe(true);
    expect(setup.deletedKeys).toEqual([]);
    expect(setup.released()).toBe(false);
  });

  it('removes what was written, releases the reservation and fails when the body write fails', async () => {
    const setup = failingDelivery({ failPut: 'body' });
    const { error } = await deliver(setup);
    expect(error?.message).toBe('R2 put failed');
    expect(setup.putKeys).toHaveLength(1);
    expect(setup.deletedKeys).toContain(setup.putKeys[0]);
    expect(setup.inserted()).toBe(false);
    expect(setup.released()).toBe(true);
  });

  it('removes the body too when an attachment write fails', async () => {
    const setup = failingDelivery({ failPut: 'attachment' });
    const { error } = await deliver(setup, WITH_ATTACHMENT);
    expect(error?.message).toBe('R2 put failed');
    expect(setup.putKeys).toHaveLength(2);
    expect(setup.deletedKeys).toEqual(expect.arrayContaining(setup.putKeys));
    expect(setup.inserted()).toBe(false);
    expect(setup.released()).toBe(true);
  });
});

describe('inbound delivery after the database write fails', () => {
  it('deletes the stored objects, releases the reservation and fails when nothing was committed', async () => {
    const setup = failingDelivery({ batchFails: true, recheck: 'none' });
    const { error } = await deliver(setup);
    expect(error?.message).toBe('D1_ERROR: database is locked');
    expect(setup.putKeys.length).toBeGreaterThan(0);
    expect(setup.deletedKeys).toEqual(expect.arrayContaining(setup.putKeys));
    expect(setup.released()).toBe(true);
  });

  it('keeps the stored objects when it cannot tell whether the write committed', async () => {
    const setup = failingDelivery({ batchFails: true, recheck: 'throws' });
    const { error } = await deliver(setup);
    expect(error?.message).toBe('D1_ERROR: database is locked');
    expect(setup.putKeys.length).toBeGreaterThan(0);
    expect(setup.deletedKeys).toEqual([]);
    expect(setup.released()).toBe(true);
  });

  it('treats the message as delivered when the recheck finds its own body key', async () => {
    const setup = failingDelivery({ batchFails: true, recheck: 'ours' });
    const { error, message } = await deliver(setup);
    expect(error).toBeNull();
    expect(setup.putKeys.length).toBeGreaterThan(0);
    expect(message.setReject).not.toHaveBeenCalled();
    expect(setup.deletedKeys).toEqual([]);
    expect(setup.released()).toBe(false);
  });

  it('drops its own copy quietly when a concurrent delivery of the same Message-ID won', async () => {
    const setup = failingDelivery({ batchFails: true, recheck: 'another' });
    const { error, message } = await deliver(setup);
    expect(error).toBeNull();
    expect(setup.putKeys.length).toBeGreaterThan(0);
    expect(message.setReject).not.toHaveBeenCalled();
    expect(setup.deletedKeys).toEqual(expect.arrayContaining(setup.putKeys));
    expect(setup.released()).toBe(true);
  });
});
