-- Preserve common message metadata needed for standards-compatible threading,
-- importance, and inline MIME image rendering.

ALTER TABLE messages
  ADD COLUMN importance TEXT NOT NULL DEFAULT 'normal'
  CHECK (importance IN ('low', 'normal', 'high'));

ALTER TABLE messages
  ADD COLUMN references_header TEXT;

ALTER TABLE messages
  ADD COLUMN reply_to_addresses TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(reply_to_addresses) AND json_type(reply_to_addresses) = 'array');

ALTER TABLE messages
  ADD COLUMN provider_message_ids TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(provider_message_ids) AND json_type(provider_message_ids) = 'array');

ALTER TABLE messages
  ADD COLUMN failed_recipients TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(failed_recipients) AND json_type(failed_recipients) = 'array');

ALTER TABLE attachments
  ADD COLUMN content_id TEXT;

ALTER TABLE attachments
  ADD COLUMN disposition TEXT NOT NULL DEFAULT 'attachment'
  CHECK (disposition IN ('attachment', 'inline'));

ALTER TABLE mail_trace
  ADD COLUMN provider_message_ids TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(provider_message_ids) AND json_type(provider_message_ids) = 'array');

ALTER TABLE mail_trace
  ADD COLUMN failed_recipients TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(failed_recipients) AND json_type(failed_recipients) = 'array');

CREATE INDEX IF NOT EXISTS idx_attachments_message_content_id
  ON attachments(message_id, content_id)
  WHERE content_id IS NOT NULL;

-- Earlier builds labelled an all-internal sender copy as "internal". Sent
-- ownership, restore behaviour, and reply semantics require sender copies to
-- remain outbound regardless of the recipients' hosting location.
UPDATE messages
  SET direction = 'outbound'
  WHERE folder = 'sent' AND direction = 'internal';

-- Durable outbound journal. Provider APIs do not expose a caller-controlled
-- idempotency key, so the application must durably record the dispatch
-- boundary before making a provider call. Payload bytes remain in private R2;
-- D1 stores only a bounded immutable manifest and the delivery state.
CREATE TABLE outbound_send_journal (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  user_id TEXT NOT NULL REFERENCES users(id),
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 256),
  payload_hash TEXT NOT NULL
    CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  html_sha256 TEXT NOT NULL
    CHECK (length(html_sha256) = 64 AND html_sha256 NOT GLOB '*[^0-9a-f]*'),
  text_sha256 TEXT NOT NULL
    CHECK (length(text_sha256) = 64 AND text_sha256 NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN (
      'pending', 'dispatching', 'accepted', 'ambiguous',
      'retryable_failure', 'permanent_failure', 'cancelled', 'materialized'
    )),
  provider TEXT NOT NULL CHECK (provider IN ('none', 'cloudflare', 'postmark')),
  from_address TEXT NOT NULL CHECK (length(from_address) BETWEEN 3 AND 320),
  to_addresses TEXT NOT NULL CHECK (json_valid(to_addresses) AND json_type(to_addresses) = 'array'),
  cc_addresses TEXT NOT NULL CHECK (json_valid(cc_addresses) AND json_type(cc_addresses) = 'array'),
  envelope_recipients TEXT NOT NULL CHECK (json_valid(envelope_recipients) AND json_type(envelope_recipients) = 'array'),
  subject TEXT NOT NULL CHECK (length(subject) <= 500),
  snippet TEXT NOT NULL CHECK (length(snippet) <= 200),
  importance TEXT NOT NULL DEFAULT 'normal' CHECK (importance IN ('low', 'normal', 'high')),
  in_reply_to TEXT,
  references_header TEXT,
  thread_id TEXT,
  proposed_message_id_header TEXT NOT NULL,
  message_id_header TEXT,
  html_r2_key TEXT NOT NULL CHECK (length(html_r2_key) BETWEEN 1 AND 1024),
  text_r2_key TEXT NOT NULL CHECK (length(text_r2_key) BETWEEN 1 AND 1024),
  persisted_bytes INTEGER NOT NULL CHECK (persisted_bytes >= 0),
  provider_payload_bytes INTEGER NOT NULL CHECK (provider_payload_bytes >= 0),
  draft_id TEXT,
  claimed_draft_version INTEGER CHECK (claimed_draft_version IS NULL OR claimed_draft_version >= 0),
  draft_body_r2_key TEXT,
  dispatch_token TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_message_ids TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(provider_message_ids) AND json_type(provider_message_ids) = 'array'),
  failed_recipients TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(failed_recipients) AND json_type(failed_recipients) = 'array'),
  partial_delivery INTEGER NOT NULL DEFAULT 0 CHECK (partial_delivery IN (0, 1)),
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 1000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  dispatched_at TEXT,
  accepted_at TEXT,
  materialized_at TEXT
);

