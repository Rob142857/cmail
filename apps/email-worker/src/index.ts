// cmail inbound email worker
// Receives email via Cloudflare Email Routing, parses, stores in D1/R2.
// Outbound is handled directly by the web app (Cloudflare Email Service or Postmark) —
// this worker is inbound-only.
import PostalMime from 'postal-mime';
import { sendNewMailNotifications, type PushEnvironment } from '@cmail/shared/push';
import { sanitizeBoundedEmailHtml } from '@cmail/shared/sanitize-email';
import { parseAuthenticationResults } from './authentication-results';
import {
  releaseInboundReservation,
  reserveInboundDelivery,
  type InboundGuardEnv,
} from './inbound-guard';
import { runRetention, type RetentionEnv } from './retention';

export { retentionDays, retentionEnabled } from './retention';
export {
  hashInboundSender,
  inboundGuardConfiguration,
  reserveInboundDelivery,
} from './inbound-guard';

interface Env extends RetentionEnv, PushEnvironment, InboundGuardEnv {
  /** Optional byte limit. Values above HARD_MAX_INBOUND_BYTES are clamped. */
  MAX_INBOUND_BYTES?: string | number;
  /** Optional attachment-count limit. Values above HARD_MAX_ATTACHMENTS are clamped. */
  MAX_ATTACHMENTS_PER_MESSAGE?: string | number;
  /** Maximum decoded HTML/plain rendering persisted for one inbound message. */
  MAX_INBOUND_DECODED_BODY_BYTES?: string | number;
  /** Retention is destructive and remains off until an operator explicitly opts in. */
  RETENTION_JOBS_ENABLED?: string | number | boolean;
  /**
   * authserv-id of the trusted boundary MTA, e.g. the receiving domain used by
   * Cloudflare Email Routing. Inbound SPF/DKIM/DMARC results are recorded only
   * when the topmost Authentication-Results record carries this identifier
   * (RFC 8601 §5). Leave unset to record nothing.
   */
  INBOUND_AUTHSERV_ID?: string;
}

type TraceStatus = 'delivered' | 'bounced' | 'rejected' | 'quarantined' | 'deferred' | 'sent';
type TraceDirection = 'inbound' | 'outbound';

interface TraceInput {
  message_id_header?: string | null;
  direction: TraceDirection;
  envelope_from?: string | null;
  envelope_to?: string | null;
  header_from?: string | null;
  subject?: string | null;
  size_bytes?: number | null;
  status: TraceStatus;
  status_detail?: string | null;
  spf_result?: string | null;
  dkim_result?: string | null;
  dmarc_result?: string | null;
  spam_score?: number | null;
  source_ip?: string | null;
}

const DEFAULT_MAX_INBOUND_BYTES = 10 * 1024 * 1024; // 10 MiB
const HARD_MAX_INBOUND_BYTES = 25 * 1024 * 1024; // Cloudflare Email Routing ceiling
const DEFAULT_MAX_ATTACHMENTS = 25;
const HARD_MAX_ATTACHMENTS = 50;
const DEFAULT_MAX_DECODED_BODY_BYTES = 512 * 1024;
const HARD_MAX_DECODED_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_ADDRESSES = 100;
const MAX_ADDRESS_CHARS = 320;
const MAX_SUBJECT_CHARS = 998;
const MAX_MESSAGE_ID_CHARS = 998;
const MAX_FILENAME_CHARS = 255;
const MAX_CONTENT_TYPE_CHARS = 255;
const ENCODER = new TextEncoder();
const OPAQUE_STORAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Blocked attachment extensions. This is a defense-in-depth guard, not malware scanning.
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.scr', '.js', '.vbs', '.ps1', '.msi',
  '.com', '.pif', '.hta', '.cpl', '.reg', '.inf', '.wsf',
]);

function generateId(): string {
  return crypto.randomUUID();
}

function assertOpaqueStorageId(value: string): void {
  if (!OPAQUE_STORAGE_ID.test(value)) throw new TypeError('R2 storage identifiers must be UUIDs');
}

export function messageBodyR2Key(namespace: string, objectId: string): string {
  assertOpaqueStorageId(namespace);
  assertOpaqueStorageId(objectId);
  return `messages/${namespace}/${objectId}`;
}

export function attachmentR2Key(namespace: string, objectId: string): string {
  assertOpaqueStorageId(namespace);
  assertOpaqueStorageId(objectId);
  return `attachments/${namespace}/${objectId}`;
}

