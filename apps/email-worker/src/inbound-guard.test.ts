import { describe, expect, it, vi } from 'vitest';

import {
  INBOUND_GUARD_DEFAULTS,
  INBOUND_GUARD_HARD_MAX,
  hashInboundSender,
  inboundGuardConfiguration,
  reserveInboundDelivery,
  type InboundGuardEnv,
} from './inbound-guard';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

const HASH_KEY = base64Url(new Uint8Array(32).fill(7));

interface ReservationRow {
  id: string;
  deliveryKey: string | null;
  mailboxId: string;
  senderHash: string;
  messageBytes: number;
  storagePending: boolean;
}

/** Minimal serialized D1 model for exercising the one-write reservation contract. */
class AtomicReservationDb {
  readonly rows: ReservationRow[] = [];
  readonly prepare = vi.fn((query: string) => ({
    bind: (...values: unknown[]) => {
    if (query.includes('INSERT OR IGNORE INTO mailbox_reservations')) {
        return {
          run: async () => {
            const [
              id,
              deliveryKey,
              mailboxId,
              senderHash,
              messageBytes,
              mailboxMessageLimit,
              mailboxByteLimit,
              senderMessageLimit,
              storageQuotaBytes,
            ] = values as [string, string, string, string, number, number, number, number, number];

            const mailboxRows = this.rows.filter((row) => row.mailboxId === mailboxId);
            const duplicate = this.rows.some((row) => row.deliveryKey === deliveryKey);
            const mailboxMessageDenied = mailboxMessageLimit > 0 && mailboxRows.length >= mailboxMessageLimit;
            const mailboxByteDenied = mailboxByteLimit > 0
              && mailboxRows.reduce((total, row) => total + row.messageBytes, 0) + messageBytes > mailboxByteLimit;
            const senderDenied = senderMessageLimit > 0
              && mailboxRows.filter((row) => row.senderHash === senderHash).length >= senderMessageLimit;
            const pendingBytes = mailboxRows
              .filter((row) => row.storagePending)
              .reduce((total, row) => total + row.messageBytes, 0);
            const storageDenied = storageQuotaBytes > 0
              && this.retainedStorageBytes + pendingBytes + messageBytes > storageQuotaBytes;

            if (duplicate || mailboxMessageDenied || mailboxByteDenied || senderDenied || storageDenied) {
              return { meta: { changes: 0 } };
            }

            this.rows.push({
              id,
              deliveryKey,
              mailboxId,
              senderHash,
              messageBytes,
              storagePending: true,
            });
            return { meta: { changes: 1 } };
          },
        };
      }

    if (query.includes('SELECT id, delivery_key FROM mailbox_reservations')) {
        return {
          first: async () => {
            const [reservationId, deliveryKey] = values as [string, string];
            const row = this.rows.find((candidate) => (
              candidate.id === reservationId || candidate.deliveryKey === deliveryKey
            ));
            return row ? { id: row.id, delivery_key: row.deliveryKey } : null;
          },
        };
      }

    if (query.includes('UPDATE mailbox_reservations')) {
        return {
          run: async () => {
            const [reservationId] = values as [string];
            const row = this.rows.find((candidate) => candidate.id === reservationId);
            if (row) {
              row.storagePending = false;
              row.deliveryKey = null;
            }
            return { meta: { changes: row ? 1 : 0 } };
          },
        };
      }

      throw new Error(`Unexpected test query: ${query}`);
    },
  }));

  constructor(readonly retainedStorageBytes = 0) {}

  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}

function environment(db: AtomicReservationDb, values: Partial<InboundGuardEnv> = {}): InboundGuardEnv {
  return {
    DB: db.asD1(),
    INBOUND_SENDER_HASH_KEY: HASH_KEY,
    ...values,
  };
}

function input(deliveryKey: string, messageBytes = 10) {
  return {
    mailboxId: 'mailbox-test',
    senderAddress: 'sender@example.test',
    deliveryKey,
    messageBytes,
  };
}

describe('inbound guard configuration', () => {
  it('uses conservative defaults for absent or malformed settings', () => {
    expect(inboundGuardConfiguration({})).toEqual(INBOUND_GUARD_DEFAULTS);
    expect(inboundGuardConfiguration({
      INBOUND_MAILBOX_MESSAGES_PER_HOUR: '',
      INBOUND_MAILBOX_BYTES_PER_HOUR: 'invalid',
      INBOUND_SENDER_MESSAGES_PER_HOUR: -1,
      INBOUND_MAILBOX_STORAGE_BYTES: 0.5,
    })).toEqual(INBOUND_GUARD_DEFAULTS);
  });

  it('floors positive values, caps excessive values, and only disables on explicit zero', () => {
    expect(inboundGuardConfiguration({
      INBOUND_MAILBOX_MESSAGES_PER_HOUR: '12.9',
      INBOUND_MAILBOX_BYTES_PER_HOUR: Number.MAX_SAFE_INTEGER,
      INBOUND_SENDER_MESSAGES_PER_HOUR: '0',
      INBOUND_MAILBOX_STORAGE_BYTES: 0,
    })).toEqual({
      mailboxMessagesPerHour: 12,
      mailboxBytesPerHour: INBOUND_GUARD_HARD_MAX.mailboxBytesPerHour,
      senderMessagesPerHour: 0,
      mailboxStorageBytes: 0,
    });
  });
});

