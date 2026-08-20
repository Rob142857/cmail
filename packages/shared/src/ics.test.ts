import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildIcs, parseIcs, type BuildIcsInput } from './ics.ts';

// ─── parseIcs: malformed / absent input ────────────────────────────────────

describe('parseIcs — malformed input never throws', () => {
  it('returns null for non-string input', () => {
    // @ts-expect-error deliberately passing the wrong runtime type
    assert.equal(parseIcs(undefined), null);
    // @ts-expect-error deliberately passing the wrong runtime type
    assert.equal(parseIcs(123), null);
    // @ts-expect-error deliberately passing the wrong runtime type
    assert.equal(parseIcs(null), null);
  });

  it('returns null for empty or non-calendar text', () => {
    assert.equal(parseIcs(''), null);
    assert.equal(parseIcs('just some random text\nwith lines\n'), null);
    assert.equal(parseIcs('BEGIN:VEVENT\nUID:1\nEND:VEVENT'), null);
  });

  it('returns an empty event list for a calendar with no VEVENT', () => {
    const result = parseIcs('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n');
    assert.deepEqual(result, { method: null, events: [] });
  });

  it('drops a VEVENT with no interpretable DTSTART instead of throwing', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:no-start@example.test',
      'SUMMARY:Missing start time',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:has-start@example.test',
      'DTSTART:20260115T090000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = parseIcs(text);
    assert.ok(result);
    assert.equal(result!.events.length, 1);
    assert.equal(result!.events[0]!.uid, 'has-start@example.test');
  });

  it('ignores an unparseable content line instead of aborting the whole document', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:x@example.test',
      'THIS LINE HAS NO COLON AT ALL',
      'DTSTART:20260115T090000Z',
      'SUMMARY:Still parses',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = parseIcs(text);
    assert.equal(result!.events[0]!.summary, 'Still parses');
  });
});

// ─── parseIcs: folding and text escaping ───────────────────────────────────

describe('parseIcs — line unfolding and RFC 5545 text escaping', () => {
  it('unfolds a SUMMARY continued across multiple physical lines', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:fold@example.test',
      'DTSTART:20260115T090000Z',
      'SUMMARY:This is a long summary that has been folde',
      ' d across\ttwo continuation lines for test',
      ' ing purposes',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = parseIcs(text);
    assert.equal(
      result!.events[0]!.summary,
      'This is a long summary that has been folded across\ttwo continuation lines for testing purposes',
    );
  });

  it('unescapes \\n, \\, and \\; while keeping unknown escapes literal', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:escape@example.test',
      'DTSTART:20260115T090000Z',
      'DESCRIPTION:Agenda:\\n1) Intro\\, welcome\\; 2) Q&A \\o/',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = parseIcs(text);
    assert.equal(result!.events[0]!.description, 'Agenda:\n1) Intro, welcome; 2) Q&A \\o/');
  });

  it('handles bare LF line endings as well as CRLF', () => {
    const text = 'BEGIN:VCALENDAR\nMETHOD:CANCEL\nBEGIN:VEVENT\nUID:lf@example.test\nDTSTART:20260115T090000Z\nEND:VEVENT\nEND:VCALENDAR\n';
    const result = parseIcs(text);
    assert.equal(result!.method, 'CANCEL');
    assert.equal(result!.events[0]!.uid, 'lf@example.test');
  });
});

// ─── parseIcs: METHOD ───────────────────────────────────────────────────────

