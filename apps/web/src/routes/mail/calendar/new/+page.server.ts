import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { Mailbox } from '@cmail/shared/types';
import { buildIcs } from '@cmail/shared/ics';
import {
  invitationBody,
  MAX_EVENT_ATTENDEES,
  MAX_EVENT_DESCRIPTION_LENGTH,
  MAX_EVENT_LOCATION_LENGTH,
  MAX_EVENT_TITLE_LENGTH,
} from '$lib/server/calendar';
import { audit, generateId } from '$lib/server/db';
import { publicRuntimeConfig } from '$lib/server/config';
import { formatEventRange } from '$lib/dates';
import { zonedDateTimeToUtcIso } from '$lib/zoned-time';
import { sanitizeSenderDisplayName, sendEmail } from '$lib/server/outbound';
import { normalizeEmail, parseRecipientList } from '$lib/server/validation';

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RX = /^\d{2}:\d{2}$/;

function stringValue(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  if (!locals.user) throw redirect(303, '/');
  const env = platform?.env;
  if (!env) throw redirect(303, '/');

  const mailboxes = await env.DB.prepare(
    `SELECT m.* FROM mailboxes m
     INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
     WHERE ma.user_id = ? AND ma.permissions IN ('send-as', 'full') AND m.status = 'active'
     ORDER BY CASE m.type WHEN 'personal' THEN 0 ELSE 1 END, m.address`,
  ).bind(locals.user.id).all<Mailbox>();
  const runtime = publicRuntimeConfig(env as unknown as Record<string, unknown>);
  const requestedMailboxId = (url.searchParams.get('mailbox') || '').slice(0, 64);

  return {
    mailboxes: mailboxes.results || [],
    preferredMailboxId: requestedMailboxId,
    timeZoneLabel: runtime.timeZone,
  };
};

export const actions: Actions = {
  create: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(303, '/');
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Platform not available' });

    const formData = await request.formData();
    const fromAddress = normalizeEmail(stringValue(formData.get('from')));
    const title = stringValue(formData.get('title')).trim().slice(0, MAX_EVENT_TITLE_LENGTH);
    const dateValue = stringValue(formData.get('date')).trim();
    const startTime = stringValue(formData.get('start_time')).trim();
    const endTime = stringValue(formData.get('end_time')).trim();
    const allDay = stringValue(formData.get('all_day')) === 'on';
    const location = stringValue(formData.get('location')).trim().slice(0, MAX_EVENT_LOCATION_LENGTH);
    const description = stringValue(formData.get('description')).trim().slice(0, MAX_EVENT_DESCRIPTION_LENGTH);

    if (!fromAddress) return fail(400, { error: 'Choose a valid From address' });
    if (!title) return fail(400, { error: 'Title is required' });
    if (!DATE_RX.test(dateValue)) return fail(400, { error: 'Choose a valid date' });

    const attendeeResult = parseRecipientList(formData.get('attendees'), MAX_EVENT_ATTENDEES);
    if (attendeeResult.error) return fail(400, { error: attendeeResult.error });
    if (!attendeeResult.recipients.length) return fail(400, { error: 'Add at least one attendee' });

    const envRecord = env as unknown as Record<string, unknown>;
    const runtime = publicRuntimeConfig(envRecord);

    let startsAtIso: string;
    let endsAtIso: string;
    if (allDay) {
      startsAtIso = dateValue;
      endsAtIso = dateValue;
    } else {
      if (!TIME_RX.test(startTime) || !TIME_RX.test(endTime)) return fail(400, { error: 'Choose valid start and end times' });
      const startIso = zonedDateTimeToUtcIso(dateValue, startTime, runtime.timeZone);
      const endIso = zonedDateTimeToUtcIso(dateValue, endTime, runtime.timeZone);
      if (!startIso || !endIso) return fail(400, { error: 'Couldn\'t interpret those times. Check the date and try again.' });
      if (new Date(endIso).getTime() <= new Date(startIso).getTime()) return fail(400, { error: 'End time must be after the start time' });
      startsAtIso = startIso;
      endsAtIso = endIso;
    }

    const mailbox = await env.DB.prepare(
      `SELECT m.id, m.address, m.display_name FROM mailboxes m
       INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
       WHERE m.address = ? AND ma.user_id = ? AND ma.permissions IN ('send-as', 'full') AND m.status = 'active'`,
    ).bind(fromAddress, locals.user.id).first<{ id: string; address: string; display_name: string }>();
    if (!mailbox) return fail(403, { error: 'You don\'t have permission to organise from this address' });

    const uid = `${crypto.randomUUID()}@cmail`;
    const eventId = generateId();

    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO calendar_events
           (id, mailbox_id, uid, sequence, summary, description, location, starts_at, ends_at, all_day, status, organizer_address, organizer_self, message_id, rrule, created_at, updated_at)
           VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'confirmed', ?, 1, NULL, NULL, datetime('now'), datetime('now'))`,
        ).bind(eventId, mailbox.id, uid, title, description, location, startsAtIso, endsAtIso, allDay ? 1 : 0, mailbox.address),
        ...attendeeResult.recipients.map((address) =>
          env.DB.prepare(
            `INSERT INTO calendar_attendees (id, event_id, address, display_name, partstat, updated_at)
             VALUES (?, ?, ?, '', 'needs-action', datetime('now'))`,
          ).bind(generateId(), eventId, address)),
      ]);
    } catch {
      return fail(503, { error: 'Couldn\'t save the meeting. Try again shortly.' });
    }

    await audit(env.DB, {
      event_type: 'calendar.event_created',
      actor_id: locals.user.id,
      actor_role: locals.user.role,
      target: eventId,
      detail: `Created "${title}" with ${attendeeResult.recipients.length} attendee(s)`,
      session_id: locals.sessionId,
    }).catch(() => undefined);

    const fromName = sanitizeSenderDisplayName(mailbox.display_name || locals.user.display_name);
    const whenLabel = formatEventRange(startsAtIso, endsAtIso, allDay, runtime.locale, runtime.timeZone);
    const body = invitationBody(title, whenLabel, location, description);
    const ics = buildIcs({
      method: 'REQUEST',
      now: new Date(),
      uid,
      sequence: 0,
      summary: title,
      description,
      location,
      startsAtUtc: startsAtIso,
      endsAtUtc: endsAtIso,
      allDay,
      organizerAddress: mailbox.address,
      organizerName: fromName,
      attendees: attendeeResult.recipients.map((address) => ({ address, name: '', partstat: 'needs-action' as const })),
    });

    const result = await sendEmail({
      from: mailbox.address,
      fromName,
      to: attendeeResult.recipients,
      subject: `Invitation: ${title}`,
      html: body.html,
      text: body.text,
      attachments: [{
        filename: 'invite.ics',
        contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        content: new TextEncoder().encode(ics),
      }],
    }, envRecord);

    if (!result.success) {
      return fail(502, {
        error: `Meeting saved, but invitations weren't sent: ${result.error || 'delivery failed'}. Attendees won't be notified automatically — contact them directly if needed.`,
      });
    }
    throw redirect(303, `/mail/calendar?mailbox=${encodeURIComponent(mailbox.id)}`);
  },
};
