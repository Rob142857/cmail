// Outbound email provider abstraction.
// Auto-detects: Cloudflare Email Service > Postmark > disabled.

import { normalizeEmail } from './validation';
import {
  messageImportanceHeaders,
  normalizeMessageImportance,
} from '@cmail/shared/message-importance';
import type { MessageImportance } from '@cmail/shared/types';
import { createMimeMessage, Mailbox } from 'mimetext/browser';

export interface OutboundAttachment {
  filename: string;
  contentType: string;
  /** Raw bytes of the file. */
  content: Uint8Array;
}

export interface OutboundEmail {
  /** A plain email address. Use fromName for an optional display name. */
  from: string;
  fromName?: string;
  to: string | string[];
  cc?: string[];
  /** SMTP envelope recipients when they differ from visible To/Cc headers. */
  envelopeRecipients?: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** Sender-authored human importance; it does not alter transport priority. */
  importance?: MessageImportance;
  /** Stable RFC Message-ID requested from transports that support overriding it. */
  messageIdHeader?: string;
  attachments?: OutboundAttachment[];
}

export interface OutboundResult {
  success: boolean;
  provider: string;
  messageId?: string;
  /** Every opaque provider tracking identifier returned for this send. */
  providerMessageIds?: string[];
  /** Validated RFC Message-ID emitted by the provider, when available. */
  messageIdHeader?: string;
  /** The transport succeeded but its API does not expose the generated header. */
  messageIdUnavailable?: true;
  /** At least one recipient was reported as a permanent bounce. */
  partial?: true;
  /** Every recipient was permanently rejected; editing recipients may make the draft sendable. */
  permanentFailure?: true;
  /** Exact normalized permanent-bounce recipients reported by the provider. */
  permanentBounces?: string[];
  /** The provider may have accepted the message before the response was lost. */
  ambiguous?: true;
  error?: string;
}

export type ProviderName = 'cloudflare' | 'postmark' | 'none';

export type OutboundPreflightResult =
  | { ok: true; provider: Exclude<ProviderName, 'none'> }
  | { ok: false; provider: ProviderName; status: 400 | 413 | 503; error: string };

type SelectableProvider = Exclude<ProviderName, 'none'>;

interface CloudflareEmailPayload {
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

interface CloudflareRawEmailPayload {
  from: string;
  recipients: string[];
  mime_message: string;
}

interface CloudflareEmailResponse {
  success?: boolean;
  result?: {
    message_id?: unknown;
    delivered?: unknown;
    queued?: unknown;
    permanent_bounces?: unknown;
  } | null;
}

const CLOUDFLARE_ACCOUNT_ID_RX = /^[0-9a-f]{32}$/i;
const CLOUDFLARE_MAX_RECIPIENTS = 50;
const CLOUDFLARE_MAX_ATTACHMENTS = 32;
const CLOUDFLARE_MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
const POSTMARK_MAX_RECIPIENTS = 50;
const POSTMARK_MAX_BODY_BYTES = 5 * 1024 * 1024;
const POSTMARK_MAX_MESSAGE_BYTES = 10 * 1024 * 1024;
// Keep transport headroom below each provider's complete-message limit for
// base64 line wrapping, MIME boundaries, and generated headers.
const MIME_HEADROOM_BYTES = 256 * 1024;
const ENCODER = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // btoa is available in Workers runtime
  return btoa(binary);
}

