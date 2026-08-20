import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const MAX_HISTORY_CONTACTS = 400;

export const GET: RequestHandler = async ({ locals, platform, url }) => {
  if (!locals.user) return json([], { status: 401 });
  const env = platform?.env;
  if (!env) return json([]);

  // Recipient suggestions must be mail identities.  An OIDC sign-in address
  // may be external and is deliberately never exposed through this endpoint.
  // Mailbox lifecycle controls availability. A paused account's active mailbox
  // remains a valid internal address until an explicit offboarding disables it.
  const mailboxes = await env.DB.prepare(
    `SELECT m.address, m.display_name, m.type
       FROM mailboxes m
      WHERE m.status = 'active'
      ORDER BY CASE m.type WHEN 'shared' THEN 0 ELSE 1 END, m.display_name, m.address`,
  ).all<{ address: string; display_name: string; type: string }>();

  const directory = (mailboxes.results || []).map((mailbox) => ({
    email: mailbox.address,
    name: mailbox.display_name || '',
    type: mailbox.type === 'shared' ? 'shared' : 'mailbox',
  }));

  // Callers without ?mailbox get exactly today's response: a bare directory
  // array. `url` is optional here only so unit tests can omit it.
  const mailboxAddress = url?.searchParams?.get('mailbox') || '';
  if (!mailboxAddress) {
    return json(directory, {
      headers: { 'Cache-Control': 'private, max-age=30' },
    });
  }

  // Per-mailbox suggestion history is scoped to mailboxes the caller is
  // assigned to, mirroring the attachment-access join pattern (any
  // assignment level — read included — grants visibility, same as it does
  // for that mailbox's stored attachments).
  const assignedMailbox = await env.DB.prepare(
    `SELECT m.id FROM mailboxes m
       INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
      WHERE m.address = ? AND ma.user_id = ? AND m.status = 'active'`,
  ).bind(mailboxAddress, locals.user.id).first<{ id: string }>();
  if (!assignedMailbox) return json({ error: 'Mailbox not found' }, { status: 404 });

  const history = await env.DB.prepare(
    `SELECT address, display_name, times_used, last_used_at
       FROM mailbox_contacts
      WHERE mailbox_id = ?
      ORDER BY times_used DESC, last_used_at DESC
      LIMIT ?`,
  ).bind(assignedMailbox.id, MAX_HISTORY_CONTACTS).all<{
    address: string; display_name: string; times_used: number; last_used_at: string;
  }>();

  return json({
    directory,
    history: history.results || [],
  }, {
    headers: { 'Cache-Control': 'private, max-age=30' },
  });
};
