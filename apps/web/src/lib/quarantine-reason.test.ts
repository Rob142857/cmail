import { describe, expect, it } from 'vitest';
import { quarantineReasonPhrase } from './quarantine-reason';

describe('quarantineReasonPhrase', () => {
  it('describes a blocked sender', () => {
    expect(quarantineReasonPhrase('blocked-sender')).toBe('blocked sender');
  });

  it('describes a spam score, keeping the stored precision', () => {
    expect(quarantineReasonPhrase('spam-score:7.5')).toBe('spam score 7.5');
    expect(quarantineReasonPhrase('spam-score:10')).toBe('spam score 10');
  });

  it('returns null for unset or unrecognised reasons', () => {
    expect(quarantineReasonPhrase(null)).toBeNull();
    expect(quarantineReasonPhrase(undefined)).toBeNull();
    expect(quarantineReasonPhrase('')).toBeNull();
    expect(quarantineReasonPhrase('something-else')).toBeNull();
  });
});
