import { describe, expect, it } from 'vitest';
import { buildShards, fnv1a, hostCandidates, normalizeHost, parseDomainList, shardKey, shardLists, shardOf } from '@cmail/shared/link-blocklist';

describe('link blocklist helpers', () => {
  it('normalises hosts and rejects anything that is not a DNS name', () => {
    expect(normalizeHost(' Login.Example.COM. ')).toBe('login.example.com');
    expect(normalizeHost('localhost')).toBe('');
    expect(normalizeHost('192.0.2.10')).toBe('');
    expect(normalizeHost('x_y.example')).toBe('x_y.example');
    expect(normalizeHost('bad host.example')).toBe('');
    expect(normalizeHost('')).toBe('');
  });

  it('checks the host and every parent domain, never a bare top-level domain', () => {
    expect(hostCandidates('a.b.Example.com')).toEqual(['a.b.example.com', 'b.example.com', 'example.com']);
    expect(hostCandidates('example.com')).toEqual(['example.com']);
    expect(hostCandidates('com')).toEqual([]);
    expect(hostCandidates('[::1]')).toEqual([]);
  });

  it('hashes stably into one of 256 shards', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(shardOf('example.com')).toMatch(/^[0-9a-f]{2}$/);
    expect(shardOf('example.com')).toBe(shardOf('example.com'));
    expect(shardKey('0a')).toBe('link-blocklist/v1/shards/0a.txt');
  });

  it('parses a list, skipping comments, junk and duplicates, up to a limit', () => {
    const text = '# header\nevil.example\r\nEVIL.example\n\nnot a domain\nphish.test.example # note\nlocalhost\n';
    expect(parseDomainList(text)).toEqual(['evil.example', 'phish.test.example']);
    expect(parseDomainList('a.example\nb.example\nc.example', 2)).toHaveLength(2);
  });

  it('builds all 256 shards, including empty ones, and finds listed parents', () => {
    const shards = buildShards(['evil.example', 'phish.example.org']);
    expect(shards.size).toBe(256);
    const evil = shards.get(shardOf('evil.example'))!;
    expect(shardLists(evil, ['login.evil.example', 'evil.example'].filter((d) => shardOf(d) === shardOf('evil.example')))).toBe(true);
    expect(shardLists(evil, ['good.example'])).toBe(false);
    expect(shardLists('', ['evil.example'])).toBe(false);
    const total = [...shards.values()].filter(Boolean).flatMap((text) => text.split('\n'));
    expect(total.sort()).toEqual(['evil.example', 'phish.example.org']);
  });
});
