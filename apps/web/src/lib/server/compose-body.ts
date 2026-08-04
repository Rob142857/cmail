import { sanitizeBoundedEmailHtml } from '@cmail/shared/sanitize-email';
import { escapeHtml, htmlToPlainText, plainTextToHtml } from './validation';

const QUOTE_START = '<!--cmail-compose-quote:start-->';
const QUOTE_END = '<!--cmail-compose-quote:end-->';
const ENCODER = new TextEncoder();

export const MAX_COMPOSE_BODY_BYTES = 1024 * 1024;

const QUOTE_LIMITS = {
  maxInputBytes: 512 * 1024,
  maxOutputBytes: 512 * 1024,
  maxElements: 10_000,
  maxDepth: 128,
} as const;

export type ComposeBodyFailureReason =
  | 'input_bytes'
  | 'elements'
  | 'depth'
  | 'invalid'
  | 'output_bytes'
  | 'combined_bytes';

export type ComposeBodyResult =
  | {
      ok: true;
      html: string;
      text: string;
      snippet: string;
      authoredHtml: string;
      quotedHtml: string;
      quotedText: string;
    }
  | { ok: false; reason: ComposeBodyFailureReason };

export interface QuoteHeader {
  kind: 'reply' | 'forward';
  from: string;
  date: string;
  subject?: string;
  to?: string;
  cc?: string;
}

/** Accept only same-origin mail-list or message-view return targets. */
export function safeComposeReturnHref(value: string | null, fallback: string): string {
  if (!value || value.length > 2500 || /[\r\n\\]/.test(value)) return fallback;
  try {
    const base = new URL('https://cmail.invalid');
    const target = new URL(value, base);
    if (target.origin !== base.origin || !/^\/mail(?:\/[^/?#]+)?$/.test(target.pathname)) return fallback;
    if (target.pathname === '/mail/compose') return fallback;
    return `${target.pathname}${target.search}`;
  } catch {
    return fallback;
  }
}

function sanitizeQuote(value: string): { ok: true; html: string } | { ok: false; reason: ComposeBodyFailureReason } {
  if (!value.trim()) return { ok: true, html: '' };
  const result = sanitizeBoundedEmailHtml(value, QUOTE_LIMITS);
  if (!result.ok) return { ok: false, reason: result.reason };
  // Quoted tracking pixels must not phone home when the new recipient opens a
  // reply/forward. The shared sanitizer emits canonical double-quoted attrs.
  // cid: sources belong to attachments on the original message and cannot be
  // forwarded safely without rebuilding a multipart/related MIME tree.
  const withoutRemoteImages = result.html.replace(/\s+src="(?:https:|cid:)[^"]*"/gi, '');
  return { ok: true, html: withoutRemoteImages };
}

/**
 * Produces the inert quoted fragment shown below the plain-text authoring area.
 * Every source/body field is either escaped or passed through the bounded email
 * sanitizer before the fragment is returned to a route.
 */
export function buildQuotedMessageHtml(
  sourceHtml: string,
  header: QuoteHeader,
): { ok: true; html: string } | { ok: false; reason: ComposeBodyFailureReason } {
  const source = sanitizeQuote(sourceHtml);
  if (!source.ok) return source;

  const from = escapeHtml(header.from);
  const date = escapeHtml(header.date);
  let candidate: string;
  if (header.kind === 'forward') {
    const rows = [
      ['From', header.from],
      ['Date', header.date],
      ['Subject', header.subject || '(no subject)'],
      ['To', header.to || ''],
      ...(header.cc ? [['Cc', header.cc] as [string, string]] : []),
    ].map(([label, value]) => `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`).join('');
    candidate = `<hr><div><strong>Forwarded message</strong></div><div>${rows}</div><br><div>${source.html}</div>`;
  } else {
    candidate = `<div>On ${date}, ${from} wrote:</div><blockquote>${source.html}</blockquote>`;
  }

  return sanitizeQuote(candidate);
}

/** Build both MIME bodies and the HTML persisted for a draft/sent copy. */
export function prepareComposeBody(authoredText: string, submittedQuoteHtml = ''): ComposeBodyResult {
  const quote = sanitizeQuote(submittedQuoteHtml);
  if (!quote.ok) return quote;

  const authoredHtml = plainTextToHtml(authoredText);
  const html = quote.html
    ? `${authoredHtml}${QUOTE_START}${quote.html}${QUOTE_END}`
    : authoredHtml;
  if (ENCODER.encode(html).byteLength > MAX_COMPOSE_BODY_BYTES) {
    return { ok: false, reason: 'combined_bytes' };
  }

  const quotedText = quote.html ? htmlToPlainText(quote.html) : '';
  const text = [authoredText.trimEnd(), quotedText].filter(Boolean).join('\n\n');
  return {
    ok: true,
    html,
    text,
    snippet: text.replace(/\s+/g, ' ').trim().slice(0, 200),
    authoredHtml,
    quotedHtml: quote.html,
    quotedText,
  };
}

/**
 * Splits a body previously produced by prepareComposeBody. Markers are accepted
 * only as one exact, well-ordered pair. Any ambiguity falls back to treating the
 * whole body as authored text so content can never be silently hidden.
 */
export function splitStoredComposeBody(storedHtml: string): {
  authoredText: string;
  quotedHtml: string;
} {
  const start = storedHtml.indexOf(QUOTE_START);
  const end = storedHtml.indexOf(QUOTE_END);
  const hasOnePair = start >= 0
    && end > start
    && storedHtml.indexOf(QUOTE_START, start + QUOTE_START.length) === -1
    && storedHtml.indexOf(QUOTE_END, end + QUOTE_END.length) === -1
    && storedHtml.slice(end + QUOTE_END.length).trim() === '';

  if (!hasOnePair) {
    return { authoredText: htmlToPlainText(storedHtml), quotedHtml: '' };
  }

  const rawQuote = storedHtml.slice(start + QUOTE_START.length, end);
  const quote = sanitizeQuote(rawQuote);
  if (!quote.ok) {
    return { authoredText: htmlToPlainText(storedHtml), quotedHtml: '' };
  }
  return {
    authoredText: htmlToPlainText(storedHtml.slice(0, start)),
    quotedHtml: quote.html,
  };
}
