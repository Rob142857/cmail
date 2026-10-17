// Read models for the "Connected AI apps" page and the manager settings card.
import { parseScopes, SCOPE_DESCRIPTIONS } from './config';
import { nowEpoch } from './crypto';

export interface ConnectedApp {
  id: string;
  clientName: string;
  verifiedHost: string | null;
  scopes: Array<{ id: string; label: string }>;
  mailboxes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  status: 'active' | 'revoked' | 'expired';
  revokedReason: string | null;
  recentCalls: Array<{ tool: string; result: string; at: string }>;
}

function iso(epoch: number | null): string | null {
  return epoch ? new Date(epoch * 1000).toISOString() : null;
}

function hostOf(clientId: string): string | null {
  if (!clientId.startsWith('https://')) return null;
  try {
    return new URL(clientId).host;
  } catch {
    return null;
  }
}

export async function listConnectedApps(db: D1Database, userId: string): Promise<ConnectedApp[]> {
  const grants = await db.prepare(
    `SELECT g.id, g.client_id, g.client_name, g.scopes, g.created_epoch, g.last_used_epoch, g.expires_epoch,
            g.revoked_epoch, g.revoked_reason, c.registration_type
     FROM mcp_grants g LEFT JOIN mcp_clients c ON c.id = g.client_id
     WHERE g.user_id = ?
     ORDER BY g.revoked_epoch IS NOT NULL, g.created_epoch DESC
     LIMIT 50`,
  ).bind(userId).all<{
    id: string; client_id: string; client_name: string; scopes: string; created_epoch: number; last_used_epoch: number | null;
    expires_epoch: number; revoked_epoch: number | null; revoked_reason: string | null; registration_type: string | null;
  }>();
  const rows = grants.results || [];
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const marks = ids.map(() => '?').join(', ');
  const [mailboxRows, callRows] = await Promise.all([
    db.prepare(
      `SELECT gm.grant_id, mb.address FROM mcp_grant_mailboxes gm INNER JOIN mailboxes mb ON mb.id = gm.mailbox_id
       WHERE gm.grant_id IN (${marks}) ORDER BY mb.address`,
    ).bind(...ids).all<{ grant_id: string; address: string }>(),
    db.prepare(
      `SELECT grant_id, tool, result, created_epoch FROM (
         SELECT grant_id, tool, result, created_epoch,
                ROW_NUMBER() OVER (PARTITION BY grant_id ORDER BY created_epoch DESC) AS position
         FROM mcp_tool_calls WHERE grant_id IN (${marks}) AND user_id = ?
       ) WHERE position <= 5 ORDER BY created_epoch DESC`,
    ).bind(...ids, userId).all<{ grant_id: string; tool: string; result: string; created_epoch: number }>(),
  ]);
  const now = nowEpoch();
  return rows.map((row) => ({
    id: row.id,
    clientName: row.client_name || 'Unnamed app',
    verifiedHost: row.registration_type === 'cimd' ? hostOf(row.client_id) : null,
    scopes: parseScopes(row.scopes).map((scope) => ({ id: scope, label: SCOPE_DESCRIPTIONS[scope].label })),
    mailboxes: (mailboxRows.results || []).filter((mailbox) => mailbox.grant_id === row.id).map((mailbox) => mailbox.address),
    createdAt: iso(row.created_epoch) as string,
    lastUsedAt: iso(row.last_used_epoch),
    expiresAt: iso(row.expires_epoch) as string,
    status: row.revoked_epoch ? 'revoked' : row.expires_epoch <= now ? 'expired' : 'active',
    revokedReason: row.revoked_reason,
    recentCalls: (callRows.results || [])
      .filter((call) => call.grant_id === row.id)
      .map((call) => ({ tool: call.tool, result: call.result, at: iso(call.created_epoch) as string })),
  }));
}

export interface AdminMcpOverview {
  activeGrants: number;
  activeUsers: number;
  recentCalls: Array<{ at: string; user: string; app: string; tool: string; mailbox: string | null; result: string; errorCode: string | null }>;
}

export async function adminMcpOverview(db: D1Database): Promise<AdminMcpOverview> {
  const now = nowEpoch();
  const counts = await db.prepare(
    `SELECT COUNT(*) AS grants, COUNT(DISTINCT user_id) AS users FROM mcp_grants
     WHERE revoked_epoch IS NULL AND expires_epoch > ?`,
  ).bind(now).first<{ grants: number; users: number }>();
  const calls = await db.prepare(
    `SELECT c.created_epoch, u.email, g.client_name, c.tool, mb.address, c.result, c.error_code
     FROM mcp_tool_calls c
     LEFT JOIN users u ON u.id = c.user_id
     LEFT JOIN mcp_grants g ON g.id = c.grant_id
     LEFT JOIN mailboxes mb ON mb.id = c.mailbox_id
     ORDER BY c.created_epoch DESC LIMIT 50`,
  ).all<{ created_epoch: number; email: string | null; client_name: string | null; tool: string; address: string | null; result: string; error_code: string | null }>();
  return {
    activeGrants: Number(counts?.grants || 0),
    activeUsers: Number(counts?.users || 0),
    recentCalls: (calls.results || []).map((call) => ({
      at: iso(call.created_epoch) as string,
      user: call.email || 'Unknown user',
      app: call.client_name || 'Unknown app',
      tool: call.tool,
      mailbox: call.address,
      result: call.result,
      errorCode: call.error_code,
    })),
  };
}
