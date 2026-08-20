import { describe, expect, it } from 'vitest';
import { partstatBadgeClass, partstatLabel } from './calendar-format';

describe('partstatLabel', () => {
  it('labels every known partstat', () => {
    expect(partstatLabel('accepted')).toBe('Accepted');
    expect(partstatLabel('declined')).toBe('Declined');
    expect(partstatLabel('tentative')).toBe('Tentative');
    expect(partstatLabel('needs-action')).toBe('Awaiting response');
  });

  it('falls back to "Awaiting response" for an unknown value', () => {
    expect(partstatLabel('bogus')).toBe('Awaiting response');
    expect(partstatLabel('')).toBe('Awaiting response');
  });
});

describe('partstatBadgeClass', () => {
  it('maps each partstat to a distinct existing badge class', () => {
    expect(partstatBadgeClass('accepted')).toBe('badge-success');
    expect(partstatBadgeClass('declined')).toBe('badge-danger');
    expect(partstatBadgeClass('tentative')).toBe('badge-warning');
    expect(partstatBadgeClass('needs-action')).toBe('badge');
  });
});
