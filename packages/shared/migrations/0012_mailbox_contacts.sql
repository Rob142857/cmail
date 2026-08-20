-- Per-mailbox recipient suggestion history (Outlook-style autocomplete).
-- Rows are upserted by apps/email-worker (inbound sender only, see
-- packages/shared/src/contacts.ts) and by the web send path (outbound
-- To/Cc). Unlike the org directory (mailboxes table), this can include
-- external addresses this mailbox has actually corresponded with.
CREATE TABLE IF NOT EXISTS mailbox_contacts (
  mailbox_id   TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  address      TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  times_used   INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (mailbox_id, address)
);
CREATE INDEX IF NOT EXISTS idx_mailbox_contacts_recent ON mailbox_contacts(mailbox_id, last_used_at DESC);

-- Backfill (a): senders of mail this mailbox has already received. Trash and
-- drafts are excluded — a trashed sender should not keep being suggested,
-- and drafts were never actually received. Addresses are lowercased and
-- length-guarded the same way the runtime upsert helper guards them.
INSERT INTO mailbox_contacts (mailbox_id, address, display_name, times_used, last_used_at)
SELECT
  mailbox_id,
  lower(from_address),
  substr(from_name, 1, 120),
  COUNT(*),
  MAX(received_at)
FROM messages
WHERE folder IN ('inbox', 'archive', 'spam')
  AND from_address != ''
  AND length(from_address) <= 320
GROUP BY mailbox_id, lower(from_address)
ON CONFLICT(mailbox_id, address) DO UPDATE SET
  times_used = times_used + excluded.times_used,
  last_used_at = MAX(last_used_at, excluded.last_used_at),
  display_name = CASE WHEN display_name = '' THEN excluded.display_name ELSE display_name END;

-- Backfill (b): recipients of mail this mailbox has already sent. to_addresses
-- and cc_addresses are always bare addr-spec JSON arrays (see the 0008
-- migration note), so there is no display name to recover here.
INSERT INTO mailbox_contacts (mailbox_id, address, display_name, times_used, last_used_at)
SELECT
  m.mailbox_id,
  lower(recipient.value),
  '',
  COUNT(*),
  MAX(m.received_at)
FROM messages m, json_each(m.to_addresses) AS recipient
WHERE m.folder = 'sent'
  AND recipient.value != ''
  AND length(recipient.value) <= 320
GROUP BY m.mailbox_id, lower(recipient.value)
ON CONFLICT(mailbox_id, address) DO UPDATE SET
  times_used = times_used + excluded.times_used,
  last_used_at = MAX(last_used_at, excluded.last_used_at),
  display_name = CASE WHEN display_name = '' THEN excluded.display_name ELSE display_name END;

INSERT INTO mailbox_contacts (mailbox_id, address, display_name, times_used, last_used_at)
SELECT
  m.mailbox_id,
  lower(recipient.value),
  '',
  COUNT(*),
  MAX(m.received_at)
FROM messages m, json_each(m.cc_addresses) AS recipient
WHERE m.folder = 'sent'
  AND recipient.value != ''
  AND length(recipient.value) <= 320
GROUP BY m.mailbox_id, lower(recipient.value)
ON CONFLICT(mailbox_id, address) DO UPDATE SET
  times_used = times_used + excluded.times_used,
  last_used_at = MAX(last_used_at, excluded.last_used_at),
  display_name = CASE WHEN display_name = '' THEN excluded.display_name ELSE display_name END;
