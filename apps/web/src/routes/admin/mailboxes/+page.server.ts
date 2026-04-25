import type { PageServerLoad, Actions } from './$types';
import type { Mailbox } from '@cmail/shared/types';
import { generateId, audit } from '$lib/server/db';

export const load: PageServerLoad = async ({ platform }) => {
  const env = platform?.env;
  if (!env) return { mailboxes: [] };

  const mailboxes = await env.DB.prepare(
    `SELECT m.*,
            (SELECT COUNT(*) FROM messages WHERE mailbox_id = m.id) as message_count,
            (SELECT GROUP_CONCAT(u.email, ', ') FROM users u INNER JOIN mailbox_assignments ma ON u.id = ma.user_id WHERE ma.mailbox_id = m.id) as assigned_users
     FROM mailboxes m ORDER BY m.type, m.address`,
  ).all<Mailbox & { message_count: number; assigned_users: string }>();

  return { mailboxes: mailboxes.results || [] };
};

export const actions: Actions = {
  create: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const data = await request.formData();
    const address = (data.get('address') as string)?.toLowerCase().trim();
    const displayName = (data.get('display_name') as string)?.trim() || '';
    const type = (data.get('type') as string) || 'shared';

    if (!address) return { error: 'Address is required' };

    const existing = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(address).first();
    if (existing) return { error: 'Mailbox already exists' };

    const id = generateId();
    await env.DB.prepare(
      'INSERT INTO mailboxes (id, address, display_name, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, \'active\', datetime(\'now\'), datetime(\'now\'))',
    ).bind(id, address, displayName, type).run();

    await audit(env.DB, {
      event_type: 'mailbox.created',
      actor_id: locals.user!.id,
      actor_role: locals.user!.role as 'standard' | 'manager',
      detail: `Created ${type} mailbox ${address}`,
    });

    return { success: `Mailbox ${address} created` };
  },
  assign: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const data = await request.formData();
    const mailboxId = data.get('mailbox_id') as string;
    const userEmail = (data.get('user_email') as string)?.toLowerCase().trim();
    const permissions = (data.get('permissions') as string) || 'read';

    if (!mailboxId || !userEmail) return { error: 'Mailbox and user email required' };

    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(userEmail).first<{ id: string }>();
    if (!user) return { error: 'User not found' };

    const existing = await env.DB.prepare(
      'SELECT id FROM mailbox_assignments WHERE mailbox_id = ? AND user_id = ?',
    ).bind(mailboxId, user.id).first();
    if (existing) {
      await env.DB.prepare(
        'UPDATE mailbox_assignments SET permissions = ? WHERE mailbox_id = ? AND user_id = ?',
      ).bind(permissions, mailboxId, user.id).run();
      return { success: 'Assignment updated' };
    }

    const id = generateId();
    await env.DB.prepare(
      'INSERT INTO mailbox_assignments (id, mailbox_id, user_id, permissions, assigned_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
    ).bind(id, mailboxId, user.id, permissions).run();

    await audit(env.DB, {
      event_type: 'mailbox.assigned',
      actor_id: locals.user!.id,
      actor_role: locals.user!.role as 'standard' | 'manager',
      detail: `Assigned ${userEmail} to mailbox ${mailboxId} with ${permissions} permissions`,
    });

    return { success: `User assigned to mailbox` };
  },
};
