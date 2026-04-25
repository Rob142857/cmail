import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Message } from '@cmail/shared/types';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  if (!locals.user) throw redirect(302, '/');
  const env = platform?.env;
  if (!env) throw redirect(302, '/');

  const folder = url.searchParams.get('folder') || 'inbox';
  const mailboxId = url.searchParams.get('mailbox');
  const search = url.searchParams.get('q');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  let query: string;
  let bindings: unknown[];

  if (search) {
    query = `SELECT m.* FROM messages m
             INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
             WHERE ma.user_id = ? AND (m.subject LIKE ? OR m.snippet LIKE ? OR m.from_address LIKE ?)
             ORDER BY m.received_at DESC LIMIT ? OFFSET ?`;
    const term = `%${search}%`;
    bindings = [locals.user.id, term, term, term, pageSize, offset];
  } else if (mailboxId) {
    query = `SELECT m.* FROM messages m
             INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
             WHERE ma.user_id = ? AND m.mailbox_id = ? AND m.folder = ?
             ORDER BY m.received_at DESC LIMIT ? OFFSET ?`;
    bindings = [locals.user.id, mailboxId, folder, pageSize, offset];
  } else {
    query = `SELECT m.* FROM messages m
             INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
             WHERE ma.user_id = ? AND m.folder = ?
             ORDER BY m.received_at DESC LIMIT ? OFFSET ?`;
    bindings = [locals.user.id, folder, pageSize, offset];
  }

  const result = await env.DB.prepare(query).bind(...bindings).all<Message>();

  return {
    messages: result.results || [],
    folder,
    search: search || '',
    page,
    mailboxId: mailboxId || null,
  };
};
