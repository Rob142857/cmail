/**
 * Lifecycle cleanup that intentionally preserves the personal mailbox and its
 * message history.  Access is removed by disabling the mailbox, not by
 * deleting it.  Keeping these statements in the same D1 batch as the status
 * transition means an offboard cannot leave a live session, invitation, or
 * shared-mailbox delegation behind.
 */
export function offboardingCleanupStatements(db: D1Database, userId: string): D1PreparedStatement[] {
  return [
    db.prepare(
      `UPDATE sessions SET revoked = 1
       WHERE user_id = ? AND EXISTS (
         SELECT 1 FROM users WHERE id = ? AND status = 'offboarded'
       )`,
    ).bind(userId, userId),
    // Explicitly remove invitation capabilities rather than relying only on
    // the status check performed during enrollment.
    db.prepare(
      `DELETE FROM enrollment_tokens
       WHERE user_id = ? AND EXISTS (
         SELECT 1 FROM users WHERE id = ? AND status = 'offboarded'
       )`,
    ).bind(userId, userId),
    db.prepare(
      `DELETE FROM push_subscriptions
       WHERE user_id = ? AND EXISTS (
         SELECT 1 FROM users WHERE id = ? AND status = 'offboarded'
       )`,
    ).bind(userId, userId),
    db.prepare(
      `UPDATE mailboxes SET status = 'disabled'
       WHERE type = 'personal'
         AND owner_user_id = ?
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'offboarded')`,
    ).bind(userId, userId),
    // Shared assignments are deleted, not merely hidden, so reactivation is
    // least-privilege and never restores a former delegate automatically.
    db.prepare(
      `DELETE FROM mailbox_assignments
       WHERE user_id = ?
         AND mailbox_id IN (SELECT id FROM mailboxes WHERE type = 'shared')
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'offboarded')`,
    ).bind(userId, userId),
    // Retain the position and its internal management data, while clearing
    // every public projection. Reactivation therefore requires an explicit
    // manager decision to publish a position again.
    db.prepare(
      `UPDATE organization_positions
       SET visibility = 'internal', updated_at = datetime('now')
       WHERE user_id = ? AND visibility = 'public'
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'offboarded')`,
    ).bind(userId, userId),
    // AI app (MCP) access: kill every token, then mark every grant revoked.
    // Token validation also requires an active user, so this is belt and braces.
    db.prepare(
      `UPDATE mcp_tokens SET revoked_epoch = unixepoch()
       WHERE revoked_epoch IS NULL
         AND grant_id IN (SELECT id FROM mcp_grants WHERE user_id = ?)
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'offboarded')`,
    ).bind(userId, userId),
    db.prepare(
      `UPDATE mcp_grants SET revoked_epoch = unixepoch(), revoked_reason = 'offboarded'
       WHERE user_id = ? AND revoked_epoch IS NULL
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'offboarded')`,
    ).bind(userId, userId),
  ];
}
