import { describe, expect, it, vi } from 'vitest';

// The migration and packages/shared/src/ics.ts module this feature depends on
// are owned by a different in-flight change. Mock the module so these tests
// exercise the route logic regardless of that work's landing order.
vi.mock('@cmail/shared/ics', () => ({
  buildIcs: vi.fn(() => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'),
  parseIcs: vi.fn(() => null),
}));

import { actions as newMeetingActions } from './new/+page.server';
import { actions as calendarActions } from './+page.server';
import { actions as messageActions } from '../[id]/+page.server';

interface QueryCall {
  sql: string;
  values: unknown[];
}

/**
 * A D1 mock whose `.first()`/`.all()` results are chosen by matching a SQL
 * substring; unmatched statements get null / an empty result set.
 */
function mockDb(
  firstBySubstring: Array<[string, unknown]>,
  runChanges = 1,
  allBySubstring: Array<[string, unknown[]]> = [],
): { db: D1Database; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const db = {
    prepare(sql: string) {
      const call: QueryCall = { sql, values: [] };
      calls.push(call);
      const statement = {
        bind(...values: unknown[]) {
          call.values = values;
          return statement;
        },
        async first<T>() {
          const match = firstBySubstring.find(([pattern]) => sql.includes(pattern));
          return (match ? match[1] : null) as T | null;
        },
        async all<T>() {
          const match = allBySubstring.find(([pattern]) => sql.includes(pattern));
          return { results: (match ? match[1] : []) as T[] };
        },
        async run() {
          return { success: true, meta: { changes: runChanges } };
        },
      };
      return statement;
    },
    async batch(statements: unknown[]) {
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  } as unknown as D1Database;
  return { db, calls };
}

function locals(): App.Locals {
  return {
    user: {
      id: 'user-1',
      email: 'rob@example.com',
      display_name: 'Rob Evans',
      role: 'standard',
      status: 'active',
      auth_provider: 'google',
      created_at: '2026-01-01 00:00:00',
      updated_at: '2026-01-01 00:00:00',
      last_sign_in: null,
      last_auth_country: null,
    },
    sessionId: 'session-1',
  };
}

function platform(db: D1Database): App.Platform {
  return {
    env: { DB: db, STORAGE: {} as R2Bucket, MAIL_DOMAIN: 'example.com' } as App.Platform['env'],
    context: {} as ExecutionContext,
    caches: {},
  } as unknown as App.Platform;
}

describe('calendar/new create action', () => {
  it('rejects a missing title without touching the database', async () => {
    const { db, calls } = mockDb([]);
    const formData = new FormData();
    formData.set('from', 'rob@example.com');
    formData.set('date', '2026-08-25');
    formData.set('start_time', '14:00');
    formData.set('end_time', '14:30');
    formData.set('attendees', 'jamie@example.com');

    const result = await (newMeetingActions.create as any)({
      request: new Request('https://mail.example.com/mail/calendar/new?/create', { method: 'POST', body: formData }),
      locals: locals(),
      platform: platform(db),
    });

    expect(result).toMatchObject({ status: 400, data: { error: 'Title is required' } });
    expect(calls).toHaveLength(0);
  });

  it('rejects an end time that is not after the start time', async () => {
    const { db } = mockDb([]);
    const formData = new FormData();
    formData.set('from', 'rob@example.com');
    formData.set('title', 'Weekly sync');
    formData.set('date', '2026-08-25');
    formData.set('start_time', '14:00');
    formData.set('end_time', '14:00');
    formData.set('attendees', 'jamie@example.com');

    const result = await (newMeetingActions.create as any)({
      request: new Request('https://mail.example.com/mail/calendar/new?/create', { method: 'POST', body: formData }),
      locals: locals(),
      platform: platform(db),
    });

    expect(result).toMatchObject({ status: 400, data: { error: 'End time must be after the start time' } });
  });

  it('rejects a meeting with no attendees', async () => {
    const { db } = mockDb([]);
    const formData = new FormData();
    formData.set('from', 'rob@example.com');
    formData.set('title', 'Weekly sync');
    formData.set('date', '2026-08-25');
    formData.set('start_time', '14:00');
    formData.set('end_time', '14:30');
    formData.set('attendees', '');

    const result = await (newMeetingActions.create as any)({
      request: new Request('https://mail.example.com/mail/calendar/new?/create', { method: 'POST', body: formData }),
      locals: locals(),
      platform: platform(db),
    });

    expect(result).toMatchObject({ status: 400, data: { error: 'Add at least one attendee' } });
  });

  it('saves the event and attendees, and reports a plain retry message when delivery fails', async () => {
    const { db, calls } = mockDb([
      ['SELECT m.id, m.address, m.display_name FROM mailboxes', { id: 'mailbox-1', address: 'rob@example.com', display_name: 'Rob Evans' }],
    ]);
    const formData = new FormData();
    formData.set('from', 'rob@example.com');
    formData.set('title', 'Weekly sync');
    formData.set('date', '2026-08-25');
    formData.set('start_time', '14:00');
    formData.set('end_time', '14:30');
    formData.set('location', 'Room 4');
    formData.set('attendees', 'jamie@example.com, pat@example.com');
    formData.set('description', 'Bring the roadmap doc.');

    // No OUTBOUND_PROVIDER, Cloudflare, or Postmark credentials are configured,
    // so sendEmail() deterministically fails without any network call.
    const result: any = await (newMeetingActions.create as any)({
      request: new Request('https://mail.example.com/mail/calendar/new?/create', { method: 'POST', body: formData }),
      locals: locals(),
      platform: platform(db),
    });

    expect(result.status).toBe(502);
    expect(result.data.error).toContain('Meeting saved');
    expect(result.data.error).toContain('weren\'t sent');

    const eventInsert = calls.find(({ sql }) => sql.includes('INSERT INTO calendar_events'));
    expect(eventInsert).toBeDefined();
    expect((eventInsert!.sql.match(/\?/g) || []).length).toBe(eventInsert!.values.length);
    expect(eventInsert!.values).toContain('Weekly sync');
    expect(eventInsert!.values).toContain('mailbox-1');

    const attendeeInserts = calls.filter(({ sql }) => sql.includes('INSERT INTO calendar_attendees'));
    expect(attendeeInserts).toHaveLength(2);
    for (const insert of attendeeInserts) {
      expect((insert.sql.match(/\?/g) || []).length).toBe(insert.values.length);
    }
    expect(attendeeInserts.map((insert) => insert.values[2])).toEqual(['jamie@example.com', 'pat@example.com']);

    const auditInsert = calls.find(({ sql }) => sql.includes('INSERT INTO audit_log'));
    expect(auditInsert).toBeDefined();
    expect(auditInsert!.values).toContain('calendar.event_created');
  });
});

describe('mail/[id] rsvp action', () => {
  it('rejects an invalid partstat', async () => {
    const { db } = mockDb([]);
    const formData = new FormData();
    formData.set('partstat', 'maybe-later');

    const result = await (messageActions.rsvp as any)({
      request: new Request('https://mail.example.com/mail/message-1?/rsvp', { method: 'POST', body: formData }),
      locals: locals(),
      platform: platform(db),
      params: { id: 'message-1' },
    });

    expect(result).toMatchObject({ status: 400, data: { error: 'Choose a response' } });
  });

  it('saves the response and reports a plain message when the reply cannot be sent', async () => {
    const { db, calls } = mockDb([
      ['FROM messages m', {
        id: 'message-1',
        mailbox_id: 'mailbox-1',
        message_id_header: '<abc@example.com>',
        in_reply_to: null,
        references_header: null,
        mailbox_address: 'rob@example.com',
        mailbox_display_name: 'Rob Evans',
      }],
      ['SELECT * FROM calendar_events WHERE message_id = ?', {
        id: 'event-1',
        mailbox_id: 'mailbox-1',
        uid: 'uid-1@cmail',
        sequence: 0,
        summary: 'Weekly sync',
        description: '',
        location: '',
        starts_at: '2026-08-25T14:00:00.000Z',
        ends_at: '2026-08-25T14:30:00.000Z',
        all_day: 0,
        status: 'confirmed',
        organizer_address: 'organiser@example.com',
        organizer_self: 0,
        message_id: 'message-1',
        rrule: null,
        created_at: '2026-08-01 00:00:00',
        updated_at: '2026-08-01 00:00:00',
      }],
    ]);
    const formData = new FormData();
    formData.set('partstat', 'accepted');

    const result: any = await (messageActions.rsvp as any)({
      request: new Request('https://mail.example.com/mail/message-1?/rsvp', { method: 'POST', body: formData }),
      locals: locals(),
      platform: platform(db),
      params: { id: 'message-1' },
    });

    expect(result.status).toBe(502);
    expect(result.data.error).toContain('Your response was saved');

    const upsert = calls.find(({ sql }) => sql.includes('INSERT INTO calendar_attendees'));
    expect(upsert).toBeDefined();
    expect(upsert!.sql).toContain('ON CONFLICT(event_id, address)');
    expect(upsert!.values).toContain('rob@example.com');
    expect(upsert!.values).toContain('accepted');

    const auditInsert = calls.find(({ sql }) => sql.includes('INSERT INTO audit_log'));
    expect(auditInsert!.values).toContain('calendar.rsvp_sent');
  });

  it('refuses to record a response to a cancelled meeting', async () => {
    const { db } = mockDb([
      ['FROM messages m', {
        id: 'message-1', mailbox_id: 'mailbox-1', message_id_header: null, in_reply_to: null, references_header: null,
        mailbox_address: 'rob@example.com', mailbox_display_name: 'Rob Evans',
      }],
      ['SELECT * FROM calendar_events WHERE message_id = ?', {
        id: 'event-1', mailbox_id: 'mailbox-1', uid: 'uid-1@cmail', sequence: 1, summary: 'Weekly sync',
        description: '', location: '', starts_at: '2026-08-25T14:00:00.000Z', ends_at: '2026-08-25T14:30:00.000Z',
        all_day: 0, status: 'cancelled', organizer_address: 'organiser@example.com', organizer_self: 0,
        message_id: 'message-1', rrule: null, created_at: '2026-08-01 00:00:00', updated_at: '2026-08-01 00:00:00',
      }],
    ]);
    const formData = new FormData();
    formData.set('partstat', 'accepted');

    const result = await (messageActions.rsvp as any)({
      request: new Request('https://mail.example.com/mail/message-1?/rsvp', { method: 'POST', body: formData }),
      locals: locals(),
      platform: platform(db),
      params: { id: 'message-1' },
    });

    expect(result).toMatchObject({ status: 400, data: { error: 'This meeting was cancelled.' } });
  });
});

describe('calendar cancel action', () => {
  it('returns not found when there is no accessible event for this id', async () => {
    const { db } = mockDb([]); // no matching row: unknown id, wrong mailbox, or read-only permission
    const formData = new FormData();
    formData.set('event_id', 'event-1');

    await expect((calendarActions.cancel as any)({
      request: new Request('https://mail.example.com/mail/calendar?/cancel', { method: 'POST', body: formData }),
      locals: locals(),
      platform: platform(db),
    })).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to cancel a mailbox\'s own copy of someone else\'s meeting', async () => {
    const { db } = mockDb([
      ['FROM calendar_events ce', {
        id: 'event-1', mailbox_id: 'mailbox-1', uid: 'uid-1@cmail', sequence: 0, summary: 'Weekly sync',
        description: '', location: '', starts_at: '2026-08-25T14:00:00.000Z', ends_at: '2026-08-25T14:30:00.000Z',
        all_day: 0, status: 'confirmed', organizer_address: 'someone.else@example.com', organizer_self: 0,
        message_id: 'message-1', rrule: null, created_at: '2026-08-01 00:00:00', updated_at: '2026-08-01 00:00:00',
        mailbox_address: 'rob@example.com', mailbox_display_name: 'Rob Evans',
      }],
    ]);
    const formData = new FormData();
    formData.set('event_id', 'event-1');

    const result = await (calendarActions.cancel as any)({
      request: new Request('https://mail.example.com/mail/calendar?/cancel', { method: 'POST', body: formData }),
      locals: locals(),
      platform: platform(db),
    });

    expect(result).toMatchObject({ status: 403, data: { error: 'Only the organiser can cancel this meeting' } });
  });

  it('cancels the meeting, bumps the sequence, and audits the change', async () => {
    const { db, calls } = mockDb([
      ['FROM calendar_events ce', {
        id: 'event-1', mailbox_id: 'mailbox-1', uid: 'uid-1@cmail', sequence: 0, summary: 'Weekly sync',
        description: '', location: 'Room 4', starts_at: '2026-08-25T14:00:00.000Z', ends_at: '2026-08-25T14:30:00.000Z',
        all_day: 0, status: 'confirmed', organizer_address: 'rob@example.com', organizer_self: 1,
        message_id: null, rrule: null, created_at: '2026-08-01 00:00:00', updated_at: '2026-08-01 00:00:00',
        mailbox_address: 'rob@example.com', mailbox_display_name: 'Rob Evans',
      }],
    ]);
    const formData = new FormData();
    formData.set('event_id', 'event-1');

    const result: any = await (calendarActions.cancel as any)({
      request: new Request('https://mail.example.com/mail/calendar?/cancel', { method: 'POST', body: formData }),
      locals: locals(),
      platform: platform(db),
    });

    const update = calls.find(({ sql }) => sql.includes('UPDATE calendar_events'));
    expect(update).toBeDefined();
    expect(update!.values[0]).toBe(1); // sequence bumped from 0 to 1

    const auditInsert = calls.find(({ sql }) => sql.includes('INSERT INTO audit_log'));
    expect(auditInsert!.values).toContain('calendar.event_cancelled');

    // No attendees were seeded in this mock, so there is nothing to notify —
    // cancellation still succeeds on its own.
    expect(result).toMatchObject({ cancelled: true });
  });

  it('keeps the cancellation even when notifying attendees fails', async () => {
    const { db, calls } = mockDb(
      [
        ['FROM calendar_events ce', {
          id: 'event-1', mailbox_id: 'mailbox-1', uid: 'uid-1@cmail', sequence: 2, summary: 'Weekly sync',
          description: '', location: '', starts_at: '2026-08-25T14:00:00.000Z', ends_at: '2026-08-25T14:30:00.000Z',
          all_day: 0, status: 'confirmed', organizer_address: 'rob@example.com', organizer_self: 1,
          message_id: null, rrule: null, created_at: '2026-08-01 00:00:00', updated_at: '2026-08-01 00:00:00',
          mailbox_address: 'rob@example.com', mailbox_display_name: 'Rob Evans',
        }],
      ],
      1,
      [
        ['SELECT * FROM calendar_attendees WHERE event_id = ?', [
          { id: 'a1', event_id: 'event-1', address: 'jamie@example.com', display_name: '', partstat: 'accepted', updated_at: '2026-08-01 00:00:00' },
        ]],
      ],
    );
    const formData = new FormData();
    formData.set('event_id', 'event-1');

    const result: any = await (calendarActions.cancel as any)({
      request: new Request('https://mail.example.com/mail/calendar?/cancel', { method: 'POST', body: formData }),
      locals: locals(),
      platform: platform(db),
    });

    // Delivery fails (no outbound provider is configured in this test), but
    // the status flip to 'cancelled' already committed before that attempt.
    expect(result.status).toBe(502);
    expect(result.data.error).toContain('Meeting cancelled, but attendees weren\'t notified');

    const update = calls.find(({ sql }) => sql.includes('UPDATE calendar_events'));
    expect(update!.values[0]).toBe(3); // sequence bumped from 2 to 3
  });
});