function envString(env: Record<string, unknown>, name: string): string {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function validSecret(value: string): boolean {
  return value.length >= 16 && value.length <= 512 && !/[\s\u0000-\u001f\u007f]/.test(value);
}

function cloudflareServiceFetcher(env: Record<string, unknown>): Fetcher | null {
  const value = env.EMAIL_SERVICE;
  return value && typeof value === 'object' && typeof (value as { fetch?: unknown }).fetch === 'function'
    ? value as Fetcher
    : null;
}

function providerAvailable(provider: SelectableProvider, env: Record<string, unknown>): boolean {
  switch (provider) {
    case 'cloudflare':
      return Boolean(cloudflareServiceFetcher(env)) || (
        CLOUDFLARE_ACCOUNT_ID_RX.test(envString(env, 'CLOUDFLARE_ACCOUNT_ID'))
        && validSecret(envString(env, 'CLOUDFLARE_EMAIL_API_TOKEN'))
      );
    case 'postmark':
      return validSecret(envString(env, 'POSTMARK_API_KEY'));
  }
}

/**
 * Select an outbound provider. Explicit selections never fall back: a typo or
 * incomplete credential pair disables external delivery instead of silently
 * using a different account.
 */
export function detectProvider(env: Record<string, unknown>): ProviderName {
  const configured = envString(env, 'OUTBOUND_PROVIDER').toLowerCase();
  if (configured && configured !== 'auto') {
    if (!(['cloudflare', 'postmark'] as const).includes(configured as SelectableProvider)) {
      return 'none';
    }
    const selected = configured as SelectableProvider;
    return providerAvailable(selected, env) ? selected : 'none';
  }

  if (providerAvailable('cloudflare', env)) return 'cloudflare';
  if (providerAvailable('postmark', env)) return 'postmark';
  return 'none';
}

export function getProviderInfo(env: Record<string, unknown>): { name: ProviderName; label: string } {
  const name = detectProvider(env);
  const labels: Record<ProviderName, string> = {
    cloudflare: 'Cloudflare Email Service',
    postmark: 'Postmark',
    none: 'Disabled (internal only)',
  };
  return { name, label: labels[name] };
}

/** True when one Cloudflare REST raw-MIME call can keep envelope and headers distinct. */
export function supportsSeparatedEnvelope(env: Record<string, unknown>): boolean {
  return detectProvider(env) === 'cloudflare'
    && CLOUDFLARE_ACCOUNT_ID_RX.test(envString(env, 'CLOUDFLARE_ACCOUNT_ID'))
    && validSecret(envString(env, 'CLOUDFLARE_EMAIL_API_TOKEN'));
}

export async function sendEmail(email: OutboundEmail, env: Record<string, unknown>): Promise<OutboundResult> {
  const provider = detectProvider(env);

  switch (provider) {
    case 'cloudflare':
      return requiresSeparatedEnvelope(email) && supportsSeparatedEnvelope(env)
        ? sendViaCloudflare(
          email,
          envString(env, 'CLOUDFLARE_ACCOUNT_ID'),
          envString(env, 'CLOUDFLARE_EMAIL_API_TOKEN'),
        )
        : cloudflareServiceFetcher(env)
        ? sendViaCloudflareService(email, cloudflareServiceFetcher(env) as Fetcher)
        : sendViaCloudflare(
          email,
          envString(env, 'CLOUDFLARE_ACCOUNT_ID'),
          envString(env, 'CLOUDFLARE_EMAIL_API_TOKEN'),
        );
    case 'postmark':
      return sendViaPostmark(email, envString(env, 'POSTMARK_API_KEY'));
    case 'none':
      return { success: false, provider: 'none', error: 'No outbound provider configured' };
  }
}

function cleanDisplayName(value: string | undefined): string {
  return (value || '')
    .replace(/[\u0000-\u001f\u007f"\\]/g, '')
    .trim()
    .slice(0, 120);
}

function formattedFrom(email: OutboundEmail): string {
  const name = cleanDisplayName(email.fromName);
  return name ? `"${name}" <${email.from}>` : email.from;
}

function safeThreadHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;

  const result: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(headers)) {
    const canonical = name.toLowerCase() === 'in-reply-to'
      ? 'In-Reply-To'
      : name.toLowerCase() === 'references'
        ? 'References'
        : '';
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    const tokens = value.match(/<[^<>\s@]+@[^<>\s@]+>/g) || [];
    const normalized = canonical === 'In-Reply-To'
      ? tokens.slice(0, 1).join(' ')
      : tokens.join(' ');
    const maxValueLength = canonical ? 998 - canonical.length - 2 : 0;
    if (canonical && normalized && normalized.length <= maxValueLength) {
      result[canonical] = normalized;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join('\r\n') || '';
}

function encodedSubjectHeader(value: string): string {
  const chunks: string[] = [];
  let current = '';
  for (const character of value) {
    if (current && ENCODER.encode(current + character).byteLength > 45) {
      chunks.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current || !chunks.length) chunks.push(current);
  const words = chunks.map((chunk) => `=?UTF-8?B?${toBase64(ENCODER.encode(chunk))}?=`);
  return `Subject: ${words.join('\r\n ')}`;
}

function safeMimeFilename(value: string): string {
  const ascii = value.normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\;=]/g, '_')
    .trim()
    .slice(0, 180);
  return ascii || 'attachment';
}

function safeMimeContentType(value: string): string {
  const base = value.split(';', 1)[0]?.trim().toLowerCase() || '';
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(base)
    ? base
    : 'application/octet-stream';
}

function safeOutboundHeaders(email: OutboundEmail): Record<string, string> | undefined {
  const headers = {
    ...(safeThreadHeaders(email.headers) || {}),
    ...(messageImportanceHeaders(normalizeMessageImportance(email.importance)) || {}),
  };
  return Object.keys(headers).length ? headers : undefined;
}

function normalizedVisibleRecipients(email: OutboundEmail): string[] | null {
  const values = [
    ...(Array.isArray(email.to) ? email.to : [email.to]),
    ...(email.cc || []),
  ].map((address) => normalizeEmail(address));
  if (values.some((address) => !address)) return null;
  const recipients = values as string[];
  return new Set(recipients).size === recipients.length ? recipients : null;
}

function normalizedEnvelopeRecipients(email: OutboundEmail): string[] | null {
  const source = email.envelopeRecipients || normalizedVisibleRecipients(email);
  if (!source) return null;
  const values = source.map((address) => normalizeEmail(address));
  if (!values.length || values.some((address) => !address)) return null;
  const recipients = values as string[];
  return new Set(recipients).size === recipients.length ? recipients : null;
}

function requiresSeparatedEnvelope(email: OutboundEmail): boolean {
  const visible = normalizedVisibleRecipients(email);
  const envelope = normalizedEnvelopeRecipients(email);
  if (!visible || !envelope) return false;
  const visibleSet = new Set(visible);
  return envelope.length !== visible.length || envelope.some((address) => !visibleSet.has(address));
}

/** Build the full RFC 5322/MIME copy used when SMTP envelope and headers differ. */
export function buildRawMimeMessage(email: OutboundEmail): string | null {
  const from = normalizeEmail(email.from);
  const to = (Array.isArray(email.to) ? email.to : [email.to]).map((address) => normalizeEmail(address));
  const cc = (email.cc || []).map((address) => normalizeEmail(address));
  const replyTo = email.replyTo ? normalizeEmail(email.replyTo) : undefined;
  if (!from || !to.length || to.some((address) => !address) || cc.some((address) => !address)) return null;

  try {
    const message = createMimeMessage();
    const fromName = cleanDisplayName(email.fromName);
    message.setSender(fromName ? { addr: from, name: fromName } : from);
    message.setTo(to as string[]);
    if (cc.length) message.setCc(cc as string[]);
    message.setSubject(email.subject);
    if (replyTo) message.setHeader('Reply-To', new Mailbox(replyTo));
    for (const [name, value] of Object.entries(safeOutboundHeaders(email) || {})) {
      message.setHeader(name, value);
    }
    if (email.text !== undefined) {
      message.addMessage({
        contentType: 'text/plain',
        data: wrapBase64(message.toBase64(email.text)),
        encoding: 'base64',
      });
    }
    message.addMessage({
      contentType: 'text/html',
      data: wrapBase64(message.toBase64(email.html)),
      encoding: 'base64',
    });
    for (const attachment of email.attachments || []) {
      message.addAttachment({
        filename: safeMimeFilename(attachment.filename),
        contentType: safeMimeContentType(attachment.contentType),
        data: wrapBase64(toBase64(attachment.content)),
        encoding: 'base64',
      });
    }
    // Cloudflare controls Date and Message-ID. Omit MIMEText's generated values
    // so the provider can create the authoritative wire headers.
    const raw = message.asRaw()
      .replace(/^Subject:[^\r\n]*/im, encodedSubjectHeader(email.subject))
      .replace(/^(?:Date|Message-ID):[^\r\n]*\r\n/gim, '');
    const withoutCrlf = raw.replace(/\r\n/g, '');
    const lines = raw.split('\r\n');
    if (
      /\r|\n/.test(withoutCrlf)
      || /\r\nBcc:/i.test(raw)
      || /\u0000/.test(raw)
      || lines.some((line) => ENCODER.encode(line).byteLength > 998)
    ) return null;
    return raw;
  } catch {
    return null;
  }
}

function cloudflareRawPayload(email: OutboundEmail): CloudflareRawEmailPayload | null {
  const from = normalizeEmail(email.from);
  const recipients = normalizedEnvelopeRecipients(email);
  const mimeMessage = buildRawMimeMessage(email);
  return from && recipients && mimeMessage
    ? { from, recipients, mime_message: mimeMessage }
    : null;
}

function base64WireBytes(byteLength: number): number {
  const encoded = 4 * Math.ceil(byteLength / 3);
  return encoded + (2 * Math.ceil(encoded / 76));
}

function textWireBytes(value: string): number {
  const bytes = ENCODER.encode(value);
  let quotedPrintable = 0;
  for (const byte of bytes) {
    quotedPrintable += (byte === 9 || byte === 32 || (byte >= 33 && byte <= 126 && byte !== 61)) ? 1 : 3;
  }
  // Soft line breaks are three bytes. This deliberately overestimates both
  // common MIME transfer encodings so the final message stays below 5 MiB.
  quotedPrintable += 3 * Math.ceil(quotedPrintable / 73);
  return Math.max(quotedPrintable, base64WireBytes(bytes.byteLength));
}

function estimatedMimeBytes(email: OutboundEmail): number {
  const metadataBytes = ENCODER.encode([
    email.from,
    email.fromName || '',
    ...(Array.isArray(email.to) ? email.to : [email.to]),
    ...(email.cc || []),
    email.subject,
    email.replyTo || '',
    ...(email.envelopeRecipients || []),
    email.importance || '',
    email.messageIdHeader || '',
    ...Object.entries(email.headers || {}).flat(),
    ...(email.attachments || []).flatMap((attachment) => [attachment.filename, attachment.contentType]),
  ].join('\u0000')).byteLength;
  const bodyBytes = textWireBytes(email.html) + (email.text === undefined ? 0 : textWireBytes(email.text));
  const attachmentBytes = (email.attachments || []).reduce(
    (total, attachment) => total + base64WireBytes(attachment.content.byteLength),
    0,
  );
  return metadataBytes + bodyBytes + attachmentBytes;
}

function cloudflarePreflight(email: OutboundEmail): OutboundPreflightResult {
  const to = Array.isArray(email.to) ? email.to : [email.to];
  const cc = email.cc || [];
  const visibleRecipients = normalizedVisibleRecipients(email);
  const envelopeRecipients = normalizedEnvelopeRecipients(email);
  if (
    to.length + cc.length > CLOUDFLARE_MAX_RECIPIENTS
    || (envelopeRecipients?.length || 0) > CLOUDFLARE_MAX_RECIPIENTS
  ) {
    return {
      ok: false,
      provider: 'cloudflare',
      status: 400,
      error: `Cloudflare Email Service supports at most ${CLOUDFLARE_MAX_RECIPIENTS} recipients per message`,
    };
  }
  if ((email.attachments?.length || 0) > CLOUDFLARE_MAX_ATTACHMENTS) {
    return {
      ok: false,
      provider: 'cloudflare',
      status: 400,
      error: `Cloudflare Email Service supports at most ${CLOUDFLARE_MAX_ATTACHMENTS} attachments per message`,
    };
  }
  if (
    !normalizeEmail(email.from)
    || !to.length
    || !visibleRecipients
    || !envelopeRecipients
    || (email.replyTo !== undefined && !normalizeEmail(email.replyTo))
  ) {
    return { ok: false, provider: 'cloudflare', status: 400, error: 'The message contains an invalid email address' };
  }
  if (estimatedMimeBytes(email) > CLOUDFLARE_MAX_MESSAGE_BYTES - MIME_HEADROOM_BYTES) {
    return {
      ok: false,
      provider: 'cloudflare',
      status: 413,
      error: 'Cloudflare Email Service has a 5 MiB message limit. Reduce the message or attachments.',
    };
  }
  if (requiresSeparatedEnvelope(email)) {
    const raw = buildRawMimeMessage(email);
    if (!raw || ENCODER.encode(raw).byteLength > CLOUDFLARE_MAX_MESSAGE_BYTES - MIME_HEADROOM_BYTES) {
      return {
        ok: false,
        provider: 'cloudflare',
        status: raw ? 413 : 400,
        error: raw
          ? 'Cloudflare Email Service has a 5 MiB raw-message limit. Reduce the message or attachments.'
          : 'The message could not be encoded as standards-compliant MIME.',
      };
    }
  }
  return { ok: true, provider: 'cloudflare' };
}

function postmarkPreflight(email: OutboundEmail): OutboundPreflightResult {
  const to = Array.isArray(email.to) ? email.to : [email.to];
  const cc = email.cc || [];
  if (requiresSeparatedEnvelope(email)) {
    return {
      ok: false,
      provider: 'postmark',
      status: 400,
      error: 'Postmark cannot separate mixed local/external envelope recipients from visible To/Cc headers. Use Cloudflare Email Service for this message.',
    };
  }
  if (to.length + cc.length > POSTMARK_MAX_RECIPIENTS) {
    return {
      ok: false,
      provider: 'postmark',
      status: 400,
      error: `Postmark supports at most ${POSTMARK_MAX_RECIPIENTS} recipients per message`,
    };
  }
  if (
    !normalizeEmail(email.from)
    || !to.length
    || to.some((address) => !normalizeEmail(address))
    || cc.some((address) => !normalizeEmail(address))
    || (email.replyTo !== undefined && !normalizeEmail(email.replyTo))
  ) {
    return { ok: false, provider: 'postmark', status: 400, error: 'The message contains an invalid email address' };
  }
  if (
    ENCODER.encode(email.html).byteLength > POSTMARK_MAX_BODY_BYTES
    || (email.text !== undefined && ENCODER.encode(email.text).byteLength > POSTMARK_MAX_BODY_BYTES)
    || estimatedMimeBytes(email) > POSTMARK_MAX_MESSAGE_BYTES - MIME_HEADROOM_BYTES
  ) {
    return {
      ok: false,
      provider: 'postmark',
      status: 413,
      error: 'Postmark has a 10 MB total message limit. Reduce the message or attachments.',
    };
  }
  return { ok: true, provider: 'postmark' };
}

export function preflightEmail(email: OutboundEmail, env: Record<string, unknown>): OutboundPreflightResult {
  const provider = detectProvider(env);
  if (provider === 'none') {
    return {
      ok: false,
      provider,
      status: 503,
      error: 'External email delivery is not configured. Ask an administrator to configure an outbound provider.',
    };
  }
  return provider === 'cloudflare' ? cloudflarePreflight(email) : postmarkPreflight(email);
}

function cloudflarePayload(email: OutboundEmail): CloudflareEmailPayload | null {
  const from = normalizeEmail(email.from);
  const to = (Array.isArray(email.to) ? email.to : [email.to]).map((address) => normalizeEmail(address));
  const cc = (email.cc || []).map((address) => normalizeEmail(address));
  const replyTo = email.replyTo ? normalizeEmail(email.replyTo) : undefined;
  if (!from || to.some((address) => !address) || cc.some((address) => !address)) return null;

  const name = cleanDisplayName(email.fromName);
  const headers = safeOutboundHeaders(email);
  return {
    from: name ? { address: from, name } : from,
    to: to as string[],
    ...(cc.length ? { cc: cc as string[] } : {}),
    subject: email.subject,
    html: email.html,
    ...(email.text !== undefined ? { text: email.text } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(headers ? { headers } : {}),
    ...(email.attachments?.length ? {
      attachments: email.attachments.map((attachment) => ({
        content: toBase64(attachment.content),
        filename: attachment.filename,
        type: attachment.contentType,
        disposition: 'attachment' as const,
      })),
    } : {}),
  };
}

function safeProviderMessageIdHeader(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const header = value.trim();
  return header.length <= 998 && /^<[^<>\s]+@[^<>\s]+>$/.test(header) ? header : undefined;
}

function safeProviderTrackingId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  return id && id.length <= 998 && !/[\r\n\u0000]/.test(id) ? id : undefined;
}

function safeProviderTrackingIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > CLOUDFLARE_MAX_RECIPIENTS) return undefined;
  const ids = value.map(safeProviderTrackingId);
  if (ids.some((id) => !id)) return undefined;
  return ids as string[];
}

