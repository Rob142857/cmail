import { describe, expect, it } from 'vitest';
import { matchContacts, type ContactEntry } from './contact-match';

// Fixed reference instant so recency-bucket tests are deterministic:
// 2026-08-20T12:00:00Z.
const NOW = Date.parse('2026-08-20T12:00:00Z');
const RECENT = '2026-08-10 12:00:00'; // 10 days ago -> weight 3
const MEDIUM = '2026-04-01 12:00:00'; // ~141 days ago -> weight 2
const STALE = '2025-01-01 12:00:00'; // >180 days ago -> weight 1

/** @param overrides partial ContactEntry */
function entry(overrides: Partial<ContactEntry>): ContactEntry {
  return { address: '', name: '', timesUsed: 0, lastUsedAt: '', ...overrides };
}

describe('matchContacts', () => {
  it('returns nothing for an empty or whitespace-only query', () => {
    const entries = [entry({ address: 'jane@example.com', name: 'Jane Doe' })];
    expect(matchContacts(entries, '', 8, NOW)).toEqual([]);
    expect(matchContacts(entries, '   ', 8, NOW)).toEqual([]);
  });

  it('matches on the first word of the display name', () => {
    const jane = entry({ address: 'jane@example.com', name: 'Jane Doe', timesUsed: 1, lastUsedAt: RECENT });
    const result = matchContacts([jane], 'jan', 8, NOW);
    expect(result.map((c) => c.address)).toEqual(['jane@example.com']);
  });

  it('matches on a later word of the display name (e.g. last name)', () => {
    const jane = entry({ address: 'jane@example.com', name: 'Jane Doe', timesUsed: 1, lastUsedAt: RECENT });
    const result = matchContacts([jane], 'doe', 8, NOW);
    expect(result.map((c) => c.address)).toEqual(['jane@example.com']);
  });

  it('matches on the address local-part when there is no display name', () => {
    const carol = entry({ address: 'carol@example.com', name: '', timesUsed: 1, lastUsedAt: RECENT });
    expect(matchContacts([carol], 'carol', 8, NOW).map((c) => c.address)).toEqual(['carol@example.com']);
    // A query longer than the local part cannot be a prefix of it.
    expect(matchContacts([carol], 'carolinexyz', 8, NOW)).toEqual([]);
  });

  it('is case-insensitive on both the query and the entries', () => {
    const jane = entry({ address: 'Jane@Example.com', name: 'Jane Doe', timesUsed: 1, lastUsedAt: RECENT });
    expect(matchContacts([jane], 'JAN', 8, NOW).map((c) => c.address)).toEqual(['jane@example.com']);
  });

  it('excludes entries that match none of name, address, or local-part', () => {
    const jane = entry({ address: 'jane@example.com', name: 'Jane Doe', timesUsed: 1, lastUsedAt: RECENT });
    expect(matchContacts([jane], 'zzz', 8, NOW)).toEqual([]);
  });

  it('ranks a recent-but-less-frequent history entry above a stale-but-frequent one', () => {
    // score = timesUsed * recencyWeight: 2 * 3 = 6 vs 5 * 1 = 5.
    const alpha = entry({ address: 'alpha@example.com', name: 'Team Alpha', timesUsed: 2, lastUsedAt: RECENT });
    const beta = entry({ address: 'beta@example.com', name: 'Team Beta', timesUsed: 5, lastUsedAt: STALE });
    const result = matchContacts([beta, alpha], 'team', 8, NOW);
    expect(result.map((c) => c.address)).toEqual(['alpha@example.com', 'beta@example.com']);
  });

  it('weighs a medium-age contact between recent and stale', () => {
    const recent = entry({ address: 'recent@example.com', name: 'Team Recent', timesUsed: 3, lastUsedAt: RECENT }); // 9
    const medium = entry({ address: 'medium@example.com', name: 'Team Medium', timesUsed: 3, lastUsedAt: MEDIUM }); // 6
    const stale = entry({ address: 'stale@example.com', name: 'Team Stale', timesUsed: 3, lastUsedAt: STALE }); // 3
    const result = matchContacts([medium, stale, recent], 'team', 8, NOW);
    expect(result.map((c) => c.address)).toEqual(['recent@example.com', 'medium@example.com', 'stale@example.com']);
  });

  it('ranks every history entry above directory-only entries', () => {
    const history = entry({ address: 'history@example.com', name: 'Team History', timesUsed: 1, lastUsedAt: STALE });
    const directory = entry({ address: 'directory@example.com', name: 'Team Directory', timesUsed: 0, lastUsedAt: '' });
    const result = matchContacts([directory, history], 'team', 8, NOW);
    expect(result.map((c) => c.address)).toEqual(['history@example.com', 'directory@example.com']);
  });

  it('breaks ties alphabetically by display label', () => {
    const zulu = entry({ address: 'zulu@example.com', name: 'Team Zulu', timesUsed: 0, lastUsedAt: '' });
    const echo = entry({ address: 'echo@example.com', name: 'Team Echo', timesUsed: 0, lastUsedAt: '' });
    const result = matchContacts([zulu, echo], 'team', 8, NOW);
    expect(result.map((c) => c.address)).toEqual(['echo@example.com', 'zulu@example.com']);
  });

  it('dedupes by address case-insensitively, keeping the first occurrence', () => {
    const first = entry({ address: 'Dup@Example.com', name: 'First', timesUsed: 3, lastUsedAt: RECENT });
    const second = entry({ address: 'dup@example.com', name: 'Second', timesUsed: 99, lastUsedAt: RECENT });
    const result = matchContacts([first, second], 'dup', 8, NOW);
    expect(result).toHaveLength(1);
    // First occurrence wins identity (name and timesUsed), not just the address.
    expect(result[0]).toMatchObject({ address: 'dup@example.com', name: 'First', timesUsed: 3 });
  });

  it('lets a later duplicate fill in a name the first occurrence left blank', () => {
    // Mirrors the intended call pattern: mailbox history first (often no
    // name), directory second (has a display name).
    const history = entry({ address: 'person@example.com', name: '', timesUsed: 4, lastUsedAt: RECENT });
    const directory = entry({ address: 'person@example.com', name: 'Directory Name', timesUsed: 0, lastUsedAt: '' });
    const result = matchContacts([history, directory], 'person', 8, NOW);
    expect(result).toHaveLength(1);
    // Identity (ranking-relevant fields) stays the history row's; only the
    // blank name is filled in.
    expect(result[0]).toMatchObject({ address: 'person@example.com', name: 'Directory Name', timesUsed: 4 });
  });

  it('does not let a later duplicate overwrite an already-present name', () => {
    const history = entry({ address: 'person@example.com', name: 'Original Name', timesUsed: 4, lastUsedAt: RECENT });
    const directory = entry({ address: 'person@example.com', name: 'Directory Name', timesUsed: 0, lastUsedAt: '' });
    const result = matchContacts([history, directory], 'person', 8, NOW);
    expect(result[0].name).toBe('Original Name');
  });

  it('defaults to the top 8 matches by rank, not input order', () => {
    const entries: ContactEntry[] = Array.from({ length: 10 }, (_, i) =>
      entry({ address: `team${i}@example.com`, name: `Team ${i}`, timesUsed: i, lastUsedAt: RECENT }));
    const result = matchContacts(entries, 'team', undefined, NOW);
    expect(result).toHaveLength(8);
    // Highest timesUsed (team9..team2) should win over the lower ones
    // (team1, team0) that get pushed out by the limit.
    expect(result.map((c) => c.address)).not.toContain('team0@example.com');
    expect(result.map((c) => c.address)).not.toContain('team1@example.com');
    expect(result[0].address).toBe('team9@example.com');
  });

  it('honors a custom limit', () => {
    const entries: ContactEntry[] = Array.from({ length: 5 }, (_, i) =>
      entry({ address: `team${i}@example.com`, name: `Team ${i}`, timesUsed: i, lastUsedAt: RECENT }));
    expect(matchContacts(entries, 'team', 3, NOW)).toHaveLength(3);
  });
});
