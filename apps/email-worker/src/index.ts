// cmail inbound email worker
// Receives email via Cloudflare Email Routing, parses, stores in D1/R2.
// Outbound is handled directly by the web app (Cloudflare Email Service or Postmark) —
// this worker is inbound-only.
import PostalMime from 'postal-mime';
import { sendNewMailNotifications, type PushEnvironment } from '@cmail/shared/push';
import { sanitizeBoundedEmailHtml } from '@cmail/shared/sanitize-email';
import { parseMessageImportance } from '@cmail/shared/message-importance';
import {
  normalizeParticipantAddress,
  normalizeParticipants,
  sanitizeParticipantName,
  serializeParticipants,
  type MessageParticipant,
} from '@cmail/shared/message-participants';
import {
  readSpamScore,
  shouldQuarantine,
  spamQuarantineThreshold,
} from '@cmail/shared/inbound-risk';
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
  /** Native Cloudflare Email Service binding used by the private service endpoint. */
  EMAIL?: SendEmail;
  /**
   * Optional native Cloudflare per-colo abuse-signal counter for the actor
   * that submitted inbound mail. It never enforces ingress or skips D1 work.
   */
  INBOUND_ACTOR_RATE_LIMITER?: InboundRateLimitBinding;
  /** Optional native per-colo aggregate abuse-signal counter; non-enforcing. */
  INBOUND_GLOBAL_RATE_LIMITER?: InboundRateLimitBinding;
  /** Optional native per-colo limiter that bounds generic abuse-alert logs. */
  INBOUND_ABUSE_ALERT_RATE_LIMITER?: InboundRateLimitBinding;
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
  /**
   * Spam score at or above which inbound mail is filed into Junk instead of
   * Inbox. Unset means never quarantine, only record — Cloudflare does not
   * document the scale of the score it reports, so acting on it has to be a
   * deliberate choice made after watching real scores in the trace.
   */
  SPAM_QUARANTINE_SCORE?: string | number;
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
const MAX_OUTBOUND_PROXY_BYTES = 6 * 1024 * 1024;
const ENCODER = new TextEncoder();
const OPAQUE_STORAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Deliberately neutral: do not disclose whether this address never existed,
// was disabled, or belonged to an offboarded person. Cloudflare controls the
// permanent SMTP rejection and passes this plain-text reason to the sender;
// it does not cause Cmail to send mail.
export const RECIPIENT_UNAVAILABLE_SMTP_RESPONSE = 'cmail: recipient unavailable; verify the address or contact the organisation';
/** Structural type so the Worker can still run locally without the optional binding. */
export interface InboundRateLimitBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

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

const MESSAGE_ID_TOKEN_RX = /<[^<>\s@]+@[^<>\s@]+>/g;

/** Keep only a syntactically bounded msg-id token; comments and folding are discarded. */
export function normalizeMessageIdHeader(value: unknown): string | null {
  const clean = cleanHeaderValue(value, MAX_MESSAGE_ID_CHARS);
  return clean.match(MESSAGE_ID_TOKEN_RX)?.[0] || null;
}

/** Preserve the most recent bounded RFC References ancestry. */
export function normalizeReferencesHeader(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Preserve both ends before matching: the first token is the thread root and
  // the tail contains the newest ancestry. Never regex an unbounded header.
  const unfolded = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  const bounded = unfolded.length <= 8 * MAX_MESSAGE_ID_CHARS
    ? unfolded
    : `${unfolded.slice(0, MAX_MESSAGE_ID_CHARS)} ${unfolded.slice(-7 * MAX_MESSAGE_ID_CHARS)}`;
  const tokens = bounded.match(MESSAGE_ID_TOKEN_RX) || [];
  const root = tokens[0];
  if (!root) return null;
  const kept: string[] = [root];
  let length = root.length;
  const tail: string[] = [];
  for (let index = tokens.length - 1; index > 0 && kept.length + tail.length < 50; index -= 1) {
    const token = tokens[index];
    if (!token) continue;
    const nextLength = length + token.length + 1;
    if (nextLength > MAX_MESSAGE_ID_CHARS) break;
    tail.unshift(token);
    length = nextLength;
  }
  kept.push(...tail);
  return kept.length ? kept.join(' ') : null;
}

