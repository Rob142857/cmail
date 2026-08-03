import {
  DEFAULT_MAILBOX_STORAGE_QUOTA_BYTES,
  mailboxStorageQuotaBytes,
  MAX_MAILBOX_STORAGE_QUOTA_BYTES,
  type MailboxStorageQuotaEnv,
} from '@cmail/shared/mailbox-storage';

export interface InboundGuardEnv extends MailboxStorageQuotaEnv {
  DB: D1Database;
  INBOUND_MAILBOX_MESSAGES_PER_HOUR?: string | number;
  INBOUND_MAILBOX_BYTES_PER_HOUR?: string | number;
  INBOUND_SENDER_MESSAGES_PER_HOUR?: string | number;
  /**
   * A 32-byte, unpadded base64url HMAC key stored as a Worker secret.
   * It pseudonymises sender addresses in the short-lived abuse ledger.
   */
  INBOUND_SENDER_HASH_KEY?: string;
}

export interface InboundGuardConfiguration {
  mailboxMessagesPerHour: number;
  mailboxBytesPerHour: number;
  senderMessagesPerHour: number;
  mailboxStorageBytes: number;
}

export interface InboundReservationInput {
  mailboxId: string;
  senderAddress: string;
  deliveryKey: string;
  messageBytes: number;
}

export type InboundReservationResult =
  | { status: 'accepted'; reservationId: string | null }
  | { status: 'duplicate'; reservationId: null }
  | { status: 'rejected'; reservationId: null }
  | { status: 'unavailable'; reservationId: null };

export const INBOUND_GUARD_DEFAULTS: Readonly<InboundGuardConfiguration> = Object.freeze({
  mailboxMessagesPerHour: 120,
  mailboxBytesPerHour: 100 * 1024 * 1024,
  senderMessagesPerHour: 30,
  mailboxStorageBytes: DEFAULT_MAILBOX_STORAGE_QUOTA_BYTES,
});

export const INBOUND_GUARD_HARD_MAX: Readonly<InboundGuardConfiguration> = Object.freeze({
  mailboxMessagesPerHour: 10_000,
  mailboxBytesPerHour: 25 * 1024 * 1024 * 1024,
  senderMessagesPerHour: 10_000,
  mailboxStorageBytes: MAX_MAILBOX_STORAGE_QUOTA_BYTES,
});

const HASH_KEY_BYTES = 32;
const HASH_KEY_CHARS = 43;
const ENCODER = new TextEncoder();

// Every accepted attempt remains in the rolling-hour ledger. The pending
// storage charge is released on a terminal failure or by the message-insert
// trigger, and also expires if an invocation is interrupted mid-delivery.
const PENDING_STORAGE_SECONDS = 15 * 60;

export const INBOUND_RESERVATION_SQL = `
  INSERT OR IGNORE INTO mailbox_reservations (
    id,
    delivery_key,
    reservation_type,
    mailbox_id,
    sender_hash,
    message_bytes,
    mailbox_message_limit,
    mailbox_byte_limit,
    sender_message_limit,
    storage_quota_bytes,
    storage_pending,
    pending_expires_at,
    created_epoch
  ) VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, 1, unixepoch() + ?, unixepoch())
`;

function parseBoundedLimit(value: unknown, fallback: number, hardMax: number): number {
  if (value === 0 || (typeof value === 'string' && value.trim() === '0')) return 0;
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;

  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  const integer = Math.floor(parsed);
  if (!Number.isSafeInteger(integer) || integer < 1) return fallback;
  return Math.min(integer, hardMax);
}

export function inboundGuardConfiguration(env: Partial<InboundGuardEnv>): InboundGuardConfiguration {
  return {
    mailboxMessagesPerHour: parseBoundedLimit(
      env.INBOUND_MAILBOX_MESSAGES_PER_HOUR,
      INBOUND_GUARD_DEFAULTS.mailboxMessagesPerHour,
      INBOUND_GUARD_HARD_MAX.mailboxMessagesPerHour,
    ),
    mailboxBytesPerHour: parseBoundedLimit(
      env.INBOUND_MAILBOX_BYTES_PER_HOUR,
      INBOUND_GUARD_DEFAULTS.mailboxBytesPerHour,
      INBOUND_GUARD_HARD_MAX.mailboxBytesPerHour,
    ),
    senderMessagesPerHour: parseBoundedLimit(
      env.INBOUND_SENDER_MESSAGES_PER_HOUR,
      INBOUND_GUARD_DEFAULTS.senderMessagesPerHour,
      INBOUND_GUARD_HARD_MAX.senderMessagesPerHour,
    ),
    mailboxStorageBytes: mailboxStorageQuotaBytes(env),
  };
}

