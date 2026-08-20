import { describe, expect, it } from 'vitest';
import { eventDayKey, formatDayHeading, formatEventRange } from './dates';

describe('formatEventRange', () => {
  it('formats a same-day timed event with one shared AM/PM marker', () => {
    expect(formatEventRange('2026-08-25T14:00:00Z', '2026-08-25T14:30:00Z', false, 'en-US', 'UTC'))
      .toBe('Tue, Aug 25, 2:00–2:30 PM');
  });

  it('shows both AM/PM markers when the range crosses the midday boundary', () => {
    expect(formatEventRange('2026-08-25T11:30:00Z', '2026-08-25T12:15:00Z', false, 'en-US', 'UTC'))
      .toBe('Tue, Aug 25, 11:30 AM–12:15 PM');
  });

  it('shows both days when a timed event crosses midnight', () => {
    expect(formatEventRange('2026-08-25T23:30:00Z', '2026-08-26T00:15:00Z', false, 'en-US', 'UTC'))
      .toBe('Tue, Aug 25, 11:30 PM – Wed, Aug 26, 12:15 AM');
  });

  it('converts into the given IANA time zone', () => {
    expect(formatEventRange('2026-08-25T14:00:00Z', '2026-08-25T14:30:00Z', false, 'en-US', 'America/Los_Angeles'))
      .toBe('Tue, Aug 25, 7:00–7:30 AM');
  });

  it('respects a 24-hour locale with no AM/PM marker', () => {
    expect(formatEventRange('2026-08-25T14:00:00Z', '2026-08-25T14:30:00Z', false, 'en-GB', 'UTC'))
      .toBe('Tue 25 Aug, 14:00–14:30');
  });

  it('accepts the D1 "YYYY-MM-DD HH:MM:SS" storage format', () => {
    expect(formatEventRange('2026-08-25 14:00:00', '2026-08-25 14:30:00', false, 'en-US', 'UTC'))
      .toBe('Tue, Aug 25, 2:00–2:30 PM');
  });

  it('renders a single all-day event without a time', () => {
    expect(formatEventRange('2026-08-25', '2026-08-25', true, 'en-US', 'UTC')).toBe('Tue, Aug 25 (all day)');
  });

  it('renders a multi-day all-day event as a day range', () => {
    expect(formatEventRange('2026-08-25', '2026-08-27', true, 'en-US', 'UTC')).toBe('Tue, Aug 25 – Thu, Aug 27 (all day)');
  });

  it('ignores the given time zone for all-day events so the date never shifts', () => {
    expect(formatEventRange('2026-08-25', '2026-08-25', true, 'en-US', 'America/Los_Angeles'))
      .toBe('Tue, Aug 25 (all day)');
    expect(formatEventRange('2026-08-25', '2026-08-25', true, 'en-US', 'Pacific/Kiritimati'))
      .toBe('Tue, Aug 25 (all day)');
  });

  it('falls back to a start-only label when the end is missing or invalid', () => {
    expect(formatEventRange('2026-08-25T14:00:00Z', '', false, 'en-US', 'UTC')).toBe('Tue, Aug 25, 2:00 PM');
    expect(formatEventRange('2026-08-25T14:00:00Z', null, false, 'en-US', 'UTC')).toBe('Tue, Aug 25, 2:00 PM');
    expect(formatEventRange('2026-08-25T14:00:00Z', undefined, false, 'en-US', 'UTC')).toBe('Tue, Aug 25, 2:00 PM');
  });

  it('returns an empty string for an unparseable start', () => {
    expect(formatEventRange('not-a-date', '', false, 'en-US', 'UTC')).toBe('');
  });

  it('defaults locale and time zone when omitted', () => {
    expect(formatEventRange('2026-08-25T14:00:00Z', '2026-08-25T14:30:00Z', false)).toContain('2:00');
  });
});

describe('eventDayKey', () => {
  it('buckets a date-only all-day event by its literal date', () => {
    expect(eventDayKey('2026-08-25', true, 'America/Los_Angeles')).toBe('2026-08-25');
  });

  it('buckets a timed event by its calendar day in the given zone', () => {
    expect(eventDayKey('2026-08-25T23:30:00Z', false, 'UTC')).toBe('2026-08-25');
    expect(eventDayKey('2026-08-25T23:30:00Z', false, 'Australia/Sydney')).toBe('2026-08-26');
  });

  it('falls back to a leading date slice for an unparseable value', () => {
    expect(eventDayKey('2026-08-25garbage', false, 'UTC')).toBe('2026-08-25');
  });
});

describe('formatDayHeading', () => {
  it('renders a full weekday heading for a day key', () => {
    expect(formatDayHeading('2026-08-25', 'en-US')).toBe('Tuesday, August 25, 2026');
  });

  it('returns the raw key when it cannot be parsed', () => {
    expect(formatDayHeading('not-a-key', 'en-US')).toBe('not-a-key');
  });
});
