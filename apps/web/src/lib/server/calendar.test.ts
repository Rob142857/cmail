import { describe, expect, it } from 'vitest';
import {
  cancellationBody,
  icsAttendeeInput,
  invitationBody,
  isIcsAttachment,
  isRsvpPartstat,
  myAttendee,
  resolveCalendarMailbox,
  rsvpBody,
  rsvpSubject,
  type CalendarAttendeeRow,
  type CalendarMailboxOption,
} from './calendar';

describe('isIcsAttachment', () => {
  it('accepts text/calendar and application/ics, with or without parameters', () => {
    expect(isIcsAttachment('text/calendar')).toBe(true);
    expect(isIcsAttachment('text/calendar; charset=utf-8; method=REQUEST')).toBe(true);
    expect(isIcsAttachment('TEXT/CALENDAR')).toBe(true);
    expect(isIcsAttachment('application/ics')).toBe(true);
  });

  it('rejects unrelated content types', () => {
    expect(isIcsAttachment('application/pdf')).toBe(false);
    expect(isIcsAttachment('')).toBe(false);
    expect(isIcsAttachment('text/plain')).toBe(false);
  });
});

describe('isRsvpPartstat', () => {
  it('accepts only the three sendable responses', () => {
    expect(isRsvpPartstat('accepted')).toBe(true);
    expect(isRsvpPartstat('declined')).toBe(true);
    expect(isRsvpPartstat('tentative')).toBe(true);
  });

  it('rejects needs-action and anything else', () => {
    expect(isRsvpPartstat('needs-action')).toBe(false);
    expect(isRsvpPartstat('bogus')).toBe(false);
    expect(isRsvpPartstat(undefined)).toBe(false);
    expect(isRsvpPartstat(null)).toBe(false);
  });
});

describe('resolveCalendarMailbox', () => {
  const mailboxes: CalendarMailboxOption[] = [
    { id: 'shared-1', address: 'team@example.com', display_name: 'Team', type: 'shared' },
    { id: 'personal-1', address: 'rob@example.com', display_name: 'Rob', type: 'personal' },
  ];

  it('returns null for an empty list', () => {
    expect(resolveCalendarMailbox([], 'anything')).toBeNull();
  });

  it('prefers an explicitly requested mailbox the person is assigned to', () => {
    expect(resolveCalendarMailbox(mailboxes, 'shared-1')?.id).toBe('shared-1');
  });

  it('falls back to the first personal mailbox when the request is unknown or absent', () => {
    expect(resolveCalendarMailbox(mailboxes, '')?.id).toBe('personal-1');
    expect(resolveCalendarMailbox(mailboxes, 'not-assigned')?.id).toBe('personal-1');
  });

  it('falls back to the first mailbox when there is no personal mailbox', () => {
    const sharedOnly: CalendarMailboxOption[] = [
      { id: 'shared-1', address: 'team@example.com', display_name: 'Team', type: 'shared' },
      { id: 'shared-2', address: 'ops@example.com', display_name: 'Ops', type: 'shared' },
    ];
    expect(resolveCalendarMailbox(sharedOnly, '')?.id).toBe('shared-1');
  });
});

describe('myAttendee', () => {
  const attendees = [{ address: 'rob@example.com' }, { address: 'jamie@example.com' }];

  it('matches case-insensitively', () => {
    expect(myAttendee(attendees, 'ROB@EXAMPLE.COM')?.address).toBe('rob@example.com');
  });

  it('returns undefined when nothing matches or the address is empty', () => {
    expect(myAttendee(attendees, 'nobody@example.com')).toBeUndefined();
    expect(myAttendee(attendees, '')).toBeUndefined();
  });
});

describe('rsvpSubject and rsvpBody', () => {
  it('builds a subject line per response', () => {
    expect(rsvpSubject('accepted', 'Weekly sync')).toBe('Accepted: Weekly sync');
    expect(rsvpSubject('declined', 'Weekly sync')).toBe('Declined: Weekly sync');
    expect(rsvpSubject('tentative', 'Weekly sync')).toBe('Tentative: Weekly sync');
  });

  it('falls back to a placeholder title', () => {
    expect(rsvpSubject('accepted', '')).toBe('Accepted: (no title)');
  });

  it('builds a matching one-line plain and HTML body', () => {
    const body = rsvpBody('declined', 'Weekly sync');
    expect(body.text).toBe('You declined the invitation to "Weekly sync".');
    expect(body.html).toBe('<p>You declined the invitation to &quot;Weekly sync&quot;.</p>');
  });

  it('escapes HTML-significant characters in the summary', () => {
    const body = rsvpBody('accepted', '<script>alert(1)</script>');
    expect(body.html).not.toContain('<script>');
    expect(body.html).toContain('&lt;script&gt;');
  });
});

describe('invitationBody and cancellationBody', () => {
  it('includes when/where lines and omits an empty location', () => {
    const withLocation = invitationBody('Weekly sync', 'Tue 25 Aug, 2:00 PM', 'Room 4', '');
    expect(withLocation.text).toBe('You\'re invited: Weekly sync\nWhen: Tue 25 Aug, 2:00 PM\nWhere: Room 4');
    const withoutLocation = invitationBody('Weekly sync', 'Tue 25 Aug, 2:00 PM', '', '');
    expect(withoutLocation.text).not.toContain('Where:');
  });

  it('appends the description as its own paragraph when present', () => {
    const body = invitationBody('Weekly sync', 'Tue 25 Aug, 2:00 PM', '', 'Bring the roadmap doc.');
    expect(body.text).toContain('Bring the roadmap doc.');
    expect(body.html).toContain('Bring the roadmap doc.');
  });

  it('builds a cancellation body with when/where lines', () => {
    const body = cancellationBody('Weekly sync', 'Tue 25 Aug, 2:00 PM', 'Room 4');
    expect(body.text).toBe('This meeting was cancelled: Weekly sync\nWhen: Tue 25 Aug, 2:00 PM\nWhere: Room 4');
    expect(body.html).toContain('This meeting was cancelled: Weekly sync');
  });
});

describe('icsAttendeeInput', () => {
  it('maps display_name to name and preserves address/partstat', () => {
    const rows: CalendarAttendeeRow[] = [
      { id: 'a1', event_id: 'e1', address: 'rob@example.com', display_name: 'Rob', partstat: 'accepted', updated_at: '2026-08-01 00:00:00' },
      { id: 'a2', event_id: 'e1', address: 'jamie@example.com', display_name: '', partstat: 'needs-action', updated_at: '2026-08-01 00:00:00' },
    ];
    expect(icsAttendeeInput(rows)).toEqual([
      { address: 'rob@example.com', name: 'Rob', partstat: 'accepted' },
      { address: 'jamie@example.com', name: '', partstat: 'needs-action' },
    ]);
  });
});