-- A terminal row remains useful as an audit/idempotency tombstone, while a
-- new corrected payload may be attempted after a confirmed permanent failure.
CREATE UNIQUE INDEX idx_outbound_send_journal_active_idempotency
  ON outbound_send_journal(user_id, idempotency_key)
  WHERE state NOT IN ('permanent_failure', 'cancelled');
CREATE INDEX idx_outbound_send_journal_state
  ON outbound_send_journal(state, updated_at);
CREATE INDEX idx_outbound_send_journal_user_key
  ON outbound_send_journal(user_id, idempotency_key, created_at DESC);

CREATE TABLE outbound_send_targets (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  journal_id TEXT NOT NULL REFERENCES outbound_send_journal(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal < 256),
  message_id TEXT NOT NULL UNIQUE CHECK (length(message_id) BETWEEN 1 AND 128),
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id),
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'internal')),
  folder TEXT NOT NULL CHECK (folder IN ('sent', 'inbox')),
  body_r2_key TEXT NOT NULL CHECK (length(body_r2_key) BETWEEN 1 AND 1024),
  attachment_ids TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(attachment_ids) AND json_type(attachment_ids) = 'array'),
  reservation_id TEXT REFERENCES mailbox_reservations(id) ON DELETE SET NULL,
  materialized_at TEXT,
  UNIQUE(journal_id, ordinal)
);
CREATE INDEX idx_outbound_send_targets_journal
  ON outbound_send_targets(journal_id, materialized_at);
CREATE UNIQUE INDEX idx_outbound_send_targets_reservation
  ON outbound_send_targets(reservation_id)
  WHERE reservation_id IS NOT NULL;

CREATE TABLE outbound_send_attachments (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  journal_id TEXT NOT NULL REFERENCES outbound_send_journal(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal < 25),
  filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  content_type TEXT NOT NULL CHECK (length(content_type) BETWEEN 1 AND 150),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 20971520),
  content_sha256 TEXT NOT NULL
    CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  staging_r2_key TEXT NOT NULL UNIQUE CHECK (length(staging_r2_key) BETWEEN 1 AND 1024),
  UNIQUE(journal_id, ordinal)
);
CREATE INDEX idx_outbound_send_attachments_journal
  ON outbound_send_attachments(journal_id, ordinal);

CREATE TRIGGER trg_outbound_send_journal_payload_immutable
BEFORE UPDATE ON outbound_send_journal
WHEN OLD.user_id IS NOT NEW.user_id
  OR OLD.mailbox_id IS NOT NEW.mailbox_id
  OR OLD.idempotency_key IS NOT NEW.idempotency_key
  OR OLD.payload_hash IS NOT NEW.payload_hash
  OR OLD.html_sha256 IS NOT NEW.html_sha256
  OR OLD.text_sha256 IS NOT NEW.text_sha256
  OR OLD.provider IS NOT NEW.provider
  OR OLD.from_address IS NOT NEW.from_address
  OR OLD.to_addresses IS NOT NEW.to_addresses
  OR OLD.cc_addresses IS NOT NEW.cc_addresses
  OR OLD.envelope_recipients IS NOT NEW.envelope_recipients
  OR OLD.subject IS NOT NEW.subject
  OR OLD.snippet IS NOT NEW.snippet
  OR OLD.importance IS NOT NEW.importance
  OR OLD.in_reply_to IS NOT NEW.in_reply_to
  OR OLD.references_header IS NOT NEW.references_header
  OR OLD.thread_id IS NOT NEW.thread_id
  OR OLD.proposed_message_id_header IS NOT NEW.proposed_message_id_header
  OR OLD.html_r2_key IS NOT NEW.html_r2_key
  OR OLD.text_r2_key IS NOT NEW.text_r2_key
  OR OLD.persisted_bytes IS NOT NEW.persisted_bytes
  OR OLD.provider_payload_bytes IS NOT NEW.provider_payload_bytes
  OR OLD.draft_id IS NOT NEW.draft_id
  OR OLD.claimed_draft_version IS NOT NEW.claimed_draft_version
  OR OLD.draft_body_r2_key IS NOT NEW.draft_body_r2_key
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'outbound journal payload is immutable');
END;

