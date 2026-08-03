-- Prevent concurrent compose tabs from silently overwriting one another.
ALTER TABLE messages ADD COLUMN draft_version INTEGER NOT NULL DEFAULT 0;
