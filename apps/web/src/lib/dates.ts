/**
 * Timezone-aware date formatting.
 * D1 stores UTC via datetime('now') without a Z suffix.
 * All display defaults to Australia/Sydney (AEST / AEDT).
 */

const TZ = 'Australia/Sydney';

/** Ensure a D1 datetime string is parsed as UTC */
function toUTC(dateStr: string): Date {
  // D1 returns "2026-04-26 14:30:00" — no T, no Z.  Force UTC.
  const s = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
  return new Date(s.endsWith('Z') ? s : s + 'Z');
}

/** Full date+time: "26 Apr 2026, 3:15 pm AEST" */
export function formatDateTime(dateStr: string): string {
  const dt = toUTC(dateStr);
  return dt.toLocaleString('en-AU', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

/** Short date for message lists: time if today, otherwise "26 Apr" */
export function formatDate(dateStr: string): string {
  const dt = toUTC(dateStr);
  const now = new Date();
  // Compare dates in AEST
  const dtDay = dt.toLocaleDateString('en-AU', { timeZone: TZ });
  const nowDay = now.toLocaleDateString('en-AU', { timeZone: TZ });
  if (dtDay === nowDay) {
    return dt.toLocaleTimeString('en-AU', {
      timeZone: TZ,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
  return dt.toLocaleDateString('en-AU', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
  });
}

/** Date only: "26 Apr 2026" */
export function formatDateOnly(dateStr: string): string {
  return toUTC(dateStr).toLocaleDateString('en-AU', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** For reply/forward quote header: "26/04/2026, 3:15 pm" */
export function formatQuoteDate(dateStr: string): string {
  const dt = toUTC(dateStr);
  return dt.toLocaleString('en-AU', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
