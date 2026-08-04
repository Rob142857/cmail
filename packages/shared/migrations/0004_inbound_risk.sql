-- Per-message inbound risk signals, so the reading pane can warn without
-- re-deriving anything at render time.
--
-- spam_score is whatever the receiving boundary reported. It is recorded
-- unconditionally and acted on only when an operator sets an explicit
-- quarantine threshold; see packages/shared/src/inbound-risk.ts.
ALTER TABLE messages
  ADD COLUMN spam_score REAL;

-- 1 when this mailbox had no prior correspondence with the sender in either
-- direction at the moment of delivery. Frozen at delivery time on purpose: it
-- answers "was this the first contact", which stays true afterwards, rather
-- than "is this sender still unknown", which stops being interesting once the
-- message itself is on file.
ALTER TABLE messages
  ADD COLUMN sender_first_contact INTEGER NOT NULL DEFAULT 0
  CHECK (sender_first_contact IN (0, 1));

-- Supports the first-contact lookup, which runs once per inbound delivery.
CREATE INDEX IF NOT EXISTS idx_messages_inbound_sender
  ON messages(mailbox_id, direction, from_address);
