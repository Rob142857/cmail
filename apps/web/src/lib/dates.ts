/** Parse the UTC timestamp format returned by D1's datetime functions. */
function toUTC(dateStr: string): Date {
  const value = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
  return new Date(value.endsWith('Z') ? value : `${value}Z`);
}

function options(locale = 'en', timeZone = 'UTC'): { locale: string; timeZone: string } {
  return { locale: locale || 'en', timeZone: timeZone || 'UTC' };
}

/** Return an unambiguous machine-readable value for a HTML `time` element. */
export function dateTimeAttribute(dateStr: string): string {
  const dt = toUTC(dateStr);
  return Number.isNaN(dt.getTime()) ? dateStr : dt.toISOString();
}

export function formatDateTime(dateStr: string, locale = 'en', timeZone = 'UTC'): string {
  const dt = toUTC(dateStr);
  const config = options(locale, timeZone);
  return dt.toLocaleString(config.locale, {
    timeZone: config.timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function formatDate(dateStr: string, locale = 'en', timeZone = 'UTC'): string {
  const dt = toUTC(dateStr);
  const now = new Date();
  const config = options(locale, timeZone);
  const dtDay = dt.toLocaleDateString(config.locale, { timeZone: config.timeZone });
  const nowDay = now.toLocaleDateString(config.locale, { timeZone: config.timeZone });
  if (dtDay === nowDay) {
    return dt.toLocaleTimeString(config.locale, {
      timeZone: config.timeZone,
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  const dtYear = dt.toLocaleDateString(config.locale, {
    timeZone: config.timeZone,
    year: 'numeric',
  });
  const nowYear = now.toLocaleDateString(config.locale, {
    timeZone: config.timeZone,
    year: 'numeric',
  });
  return dt.toLocaleDateString(config.locale, {
    timeZone: config.timeZone,
    day: 'numeric',
    month: 'short',
    ...(dtYear === nowYear ? {} : { year: 'numeric' }),
  });
}

export function formatDateOnly(dateStr: string, locale = 'en', timeZone = 'UTC'): string {
  const dt = toUTC(dateStr);
  const config = options(locale, timeZone);
  return dt.toLocaleDateString(config.locale, {
    timeZone: config.timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatQuoteDate(dateStr: string, locale = 'en', timeZone = 'UTC'): string {
  const dt = toUTC(dateStr);
  const config = options(locale, timeZone);
  return dt.toLocaleString(config.locale, {
    timeZone: config.timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Parse a calendar event timestamp: either the full UTC-ish format `toUTC`
 * already handles, or a bare `YYYY-MM-DD` date-only value (all-day events),
 * which is anchored at UTC midnight so callers can format it deliberately
 * with `timeZone: 'UTC'` rather than risk shifting the calendar day.
 */
function toEventDate(value: string | null | undefined): Date {
  const trimmed = (value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? new Date(`${trimmed}T00:00:00Z`) : toUTC(trimmed);
}

/** Split one formatted time into its numeric part and AM/PM-style period, if any. */
function timeParts(date: Date, locale: string, timeZone: string): { time: string; period: string } {
  const parts = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }).formatToParts(date);
  let time = '';
  let period = '';
  for (const part of parts) {
    if (part.type === 'dayPeriod') period = part.value;
    else if (part.type !== 'literal' || part.value.trim() !== '') time += part.value;
  }
  return { time, period };
}

/**
 * A friendly, human range for a calendar event: "Tue 25 Aug, 2:00–2:30 pm"
 * for a same-day timed event, "Tue 25 Aug, 2:00 pm – Wed 26 Aug, 9:00 am"
 * when it crosses midnight, or "Tue 25 Aug (all day)" for an all-day event.
 * All-day events are always rendered in UTC — the stored date has no time of
 * day, so applying a non-UTC zone could shift which calendar day is shown.
 */
export function formatEventRange(
  startsAt: string,
  endsAt: string | null | undefined,
  allDay: boolean | 0 | 1,
  locale = 'en',
  timeZone = 'UTC',
): string {
  const isAllDay = allDay === true || allDay === 1;
  const start = toEventDate(startsAt);
  if (Number.isNaN(start.getTime())) return '';
  const loc = locale || 'en';
  const zone = isAllDay ? 'UTC' : (timeZone || 'UTC');
  const dayFormatter = new Intl.DateTimeFormat(loc, { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' });
  const startDayLabel = dayFormatter.format(start);
  const end = toEventDate(endsAt);
  const hasEnd = !Number.isNaN(end.getTime());

  if (isAllDay) {
    if (hasEnd) {
      const endDayLabel = dayFormatter.format(end);
      if (endDayLabel !== startDayLabel) return `${startDayLabel} – ${endDayLabel} (all day)`;
    }
    return `${startDayLabel} (all day)`;
  }

  const startParts = timeParts(start, loc, zone);
  if (!hasEnd) {
    const startLabel = startParts.period ? `${startParts.time} ${startParts.period}` : startParts.time;
    return `${startDayLabel}, ${startLabel}`;
  }

  const endParts = timeParts(end, loc, zone);
  const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const sameDay = dateKeyFormatter.format(start) === dateKeyFormatter.format(end);
  const endLabel = endParts.period ? `${endParts.time} ${endParts.period}` : endParts.time;

  if (sameDay) {
    const startLabel = startParts.period && startParts.period === endParts.period ? startParts.time : (startParts.period ? `${startParts.time} ${startParts.period}` : startParts.time);
    return `${startDayLabel}, ${startLabel}–${endLabel}`;
  }

  const startLabel = startParts.period ? `${startParts.time} ${startParts.period}` : startParts.time;
  const endDayLabel = dayFormatter.format(end);
  return `${startDayLabel}, ${startLabel} – ${endDayLabel}, ${endLabel}`;
}

/** The calendar-day bucket an event belongs to, for agenda-style day grouping. */
export function eventDayKey(startsAt: string, allDay: boolean | 0 | 1, timeZone = 'UTC'): string {
  const isAllDay = allDay === true || allDay === 1;
  if (isAllDay) return (startsAt || '').trim().slice(0, 10);
  const start = toEventDate(startsAt);
  if (Number.isNaN(start.getTime())) return (startsAt || '').trim().slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(start);
}

/**
 * A heading for one `eventDayKey()` bucket, e.g. "Tuesday 25 August 2026".
 * Deliberately formatted in UTC: the key is already the resolved calendar
 * day, so re-applying the org time zone here could shift it a second time.
 */
export function formatDayHeading(dayKey: string, locale = 'en'): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return date.toLocaleDateString(locale || 'en', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