describe('sender pseudonymisation', () => {
  it('is deterministic and mailbox scoped without retaining the address', async () => {
    const first = await hashInboundSender('mailbox-a', 'person@example.test', HASH_KEY);
    const repeated = await hashInboundSender('mailbox-a', 'person@example.test', HASH_KEY);
    const anotherMailbox = await hashInboundSender('mailbox-b', 'person@example.test', HASH_KEY);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(repeated);
    expect(anotherMailbox).not.toBe(first);
    expect(first).not.toContain('person');
  });

  it('fails closed for absent or malformed keys', async () => {
    expect(await hashInboundSender('mailbox-a', 'person@example.test', '')).toBeNull();
    expect(await hashInboundSender('mailbox-a', 'person@example.test', 'a'.repeat(42))).toBeNull();
  });
});

describe('atomic inbound reservations', () => {
  it('allows exact byte and retained-storage boundaries and rejects the next byte', async () => {
    const byteDb = new AtomicReservationDb();
    const byteEnv = environment(byteDb, {
      INBOUND_MAILBOX_MESSAGES_PER_HOUR: 0,
      INBOUND_MAILBOX_BYTES_PER_HOUR: 100,
      INBOUND_SENDER_MESSAGES_PER_HOUR: 0,
      INBOUND_MAILBOX_STORAGE_BYTES: 0,
    });

    expect((await reserveInboundDelivery(byteEnv, input('byte-1', 40))).status).toBe('accepted');
    expect((await reserveInboundDelivery(byteEnv, input('byte-2', 60))).status).toBe('accepted');
    expect((await reserveInboundDelivery(byteEnv, input('byte-3', 1))).status).toBe('rejected');

    const storageDb = new AtomicReservationDb(900);
    const storageEnv = environment(storageDb, {
      INBOUND_MAILBOX_MESSAGES_PER_HOUR: 0,
      INBOUND_MAILBOX_BYTES_PER_HOUR: 0,
      INBOUND_SENDER_MESSAGES_PER_HOUR: 0,
      INBOUND_MAILBOX_STORAGE_BYTES: 1_000,
    });
    expect((await reserveInboundDelivery(storageEnv, input('storage-1', 100))).status).toBe('accepted');
    expect((await reserveInboundDelivery(storageEnv, input('storage-2', 1))).status).toBe('rejected');
  });

  it('serializes competing deliveries so the configured count cannot be exceeded', async () => {
    const db = new AtomicReservationDb();
    const env = environment(db, {
      INBOUND_MAILBOX_MESSAGES_PER_HOUR: 3,
      INBOUND_MAILBOX_BYTES_PER_HOUR: 0,
      INBOUND_SENDER_MESSAGES_PER_HOUR: 0,
      INBOUND_MAILBOX_STORAGE_BYTES: 0,
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => reserveInboundDelivery(env, input(`concurrent-${index}`))),
    );

    expect(results.filter((result) => result.status === 'accepted')).toHaveLength(3);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(17);
    expect(db.rows).toHaveLength(3);
  });

  it('accepts one concurrent copy of a delivery and identifies every other copy as duplicate', async () => {
    const db = new AtomicReservationDb();
    const env = environment(db, {
      INBOUND_MAILBOX_MESSAGES_PER_HOUR: 100,
      INBOUND_MAILBOX_BYTES_PER_HOUR: 0,
      INBOUND_SENDER_MESSAGES_PER_HOUR: 0,
      INBOUND_MAILBOX_STORAGE_BYTES: 0,
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveInboundDelivery(env, input('same-delivery'))),
    );
    expect(results.filter((result) => result.status === 'accepted')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'duplicate')).toHaveLength(9);
    expect(db.rows).toHaveLength(1);
  });

  it('skips D1 and does not require a hash key when every guardrail is explicitly disabled', async () => {
    const db = new AtomicReservationDb();
    const result = await reserveInboundDelivery(environment(db, {
      INBOUND_MAILBOX_MESSAGES_PER_HOUR: 0,
      INBOUND_MAILBOX_BYTES_PER_HOUR: 0,
      INBOUND_SENDER_MESSAGES_PER_HOUR: 0,
      INBOUND_MAILBOX_STORAGE_BYTES: 0,
      INBOUND_SENDER_HASH_KEY: '',
    }), input('disabled'));

    expect(result).toEqual({ status: 'accepted', reservationId: null });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('fails closed before D1 when sender protection is enabled without a valid secret', async () => {
    const db = new AtomicReservationDb();
    const result = await reserveInboundDelivery(environment(db, {
      INBOUND_MAILBOX_MESSAGES_PER_HOUR: 0,
      INBOUND_MAILBOX_BYTES_PER_HOUR: 0,
      INBOUND_SENDER_MESSAGES_PER_HOUR: 1,
      INBOUND_MAILBOX_STORAGE_BYTES: 0,
      INBOUND_SENDER_HASH_KEY: '',
    }), input('missing-secret'));

    expect(result).toEqual({ status: 'unavailable', reservationId: null });
    expect(db.prepare).not.toHaveBeenCalled();
  });
});
