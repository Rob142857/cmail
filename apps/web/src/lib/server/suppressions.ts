/**
 * Cloudflare Email Sending keeps a suppression list: after a hard bounce or a
 * spam complaint it refuses every later send to that address. This module
 * finds which recipients of a refused send are on it and, where Cloudflare
 * allows, lifts a bounce block so the sender can try again.
 *
 * Looking up and lifting entries needs CLOUDFLARE_ACCOUNT_ID and its own
 * token, CLOUDFLARE_SUPPRESSIONS_API_TOKEN ("Email Sending: Edit"). It is
 * separate from the REST send token so turning this on never changes how
 * mail is sent.
 * Without it, cmail's own bounce records name the likely address and an
 * administrator lifts the block in the Cloudflare dashboard.
 */

const ACCOUNT_ID_RX = /^[0-9a-f]{32}$/i;
const MAX_LOOKUPS = 10;
/** Cloudflare decides `read_only`; cmail also never lifts a complaint or policy block. */
const LIFTABLE_REASONS = new Set(['hard_bounce', 'soft_bounce']);

export interface BlockedRecipient {
  address: string;
  /** Cloudflare's reason, or cmail's own record when the API isn't configured. */
  reason: 'hard_bounce' | 'soft_bounce' | 'complaint' | 'manual' | 'policy' | 'bounced' | 'unknown';
  expiresAt: string | null;
  canUnblock: boolean;
}

interface SuppressionEntry {
  id: string;
  email: string;
  reason: string;
  read_only: boolean;
  expires_at: string | null;
  scope?: { type?: string; value?: string };
}

function envString(env: Record<string, unknown>, name: string): string {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function apiCredentials(env: Record<string, unknown>): { accountId: string; token: string } | null {
  const accountId = envString(env, 'CLOUDFLARE_ACCOUNT_ID');
  const token = envString(env, 'CLOUDFLARE_SUPPRESSIONS_API_TOKEN');
  if (!ACCOUNT_ID_RX.test(accountId)) return null;
  if (token.length < 16 || token.length > 512 || /[\s\u0000-\u001f\u007f]/.test(token)) return null;
  return { accountId, token };
}

export function suppressionApiAvailable(env: Record<string, unknown>): boolean {
  return apiCredentials(env) !== null;
}

function senderDomain(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1).toLowerCase().replace(/\.$/, '');
}

/** True when the entry blocks mail from this sending domain. */
function appliesTo(entry: SuppressionEntry, domain: string): boolean {
  const scope = entry.scope;
  if (!scope || scope.type === 'account') return true;
  return scope.type === 'sending_domain' && (scope.value || '').toLowerCase() === domain;
}

/**
 * cmail lifts only a bounce block scoped to this sending domain. An
 * account-wide entry also blocks other apps on the account, so an
 * administrator lifts it in the dashboard.
 */
function liftable(entry: SuppressionEntry, domain: string): boolean {
  return !entry.read_only
    && LIFTABLE_REASONS.has(entry.reason)
    && entry.scope?.type === 'sending_domain'
    && (entry.scope.value || '').toLowerCase() === domain;
}

function expired(entry: SuppressionEntry, now: number): boolean {
  if (!entry.expires_at) return false;
  const at = Date.parse(entry.expires_at);
  return Number.isFinite(at) && at <= now;
}

function knownReason(reason: string): BlockedRecipient['reason'] {
  return (['hard_bounce', 'soft_bounce', 'complaint', 'manual', 'policy'] as const)
    .find((value) => value === reason) || 'unknown';
}

function validEntry(value: unknown): value is SuppressionEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string' && entry.id.length <= 128
    && typeof entry.email === 'string'
    && typeof entry.reason === 'string'
    && typeof entry.read_only === 'boolean'
    && (entry.expires_at === null || entry.expires_at === undefined || typeof entry.expires_at === 'string');
}

