// Outbound email provider abstraction.
// Auto-detects: Cloudflare Email Service > Postmark > disabled.

import { normalizeEmail } from './validation';

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
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: OutboundAttachment[];
}

export interface OutboundResult {
  success: boolean;
  provider: string;
  messageId?: string;
  /** Validated RFC Message-ID emitted by the provider, when available. */
  messageIdHeader?: string;
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

interface CloudflareEmailResponse {
  success?: boolean;
  result?: {
    message_id?: string;
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

function providerAvailable(provider: SelectableProvider, env: Record<string, unknown>): boolean {
  switch (provider) {
    case 'cloudflare':
      return CLOUDFLARE_ACCOUNT_ID_RX.test(envString(env, 'CLOUDFLARE_ACCOUNT_ID'))
        && validSecret(envString(env, 'CLOUDFLARE_EMAIL_API_TOKEN'));
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

export async function sendEmail(email: OutboundEmail, env: Record<string, unknown>): Promise<OutboundResult> {
  const provider = detectProvider(env);

  switch (provider) {
    case 'cloudflare':
      return sendViaCloudflare(
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
    if (canonical && value && value.length <= 998 && !/[\r\n\u0000]/.test(value)) {
      result[canonical] = value;
    }
  }
  return Object.keys(result).length ? result : undefined;
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
  if (to.length + cc.length > CLOUDFLARE_MAX_RECIPIENTS) {
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
    || to.some((address) => !normalizeEmail(address))
    || cc.some((address) => !normalizeEmail(address))
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
  return { ok: true, provider: 'cloudflare' };
}

function postmarkPreflight(email: OutboundEmail): OutboundPreflightResult {
  const to = Array.isArray(email.to) ? email.to : [email.to];
  const cc = email.cc || [];
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
  const headers = safeThreadHeaders(email.headers);
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

    const payload = cloudflarePayload(email);
    if (!payload) {
      return { success: false, provider: 'cloudflare', error: 'Message is not valid for Cloudflare Email Service' };
    }
    const body = JSON.stringify(payload);
    if (ENCODER.encode(body).byteLength > CLOUDFLARE_MAX_MESSAGE_BYTES - MIME_HEADROOM_BYTES) {
      return { success: false, provider: 'cloudflare', error: 'Message exceeds the Cloudflare Email Service 5 MiB limit' };
    }

    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`, {
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
    const messageIdHeader = data.success === true
      ? safeProviderMessageIdHeader(data.result?.message_id)
      : undefined;
    if (!messageIdHeader) {
      return {
        success: false,
        provider: 'cloudflare',
        ambiguous: true,
        error: 'Cloudflare Email Service returned an invalid response',
      };
    }
    return { success: true, provider: 'cloudflare', messageId: messageIdHeader, messageIdHeader };
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
    const threadHeaders = safeThreadHeaders(email.headers);
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
        ...(threadHeaders ? {
          Headers: Object.entries(threadHeaders).map(([Name, Value]) => ({ Name, Value })),
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
    return { success: true, provider: 'postmark', messageId };
  } catch {
    return { success: false, provider: 'postmark', ambiguous: true, error: 'Postmark could not be reached' };
  }
}