async function sendViaCloudflareService(email: OutboundEmail, service: Fetcher): Promise<OutboundResult> {
  try {
    const preflight = cloudflarePreflight(email);
    if (!preflight.ok) return { success: false, provider: 'cloudflare', error: preflight.error };
    if (requiresSeparatedEnvelope(email)) {
      return {
        success: false,
        provider: 'cloudflare',
        error: 'Separated SMTP-envelope delivery requires the Cloudflare REST raw-MIME transport',
      };
    }
    const payload = cloudflarePayload(email);
    if (!payload) return { success: false, provider: 'cloudflare', error: 'Message is not valid for Cloudflare Email Service' };
    const body = JSON.stringify(payload);
    if (ENCODER.encode(body).byteLength > CLOUDFLARE_MAX_MESSAGE_BYTES - MIME_HEADROOM_BYTES) {
      return { success: false, provider: 'cloudflare', error: 'Message exceeds the Cloudflare Email Service 5 MiB limit' };
    }
    const response = await service.fetch('https://cmail-email-worker.internal/internal/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!response.ok) {
      return {
        success: false,
        provider: 'cloudflare',
        ...(response.status >= 500 ? { ambiguous: true as const } : {}),
        error: `Cloudflare Email Service rejected the request (${response.status})`,
      };
    }
    const data = await response.json() as { success?: unknown; messageId?: unknown; messageIds?: unknown };
    const messageIds = data.success === true
      ? safeProviderTrackingIds(data.messageIds) || (safeProviderTrackingId(data.messageId) ? [safeProviderTrackingId(data.messageId) as string] : undefined)
      : undefined;
    if (!messageIds) {
      return { success: false, provider: 'cloudflare', ambiguous: true, error: 'Cloudflare Email Service returned an invalid response' };
    }
    return {
      success: true,
      provider: 'cloudflare',
      messageId: messageIds[0],
      providerMessageIds: messageIds,
      // The native binding returns Cloudflare delivery-tracking identifiers, not
      // the Message-ID Cloudflare writes to the wire. Shape alone cannot prove
      // that an opaque provider value is the authoritative RFC header.
      messageIdUnavailable: true,
    };
  } catch {
    return { success: false, provider: 'cloudflare', ambiguous: true, error: 'Cloudflare Email Service could not be reached' };
  }
}

