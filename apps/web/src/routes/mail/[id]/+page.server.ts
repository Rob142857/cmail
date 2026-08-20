import { redirect, error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { Message, Attachment } from '@cmail/shared/types';
import { buildIcs, parseIcs } from '@cmail/shared/ics';
import { sanitizeEmailHtmlWithLinkGuard, type RiskyLink } from '$lib/server/sanitize-email';
import { resolveInlineImages } from '$lib/server/inline-images';
import { replyAllAddsRecipients } from '$lib/server/reply-recipients';
import {
  isIcsAttachment,
  isRsvpPartstat,
  myAttendee,
  rsvpBody,
  rsvpSubject,
  type CalendarAttendeeRow,
  type CalendarEventRow,
} from '$lib/server/calendar';
import { audit, generateId } from '$lib/server/db';
import { deriveReplyThreading } from '$lib/server/message-threading';
import { sanitizeSenderDisplayName, sendEmail } from '$lib/server/outbound';

interface InviteViewModel {
  eventId: string | null;
  sequence: number;
  summary: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  status: 'confirmed' | 'cancelled';
  organizerAddress: string;
  organizerSelf: boolean;
  /** Present when the invite carries a recurrence rule. Shown as-is; cmail does not expand occurrences. */
  rrule: string | null;
  attendees: Array<{ address: string; name: string; partstat: string }>;
  myPartstat: string | null;
  canRespond: boolean;
}

/** Load the invite card model for a message carrying a .ics attachment. */
async function loadInvite(
  db: D1Database,
  storage: R2Bucket,
  messageId: string,
  myAddress: string,
  icsAttachment: Attachment,
): Promise<InviteViewModel | null> {
  const event = await db.prepare('SELECT * FROM calendar_events WHERE message_id = ?')
    .bind(messageId).first<CalendarEventRow>();

  if (event) {
    const attendeeRows = await db.prepare('SELECT * FROM calendar_attendees WHERE event_id = ? ORDER BY address')
      .bind(event.id).all<CalendarAttendeeRow>();
    const attendees = attendeeRows.results || [];
    const mine = myAttendee(attendees, myAddress);
    return {
      eventId: event.id,
      sequence: event.sequence,
      summary: event.summary,
      description: event.description,
      location: event.location,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      allDay: event.all_day === 1,
      status: event.status,
      organizerAddress: event.organizer_address,
      organizerSelf: event.organizer_self === 1,
      rrule: event.rrule,
      attendees: attendees.map((row) => ({ address: row.address, name: row.display_name, partstat: row.partstat })),
      myPartstat: mine?.partstat ?? null,
      canRespond: event.status !== 'cancelled' && event.organizer_self === 0 && Boolean(mine),
    };
  }

  // No linked row — this message isn't the event's latest related message
  // (e.g. it was superseded by a newer invite). Parse the attachment itself
  // and render it read-only rather than guessing at a stale event's state.
  try {
    const object = await storage.get(icsAttachment.r2_key);
    if (!object) return null;
    const parsed = parseIcs(await object.text());
    const parsedEvent = parsed?.events?.[0];
    if (!parsedEvent) return null;
    const mine = myAttendee(parsedEvent.attendees, myAddress);
    return {
      eventId: null,
      sequence: parsedEvent.sequence,
      summary: parsedEvent.summary,
      description: parsedEvent.description,
      location: parsedEvent.location,
      startsAt: parsedEvent.startsAtUtc,
      endsAt: parsedEvent.endsAtUtc,
      allDay: parsedEvent.allDay,
      status: parsedEvent.status,
      organizerAddress: parsedEvent.organizerAddress,
      organizerSelf: false,
      rrule: parsedEvent.rrule,
      attendees: parsedEvent.attendees.map((attendee) => ({ address: attendee.address, name: attendee.name, partstat: attendee.partstat })),
      myPartstat: mine?.partstat ?? null,
      canRespond: false,
    };
  } catch {
    // The attachment body is temporarily unavailable — the message still
    // renders fine without the invite card.
    return null;
  }
}

export const load: PageServerLoad = async ({ locals, platform, params, url }) => {
  if (!locals.user) throw redirect(302, '/');
  const env = platform?.env;
  if (!env) throw redirect(302, '/');

  // Fetch message — verify user has access via mailbox assignment
  const message = await env.DB.prepare(
    `SELECT m.*, ma.permissions AS mailbox_permissions,
            mb.address AS mailbox_address, mb.display_name AS mailbox_display_name
     FROM messages m
     INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
     INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
     WHERE m.id = ? AND ma.user_id = ? AND mb.status = 'active'
       AND (m.draft_owner_id IS NULL OR m.draft_owner_id = ?)`,
  ).bind(params.id, locals.user.id, locals.user.id).first<Message & {
    mailbox_permissions: 'read' | 'send-as' | 'full';
    mailbox_address: string;
    mailbox_display_name: string;
  }>();

  if (!message) throw error(404, 'Message not found');

  // Fetch body from R2
  let body = '';
  let bodyUnavailable = false;
  // Link risk is assessed at render time rather than at delivery, so sharpening
  // the heuristics immediately covers mail already sitting in the mailbox.
  let riskyLinks: RiskyLink[] = [];
  if (message.body_r2_key) {
    try {
      const object = await env.STORAGE.get(message.body_r2_key);
      if (object) {
        const guarded = sanitizeEmailHtmlWithLinkGuard(
          await object.text(),
          new URL('/link', url.origin).toString(),
        );
        body = guarded.html;
        riskyLinks = guarded.riskyLinks;
      } else {
        bodyUnavailable = true;
      }
    } catch {
      // A temporary object-store failure should not hide the message metadata
      // or attachments behind a generic 500 page.
      bodyUnavailable = true;
    }
  }

  // Fetch attachments before resolving MIME cid: image references.
  const attachments = await env.DB.prepare(
    'SELECT * FROM attachments WHERE message_id = ?',
  ).bind(message.id).all<Attachment>();
  const allAttachments = attachments.results || [];
  const inlineImages = resolveInlineImages(body, allAttachments, url.origin);
  body = inlineImages.html;
  const resolvedInlineIds = new Set(inlineImages.resolvedAttachmentIds);
  const assignments = await env.DB.prepare(
    `SELECT mb.address FROM mailbox_assignments ma
     INNER JOIN mailboxes mb ON mb.id = ma.mailbox_id
     WHERE ma.user_id = ? AND mb.status = 'active'`,
  ).bind(locals.user.id).all<{ address: string }>();
  const assignedAddresses = (assignments.results || []).map((row) => row.address);
  const canReplyAll = replyAllAddsRecipients(message, assignedAddresses);
  const requestedReturnMailbox = (url.searchParams.get('mailbox') || '').slice(0, 64);

  const icsAttachment = allAttachments.find((attachment) => isIcsAttachment(attachment.content_type));
  const invite = icsAttachment
    ? await loadInvite(env.DB, env.STORAGE, message.id, message.mailbox_address, icsAttachment)
    : null;

  return {
    message,
    body,
    bodyUnavailable,
    invite,
    // Distinct hosts, so ten disguised links to one destination read as one
    // finding rather than ten. Only risk and host cross to the client; the
    // hrefs are already in the body and do not need a second copy.
    riskyLinks: [...new Map(riskyLinks.map((link) => [`${link.risk}:${link.host}`, link])).values()]
      .slice(0, 20)
      .map((link) => ({ risk: link.risk, host: link.host })),
    // Embedded images resolved in the body stay out of the download list.
    // Orphaned, unsafe, or ambiguous inline MIME parts remain downloadable so
    // message content never silently disappears.
    attachments: allAttachments.filter((attachment) => attachment.disposition !== 'inline' || !resolvedInlineIds.has(attachment.id)),
    inlineImageOrigin: inlineImages.imageOrigin,
    canReplyAll,
    returnFolder: ['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash'].includes(url.searchParams.get('folder') || '')
      ? url.searchParams.get('folder') || ''
      : message.folder === 'inbox' ? '' : message.folder,
    // Preserve a scoped list only when it is this message's mailbox. A stale
    // notification/list query must never send Back into another or revoked
    // mailbox context.
    returnMailbox: requestedReturnMailbox
      ? (requestedReturnMailbox === message.mailbox_id ? requestedReturnMailbox : message.mailbox_id)
      : '',
    returnSearch: (url.searchParams.get('q') || '').slice(0, 200),
    returnPage: Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1)),
  };
};

