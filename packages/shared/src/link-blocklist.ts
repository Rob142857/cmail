// A local copy of a public phishing-domain list, checked when a reader clicks
// a link. The list is fetched by the email Worker on a schedule and stored as
// 256 small shards in R2, so the web app reads one small object per click and
// nothing about the click ever leaves the deployment.
//
// Source: CERT Polska Warning List (https://cert.pl/en/warning-list/), whose
// data usage policy allows any use including commercial. It mostly covers
// threats aimed at Polish users, so it is a backstop, not complete protection:
// a link that is not listed is simply opened, never described as safe.

export const LINK_BLOCKLIST_SOURCE = 'https://hole.cert.pl/domains/v2/domains.txt';
export const LINK_BLOCKLIST_PREFIX = 'link-blocklist/v1/';
export const LINK_BLOCKLIST_META_KEY = `${LINK_BLOCKLIST_PREFIX}meta.json`;
export const LINK_BLOCKLIST_SHARDS = 256;
/** A list older than this is treated as unavailable, so a dead refresh shows up in logs. */
export const LINK_BLOCKLIST_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

// Labels may hold underscores (URL parsers allow them in hostnames); the
// top-level label must contain a letter, so IPv4 addresses never match.
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+(?=[a-z0-9-]*[a-z])[a-z0-9-]{2,63}$/;

export interface LinkBlocklistMeta {
  source: string;
  fetchedAt: string;
  count: number;
  /** Consecutive refreshes that saw a list less than half the size; accepted after 3. */
  shrinkSeen?: number;
  /** FNV-1a checksum of each shard's text, by shard id, so unchanged shards are not rewritten. */
  checksums: Record<string, string>;
}

/** Lower-cased host without a trailing dot, or '' when it is not a DNS name. */
export function normalizeHost(host: string): string {
  const value = host.trim().toLowerCase().replace(/\.$/, '');
  return DOMAIN.test(value) ? value : '';
}

/** The host and each parent domain with at least two labels: a.b.example.com -> a.b.example.com, b.example.com, example.com. */
export function hostCandidates(host: string): string[] {
  // Each suffix is judged on its own, so an oddly formed leftmost label
  // (a-.evil.example, which URL parsers accept) can't hide a listed parent.
  const labels = host.trim().toLowerCase().replace(/\.$/, '').split('.');
  const candidates: string[] = [];
  for (let index = 0; index <= labels.length - 2; index += 1) {
    const suffix = normalizeHost(labels.slice(index).join('.'));
    if (suffix) candidates.push(suffix);
  }
  return candidates;
}

/** An IPv4 or bracketed IPv6 literal: the list holds names only, so these are never listed. */
export function isIpLiteral(host: string): boolean {
  return /^\[[0-9a-f:.]+\]$/i.test(host) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

/** 32-bit FNV-1a, as 8 hex characters. Fast and stable; not a security primitive. */
export function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Shard id ("00".."ff") a domain is stored in. */
export function shardOf(domain: string): string {
  return fnv1a(domain).slice(-2);
}

export function shardKey(shard: string): string {
  return `${LINK_BLOCKLIST_PREFIX}shards/${shard}.txt`;
}

/** Valid, de-duplicated domains from a one-domain-per-line list; comments and junk are skipped. */
export function parseDomainList(text: string, maxEntries = 2_000_000): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (seen.size >= maxEntries) break;
    let entry = line.split('#', 1)[0].trim();
    if (!entry) continue;
    // Unicode names are stored as punycode, the form URL parsers give hostnames.
    if (/[^\x00-\x7f]/.test(entry)) {
      try {
        entry = new URL(`http://${entry}/`).hostname;
      } catch {
        continue;
      }
    }
    const domain = normalizeHost(entry);
    if (domain) seen.add(domain);
  }
  return [...seen];
}

/** Every shard id with its sorted, newline-joined text (empty shards included, so stale ones are cleared). */
export function buildShards(domains: readonly string[]): Map<string, string> {
  const buckets = new Map<string, string[]>();
  for (let index = 0; index < LINK_BLOCKLIST_SHARDS; index += 1) buckets.set(index.toString(16).padStart(2, '0'), []);
  for (const domain of domains) buckets.get(shardOf(domain))!.push(domain);
  const shards = new Map<string, string>();
  for (const [shard, entries] of buckets) shards.set(shard, entries.sort().join('\n'));
  return shards;
}

/** Whether a shard's text lists any of the candidates that fall in that shard. */
export function shardLists(shardText: string, candidates: readonly string[]): boolean {
  if (!shardText) return false;
  const entries = new Set(shardText.split('\n'));
  return candidates.some((candidate) => entries.has(candidate));
}
