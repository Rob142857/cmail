import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/db';

const MOVE_SOURCES: Record<string, readonly string[]> = {
  inbox: ['archive', 'spam'],
  archive: ['inbox'],
  spam: ['inbox', 'archive'],
  trash: ['inbox', 'sent', 'archive', 'spam'],
};

export const PATCH: RequestHandler = async ({ locals, platform, params, request }) => {
  if (!locals.user) throw error(401);
  const env = platform?.env;
  if (!env) throw error(500);

  if (Number(request.headers.get('content-length') || 0) > 4096) throw error(413, 'Request too large');
  let body: { action?: unknown; folder?: unknown };
  try {
    body = await request.json() as { action?: unknown; folder?: unknown };
  } catch {
    throw error(400, 'Invalid JSON');
  }
  const action = typeof body.action === 'string' ? body.action : '';
  const folder = typeof body.folder === 'string' ? body.folder : '';

  // Verify ownership
  const msg = await env.DB.prepare(
    `SELECT m.id, m.mailbox_id, m.folder, m.direction, ma.permissions FROM messages m
     INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
     INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
     WHERE m.id = ? AND ma.user_id = ? AND mb.status = 'active'
       AND (m.draft_owner_id IS NULL OR m.draft_owner_id = ?)`,
  ).bind(params.id, locals.user.id, locals.user.id).first<{
    id: string;
    mailbox_id: string;
    folder: string;
    direction: string;
    permissions: string;
  }>();

  if (!msg) throw error(404);

  const fullControl = msg.permissions === 'full';
  if ((action === 'star' || action === 'move' || action === 'restore') && !fullControl) {
    throw error(403, 'Full mailbox permission required');
  }
  if (action === 'read') {
    await env.DB.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').bind(msg.id).run();
  } else if (action === 'unread') {
    await env.DB.prepare('UPDATE messages SET is_read = 0 WHERE id = ?').bind(msg.id).run();
  } else if (action === 'star' && fullControl) {
    await env.DB.prepare('UPDATE messages SET is_starred = CASE WHEN is_starred = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(msg.id).run();
  } else if (action === 'move' && folder && fullControl) {
    if (!MOVE_SOURCES[folder]?.includes(msg.folder)) throw error(400, 'Invalid folder move');
    await env.DB.prepare('UPDATE messages SET folder = ? WHERE id = ?').bind(folder, msg.id).run();
    await audit(env.DB, {
      event_type: 'email.moved',
      actor_id: locals.user.id,
      actor_role: locals.user.role as 'standard' | 'manager',
      target: msg.id,
      detail: `Moved message to ${folder}`,
    });
  } else if (action === 'restore' && fullControl) {
    if (msg.folder !== 'trash') throw error(400, 'Only messages in trash can be restored');
    const destination = msg.direction === 'outbound' ? 'sent' : 'inbox';
    await env.DB.prepare('UPDATE messages SET folder = ? WHERE id = ? AND folder = \'trash\'')
      .bind(destination, msg.id).run();
    await audit(env.DB, {
      event_type: 'email.restored',
      actor_id: locals.user.id,
      actor_role: locals.user.role as 'standard' | 'manager',
      target: msg.id,
      detail: `Restored message to ${destination}`,
    });
  } else {
    throw error(400, 'Invalid action');
  }

  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, platform, params }) => {
  if (!locals.user) throw error(401);
  const env = platform?.env;
  if (!env) throw error(500);

  const msg = await env.DB.prepare(
    `SELECT m.id, m.folder, m.body_r2_key, ma.permissions FROM messages m
     INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
     INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
     WHERE m.id = ? AND ma.user_id = ? AND mb.status = 'active'
       AND (m.draft_owner_id IS NULL OR m.draft_owner_id = ?)`,
  ).bind(params.id, locals.user.id, locals.user.id).first<{ id: string; folder: string; body_r2_key: string | null; permissions: string }>();

  if (!msg) throw error(404);
  if (msg.permissions !== 'full') throw error(403, 'Full mailbox permission required');

  if (msg.folder === 'trash') {
    // Permanent delete
    if (msg.body_r2_key) {
      await env.STORAGE.delete(msg.body_r2_key);
    }
    // Delete attachments from R2
    const attachments = await env.DB.prepare(
      'SELECT r2_key FROM attachments WHERE message_id = ?',
    ).bind(msg.id).all<{ r2_key: string }>();
    for (const att of attachments.results || []) {
      await env.STORAGE.delete(att.r2_key);
    }
    await env.DB.prepare('DELETE FROM attachments WHERE message_id = ?').bind(msg.id).run();
    await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(msg.id).run();
  } else {
    // Move to trash
    await env.DB.prepare('UPDATE messages SET folder = \'trash\' WHERE id = ?').bind(msg.id).run();
  }

  await audit(env.DB, {
    event_type: msg.folder === 'trash' ? 'email.deleted' : 'email.moved',
    actor_id: locals.user.id,
    actor_role: locals.user.role,
    target: msg.id,
    detail: msg.folder === 'trash' ? 'Permanently deleted message' : 'Moved message to trash',
  });

  return json({ ok: true });
};