export function getInboundLimit(env: Pick<Env, 'MAX_INBOUND_BYTES'>): number {
  const configured = typeof env.MAX_INBOUND_BYTES === 'number'
    ? env.MAX_INBOUND_BYTES
    : Number(env.MAX_INBOUND_BYTES);

  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MAX_INBOUND_BYTES;
  }

  const value = Math.floor(configured);
  return value >= 1 ? Math.min(value, HARD_MAX_INBOUND_BYTES) : DEFAULT_MAX_INBOUND_BYTES;
}

export function getAttachmentLimit(env: Pick<Env, 'MAX_ATTACHMENTS_PER_MESSAGE'>): number {
  const configured = typeof env.MAX_ATTACHMENTS_PER_MESSAGE === 'number'
    ? env.MAX_ATTACHMENTS_PER_MESSAGE
    : Number(env.MAX_ATTACHMENTS_PER_MESSAGE);

  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MAX_ATTACHMENTS;
  }

  const value = Math.floor(configured);
  return value >= 1 ? Math.min(value, HARD_MAX_ATTACHMENTS) : DEFAULT_MAX_ATTACHMENTS;
}

export function getDecodedBodyLimit(env: Pick<Env, 'MAX_INBOUND_DECODED_BODY_BYTES'>): number {
  const configured = typeof env.MAX_INBOUND_DECODED_BODY_BYTES === 'number'
    ? env.MAX_INBOUND_DECODED_BODY_BYTES
    : Number(env.MAX_INBOUND_DECODED_BODY_BYTES);

  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MAX_DECODED_BODY_BYTES;
  }

  const value = Math.floor(configured);
  return value >= 1 ? Math.min(value, HARD_MAX_DECODED_BODY_BYTES) : DEFAULT_MAX_DECODED_BODY_BYTES;
}

export function isInboundSizeAllowed(messageSize: number, limit: number): boolean {
  return Number.isSafeInteger(messageSize) && messageSize >= 0 && messageSize <= limit;
}

function capText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, maxChars);
}

function cleanHeaderValue(value: unknown, maxChars: number): string {
  return capText(value, maxChars).replace(/[\r\n]+/g, ' ').trim();
}

export function normalizeEnvelopeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEnvelopeAddress(value: string): boolean {
  if (!value || value.length > MAX_ADDRESS_CHARS || /[\s\u0000-\u001f\u007f]/.test(value)) return false;

  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) return false;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return local.length <= 64 && domain.length <= 255 && !domain.startsWith('.') && !domain.endsWith('.');
}

function normalizeStoredAddress(value: unknown): string {
  return cleanHeaderValue(value, MAX_ADDRESS_CHARS).toLowerCase();
}

function sanitizeFilename(value: unknown): string {
  const filename = capText(value, MAX_FILENAME_CHARS)
    .replace(/[\r\n"\\/]/g, '_')
    .trim();
  return filename || 'unnamed';
}

function sanitizeContentType(value: unknown): string {
  const contentType = cleanHeaderValue(value, MAX_CONTENT_TYPE_CHARS);
  return /^[\w.+/-]+(?:;\s*[\w.+-]+=(?:[\w.+/-]+|"[^"]*"))*$/.test(contentType)
    ? contentType
    : 'application/octet-stream';
}

function extractExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).trim().toLowerCase() : '';
}

function extractSnippet(text: string | undefined, maxLen = 200): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  return `<div style="white-space:pre-wrap;overflow-wrap:anywhere;">${escapeHtml(normalized)}</div>`;
}

export type PreparedInboundBody =
  | { ok: true; html: string }
  | { ok: false; reason: 'input_bytes' | 'elements' | 'depth' | 'invalid' | 'output_bytes' };

/**
 * Bounds cheap byte/tag/depth metrics before parsing HTML, then stores only
 * the shared presentation-only sanitizer output. Plain text is escaped before
 * taking the same bounded path.
 */
export function prepareInboundBody(
  html: string | undefined,
  text: string | undefined,
  maxBytes: number,
): PreparedInboundBody {
  const plain = text || '';
  if (!html && ENCODER.encode(plain).byteLength > maxBytes) {
    return { ok: false, reason: 'input_bytes' };
  }
  const source = html || plainTextToHtml(plain);
  const result = sanitizeBoundedEmailHtml(source, {
    // Escaping safe plain text can expand one byte (for example `&`) to five.
    // Keep that parser input explicitly bounded, then apply the configured
    // ceiling to the sanitized representation that is actually retained.
    maxInputBytes: html ? maxBytes : maxBytes * 6,
    maxOutputBytes: maxBytes,
  });
  return result.ok ? { ok: true, html: result.html } : result;
}

