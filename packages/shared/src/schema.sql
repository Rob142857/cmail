-- cmail D1 schema
-- Run: pnpm db:migrate (remote) or pnpm db:migrate:local (local)

-- Note: PRAGMA journal_mode and foreign_keys are managed by D1 automatically.

-- ─── Users ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'standard' CHECK (role IN ('standard', 'manager')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'offboarded')),
  auth_provider TEXT NOT NULL DEFAULT '' CHECK (auth_provider IN ('', 'google', 'microsoft')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_sign_in  TEXT
);

-- ─── Sessions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  issued_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  ip_address  TEXT,
  revoked     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

-- ─── Mailboxes ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mailboxes (
  id            TEXT PRIMARY KEY,
  address       TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal', 'shared')),
  display_name  TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Mailbox assignments (shared mailbox access) ─────────
CREATE TABLE IF NOT EXISTS mailbox_assignments (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mailbox_id  TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  permissions TEXT NOT NULL DEFAULT 'read' CHECK (permissions IN ('read', 'send-as', 'full')),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_by TEXT REFERENCES users(id),
  PRIMARY KEY (user_id, mailbox_id)
);

-- ─── Messages ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  mailbox_id        TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  message_id_header TEXT,
  direction         TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  from_address      TEXT NOT NULL,
  to_addresses      TEXT NOT NULL DEFAULT '[]',  -- JSON array
  cc_addresses      TEXT NOT NULL DEFAULT '[]',  -- JSON array
  subject           TEXT NOT NULL DEFAULT '',
  snippet           TEXT NOT NULL DEFAULT '',
  body_r2_key       TEXT,
  has_attachments   INTEGER NOT NULL DEFAULT 0,
  size_bytes        INTEGER NOT NULL DEFAULT 0,
  folder            TEXT NOT NULL DEFAULT 'inbox' CHECK (folder IN ('inbox', 'sent', 'drafts', 'archive', 'spam', 'trash')),
  is_read           INTEGER NOT NULL DEFAULT 0,
  is_starred        INTEGER NOT NULL DEFAULT 0,
  in_reply_to       TEXT,
  thread_id         TEXT,
  received_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_mailbox_folder ON messages(mailbox_id, folder, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);

-- ─── Attachments ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attachments (
  id            TEXT PRIMARY KEY,
  message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  r2_key        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

-- ─── ICT Policy versions ────────────────────────────────
CREATE TABLE IF NOT EXISTS ict_policy_versions (
  id            TEXT PRIMARY KEY,
  version_label TEXT NOT NULL,
  body_text     TEXT NOT NULL,
  published_at  TEXT NOT NULL DEFAULT (datetime('now')),
  published_by  TEXT REFERENCES users(id)
);

-- ─── ICT Policy signatures (append-only) ────────────────
CREATE TABLE IF NOT EXISTS ict_policy_signatures (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  policy_version_id TEXT NOT NULL REFERENCES ict_policy_versions(id),
  signed_at         TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address        TEXT,
  session_id        TEXT
);
CREATE INDEX IF NOT EXISTS idx_signatures_user ON ict_policy_signatures(user_id);

-- ─── Signature templates ────────────────────────────────
CREATE TABLE IF NOT EXISTS signature_templates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  applies_to      TEXT NOT NULL DEFAULT '*',  -- mailbox pattern or '*' for default
  html_body       TEXT NOT NULL DEFAULT '',
  plain_text_body TEXT NOT NULL DEFAULT '',
  is_locked       INTEGER NOT NULL DEFAULT 1,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by      TEXT REFERENCES users(id)
);

-- ─── Audit log (append-only) ────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  event_id    TEXT PRIMARY KEY,
  timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
  actor_id    TEXT,
  actor_role  TEXT NOT NULL DEFAULT 'system' CHECK (actor_role IN ('standard', 'manager', 'system')),
  event_type  TEXT NOT NULL,
  target      TEXT,
  detail      TEXT,
  ip_address  TEXT,
  session_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_log(event_type);

-- ─── Mail trace (append-only) ───────────────────────────
CREATE TABLE IF NOT EXISTS mail_trace (
  trace_id          TEXT PRIMARY KEY,
  message_id_header TEXT,
  direction         TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  timestamp         TEXT NOT NULL DEFAULT (datetime('now')),
  envelope_from     TEXT,
  envelope_to       TEXT,
  header_from       TEXT,
  subject           TEXT,
  size_bytes        INTEGER,
  status            TEXT NOT NULL CHECK (status IN ('delivered', 'bounced', 'rejected', 'quarantined', 'deferred', 'sent')),
  status_detail     TEXT,
  spf_result        TEXT,
  dkim_result       TEXT,
  dmarc_result      TEXT,
  spam_score        REAL,
  tls_version       TEXT,
  relay_response    TEXT,
  source_ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_trace_timestamp ON mail_trace(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trace_from ON mail_trace(envelope_from);
CREATE INDEX IF NOT EXISTS idx_trace_to ON mail_trace(envelope_to);

-- ─── Retention config ───────────────────────────────────
CREATE TABLE IF NOT EXISTS retention_config (
  id              TEXT PRIMARY KEY,
  entity_type     TEXT NOT NULL UNIQUE CHECK (entity_type IN ('deleted_messages', 'attachments', 'trace', 'audit')),
  retention_days  INTEGER NOT NULL DEFAULT 90,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by      TEXT REFERENCES users(id)
);

-- Seed default retention
INSERT OR IGNORE INTO retention_config (id, entity_type, retention_days) VALUES
  ('ret-messages', 'deleted_messages', 90),
  ('ret-attachments', 'attachments', 90),
  ('ret-trace', 'trace', 90),
  ('ret-audit', 'audit', 730);

-- Seed default signature template
INSERT OR IGNORE INTO signature_templates (id, name, applies_to, html_body, plain_text_body, is_locked) VALUES
  ('sig-default', 'Default', '*',
   '<hr><p style="font-size:12px;color:#666;">This message is sent in the course of service and is intended only for the person or group receiving it. Please respect the confidentiality of this correspondence.</p>',
   '---\nThis message is sent in the course of service and is intended only for the person or group receiving it. Please respect the confidentiality of this correspondence.',
   1);