// ─── Cloudflare Email Service (REST API) ────────────────
async function sendViaCloudflare(
  email: OutboundEmail,
  accountId: string,
  apiToken: string,
): Promise<OutboundResult> {
  try {
    // Avoid allocating large base64 strings that the provider will reject.
    const preflight = cloudflarePreflight(email);
    if (!preflight.ok) return { success: false, provider: 'cloudflare', error: preflight.error };

    const separatedEnvelope = requiresSeparatedEnvelope(email);
    const payload = separatedEnvelope ? cloudflareRawPayload(email) : cloudflarePayload(email);
    if (!payload) {
      return { success: false, provider: 'cloudflare', error: 'Message is not valid for Cloudflare Email Service' };
    }
    const body = JSON.stringify(payload);
    if (ENCODER.encode(body).byteLength > CLOUDFLARE_MAX_MESSAGE_BYTES - MIME_HEADROOM_BYTES) {
      return { success: false, provider: 'cloudflare', error: 'Message exceeds the Cloudflare Email Service 5 MiB limit' };
    }

    const endpoint = separatedEnvelope ? 'send_raw' : 'send';
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!res.ok) {
      return {
        success: false,
        provider: 'cloudflare',
        ...(res.status >= 500 ? { ambiguous: true as const } : {}),
        error: `Cloudflare Email Service rejected the request (${res.status})`,
      };
    }

    const data = await res.json() as CloudflareEmailResponse;
    const delivered = Array.isArray(data.result?.delivered) && data.result.delivered.every((value) => typeof value === 'string')
      ? data.result.delivered as string[] : null;
    const queued = Array.isArray(data.result?.queued) && data.result.queued.every((value) => typeof value === 'string')
      ? data.result.queued as string[] : null;
    const permanentBounces = Array.isArray(data.result?.permanent_bounces) && data.result.permanent_bounces.every((value) => typeof value === 'string')
      ? data.result.permanent_bounces as string[] : null;
    if (data.success !== true || !delivered || !queued || !permanentBounces || delivered.length + queued.length + permanentBounces.length === 0) {
      return {
        success: false,
        provider: 'cloudflare',
        ambiguous: true,
        error: 'Cloudflare Email Service returned an invalid response',
      };
    }
    const expectedRecipients = new Set(separatedEnvelope
      ? (payload as CloudflareRawEmailPayload).recipients
      : [...(payload as CloudflareEmailPayload).to, ...((payload as CloudflareEmailPayload).cc || [])]);
    const reportedRecipients = [...delivered, ...queued, ...permanentBounces]
      .map((address) => normalizeEmail(address));
    const uniqueReportedRecipients = new Set(reportedRecipients.filter((address): address is string => Boolean(address)));
    if (
      reportedRecipients.some((address) => !address)
      || uniqueReportedRecipients.size !== reportedRecipients.length
      || uniqueReportedRecipients.size !== expectedRecipients.size
      || [...expectedRecipients].some((address) => !uniqueReportedRecipients.has(address))
    ) {
      return {
        success: false,
        provider: 'cloudflare',
        ambiguous: true,
        error: 'Cloudflare Email Service returned incomplete recipient status',
      };
    }
    const providerMessageId = safeProviderTrackingId(data.result?.message_id);
    const messageIdHeader = safeProviderMessageIdHeader(providerMessageId);
    const normalizedPermanentBounces = permanentBounces
      .map((address) => normalizeEmail(address))
      .filter((address): address is string => Boolean(address));
    if (delivered.length + queued.length === 0) {
      return {
        success: false,
        provider: 'cloudflare',
        ...(providerMessageId ? { messageId: providerMessageId } : {}),
        ...(providerMessageId ? { providerMessageIds: [providerMessageId] } : {}),
        ...(messageIdHeader ? { messageIdHeader } : { messageIdUnavailable: true as const }),
        permanentFailure: true,
        permanentBounces: normalizedPermanentBounces,
        error: 'Cloudflare Email Service permanently rejected every recipient',
      };
    }
    return {
      success: true,
      provider: 'cloudflare',
      ...(providerMessageId ? { messageId: providerMessageId } : {}),
      ...(providerMessageId ? { providerMessageIds: [providerMessageId] } : {}),
      ...(messageIdHeader ? { messageIdHeader } : { messageIdUnavailable: true as const }),
      ...(normalizedPermanentBounces.length ? {
        partial: true as const,
        permanentBounces: normalizedPermanentBounces,
      } : {}),
    };
  } catch {
    return {
      success: false,
      provider: 'cloudflare',
      ambiguous: true,
      error: 'Cloudflare Email Service could not be reached',
    };
  }
}

