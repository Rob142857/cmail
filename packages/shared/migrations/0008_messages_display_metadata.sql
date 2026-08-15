-- Preserve decoded RFC 5322 display metadata separately from routing fields.
-- Address lists remain bare addr-spec JSON arrays so existing delivery and
-- reply logic cannot accidentally route on a display name.

ALTER TABLE messages
  ADD COLUMN from_name TEXT NOT NULL DEFAULT ''
  CHECK (length(from_name) <= 120);

ALTER TABLE messages
  ADD COLUMN to_participants TEXT NOT NULL DEFAULT '[]'
  CHECK (length(to_participants) <= 65536
    AND json_valid(to_participants) AND json_type(to_participants) = 'array');

ALTER TABLE messages
  ADD COLUMN cc_participants TEXT NOT NULL DEFAULT '[]'
  CHECK (length(cc_participants) <= 65536
    AND json_valid(cc_participants) AND json_type(cc_participants) = 'array');

ALTER TABLE messages
  ADD COLUMN reply_to_participants TEXT NOT NULL DEFAULT '[]'
  CHECK (length(reply_to_participants) <= 65536
    AND json_valid(reply_to_participants) AND json_type(reply_to_participants) = 'array');

-- Display names on historic inbound messages were discarded and cannot be
-- reconstructed. Sender names for journal-materialised outbound/internal
-- copies are still authoritative in the immutable outbound manifest, so
-- recover only those values without guessing from mailbox or account data.
UPDATE messages
SET from_name = (
  SELECT journal.from_name
  FROM outbound_send_targets target
  INNER JOIN outbound_send_journal journal ON journal.id = target.journal_id
  WHERE target.message_id = messages.id
  LIMIT 1
)
WHERE from_name = ''
  AND EXISTS (
    SELECT 1
    FROM outbound_send_targets target
    INNER JOIN outbound_send_journal journal ON journal.id = target.journal_id
    WHERE target.message_id = messages.id AND journal.from_name <> ''
  );
