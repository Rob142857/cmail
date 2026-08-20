import { describe, expect, it } from 'vitest';
import { zonedDateTimeToUtcIso } from './zoned-time';

describe('zonedDateTimeToUtcIso', () => {
  it('treats UTC as a no-op', () => {
    expect(zonedDateTimeToUtcIso('2026-08-25', '14:00', 'UTC')).toBe('2026-08-25T14:00:00Z');
  });

  it('subtracts a positive offset (ahead of UTC)', () => {
    expect(zonedDateTimeToUtcIso('2026-08-25', '14:00', 'Australia/Sydney')).toBe('2026-08-25T04:00:00Z');
  });

  it('adds a negative offset (behind UTC), honouring daylight time', () => {
    // America/Los_Angeles is UTC-7 (PDT) in August.
    expect(zonedDateTimeToUtcIso('2026-08-25', '14:00', 'America/Los_Angeles')).toBe('2026-08-25T21:00:00Z');
  });

  it('handles a half-hour offset zone', () => {
    expect(zonedDateTimeToUtcIso('2026-08-25', '14:00', 'Australia/Adelaide')).toBe('2026-08-25T04:30:00Z');
  });

  it('handles a 45-minute offset zone', () => {
    expect(zonedDateTimeToUtcIso('2026-08-25', '14:00', 'Asia/Kathmandu')).toBe('2026-08-25T08:15:00Z');
  });

  it('rolls over to the previous UTC day when the local time is near midnight', () => {
    expect(zonedDateTimeToUtcIso('2026-08-25', '00:00', 'Australia/Sydney')).toBe('2026-08-24T14:00:00Z');
  });

  it('defaults an empty time zone to UTC', () => {
    expect(zonedDateTimeToUtcIso('2026-08-25', '14:00', '')).toBe('2026-08-25T14:00:00Z');
  });

  it('rejects a malformed date or time', () => {
    expect(zonedDateTimeToUtcIso('2026/08/25', '14:00', 'UTC')).toBeNull();
    expect(zonedDateTimeToUtcIso('2026-08-25', '2pm', 'UTC')).toBeNull();
    expect(zonedDateTimeToUtcIso('', '', 'UTC')).toBeNull();
  });

  it('rejects an out-of-range month, day, hour, or minute', () => {
    expect(zonedDateTimeToUtcIso('2026-13-01', '09:00', 'UTC')).toBeNull();
    expect(zonedDateTimeToUtcIso('2026-02-30', '09:00', 'UTC')).toBeNull();
    expect(zonedDateTimeToUtcIso('2026-08-25', '25:00', 'UTC')).toBeNull();
    expect(zonedDateTimeToUtcIso('2026-08-25', '09:60', 'UTC')).toBeNull();
  });

  it('rejects 29 February on a non-leap year but accepts it on a leap year', () => {
    expect(zonedDateTimeToUtcIso('2026-02-29', '09:00', 'UTC')).toBeNull();
    expect(zonedDateTimeToUtcIso('2028-02-29', '09:00', 'UTC')).toBe('2028-02-29T09:00:00Z');
  });

  it('rejects an unrecognized time zone instead of throwing', () => {
    expect(zonedDateTimeToUtcIso('2026-08-25', '14:00', 'Not/AZone')).toBeNull();
  });
});
