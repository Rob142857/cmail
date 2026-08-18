import { describe, expect, it } from 'vitest';
import { parseSenderRulePattern } from './quarantine-rules';

describe('parseSenderRulePattern', () => {
  it('accepts and lowercases a full email address', () => {
    expect(parseSenderRulePattern('Person@Example.COM')).toBe('person@example.com');
  });

  it('accepts and lowercases a bare domain', () => {
    expect(parseSenderRulePattern('Example.COM')).toBe('example.com');
    expect(parseSenderRulePattern('@example.com')).toBe('example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(parseSenderRulePattern('  person@example.com  ')).toBe('person@example.com');
    expect(parseSenderRulePattern('  example.com  ')).toBe('example.com');
  });

  it('rejects blank, malformed, or non-string input', () => {
    expect(parseSenderRulePattern('')).toBeNull();
    expect(parseSenderRulePattern('   ')).toBeNull();
    expect(parseSenderRulePattern('not an address')).toBeNull();
    expect(parseSenderRulePattern('-example.com')).toBeNull();
    expect(parseSenderRulePattern(null)).toBeNull();
    expect(parseSenderRulePattern(undefined)).toBeNull();
    expect(parseSenderRulePattern(42)).toBeNull();
  });
});
