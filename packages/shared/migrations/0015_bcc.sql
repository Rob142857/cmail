-- Bcc is a true envelope-only recipient list: addresses here must never
-- appear in any MIME header (outbound.ts's raw-MIME builder already refuses
-- to emit a Bcc: header as defence in depth). Only the sender's own drafts
-- and sent copy ever populate these columns, so the sender's message view
-- can show a "Bcc" line; received copies (internal deliveries to other
-- mailboxes) keep the '[]' default and never expose who was bcc'd.

ALTER TABLE messages
  ADD COLUMN bcc_addresses TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(bcc_addresses) AND json_type(bcc_addresses) = 'array');

ALTER TABLE messages
  ADD COLUMN bcc_participants TEXT NOT NULL DEFAULT '[]'
  CHECK (length(bcc_participants) <= 65536
    AND json_valid(bcc_participants) AND json_type(bcc_participants) = 'array');