export function inboundTransportFacts(
  headers: Headers,
  env?: { INBOUND_AUTHSERV_ID?: string },
): { sourceIp: string | null; spf: string | null; dkim: string | null; dmarc: string | null } {
  // These MIME headers stay sender-controlled until a trusted receiver
  // authserv-id boundary is explicitly configured. With INBOUND_AUTHSERV_ID
  // set, RFC 8601 results are taken from the topmost record and only when that
  // record came from the named boundary. Without it, nothing is recorded.
  const facts = parseAuthenticationResults(headers.get('authentication-results'), env?.INBOUND_AUTHSERV_ID);
  // `arc` is parsed but not persisted: mail_trace has no column for it, and a
  // boundary's ARC verdict is not our own chain validation.
  return { sourceIp: facts.sourceIp, spf: facts.spf, dkim: facts.dkim, dmarc: facts.dmarc };
}

export async function stableInboundId(mailboxId: string, messageIdHeader: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    ENCODER.encode(`${mailboxId}\u0000${messageIdHeader}`),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `inbound-${hex}`;
}

async function findExistingDelivery(
  db: D1Database,
  id: string,
  mailboxId: string,
  messageIdHeader: string | null,
): Promise<{ id: string; body_r2_key: string | null } | null> {
  if (messageIdHeader) {
    return db.prepare(
      `SELECT id, body_r2_key FROM messages
       WHERE id = ? OR (mailbox_id = ? AND message_id_header = ?)
       LIMIT 1`,
    ).bind(id, mailboxId, messageIdHeader).first<{ id: string; body_r2_key: string | null }>();
  }

  return db.prepare(
    'SELECT id, body_r2_key FROM messages WHERE id = ? LIMIT 1',
  ).bind(id).first<{ id: string; body_r2_key: string | null }>();
}

async function deleteR2Objects(storage: R2Bucket, keys: string[]): Promise<void> {
  await Promise.all(keys.map(async (key) => {
    try {
      await storage.delete(key);
    } catch (error) {
      console.error('Failed to clean up an inbound R2 object:', error instanceof Error ? error.message : 'unknown error');
    }
  }));
}

