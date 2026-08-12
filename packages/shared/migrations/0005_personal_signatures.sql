-- Per-user signatures are independent from organisation templates. A manager
-- can populate and lock a row; when locked, users cannot change that row from
-- their personal settings page.
CREATE TABLE IF NOT EXISTS personal_signatures (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  html_body TEXT NOT NULL DEFAULT '' CHECK (length(html_body) <= 65536),
  plain_text_body TEXT NOT NULL DEFAULT '' CHECK (length(plain_text_body) <= 16384),
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Existing organisation templates were implicitly enabled. Keeping their
-- content when disabled makes it possible to turn a notice back on without
-- re-entering it, while compose omits disabled templates entirely.
ALTER TABLE signature_templates
  ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1));
