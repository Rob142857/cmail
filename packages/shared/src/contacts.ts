import { normalizeParticipantAddress, sanitizeParticipantName } from './message-participants';

/** One address the mailbox has just corresponded with. Name is optional. */
export interface ContactUpsertEntry {
  address: unknown;
  name?: unknown;
}

/** Hard cap on statements per call — a batch send should never fan out into
 * an unbounded D1 batch. */
const MAX_CONTACT_UPSERTS = 60;

/**
 * Builds the prepared statements that record `entries` as recipient-suggestion
 * history for `mailboxId` (see the mailbox_contacts table, migration 0012).
 * Addresses are normalized/lowercased and deduped the same way inbound mail
 * participants are (packages/shared/src/message-participants.ts); invalid or
 * empty addresses are silently skipped so a malformed entry never blocks the
 * rest of a send or delivery. Callers are expected to run the result through
 * `env.DB.batch(...)` and treat failures as non-fatal — this never touches
 * mail delivery itself.
 */
export function contactUpsertStatements(
  db: D1Database,
  mailboxId: string,
  entries: readonly ContactUpsertEntry[],
): D1PreparedStatement[] {
  const names = new Map<string, string>();
  for (const entry of entries) {
    if (names.size >= MAX_CONTACT_UPSERTS) break;
    const address = normalizeParticipantAddress(entry.address);
    if (!address) continue;
    const name = sanitizeParticipantName(entry.name);
    const existing = names.get(address);
    // First occurrence wins the slot, but a later, non-empty name can still
    // fill one that arrived empty — mirrors normalizeParticipants().
    if (existing === undefined) names.set(address, name);
    else if (!existing && name) names.set(address, name);
  }

  const sql = `INSERT INTO mailbox_contacts (mailbox_id, address, display_name, times_used, last_used_at)
     VALUES (?, ?, ?, 1, datetime('now'))
     ON CONFLICT(mailbox_id, address) DO UPDATE SET
       times_used = times_used + excluded.times_used,
       last_used_at = MAX(last_used_at, excluded.last_used_at),
       display_name = CASE WHEN display_name = '' THEN excluded.display_name ELSE display_name END`;
  return Array.from(names, ([address, name]) => db.prepare(sql).bind(mailboxId, address, name));
}
