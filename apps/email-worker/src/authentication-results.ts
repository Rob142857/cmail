/**
 * RFC 8601 Authentication-Results parsing, gated on a trusted boundary.
 *
 * An Authentication-Results header is only meaningful if you can attribute it
 * to an MTA you trust. Any sender can put `spf=pass` in a message. RFC 8601
 * §5 is explicit: a consumer must ignore results whose authserv-id is not its
 * own trusted identifier.
 *
 * So this module refuses to produce a verdict unless the operator has named
 * the boundary via INBOUND_AUTHSERV_ID, and the topmost record actually came
 * from it. With no configuration the behaviour is identical to recording
 * nothing, which is the safe default.
 *
 * Only the topmost record is considered. Workers joins repeated headers with
 * ", ", and the most recently added header — the one written by the boundary
 * closest to us — appears first. Anything after it was added further out and
 * is not ours to trust.
 */

export interface AuthenticationFacts {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  /** The boundary's ARC verdict, if it published one. Not our own validation. */
  arc: string | null;
  sourceIp: string | null;
}

export const NO_FACTS: AuthenticationFacts = {
  spf: null,
  dkim: null,
  dmarc: null,
  arc: null,
  sourceIp: null,
};

/** The RFC 8601 result values we accept. Anything else is discarded. */
const RESULTS = new Set([
  'none', 'pass', 'fail', 'softfail', 'neutral', 'temperror', 'permerror', 'policy',
]);

const METHODS = ['spf', 'dkim', 'dmarc', 'arc'] as const;
type Method = (typeof METHODS)[number];

/**
 * Cut the joined header value at the first top-level comma, so only the
 * topmost record is examined. Commas inside quoted strings and inside RFC 5322
 * comments belong to the record and must not split it.
 */
function firstRecord(value: string): string {
  let quoted = false;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      if (char === '\\') index += 1;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) return value.slice(0, index);
  }
  return value;
}

/** Strip RFC 5322 comments, which may appear between any two tokens. */
function stripComments(value: string): string {
  let out = '';
  let quoted = false;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      out += char;
      if (char === '\\' && index + 1 < value.length) { out += value[index + 1]; index += 1; }
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; out += char; }
    else if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += char;
  }
  return out;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return trimmed;
}

/** Accepts dotted-quad IPv4 and the common IPv6 forms, nothing else. */
function safeIp(value: string): string | null {
  const candidate = unquote(value);
  if (!candidate || candidate.length > 45) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate)) {
    return candidate.split('.').every((part) => Number(part) <= 255) ? candidate : null;
  }
  if (/^[0-9a-f:]{2,45}$/i.test(candidate) && candidate.includes(':')) return candidate.toLowerCase();
  return null;
}

/**
 * @param headerValue The raw Authentication-Results header, or null.
 * @param trustedAuthservId The operator's boundary identifier. Empty disables
 *   parsing entirely and yields no facts.
 */
export function parseAuthenticationResults(
  headerValue: string | null | undefined,
  trustedAuthservId: string | null | undefined,
): AuthenticationFacts {
  const trusted = (trustedAuthservId || '').trim().toLowerCase();
  const raw = (headerValue || '').trim();
  // Bound the input: a header line is 998 octets, and folding a handful of
  // records cannot legitimately exceed this.
  if (!trusted || !raw || raw.length > 4096) return { ...NO_FACTS };

  const record = stripComments(firstRecord(raw)).trim();
  const separator = record.indexOf(';');
  if (separator < 0) return { ...NO_FACTS };

  // authserv-id, optionally followed by a version number (RFC 8601 §2.2).
  const identifier = record.slice(0, separator).trim().split(/\s+/)[0] || '';
  if (identifier.toLowerCase() !== trusted) return { ...NO_FACTS };

  const facts: AuthenticationFacts = { ...NO_FACTS };
  const body = record.slice(separator + 1);

  for (const method of METHODS) {
    // First occurrence wins; `\b` would match inside "dkim-atps".
    const match = new RegExp(`(?:^|[;\\s])${method}\\s*=\\s*([A-Za-z]+)`, 'i').exec(body);
    if (!match) continue;
    const result = (match[1] || '').toLowerCase();
    if (RESULTS.has(result)) facts[method as Method] = result;
  }

  // Some boundaries publish the connecting address as a property. Take it only
  // from the record we already decided to trust.
  const ip = /(?:smtp\.remote-ip|policy\.iprev|policy\.client-ip)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s;]+)/i.exec(body);
  if (ip?.[1]) facts.sourceIp = safeIp(ip[1]);

  return facts;
}
