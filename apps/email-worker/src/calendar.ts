/**
 * Inbound calendar invite handling (migration 0011_calendar.sql).
 *
 * A `text/calendar`/`application/ics` message part is detected among the
 * ordinary attachments PostalMime already parsed, decoded, and handed to
 * `parseIcs` (packages/shared/src/ics.ts). The resulting events are then
 * upserted into calendar_events/calendar_attendees, keyed on
 * (mailbox_id, uid) with RFC 5546 SEQUENCE gating so a delayed or
 * out-of-order copy of an invite can never regress a newer one.
 *
 * `planCalendarWrites` is the pure decision function: given the parsed
 * event, the VCALENDAR method, and whatever row (if any) already exists for
 * that UID, it returns *what* should happen without touching D1, so the
 * upsert/cancel/RSVP logic is fully unit-testable. `applyCalendarWrites` is
 * the thin, D1-touching orchestrator the Worker calls.
 *
 * This is a bonus feature layered on top of mail delivery: every entry point
 * here is designed to never throw into the caller, and the Worker always
 * calls it via ctx.waitUntil *after* the message is already durably stored,
 * so a calendar bug can never delay, reject, or lose an email.
 */
import { parseIcs, type IcsMethod, type ParsedAttendee, type ParsedEvent } from '@cmail/shared/ics';

export type { IcsMethod, ParsedAttendee, ParsedEvent } from '@cmail/shared/ics';

/** The subset of a PostalMime Attachment this module reads. */
export interface CalendarSourceAttachment {
  mimeType?: string;
  method?: string;
  content: string | ArrayBuffer | Uint8Array;
}

export interface ExistingCalendarEvent {
  id: string;
  sequence: number;
}

export type CalendarWriteIntent =
  | { kind: 'insert'; event: ParsedEvent }
  | { kind: 'update'; eventId: string; event: ParsedEvent }
  | { kind: 'cancel'; eventId: string; sequence: number }
  | { kind: 'update-attendee'; eventId: string; address: string; partstat: ParsedAttendee['partstat'] }
  | { kind: 'skip'; reason: 'unsupported-method' | 'no-uid' | 'stale-sequence' | 'not-found' | 'no-attendee' };

// ─── Detection ──────────────────────────────────────────────────────────────

/** `text/calendar`/`application/ics` content types, or PostalMime's own method-detected flag. */
export function isCalendarAttachment(attachment: Pick<CalendarSourceAttachment, 'mimeType' | 'method'>): boolean {
  const mimeType = (attachment.mimeType || '').trim().toLowerCase();
  return mimeType.startsWith('text/calendar') || mimeType.startsWith('application/ics') || Boolean(attachment.method);
}

