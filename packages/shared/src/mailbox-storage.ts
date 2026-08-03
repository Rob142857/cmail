export interface MailboxStorageQuotaEnv {
  MAILBOX_STORAGE_QUOTA_BYTES?: string | number;
  /** @deprecated Use MAILBOX_STORAGE_QUOTA_BYTES. */
  INBOUND_MAILBOX_STORAGE_BYTES?: string | number;
}

export interface MailboxStorageReservationInput {
  mailboxId: string;
  deliveryKey: string;
  bytes: number;
  /** When present, atomically reserves one owned-draft row in this mailbox. */
  draftOwnerId?: string;
  draftRowLimit?: number;
}

export interface MailboxStorageReservation {
  reservationId: string;
  deliveryKey: string;
}

export type MailboxStorageReservationResult =
  | { status: 'accepted'; reservations: MailboxStorageReservation[] }
  | { status: 'rejected' | 'unavailable'; reservations: [] };

export const DEFAULT_MAILBOX_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024;
export const MAX_MAILBOX_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024 * 1024;

const MAX_RESERVATIONS_PER_OPERATION = 256;
const PENDING_STORAGE_SECONDS = 15 * 60;

export const MAILBOX_STORAGE_RESERVATION_SQL = `
  INSERT INTO mailbox_reservations (
    id,
    delivery_key,
    reservation_type,
    mailbox_id,
    sender_hash,
    draft_owner_id,
    draft_row_limit,
    message_bytes,
    mailbox_message_limit,
    mailbox_byte_limit,
    sender_message_limit,
    storage_quota_bytes,
    storage_pending,
    pending_expires_at,
    created_epoch
  ) VALUES (?, ?, ?, ?, '', ?, ?, ?, 0, 0, 0, ?, 1, unixepoch() + ?, unixepoch())
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

/**
 * Returns the shared retained-message quota used by both inbound delivery and
 * web-originated copies. An exact zero explicitly disables the quota.
 */
export function mailboxStorageQuotaBytes(env: Partial<MailboxStorageQuotaEnv>): number {
  const configured = env.MAILBOX_STORAGE_QUOTA_BYTES ?? env.INBOUND_MAILBOX_STORAGE_BYTES;
  return parseBoundedLimit(
    configured,
    DEFAULT_MAILBOX_STORAGE_QUOTA_BYTES,
    MAX_MAILBOX_STORAGE_QUOTA_BYTES,
  );
}

function validInput(input: MailboxStorageReservationInput): boolean {
  const hasDraftOwner = typeof input.draftOwnerId === 'string' && input.draftOwnerId.length > 0;
  const hasDraftLimit = Number.isSafeInteger(input.draftRowLimit) && Number(input.draftRowLimit) > 0;
  return input.mailboxId.length > 0
    && input.deliveryKey.length > 0
    && input.deliveryKey.length <= 128
    && Number.isSafeInteger(input.bytes)
    && input.bytes >= 0
    && hasDraftOwner === hasDraftLimit;
}

/**
 * Atomically evaluates each mailbox's current retained bytes plus every
 * active reservation in this D1 batch. Nothing outside D1 is written until
 * all reservations have succeeded. If one quota check is denied, successful
 * rows are immediately released and expire defensively after 15 minutes.
 */
export async function reserveMailboxStorage(
  db: D1Database,
  env: Partial<MailboxStorageQuotaEnv>,
  inputs: MailboxStorageReservationInput[],
): Promise<MailboxStorageReservationResult> {
  if (
    inputs.length === 0
    || inputs.length > MAX_RESERVATIONS_PER_OPERATION
    || inputs.some((input) => !validInput(input))
    || new Set(inputs.map((input) => input.deliveryKey)).size !== inputs.length
  ) {
    return inputs.length === 0
      ? { status: 'accepted', reservations: [] }
      : { status: 'unavailable', reservations: [] };
  }

  const quotaBytes = mailboxStorageQuotaBytes(env);
  if (quotaBytes === 0 && inputs.every((input) => !input.draftOwnerId)) {
    return { status: 'accepted', reservations: [] };
  }

  const reservations = inputs.map((input) => ({
    reservationId: crypto.randomUUID(),
    deliveryKey: input.deliveryKey,
  }));
  const statements = inputs.map((input, index) => db.prepare(MAILBOX_STORAGE_RESERVATION_SQL).bind(
    reservations[index].reservationId,
    input.deliveryKey,
    input.draftOwnerId ? 'draft' : 'storage',
    input.mailboxId,
    input.draftOwnerId || null,
    input.draftRowLimit || 0,
    input.bytes,
    quotaBytes,
    PENDING_STORAGE_SECONDS,
  ));

  try {
    const results = await db.batch(statements);
    if (results.every((result) => Number(result.meta?.changes || 0) > 0)) {
      return { status: 'accepted', reservations };
    }
  } catch (error) {
    // A failed/ambiguous response may follow a committed batch. Release by
    // our opaque reservation ids before reporting a generic unavailable state.
    await releaseMailboxStorageReservations(db, reservations).catch(() => undefined);
    const detail = error instanceof Error ? error.message.toLowerCase() : '';
    const denied = detail.includes('mailbox reservation denied')
      || detail.includes('unique constraint');
    return { status: denied ? 'rejected' : 'unavailable', reservations: [] };
  }

  await releaseMailboxStorageReservations(db, reservations).catch(() => undefined);
  return { status: 'rejected', reservations: [] };
}

/** Releases a pending charge without deleting its short-lived ledger row. */
export async function releaseMailboxStorageReservations(
  db: D1Database,
  reservations: MailboxStorageReservation[],
): Promise<void> {
  if (!reservations.length) return;
  await db.batch(reservations.map(({ reservationId }) => db.prepare(
    `UPDATE mailbox_reservations
     SET storage_pending = 0, delivery_key = NULL
     WHERE id = ?`,
  ).bind(reservationId)));
}
