import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import type { Mailbox } from '@cmail/shared/types';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
  if (!locals.user) throw redirect(302, '/');

  const env = platform?.env;
  if (!env) throw redirect(302, '/');

  // Per-mailbox unread counts (inbox folder)
  const userMailboxes = await env.DB.prepare(
    `SELECT m.id, m.address, m.type, m.display_name, m.status, ma.permissions,
            (SELECT COUNT(*) FROM messages WHERE mailbox_id = m.id AND folder = 'inbox' AND is_read = 0) as unread_count
     FROM mailboxes m
     INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
     WHERE ma.user_id = ? AND m.status = 'active'
     ORDER BY CASE m.type WHEN 'personal' THEN 0 ELSE 1 END, m.address ASC`,
  ).bind(locals.user.id).all<Mailbox & { unread_count: number; permissions: string }>();

  const mailboxes = userMailboxes.results || [];
  const totalUnread = mailboxes.reduce((sum, m) => sum + (m.unread_count || 0), 0);

  return {
    user: locals.user,
    mailboxes,
    totalUnread,
  };
};