function decodeAttachmentText(content: string | ArrayBuffer | Uint8Array): string {
  if (typeof content === 'string') return content;
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** Null for a non-calendar attachment, or one whose content cannot be decoded to text. */
export function extractCalendarText(attachment: CalendarSourceAttachment): string | null {
  if (!isCalendarAttachment(attachment)) return null;
  try {
    return decodeAttachmentText(attachment.content);
  } catch {
    return null;
  }
}

// ─── Upsert/cancel/RSVP decision (pure) ────────────────────────────────────

/**
 * Decides what a single parsed VEVENT should do to calendar_events /
 * calendar_attendees, given whatever row already exists for its
 * (mailbox_id, uid). Never touches D1.
 *
 * - REQUEST/PUBLISH: insert when no row exists yet; otherwise update only if
 *   the incoming SEQUENCE has caught up to (or passed) the stored one — an
 *   organizer's mail server can redeliver an older copy after a newer one
 *   already landed, and that must not resurrect stale details.
 * - CANCEL: only ever updates a row that already exists. sequence is still
 *   compared (and, on success, advanced) so a stale REQUEST replayed after
 *   the cancellation cannot silently re-open the meeting.
 * - REPLY: only ever updates the responding attendee's partstat on a row
 *   that already exists — the organizer's own copy of the meeting. It never
 *   creates the event or the attendee row.
 */
export function planCalendarWrites(
  method: IcsMethod | null,
  event: ParsedEvent,
  existing: ExistingCalendarEvent | null,
): CalendarWriteIntent {
  if (!event.uid) return { kind: 'skip', reason: 'no-uid' };

  if (method === 'REQUEST' || method === 'PUBLISH') {
    if (!existing) return { kind: 'insert', event };
    if (event.sequence < existing.sequence) return { kind: 'skip', reason: 'stale-sequence' };
    return { kind: 'update', eventId: existing.id, event };
  }

  if (method === 'CANCEL') {
    if (!existing) return { kind: 'skip', reason: 'not-found' };
    if (event.sequence < existing.sequence) return { kind: 'skip', reason: 'stale-sequence' };
    return { kind: 'cancel', eventId: existing.id, sequence: event.sequence };
  }

  if (method === 'REPLY') {
    if (!existing) return { kind: 'skip', reason: 'not-found' };
    const responder = event.attendees[0];
    if (!responder?.address) return { kind: 'skip', reason: 'no-attendee' };
    return {
      kind: 'update-attendee',
      eventId: existing.id,
      address: responder.address.trim().toLowerCase(),
      partstat: responder.partstat,
    };
  }

  return { kind: 'skip', reason: 'unsupported-method' };
}

// ─── D1 orchestration ───────────────────────────────────────────────────────

function attendeeInsertStatements(db: D1Database, eventId: string, attendees: readonly ParsedAttendee[]): D1PreparedStatement[] {
  // calendar_attendees is UNIQUE(event_id, address); an ICS that lists the
  // same address twice with different casing must not fail the whole batch.
  const seen = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  for (const attendee of attendees) {
    const address = attendee.address.trim().toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    statements.push(db.prepare(
      `INSERT INTO calendar_attendees (id, event_id, address, display_name, partstat, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(crypto.randomUUID(), eventId, address, attendee.name, attendee.partstat));
  }
  return statements;
}

function calendarStatementsForIntent(
  db: D1Database,
  mailboxId: string,
  messageId: string,
  intent: CalendarWriteIntent,
): D1PreparedStatement[] {
  switch (intent.kind) {
    case 'insert': {
      const event = intent.event;
      const id = crypto.randomUUID();
      return [
        db.prepare(
          `INSERT INTO calendar_events (id, mailbox_id, uid, sequence, summary, description, location, starts_at, ends_at, all_day, status, organizer_address, organizer_self, message_id, rrule, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(
          id, mailboxId, event.uid, event.sequence, event.summary, event.description, event.location,
          event.startsAtUtc, event.endsAtUtc, event.allDay ? 1 : 0, event.status,
          event.organizerAddress.trim().toLowerCase(), messageId, event.rrule,
        ),
        ...attendeeInsertStatements(db, id, event.attendees),
      ];
    }
    case 'update': {
      const event = intent.event;
      return [
        db.prepare(
          `UPDATE calendar_events
           SET sequence = ?, summary = ?, description = ?, location = ?, starts_at = ?, ends_at = ?,
               all_day = ?, status = ?, organizer_address = ?, message_id = ?, rrule = ?, updated_at = datetime('now')
           WHERE id = ?`,
        ).bind(
          event.sequence, event.summary, event.description, event.location,
          event.startsAtUtc, event.endsAtUtc, event.allDay ? 1 : 0, event.status,
          event.organizerAddress.trim().toLowerCase(), messageId, event.rrule, intent.eventId,
        ),
        // Attendees are fully replaced rather than merged: the incoming
        // invite is the new authoritative attendee list.
        db.prepare('DELETE FROM calendar_attendees WHERE event_id = ?').bind(intent.eventId),
        ...attendeeInsertStatements(db, intent.eventId, event.attendees),
      ];
    }
    case 'cancel':
      return [
        db.prepare(
          `UPDATE calendar_events SET status = 'cancelled', sequence = ?, message_id = ?, updated_at = datetime('now') WHERE id = ?`,
        ).bind(intent.sequence, messageId, intent.eventId),
      ];
    case 'update-attendee':
      // Deliberately UPDATE-only: an attendee row that does not already
      // exist is never created from a REPLY (RFC 5546's REPLY is not itself
      // an invite, and only the organizer's own copy is being annotated).
      return [
        db.prepare(
          `UPDATE calendar_attendees SET partstat = ?, updated_at = datetime('now') WHERE event_id = ? AND address = ?`,
        ).bind(intent.partstat, intent.eventId, intent.address),
      ];
    case 'skip':
      return [];
    default:
      return intent satisfies never;
  }
}

async function applyOneCalendarEvent(
  db: D1Database,
  mailboxId: string,
  messageId: string,
  method: IcsMethod | null,
  event: ParsedEvent,
): Promise<void> {
  const existingRow = event.uid
    ? await db.prepare('SELECT id, sequence FROM calendar_events WHERE mailbox_id = ? AND uid = ?')
        .bind(mailboxId, event.uid)
        .first<{ id: string; sequence: number }>()
    : null;
  const existing: ExistingCalendarEvent | null = existingRow
    ? { id: existingRow.id, sequence: existingRow.sequence }
    : null;

  const intent = planCalendarWrites(method, event, existing);
  const statements = calendarStatementsForIntent(db, mailboxId, messageId, intent);
  if (statements.length) await db.batch(statements);
}

/**
 * Parses and applies every calendar text part found on one inbound message.
 * Called from the Worker via `ctx.waitUntil` *after* the message itself is
 * durably stored, and never throws: a parse failure or D1 error here must
 * never be mistaken for a mail-delivery failure by the caller.
 */
export async function applyCalendarWrites(
  db: D1Database,
  mailboxId: string,
  messageId: string,
  calendarTexts: readonly string[],
): Promise<void> {
  for (const text of calendarTexts) {
    let parsed;
    try {
      parsed = parseIcs(text);
    } catch {
      parsed = null;
    }
    if (!parsed || !parsed.events.length) continue;

    for (const event of parsed.events) {
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential by design: multiple parts in one message may target the same UID.
        await applyOneCalendarEvent(db, mailboxId, messageId, parsed.method, event);
      } catch (error) {
        console.error('Calendar event processing failed:', error instanceof Error ? error.message : 'unknown error');
      }
    }
  }
}
