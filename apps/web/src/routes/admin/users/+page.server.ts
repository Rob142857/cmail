import type { PageServerLoad, Actions } from './$types';
import type { User } from '@cmail/shared/types';
import { generateId, audit } from '$lib/server/db';
import { sendEmail } from '$lib/server/outbound';
import { generateInviteEmail } from '$lib/server/invite-email';

export const load: PageServerLoad = async ({ platform, url }) => {
  const env = platform?.env;
  if (!env) return { users: [] };

  const search = url.searchParams.get('q');
  let users;

  if (search) {
    const term = `%${search}%`;
    users = await env.DB.prepare(
      'SELECT * FROM users WHERE email LIKE ? OR display_name LIKE ? ORDER BY created_at DESC',
    ).bind(term, term).all<User>();
  } else {
    users = await env.DB.prepare('SELECT * FROM users ORDER BY created_at DESC').all<User>();
  }

  return { users: users.results || [], search: search || '' };
};

export const actions: Actions = {
  create: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const data = await request.formData();
    const email = (data.get('email') as string)?.toLowerCase().trim();
    const displayName = (data.get('display_name') as string)?.trim() || '';
    const role = (data.get('role') as string) || 'standard';
    const sendInvite = data.get('send_invite') === 'on';

    if (!email) return { error: 'Email is required' };

    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) return { error: 'User already exists' };

    const id = generateId();
    await env.DB.prepare(
      'INSERT INTO users (id, email, display_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, \'pending\', datetime(\'now\'), datetime(\'now\'))',
    ).bind(id, email, displayName, role).run();

    await audit(env.DB, {
      event_type: 'user.provisioned',
      actor_id: locals.user!.id,
      actor_role: locals.user!.role as 'standard' | 'manager',
      detail: `Created user ${email} with role ${role}`,
    });

    // Send invite email if requested
    let inviteResult = { success: true, error: null as string | null };
    if (sendInvite) {
      try {
        const { subject, html, text } = generateInviteEmail({
          email,
          displayName,
          appName: env.APP_NAME || 'cmail',
          appUrl: env.APP_URL || 'https://mail.example.com',
          senderName: locals.user?.display_name || locals.user?.email || 'An administrator',
          systemEmail: env.SYSTEM_EMAIL as string,
        });

        // ✅ Use SYSTEM_EMAIL (desk@maatara.io) or fallback to noreply
        const fromEmail = (env.SYSTEM_EMAIL as string) || 'noreply@maatara.io';

        const result = await sendEmail(
          {
            from: fromEmail,
            to: email,
            subject,
            html,
            text,
          },
          env as unknown as Record<string, unknown>
        );

        if (!result.success) {
          inviteResult = { success: false, error: `Invite email failed: ${result.error}` };
          await audit(env.DB, {
            event_type: 'email.failed',
            actor_id: locals.user!.id,
            actor_role: locals.user!.role as 'standard' | 'manager',
            detail: `Failed to send invite email to ${email}: ${result.error}`,
          });
        } else {
          await audit(env.DB, {
            event_type: 'email.sent',
            actor_id: locals.user!.id,
            actor_role: locals.user!.role as 'standard' | 'manager',
            detail: `Sent invite email to ${email} via ${result.provider}`,
          });
        }
      } catch (e) {
        inviteResult = { success: false, error: (e as Error).message };
        await audit(env.DB, {
          event_type: 'email.error',
          actor_id: locals.user!.id,
          actor_role: locals.user!.role as 'standard' | 'manager',
          detail: `Error sending invite email to ${email}: ${(e as Error).message}`,
        });
      }
    }

    if (!inviteResult.success) {
      return { success: `User ${email} created`, warning: inviteResult.error };
    }

    return { success: sendInvite ? `User ${email} created and invite sent` : `User ${email} created` };
  },
  updateStatus: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return { error: 'Platform not available' };

    const data = await request.formData();
    const userId = data.get('user_id') as string;
    const status = data.get('status') as string;

    const valid = ['active', 'paused', 'offboarded'];
    if (!valid.includes(status)) return { error: 'Invalid status' };

    await env.DB.prepare('UPDATE users SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(status, userId).run();

    if (status === 'offboarded' || status === 'paused') {
      await env.DB.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').bind(userId).run();
    }

    await audit(env.DB, {
      event_type: status === 'offboarded' ? 'user.offboarded' : 'user.updated',
      actor_id: locals.user!.id,
      actor_role: locals.user!.role as 'standard' | 'manager',
      detail: `Changed user ${userId} status to ${status}`,
    });

    return { success: `User status updated to ${status}` };
  },
};