-- Dispatch/result fields may change only at their corresponding durable state
-- boundary. This prevents a later query or maintenance script from rewriting
-- an accepted/materialized outcome in place.
CREATE TRIGGER trg_outbound_send_journal_result_guard
BEFORE UPDATE ON outbound_send_journal
WHEN (
    (
      OLD.dispatch_token IS NOT NEW.dispatch_token
      OR OLD.attempt_count IS NOT NEW.attempt_count
      OR OLD.dispatched_at IS NOT NEW.dispatched_at
    )
    AND NOT (
      OLD.state IN ('pending', 'retryable_failure')
      AND NEW.state = 'dispatching'
    )
  )
  OR (
    (
      OLD.message_id_header IS NOT NEW.message_id_header
      OR OLD.provider_message_ids IS NOT NEW.provider_message_ids
      OR OLD.failed_recipients IS NOT NEW.failed_recipients
      OR OLD.partial_delivery IS NOT NEW.partial_delivery
    )
    AND NOT (
      OLD.state = 'dispatching'
      AND NEW.state IN ('accepted', 'ambiguous', 'retryable_failure', 'permanent_failure')
    )
  )
  OR (
    OLD.last_error IS NOT NEW.last_error
    AND NOT (
      (OLD.state IN ('pending', 'retryable_failure') AND NEW.state = 'dispatching')
      OR (
        OLD.state = 'dispatching'
        AND NEW.state IN ('accepted', 'ambiguous', 'retryable_failure', 'permanent_failure')
      )
    )
  )
  OR (
    OLD.accepted_at IS NOT NEW.accepted_at
    AND NOT (
      (OLD.state = 'pending' AND OLD.provider = 'none' AND NEW.state = 'accepted')
      OR (OLD.state = 'dispatching' AND NEW.state = 'accepted')
    )
  )
  OR (
    OLD.materialized_at IS NOT NEW.materialized_at
    AND NOT (OLD.state = 'accepted' AND NEW.state = 'materialized')
  )
  OR (OLD.updated_at IS NOT NEW.updated_at AND OLD.state IS NEW.state)
  OR (
    NEW.state = 'dispatching'
    AND (
      OLD.provider = 'none'
      OR NEW.dispatch_token IS NULL
      OR length(NEW.dispatch_token) NOT BETWEEN 1 AND 128
      OR NEW.dispatch_token IS OLD.dispatch_token
      OR NEW.attempt_count <> OLD.attempt_count + 1
      OR NEW.dispatched_at IS NULL
      OR NEW.last_error IS NOT NULL
    )
  )
  OR (NEW.state = 'accepted' AND NEW.accepted_at IS NULL)
  OR (NEW.state = 'materialized' AND NEW.materialized_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'outbound journal result mutation is invalid');
END;

