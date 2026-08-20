/**
 * Dependency-free iCalendar (RFC 5545) parsing and building for meeting
 * invites carried as `text/calendar`/`application/ics` message parts.
 *
 * `parseIcs` is deliberately tolerant: real-world senders (Outlook, Google
 * Calendar, Apple Calendar, assorted MTAs) each take small liberties with the
 * spec — Windows time zone names instead of IANA IDs, missing VALUE params,
 * stray whitespace. A malformed or unrecognised property degrades to a
 * default; the function never throws. The only case it refuses outright is
 * input that is not recognisably an iCalendar document at all.
 *
 * `buildIcs` produces the REQUEST/REPLY/CANCEL payloads cmail sends: folded
 * at 75 octets per RFC 5545 §3.1, with TEXT values escaped per §3.3.11.
 */

export type IcsMethod = 'REQUEST' | 'REPLY' | 'CANCEL' | 'PUBLISH';

export type IcsPartstat = 'needs-action' | 'accepted' | 'declined' | 'tentative';

export interface ParsedAttendee {
  address: string;
  name: string;
  partstat: IcsPartstat;
}

export interface ParsedEvent {
  uid: string;
  sequence: number;
  summary: string;
  description: string;
  location: string;
  /** UTC `YYYY-MM-DDTHH:MM:SSZ`, or a bare `YYYY-MM-DD` date when `allDay`. */
  startsAtUtc: string;
  /** Same format as {@link startsAtUtc}; null when the source had no DTEND/DURATION. */
  endsAtUtc: string | null;
  allDay: boolean;
  status: 'confirmed' | 'cancelled';
  organizerAddress: string;
  organizerName: string;
  attendees: ParsedAttendee[];
  rrule: string | null;
}

export interface ParsedCalendar {
  /** VCALENDAR-level METHOD. Null when absent or not one of the recognised values. */
  method: IcsMethod | null;
  events: ParsedEvent[];
}

export interface BuildIcsAttendee {
  address: string;
  name?: string;
  partstat?: IcsPartstat;
}

export interface BuildIcsInput {
  method: 'REQUEST' | 'REPLY' | 'CANCEL';
  /** Caller-supplied clock. No implicit Date.now() default, so output is testable. */
  now: Date;
  uid: string;
  sequence: number;
  summary?: string;
  description?: string;
  location?: string;
  /** UTC `YYYY-MM-DDTHH:MM:SSZ`, or `YYYY-MM-DD` when `allDay` is true. */
  startsAtUtc: string;
  /** Same format as {@link BuildIcsInput.startsAtUtc}. Omitted entirely when absent. */
  endsAtUtc?: string | null;
  allDay?: boolean;
  status?: 'confirmed' | 'cancelled';
  organizerAddress: string;
  organizerName?: string;
  /** For `method: 'REPLY'`, only the first entry is emitted — the responder. */
  attendees: BuildIcsAttendee[];
  rrule?: string | null;
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const RECOGNISED_METHODS: ReadonlySet<string> = new Set(['REQUEST', 'REPLY', 'CANCEL', 'PUBLISH']);

// ─── Shared text escaping (RFC 5545 §3.3.11) ───────────────────────────────

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function unescapeText(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\' && index + 1 < value.length) {
      const next = value[index + 1];
      if (next === 'n' || next === 'N') { result += '\n'; index += 1; continue; }
      if (next === ';' || next === ',' || next === '\\') { result += next; index += 1; continue; }
      // Unknown escape: keep the backslash literally rather than swallow it.
      result += char;
      continue;
    }
    result += char;
  }
  return result;
}

