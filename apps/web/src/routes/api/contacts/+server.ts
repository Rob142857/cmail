import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, platform }) => {
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

  const contacts = (mailboxes.results || []).map((mailbox) => ({
    email: mailbox.address,
    name: mailbox.display_name || '',
    type: mailbox.type === 'shared' ? 'shared' : 'mailbox',
  }));

  return json(contacts, {
    headers: { 'Cache-Control': 'private, max-age=30' },
  });
};
