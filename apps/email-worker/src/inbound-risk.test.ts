import { describe, expect, it } from 'vitest';
import {
  parseSpamScore,
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