describe('parseIcs — METHOD', () => {
  it('recognises REQUEST, REPLY, CANCEL, and PUBLISH', () => {
    for (const method of ['REQUEST', 'REPLY', 'CANCEL', 'PUBLISH'] as const) {
      const text = `BEGIN:VCALENDAR\r\nMETHOD:${method}\r\nBEGIN:VEVENT\r\nUID:m@example.test\r\nDTSTART:20260115T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
      assert.equal(parseIcs(text)!.method, method);
    }
  });

  it('defaults to null for a missing or unrecognised METHOD', () => {
    const missing = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:m@example.test\r\nDTSTART:20260115T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    assert.equal(parseIcs(missing)!.method, null);

    const bogus = 'BEGIN:VCALENDAR\r\nMETHOD:BOGUS\r\nBEGIN:VEVENT\r\nUID:m@example.test\r\nDTSTART:20260115T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    assert.equal(parseIcs(bogus)!.method, null);
  });
});

// ─── parseIcs: DTSTART/DTEND, all-day, TZID, DURATION ──────────────────────

describe('parseIcs — DTSTART/DTEND date-time forms', () => {
  it('reads a UTC Z-suffixed DTSTART/DTEND', () => {
    const text = [
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:utc@example.test',
      'DTSTART:20260115T090000Z',
      'DTEND:20260115T100000Z',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const event = parseIcs(text)!.events[0]!;
    assert.equal(event.startsAtUtc, '2026-01-15T09:00:00Z');
    assert.equal(event.endsAtUtc, '2026-01-15T10:00:00Z');
    assert.equal(event.allDay, false);
  });

  it('reads a VALUE=DATE all-day event with an exclusive-end DTEND', () => {
    const text = [
      'BEGIN:VCALENDAR', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      'UID:allday@example.test',
      'DTSTART;VALUE=DATE:20260115',
      'DTEND;VALUE=DATE:20260117',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const event = parseIcs(text)!.events[0]!;
    assert.equal(event.allDay, true);
    assert.equal(event.startsAtUtc, '2026-01-15');
    assert.equal(event.endsAtUtc, '2026-01-17');
  });

  it('also treats a bare 8-digit DTSTART value as an all-day date', () => {
    const text = [
      'BEGIN:VCALENDAR', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      'UID:bare-date@example.test',
      'DTSTART:20260115',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const event = parseIcs(text)!.events[0]!;
    assert.equal(event.allDay, true);
    assert.equal(event.startsAtUtc, '2026-01-15');
  });

  it('converts a TZID wall-clock time to UTC across a standard/daylight boundary', () => {
    const winter = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:tz-winter@example.test',
      'DTSTART;TZID=America/New_York:20260115T090000',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;
    // EST is UTC-5 in January.
    assert.equal(winter.startsAtUtc, '2026-01-15T14:00:00Z');

    const summer = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:tz-summer@example.test',
      'DTSTART;TZID=America/New_York:20260715T090000',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;
    // EDT is UTC-4 in July.
    assert.equal(summer.startsAtUtc, '2026-07-15T13:00:00Z');
  });

  it('converts a southern-hemisphere TZID (Australia/Sydney) to UTC', () => {
    const event = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:tz-syd@example.test',
      'DTSTART;TZID=Australia/Sydney:20260115T090000',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;
    // AEDT is UTC+11 in January.
    assert.equal(event.startsAtUtc, '2026-01-14T22:00:00Z');
  });

  it('degrades an unresolvable TZID (a Windows zone name) to treating the value as UTC', () => {
    const event = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:tz-windows@example.test',
      'DTSTART;TZID="W. Europe Standard Time":20260115T090000',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;
    assert.equal(event.startsAtUtc, '2026-01-15T09:00:00Z');
  });

  it('treats a floating local time (no Z, no TZID) as UTC', () => {
    const event = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:floating@example.test',
      'DTSTART:20260115T090000',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;
    assert.equal(event.startsAtUtc, '2026-01-15T09:00:00Z');
  });

  it('derives DTEND from DURATION when DTEND is absent', () => {
    const timed = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:duration@example.test',
      'DTSTART:20260115T090000Z',
      'DURATION:PT1H30M',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;
    assert.equal(timed.endsAtUtc, '2026-01-15T10:30:00Z');

    const allDay = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:duration-allday@example.test',
      'DTSTART;VALUE=DATE:20260115',
      'DURATION:P2D',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;
    assert.equal(allDay.endsAtUtc, '2026-01-17');
  });

  it('leaves endsAtUtc null when neither DTEND nor DURATION is present', () => {
    const event = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:open-ended@example.test',
      'DTSTART:20260115T090000Z',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;
    assert.equal(event.endsAtUtc, null);
  });
});

// ─── parseIcs: ORGANIZER / ATTENDEE / PARTSTAT ─────────────────────────────

describe('parseIcs — organizer and attendees', () => {
  it('strips mailto: case-insensitively and captures CN', () => {
    const event = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:org@example.test',
      'DTSTART:20260115T090000Z',
      'ORGANIZER;CN=Jane Doe:MAILTO:jane@example.test',
      'ATTENDEE;CN=Bob Roe;PARTSTAT=ACCEPTED:mailto:bob@example.test',
      'ATTENDEE;CN=Amy Poe;PARTSTAT=DECLINED:mailto:AMY@Example.test',
      'ATTENDEE:mailto:no-partstat@example.test',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;

    assert.equal(event.organizerAddress, 'jane@example.test');
    assert.equal(event.organizerName, 'Jane Doe');
    assert.deepEqual(event.attendees, [
      { address: 'bob@example.test', name: 'Bob Roe', partstat: 'accepted' },
      { address: 'AMY@Example.test', name: 'Amy Poe', partstat: 'declined' },
      { address: 'no-partstat@example.test', name: '', partstat: 'needs-action' },
    ]);
  });

  it('normalizes an unrecognised PARTSTAT to needs-action', () => {
    const event = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:delegated@example.test',
      'DTSTART:20260115T090000Z',
      'ATTENDEE;PARTSTAT=DELEGATED:mailto:someone@example.test',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;
    assert.equal(event.attendees[0]!.partstat, 'needs-action');
  });
});

// ─── parseIcs: STATUS / SEQUENCE / RRULE ───────────────────────────────────

describe('parseIcs — status, sequence, and rrule', () => {
  it('defaults status to confirmed and reads STATUS:CANCELLED', () => {
    const confirmed = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:s1@example.test', 'DTSTART:20260115T090000Z',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;
    assert.equal(confirmed.status, 'confirmed');

    const cancelled = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:CANCEL', 'BEGIN:VEVENT',
      'UID:s2@example.test', 'DTSTART:20260115T090000Z', 'STATUS:CANCELLED',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;
    assert.equal(cancelled.status, 'cancelled');
  });

  it('parses SEQUENCE and defaults invalid/negative values to 0', () => {
    for (const [raw, expected] of [['3', 3], ['0', 0], ['-1', 0], ['abc', 0], ['', 0]] as const) {
      const event = parseIcs([
        'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
        'UID:seq@example.test', 'DTSTART:20260115T090000Z', `SEQUENCE:${raw}`,
        'END:VEVENT', 'END:VCALENDAR',
      ].join('\r\n'))!.events[0]!;
      assert.equal(event.sequence, expected, `SEQUENCE:${raw}`);
    }
  });

  it('carries RRULE through verbatim', () => {
    const event = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:rrule@example.test', 'DTSTART:20260115T090000Z',
      'RRULE:FREQ=WEEKLY;COUNT=5;BYDAY=TH',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;
    assert.equal(event.rrule, 'FREQ=WEEKLY;COUNT=5;BYDAY=TH');
  });
});

// ─── parseIcs: nested components must not leak into the VEVENT ────────────

describe('parseIcs — component nesting', () => {
  it('does not let a nested VALARM DESCRIPTION overwrite the VEVENT DESCRIPTION', () => {
    const event = parseIcs([
      'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      'UID:alarm@example.test',
      'DTSTART:20260115T090000Z',
      'DESCRIPTION:Real event description',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Reminder popup text',
      'TRIGGER:-PT15M',
      'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'))!.events[0]!;
    assert.equal(event.description, 'Real event description');
  });

  it('ignores VTIMEZONE STANDARD/DAYLIGHT properties and produces no phantom events', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'METHOD:REQUEST',
      'BEGIN:VTIMEZONE',
      'TZID:Europe/London',
      'BEGIN:STANDARD',
      'DTSTART:19961027T020000',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0000',
      'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:19970330T010000',
      'TZOFFSETFROM:+0000',
      'TZOFFSETTO:+0100',
      'END:DAYLIGHT',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:real-event@example.test',
      'DTSTART;TZID=Europe/London:20260115T090000',
      'SUMMARY:Real meeting',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = parseIcs(text)!;
    assert.equal(result.method, 'REQUEST');
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]!.uid, 'real-event@example.test');
    assert.equal(result.events[0]!.summary, 'Real meeting');
    // London is UTC in January (standard time).
    assert.equal(result.events[0]!.startsAtUtc, '2026-01-15T09:00:00Z');
  });

  it('parses multiple VEVENTs in one VCALENDAR independently', () => {
    const text = [
      'BEGIN:VCALENDAR', 'METHOD:REQUEST',
      'BEGIN:VEVENT', 'UID:first@example.test', 'DTSTART:20260115T090000Z', 'SUMMARY:First', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:second@example.test', 'DTSTART:20260116T090000Z', 'SUMMARY:Second', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const events = parseIcs(text)!.events;
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((event) => event.summary), ['First', 'Second']);
  });
});

// ─── parseIcs: realistic Outlook-style and Google-style samples ───────────

describe('parseIcs — realistic samples', () => {
  it('parses an Outlook-style REQUEST with a Windows TZID and folded lines', () => {
    // Outlook desktop historically emits Windows time zone names (not IANA
    // IDs) and quotes the TZID. Since that name cannot be resolved, the
    // wall-clock value is taken as UTC — the same tolerant fallback as any
    // other unresolvable TZID.
    const text = [
      'BEGIN:VCALENDAR',
      'PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN',
      'VERSION:2.0',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:040000008200E00074C5B7101A82E0080000000090A1B2C3D4E5F60',
      'SEQUENCE:0',
      'DTSTAMP:20260810T120000Z',
      'DTSTART;TZID="W. Europe Standard Time":20260115T140000',
      'DTEND;TZID="W. Europe Standard Time":20260115T150000',
      'SUMMARY:Quarterly sync with the Berlin team and a summary long enough ',
      ' to require folding across a couple of continuation lines in real Outlo',
      ' ok output',
      'LOCATION:Conference Room 4B',
      'ORGANIZER;CN=Alex Example:mailto:alex@example.test',
      'ATTENDEE;CN=Robin Example;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:robin@example.test',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = parseIcs(text)!;
    assert.equal(parsed.method, 'REQUEST');
    const event = parsed.events[0]!;
    assert.equal(event.startsAtUtc, '2026-01-15T14:00:00Z');
    assert.equal(event.summary, 'Quarterly sync with the Berlin team and a summary long enough to require folding across a couple of continuation lines in real Outlook output');
    assert.equal(event.organizerAddress, 'alex@example.test');
    assert.equal(event.attendees[0]!.address, 'robin@example.test');
    assert.equal(event.attendees[0]!.partstat, 'needs-action');
  });

  it('parses a Google-style REQUEST with an IANA TZID and a VTIMEZONE block', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
      'VERSION:2.0',
      'METHOD:REQUEST',
      'BEGIN:VTIMEZONE',
      'TZID:Australia/Sydney',
      'X-LIC-LOCATION:Australia/Sydney',
      'BEGIN:STANDARD',
      'TZOFFSETFROM:+1100',
      'TZOFFSETTO:+1000',
      'DTSTART:19700405T030000',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'TZOFFSETFROM:+1000',
      'TZOFFSETTO:+1100',
      'DTSTART:19701004T020000',
      'END:DAYLIGHT',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'DTSTART;TZID=Australia/Sydney:20260115T090000',
      'DTEND;TZID=Australia/Sydney:20260115T093000',
      'DTSTAMP:20260810T120000Z',
      'UID:abc123@google.com',
      'ATTENDEE;CN=Sam Example;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:sam@example.test',
      'ORGANIZER;CN=Priya Example:mailto:priya@example.test',
      'SEQUENCE:1',
      'SUMMARY:Standup',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const event = parseIcs(text)!.events[0]!;
    assert.equal(event.startsAtUtc, '2026-01-14T22:00:00Z');
    assert.equal(event.endsAtUtc, '2026-01-14T22:30:00Z');
    assert.equal(event.summary, 'Standup');
    assert.equal(event.sequence, 1);
  });

  it('parses a CANCEL sample', () => {
    const text = [
      'BEGIN:VCALENDAR', 'METHOD:CANCEL', 'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:cancel-me@example.test',
      'SEQUENCE:2',
      'DTSTART:20260115T090000Z',
      'STATUS:CANCELLED',
      'SUMMARY:Cancelled meeting',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const parsed = parseIcs(text)!;
    assert.equal(parsed.method, 'CANCEL');
    assert.equal(parsed.events[0]!.status, 'cancelled');
    assert.equal(parsed.events[0]!.sequence, 2);
  });

  it('parses a REPLY sample with a single responding attendee', () => {
    const text = [
      'BEGIN:VCALENDAR', 'METHOD:REPLY', 'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:reply-me@example.test',
      'SEQUENCE:0',
      'DTSTAMP:20260810T120000Z',
      'DTSTART:20260115T090000Z',
      'ORGANIZER:mailto:organizer@example.test',
      'ATTENDEE;CN=Robin Example;PARTSTAT=DECLINED:mailto:robin@example.test',
      'SUMMARY:Re: Quarterly sync',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const parsed = parseIcs(text)!;
    assert.equal(parsed.method, 'REPLY');
    assert.equal(parsed.events[0]!.attendees.length, 1);
    assert.equal(parsed.events[0]!.attendees[0]!.address, 'robin@example.test');
    assert.equal(parsed.events[0]!.attendees[0]!.partstat, 'declined');
  });
});

// ─── buildIcs ───────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-08-20T12:34:56.000Z');

function baseInput(overrides: Partial<BuildIcsInput> = {}): BuildIcsInput {
  return {
    method: 'REQUEST',
    now: FIXED_NOW,
    uid: 'event-1@cmail.example',
    sequence: 0,
    summary: 'Quarterly review',
    description: 'Agenda:\nDiscuss Q3 numbers',
    location: 'Room 4B',
    startsAtUtc: '2026-09-01T09:00:00Z',
    endsAtUtc: '2026-09-01T10:00:00Z',
    organizerAddress: 'organizer@example.test',
    organizerName: 'Organizer Example',
    attendees: [
      { address: 'alice@example.test', name: 'Alice Example', partstat: 'accepted' },
      { address: 'bob@example.test', name: 'Bob Example', partstat: 'needs-action' },
    ],
    ...overrides,
  };
}

function unfoldRaw(ics: string): string {
  return ics.replace(/\r\n /g, '');
}

describe('buildIcs — structure and required fields', () => {
  it('builds a well-formed REQUEST with CRLF line endings', () => {
    const ics = buildIcs(baseInput());
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
    assert.ok(ics.includes('VERSION:2.0\r\n'));
    assert.ok(ics.includes('PRODID:-//cmail//EN\r\n'));
    assert.ok(ics.includes('METHOD:REQUEST\r\n'));
    assert.ok(ics.includes('BEGIN:VEVENT\r\n'));
    assert.ok(ics.includes('END:VEVENT\r\n'));
    // Every real line break is CRLF: no bare LF should appear on its own.
    assert.ok(!ics.replace(/\r\n/g, '').includes('\n'));
  });

  it('writes DTSTAMP from the supplied now, not the wall clock', () => {
    const ics = buildIcs(baseInput());
    assert.ok(unfoldRaw(ics).includes('DTSTAMP:20260820T123456Z'));
  });

  it('writes UID, SEQUENCE, DTSTART/DTEND in UTC form, SUMMARY/LOCATION/DESCRIPTION', () => {
    const raw = unfoldRaw(buildIcs(baseInput({ sequence: 4 })));
    assert.ok(raw.includes('UID:event-1@cmail.example'));
    assert.ok(raw.includes('SEQUENCE:4'));
    assert.ok(raw.includes('DTSTART:20260901T090000Z'));
    assert.ok(raw.includes('DTEND:20260901T100000Z'));
    assert.ok(raw.includes('SUMMARY:Quarterly review'));
    assert.ok(raw.includes('LOCATION:Room 4B'));
    assert.ok(raw.includes('DESCRIPTION:Agenda:\\nDiscuss Q3 numbers'));
  });

  it('writes ORGANIZER;CN and ATTENDEE;CN;PARTSTAT;RSVP=TRUE lines', () => {
    const raw = unfoldRaw(buildIcs(baseInput()));
    assert.ok(raw.includes('ORGANIZER;CN=Organizer Example:mailto:organizer@example.test'));
    assert.ok(raw.includes('ATTENDEE;CN=Alice Example;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:alice@example.test'));
    assert.ok(raw.includes('ATTENDEE;CN=Bob Example;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:bob@example.test'));
  });

  it('writes STATUS reflecting confirmed/cancelled', () => {
    assert.ok(unfoldRaw(buildIcs(baseInput())).includes('STATUS:CONFIRMED'));
    assert.ok(unfoldRaw(buildIcs(baseInput({ method: 'CANCEL', status: 'cancelled' }))).includes('STATUS:CANCELLED'));
  });

  it('writes VALUE=DATE forms for an all-day event and omits time-of-day', () => {
    const raw = unfoldRaw(buildIcs(baseInput({
      allDay: true,
      startsAtUtc: '2026-09-01',
      endsAtUtc: '2026-09-03',
    })));
    assert.ok(raw.includes('DTSTART;VALUE=DATE:20260901'));
    assert.ok(raw.includes('DTEND;VALUE=DATE:20260903'));
  });

  it('omits DTEND entirely when endsAtUtc is absent', () => {
    const raw = unfoldRaw(buildIcs(baseInput({ endsAtUtc: null })));
    assert.ok(!raw.includes('DTEND'));
  });

  it('writes RRULE only when supplied', () => {
    assert.ok(!unfoldRaw(buildIcs(baseInput())).includes('RRULE'));
    assert.ok(unfoldRaw(buildIcs(baseInput({ rrule: 'FREQ=WEEKLY;COUNT=3' }))).includes('RRULE:FREQ=WEEKLY;COUNT=3'));
  });
});

describe('buildIcs — REPLY emits a single responder attendee', () => {
  it('keeps only the first attendee even when more are supplied', () => {
    const ics = buildIcs(baseInput({
      method: 'REPLY',
      attendees: [
        { address: 'alice@example.test', name: 'Alice Example', partstat: 'declined' },
        { address: 'bob@example.test', name: 'Bob Example', partstat: 'accepted' },
      ],
    }));
    const raw = unfoldRaw(ics);
    const attendeeLines = raw.split('\r\n').filter((line) => line.startsWith('ATTENDEE'));
    assert.equal(attendeeLines.length, 1);
    assert.ok(attendeeLines[0]!.includes('alice@example.test'));
    assert.ok(attendeeLines[0]!.includes('PARTSTAT=DECLINED'));
    assert.equal(raw.includes('bob@example.test'), false);
  });
});

describe('buildIcs — escaping', () => {
  it('escapes backslashes, semicolons, commas, and newlines in TEXT values', () => {
    const raw = unfoldRaw(buildIcs(baseInput({
      summary: 'Sales; Marketing, and Ops \\ Review',
      description: 'Line one\nLine two',
    })));
    assert.ok(raw.includes('SUMMARY:Sales\\; Marketing\\, and Ops \\\\ Review'));
    assert.ok(raw.includes('DESCRIPTION:Line one\\nLine two'));
  });

  it('quotes a CN parameter value only when it needs quoting', () => {
    const plain = unfoldRaw(buildIcs(baseInput({ organizerName: 'Plain Name' })));
    assert.ok(plain.includes('ORGANIZER;CN=Plain Name:'));

    const withComma = unfoldRaw(buildIcs(baseInput({ organizerName: 'Doe, Jane' })));
    assert.ok(withComma.includes('ORGANIZER;CN="Doe, Jane":'));
  });
});

describe('buildIcs — folding at 75 octets', () => {
  it('folds long lines so every physical line is at most 75 UTF-8 octets, continuations start with one space', () => {
    const ics = buildIcs(baseInput({ summary: 'x'.repeat(200) }));
    const encoder = new TextEncoder();
    const physicalLines = ics.split('\r\n').filter((line) => line.length > 0);
    for (const line of physicalLines) {
      assert.ok(encoder.encode(line).byteLength <= 75, `line too long: ${line.length} chars`);
    }
    const summaryLineIndex = physicalLines.findIndex((line) => line.startsWith('SUMMARY:'));
    assert.ok(summaryLineIndex >= 0);
    assert.ok(physicalLines[summaryLineIndex + 1]!.startsWith(' '));
    assert.ok(!physicalLines[summaryLineIndex + 1]!.startsWith('  '));
  });

  it('never splits a multi-byte UTF-8 sequence across a fold boundary', () => {
    const summary = `Meeting with the São Paulo and Zürich teams ${'é'.repeat(60)}`;
    const ics = buildIcs(baseInput({ summary }));
    // A split inside a UTF-8 sequence would corrupt the text irrecoverably;
    // round-tripping through parseIcs is the strongest possible check.
    const parsed = parseIcs(ics)!;
    assert.equal(parsed.events[0]!.summary, summary);
  });
});

describe('buildIcs / parseIcs — round trip', () => {
  it('recovers every field of a REQUEST after build then parse', () => {
    const input = baseInput({ sequence: 7, rrule: 'FREQ=DAILY;COUNT=2' });
    const parsed = parseIcs(buildIcs(input))!;
    assert.equal(parsed.method, 'REQUEST');
    const event = parsed.events[0]!;
    assert.equal(event.uid, input.uid);
    assert.equal(event.sequence, 7);
    assert.equal(event.summary, input.summary);
    assert.equal(event.description, input.description);
    assert.equal(event.location, input.location);
    assert.equal(event.startsAtUtc, input.startsAtUtc);
    assert.equal(event.endsAtUtc, input.endsAtUtc);
    assert.equal(event.allDay, false);
    assert.equal(event.status, 'confirmed');
    assert.equal(event.organizerAddress, input.organizerAddress);
    assert.equal(event.organizerName, input.organizerName);
    assert.equal(event.rrule, 'FREQ=DAILY;COUNT=2');
    assert.deepEqual(event.attendees, [
      { address: 'alice@example.test', name: 'Alice Example', partstat: 'accepted' },
      { address: 'bob@example.test', name: 'Bob Example', partstat: 'needs-action' },
    ]);
  });

  it('recovers an all-day event', () => {
    const input = baseInput({ allDay: true, startsAtUtc: '2026-09-01', endsAtUtc: '2026-09-03' });
    const event = parseIcs(buildIcs(input))!.events[0]!;
    assert.equal(event.allDay, true);
    assert.equal(event.startsAtUtc, '2026-09-01');
    assert.equal(event.endsAtUtc, '2026-09-03');
  });

  it('recovers a CANCEL', () => {
    const input = baseInput({ method: 'CANCEL', status: 'cancelled', sequence: 3 });
    const parsed = parseIcs(buildIcs(input))!;
    assert.equal(parsed.method, 'CANCEL');
    assert.equal(parsed.events[0]!.status, 'cancelled');
    assert.equal(parsed.events[0]!.sequence, 3);
  });

  it('recovers a REPLY with its single responder', () => {
    const input = baseInput({
      method: 'REPLY',
      attendees: [{ address: 'alice@example.test', name: 'Alice Example', partstat: 'tentative' }],
    });
    const parsed = parseIcs(buildIcs(input))!;
    assert.equal(parsed.method, 'REPLY');
    assert.deepEqual(parsed.events[0]!.attendees, [
      { address: 'alice@example.test', name: 'Alice Example', partstat: 'tentative' },
    ]);
  });
});