async function cleanupFailedDelivery(env: Env, messageId: string, r2Keys: string[]): Promise<void> {
  try {
    // D1 batches execute transactionally, so a cleanup cannot leave only half
    // of the relational rows behind.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM attachments WHERE message_id = ?').bind(messageId),
      env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(messageId),
    ]);
  } catch (error) {
    // Keep the R2 objects if relational cleanup failed: deleting them would
    // leave live database rows pointing at missing content.
    console.error('Failed to roll back an inbound database delivery:', error instanceof Error ? error.message : 'unknown error');
    return;
  }

  await deleteR2Objects(env.STORAGE, r2Keys);
}

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response('cmail inbound email worker (no HTTP API)', { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runRetention(env));
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const recipientAddress = normalizeEnvelopeAddress(message.to);
    const senderAddress = normalizeEnvelopeAddress(message.from);
    const messageSize = message.rawSize;
    const transport = inboundTransportFacts(message.headers, env);
    const sourceIp = transport.sourceIp;
    const inboundLimit = getInboundLimit(env);

    if (
      !isValidEnvelopeAddress(recipientAddress) ||
      !isValidEnvelopeAddress(senderAddress)
    ) {
      message.setReject('550 Invalid envelope address');
      // Do not turn arbitrary pre-mailbox address spray into durable D1 rows.
      return;
    }

    // Reject before reading message.raw so oversized messages never enter the
    // PostalMime buffering/parsing path.
    if (!isInboundSizeAllowed(messageSize, inboundLimit)) {
      message.setReject('552 Message exceeds the configured size limit');
      // Repeated oversized traffic is not persisted before mailbox controls.
      return;
    }

    // Look up recipient mailbox.
    const mailbox = await env.DB.prepare(
      'SELECT id, status FROM mailboxes WHERE address = ? AND status = ?',
    ).bind(recipientAddress, 'active').first<{ id: string; status: string }>();

    if (!mailbox) {
      message.setReject('550 User not found');
      // Unknown-recipient spray must not create unbounded trace/audit data.
      return;
    }

    const rawMessageIdHeader = (message.headers.get('message-id') || '').trim();
    if (rawMessageIdHeader.length > MAX_MESSAGE_ID_CHARS) {
      message.setReject('552 Message metadata exceeds the configured limit');
      return;
    }

    const messageIdHeader = cleanHeaderValue(rawMessageIdHeader, MAX_MESSAGE_ID_CHARS) || null;
    const messageId = messageIdHeader
      ? await stableInboundId(mailbox.id, messageIdHeader)
      : generateId();

    // Established duplicates are suppressed before quota consumption. The
    // reservation's unique delivery key closes the remaining concurrent race.
    const existing = await findExistingDelivery(env.DB, messageId, mailbox.id, messageIdHeader);
    if (existing && messageIdHeader) {
      // Idempotent replay suppression deliberately has no per-attempt trace;
      // otherwise one known Message-ID becomes an unbounded D1 write primitive.
      return;
    }

    const reservation = await reserveInboundDelivery(env, {
      mailboxId: mailbox.id,
      senderAddress,
      deliveryKey: messageId,
      messageBytes: messageSize,
    });
    if (reservation.status === 'duplicate') {
      return;
    }
    if (reservation.status !== 'accepted') {
      // Policy and dependency failures deliberately have the same temporary,
      // non-diagnostic SMTP response. Do not persist attacker-controlled PII
      // in trace/audit rows for guardrail denials.
      message.setReject('451 Message temporarily unavailable');
      console.warn(
        reservation.status === 'rejected'
          ? 'Inbound delivery rejected by configured protection policy'
          : 'Inbound protection unavailable; delivery failed closed',
      );
      return;
    }

    const reservationId = reservation.reservationId;
    let reservationSettled = reservationId === null;

    try {
      let parsed;
      try {
      const rawEmail = await new Response(message.raw).arrayBuffer();
      const parser = new PostalMime();
      parsed = await parser.parse(rawEmail);
      } catch {
        message.setReject('550 Message could not be parsed');
        await logTrace(env.DB, {
          direction: 'inbound',
          envelope_from: senderAddress,
          envelope_to: recipientAddress,
          status: 'rejected',
          status_detail: 'Message parsing failed',
          size_bytes: messageSize,
          source_ip: sourceIp,
        });
        return;
      }

    const preparedBody = prepareInboundBody(
      parsed.html,
      parsed.text,
      getDecodedBodyLimit(env),
    );
    if (!preparedBody.ok) {
      message.setReject('552 Message body exceeds the configured processing limit');
      await logTrace(env.DB, {
        direction: 'inbound',
        status: 'rejected',
        status_detail: 'Decoded body complexity limit exceeded',
        size_bytes: messageSize,
      });
      return;
    }

    const auth = transport;
    const attachments = parsed.attachments || [];

    if (attachments.length > getAttachmentLimit(env)) {
      message.setReject('552 Message exceeds the attachment count limit');
      await logTrace(env.DB, {
        direction: 'inbound',
        envelope_from: senderAddress,
        envelope_to: recipientAddress,
        header_from: parsed.from?.address || senderAddress,
        subject: parsed.subject || '',
        status: 'rejected',
        status_detail: 'Attachment count limit exceeded',
        size_bytes: messageSize,
        spf_result: auth.spf,
        dkim_result: auth.dkim,
        dmarc_result: auth.dmarc,
        source_ip: sourceIp,
      });
      return;
    }

    const preparedAttachments = attachments.map((attachment) => {
      const size = typeof attachment.content === 'string'
        ? ENCODER.encode(attachment.content).byteLength
        : attachment.content.byteLength;
      return {
        id: generateId(),
        filename: sanitizeFilename(attachment.filename),
        contentType: sanitizeContentType(attachment.mimeType),
        content: attachment.content,
        size,
      };
    });

    const totalAttachmentBytes = preparedAttachments.reduce((total, attachment) => total + attachment.size, 0);
    const attachmentByteLimit = Math.min(MAX_TOTAL_ATTACHMENT_BYTES, inboundLimit);
    if (!Number.isSafeInteger(totalAttachmentBytes) || totalAttachmentBytes > attachmentByteLimit) {
      message.setReject('552 Message exceeds the attachment size limit');
      await logTrace(env.DB, {
        direction: 'inbound',
        envelope_from: senderAddress,
        envelope_to: recipientAddress,
        header_from: parsed.from?.address || senderAddress,
        subject: parsed.subject || '',
        status: 'rejected',
        status_detail: 'Attachment byte limit exceeded',
        size_bytes: messageSize,
        spf_result: auth.spf,
        dkim_result: auth.dkim,
        dmarc_result: auth.dmarc,
        source_ip: sourceIp,
      });
      return;
    }

    const blockedAttachment = preparedAttachments.some(
      (attachment) => BLOCKED_EXTENSIONS.has(extractExtension(attachment.filename)),
    );
    if (blockedAttachment) {
      // Never echo an attacker-controlled filename in the SMTP rejection.
      message.setReject('550 Attachment type not allowed');
      await logTrace(env.DB, {
        direction: 'inbound',
        envelope_from: senderAddress,
        envelope_to: recipientAddress,
        header_from: parsed.from?.address || senderAddress,
        subject: parsed.subject || '',
        status: 'rejected',
        status_detail: 'Blocked attachment type',
        size_bytes: messageSize,
        spf_result: auth.spf,
        dkim_result: auth.dkim,
        dmarc_result: auth.dmarc,
        source_ip: sourceIp,
      });
      return;
    }

    const parsedTo = parsed.to || [];
    const parsedCc = parsed.cc || [];
    if (parsedTo.length + parsedCc.length > MAX_ADDRESSES) {
      message.setReject('552 Message exceeds the recipient metadata limit');
      await logTrace(env.DB, {
        direction: 'inbound',
        envelope_from: senderAddress,
        envelope_to: recipientAddress,
        status: 'rejected',
        status_detail: 'Recipient metadata limit exceeded',
        size_bytes: messageSize,
        source_ip: sourceIp,
      });
      return;
    }

    const toAddresses = parsedTo.map((address) => normalizeStoredAddress(address.address)).filter(Boolean);
    if (toAddresses.length === 0) toAddresses.push(recipientAddress);
    const ccAddresses = parsedCc.map((address) => normalizeStoredAddress(address.address)).filter(Boolean);
    const headerFrom = normalizeStoredAddress(parsed.from?.address) || senderAddress;
    const subject = cleanHeaderValue(parsed.subject, MAX_SUBJECT_CHARS) || '(no subject)';
    const rawInReplyTo = parsed.headers?.find((header) => header.key.toLowerCase() === 'in-reply-to')?.value;
    const inReplyTo = cleanHeaderValue(rawInReplyTo, MAX_MESSAGE_ID_CHARS) || null;

    const storageNamespace = generateId();
    const bodyKey = messageBodyR2Key(storageNamespace, generateId());
    const bodyContent = preparedBody.html;
    const newR2Keys: string[] = [];

    newR2Keys.push(bodyKey);
    try {
      await env.STORAGE.put(bodyKey, bodyContent);
    } catch (storageError) {
      // Deleting an absent key is harmless and also handles an ambiguous R2
      // response where the write succeeded before the request failed.
      await deleteR2Objects(env.STORAGE, newR2Keys);
      throw storageError;
    }

    let messageRowInserted = false;
    try {
      await env.DB.prepare(
        `INSERT INTO messages (id, mailbox_id, message_id_header, direction, from_address, to_addresses, cc_addresses, subject, snippet, body_r2_key, has_attachments, size_bytes, folder, is_read, is_starred, in_reply_to, thread_id, received_at, created_at)
         VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(
        messageId,
        mailbox.id,
        messageIdHeader,
        headerFrom,
        JSON.stringify(toAddresses),
        JSON.stringify(ccAddresses),
        subject,
        extractSnippet(parsed.text),
        bodyKey,
        preparedAttachments.length ? 1 : 0,
        messageSize,
        'inbox',
        inReplyTo,
        inReplyTo || messageIdHeader,
      ).run();
      messageRowInserted = true;
      // The D1 message-insert trigger atomically replaces the pending quota
      // charge with this messages.size_bytes row.
      reservationSettled = true;
    } catch (insertError) {
      // A deterministic-ID conflict means another concurrent delivery won.
      // Recheck before deleting our object in case D1 committed before an
      // ambiguous transport error was surfaced to this invocation.
      let recheckCompleted = false;
      let concurrentDelivery: { id: string; body_r2_key: string | null } | null = null;
      try {
        concurrentDelivery = await findExistingDelivery(env.DB, messageId, mailbox.id, messageIdHeader);
        recheckCompleted = true;
      } catch {
        // Leave the object in place if commit state cannot be determined.
      }

      if (concurrentDelivery?.body_r2_key === bodyKey) {
        messageRowInserted = true;
        reservationSettled = true;
      } else if (concurrentDelivery && messageIdHeader) {
        await deleteR2Objects(env.STORAGE, newR2Keys);
        return;
      } else {
        if (recheckCompleted) await deleteR2Objects(env.STORAGE, newR2Keys);
        throw insertError;
      }
    }

    try {
      for (const attachment of preparedAttachments) {
        // R2 keys contain only generated opaque IDs, never untrusted filenames.
        const attachmentKey = attachmentR2Key(storageNamespace, attachment.id);
        newR2Keys.push(attachmentKey);
        await env.STORAGE.put(attachmentKey, attachment.content);
        await env.DB.prepare(
          `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          attachment.id,
          messageId,
          attachment.filename,
          attachment.contentType,
          attachment.size,
          attachmentKey,
        ).run();
      }
    } catch (storageError) {
      if (messageRowInserted) {
        await cleanupFailedDelivery(env, messageId, newR2Keys);
      } else {
        await deleteR2Objects(env.STORAGE, newR2Keys);
      }
      throw storageError;
    }

    await logTrace(env.DB, {
      message_id_header: messageIdHeader,
      direction: 'inbound',
      envelope_from: senderAddress,
      envelope_to: recipientAddress,
      header_from: headerFrom,
      subject,
      size_bytes: messageSize,
      status: 'delivered',
      status_detail: 'OK',
      spf_result: auth.spf,
      dkim_result: auth.dkim,
      dmarc_result: auth.dmarc,
      source_ip: sourceIp,
    });
    ctx.waitUntil(sendNewMailNotifications(env, mailbox.id, messageId));
    } finally {
      if (!reservationSettled) {
        try {
          await releaseInboundReservation(env.DB, reservationId);
        } catch {
          // The pending quota charge has its own short expiry. Never include
          // sender, recipient, delivery key, or a raw database error in logs.
          console.error('Failed to release an incomplete inbound reservation');
        }
      }
    }
  },
};

