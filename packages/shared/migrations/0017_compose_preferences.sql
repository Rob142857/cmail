-- Per-user compose defaults: the font and size new messages, replies and
-- forwards start in, and that the outgoing HTML body is wrapped in. A missing
-- row means the Exchange/Outlook default (Aptos, 12 pt). The CHECK lists match
-- COMPOSE_FONTS and COMPOSE_FONT_SIZES_PT in packages/shared/src/compose-style.ts.
CREATE TABLE IF NOT EXISTS compose_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  font_family TEXT NOT NULL DEFAULT 'Aptos' CHECK (font_family IN (
    'Aptos', 'Calibri', 'Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New'
  )),
  font_size_pt INTEGER NOT NULL DEFAULT 12 CHECK (font_size_pt IN (
    8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36
  )),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