function normalizeContentId(value: unknown): string | null {
  const clean = cleanHeaderValue(value, 257).replace(/^cid:/i, '').trim();
  const unwrapped = clean.startsWith('<') && clean.endsWith('>') ? clean.slice(1, -1) : clean;
  return /^[^<>\s]{1,255}$/.test(unwrapped) ? unwrapped : null;
}

export function normalizeEnvelopeAddress(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Authentication-Results source IPs are usable only when inboundTransportFacts
 * obtained them from the configured, trusted authserv-id. Otherwise the
 * normalized (but still sender-controlled and spoofable) envelope sender is
 * the available pre-recipient actor. The input is SHA-256 pseudonymized before
 * it reaches Cloudflare's counter key; prefixes prevent source-type collisions.
 */
export async function inboundRateLimitActorKey(sourceIp: string | null, senderAddress: string): Promise<string> {
  const actor = sourceIp ? `trusted-source-ip\u0000${sourceIp}` : `envelope-sender\u0000${senderAddress}`;
  const digest = await crypto.subtle.digest('SHA-256', ENCODER.encode(actor));
  return `actor:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Native Rate Limiting bindings are deliberately optional and fail open: a
 * missing binding or an edge binding fault must not become a mail outage. The
 * Email Workers API documents setReject() as a permanent SMTP error, so these
 * bindings are observability-only rather than a false "temporary" rejection.
 * The configured binding itself is local to a Cloudflare colo, so the fixed
 * global key is a per-colo signal, not a global enforcement guarantee.
 */
async function allowByRateLimiter(limiter: InboundRateLimitBinding | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    return true;
  }
}

export async function inboundRateLimitThresholdObserved(
  env: Pick<Env, 'INBOUND_ACTOR_RATE_LIMITER' | 'INBOUND_GLOBAL_RATE_LIMITER'>,
  sourceIp: string | null,
  senderAddress: string,
): Promise<boolean> {
  const [actorAllowed, globalAllowed] = await Promise.all([
    allowByRateLimiter(env.INBOUND_ACTOR_RATE_LIMITER, await inboundRateLimitActorKey(sourceIp, senderAddress)),
    allowByRateLimiter(env.INBOUND_GLOBAL_RATE_LIMITER, 'inbound-email'),
  ]);
  return !actorAllowed || !globalAllowed;
}

/**
 * A separate one-per-minute native binding bounds observability itself. Unlike
 * the actor/global counters, absent or faulty alert capability suppresses the
 * log rather than failing open to log amplification. It never affects mail.
 */
async function mayEmitInboundAbuseAlert(limiter: InboundRateLimitBinding | undefined): Promise<boolean> {
  if (!limiter) return false;
  try {
    return (await limiter.limit({ key: 'inbound-abuse-alert' })).success;
  } catch {
    return false;
  }
}

export async function observeInboundRateLimitThreshold(
  env: Pick<Env, 'INBOUND_ACTOR_RATE_LIMITER' | 'INBOUND_GLOBAL_RATE_LIMITER' | 'INBOUND_ABUSE_ALERT_RATE_LIMITER'>,
  sourceIp: string | null,
  senderAddress: string,
): Promise<void> {
  if (await inboundRateLimitThresholdObserved(env, sourceIp, senderAddress)
    && await mayEmitInboundAbuseAlert(env.INBOUND_ABUSE_ALERT_RATE_LIMITER)) {
    // Intentionally generic: no source, recipient, message, or mailbox data.
    console.warn('Inbound native rate-limit threshold observed');
  }
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

type ParsedMailbox = { address?: string; name?: string; group?: ReadonlyArray<{ address?: string; name?: string }> };

/** Flatten PostalMime groups after parsing, retaining decoded names only as
 * display metadata and accepting only valid addr-specs for routing. */
export function flattenParsedParticipants(values: ReadonlyArray<ParsedMailbox> | undefined): MessageParticipant[] {
  const flattened: MessageParticipant[] = [];
  for (const entry of values || []) {
    const members = entry.group?.length ? entry.group : [entry];
    for (const mailbox of members) {
      const address = normalizeParticipantAddress(mailbox.address);
      if (address) flattened.push({ address, name: sanitizeParticipantName(mailbox.name) });
    }
  }
  return normalizeParticipants(flattened);
}

export function inboundFromParticipant(value: Pick<ParsedMailbox, 'address' | 'name'> | undefined, envelopeFrom: string): MessageParticipant {
  const address = normalizeParticipantAddress(value?.address);
  return address
    ? { address, name: sanitizeParticipantName(value?.name) }
    : { address: envelopeFrom, name: '' };
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

function decodeSnippetEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|amp|lt|gt|quot|#39|nbsp);/gi, (entity, decimal, hex) => {
    if (decimal || hex) {
      const codePoint = Number.parseInt(decimal || hex, decimal ? 10 : 16);
      return Number.isSafeInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ' ';
    }
    return ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' } as Record<string, string>)[entity.toLowerCase()] || ' ';
  });
}

export function extractInboundSnippet(text: string | undefined, sanitizedHtml = '', maxLen = 200): string {
  const source = text || decodeSnippetEntities(
    sanitizedHtml
      .replace(/<(?:br|hr)\b[^>]*>/gi, ' ')
      .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  );
  return source.replace(/\s+/g, ' ').trim().slice(0, maxLen);
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

/**
 * True when this mailbox has no prior correspondence with the sender in either
 * direction. Outbound counts deliberately: someone you have written to is not
 * a stranger, and badging their reply as first contact would train the reader
 * to ignore the badge.
 *
 * A lookup failure resolves to false. An unwarranted warning on a known
 * correspondent erodes trust in every later warning, so the quiet answer is
 * the safe one when we cannot tell.
 */
async function isFirstContact(
  db: D1Database,
  mailboxId: string,
  senderAddress: string,
): Promise<boolean> {
  if (!mailboxId || !senderAddress) return false;
  try {
    const prior = await db.prepare(
      `SELECT 1 AS seen FROM messages
       WHERE mailbox_id = ?
         AND (
           (direction = 'inbound' AND from_address = ?)
           OR (
             direction IN ('outbound', 'internal')
             AND EXISTS (
               SELECT 1 FROM json_each(messages.to_addresses)
               WHERE json_each.value = ?
             )
           )
         )
       LIMIT 1`,
    ).bind(mailboxId, senderAddress, senderAddress).first<{ seen: number }>();
    return !prior;
  } catch {
    return false;
  }
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

interface OutboundProxyPayload {
  from: string | { address: string; name: string };
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    content: string;
    filename: string;
    type: string;
    disposition: 'attachment';
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function proxyAddress(value: unknown): string | EmailAddress | null {
  if (typeof value === 'string') {
    const address = normalizeEnvelopeAddress(value);
    return isValidEnvelopeAddress(address) ? address : null;
  }
  if (!isRecord(value) || typeof value.address !== 'string' || typeof value.name !== 'string') return null;
  const address = normalizeEnvelopeAddress(value.address);
  const name = cleanHeaderValue(value.name, 120);
  return isValidEnvelopeAddress(address) && name ? { email: address, name } : null;
}

function parseOutboundProxyPayload(value: unknown): EmailMessageBuilder | null {
  if (!isRecord(value)) return null;
  const candidate = value as unknown as OutboundProxyPayload;
  const from = proxyAddress(candidate.from);
  const to = Array.isArray(candidate.to) ? candidate.to.map(proxyAddress) : [];
  const cc = Array.isArray(candidate.cc) ? candidate.cc.map(proxyAddress) : [];
  if (!from || !to.length || to.length + cc.length > 50 || [...to, ...cc].some((address) => !address)) return null;
  if (typeof candidate.subject !== 'string' || candidate.subject.length > MAX_SUBJECT_CHARS || /[\r\n]/.test(candidate.subject)) return null;
  if (typeof candidate.html !== 'string' || ENCODER.encode(candidate.html).byteLength > 5 * 1024 * 1024) return null;
  if (candidate.text !== undefined && (typeof candidate.text !== 'string' || ENCODER.encode(candidate.text).byteLength > 5 * 1024 * 1024)) return null;
  const replyTo = candidate.reply_to === undefined ? undefined : proxyAddress(candidate.reply_to);
  if (replyTo === null) return null;

  let headers: Record<string, string> | undefined;
  if (candidate.headers !== undefined) {
    if (!isRecord(candidate.headers)) return null;
    headers = {};
    for (const [name, value] of Object.entries(candidate.headers)) {
      const allowedName = /^(?:In-Reply-To|References|Importance)$/i.test(name) || /^X-[A-Za-z0-9_-]{1,98}$/.test(name);
      if (!allowedName || typeof value !== 'string' || !value || ENCODER.encode(value).byteLength > 2048 || /[\r\n\u0000]/.test(value)) return null;
      headers[name] = value;
    }
  }

  let attachments: EmailAttachment[] | undefined;
  if (candidate.attachments !== undefined) {
    if (!Array.isArray(candidate.attachments) || candidate.attachments.length > 32) return null;
    attachments = [];
    for (const attachment of candidate.attachments) {
      if (
        !isRecord(attachment)
        || typeof attachment.content !== 'string'
        || attachment.content.length > 8 * 1024 * 1024
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.content)
        || typeof attachment.filename !== 'string'
        || !attachment.filename
        || attachment.filename.length > MAX_FILENAME_CHARS
        || typeof attachment.type !== 'string'
        || attachment.type.length > MAX_CONTENT_TYPE_CHARS
        || attachment.disposition !== 'attachment'
      ) return null;
      attachments.push({
        content: attachment.content,
        filename: sanitizeFilename(attachment.filename),
        type: sanitizeContentType(attachment.type),
        disposition: 'attachment',
      });
    }
  }

  return {
    from,
    to: to as Array<string | EmailAddress>,
    ...(cc.length ? { cc: cc as Array<string | EmailAddress> } : {}),
    subject: candidate.subject,
    html: candidate.html,
    ...(candidate.text !== undefined ? { text: candidate.text } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(headers && Object.keys(headers).length ? { headers } : {}),
    ...(attachments?.length ? { attachments } : {}),
  };
}

function emailServiceFailureStatus(error: unknown): number {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
  const definiteClientCodes = new Set([
    'E_VALIDATION_ERROR', 'E_FIELD_MISSING', 'E_TOO_MANY_RECIPIENTS',
    'E_TOO_MANY_ATTACHMENTS', 'E_SENDER_NOT_VERIFIED', 'E_RECIPIENT_NOT_ALLOWED',
    'E_RECIPIENT_SUPPRESSED', 'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_CONTENT_TOO_LARGE',
    'E_HEADER_NOT_ALLOWED', 'E_HEADER_USE_API_FIELD',
    'E_HEADER_VALUE_INVALID', 'E_HEADER_VALUE_TOO_LONG', 'E_HEADER_NAME_INVALID',
    'E_HEADERS_TOO_LARGE', 'E_HEADERS_TOO_MANY',
  ]);
  return code === 'E_RATE_LIMIT_EXCEEDED' || code === 'E_DAILY_LIMIT_EXCEEDED'
    ? 429
    : definiteClientCodes.has(code) ? 422 : 503;
}

async function handleOutboundServiceRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // Service-binding callers preserve the URL supplied by Pages. Refuse every
  // public hostname as a second fail-closed layer in case a stale dashboard
  // route is ever attached to this Worker.
  if (
    url.hostname !== 'cmail-email-worker.internal'
    || url.pathname !== '/internal/send'
    || request.method !== 'POST'
  ) {
    return new Response('Not found', { status: 404 });
  }
  // 424 means no provider call was attempted; callers may safely release their
  // idempotency claim after the operator repairs the missing binding.
  if (!env.EMAIL) return Response.json({ success: false, error: 'Email binding unavailable' }, { status: 424 });
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OUTBOUND_PROXY_BYTES) {
    return Response.json({ success: false, error: 'Payload too large' }, { status: 413 });
  }

  let raw: ArrayBuffer;
  try {
    raw = await request.arrayBuffer();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }
  if (raw.byteLength > MAX_OUTBOUND_PROXY_BYTES) {
    return Response.json({ success: false, error: 'Payload too large' }, { status: 413 });
  }

  let payload: EmailMessageBuilder | null = null;
  try {
    payload = parseOutboundProxyPayload(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    // The caller receives a stable error without parser or provider detail.
  }
  if (!payload) return Response.json({ success: false, error: 'Invalid email payload' }, { status: 400 });

  try {
    const result = await env.EMAIL.send(payload);
    const messageId = typeof result?.messageId === 'string' ? result.messageId.trim() : '';
    if (!messageId || messageId.length > MAX_MESSAGE_ID_CHARS || /[\r\n\u0000]/.test(messageId)) {
      return Response.json({ success: false, error: 'Invalid provider response' }, { status: 502 });
    }
    return Response.json({ success: true, messageId });
  } catch (error) {
    const status = emailServiceFailureStatus(error);
    return Response.json({ success: false, error: 'Cloudflare Email Service rejected the request' }, { status });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleOutboundServiceRequest(request, env);
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
      message.setReject('Invalid envelope address');
      // Do not turn arbitrary pre-mailbox address spray into durable D1 rows.
      return;
    }

    // Reject before reading message.raw so oversized messages never enter the
    // PostalMime buffering/parsing path.
    if (!isInboundSizeAllowed(messageSize, inboundLimit)) {
      message.setReject('Message exceeds the configured size limit');
      // Repeated oversized traffic is not persisted before mailbox controls.
      return;
    }

    // These native Cloudflare counters are non-enforcing abuse signals. Email
    // Workers exposes setReject() as permanent SMTP failure, so no threshold
    // can skip D1 work or discard mail. A separate native alert binding permits
    // at most one generic no-PII warning per colo/minute.
    await observeInboundRateLimitThreshold(env, sourceIp, senderAddress);

    // Look up recipient mailbox.
    const mailbox = await env.DB.prepare(
      'SELECT id, status FROM mailboxes WHERE address = ? AND status = ?',
    ).bind(recipientAddress, 'active').first<{ id: string; status: string }>();

    if (!mailbox) {
      message.setReject(RECIPIENT_UNAVAILABLE_SMTP_RESPONSE);
      // Unknown-recipient spray must not create unbounded trace/audit data.
      return;
    }

    const rawMessageIdHeader = (message.headers.get('message-id') || '').trim();
    if (rawMessageIdHeader.length > MAX_MESSAGE_ID_CHARS) {
      message.setReject('Message metadata exceeds the configured limit');
      return;
    }

    const messageIdHeader = normalizeMessageIdHeader(rawMessageIdHeader);
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
      // Policy and dependency failures deliberately have the same generic,
      // non-diagnostic SMTP response. Do not persist attacker-controlled PII
      // in trace/audit rows for guardrail denials.
      message.setReject('Message cannot be accepted at this time');
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
      message.setReject('Message could not be parsed');
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
      message.setReject('Message body exceeds the configured processing limit');
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
      message.setReject('Message exceeds the attachment count limit');
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
        contentId: normalizeContentId(attachment.contentId),
        disposition: attachment.disposition === 'inline' || attachment.related ? 'inline' as const : 'attachment' as const,
        content: attachment.content,
        size,
      };
    });

    const totalAttachmentBytes = preparedAttachments.reduce((total, attachment) => total + attachment.size, 0);
    const attachmentByteLimit = Math.min(MAX_TOTAL_ATTACHMENT_BYTES, inboundLimit);
    if (!Number.isSafeInteger(totalAttachmentBytes) || totalAttachmentBytes > attachmentByteLimit) {
      message.setReject('Message exceeds the attachment size limit');
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
      message.setReject('Attachment type not allowed');
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

    const toParticipants = flattenParsedParticipants(parsed.to);
    const ccParticipants = flattenParsedParticipants(parsed.cc);
    const replyToParticipants = flattenParsedParticipants(parsed.replyTo);
    const toAddresses = toParticipants.map((entry) => entry.address);
    const ccAddresses = ccParticipants.map((entry) => entry.address);
    const replyToAddresses = replyToParticipants.map((entry) => entry.address);
    if (toAddresses.length + ccAddresses.length + replyToAddresses.length > MAX_ADDRESSES) {
      message.setReject('Message exceeds the recipient metadata limit');
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

    if (toAddresses.length === 0) {
      // Bcc-only and malformed To headers still need a useful delivery
      // context. Keep the routing and display metadata arrays in lockstep.
      toAddresses.push(recipientAddress);
      toParticipants.push({ address: recipientAddress, name: '' });
    }
    // A syntactically malformed From must not suppress the verified envelope
    // fallback. Its display name is meaningful only alongside a valid address.
    const parsedFrom = inboundFromParticipant(parsed.from, senderAddress);
    const headerFrom = parsedFrom.address;
    const fromName = parsedFrom.name;
    const subject = cleanHeaderValue(parsed.subject, MAX_SUBJECT_CHARS) || '(no subject)';
    const rawInReplyTo = parsed.headers?.find((header) => header.key.toLowerCase() === 'in-reply-to')?.value;
    const rawReferences = parsed.headers?.find((header) => header.key.toLowerCase() === 'references')?.value;
    const inReplyTo = normalizeMessageIdHeader(rawInReplyTo);
    const referencesHeader = normalizeReferencesHeader(rawReferences);
    const importance = parseMessageImportance(parsed.headers);
    const threadId = referencesHeader?.split(' ')[0] || inReplyTo || messageIdHeader;

    // Risk signals are resolved against the header From, because that is the
    // identity the reader is shown and the one a warning has to be about.
    const spamScore = readSpamScore(message.headers);
    const quarantined = shouldQuarantine(spamScore, spamQuarantineThreshold(env.SPAM_QUARANTINE_SCORE));
    const firstContact = await isFirstContact(env.DB, mailbox.id, headerFrom);

    const storageNamespace = generateId();
    const bodyKey = messageBodyR2Key(storageNamespace, generateId());
    const bodyContent = preparedBody.html;
    const newR2Keys: string[] = [];

    const storedAttachments = preparedAttachments.map((attachment) => ({
      ...attachment,
      storageKey: attachmentR2Key(storageNamespace, attachment.id),
    }));
    newR2Keys.push(bodyKey, ...storedAttachments.map((attachment) => attachment.storageKey));
    try {
      await env.STORAGE.put(bodyKey, bodyContent);
      for (const attachment of storedAttachments) {
        await env.STORAGE.put(attachment.storageKey, attachment.content);
      }
    } catch (storageError) {
      // Deleting absent keys is harmless and also handles an ambiguous R2
      // response where one write succeeded before the request failed.
      await deleteR2Objects(env.STORAGE, newR2Keys);
      throw storageError;
    }

    const messageInsert = env.DB.prepare(
      `INSERT INTO messages (id, mailbox_id, message_id_header, direction, from_address, from_name, to_addresses, cc_addresses, reply_to_addresses, to_participants, cc_participants, reply_to_participants, subject, snippet, body_r2_key, has_attachments, size_bytes, folder, is_read, is_starred, importance, in_reply_to, references_header, thread_id, spam_score, sender_first_contact, received_at, created_at)
       VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(
      messageId,
      mailbox.id,
      messageIdHeader,
      headerFrom,
      fromName,
      JSON.stringify(toAddresses),
      JSON.stringify(ccAddresses),
      JSON.stringify(replyToAddresses),
      serializeParticipants(toParticipants),
      serializeParticipants(ccParticipants),
      serializeParticipants(replyToParticipants),
      subject,
      extractInboundSnippet(parsed.text, preparedBody.html),
      bodyKey,
      preparedAttachments.some((attachment) => attachment.disposition === 'attachment') ? 1 : 0,
      messageSize,
      quarantined ? 'spam' : 'inbox',
      importance,
      inReplyTo,
      referencesHeader,
      threadId,
      spamScore,
      firstContact ? 1 : 0,
    );
    const attachmentInserts = storedAttachments.map((attachment) => env.DB.prepare(
      `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key, content_id, disposition)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      attachment.id,
      messageId,
      attachment.filename,
      attachment.contentType,
      attachment.size,
      attachment.storageKey,
      attachment.contentId,
      attachment.disposition,
    ));

    try {
      // D1 batches are transactional: message metadata and every attachment
      // row become visible together or not at all. This prevents a retry from
      // deduplicating against a partially persisted message.
      await env.DB.batch([messageInsert, ...attachmentInserts]);
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
        reservationSettled = true;
      } else if (concurrentDelivery && messageIdHeader) {
        await deleteR2Objects(env.STORAGE, newR2Keys);
        return;
      } else {
        if (recheckCompleted) await deleteR2Objects(env.STORAGE, newR2Keys);
        throw insertError;
      }
    }

    await logTrace(env.DB, {
      message_id_header: messageIdHeader,
      direction: 'inbound',
      envelope_from: senderAddress,
      envelope_to: recipientAddress,
      header_from: headerFrom,
      subject,
      size_bytes: messageSize,
      // 'quarantined' still means stored and readable — the message is in Junk,
      // not discarded. Nothing here ever drops mail.
      status: quarantined ? 'quarantined' : 'delivered',
      status_detail: quarantined ? 'Filed to Junk by spam score' : 'OK',
      spf_result: auth.spf,
      dkim_result: auth.dkim,
      dmarc_result: auth.dmarc,
      spam_score: spamScore,
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