async function logTrace(db: D1Database, trace: TraceInput): Promise<void> {
  const validDirections: ReadonlySet<TraceDirection> = new Set(['inbound', 'outbound']);
  const validStatuses: ReadonlySet<TraceStatus> = new Set([
    'delivered', 'bounced', 'rejected', 'quarantined', 'deferred', 'sent',
  ]);

  if (!validDirections.has(trace.direction) || !validStatuses.has(trace.status)) {
    console.error('Skipped invalid mail trace event');
    return;
  }

  const sizeBytes = typeof trace.size_bytes === 'number' && Number.isSafeInteger(trace.size_bytes) && trace.size_bytes >= 0
    ? trace.size_bytes
    : null;
  const spamScore = typeof trace.spam_score === 'number' && Number.isFinite(trace.spam_score)
    ? trace.spam_score
    : null;

  try {
    await db.prepare(
      `INSERT INTO mail_trace (trace_id, message_id_header, direction, timestamp, envelope_from, envelope_to, header_from, subject, size_bytes, status, status_detail, spf_result, dkim_result, dmarc_result, spam_score, source_ip)
       VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      generateId(),
      cleanHeaderValue(trace.message_id_header, MAX_MESSAGE_ID_CHARS) || null,
      trace.direction,
      normalizeStoredAddress(trace.envelope_from) || null,
      normalizeStoredAddress(trace.envelope_to) || null,
      normalizeStoredAddress(trace.header_from) || null,
      cleanHeaderValue(trace.subject, 512) || null,
      sizeBytes,
      trace.status,
      cleanHeaderValue(trace.status_detail, 512) || null,
      cleanHeaderValue(trace.spf_result, 32) || null,
      cleanHeaderValue(trace.dkim_result, 32) || null,
      cleanHeaderValue(trace.dmarc_result, 32) || null,
      spamScore,
      cleanHeaderValue(trace.source_ip, 64) || null,
    ).run();
  } catch (error) {
    // Trace failures must never reject or retry an otherwise valid delivery.
    console.error('Mail trace logging failed:', error instanceof Error ? error.message : 'unknown error');
  }
}

// Type declarations for Cloudflare Email Workers
interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
  reply(message: unknown): Promise<void>;
}
