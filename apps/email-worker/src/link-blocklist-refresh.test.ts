import { describe, expect, it, vi } from 'vitest';
import { LINK_BLOCKLIST_META_KEY, LINK_BLOCKLIST_SOURCE, shardKey, shardOf } from '@cmail/shared/link-blocklist';
import { refreshLinkBlocklist } from './link-blocklist-refresh';
import { memoryStorage } from './testing/delivery';

function storage() {
  const objects = new Map<string, string>();
  const bucket = {
    objects,
    get: vi.fn(async (key: string) => (objects.has(key) ? { text: async () => objects.get(key)! } : null)),
    put: vi.fn(async (key: string, body: string) => {
      objects.set(key, body);
    }),
  };
  return bucket;
}

const list = (count: number, prefix = 'phish') => Array.from({ length: count }, (_, index) => `${prefix}${index}.example`).join('\n');
const feed = (body: string, init: ResponseInit = {}) => vi.fn(async () => new Response(body, init));

describe('link blocklist refresh', () => {
  it('fetches the CERT Polska list, writes 256 shards and the meta last', async () => {
    const bucket = storage();
    const fetcher = feed(list(1500));
    const result = await refreshLinkBlocklist(bucket as unknown as R2Bucket, fetcher as unknown as typeof fetch, new Date('2026-10-31T00:00:00Z'));
    expect(result).toEqual({ status: 'updated', count: 1500, shardsWritten: 256 });
    expect(fetcher).toHaveBeenCalledWith(LINK_BLOCKLIST_SOURCE, expect.anything());
    expect(bucket.put.mock.calls.at(-1)![0]).toBe(LINK_BLOCKLIST_META_KEY);
    expect(bucket.objects.get(shardKey(shardOf('phish7.example')))).toContain('phish7.example');
    expect(JSON.parse(bucket.objects.get(LINK_BLOCKLIST_META_KEY)!)).toMatchObject({ count: 1500, fetchedAt: '2026-10-31T00:00:00.000Z' });
  });

  it('rewrites only the shards that changed', async () => {
    const bucket = storage();
    await refreshLinkBlocklist(bucket as unknown as R2Bucket, feed(list(1500)) as unknown as typeof fetch);
    const again = await refreshLinkBlocklist(bucket as unknown as R2Bucket, feed(`${list(1500)}\nnew-phish.example`) as unknown as typeof fetch);
    expect(again).toEqual({ status: 'updated', count: 1501, shardsWritten: 1 });
  });

  it.each([
    ['a failed download', () => feed('busy', { status: 503 })],
    ['a network error', () => vi.fn(async () => { throw new Error('timeout'); })],
    ['an oversized declared body', () => feed(list(1500), { headers: { 'content-length': String(26 * 1024 * 1024) } })],
    ['a list too small to be real', () => feed(list(10))],
  ])('keeps the last good copy after %s', async (_label, makeFetcher) => {
    const bucket = storage();
    await refreshLinkBlocklist(bucket as unknown as R2Bucket, feed(list(1500)) as unknown as typeof fetch);
    const before = new Map(bucket.objects);
    const result = await refreshLinkBlocklist(bucket as unknown as R2Bucket, makeFetcher() as unknown as typeof fetch);
    expect(result).toMatchObject({ status: 'kept', count: 1500 });
    expect(bucket.objects).toEqual(before);
  });

  it('keeps the last good copy when the list suddenly halves, but accepts it after three runs in a row', async () => {
    const bucket = storage();
    await refreshLinkBlocklist(bucket as unknown as R2Bucket, feed(list(4000)) as unknown as typeof fetch);
    const smaller = () => refreshLinkBlocklist(bucket as unknown as R2Bucket, feed(list(1500)) as unknown as typeof fetch);
    expect(await smaller()).toEqual({ status: 'kept', reason: 'shrank', count: 4000 });
    expect(await smaller()).toEqual({ status: 'kept', reason: 'shrank', count: 4000 });
    expect(await smaller()).toMatchObject({ status: 'updated', count: 1500 });
  });

  it('stops reading a body past the size cap even without a content-length', async () => {
    const bucket = storage();
    const big = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024).fill(97));
      },
    });
    const result = await refreshLinkBlocklist(bucket as unknown as R2Bucket, vi.fn(async () => new Response(big)) as unknown as typeof fetch);
    expect(result).toMatchObject({ status: 'kept', reason: 'too_large' });
  });

  it('works against the shared delivery-test storage shape too', async () => {
    const { storage: bucket } = memoryStorage();
    const result = await refreshLinkBlocklist({ ...bucket, get: vi.fn(async () => null) } as unknown as R2Bucket, feed(list(1200)) as unknown as typeof fetch);
    expect(result.status).toBe('updated');
  });
});
