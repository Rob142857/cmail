import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { audit } from '$lib/server/db';

export const PATCH: RequestHandler = async ({ locals, platform, params, request }) => {
  if (!locals.user) throw error(401);
  const env = platform?.env;
  if (!env) throw error(500);

  const body = await request.json();
  const { action, folder } = body;

  // Verify ownership
  const msg = await env.DB.prepare(
    `SELECT m.id, m.mailbox_id FROM messages m
     INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
     WHERE m.id = ? AND ma.user_id = ?`,
  ).bind(params.id, locals.user.id).first<{ id: string; mailbox_id: string }>();

  if (!msg) throw error(404);

  if (action === 'read') {
    await env.DB.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').bind(msg.id).run();
  } else if (action === 'unread') {
    await env.DB.prepare('UPDATE messages SET is_read = 0 WHERE id = ?').bind(msg.id).run();
  } else if (action === 'star') {
    await env.DB.prepare('UPDATE messages SET is_starred = CASE WHEN is_starred = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(msg.id).run();
  } else if (action === 'move' && folder) {
    const validFolders = ['inbox', 'archive', 'spam', 'trash', 'drafts'];
    if (!validFolders.includes(folder)) throw error(400, 'Invalid folder');
    await env.DB.prepare('UPDATE messages SET folder = ? WHERE id = ?').bind(folder, msg.id).run();
    await audit(env.DB, {
      event_type: 'email.moved',
      actor_id: locals.user.id,
      actor_role: locals.user.role as 'standard' | 'manager',
      detail: `Moved message ${msg.id} to ${folder}`,
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
    `SELECT m.id, m.folder, m.body_r2_key FROM messages m
     INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
     WHERE m.id = ? AND ma.user_id = ?`,
  ).bind(params.id, locals.user.id).first<{ id: string; folder: string; body_r2_key: string }>();

  if (!msg) throw error(404);

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

  return json({ ok: true });
};