// ─── Postmark ───────────────────────────
async function sendViaPostmark(email: OutboundEmail, apiKey: string): Promise<OutboundResult> {
  try {
    const preflight = postmarkPreflight(email);
    if (!preflight.ok) return { success: false, provider: 'postmark', error: preflight.error };
    const outboundHeaders = safeOutboundHeaders(email);
    const requestedMessageIdHeader = safeProviderMessageIdHeader(email.messageIdHeader);
    const postmarkHeaders = {
      ...(outboundHeaders || {}),
      ...(requestedMessageIdHeader ? { 'Message-ID': requestedMessageIdHeader } : {}),
    };
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': apiKey,
      },
      body: JSON.stringify({
        From: formattedFrom(email),
        To: Array.isArray(email.to) ? email.to.join(',') : email.to,
        Cc: email.cc?.join(','),
        Subject: email.subject,
        HtmlBody: email.html,
        TextBody: email.text,
        ReplyTo: email.replyTo,
        ...(Object.keys(postmarkHeaders).length ? {
          Headers: Object.entries(postmarkHeaders).map(([Name, Value]) => ({ Name, Value })),
        } : {}),
        MessageStream: 'outbound',
        Attachments: email.attachments?.map(a => ({
          Name: a.filename,
          Content: toBase64(a.content),
          ContentType: a.contentType,
        })),
      }),
    });

    if (!res.ok) {
      return {
        success: false,
        provider: 'postmark',
        ...(res.status >= 500 ? { ambiguous: true as const } : {}),
        error: `Postmark rejected the request (${res.status})`,
      };
    }

    const data = await res.json() as { MessageID?: unknown };
    const messageId = typeof data.MessageID === 'string' ? data.MessageID.trim() : '';
    if (!messageId || messageId.length > 998 || /[\r\n]/.test(messageId)) {
      return { success: false, provider: 'postmark', ambiguous: true, error: 'Postmark returned an invalid response' };
    }
    return {
      success: true,
      provider: 'postmark',
      messageId,
      providerMessageIds: [messageId],
      ...(requestedMessageIdHeader ? { messageIdHeader: requestedMessageIdHeader } : {}),
    };
  } catch {
    return { success: false, provider: 'postmark', ambiguous: true, error: 'Postmark could not be reached' };
  }
}
