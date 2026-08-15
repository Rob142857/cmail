import { describe, expect, it } from 'vitest';
import {
  boundedInteger,
  escapeHtml,
  escapeLike,
  htmlToPlainText,
  isAddressAtDomain,
  normalizeDomain,
  normalizeEmail,
  parseRecipientList,
  plainTextToHtml,
  textField,
} from './validation';

describe('email and domain validation', () => {
  it('normalizes valid addresses and rejects malformed values', () => {
    expect(normalizeEmail('  Person+tag@Example.COM ')).toBe('person+tag@example.com');
    expect(normalizeEmail('"Team, Desk"@Example.COM')).toBe('"team, desk"@example.com');
    expect(normalizeEmail('user@[192.0.2.1]')).toBe('user@[192.0.2.1]');
    expect(normalizeEmail('person@example')).toBeNull();
    expect(normalizeEmail('person..name@example.com')).toBeNull();
    expect(normalizeEmail('person\r\n@example.com')).toBeNull();
  });

  it('normalizes domains and enforces exact domain boundaries', () => {
    expect(normalizeDomain('@Mail.Example.com.')).toBe('mail.example.com');
    expect(normalizeDomain('-example.com')).toBeNull();
    expect(isAddressAtDomain('person@example.com', 'example.com')).toBe(true);
    expect(isAddressAtDomain('person@notexample.com', 'example.com')).toBe(false);
  });

  it('deduplicates recipients and applies the configured cap', () => {
    expect(parseRecipientList('A@example.com; b@example.com, a@example.com', 3)).toEqual({
      recipients: ['a@example.com', 'b@example.com'],
    });
    expect(parseRecipientList('a@example.com,b@example.com', 1).error).toContain('at most 1');
    expect(parseRecipientList('valid@example.com,invalid', 5).error).toContain('Invalid email');
  });

  it('does not split separators inside quoted local-parts or domain literals', () => {
    expect(parseRecipientList('"team,one"@example.com; user@[192.0.2.1]', 3)).toEqual({
      recipients: ['"team,one"@example.com', 'user@[192.0.2.1]'],
    });
  });
});

describe('safe text handling', () => {
  it('escapes HTML before preserving plain-text line breaks', () => {
    expect(plainTextToHtml('<img src=x onerror=alert(1)>\nHello & goodbye')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;<br>Hello &amp; goodbye',
    );
    expect(escapeHtml(`'"<&>`)).toBe('&#39;&quot;&lt;&amp;&gt;');
  });

  it('produces readable plain text without retaining tags', () => {
    expect(htmlToPlainText('<p>Hello &amp; welcome</p><script>alert(1)</script>')).toBe(
      'Hello & welcome\nalert(1)',
    );
  });

  it('escapes SQL LIKE metacharacters', () => {
    expect(escapeLike('100%_safe\\value')).toBe('100\\%\\_safe\\\\value');
  });
});

describe('bounded input helpers', () => {
  it('clamps integers and rejects oversized text fields', () => {
    expect(boundedInteger('999', 5, 1, 20)).toBe(20);
    expect(boundedInteger('nope', 5, 1, 20)).toBe(5);
    expect(textField('  hello  ', 5)).toBe('hello');
    expect(textField('too long', 4)).toBeNull();
  });
});
