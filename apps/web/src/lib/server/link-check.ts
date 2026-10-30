// Click-time link checks against the local phishing-domain list (see
// packages/shared/src/link-blocklist.ts). A link is only ever redirected
// without a warning when cmail itself signed it; an unsigned /link URL always
// shows the interstitial, so /link can never be used as an open redirect.
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { LINK_BLOCKLIST_MAX_AGE_MS, LINK_BLOCKLIST_META_KEY, hostCandidates, isIpLiteral, shardKey, shardLists, shardOf } from '@cmail/shared/link-blocklist';

const SIGNATURE_CHARS = 22;
const MAX_CANDIDATES = 10;
// Signatures are re-made whenever a message is shown, so a short validity is
// invisible to readers. A copied /link URL stops redirecting silently after
// at most two weeks, and only ever for the reader it was made for.
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type LinkVerdict = 'listed' | 'not_listed' | 'unavailable' | 'uncheckable';

function linkKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('cmail-link-signing-key-v1').digest();
}

function signFor(secret: string, userId: string, href: string, window: number): string {
  return createHmac('sha256', linkKey(secret)).update(`${userId}\n${window}\n${href}`).digest('base64url').slice(0, SIGNATURE_CHARS);
}

export function linkSignature(secret: string, userId: string, href: string, now = Date.now()): string {
  return signFor(secret, userId, href, Math.floor(now / WINDOW_MS));
}

export function verifyLinkSignature(secret: string, userId: string, href: string, signature: string | null, now = Date.now()): boolean {
  if (!secret || !userId || !signature || signature.length !== SIGNATURE_CHARS) return false;
  const supplied = Buffer.from(signature);
  const window = Math.floor(now / WINDOW_MS);
  return [window, window - 1].some((candidate) => {
    const expected = Buffer.from(signFor(secret, userId, href, candidate));
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  });
}

/** Looks the host and its parent domains up in the local list. Never throws. A web host with no checkable name is 'uncheckable'. */
export async function checkLinkHost(storage: R2Bucket, host: string, now = Date.now()): Promise<LinkVerdict> {
  const candidates = hostCandidates(host);
  try {
    const meta = await storage.get(LINK_BLOCKLIST_META_KEY);
    if (!meta) return 'unavailable';
    const fetchedAt = Date.parse((JSON.parse(await meta.text()) as { fetchedAt?: string }).fetchedAt ?? '');
    if (!Number.isFinite(fetchedAt) || now - fetchedAt > LINK_BLOCKLIST_MAX_AGE_MS) return 'unavailable';
    if (candidates.length === 0) return isIpLiteral(host) ? 'not_listed' : 'uncheckable';
    // The closest parents are the ones lists name; capping bounds the reads per click.
    const byShard = new Map<string, string[]>();
    for (const candidate of candidates.slice(-MAX_CANDIDATES)) {
      const shard = shardOf(candidate);
      byShard.set(shard, [...(byShard.get(shard) ?? []), candidate]);
    }
    const results = await Promise.all([...byShard].map(async ([shard, inShard]) => {
      const object = await storage.get(shardKey(shard));
      return object ? shardLists(await object.text(), inShard) : null;
    }));
    if (results.includes(true)) return 'listed';
    return results.includes(null) ? 'unavailable' : 'not_listed';
  } catch {
    return 'unavailable';
  }
}
