-- Initial cmail schema for Cloudflare D1.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'standard' CHECK (role IN ('standard', 'manager')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'offboarded')),
  auth_provider TEXT NOT NULL DEFAULT '' CHECK (auth_provider IN ('', 'google', 'microsoft')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_sign_in TEXT
);

-- Provider subjects are the immutable authorization key. Email remains an
-- operator-managed contact/enrollment attribute and is never a login key.
CREATE TABLE IF NOT EXISTS user_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, subject)
);

-- Invitations store only a SHA-256 hash of the random enrollment capability.
-- One row per user makes every resend an explicit rotation of the old link.
CREATE TABLE IF NOT EXISTS enrollment_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at INTEGER NOT NULL CHECK (expires_at > 0),
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_expiry
  ON enrollment_tokens(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal', 'shared')),
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mailbox_assignments (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  permissions TEXT NOT NULL DEFAULT 'read' CHECK (permissions IN ('read', 'send-as', 'full')),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_by TEXT REFERENCES users(id),
  PRIMARY KEY (user_id, mailbox_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  message_id_header TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  from_address TEXT NOT NULL,
  to_addresses TEXT NOT NULL DEFAULT '[]',
  cc_addresses TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  body_r2_key TEXT,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  folder TEXT NOT NULL DEFAULT 'inbox' CHECK (folder IN ('inbox', 'sent', 'drafts', 'archive', 'spam', 'trash')),
  draft_owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  in_reply_to TEXT,
  thread_id TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_mailbox_folder ON messages(mailbox_id, folder, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_draft_owner
  ON messages(mailbox_id, draft_owner_id, received_at DESC)
  WHERE folder = 'drafts';
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_inbound_idempotency
  ON messages(mailbox_id, message_id_header)
  WHERE direction = 'inbound' AND message_id_header IS NOT NULL;

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

CREATE TABLE IF NOT EXISTS ict_policy_versions (
  id TEXT PRIMARY KEY,
  version_label TEXT NOT NULL,
  body_text TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ict_policy_signatures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  policy_version_id TEXT NOT NULL REFERENCES ict_policy_versions(id),
  signed_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT,
  session_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_signatures_user ON ict_policy_signatures(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signatures_user_policy ON ict_policy_signatures(user_id, policy_version_id);

CREATE TABLE IF NOT EXISTS signature_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applies_to TEXT NOT NULL DEFAULT '*',
  html_body TEXT NOT NULL DEFAULT '',
  plain_text_body TEXT NOT NULL DEFAULT '',
  is_locked INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  event_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  actor_id TEXT,
  actor_role TEXT NOT NULL DEFAULT 'system' CHECK (actor_role IN ('standard', 'manager', 'system')),
  event_type TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip_address TEXT,
  session_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_log(event_type);

CREATE TABLE IF NOT EXISTS mail_trace (
  trace_id TEXT PRIMARY KEY,
  message_id_header TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  envelope_from TEXT,
  envelope_to TEXT,
  header_from TEXT,
  subject TEXT,
  size_bytes INTEGER,
  status TEXT NOT NULL CHECK (status IN ('delivered', 'bounced', 'rejected', 'quarantined', 'deferred', 'sent')),
  status_detail TEXT,
  spf_result TEXT,
  dkim_result TEXT,
  dmarc_result TEXT,
  spam_score REAL,
  tls_version TEXT,
  relay_response TEXT,
  source_ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_trace_timestamp ON mail_trace(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trace_from ON mail_trace(envelope_from);
CREATE INDEX IF NOT EXISTS idx_trace_to ON mail_trace(envelope_to);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits(expires_at);

-- Short-lived delivery reservations make inbound rate and shared retained-
-- storage guardrails a single atomic D1 decision before any R2 object or
-- outbound provider call. Sender addresses never enter this table; the
-- inbound-only sender_hash is an HMAC.
CREATE TABLE IF NOT EXISTS mailbox_reservations (
  id TEXT PRIMARY KEY,
  delivery_key TEXT UNIQUE CHECK (delivery_key IS NULL OR length(delivery_key) BETWEEN 1 AND 128),
  reservation_type TEXT NOT NULL DEFAULT 'inbound' CHECK (reservation_type IN ('inbound', 'storage', 'draft')),
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  sender_hash TEXT NOT NULL DEFAULT '' CHECK (sender_hash = '' OR length(sender_hash) = 64),
  draft_owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  draft_row_limit INTEGER NOT NULL DEFAULT 0 CHECK (draft_row_limit >= 0),
  message_bytes INTEGER NOT NULL CHECK (message_bytes >= 0),
  mailbox_message_limit INTEGER NOT NULL CHECK (mailbox_message_limit >= 0),
  mailbox_byte_limit INTEGER NOT NULL CHECK (mailbox_byte_limit >= 0),
  sender_message_limit INTEGER NOT NULL CHECK (sender_message_limit >= 0),
  storage_quota_bytes INTEGER NOT NULL CHECK (storage_quota_bytes >= 0),
  storage_pending INTEGER NOT NULL DEFAULT 1 CHECK (storage_pending IN (0, 1)),
  pending_expires_at INTEGER NOT NULL,
  created_epoch INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mailbox_reservations_mailbox_time
  ON mailbox_reservations(mailbox_id, reservation_type, created_epoch);
CREATE INDEX IF NOT EXISTS idx_mailbox_reservations_sender_time
  ON mailbox_reservations(mailbox_id, sender_hash, created_epoch);
CREATE INDEX IF NOT EXISTS idx_mailbox_reservations_pending_storage
  ON mailbox_reservations(mailbox_id, pending_expires_at)
  WHERE storage_pending = 1;
CREATE INDEX IF NOT EXISTS idx_mailbox_reservations_draft_slots
  ON mailbox_reservations(mailbox_id, draft_owner_id, pending_expires_at)
  WHERE reservation_type = 'draft' AND storage_pending = 1;

CREATE TRIGGER IF NOT EXISTS trg_mailbox_reservations_guard
BEFORE INSERT ON mailbox_reservations
BEGIN
  SELECT RAISE(ABORT, 'mailbox reservation denied')
  WHERE NEW.reservation_type = 'draft'
    AND (
      SELECT COUNT(*) FROM messages draft
      WHERE draft.mailbox_id = NEW.mailbox_id
        AND draft.folder = 'drafts'
        AND draft.draft_owner_id = NEW.draft_owner_id
    ) + (
      SELECT COUNT(*) FROM mailbox_reservations pending_draft
      WHERE pending_draft.mailbox_id = NEW.mailbox_id
        AND pending_draft.reservation_type = 'draft'
        AND pending_draft.draft_owner_id = NEW.draft_owner_id
        AND pending_draft.storage_pending = 1
        AND pending_draft.pending_expires_at > NEW.created_epoch
    ) >= NEW.draft_row_limit;

  SELECT RAISE(IGNORE)
  WHERE NEW.reservation_type = 'inbound'
    AND NEW.mailbox_message_limit > 0
    AND (
      SELECT COUNT(*) FROM mailbox_reservations existing
      WHERE existing.mailbox_id = NEW.mailbox_id
        AND existing.reservation_type = 'inbound'
        AND existing.created_epoch > NEW.created_epoch - 3600
        AND existing.created_epoch <= NEW.created_epoch
    ) >= NEW.mailbox_message_limit;

  SELECT RAISE(IGNORE)
  WHERE NEW.reservation_type = 'inbound'
    AND NEW.mailbox_byte_limit > 0
    AND COALESCE((
      SELECT TOTAL(existing.message_bytes) FROM mailbox_reservations existing
      WHERE existing.mailbox_id = NEW.mailbox_id
        AND existing.reservation_type = 'inbound'
        AND existing.created_epoch > NEW.created_epoch - 3600
        AND existing.created_epoch <= NEW.created_epoch
    ), 0) + NEW.message_bytes > NEW.mailbox_byte_limit;

  SELECT RAISE(IGNORE)
  WHERE NEW.reservation_type = 'inbound'
    AND NEW.sender_message_limit > 0
    AND (
      SELECT COUNT(*) FROM mailbox_reservations existing
      WHERE existing.mailbox_id = NEW.mailbox_id
        AND existing.reservation_type = 'inbound'
        AND existing.sender_hash = NEW.sender_hash
        AND existing.created_epoch > NEW.created_epoch - 3600
        AND existing.created_epoch <= NEW.created_epoch
    ) >= NEW.sender_message_limit;

  SELECT RAISE(IGNORE)
  WHERE NEW.reservation_type = 'inbound'
    AND NEW.storage_quota_bytes > 0
    AND COALESCE((
      SELECT TOTAL(CASE WHEN message.size_bytes > 0 THEN message.size_bytes ELSE 0 END)
      FROM messages message
      WHERE message.mailbox_id = NEW.mailbox_id
    ), 0)
    + COALESCE((
      SELECT TOTAL(pending.message_bytes) FROM mailbox_reservations pending
      WHERE pending.mailbox_id = NEW.mailbox_id
        AND pending.storage_pending = 1
        AND pending.pending_expires_at > NEW.created_epoch
    ), 0)
    + NEW.message_bytes > NEW.storage_quota_bytes;

  -- Storage/draft batches use ordinary INSERT statements. ABORT makes D1
  -- roll the whole batch back when any target mailbox cannot be reserved.
  SELECT RAISE(ABORT, 'mailbox reservation denied')
  WHERE NEW.reservation_type IN ('storage', 'draft')
    AND NEW.storage_quota_bytes > 0
    AND COALESCE((
      SELECT TOTAL(CASE WHEN message.size_bytes > 0 THEN message.size_bytes ELSE 0 END)
      FROM messages message
      WHERE message.mailbox_id = NEW.mailbox_id
    ), 0)
    + COALESCE((
      SELECT TOTAL(pending.message_bytes) FROM mailbox_reservations pending
      WHERE pending.mailbox_id = NEW.mailbox_id
        AND pending.storage_pending = 1
        AND pending.pending_expires_at > NEW.created_epoch
    ), 0)
    + NEW.message_bytes > NEW.storage_quota_bytes;
END;

-- The table retains only enough history for a rolling hour plus a bounded
-- grace period. This operational cleanup is not mailbox-content retention.
CREATE TRIGGER IF NOT EXISTS trg_mailbox_reservations_prune
AFTER INSERT ON mailbox_reservations
BEGIN
  DELETE FROM mailbox_reservations
  WHERE created_epoch <= NEW.created_epoch - 7200;
END;

-- Completing the relational message insert atomically swaps the temporary
-- quota charge for messages.size_bytes. A failed-delivery cleanup releases
-- the unique delivery key so an Email Routing retry can proceed.
CREATE TRIGGER IF NOT EXISTS trg_message_reservation_complete
AFTER INSERT ON messages
BEGIN
  UPDATE mailbox_reservations
  SET storage_pending = 0
  WHERE delivery_key = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_message_reservation_release
AFTER DELETE ON messages
BEGIN
  UPDATE mailbox_reservations
  SET storage_pending = 0, delivery_key = NULL
  WHERE delivery_key = OLD.id;
END;

-- Draft updates use a deterministic key to serialize concurrent autosaves.
-- The successful relational update atomically converts/releases its pending
-- size-delta and optional target-mailbox draft-slot reservation.
CREATE TRIGGER IF NOT EXISTS trg_draft_update_reservation_complete
AFTER UPDATE OF mailbox_id, size_bytes, body_r2_key ON messages
WHEN NEW.folder = 'drafts'
BEGIN
  UPDATE mailbox_reservations
  SET storage_pending = 0, delivery_key = NULL
  WHERE delivery_key = 'draft-update/' || NEW.id;
END;

CREATE TABLE IF NOT EXISTS send_idempotency (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_send_idempotency_created ON send_idempotency(created_at);

CREATE TABLE IF NOT EXISTS retention_config (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL UNIQUE CHECK (entity_type IN ('deleted_messages', 'attachments', 'trace', 'audit')),
  retention_days INTEGER NOT NULL DEFAULT 90,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id)
);

INSERT OR IGNORE INTO retention_config (id, entity_type, retention_days) VALUES
  ('ret-messages', 'deleted_messages', 90),
  ('ret-attachments', 'attachments', 90),
  ('ret-trace', 'trace', 90),
  ('ret-audit', 'audit', 730);

CREATE TABLE IF NOT EXISTS org_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id)
);

-- The public organisation directory is disabled by default, and every new
-- position is internal until a manager explicitly changes its visibility.
CREATE TABLE IF NOT EXISTS organization_directory_settings (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
INSERT OR IGNORE INTO organization_directory_settings (singleton_id, enabled) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS organization_layers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN -100000 AND 100000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS organization_units (
  id TEXT PRIMARY KEY,
  layer_id TEXT NOT NULL REFERENCES organization_layers(id) ON DELETE RESTRICT,
  parent_id TEXT REFERENCES organization_units(id) ON DELETE RESTRICT,
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN -100000 AND 100000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  CHECK (parent_id IS NULL OR parent_id <> id),
  UNIQUE (parent_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_units_root_name
  ON organization_units(name) WHERE parent_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_organization_units_parent ON organization_units(parent_id, sort_order, name);
CREATE INDEX IF NOT EXISTS idx_organization_units_layer ON organization_units(layer_id, sort_order, name);

CREATE TRIGGER IF NOT EXISTS trg_organization_units_prevent_insert_cycle
BEFORE INSERT ON organization_units
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'organization unit hierarchy cycle')
  WHERE NEW.parent_id = NEW.id
     OR EXISTS (
       WITH RECURSIVE ancestors(id) AS (
         SELECT NEW.parent_id
         UNION
         SELECT parent.parent_id
         FROM organization_units parent
         INNER JOIN ancestors a ON parent.id = a.id
         WHERE parent.parent_id IS NOT NULL
       )
       SELECT 1 FROM ancestors WHERE id = NEW.id
     );
END;

CREATE TRIGGER IF NOT EXISTS trg_organization_units_prevent_cycle
BEFORE UPDATE OF parent_id ON organization_units
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'organization unit hierarchy cycle')
  WHERE NEW.parent_id = NEW.id
     OR EXISTS (
       WITH RECURSIVE descendants(id) AS (
         SELECT id FROM organization_units WHERE parent_id = NEW.id
         UNION
         SELECT child.id
         FROM organization_units child
         INNER JOIN descendants d ON child.parent_id = d.id
       )
       SELECT 1 FROM descendants WHERE id = NEW.parent_id
     );
END;

CREATE TABLE IF NOT EXISTS organization_roles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(title)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN -100000 AND 100000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS organization_positions (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
  role_id TEXT NOT NULL REFERENCES organization_roles(id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title_override TEXT NOT NULL DEFAULT '' CHECK (length(title_override) <= 120),
  occupant_display_name TEXT NOT NULL DEFAULT '' CHECK (length(occupant_display_name) <= 120),
  work_email TEXT NOT NULL DEFAULT '' COLLATE NOCASE CHECK (length(work_email) <= 254),
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'public')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN -100000 AND 100000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_organization_positions_unit ON organization_positions(unit_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_organization_positions_role ON organization_positions(role_id);
CREATE INDEX IF NOT EXISTS idx_organization_positions_user ON organization_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_organization_positions_public
  ON organization_positions(visibility, sort_order, id) WHERE visibility = 'public';

-- Push endpoints and their encryption keys are private capability data. They
-- are never returned by public directory or mailbox APIs.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE CHECK (length(endpoint) BETWEEN 20 AND 2048),
  p256dh TEXT NOT NULL CHECK (length(p256dh) BETWEEN 40 AND 180),
  auth TEXT NOT NULL CHECK (length(auth) BETWEEN 8 AND 100),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id, updated_at DESC);

INSERT OR IGNORE INTO signature_templates
  (id, name, applies_to, html_body, plain_text_body, is_locked)
VALUES
  ('sig-default', 'Default', '*',
   '<hr><p style="font-size:12px;color:#666;">This message is sent in the course of service and is intended only for the person or group receiving it. Please respect the confidentiality of this correspondence.</p>',
   '---\nThis message is sent in the course of service and is intended only for the person or group receiving it. Please respect the confidentiality of this correspondence.',
   1);
