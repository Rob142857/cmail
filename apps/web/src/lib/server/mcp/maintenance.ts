// Opportunistic cleanup run from hooks.server.ts alongside session and
// rate-limit pruning. Only expired or dead OAuth state is removed; active
// grants and the tool-call audit trail (kept for a year) are untouched.
export function mcpMaintenanceStatements(db: D1Database): D1PreparedStatement[] {
  return [
    db.prepare(`DELETE FROM mcp_auth_requests WHERE expires_epoch < unixepoch('now')`),
    db.prepare(`DELETE FROM mcp_auth_codes WHERE expires_epoch < unixepoch('now') - 86400`),
    db.prepare(`DELETE FROM mcp_tokens WHERE expires_epoch < unixepoch('now') - 86400`),
    // Revoked or expired grants stay listed to their owner for 30 days, then go.
    db.prepare(
      `DELETE FROM mcp_grants
       WHERE (revoked_epoch IS NOT NULL AND revoked_epoch < unixepoch('now') - 2592000)
          OR expires_epoch < unixepoch('now') - 2592000`,
    ),
    // Registered clients nobody ever authorised are dropped after a day.
    db.prepare(
      `DELETE FROM mcp_clients
       WHERE created_epoch < unixepoch('now') - 86400
         AND NOT EXISTS (SELECT 1 FROM mcp_grants g WHERE g.client_id = mcp_clients.id)
         AND NOT EXISTS (SELECT 1 FROM mcp_auth_requests r WHERE r.client_id = mcp_clients.id)`,
    ),
    db.prepare(`DELETE FROM mcp_tool_calls WHERE created_epoch < unixepoch('now') - 31536000`),
  ];
}
