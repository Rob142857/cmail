-- A personal mailbox has one durable owner. Delegation is restricted to
-- shared mailboxes; legacy full-access rows are not proof of ownership.
ALTER TABLE mailboxes ADD COLUMN owner_user_id TEXT REFERENCES users(id);

-- Backfill only unambiguous legacy personal mailboxes. Ambiguous rows remain
-- ownerless until a manager resolves them; they cannot become delegate targets
-- by accident.
WITH candidates AS (
  SELECT m.id AS mailbox_id, assignment.user_id,
         ROW_NUMBER() OVER (PARTITION BY assignment.user_id ORDER BY m.created_at, m.id) AS owner_rank
  FROM mailboxes m
  INNER JOIN mailbox_assignments assignment ON assignment.mailbox_id = m.id
  WHERE m.type = 'personal'
    AND assignment.permissions = 'full'
    AND (
      SELECT COUNT(*) FROM mailbox_assignments full_assignment
      WHERE full_assignment.mailbox_id = m.id AND full_assignment.permissions = 'full'
    ) = 1
    AND (SELECT COUNT(*) FROM mailbox_assignments any_assignment
         WHERE any_assignment.mailbox_id = m.id) = 1
)
UPDATE mailboxes
SET owner_user_id = (
  SELECT candidate.user_id FROM candidates candidate
  WHERE candidate.mailbox_id = mailboxes.id AND candidate.owner_rank = 1
)
WHERE id IN (SELECT mailbox_id FROM candidates WHERE owner_rank = 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_mailboxes_owner
  ON mailboxes(owner_user_id)
  WHERE type = 'personal' AND owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mailboxes_owner
  ON mailboxes(owner_user_id, type, status);

-- New personal mailboxes must be owned and shared mailboxes must never carry
-- an owner. Existing ambiguous legacy rows remain readable but cannot be
-- silently repurposed through future writes.
CREATE TRIGGER IF NOT EXISTS trg_mailboxes_owner_insert
BEFORE INSERT ON mailboxes
WHEN (NEW.type = 'personal' AND NEW.owner_user_id IS NULL)
  OR (NEW.type = 'shared' AND NEW.owner_user_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'invalid mailbox ownership');
END;

CREATE TRIGGER IF NOT EXISTS trg_mailboxes_owner_update
BEFORE UPDATE OF type, owner_user_id ON mailboxes
WHEN (NEW.type = 'personal' AND NEW.owner_user_id IS NULL)
  OR (NEW.type = 'shared' AND NEW.owner_user_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'invalid mailbox ownership');
END;

CREATE TRIGGER IF NOT EXISTS trg_personal_mailbox_owner_immutable
BEFORE UPDATE OF owner_user_id ON mailboxes
WHEN OLD.owner_user_id IS NOT NULL
 AND NEW.owner_user_id IS NOT OLD.owner_user_id
BEGIN
  SELECT RAISE(ABORT, 'personal mailbox owner is immutable');
END;

-- Personal mailbox access is the owner's retained Full assignment only.
-- Shared mailbox delegation remains deliberately flexible.
CREATE TRIGGER IF NOT EXISTS trg_personal_mailbox_assignment_insert
BEFORE INSERT ON mailbox_assignments
WHEN EXISTS (
  SELECT 1 FROM mailboxes
  WHERE id = NEW.mailbox_id AND type = 'personal'
    AND (owner_user_id IS NULL OR owner_user_id <> NEW.user_id OR NEW.permissions <> 'full')
)
BEGIN
  SELECT RAISE(ABORT, 'personal mailbox assignment must belong to its owner');
END;

CREATE TRIGGER IF NOT EXISTS trg_personal_mailbox_assignment_update
BEFORE UPDATE OF user_id, mailbox_id, permissions ON mailbox_assignments
WHEN EXISTS (
  SELECT 1 FROM mailboxes
  WHERE id = OLD.mailbox_id AND type = 'personal' AND owner_user_id = OLD.user_id
)
OR EXISTS (
  SELECT 1 FROM mailboxes
  WHERE id = NEW.mailbox_id AND type = 'personal'
    AND (owner_user_id IS NULL OR owner_user_id <> NEW.user_id OR NEW.permissions <> 'full')
)
BEGIN
  SELECT RAISE(ABORT, 'personal mailbox assignment must belong to its owner');
END;

CREATE TRIGGER IF NOT EXISTS trg_personal_mailbox_owner_assignment_delete
BEFORE DELETE ON mailbox_assignments
WHEN EXISTS (
  SELECT 1 FROM mailboxes
  WHERE id = OLD.mailbox_id AND type = 'personal' AND owner_user_id = OLD.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'personal mailbox owner assignment is retained');
END;

-- Bring already-offboarded records to the same no-access state as newly
-- offboarded people. Retained personal mailbox rows and owner assignments are
-- deliberately preserved for audit and retention.
UPDATE sessions SET revoked = 1
WHERE user_id IN (SELECT id FROM users WHERE status = 'offboarded');
DELETE FROM enrollment_tokens
WHERE user_id IN (SELECT id FROM users WHERE status = 'offboarded');
DELETE FROM push_subscriptions
WHERE user_id IN (SELECT id FROM users WHERE status = 'offboarded');
DELETE FROM mailbox_assignments
WHERE user_id IN (SELECT id FROM users WHERE status = 'offboarded')
  AND mailbox_id IN (SELECT id FROM mailboxes WHERE type = 'shared');
UPDATE mailboxes SET status = 'disabled'
WHERE type = 'personal'
  AND (
    owner_user_id IS NULL
    OR owner_user_id IN (SELECT id FROM users WHERE status = 'offboarded')
  );
UPDATE organization_positions SET visibility = 'internal', updated_at = datetime('now')
WHERE visibility = 'public'
  AND user_id IN (SELECT id FROM users WHERE status = 'offboarded');
