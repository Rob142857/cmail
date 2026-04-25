import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Message, Attachment } from '@cmail/shared/types';

export const load: PageServerLoad = async ({ locals, platform, params }) => {
  if (!locals.user) throw redirect(302, '/');
  const env = platform?.env;
  if (!env) throw redirect(302, '/');

  // Fetch message — verify user has access via mailbox assignment
  const message = await env.DB.prepare(
    `SELECT m.* FROM messages m
     INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
     WHERE m.id = ? AND ma.user_id = ?`,
  ).bind(params.id, locals.user.id).first<Message>();

  if (!message) throw error(404, 'Message not found');

  // Mark as read
  if (!message.is_read) {
    await env.DB.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').bind(message.id).run();
  }

  // Fetch body from R2
  let body = '';
  if (message.body_r2_key) {
    const object = await env.STORAGE.get(message.body_r2_key);
    if (object) {
      body = await object.text();
    }
  }

  // Fetch attachments
  const attachments = await env.DB.prepare(
    'SELECT * FROM attachments WHERE message_id = ?',
  ).bind(message.id).all<Attachment>();

  return {
    message: { ...message, is_read: 1 },
    body,
    attachments: attachments.results || [],
  };
};
