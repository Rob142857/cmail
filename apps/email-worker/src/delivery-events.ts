// Cloudflare Email Sending lifecycle events (delivered, deferred, bounced,
// failed, rejected, complained) arrive on a queue through an event
// subscription on each sending domain. Each event that matches mail cmail sent
// is stored in delivery_events, and a terminal failure adds the recipient to
// failed_recipients on the mail trace and on the sender's Sent copy, which the
// message view already shows. Events for mail cmail did not send (another app
// on the same sending domain) are acknowledged and dropped without storage.

export const DELIVERY_EVENT_TYPES = ['delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained'] as const;
export type DeliveryEventType = typeof DELIVERY_EVENT_TYPES[number];

export interface DeliveryEvent {
  eventId: string;
  providerMessageId: string;
  recipient: string;
  type: DeliveryEventType;
  terminal: boolean;
  bounceType: 'hard' | 'soft' | null;
  smtpStatus: string | null;
  smtpResponse: string | null;
  eventTimestamp: string | null;
}

export type DeliveryEventOutcome = 'stored' | 'duplicate' | 'unmatched' | 'invalid';

const EVENT_TYPE_PREFIX = 'cf.email.sending.message.';
const MAX_EVENT_ID_CHARS = 128;
const MAX_PROVIDER_ID_CHARS = 998;
const MAX_ADDRESS_CHARS = 320;
const MAX_SMTP_STATUS_CHARS = 32;
const MAX_SMTP_RESPONSE_CHARS = 500;
const MAX_FAILED_RECIPIENTS = 100;
// Provider IDs are matched against recent outbound traces only. Timestamps in
// mail_trace mix ISO and SQLite formats, so the cut-off is approximate by up
// to a day; that is fine for a window this wide.
const MATCH_WINDOW_DAYS = 30;
// An event can arrive before the send's trace row is written. Unmatched
// events are retried this many times, a minute apart, before being dropped.
export const UNMATCHED_RETRY_ATTEMPTS = 3;
export const UNMATCHED_RETRY_DELAY_SECONDS = 60;
// Errors (D1 unavailable) back off 30 s, 60 s, 120 s ... up to 5 minutes.
export function errorRetryDelaySeconds(attempts: number): number {
  return Math.min(300, 30 * 2 ** Math.max(0, attempts - 1));
}

