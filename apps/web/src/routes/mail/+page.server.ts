import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Message } from '@cmail/shared/types';
import { escapeLike } from '$lib/server/validation';

const FOLDERS = ['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash'];
const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  if (!locals.user) throw redirect(303, '/');
  const env = platform?.env;
  if (!env) throw redirect(303, '/');

  const requestedFolder = url.searchParams.get('folder') || 'inbox';
  const folder = FOLDERS.includes(requestedFolder) ? requestedFolder : 'inbox';
  const mailboxId = (url.searchParams.get('mailbox') || '').slice(0, 64);
  const search = (url.searchParams.get('q') || '').trim().slice(0, 200);
  const parsedPage = Number.parseInt(url.searchParams.get('page') || '1', 10);
  const page = Number.isSafeInteger(parsedPage) ? Math.max(1, Math.min(10000, parsedPage)) : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const conditions = [
    'ma.user_id = ?',
    'm.folder = ?',
    "mb.status = 'active'",
    '(m.draft_owner_id IS NULL OR m.draft_owner_id = ?)',
  ];
  const bindings: unknown[] = [locals.user.id, folder, locals.user.id];
  if (mailboxId) {
    conditions.push('m.mailbox_id = ?');
    bindings.push(mailboxId);
  }
  if (search) {
    const term = `%${escapeLike(search)}%`;
    conditions.push(`(
      m.subject LIKE ? ESCAPE '\\' OR m.snippet LIKE ? ESCAPE '\\' OR
      m.from_address LIKE ? ESCAPE '\\' OR m.from_name LIKE ? ESCAPE '\\' OR
      m.to_addresses LIKE ? ESCAPE '\\' OR m.cc_addresses LIKE ? ESCAPE '\\' OR
      m.to_participants LIKE ? ESCAPE '\\' OR m.cc_participants LIKE ? ESCAPE '\\' OR
      m.reply_to_participants LIKE ? ESCAPE '\\'
    )`);
    bindings.push(term, term, term, term, term, term, term, term, term);
  }

  const result = await env.DB.prepare(
    `SELECT m.*, mb.address AS mailbox_address, mb.display_name AS mailbox_display_name,
            ma.permissions AS mailbox_permissions
     FROM messages m
     INNER JOIN mailbox_assignments ma ON m.mailbox_id = ma.mailbox_id
     INNER JOIN mailboxes mb ON mb.id = m.mailbox_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY m.received_at DESC, m.id DESC LIMIT ? OFFSET ?`,
  ).bind(...bindings, PAGE_SIZE + 1, offset).all<Message & {
    mailbox_address: string;
    mailbox_display_name: string;
    mailbox_permissions: 'read' | 'send-as' | 'full';
  }>();

  const rows = result.results || [];
  const hasMore = rows.length > PAGE_SIZE;

  let currentMailbox: { id: string; address: string; display_name: string } | null = null;
  if (mailboxId) {
    currentMailbox = await env.DB.prepare(
      `SELECT m.id, m.address, m.display_name FROM mailboxes m
       INNER JOIN mailbox_assignments ma ON ma.mailbox_id = m.id
       WHERE m.id = ? AND ma.user_id = ? AND m.status = 'active'`,
    ).bind(mailboxId, locals.user.id).first();
  }

  // A stale deep link must not silently widen back to every assigned mailbox:
  // assignment removal, offboarding, and mailbox disablement all fail closed.
  const mailboxUnavailable = Boolean(mailboxId && !currentMailbox);

  return {
    messages: rows.slice(0, PAGE_SIZE),
    folder,
    search,
    page,
    hasMore,
    partialDelivery: folder === 'sent' && url.searchParams.get('delivery') === 'partial',
    mailboxId: currentMailbox ? mailboxId : null,
    currentMailbox,
    mailboxUnavailable,
  };
};
