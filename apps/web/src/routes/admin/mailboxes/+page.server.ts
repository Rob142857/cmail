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

    // ✅ Permission check: only managers can create mailboxes
    if (!locals.user) return { error: 'Not authenticated' };
    if (locals.user.role !== 'manager') return { error: 'Only managers can create mailboxes' };

    const data = await request.formData();
    const address = (data.get('address') as string)?.toLowerCase().trim();
    const displayName = (data.get('display_name') as string)?.trim() || '';
    const type = (data.get('type') as string) || 'shared';

    // ✅ Enhanced validation
    if (!address) return { error: 'Address is required' };
    if (!/^[a-z0-9._-]+@[a-z0-9.-]+$/.test(address)) return { error: 'Invalid email address format' };
    if (!['personal', 'shared'].includes(type)) return { error: 'Invalid mailbox type' };
    if (displayName.length > 255) return { error: 'Display name is too long' };

    try {
      const existing = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(address).first();
      if (existing) return { error: 'Mailbox already exists' };

      const id = generateId();
      await env.DB.prepare(
        'INSERT INTO mailboxes (id, address, display_name, type, status, created_at) VALUES (?, ?, ?, ?, \'active\', datetime(\'now\'))'
      ).bind(id, address, displayName, type).run();

      // ✅ Audit with error handling
      try {
        await audit(env.DB, {
          event_type: 'mailbox.created',
          actor_id: locals.user.id,
          actor_role: locals.user.role as 'standard' | 'manager',
          detail: `Created ${type} mailbox: ${address}`,
        });
      } catch (e) {
        console.error('Failed to log mailbox.created audit event:', e);
      }

      return { success: `Mailbox ${address} created` };
    } catch (e) {
      return { error: `Failed to create mailbox: ${(e as Error).message}` };
    }
  },
  assign: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    // ✅ Permission check: only managers can assign mailboxes
    if (!locals.user) return { error: 'Not authenticated' };
    if (locals.user.role !== 'manager') return { error: 'Only managers can assign mailboxes' };

    const data = await request.formData();
    const mailboxId = data.get('mailbox_id') as string;
    const userEmail = (data.get('user_email') as string)?.toLowerCase().trim();
    const permissions = (data.get('permissions') as string) || 'read';

    // ✅ Enhanced validation
    if (!mailboxId || !userEmail) return { error: 'Mailbox and user email required' };
    if (!['read', 'send-as', 'full'].includes(permissions)) return { error: 'Invalid permission level' };

    try {
      // Verify mailbox exists
      const mailbox = await env.DB.prepare('SELECT id FROM mailboxes WHERE id = ?').bind(mailboxId).first<{ id: string }>();
      if (!mailbox) return { error: 'Mailbox not found' };

      const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(userEmail).first<{ id: string }>();
      if (!user) return { error: 'User not found' };

      const existing = await env.DB.prepare(
        'SELECT id FROM mailbox_assignments WHERE mailbox_id = ? AND user_id = ?',
      ).bind(mailboxId, user.id).first();

      if (existing) {
        await env.DB.prepare(
          'UPDATE mailbox_assignments SET permissions = ?, assigned_at = datetime(\'now\') WHERE mailbox_id = ? AND user_id = ?',
        ).bind(permissions, mailboxId, user.id).run();

        // ✅ Audit update
        try {
          await audit(env.DB, {
            event_type: 'mailbox.permissions_updated',
            actor_id: locals.user.id,
            actor_role: locals.user.role as 'standard' | 'manager',
            detail: `Updated ${userEmail} mailbox permissions to ${permissions}`,
          });
        } catch (e) {
          console.error('Failed to log mailbox.permissions_updated audit event:', e);
        }

        return { success: 'Assignment updated' };
      }

      const id = generateId();
      await env.DB.prepare(
        'INSERT INTO mailbox_assignments (id, mailbox_id, user_id, permissions, assigned_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
      ).bind(id, mailboxId, user.id, permissions).run();

      // ✅ Audit assignment
      try {
        await audit(env.DB, {
          event_type: 'mailbox.assigned',
          actor_id: locals.user.id,
          actor_role: locals.user.role as 'standard' | 'manager',
          detail: `Assigned ${userEmail} to mailbox with ${permissions} permissions`,
        });
      } catch (e) {
        console.error('Failed to log mailbox.assigned audit event:', e);
      }

      return { success: `User assigned to mailbox` };
    } catch (e) {
      return { error: `Failed to assign user: ${(e as Error).message}` };
    }
  },
};
