import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { buildIcs } from '@cmail/shared/ics';
import {
  cancellationBody,
  icsAttendeeInput,
  myAttendee,
  resolveCalendarMailbox,
  type CalendarAttendeeRow,
  type CalendarEventRow,
  type CalendarMailboxOption,
} from '$lib/server/calendar';
import { audit } from '$lib/server/db';
import { publicRuntimeConfig } from '$lib/server/config';
import { formatEventRange } from '$lib/dates';
import { sanitizeSenderDisplayName, sendEmail } from '$lib/server/outbound';

const MONTH_RX = /^(\d{4})-(0[1-9]|1[0-2])$/;

function monthTotal(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function fromTotal(total: number): { year: number; month: number } {
  return { year: Math.floor(total / 12), month: (((total % 12) + 12) % 12) + 1 };
}

function monthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Clamp a requested `?month=` to [this month - 1, this month + 6]. */
function resolveMonth(requested: string): { year: number; month: number; min: number; max: number; total: number } {
  const now = new Date();
  const currentTotal = monthTotal(now.getUTCFullYear(), now.getUTCMonth() + 1);
  const min = currentTotal - 1;
  const max = currentTotal + 6;
  const match = MONTH_RX.exec(requested);
  const requestedTotal = match ? monthTotal(Number(match[1]), Number(match[2])) : currentTotal;
  const total = Math.max(min, Math.min(max, requestedTotal));
  const { year, month } = fromTotal(total);
  return { year, month, min, max, total };
}

function stringValue(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  if (!locals.user) throw redirect(303, '/');
  const env = platform?.env;
  if (!env) throw redirect(303, '/');

  const mailboxRows = await env.DB.prepare(
    `SELECT m.id, m.address, m.type, m.display_name, ma.permissions FROM mailboxes m
     INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
     WHERE ma.user_id = ? AND m.status = 'active'
     ORDER BY CASE m.type WHEN 'personal' THEN 0 ELSE 1 END, m.address`,
  ).bind(locals.user.id).all<CalendarMailboxOption & { permissions: 'read' | 'send-as' | 'full' }>();
  const mailboxes = mailboxRows.results || [];
  const requestedMailboxId = (url.searchParams.get('mailbox') || '').slice(0, 64);
  const mailbox = resolveCalendarMailbox(mailboxes, requestedMailboxId);

  if (!mailbox) {
    return {
      mailboxes: [],
      mailboxId: '',
      mailboxAddress: '',
      canOrganize: false,
      month: monthParam(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1),
      prevMonth: '',
      nextMonth: '',
      canGoPrev: false,
      canGoNext: false,
      events: [],
    };
  }

  const { year, month, min, max, total } = resolveMonth(url.searchParams.get('month') || '');
  const monthStart = monthParam(year, month);
  const nextMonthOf = fromTotal(total + 1);
  const monthEndExclusive = `${monthParam(nextMonthOf.year, nextMonthOf.month)}-01`;
  const monthStartDate = `${monthStart}-01`;
  const cancelledCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const eventRows = await env.DB.prepare(
    `SELECT * FROM calendar_events
     WHERE mailbox_id = ?
       AND starts_at >= ? AND starts_at < ?
       AND (status != 'cancelled' OR starts_at >= ?)
     ORDER BY starts_at ASC`,
  ).bind(mailbox.id, monthStartDate, monthEndExclusive, cancelledCutoff).all<CalendarEventRow>();
  const events = eventRows.results || [];

  const attendeesByEvent = new Map<string, CalendarAttendeeRow[]>();
  if (events.length) {
    const attendeeRows = await env.DB.prepare(
      `SELECT * FROM calendar_attendees WHERE event_id IN (${events.map(() => '?').join(',')}) ORDER BY address`,
    ).bind(...events.map((event) => event.id)).all<CalendarAttendeeRow>();
    for (const row of attendeeRows.results || []) {
      const list = attendeesByEvent.get(row.event_id) || [];
      list.push(row);
      attendeesByEvent.set(row.event_id, list);
    }
  }

  const myAddress = mailbox.address.toLowerCase();
  const prev = fromTotal(total - 1);
  const next = fromTotal(total + 1);

  return {
    mailboxes,
    mailboxId: mailbox.id,
    mailboxAddress: mailbox.address,
    canOrganize: mailbox.permissions !== 'read',
    month: monthStart,
    prevMonth: monthParam(prev.year, prev.month),
    nextMonth: monthParam(next.year, next.month),
    canGoPrev: total > min,
    canGoNext: total < max,
    events: events.map((event) => {
      const attendees = attendeesByEvent.get(event.id) || [];
      return {
        ...event,
        attendees,
        myPartstat: myAttendee(attendees, myAddress)?.partstat ?? null,
      };
    }),
  };
};

export const actions: Actions = {
  cancel: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(303, '/');
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Platform not available' });

    const formData = await request.formData();
    const eventId = stringValue(formData.get('event_id'));
    if (!eventId) return fail(400, { error: 'Meeting not found' });

    const event = await env.DB.prepare(
      `SELECT ce.*, mb.address AS mailbox_address, mb.display_name AS mailbox_display_name
       FROM calendar_events ce
       INNER JOIN mailbox_assignments ma ON ce.mailbox_id = ma.mailbox_id
       INNER JOIN mailboxes mb ON mb.id = ce.mailbox_id
       WHERE ce.id = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full') AND mb.status = 'active'`,
    ).bind(eventId, locals.user.id).first<CalendarEventRow & { mailbox_address: string; mailbox_display_name: string }>();
    if (!event) throw error(404, 'Meeting not found');
    if (event.organizer_self !== 1) return fail(403, { error: 'Only the organiser can cancel this meeting' });
    if (event.status === 'cancelled') return fail(400, { error: 'This meeting is already cancelled' });

    const attendeeRows = await env.DB.prepare('SELECT * FROM calendar_attendees WHERE event_id = ? ORDER BY address')
      .bind(event.id).all<CalendarAttendeeRow>();
    const attendees = attendeeRows.results || [];
    const nextSequence = event.sequence + 1;

    let updated;
    try {
      updated = await env.DB.prepare(
        `UPDATE calendar_events SET status = 'cancelled', sequence = ?, updated_at = datetime('now')
         WHERE id = ? AND status != 'cancelled'`,
      ).bind(nextSequence, event.id).run();
    } catch {
      return fail(503, { error: 'Couldn\'t cancel the meeting. Try again shortly.' });
    }
    if (!updated.meta.changes) return fail(409, { error: 'This meeting was already updated. Reload and try again.' });

    await audit(env.DB, {
      event_type: 'calendar.event_cancelled',
      actor_id: locals.user.id,
      actor_role: locals.user.role,
      target: event.id,
      detail: `Cancelled "${event.summary}"`,
      session_id: locals.sessionId,
    }).catch(() => undefined);

    if (!attendees.length) return { cancelled: true };

    const envRecord = env as unknown as Record<string, unknown>;
    const runtime = publicRuntimeConfig(envRecord);
    const whenLabel = formatEventRange(event.starts_at, event.ends_at, event.all_day === 1, runtime.locale, runtime.timeZone);
    const body = cancellationBody(event.summary, whenLabel, event.location);
    const ics = buildIcs({
      method: 'CANCEL',
      now: new Date(),
      uid: event.uid,
      sequence: nextSequence,
      summary: event.summary,
      description: event.description,
      location: event.location,
      startsAtUtc: event.starts_at,
      endsAtUtc: event.ends_at,
      allDay: event.all_day === 1,
      organizerAddress: event.organizer_address,
      organizerName: sanitizeSenderDisplayName(event.mailbox_display_name),
      attendees: icsAttendeeInput(attendees),
      status: 'cancelled',
      rrule: event.rrule,
    });
    const result = await sendEmail({
      from: event.mailbox_address,
      fromName: sanitizeSenderDisplayName(event.mailbox_display_name || locals.user.display_name),
      to: attendees.map((attendee) => attendee.address),
      subject: `Cancelled: ${event.summary || '(no title)'}`,
      html: body.html,
      text: body.text,
      attachments: [{
        filename: 'cancel.ics',
        contentType: 'text/calendar; charset=utf-8; method=CANCEL',
        content: new TextEncoder().encode(ics),
      }],
    }, envRecord);

    if (!result.success) {
      return fail(502, { error: `Meeting cancelled, but attendees weren't notified: ${result.error || 'delivery failed'}.` });
    }
    return { cancelled: true };
  },
};
