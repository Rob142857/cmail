import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Message, Attachment } from '@cmail/shared/types';
import { sanitizeEmailHtml } from '$lib/server/sanitize-email';

export const load: PageServerLoad = async ({ locals, platform, params, url }) => {
  if (!locals.user) throw redirect(302, '/');
  const env = platform?.env;
  if (!env) throw redirect(302, '/');

  // Fetch message — verify user has access via mailbox assignment
  const message = await env.DB.prepare(
    `SELECT m.*, ma.permissions AS mailbox_permissions,
            mb.address AS mailbox_address, mb.display_name AS mailbox_display_name
     FROM messages m
     INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
     INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
     WHERE m.id = ? AND ma.user_id = ? AND mb.status = 'active'
       AND (m.draft_owner_id IS NULL OR m.draft_owner_id = ?)`,
  ).bind(params.id, locals.user.id, locals.user.id).first<Message & {
    mailbox_permissions: 'read' | 'send-as' | 'full';
    mailbox_address: string;
    mailbox_display_name: string;
  }>();

  if (!message) throw error(404, 'Message not found');

  // Fetch body from R2
  let body = '';
  let bodyUnavailable = false;
  if (message.body_r2_key) {
    try {
      const object = await env.STORAGE.get(message.body_r2_key);
      if (object) {
        body = sanitizeEmailHtml(await object.text());
      } else {
        bodyUnavailable = true;
      }
    } catch {
      // A temporary object-store failure should not hide the message metadata
      // or attachments behind a generic 500 page.
      bodyUnavailable = true;
    }
  }

  // Fetch attachments
  const attachments = await env.DB.prepare(
    'SELECT * FROM attachments WHERE message_id = ?',
  ).bind(message.id).all<Attachment>();

  return {
    message,
    body,
    bodyUnavailable,
    attachments: attachments.results || [],
    returnFolder: ['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash'].includes(url.searchParams.get('folder') || '')
      ? url.searchParams.get('folder') || ''
      : message.folder === 'inbox' ? '' : message.folder,
    returnMailbox: url.searchParams.get('mailbox') || '',
    returnSearch: (url.searchParams.get('q') || '').slice(0, 200),
    returnPage: Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1)),
  };
};