CREATE TRIGGER trg_outbound_send_journal_state_guard
BEFORE UPDATE OF state ON outbound_send_journal
WHEN OLD.state IS NOT NEW.state
  AND NOT (
    (OLD.state = 'pending' AND NEW.state IN ('dispatching', 'accepted'))
    OR (OLD.state = 'retryable_failure' AND NEW.state = 'dispatching')
    OR (OLD.state IN ('pending', 'retryable_failure') AND NEW.state = 'cancelled')
    OR (OLD.state = 'dispatching' AND NEW.state IN ('accepted', 'ambiguous', 'retryable_failure', 'permanent_failure'))
    OR (OLD.state = 'accepted' AND NEW.state = 'materialized')
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid outbound journal state transition');
END;

CREATE TRIGGER trg_outbound_send_journal_materialized_guard
BEFORE UPDATE OF state ON outbound_send_journal
WHEN NEW.state = 'materialized'
  AND EXISTS (
    SELECT 1 FROM outbound_send_targets target
    WHERE target.journal_id = OLD.id AND target.materialized_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'outbound targets are incomplete');
END;

-- A confirmed non-acceptance is the point at which a new attempt may become
-- eligible. Release every linked quota reservation in the same D1 statement
-- that makes the journal terminal, so a crash cannot strand storage until the
-- year-2100 active-send sentinel.
CREATE TRIGGER trg_outbound_send_journal_terminal_release
AFTER UPDATE OF state ON outbound_send_journal
WHEN OLD.state IS NOT NEW.state
  AND NEW.state IN ('permanent_failure', 'cancelled')
BEGIN
  UPDATE mailbox_reservations
  SET storage_pending = 0, delivery_key = NULL
  WHERE id IN (
    SELECT reservation_id
    FROM outbound_send_targets
    WHERE journal_id = NEW.id AND reservation_id IS NOT NULL
  );
END;

CREATE TRIGGER trg_outbound_send_journal_delete_guard
BEFORE DELETE ON outbound_send_journal
WHEN OLD.state NOT IN ('permanent_failure', 'cancelled', 'materialized')
  OR EXISTS (
    SELECT 1
    FROM outbound_send_targets target
    INNER JOIN mailbox_reservations reservation
      ON reservation.id = target.reservation_id
    WHERE target.journal_id = OLD.id AND reservation.storage_pending = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'unresolved outbound journal cannot be deleted');
END;

CREATE TRIGGER trg_outbound_send_targets_immutable
BEFORE UPDATE ON outbound_send_targets
WHEN OLD.journal_id IS NOT NEW.journal_id
  OR OLD.ordinal IS NOT NEW.ordinal
  OR OLD.message_id IS NOT NEW.message_id
  OR OLD.mailbox_id IS NOT NEW.mailbox_id
  OR OLD.direction IS NOT NEW.direction
  OR OLD.folder IS NOT NEW.folder
  OR OLD.body_r2_key IS NOT NEW.body_r2_key
  OR OLD.attachment_ids IS NOT NEW.attachment_ids
  OR (
    OLD.reservation_id IS NOT NEW.reservation_id
    AND NOT (
      OLD.reservation_id IS NOT NULL
      AND NEW.reservation_id IS NULL
      AND EXISTS (
        SELECT 1 FROM outbound_send_journal journal
        WHERE journal.id = OLD.journal_id
          AND journal.state IN ('permanent_failure', 'cancelled', 'materialized')
      )
    )
  )
  OR (
    OLD.materialized_at IS NOT NEW.materialized_at
    AND NOT (
      OLD.materialized_at IS NULL
      AND NEW.materialized_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM outbound_send_journal journal
        WHERE journal.id = OLD.journal_id AND journal.state = 'accepted'
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'outbound target plan is immutable');
END;

CREATE TRIGGER trg_outbound_send_target_reservation_guard
BEFORE INSERT ON outbound_send_targets
WHEN NEW.reservation_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM mailbox_reservations reservation
    WHERE reservation.id = NEW.reservation_id
      AND reservation.delivery_key = NEW.message_id
      AND reservation.mailbox_id = NEW.mailbox_id
      AND reservation.storage_pending = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'outbound reservation does not match target');
END;

CREATE TRIGGER trg_outbound_send_target_reservation_extend
AFTER INSERT ON outbound_send_targets
WHEN NEW.reservation_id IS NOT NULL
BEGIN
  -- The row is released atomically by the existing message-insert trigger.
  -- Until then it must continue counting toward quota across long provider or
  -- storage outages. 2100 is a sentinel, not a retention deadline.
  UPDATE mailbox_reservations
  SET pending_expires_at = 4102444800
  WHERE id = NEW.reservation_id;
END;

CREATE TRIGGER trg_outbound_send_attachments_immutable
BEFORE UPDATE ON outbound_send_attachments
BEGIN
  SELECT RAISE(ABORT, 'outbound attachment manifest is immutable');
END;

-- The original rolling-history cleanup must not release quota reserved by an
-- unresolved or accepted send. Terminal rows may be pruned; their foreign key
-- detaches from the immutable target under the terminal-only exception above.
DROP TRIGGER IF EXISTS trg_mailbox_reservations_prune;
CREATE TRIGGER trg_mailbox_reservations_prune
AFTER INSERT ON mailbox_reservations
BEGIN
  DELETE FROM mailbox_reservations
  WHERE created_epoch <= NEW.created_epoch - 7200
    AND NOT EXISTS (
      SELECT 1
      FROM outbound_send_targets target
      INNER JOIN outbound_send_journal journal ON journal.id = target.journal_id
      WHERE target.reservation_id = mailbox_reservations.id
        AND journal.state IN ('pending', 'dispatching', 'accepted', 'ambiguous', 'retryable_failure')
    );
END;
