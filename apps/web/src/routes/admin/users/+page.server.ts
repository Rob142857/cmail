import type { PageServerLoad, Actions } from './$types';
import type { User } from '@cmail/shared/types';
import { generateId, audit } from '$lib/server/db';
import { sendEmail, detectProvider } from '$lib/server/outbound';
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

  return {
    users: users.results || [],
    search: search || '',
    mailDomain: (env.MAIL_DOMAIN as string) || '',
  };
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
    const mailboxLocal = (data.get('mailbox_local') as string)?.toLowerCase().trim() || '';
    const mailDomain = (env.MAIL_DOMAIN as string) || '';

    if (!email) return { error: 'Email is required' };

    // Validate mailbox local-part early so user isn't created if it's bad
    if (mailboxLocal) {
      if (!mailDomain) return { error: 'Cannot create mailbox: MAIL_DOMAIN is not configured on the server' };
      if (!/^[a-z0-9._-]+$/.test(mailboxLocal)) return { error: 'Invalid mailbox name (use a-z, 0-9, dot, underscore, hyphen)' };
      const mailboxAddress = `${mailboxLocal}@${mailDomain}`;
      const existingMailbox = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(mailboxAddress).first();
      if (existingMailbox) return { error: `Mailbox ${mailboxAddress} already exists` };
    }

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

    // Create + assign personal mailbox if requested
    let mailboxResult = { success: true, error: null as string | null, address: '' };
    if (mailboxLocal) {
      const mailboxAddress = `${mailboxLocal}@${mailDomain}`;
      try {
        const mailboxId = generateId();
        await env.DB.prepare(
          'INSERT INTO mailboxes (id, address, display_name, type, status, created_at) VALUES (?, ?, ?, \'personal\', \'active\', datetime(\'now\'))',
        ).bind(mailboxId, mailboxAddress, displayName || mailboxLocal).run();
        await env.DB.prepare(
          'INSERT INTO mailbox_assignments (mailbox_id, user_id, permissions, assigned_at) VALUES (?, ?, \'full\', datetime(\'now\'))',
        ).bind(mailboxId, id).run();
        await audit(env.DB, {
          event_type: 'mailbox.created',
          actor_id: locals.user!.id,
          actor_role: locals.user!.role as 'standard' | 'manager',
          detail: `Created personal mailbox ${mailboxAddress} for ${email}`,
        });
        mailboxResult.address = mailboxAddress;
      } catch (e) {
        mailboxResult = { success: false, error: `Mailbox creation failed: ${(e as Error).message}`, address: mailboxAddress };
      }
    }

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

        console.log('[INVITE] Sending to:', email, 'from:', fromEmail, 'provider:', detectProvider(env as Record<string, unknown>));
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
        console.log('[INVITE] Send result:', result);

        if (!result.success) {
          console.error('[INVITE] Email send failed:', result);
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

    const warnings: string[] = [];
    if (!mailboxResult.success && mailboxResult.error) warnings.push(mailboxResult.error);
    if (!inviteResult.success && inviteResult.error) warnings.push(inviteResult.error);

    let successMsg = `User ${email} created`;
    if (mailboxResult.success && mailboxResult.address) successMsg += `, mailbox ${mailboxResult.address} provisioned`;
    if (sendInvite && inviteResult.success) successMsg += ', invite sent';

    if (warnings.length) return { success: successMsg, warning: warnings.join(' | ') };
    return { success: successMsg };
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
