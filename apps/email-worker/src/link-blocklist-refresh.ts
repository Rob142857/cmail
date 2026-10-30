// Scheduled refresh of the local phishing-domain list (see
// packages/shared/src/link-blocklist.ts). Any failure keeps the last good
// copy: shards are only replaced by a complete, plausible new list, and the
// meta object is written last. Logs carry counts only.
import {
  LINK_BLOCKLIST_META_KEY,
  LINK_BLOCKLIST_SOURCE,
  buildShards,
  fnv1a,
  parseDomainList,
  shardKey,
  type LinkBlocklistMeta,
} from '@cmail/shared/link-blocklist';

export const LINK_BLOCKLIST_CRON = '7 * * * *';

const FETCH_TIMEOUT_MS = 20_000;
const MAX_LIST_BYTES = 25 * 1024 * 1024;
const MIN_ENTRIES = 1_000;
/** A list less than half the last size is treated as a bad download until three such downloads have been seen. */
const MIN_SHRINK_RATIO = 0.5;
const SHRINK_RUNS_TO_ACCEPT = 3;

export type LinkBlocklistRefresh =
  | { status: 'updated'; count: number; shardsWritten: number }
  | { status: 'kept'; reason: 'fetch_failed' | 'too_large' | 'too_small' | 'shrank'; count: number | null };

/** The body as text, or null as soon as it passes `limit` bytes (no content-length needed). */
async function readCapped(response: Response, limit: number): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readMeta(storage: R2Bucket): Promise<LinkBlocklistMeta | null> {
  try {
    const object = await storage.get(LINK_BLOCKLIST_META_KEY);
    return object ? JSON.parse(await object.text()) as LinkBlocklistMeta : null;
  } catch {
    return null;
  }
}

export async function refreshLinkBlocklist(
  storage: R2Bucket,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<LinkBlocklistRefresh> {
  const previous = await readMeta(storage);
  let text: string;
  try {
    const response = await fetcher(LINK_BLOCKLIST_SOURCE, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return { status: 'kept', reason: 'fetch_failed', count: previous?.count ?? null };
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_LIST_BYTES) return { status: 'kept', reason: 'too_large', count: previous?.count ?? null };
    const read = await readCapped(response, MAX_LIST_BYTES);
    if (read === null) return { status: 'kept', reason: 'too_large', count: previous?.count ?? null };
    text = read;
  } catch {
    return { status: 'kept', reason: 'fetch_failed', count: previous?.count ?? null };
  }

  const domains = parseDomainList(text);
  if (domains.length < MIN_ENTRIES) return { status: 'kept', reason: 'too_small', count: previous?.count ?? null };
  if (previous && domains.length < previous.count * MIN_SHRINK_RATIO && (previous.shrinkSeen ?? 0) + 1 < SHRINK_RUNS_TO_ACCEPT) {
    // Remember it: a genuinely smaller list is accepted on the third such download (failed downloads in between don't count either way).
    await storage.put(LINK_BLOCKLIST_META_KEY, JSON.stringify({ ...previous, shrinkSeen: (previous.shrinkSeen ?? 0) + 1 }), { httpMetadata: { contentType: 'application/json' } });
    return { status: 'kept', reason: 'shrank', count: previous.count };
  }

  const checksums: Record<string, string> = {};
  let shardsWritten = 0;
  for (const [shard, shardText] of buildShards(domains)) {
    const checksum = fnv1a(shardText);
    checksums[shard] = checksum;
    if (previous?.checksums?.[shard] === checksum) continue;
    await storage.put(shardKey(shard), shardText, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
    shardsWritten += 1;
  }
  const meta: LinkBlocklistMeta = { source: LINK_BLOCKLIST_SOURCE, fetchedAt: now.toISOString(), count: domains.length, checksums };
  await storage.put(LINK_BLOCKLIST_META_KEY, JSON.stringify(meta), { httpMetadata: { contentType: 'application/json' } });
  return { status: 'updated', count: domains.length, shardsWritten };
}