const FAILURE_TYPES: ReadonlySet<DeliveryEventType> = new Set(['bounced', 'failed', 'rejected']);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function identifier(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > max || /[\s\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function recipientAddress(value: unknown): string | null {
  const address = identifier(value, MAX_ADDRESS_CHARS)?.toLowerCase();
  if (!address || /[<>()[\]\\,;:"]/.test(address)) return null;
  const at = address.lastIndexOf('@');
  if (at < 1 || at !== address.indexOf('@') || at === address.length - 1) return null;
  return address;
}

/** Validates one queue message body. Returns null for anything that is not a well-formed Email Sending event. */
export function parseDeliveryEvent(body: unknown): DeliveryEvent | null {
  const event = record(body);
  const source = record(event?.source);
  const payload = record(event?.payload);
  if (!event || !payload || source?.type !== 'email.sending') return null;
  if (typeof event.type !== 'string' || !event.type.startsWith(EVENT_TYPE_PREFIX)) return null;
  const type = event.type.slice(EVENT_TYPE_PREFIX.length) as DeliveryEventType;
  if (!DELIVERY_EVENT_TYPES.includes(type)) return null;

  const eventId = identifier(payload.eventId, MAX_EVENT_ID_CHARS);
  const providerMessageId = identifier(payload.messageId, MAX_PROVIDER_ID_CHARS);
  const recipient = recipientAddress(payload.recipient);
  if (!eventId || !providerMessageId || !recipient) return null;

  const delivery = record(payload.delivery);
  const bounce = record(payload.bounce);
  const metadata = record(event.metadata);
  const bounceType = bounce?.type === 'hard' || bounce?.type === 'soft' ? bounce.type : null;
  const smtpStatus = boundedText(delivery?.smtpEnhancedStatusCode, MAX_SMTP_STATUS_CHARS)
    ?? boundedText(delivery?.smtpStatusCode, MAX_SMTP_STATUS_CHARS);
  const smtpResponse = boundedText(delivery?.smtpResponse, MAX_SMTP_RESPONSE_CHARS)
    ?? boundedText(bounce?.reason, MAX_SMTP_RESPONSE_CHARS);
  const eventTimestamp = identifier(metadata?.eventTimestamp, 40);

  return {
    eventId,
    providerMessageId,
    recipient,
    type,
    terminal: payload.terminal === true,
    bounceType,
    smtpStatus,
    smtpResponse,
    eventTimestamp,
  };
}

/** True when the event means the recipient will not get the message. */
export function isDeliveryFailure(event: Pick<DeliveryEvent, 'type' | 'terminal'>): boolean {
  return FAILURE_TYPES.has(event.type) && event.terminal;
}

function appendFailedRecipient(table: 'mail_trace' | 'messages', idColumn: 'trace_id' | 'id'): string {
  // Adds the address once, and never grows the list past the cap the send
  // path uses. Safe to repeat for a redelivered event.
  return `UPDATE ${table}
     SET failed_recipients = json_insert(failed_recipients, '$[#]', ?1)
     WHERE ${idColumn} = ?2
       AND json_array_length(failed_recipients) < ${MAX_FAILED_RECIPIENTS}
       AND NOT EXISTS (
         SELECT 1 FROM json_each(${table}.failed_recipients) WHERE lower(json_each.value) = ?1
       )`;
}

/** Stores one validated event against the trace and Sent copy it belongs to. */
export async function applyDeliveryEvent(db: D1Database, event: DeliveryEvent): Promise<DeliveryEventOutcome> {
  const trace = await db.prepare(
    `SELECT trace_id, envelope_from, timestamp FROM mail_trace
     WHERE direction = 'outbound'
       AND timestamp >= datetime('now', '-' || ? || ' days')
       AND EXISTS (
         SELECT 1 FROM json_each(mail_trace.provider_message_ids) WHERE json_each.value = ?
       )
     ORDER BY timestamp DESC LIMIT 1`,
  ).bind(MATCH_WINDOW_DAYS, event.providerMessageId).first<{ trace_id: string; envelope_from: string | null; timestamp: string }>();
  if (!trace) return 'unmatched';

  const inserted = await db.prepare(
    `INSERT INTO delivery_events
       (event_id, trace_id, provider_message_id, recipient, event_type, terminal, bounce_type,
        smtp_status, smtp_response, event_timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO NOTHING`,
  ).bind(
    event.eventId,
    trace.trace_id,
    event.providerMessageId,
    event.recipient,
    event.type,
    event.terminal ? 1 : 0,
    event.bounceType,
    event.smtpStatus,
    event.smtpResponse,
    event.eventTimestamp,
  ).run();
  const duplicate = Number(inserted.meta?.changes || 0) === 0;

  // The failed-recipient updates run even for a duplicate event: they are
  // idempotent, and this completes the work if an earlier attempt stopped
  // between the insert and the updates. A Sent copy written after this event
  // picks the failure up from delivery_events instead (outbound-journal.ts).
  if (isDeliveryFailure(event)) {
    const statements = [db.prepare(appendFailedRecipient('mail_trace', 'trace_id')).bind(event.recipient, trace.trace_id)];
    if (trace.envelope_from) {
      // Cloudflare sends store no Message-ID, so the Sent copy is found by
      // the sender's mailbox, time and provider tracking ID. Timestamps mix
      // ISO and SQLite formats; the day of slack covers that.
      const sentCopies = await db.prepare(
        `SELECT id FROM messages
         WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE address = ?)
           AND direction = 'outbound'
           AND received_at >= datetime(?, '-1 day')
           AND EXISTS (
             SELECT 1 FROM json_each(messages.provider_message_ids) WHERE json_each.value = ?
           )
         LIMIT 25`,
      ).bind(trace.envelope_from.toLowerCase(), trace.timestamp, event.providerMessageId).all<{ id: string }>();
      for (const copy of sentCopies.results || []) {
        statements.push(db.prepare(appendFailedRecipient('messages', 'id')).bind(event.recipient, copy.id));
      }
    }
    await db.batch(statements);
  }
  return duplicate ? 'duplicate' : 'stored';
}

/** Queue consumer for Email Sending events. Logs counts only, never addresses or IDs. */
export async function handleDeliveryEventBatch(batch: MessageBatch<unknown>, db: D1Database): Promise<void> {
  const counts: Record<DeliveryEventOutcome | 'retried' | 'errors', number> = {
    stored: 0, duplicate: 0, unmatched: 0, invalid: 0, retried: 0, errors: 0,
  };
  for (const message of batch.messages) {
    const event = parseDeliveryEvent(message.body);
    if (!event) {
      counts.invalid += 1;
      message.ack();
      continue;
    }
    try {
      const outcome = await applyDeliveryEvent(db, event);
      if (outcome === 'unmatched' && message.attempts < UNMATCHED_RETRY_ATTEMPTS) {
        counts.retried += 1;
        message.retry({ delaySeconds: UNMATCHED_RETRY_DELAY_SECONDS });
        continue;
      }
      counts[outcome] += 1;
      message.ack();
    } catch (caught: unknown) {
      counts.errors += 1;
      console.error('Delivery event failed', { error: caught instanceof Error ? caught.name : 'UnknownError' });
      message.retry({ delaySeconds: errorRetryDelaySeconds(message.attempts) });
    }
  }
  console.log('Delivery events processed', counts);
}
