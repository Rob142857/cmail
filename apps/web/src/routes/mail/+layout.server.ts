import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import type { Mailbox, MailboxAssignment } from '@cmail/shared/types';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
  if (!locals.user) throw redirect(302, '/');

  const env = platform?.env;
  if (!env) throw redirect(302, '/');

  // Get user's mailboxes (personal + assigned shared)
  const personalMailbox = await env.DB.prepare(
    'SELECT * FROM mailboxes WHERE id IN (SELECT mailbox_id FROM mailbox_assignments WHERE user_id = ?) OR (type = \'personal\' AND address LIKE ?)',
  ).bind(locals.user.id, `%`).all<Mailbox>();

  // Get assigned shared mailboxes
  const sharedAssignments = await env.DB.prepare(
    `SELECT m.*, ma.permissions FROM mailboxes m
     INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
     WHERE ma.user_id = ? AND m.type = 'shared' AND m.status = 'active'`,
  ).bind(locals.user.id).all<Mailbox & { permissions: string }>();

  // Get unread counts per mailbox
  const userMailboxes = await env.DB.prepare(
    `SELECT m.id, m.address, m.type, m.display_name,
            (SELECT COUNT(*) FROM messages WHERE mailbox_id = m.id AND folder = 'inbox' AND is_read = 0) as unread_count
     FROM mailboxes m
     INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
     WHERE ma.user_id = ? AND m.status = 'active'
     ORDER BY m.type ASC, m.address ASC`,
  ).bind(locals.user.id).all<Mailbox & { unread_count: number }>();

  return {
    user: locals.user,
    mailboxes: userMailboxes.results || [],
  };
};
