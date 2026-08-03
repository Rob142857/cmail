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