/** Quotes a parameter value only when RFC 5545 requires it (it contains `;`, `:`, or `,`). */
function escapeParam(value: string): string {
  const cleaned = value.replace(/[\r\n"]/g, '');
  return /[:;,]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

// ─── parseIcs ───────────────────────────────────────────────────────────────

interface ContentLine {
  name: string;
  params: Map<string, string>;
  value: string;
}

/** RFC 5545 §3.1: any line starting with a single space/tab continues the previous one. */
function unfoldLines(raw: string): string[] {
  // Strip a leading UTF-8 BOM by code unit (0xFEFF) rather than a regex
  // literal, so the source file carries no invisible characters.
  const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const normalized = withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines: string[] = [];
  for (const rawLine of normalized.split('\n')) {
    if ((rawLine.startsWith(' ') || rawLine.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += rawLine.slice(1);
    } else {
      lines.push(rawLine);
    }
  }
  return lines;
}

/**
 * Splits one unfolded content line into name/params/value, respecting
 * double-quoted parameter values that may themselves contain `;` or `:`.
 */
function parseContentLine(line: string): ContentLine | null {
  let index = 0;
  while (index < line.length && line[index] !== ';' && line[index] !== ':') index += 1;
  if (index >= line.length) return null;

  const name = line.slice(0, index).trim().toUpperCase();
  if (!name) return null;
  const params = new Map<string, string>();

  while (index < line.length && line[index] === ';') {
    index += 1;
    const nameStart = index;
    while (index < line.length && line[index] !== '=') index += 1;
    const paramName = line.slice(nameStart, index).trim().toUpperCase();
    index += 1; // skip '='

    let paramValue: string;
    if (line[index] === '"') {
      index += 1;
      const valueStart = index;
      while (index < line.length && line[index] !== '"') index += 1;
      paramValue = line.slice(valueStart, index);
      index += 1; // skip closing quote
    } else {
      const valueStart = index;
      while (index < line.length && line[index] !== ';' && line[index] !== ':') index += 1;
      paramValue = line.slice(valueStart, index);
    }
    if (paramName) params.set(paramName, paramValue);
  }

  if (line[index] !== ':') return null;
  return { name, params, value: line.slice(index + 1) };
}

/**
 * Resolves a local wall-clock time in an IANA time zone to a UTC instant
 * using Intl as the offset source (no bundled tz database). An unresolvable
 * zone — most commonly a Windows display name like "W. Europe Standard
 * Time" rather than an IANA ID — degrades to treating the value as UTC,
 * exactly like a DTSTART with no TZID at all.
 */
function zonedTimeToUtcMs(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = formatter.formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const zonedAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    if (!Number.isFinite(zonedAsUtc)) return guess;
    return guess - (zonedAsUtc - guess);
  } catch {
    return guess;
  }
}

interface ParsedDateValue {
  utc: string;
  allDay: boolean;
}

function parseDateTimeProperty(line: ContentLine): ParsedDateValue | null {
  const value = line.value.trim();
  const isDateValue = (line.params.get('VALUE') || '').toUpperCase() === 'DATE';

  if (isDateValue || /^\d{8}$/.test(value)) {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (!match) return null;
    return { utc: `${match[1]}-${match[2]}-${match[3]}`, allDay: true };
  }

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, z] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);

  const tzid = line.params.get('TZID');
  const ms = z
    ? Date.UTC(year, month - 1, day, hour, minute, second)
    : tzid
      ? zonedTimeToUtcMs(year, month, day, hour, minute, second, tzid)
      // Floating local time (no Z, no TZID): treated as UTC, same as an
      // unresolvable TZID — there is no reliable zone to convert from.
      : Date.UTC(year, month - 1, day, hour, minute, second);

  if (!Number.isFinite(ms)) return null;
  return { utc: `${new Date(ms).toISOString().slice(0, 19)}Z`, allDay: false };
}

const DURATION_RX = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** Basic ISO 8601 duration support (weeks/days/hours/minutes/seconds). */
function parseDurationMs(value: string): number | null {
  const match = DURATION_RX.exec(value.trim());
  if (!match) return null;
  const [, sign, w, d, h, mi, s] = match;
  const weeks = Number(w || 0);
  const days = Number(d || 0);
  const hours = Number(h || 0);
  const minutes = Number(mi || 0);
  const seconds = Number(s || 0);
  if (!weeks && !days && !hours && !minutes && !seconds) return null;
  const totalMs = ((((weeks * 7) + days) * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1000;
  return sign === '-' ? -totalMs : totalMs;
}

function applyDuration(startsAtUtc: string, allDay: boolean, durationMs: number): string {
  if (allDay) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsAtUtc);
    if (!match) return startsAtUtc;
    const endMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + durationMs;
    const end = new Date(endMs);
    return `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;
  }
  const startMs = Date.parse(startsAtUtc);
  if (!Number.isFinite(startMs)) return startsAtUtc;
  return `${new Date(startMs + durationMs).toISOString().slice(0, 19)}Z`;
}

function stripMailto(value: string): string {
  return value.trim().replace(/^mailto:/i, '').trim();
}

function normalizePartstat(value: string | undefined): IcsPartstat {
  switch ((value || '').trim().toUpperCase()) {
    case 'ACCEPTED': return 'accepted';
    case 'DECLINED': return 'declined';
    case 'TENTATIVE': return 'tentative';
    default: return 'needs-action';
  }
}

interface MutableEvent {
  uid: string;
  sequence: number;
  summary: string;
  description: string;
  location: string;
  startsAtUtc: string | null;
  endsAtUtc: string | null;
  allDay: boolean;
  durationMs: number | null;
  status: 'confirmed' | 'cancelled';
  organizerAddress: string;
  organizerName: string;
  attendees: ParsedAttendee[];
  rrule: string | null;
}

function createEmptyEvent(): MutableEvent {
  return {
    uid: '',
    sequence: 0,
    summary: '',
    description: '',
    location: '',
    startsAtUtc: null,
    endsAtUtc: null,
    allDay: false,
    durationMs: null,
    status: 'confirmed',
    organizerAddress: '',
    organizerName: '',
    attendees: [],
    rrule: null,
  };
}

function applyEventProperty(event: MutableEvent, line: ContentLine): void {
  switch (line.name) {
    case 'UID':
      event.uid = unescapeText(line.value).trim();
      return;
    case 'SEQUENCE': {
      const n = Number.parseInt(line.value.trim(), 10);
      event.sequence = Number.isFinite(n) && n >= 0 ? n : 0;
      return;
    }
    case 'SUMMARY':
      event.summary = unescapeText(line.value);
      return;
    case 'DESCRIPTION':
      event.description = unescapeText(line.value);
      return;
    case 'LOCATION':
      event.location = unescapeText(line.value);
      return;
    case 'STATUS':
      event.status = line.value.trim().toUpperCase() === 'CANCELLED' ? 'cancelled' : event.status;
      return;
    case 'DTSTART': {
      const parsed = parseDateTimeProperty(line);
      if (parsed) { event.startsAtUtc = parsed.utc; event.allDay = parsed.allDay; }
      return;
    }
    case 'DTEND': {
      const parsed = parseDateTimeProperty(line);
      if (parsed) event.endsAtUtc = parsed.utc;
      return;
    }
    case 'DURATION': {
      const ms = parseDurationMs(line.value);
      if (ms !== null) event.durationMs = ms;
      return;
    }
    case 'RRULE':
      event.rrule = line.value.trim() || null;
      return;
    case 'ORGANIZER':
      event.organizerAddress = stripMailto(line.value);
      event.organizerName = (line.params.get('CN') || '').trim();
      return;
    case 'ATTENDEE': {
      const address = stripMailto(line.value);
      if (address) {
        event.attendees.push({
          address,
          name: (line.params.get('CN') || '').trim(),
          partstat: normalizePartstat(line.params.get('PARTSTAT')),
        });
      }
      return;
    }
    default:
      return;
  }
}

function finalizeEvent(event: MutableEvent): ParsedEvent | null {
  // A VEVENT with no interpretable DTSTART cannot be stored (starts_at is
  // NOT NULL) or shown meaningfully, so it is dropped rather than emitted
  // with a placeholder time. Every other field degrades to a default instead.
  if (!event.startsAtUtc) return null;
  const endsAtUtc = event.endsAtUtc !== null
    ? event.endsAtUtc
    : event.durationMs !== null
      ? applyDuration(event.startsAtUtc, event.allDay, event.durationMs)
      : null;

  return {
    uid: event.uid,
    sequence: event.sequence,
    summary: event.summary,
    description: event.description,
    location: event.location,
    startsAtUtc: event.startsAtUtc,
    endsAtUtc,
    allDay: event.allDay,
    status: event.status,
    organizerAddress: event.organizerAddress,
    organizerName: event.organizerName,
    attendees: event.attendees,
    rrule: event.rrule,
  };
}

/**
 * Parses an iCalendar document into its VCALENDAR-level METHOD and its
 * VEVENTs. Never throws: unparseable or absent properties degrade to
 * defaults, and only input with no BEGIN/END:VCALENDAR pair yields null.
 * Nested components (VALARM, VTIMEZONE and its STANDARD/DAYLIGHT children)
 * are tracked on a component stack so their properties — which reuse names
 * like DTSTART — never leak into the enclosing VEVENT.
 */
export function parseIcs(text: string): ParsedCalendar | null {
  if (typeof text !== 'string' || !text.includes('BEGIN:VCALENDAR')) return null;

  try {
    const stack: string[] = [];
    const events: ParsedEvent[] = [];
    let method: IcsMethod | null = null;
    let current: MutableEvent | null = null;
    let sawCalendar = false;

    for (const rawLine of unfoldLines(text)) {
      if (!rawLine.trim()) continue;
      const upper = rawLine.toUpperCase();

      if (upper.startsWith('BEGIN:')) {
        const component = upper.slice(6).trim();
        stack.push(component);
        if (component === 'VCALENDAR') sawCalendar = true;
        if (component === 'VEVENT' && stack[stack.length - 2] === 'VCALENDAR') {
          current = createEmptyEvent();
        }
        continue;
      }

      if (upper.startsWith('END:')) {
        const component = upper.slice(4).trim();
        if (component === 'VEVENT' && current) {
          const finalized = finalizeEvent(current);
          if (finalized) events.push(finalized);
          current = null;
        }
        if (stack.length) stack.pop();
        continue;
      }

      const parsedLine = parseContentLine(rawLine);
      if (!parsedLine) continue;

      const atCalendarTop = stack.length === 1 && stack[0] === 'VCALENDAR';
      if (atCalendarTop && parsedLine.name === 'METHOD') {
        const value = parsedLine.value.trim().toUpperCase();
        if (RECOGNISED_METHODS.has(value)) method = value as IcsMethod;
        continue;
      }

      if (current && stack[stack.length - 1] === 'VEVENT') {
        applyEventProperty(current, parsedLine);
      }
    }

    if (!sawCalendar) return null;
    return { method, events };
  } catch {
    return null;
  }
}

// ─── buildIcs ───────────────────────────────────────────────────────────────

/**
 * Folds one logical `NAME:value` line at 75 octets per RFC 5545 §3.1: the
 * first physical line carries up to 75 octets, each continuation carries up
 * to 74 (plus the mandatory single leading space), and a split never lands
 * inside a multi-byte UTF-8 sequence.
 */
function foldLine(line: string): string {
  const bytes = ENCODER.encode(line);
  if (bytes.byteLength <= 75) return line;

  const chunks: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.byteLength) {
    let end = Math.min(offset + limit, bytes.byteLength);
    while (end > offset && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    chunks.push(DECODER.decode(bytes.slice(offset, end)));
    offset = end;
    limit = 74;
  }
  return chunks.join('\r\n ');
}

function formatUtcStamp(date: Date): string {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`
    + `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
}

function formatDateTimeValue(isoUtc: string): string {
  return isoUtc.replace(/[-:]/g, '');
}

function formatDateOnlyValue(dateOnly: string): string {
  return dateOnly.replace(/-/g, '');
}

function partstatToIcs(value: IcsPartstat | undefined): string {
  switch (value) {
    case 'accepted': return 'ACCEPTED';
    case 'declined': return 'DECLINED';
    case 'tentative': return 'TENTATIVE';
    default: return 'NEEDS-ACTION';
  }
}

/**
 * Builds a VCALENDAR document for the given method. For `REPLY` only the
 * first `attendees` entry — the responder — is emitted, regardless of how
 * many are passed in, matching RFC 5546's single-attendee REPLY shape.
 */
export function buildIcs(input: BuildIcsInput): string {
  const sequence = Number.isFinite(input.sequence) && input.sequence >= 0 ? Math.floor(input.sequence) : 0;
  const status = input.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';
  const allDay = Boolean(input.allDay);
  const attendees = input.method === 'REPLY' ? input.attendees.slice(0, 1) : input.attendees;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//cmail//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method}`,
    'BEGIN:VEVENT',
    `UID:${escapeText(input.uid || '')}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${formatUtcStamp(input.now)}`,
  ];

  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnlyValue(input.startsAtUtc)}`);
    if (input.endsAtUtc) lines.push(`DTEND;VALUE=DATE:${formatDateOnlyValue(input.endsAtUtc)}`);
  } else {
    lines.push(`DTSTART:${formatDateTimeValue(input.startsAtUtc)}`);
    if (input.endsAtUtc) lines.push(`DTEND:${formatDateTimeValue(input.endsAtUtc)}`);
  }

  if (input.summary) lines.push(`SUMMARY:${escapeText(input.summary)}`);
  if (input.location) lines.push(`LOCATION:${escapeText(input.location)}`);
  if (input.description) lines.push(`DESCRIPTION:${escapeText(input.description)}`);

  if (input.organizerAddress) {
    const cn = input.organizerName ? `;CN=${escapeParam(input.organizerName)}` : '';
    lines.push(`ORGANIZER${cn}:mailto:${input.organizerAddress}`);
  }

  for (const attendee of attendees) {
    if (!attendee.address) continue;
    const cn = attendee.name ? `;CN=${escapeParam(attendee.name)}` : '';
    lines.push(`ATTENDEE${cn};PARTSTAT=${partstatToIcs(attendee.partstat)};RSVP=TRUE:mailto:${attendee.address}`);
  }

  if (input.rrule) lines.push(`RRULE:${input.rrule}`);
  lines.push(`STATUS:${status}`);
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
