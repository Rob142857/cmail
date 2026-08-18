-- Org-wide sender allow/block rules used by the inbound Worker and the
-- management quarantine page. pattern is a lowercased full address
-- ('person@example.com') or a bare lowercased domain ('example.com'); the
-- Worker matches both in one query and prefers the exact address. See
-- decideInboundPlacement and pickSenderRule in
-- packages/shared/src/inbound-risk.ts for how a match is resolved.
CREATE TABLE IF NOT EXISTS sender_rules (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('allow','block')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sender_rules_pattern ON sender_rules(pattern);

-- Recorded alongside folder = 'spam' so the quarantine page can explain why
-- one message was filed there without re-deriving the decision at render
-- time. NULL for every message delivered before this migration and for any
-- message placed in Spam for a reason other than scoring or a sender rule.
ALTER TABLE messages ADD COLUMN quarantine_reason TEXT;
