/**
 * Pure matching/ranking for the recipient-suggestion dropdown
 * (see EmailAutocomplete.svelte). Callers pass the mailbox's suggestion
 * history first and the organisation directory second, in one combined
 * list — duplicates by address are collapsed here, first occurrence wins,
 * but a later non-empty name can still fill an earlier blank one. That
 * mirrors packages/shared/src/message-participants.ts's
 * normalizeParticipants() dedupe idiom, so history rows (which carry a
 * name only when one was actually seen) win the identity while a
 * directory row can still supply a display name.
 */

export interface ContactEntry {
  address: string;
  name: string;
  /** Prior send/receive count for this mailbox; 0 for directory-only entries. */
  timesUsed: number;
  /** SQLite `datetime('now')`-style UTC timestamp, or '' when unknown. */
  lastUsedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 30;
const STALE_DAYS = 180;

function parseTimestamp(value: string): number {
  if (!value) return NaN;
  // SQLite's datetime('now') has no timezone marker and is UTC; make it
  // ISO-8601-parseable the same way across every JS engine.
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return Date.parse(iso);
}

/** More recent history counts for more than an equally-frequent but stale contact. */
function recencyWeight(lastUsedAt: string, now: number): number {
  const when = parseTimestamp(lastUsedAt);
  if (Number.isNaN(when)) return 1;
  const ageDays = (now - when) / DAY_MS;
  if (ageDays <= RECENT_DAYS) return 3;
  if (ageDays <= STALE_DAYS) return 2;
  return 1;
}

/** 0 for directory-only entries, so they always rank below any history entry. */
function historyScore(entry: ContactEntry, now: number): number {
  if (entry.timesUsed <= 0) return 0;
  return entry.timesUsed * recencyWeight(entry.lastUsedAt, now);
}

function dedupeByAddress(entries: readonly ContactEntry[]): ContactEntry[] {
  const order: string[] = [];
  const byAddress = new Map<string, ContactEntry>();
  for (const raw of entries) {
    const address = raw.address.trim().toLowerCase();
    if (!address) continue;
    const existing = byAddress.get(address);
    if (!existing) {
      byAddress.set(address, { ...raw, address });
      order.push(address);
    } else if (!existing.name && raw.name) {
      byAddress.set(address, { ...existing, name: raw.name });
    }
  }
  return order.map((address) => byAddress.get(address)!);
}

function localPart(address: string): string {
  const at = address.indexOf('@');
  return at >= 0 ? address.slice(0, at) : address;
}

/** `query` is already trimmed + lowercased by the caller (matchContacts). */
function matchesQuery(entry: ContactEntry, query: string): boolean {
  const address = entry.address.toLowerCase();
  if (address.startsWith(query) || localPart(address).startsWith(query)) return true;
  const name = entry.name.toLowerCase();
  if (!name) return false;
  return name.split(/\s+/).some((word) => word.startsWith(query));
}

function displayLabel(entry: ContactEntry): string {
  return (entry.name || entry.address).toLowerCase();
}

/**
 * Filters `entries` to those matching `query` (case-insensitive: a hit on
 * any whitespace-separated word of the display name, on the address, or on
 * the address local-part), then ranks history entries above directory-only
 * ones by a recency-weighted usage score, alphabetical on ties, and returns
 * at most `limit`.
 */
export function matchContacts(
  entries: readonly ContactEntry[],
  query: string,
  limit = 8,
  now: number = Date.now(),
): ContactEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return dedupeByAddress(entries)
    .filter((entry) => matchesQuery(entry, q))
    .sort((a, b) => {
      const scoreDiff = historyScore(b, now) - historyScore(a, now);
      if (scoreDiff !== 0) return scoreDiff;
      const labelA = displayLabel(a);
      const labelB = displayLabel(b);
      return labelA < labelB ? -1 : labelA > labelB ? 1 : 0;
    })
    .slice(0, limit);
}
