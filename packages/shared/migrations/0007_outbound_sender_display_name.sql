-- Preserve the display name selected for an outbound mailbox through durable
-- journal recovery. Existing journals intentionally fall back to a bare
-- address because the historic value cannot be reconstructed safely.
ALTER TABLE outbound_send_journal
  ADD COLUMN from_name TEXT NOT NULL DEFAULT '' CHECK (length(from_name) <= 120);

-- The original payload trigger predates from_name. Keep this narrow trigger
-- separate so the newly persisted portion of the delivery plan is immutable
-- in every journal state without changing the established trigger body.
CREATE TRIGGER trg_outbound_send_journal_from_name_immutable
BEFORE UPDATE OF from_name ON outbound_send_journal
WHEN OLD.from_name IS NOT NEW.from_name
BEGIN
  SELECT RAISE(ABORT, 'outbound journal sender name is immutable');
END;
