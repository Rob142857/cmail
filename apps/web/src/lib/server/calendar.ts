// Pure helpers shared by the three calendar routes (message-view invite
// card + RSVP, the agenda list, and new-meeting creation). Deliberately has
// no D1/R2 dependency so it stays trivially unit-testable; each route keeps
// owning its own queries, matching the rest of apps/web/src/routes/mail.

import { escapeHtml } from './validation';
import type { Partstat } from '$lib/calendar-format';

export type { Partstat };
export type EventStatus = 'confirmed' | 'cancelled';
/** The three responses a person can send back; 'needs-action' is server-set only. */
export type RsvpPartstat = 'accepted' | 'declined' | 'tentative';

export interface CalendarEventRow {
  id: string;
  mailbox_id: string;
  uid: string;
  sequence: number;
  summary: string;
  description: string;
  location: string;
  /** UTC-ISO timestamp, or a bare "YYYY-MM-DD" date when all_day = 1. */
  starts_at: string;
  /** Null when the source invite had no DTEND/DURATION. */
  ends_at: string | null;
  all_day: number;
  status: EventStatus;
  organizer_address: string;
  organizer_self: number;
  message_id: string | null;
  rrule: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarAttendeeRow {
  id: string;
  event_id: string;
  /** Always lowercased. */
  address: string;
  display_name: string;
  partstat: Partstat;
  updated_at: string;
}

export const MAX_EVENT_TITLE_LENGTH = 200;
export const MAX_EVENT_LOCATION_LENGTH = 300;
export const MAX_EVENT_DESCRIPTION_LENGTH = 5000;
export const MAX_EVENT_ATTENDEES = 100;

const RSVP_PARTSTATS = new Set<RsvpPartstat>(['accepted', 'declined', 'tentative']);

export function isRsvpPartstat(value: unknown): value is RsvpPartstat {
  return typeof value === 'string' && RSVP_PARTSTATS.has(value as RsvpPartstat);
}

/** True for a `text/calendar` or `application/ics` attachment content type. */
export function isIcsAttachment(contentType: string): boolean {
  const type = (contentType || '').trim().toLowerCase();
  return type.startsWith('text/calendar') || type.startsWith('application/ics');
}

export interface CalendarMailboxOption {
  id: string;
  address: string;
  display_name: string;
  type: 'personal' | 'shared';
}

/**
 * Pick the calendar's active mailbox: an explicitly requested one (if the
 * person is assigned to it), otherwise their first personal mailbox,
 * otherwise whichever mailbox sorts first. Mirrors the preferred-From
 * resolution in mail/compose/+page.server.ts, generalized to any mailbox
 * list. Returns null only when the person has no mailboxes at all.
 */
export function resolveCalendarMailbox<T extends CalendarMailboxOption>(
  mailboxes: T[],
  requestedId: string,
): T | null {
  if (!mailboxes.length) return null;
  const requested = requestedId ? mailboxes.find((mailbox) => mailbox.id === requestedId) : undefined;
  return requested || mailboxes.find((mailbox) => mailbox.type === 'personal') || mailboxes[0];
}

/** Find the attendee row for one mailbox address (case-insensitive). */
export function myAttendee<T extends { address: string }>(attendees: T[], address: string): T | undefined {
  const normalized = (address || '').trim().toLowerCase();
  return normalized ? attendees.find((attendee) => attendee.address.toLowerCase() === normalized) : undefined;
}

const RSVP_LABELS: Record<RsvpPartstat, string> = {
  accepted: 'Accepted',
  declined: 'Declined',
  tentative: 'Tentative',
};

export function rsvpSubject(partstat: RsvpPartstat, summary: string): string {
  return `${RSVP_LABELS[partstat]}: ${summary || '(no title)'}`;
}

export function rsvpBody(partstat: RsvpPartstat, summary: string): { html: string; text: string } {
  const verb = partstat === 'accepted' ? 'accepted' : partstat === 'declined' ? 'declined' : 'tentatively accepted';
  const text = `You ${verb} the invitation to "${summary || '(no title)'}".`;
  return { text, html: `<p>${escapeHtml(text)}</p>` };
}

function textAndHtmlLines(lines: string[]): { html: string; text: string } {
  return {
    text: lines.join('\n'),
    html: lines.map((line) => `<p>${escapeHtml(line).replace(/\r?\n/g, '<br>')}</p>`).join(''),
  };
}

export function invitationBody(summary: string, whenLabel: string, location: string, description: string): { html: string; text: string } {
  return textAndHtmlLines([
    `You're invited: ${summary || '(no title)'}`,
    `When: ${whenLabel}`,
    ...(location ? [`Where: ${location}`] : []),
    ...(description ? ['', description] : []),
  ]);
}

export function cancellationBody(summary: string, whenLabel: string, location: string): { html: string; text: string } {
  return textAndHtmlLines([
    `This meeting was cancelled: ${summary || '(no title)'}`,
    `When: ${whenLabel}`,
    ...(location ? [`Where: ${location}`] : []),
  ]);
}

/** Map stored attendee rows into the shape buildIcs()'s `attendees` expects. */
export function icsAttendeeInput(rows: CalendarAttendeeRow[]): Array<{ address: string; name: string; partstat: Partstat }> {
  return rows.map((row) => ({ address: row.address, name: row.display_name || '', partstat: row.partstat }));
}
