import { describe, expect, it } from 'vitest';
import {
  decideInboundPlacement,
  parseSpamScore,
  pickSenderRule,
  readSpamScore,
  shouldQuarantine,
  spamQuarantineThreshold,
} from '@cmail/shared/inbound-risk';

function headers(values: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

describe('parseSpamScore', () => {
  it('reads plain and signed decimals', () => {
    expect(parseSpamScore('0')).toBe(0);
    expect(parseSpamScore('5.4')).toBe(5.4);
    expect(parseSpamScore('-2.5')).toBe(-2.5);
    expect(parseSpamScore('  7 ')).toBe(7);
  });

  it('reads a leading score out of a decorated value', () => {
    expect(parseSpamScore('5.4/10')).toBe(5.4);
    expect(parseSpamScore('8.1 (spammy)')).toBe(8.1);
  });

  it('rejects values that are not a score', () => {
    expect(parseSpamScore('')).toBeNull();
    expect(parseSpamScore('none')).toBeNull();
    expect(parseSpamScore('NaN')).toBeNull();
    expect(parseSpamScore(undefined)).toBeNull();
    expect(parseSpamScore(12)).toBeNull();
  });

  it('rejects scores outside the plausible range', () => {
    expect(parseSpamScore('99999')).toBeNull();
  });
});

describe('readSpamScore', () => {
  it('prefers the Cloudflare header', () => {
    expect(readSpamScore(headers({ 'X-CF-SpamH-Score': '3.2', 'x-spam-score': '9' }))).toBe(3.2);
  });

  it('is case insensitive', () => {
    expect(readSpamScore(headers({ 'X-CF-SPAMH-SCORE': '4' }))).toBe(4);
  });

  it('falls back to conventional headers', () => {
    expect(readSpamScore(headers({ 'x-spam-score': '6.5' }))).toBe(6.5);
  });

  it('returns null when no header carries a score', () => {
    expect(readSpamScore(headers({ subject: 'hello' }))).toBeNull();
    expect(readSpamScore(headers({ 'x-cf-spamh-score': 'unknown' }))).toBeNull();
  });
});

describe('spamQuarantineThreshold', () => {
  it('accepts a deliberate number', () => {
    expect(spamQuarantineThreshold('8')).toBe(8);
    expect(spamQuarantineThreshold(8.5)).toBe(8.5);
    expect(spamQuarantineThreshold('0')).toBe(0);
  });

  it('treats unset, blank, and malformed configuration as disabled', () => {
    expect(spamQuarantineThreshold(undefined)).toBeNull();
    expect(spamQuarantineThreshold('')).toBeNull();
    expect(spamQuarantineThreshold('   ')).toBeNull();
    expect(spamQuarantineThreshold('high')).toBeNull();
    expect(spamQuarantineThreshold('8x')).toBeNull();
    expect(spamQuarantineThreshold(Number.NaN)).toBeNull();
  });
});

describe('shouldQuarantine', () => {
  it('never quarantines without an explicit threshold', () => {
    expect(shouldQuarantine(99, null)).toBe(false);
  });

  it('never quarantines a message with no score', () => {
    expect(shouldQuarantine(null, 1)).toBe(false);
  });

  it('quarantines at or above the threshold', () => {
    expect(shouldQuarantine(8, 8)).toBe(true);
    expect(shouldQuarantine(8.1, 8)).toBe(true);
    expect(shouldQuarantine(7.9, 8)).toBe(false);
  });
});

describe('pickSenderRule', () => {
  it('returns null when nothing matches', () => {
    expect(pickSenderRule([], 'person@example.com', 'example.com')).toBeNull();
    expect(pickSenderRule(
      [{ pattern: 'other@example.com', action: 'block' }],
      'person@example.com',
      'example.com',
    )).toBeNull();
  });

  it('prefers an exact address match over a domain match, either direction', () => {
    expect(pickSenderRule(
      [
        { pattern: 'example.com', action: 'block' },
        { pattern: 'person@example.com', action: 'allow' },
      ],
      'person@example.com',
      'example.com',
    )).toBe('allow');

    expect(pickSenderRule(
      [
        { pattern: 'example.com', action: 'allow' },
        { pattern: 'person@example.com', action: 'block' },
      ],
      'person@example.com',
      'example.com',
    )).toBe('block');
  });

  it('falls back to the domain rule when no address rule matches', () => {
    expect(pickSenderRule(
      [{ pattern: 'example.com', action: 'block' }],
      'person@example.com',
      'example.com',
    )).toBe('block');
    expect(pickSenderRule(
      [{ pattern: 'example.com', action: 'allow' }],
      'person@example.com',
      'example.com',
    )).toBe('allow');
  });

  it('resolves a same-level tie in favour of block, at both the address and domain level', () => {
    expect(pickSenderRule(
      [
        { pattern: 'person@example.com', action: 'allow' },
        { pattern: 'person@example.com', action: 'block' },
      ],
      'person@example.com',
      'example.com',
    )).toBe('block');
    expect(pickSenderRule(
      [
        { pattern: 'person@example.com', action: 'block' },
        { pattern: 'person@example.com', action: 'allow' },
      ],
      'person@example.com',
      'example.com',
    )).toBe('block');
    expect(pickSenderRule(
      [
        { pattern: 'example.com', action: 'allow' },
        { pattern: 'example.com', action: 'block' },
      ],
      'person@example.com',
      'example.com',
    )).toBe('block');
  });

  it('ignores rows with an unrecognised action instead of throwing', () => {
    expect(pickSenderRule(
      [{ pattern: 'person@example.com', action: 'quarantine' }],
      'person@example.com',
      'example.com',
    )).toBeNull();
  });

  it('is an exact string match, not a substring or case-insensitive match', () => {
    expect(pickSenderRule(
      [{ pattern: 'notperson@example.com', action: 'block' }],
      'person@example.com',
      'example.com',
    )).toBeNull();
    expect(pickSenderRule(
      [{ pattern: 'PERSON@EXAMPLE.COM', action: 'block' }],
      'person@example.com',
      'example.com',
    )).toBeNull();
  });
});

describe('decideInboundPlacement', () => {
  it('files a blocked sender to Spam regardless of score or threshold', () => {
    expect(decideInboundPlacement({ spamScore: null, threshold: null, senderRule: 'block' }))
      .toEqual({ folder: 'spam', reason: 'blocked-sender' });
    expect(decideInboundPlacement({ spamScore: 0, threshold: 99, senderRule: 'block' }))
      .toEqual({ folder: 'spam', reason: 'blocked-sender' });
  });

  it('lets an allowed sender skip the score check entirely', () => {
    expect(decideInboundPlacement({ spamScore: 100, threshold: 1, senderRule: 'allow' }))
      .toEqual({ folder: 'inbox', reason: null });
    expect(decideInboundPlacement({ spamScore: null, threshold: null, senderRule: 'allow' }))
      .toEqual({ folder: 'inbox', reason: null });
  });

  it('never quarantines on score when the threshold is unset, even with an extreme score', () => {
    expect(decideInboundPlacement({ spamScore: 1000, threshold: null, senderRule: null }))
      .toEqual({ folder: 'inbox', reason: null });
  });

  it('never quarantines on score when there is no score to compare', () => {
    expect(decideInboundPlacement({ spamScore: null, threshold: 5, senderRule: null }))
      .toEqual({ folder: 'inbox', reason: null });
  });

  it('quarantines by score at or above the threshold and records the score in the reason', () => {
    expect(decideInboundPlacement({ spamScore: 8, threshold: 8, senderRule: null }))
      .toEqual({ folder: 'spam', reason: 'spam-score:8' });
    expect(decideInboundPlacement({ spamScore: 8.5, threshold: 8, senderRule: null }))
      .toEqual({ folder: 'spam', reason: 'spam-score:8.5' });
  });

  it('delivers to Inbox when the score is below the threshold', () => {
    expect(decideInboundPlacement({ spamScore: 7.9, threshold: 8, senderRule: null }))
      .toEqual({ folder: 'inbox', reason: null });
  });
});
