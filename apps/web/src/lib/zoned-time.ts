// Convert a wall-clock date/time entered in some IANA time zone into UTC,
// using only Intl offset math — no date library dependency. Used to store
// calendar event times: the person picks a date and time "in the org time
// zone," and the server needs the equivalent UTC instant.

interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

interface TimeParts {
  hour: number; // 0-23
  minute: number; // 0-59
}

function parseDateParts(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject dates that don't exist (e.g. 30 February) by round-tripping
  // through Date.UTC, which silently normalizes out-of-range components.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

function parseTimeParts(value: string): TimeParts | null {
  const match = /^(\d{2}):(\d{2})$/.exec((value || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** The zone's offset (in ms, UTC minus local) at the instant `date` represents. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  // Some environments report midnight as hour "24" under hourCycle h23.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - date.getTime();
}

/**
 * Interpret `dateStr` ("YYYY-MM-DD") and `timeStr` ("HH:MM") as wall-clock
 * values in `timeZone`, and return the equivalent UTC instant as
 * "YYYY-MM-DDTHH:MM:SSZ" — the same no-milliseconds UTC form used by
 * calendar_events.starts_at/ends_at and packages/shared/src/ics.ts's
 * startsAtUtc/endsAtUtc, so the result can be stored and passed to buildIcs()
 * without reformatting. Returns null for an unparseable date/time or an
 * unrecognized zone.
 *
 * Works by guessing the UTC instant is the wall-clock value unchanged, then
 * measuring that zone's actual offset at (approximately) that instant and
 * correcting for it. This is exact for a regular, unambiguous local time; at
 * a DST transition — where a local time is skipped or repeated — it resolves
 * to one of the two closest real instants rather than failing.
 */
export function zonedDateTimeToUtcIso(dateStr: string, timeStr: string, timeZone: string): string | null {
  const date = parseDateParts(dateStr);
  const time = parseTimeParts(timeStr);
  if (!date || !time) return null;

  const guess = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0);
  try {
    const offset = zoneOffsetMs(new Date(guess), timeZone || 'UTC');
    return `${new Date(guess - offset).toISOString().slice(0, 19)}Z`;
  } catch {
    return null;
  }
}
