import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateId } from '$lib/server/db';

const MAX_IDS = 100;
const MAX_BODY_BYTES = 16_384;
const STATE_ACTIONS = ['read', 'unread', 'star', 'unstar'] as const;
const MOVE_FOLDERS = ['inbox', 'archive', 'spam', 'trash'] as const;

type StateAction = (typeof STATE_ACTIONS)[number];
type MoveFolder = (typeof MOVE_FOLDERS)[number];
type BulkAction = StateAction | 'move' | 'restore';

const MOVE_SOURCES: Record<MoveFolder, readonly string[]> = {
  inbox: ['archive', 'spam'],
  archive: ['inbox'],
  spam: ['inbox', 'archive'],
  trash: ['inbox', 'sent', 'archive', 'spam'],
};

interface BulkRequest {
  ids?: unknown;
  action?: unknown;
  folder?: unknown;
}

interface AuthorizedMessage {
  id: string;
  mailbox_id: string;
  folder: string;
  permissions: string;
}

function isStateAction(value: string): value is StateAction {
  return (STATE_ACTIONS as readonly string[]).includes(value);
}

function isMoveFolder(value: string): value is MoveFolder {
  return (MOVE_FOLDERS as readonly string[]).includes(value);
}

function auditDescription(action: BulkAction, count: number, folder: MoveFolder | null): {
  eventType: string;
  detail: string;
} {
  if (action === 'move') {
    return {
      eventType: 'email.bulk_moved',
      detail: `Moved ${count} messages to ${folder}`,
    };
  }
  if (action === 'restore') {
    return {
      eventType: 'email.bulk_restored',
      detail: `Restored ${count} messages from trash`,
    };
  }
  if (action === 'read' || action === 'unread') {
    return {
      eventType: 'email.bulk_read_state',
      detail: `Marked ${count} messages as ${action}`,
    };
  }
  return {
    eventType: 'email.bulk_star_state',
    detail: `${action === 'star' ? 'Starred' : 'Unstarred'} ${count} messages`,
  };
}

export const PATCH: RequestHandler = async ({ locals, platform, request }) => {
  if (!locals.user) throw error(401, 'Authentication required');
  const env = platform?.env;
  if (!env) throw error(500, 'Service unavailable');

  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw error(415, 'JSON content type required');

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw error(413, 'Request too large');
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) throw error(413, 'Request too large');

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody) as unknown;
  } catch {
    throw error(400, 'Invalid JSON');
  }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    throw error(400, 'Invalid request body');
  }
  const body = parsedBody as BulkRequest;

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    throw error(400, 'Select at least one message');
  }
  if (body.ids.length > MAX_IDS) throw error(400, `A maximum of ${MAX_IDS} messages can be updated at once`);
  if (body.ids.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 128)) {
    throw error(400, 'Invalid message identifiers');
  }

  const ids = [...new Set(body.ids as string[])];
  const action = typeof body.action === 'string' ? body.action : '';
  if (!isStateAction(action) && action !== 'move' && action !== 'restore') throw error(400, 'Invalid bulk action');

  let targetFolder: MoveFolder | null = null;
  if (action === 'move') {
    const requestedFolder = typeof body.folder === 'string' ? body.folder : '';
    if (!isMoveFolder(requestedFolder)) throw error(400, 'Invalid destination folder');
    targetFolder = requestedFolder;
  } else if (body.folder !== undefined) {
    throw error(400, 'A destination folder is only valid for move actions');
  }

  const placeholders = ids.map(() => '?').join(', ');
  const authorized = await env.DB.prepare(
    `SELECT m.id, m.mailbox_id, m.folder, ma.permissions
     FROM messages m
     INNER JOIN mailbox_assignments ma ON ma.mailbox_id = m.mailbox_id
     INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
     WHERE m.id IN (${placeholders}) AND ma.user_id = ? AND mb.status = 'active'
       AND (m.draft_owner_id IS NULL OR m.draft_owner_id = ?)`,
  ).bind(...ids, locals.user.id, locals.user.id).all<AuthorizedMessage>();

  const messages = authorized.results || [];
  const authorizedIds = new Set(messages.map((message) => message.id));
  if (authorizedIds.size !== ids.length || ids.some((id) => !authorizedIds.has(id))) {
    throw error(404, 'One or more messages are no longer available');
  }

  const requiresFullPermission = action === 'star' || action === 'unstar' || action === 'move' || action === 'restore';
  if (requiresFullPermission && messages.some((message) => message.permissions !== 'full')) {
    throw error(403, 'Full mailbox permission is required for starring, moving or restoring messages');
  }
  if (targetFolder && messages.some((message) => !MOVE_SOURCES[targetFolder].includes(message.folder))) {
    throw error(400, `One or more messages cannot be moved to ${targetFolder} from their current folder`);
  }
  if (action === 'restore' && messages.some((message) => message.folder !== 'trash')) {
    throw error(400, 'Only messages in trash can be restored');
  }

  const assignmentPermission = requiresFullPermission ? "AND ma.permissions = 'full'" : '';
  const authorizationClause = `AND EXISTS (
    SELECT 1 FROM mailbox_assignments ma
    INNER JOIN mailboxes mb ON mb.id = ma.mailbox_id
    WHERE ma.mailbox_id = messages.mailbox_id AND ma.user_id = ?
      AND mb.status = 'active' ${assignmentPermission}
  ) AND (messages.draft_owner_id IS NULL OR messages.draft_owner_id = ?)`;

  let mutation: D1PreparedStatement;
  if (action === 'read' || action === 'unread') {
    mutation = env.DB.prepare(
      `UPDATE messages SET is_read = ? WHERE id IN (${placeholders}) ${authorizationClause}`,
    ).bind(action === 'read' ? 1 : 0, ...ids, locals.user.id, locals.user.id);
  } else if (action === 'star' || action === 'unstar') {
    mutation = env.DB.prepare(
      `UPDATE messages SET is_starred = ? WHERE id IN (${placeholders}) ${authorizationClause}`,
    ).bind(action === 'star' ? 1 : 0, ...ids, locals.user.id, locals.user.id);
  } else if (action === 'move') {
    mutation = env.DB.prepare(
      `UPDATE messages SET folder = ? WHERE id IN (${placeholders}) ${authorizationClause}`,
    ).bind(targetFolder, ...ids, locals.user.id, locals.user.id);
  } else {
    mutation = env.DB.prepare(
      `UPDATE messages
       SET folder = CASE WHEN direction = 'outbound' THEN 'sent' ELSE 'inbox' END
       WHERE id IN (${placeholders}) AND folder = 'trash' ${authorizationClause}`,
    ).bind(...ids, locals.user.id, locals.user.id);
  }

  const auditEntry = auditDescription(action, ids.length, targetFolder);
  const auditMutation = env.DB.prepare(
    `INSERT INTO audit_log
       (event_id, timestamp, actor_id, actor_role, event_type, target, detail, ip_address, session_id)
     VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    generateId(),
    locals.user.id,
    locals.user.role,
    auditEntry.eventType,
    `messages:${ids.length}`,
    auditEntry.detail,
    request.headers.get('cf-connecting-ip') || null,
    locals.sessionId,
  );

  // D1 executes a batch as one transaction, keeping the aggregate audit entry
  // consistent with the authorized message mutation.
  const [mutationResult] = await env.DB.batch([mutation, auditMutation]);
  const updated = typeof mutationResult.meta.changes === 'number' ? mutationResult.meta.changes : ids.length;

  return json({ ok: true, updated });
};
