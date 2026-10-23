-- Per-mailbox inbox rules (Outlook's Settings > Mail > Rules). The email
-- Worker and the web app's internal delivery both run a mailbox's enabled
-- rules, in position order, on mail that would otherwise land in its Inbox.
-- definition is the JSON validated by parseRuleDefinition in
-- packages/shared/src/inbox-rules.ts: conditions, exceptions and actions.
-- A row that stops validating is skipped, never half-applied.
CREATE TABLE IF NOT EXISTS inbox_rules (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  position INTEGER NOT NULL CHECK (position >= 0),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  stop_processing INTEGER NOT NULL DEFAULT 1 CHECK (stop_processing IN (0, 1)),
  definition TEXT NOT NULL CHECK (
    length(definition) <= 16384
    AND json_valid(definition)
    AND json_type(definition) = 'object'
  ),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inbox_rules_mailbox_position
  ON inbox_rules(mailbox_id, position);

-- MAX_RULES_PER_MAILBOX in inbox-rules.ts; the app checks first, this keeps
-- a concurrent or scripted insert from going past it.
CREATE TRIGGER IF NOT EXISTS trg_inbox_rules_limit
BEFORE INSERT ON inbox_rules
WHEN (SELECT COUNT(*) FROM inbox_rules WHERE mailbox_id = NEW.mailbox_id) >= 50
BEGIN
  SELECT RAISE(ABORT, 'inbox rule limit reached');
END;