export const actions: Actions = {
  rsvp: async ({ request, locals, platform, params }) => {
    if (!locals.user) throw redirect(303, '/');
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Platform not available' });

    const formData = await request.formData();
    const partstat = formData.get('partstat');
    if (!isRsvpPartstat(partstat)) return fail(400, { error: 'Choose a response' });

    // Re-verify access rather than trusting the page's already-rendered data.
    const message = await env.DB.prepare(
      `SELECT m.id, m.mailbox_id, m.message_id_header, m.in_reply_to, m.references_header,
              mb.address AS mailbox_address, mb.display_name AS mailbox_display_name
       FROM messages m
       INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
       INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
       WHERE m.id = ? AND ma.user_id = ? AND mb.status = 'active'
         AND (m.draft_owner_id IS NULL OR m.draft_owner_id = ?)`,
    ).bind(params.id, locals.user.id, locals.user.id).first<{
      id: string;
      mailbox_id: string;
      message_id_header: string | null;
      in_reply_to: string | null;
      references_header: string | null;
      mailbox_address: string;
      mailbox_display_name: string;
    }>();
    if (!message) throw error(404, 'Message not found');

    const event = await env.DB.prepare('SELECT * FROM calendar_events WHERE message_id = ?')
      .bind(message.id).first<CalendarEventRow>();
    if (!event) return fail(404, { error: 'This invitation is no longer available to respond to.' });
    if (event.status === 'cancelled') return fail(400, { error: 'This meeting was cancelled.' });
    if (event.organizer_self === 1) return fail(400, { error: 'You organised this meeting.' });

    const myAddress = message.mailbox_address.toLowerCase();
    try {
      await env.DB.prepare(
        `INSERT INTO calendar_attendees (id, event_id, address, display_name, partstat, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(event_id, address) DO UPDATE SET partstat = excluded.partstat, updated_at = excluded.updated_at`,
      ).bind(generateId(), event.id, myAddress, locals.user.display_name || '', partstat).run();
    } catch {
      return fail(503, { error: 'Couldn\'t save your response. Try again shortly.' });
    }

    const ics = buildIcs({
      method: 'REPLY',
      now: new Date(),
      uid: event.uid,
      sequence: event.sequence,
      summary: event.summary,
      description: event.description,
      location: event.location,
      startsAtUtc: event.starts_at,
      endsAtUtc: event.ends_at,
      allDay: event.all_day === 1,
      organizerAddress: event.organizer_address,
      attendees: [{ address: myAddress, name: locals.user.display_name || '', partstat }],
      rrule: event.rrule,
    });
    const threading = deriveReplyThreading({
      message_id_header: message.message_id_header,
      in_reply_to: message.in_reply_to,
      references_header: message.references_header,
    });
    const body = rsvpBody(partstat, event.summary);
    const result = await sendEmail({
      from: myAddress,
      fromName: sanitizeSenderDisplayName(message.mailbox_display_name || locals.user.display_name),
      to: event.organizer_address,
      subject: rsvpSubject(partstat, event.summary),
      html: body.html,
      text: body.text,
      headers: threading.inReplyTo ? {
        'In-Reply-To': threading.inReplyTo,
        ...(threading.referencesHeader ? { 'References': threading.referencesHeader } : {}),
      } : undefined,
      attachments: [{
        filename: 'reply.ics',
        contentType: 'text/calendar; charset=utf-8; method=REPLY',
        content: new TextEncoder().encode(ics),
      }],
    }, env as unknown as Record<string, unknown>);

    await audit(env.DB, {
      event_type: 'calendar.rsvp_sent',
      actor_id: locals.user.id,
      actor_role: locals.user.role,
      target: event.id,
      detail: `Responded ${partstat} to "${event.summary}"`,
      session_id: locals.sessionId,
    }).catch(() => undefined);

    if (!result.success) {
      return fail(502, { error: `Your response was saved, but couldn't be sent to the organiser: ${result.error || 'delivery failed'}.` });
    }
    return { rsvp: partstat };
  },
};