function decodeSenderHashKey(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== 'string' || value.length !== HASH_KEY_CHARS || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  try {
    const padded = `${value.replace(/-/g, '+').replace(/_/g, '/')}=`;
    const decoded = atob(padded);
    if (decoded.length !== HASH_KEY_BYTES) return null;

    const bytes = new Uint8Array(HASH_KEY_BYTES);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashInboundSender(
  mailboxId: string,
  senderAddress: string,
  encodedKey: unknown,
): Promise<string | null> {
  const keyBytes = decodeSenderHashKey(encodedKey);
  if (!keyBytes) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    ENCODER.encode(`cmail-inbound-sender-rate-v1\u0000${mailboxId}\u0000${senderAddress}`),
  );
  return hex(digest);
}

function guardDisabled(configuration: InboundGuardConfiguration): boolean {
  return configuration.mailboxMessagesPerHour === 0
    && configuration.mailboxBytesPerHour === 0
    && configuration.senderMessagesPerHour === 0
    && configuration.mailboxStorageBytes === 0;
}

async function existingReservation(
  db: D1Database,
  reservationId: string,
  deliveryKey: string,
): Promise<'accepted' | 'duplicate' | 'missing' | 'unavailable'> {
  try {
    const row = await db.prepare(
      `SELECT id, delivery_key FROM mailbox_reservations
       WHERE id = ? OR delivery_key = ?
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    ).bind(reservationId, deliveryKey, reservationId).first<{ id: string; delivery_key: string | null }>();

    if (!row) return 'missing';
    return row.id === reservationId ? 'accepted' : 'duplicate';
  } catch {
    return 'unavailable';
  }
}

/**
 * Reserves all configured inbound allowances with one D1 INSERT. SQLite runs
 * its guard triggers and uniqueness check in the same write transaction, so
 * competing deliveries cannot both pass a read-then-write race.
 */
export async function reserveInboundDelivery(
  env: InboundGuardEnv,
  input: InboundReservationInput,
): Promise<InboundReservationResult> {
  if (
    !input.mailboxId
    || !input.deliveryKey
    || !Number.isSafeInteger(input.messageBytes)
    || input.messageBytes < 0
  ) {
    return { status: 'unavailable', reservationId: null };
  }

  const configuration = inboundGuardConfiguration(env);
  if (guardDisabled(configuration)) {
    return { status: 'accepted', reservationId: null };
  }

  let senderHash = '';
  if (configuration.senderMessagesPerHour > 0) {
    try {
      senderHash = await hashInboundSender(
        input.mailboxId,
        input.senderAddress,
        env.INBOUND_SENDER_HASH_KEY,
      ) || '';
    } catch {
      return { status: 'unavailable', reservationId: null };
    }
    if (!senderHash) return { status: 'unavailable', reservationId: null };
  }

  const reservationId = crypto.randomUUID();
  try {
    const result = await env.DB.prepare(INBOUND_RESERVATION_SQL).bind(
      reservationId,
      input.deliveryKey,
      input.mailboxId,
      senderHash,
      input.messageBytes,
      configuration.mailboxMessagesPerHour,
      configuration.mailboxBytesPerHour,
      configuration.senderMessagesPerHour,
      configuration.mailboxStorageBytes,
      PENDING_STORAGE_SECONDS,
    ).run();

    if (Number(result.meta?.changes || 0) > 0) {
      return { status: 'accepted', reservationId };
    }
  } catch {
    // An ambiguous D1 response can follow a committed write. Recheck using
    // generated opaque identifiers without logging the sender or recipient.
  }

  const existing = await existingReservation(env.DB, reservationId, input.deliveryKey);
  if (existing === 'accepted') return { status: 'accepted', reservationId };
  if (existing === 'duplicate') return { status: 'duplicate', reservationId: null };
  if (existing === 'unavailable') return { status: 'unavailable', reservationId: null };
  return { status: 'rejected', reservationId: null };
}

/** Releases only the pending storage charge. The row remains as an hourly abuse charge. */
export async function releaseInboundReservation(db: D1Database, reservationId: string | null): Promise<void> {
  if (!reservationId) return;
  await db.prepare(
    `UPDATE mailbox_reservations
     SET storage_pending = 0, delivery_key = NULL
     WHERE id = ?`,
  ).bind(reservationId).run();
}
