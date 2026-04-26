import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!locals.user) return json([], { status: 401 });
  const env = platform?.env;
  if (!env) return json([]);

  // Users (active/pending) + all active mailboxes in one go
  const [users, mailboxes] = await Promise.all([
    env.DB.prepare(
      `SELECT email, display_name FROM users WHERE status IN ('active', 'pending') ORDER BY display_name, email`,
    ).all<{ email: string; display_name: string }>(),
    env.DB.prepare(
      `SELECT address, display_name, type FROM mailboxes WHERE status = 'active' ORDER BY type, address`,
    ).all<{ address: string; display_name: string; type: string }>(),
  ]);

  const contacts: Array<{ email: string; name: string; type: string }> = [];
  const seen = new Set<string>();

  for (const mb of mailboxes.results || []) {
    seen.add(mb.address);
    contacts.push({ email: mb.address, name: mb.display_name || '', type: mb.type === 'shared' ? 'shared' : 'mailbox' });
  }
  for (const u of users.results || []) {
    if (!seen.has(u.email)) {
      contacts.push({ email: u.email, name: u.display_name || '', type: 'user' });
    }
  }

  return json(contacts, {
    headers: { 'Cache-Control': 'private, max-age=30' },
  });
};