/** Active entries for one address that block mail from `domain`; null when the lookup failed. */
async function entriesFor(
  credentials: { accountId: string; token: string },
  address: string,
  domain: string,
  fetcher: typeof fetch,
): Promise<SuppressionEntry[] | null> {
  try {
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/email/sending/suppressions?email=${encodeURIComponent(address)}`,
      { headers: { Authorization: `Bearer ${credentials.token}` } },
    );
    if (!response.ok) return null;
    const data = await response.json() as { result?: unknown };
    if (!Array.isArray(data.result)) return null;
    const now = Date.now();
    return data.result
      .filter(validEntry)
      .filter((entry) => entry.email.toLowerCase() === address.toLowerCase()
        && appliesTo(entry, domain)
        && !expired(entry, now));
  } catch {
    return null;
  }
}

/**
 * Which of `recipients` Cloudflare refuses for mail from `fromAddress`.
 * Falls back to cmail's own hard-bounce and complaint records when the API
 * isn't configured or the lookup fails.
 */
export async function findBlockedRecipients(
  db: D1Database,
  env: Record<string, unknown>,
  fromAddress: string,
  recipients: string[],
  fetcher: typeof fetch = fetch,
): Promise<BlockedRecipient[]> {
  const unique = [...new Set(recipients.map((value) => value.toLowerCase()))].slice(0, MAX_LOOKUPS);
  const domain = senderDomain(fromAddress);
  const credentials = apiCredentials(env);
  if (credentials) {
    const blocked: BlockedRecipient[] = [];
    let lookupFailed = false;
    for (const address of unique) {
      const entries = await entriesFor(credentials, address, domain, fetcher);
      if (!entries) { lookupFailed = true; continue; }
      if (!entries.length) continue;
      const first = entries[0];
      blocked.push({
        address,
        reason: knownReason(first.reason),
        expiresAt: first.expires_at || null,
        canUnblock: entries.every((entry) => liftable(entry, domain)),
      });
    }
    if (blocked.length || !lookupFailed) return blocked;
  }
  if (!unique.length) return [];
  try {
    // Only events for mail sent from this domain, like Cloudflare's own
    // sending-domain blocks; other domains' history isn't shown.
    const rows = await db.prepare(
      `SELECT lower(e.recipient) AS address,
              MAX(CASE WHEN e.event_type = 'complained' THEN 1 ELSE 0 END) AS complained
       FROM delivery_events e
       INNER JOIN mail_trace t ON t.trace_id = e.trace_id
       WHERE lower(e.recipient) IN (${unique.map(() => '?').join(', ')})
         AND lower(substr(t.envelope_from, instr(t.envelope_from, '@') + 1)) = ?
         AND (e.event_type = 'complained' OR (e.event_type = 'bounced' AND e.bounce_type = 'hard'))
       GROUP BY lower(e.recipient)`,
    ).bind(...unique, domain).all<{ address: string; complained: number }>();
    return (rows.results || []).map((row) => ({
      address: row.address,
      reason: row.complained ? 'complaint' : 'bounced',
      expiresAt: null,
      canUnblock: false,
    }));
  } catch {
    return [];
  }
}

export type UnblockOutcome = 'lifted' | 'not_blocked' | 'not_allowed' | 'unavailable';

/**
 * Lifts the bounce blocks on one address for mail from `fromAddress`.
 * Complaint, manual, policy, read-only and account-wide entries are never
 * touched. The list call filters by `email` (Cloudflare's troubleshooting
 * guide queries one recipient this way).
 */
export async function unblockRecipient(
  env: Record<string, unknown>,
  fromAddress: string,
  address: string,
  fetcher: typeof fetch = fetch,
): Promise<UnblockOutcome> {
  const credentials = apiCredentials(env);
  if (!credentials) return 'unavailable';
  const domain = senderDomain(fromAddress);
  const entries = await entriesFor(credentials, address, domain, fetcher);
  if (!entries) return 'unavailable';
  if (!entries.length) return 'not_blocked';
  if (!entries.every((entry) => liftable(entry, domain))) return 'not_allowed';
  for (const entry of entries) {
    try {
      const response = await fetcher(
        `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/email/sending/suppressions/${encodeURIComponent(entry.id)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${credentials.token}` } },
      );
      if (!response.ok && response.status !== 404) return 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
  return 'lifted';
}

/** Plain-words message for a send Cloudflare refused because of the list. */
export function blockedMessage(blocked: BlockedRecipient[]): string {
  if (!blocked.length) {
    return 'Cloudflare won\'t send this message: one of the recipients is on its block list, usually because an earlier email to them bounced. Check the addresses.';
  }
  const names = blocked.map((item) => item.address).join(', ');
  const complaint = blocked.some((item) => item.reason === 'complaint');
  const why = complaint
    ? 'they reported an earlier email as spam, or an earlier email to them bounced'
    : 'an earlier email to them bounced';
  return `Cloudflare won't send to ${names}: ${why}, so it blocks that address to protect your domain. Check the address is right.`;
}
