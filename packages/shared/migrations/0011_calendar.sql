-- Calendar events and attendees derived from inbound text/calendar (iCalendar)
-- message parts. The inbound Worker parses REQUEST/REPLY/CANCEL/PUBLISH
-- invites (packages/shared/src/ics.ts) and upserts rows here keyed on
-- (mailbox_id, uid); see apps/email-worker/src/calendar.ts for the
-- sequence-gated upsert/cancel/RSVP logic.
CREATE TABLE IF NOT EXISTS calendar_events (
  id                TEXT PRIMARY KEY,
  mailbox_id        TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  uid               TEXT NOT NULL,
  sequence          INTEGER NOT NULL DEFAULT 0,
  summary           TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  location          TEXT NOT NULL DEFAULT '',
  starts_at         TEXT NOT NULL,
  ends_at           TEXT,
  all_day           INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0,1)),
  status            TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  organizer_address TEXT NOT NULL DEFAULT '',
  organizer_self    INTEGER NOT NULL DEFAULT 0 CHECK (organizer_self IN (0,1)),
  message_id        TEXT REFERENCES messages(id) ON DELETE SET NULL,
  rrule             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_uid ON calendar_events(mailbox_id, uid);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(mailbox_id, starts_at);
CREATE TABLE IF NOT EXISTS calendar_attendees (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  address      TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  partstat     TEXT NOT NULL DEFAULT 'needs-action' CHECK (partstat IN ('needs-action','accepted','declined','tentative')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_attendees_event_address ON calendar_attendees(event_id, address);
