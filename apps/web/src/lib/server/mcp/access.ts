// Per-call authorization for MCP tools. Every call re-derives what the token
// may touch from live D1 state: the grant's chosen mailboxes intersected with
// the user's *current* mailbox assignments on *active* mailboxes. Removing or
// downgrading a delegation, disabling a mailbox, pausing a user or revoking the
// grant therefore takes effect on the next call, with no cache to expire.
import type { McpScope } from './config';
import type { BearerContext } from './oauth';

export type MailboxPermission = 'read' | 'send-as' | 'full';

export interface EffectiveMailbox {
  id: string;
  address: string;
  display_name: string;
  type: 'personal' | 'shared';
  permission: MailboxPermission;
}

export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly result: 'denied' | 'error' | 'rate_limited' | 'invalid' = 'denied',
  ) {
    super(message);
  }
}

export class InsufficientScopeError extends Error {
  constructor(readonly scopes: McpScope[]) {
    super(`This action needs the ${scopes.join(', ')} permission, which was not granted.`);
  }
}

export async function effectiveMailboxes(db: D1Database, grantId: string, userId: string): Promise<EffectiveMailbox[]> {
  const rows = await db.prepare(
    `SELECT mb.id, mb.address, mb.display_name, mb.type, ma.permissions AS permission
     FROM mcp_grant_mailboxes gm
     INNER JOIN mailboxes mb ON mb.id = gm.mailbox_id AND mb.status = 'active'
     INNER JOIN mailbox_assignments ma ON ma.mailbox_id = gm.mailbox_id AND ma.user_id = ?
     WHERE gm.grant_id = ?
     ORDER BY CASE mb.type WHEN 'personal' THEN 0 ELSE 1 END, mb.address`,
  ).bind(userId, grantId).all<EffectiveMailbox>();
  return rows.results || [];
}

/** The same acknowledgement gate hooks.server.ts applies to /mail and /api. */
export async function hasSignedLatestPolicy(db: D1Database, userId: string): Promise<boolean> {
  const latest = await db.prepare(
    'SELECT id FROM ict_policy_versions ORDER BY published_at DESC, id DESC LIMIT 1',
  ).first<{ id: string }>();
  if (!latest) return true;
  const signature = await db.prepare(
    'SELECT id FROM ict_policy_signatures WHERE user_id = ? AND policy_version_id = ?',
  ).bind(userId, latest.id).first<{ id: string }>();
  return !!signature;
}

export function canDraft(permission: MailboxPermission): boolean {
  return permission === 'send-as' || permission === 'full';
}

export interface ToolContext {
  db: D1Database;
  storage: R2Bucket;
  env: Record<string, unknown>;
  platform: App.Platform;
  bearer: BearerContext;
  mailboxes: EffectiveMailbox[];
  /** Set by a tool so the audit row records which mailbox it touched. */
  auditMailboxId: string | null;
}

export function requireScope(context: ToolContext, scope: McpScope): void {
  if (!context.bearer.scopes.includes(scope)) throw new InsufficientScopeError([scope]);
}

/** Resolve an optional mailbox filter to the effective set, denying anything outside it. */
export function selectMailboxes(context: ToolContext, mailboxId: string | undefined): EffectiveMailbox[] {
  if (!mailboxId) return context.mailboxes;
  const mailbox = context.mailboxes.find((candidate) => candidate.id === mailboxId || candidate.address === mailboxId.toLowerCase());
  if (!mailbox) throw new ToolError('mailbox_not_shared', 'That mailbox is not shared with this app, or you no longer have access to it.');
  context.auditMailboxId = mailbox.id;
  return [mailbox];
}

export function mailboxForSending(context: ToolContext, from: string): EffectiveMailbox {
  const address = from.trim().toLowerCase();
  const mailbox = context.mailboxes.find((candidate) => candidate.address.toLowerCase() === address || candidate.id === from);
  if (!mailbox) throw new ToolError('mailbox_not_shared', 'That From mailbox is not shared with this app, or you no longer have access to it.');
  context.auditMailboxId = mailbox.id;
  if (!canDraft(mailbox.permission)) {
    throw new ToolError('mailbox_read_only', 'You have read-only access to that mailbox, so drafts and sending are not allowed from it.');
  }
  return mailbox;
}
