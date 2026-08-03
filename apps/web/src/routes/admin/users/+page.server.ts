import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { AuthProvider, Env, User, UserRole, UserStatus } from '@cmail/shared/types';
import { audit, generateId } from '$lib/server/db';
import { detectProvider, sendEmail } from '$lib/server/outbound';
import { generateInviteEmail } from '$lib/server/invite-email';
import { getEnabledProviders, getProviderConfig } from '$lib/server/auth';
import { loadOrgSettings, formatFromHeader } from '$lib/server/org-settings';
import { publicRuntimeConfig } from '$lib/server/config';
import { issueEnrollmentToken } from '$lib/server/identity';
import {
  boundedInteger,
  escapeLike,
  isAddressAtDomain,
  normalizeDomain,
  normalizeEmail,
  normalizeMailboxLocalPart,
  textField,
} from '$lib/server/validation';

const PAGE_SIZE = 25;
const USER_ROLES: readonly UserRole[] = ['standard', 'manager'];
const MANAGED_STATUSES: readonly UserStatus[] = ['active', 'paused', 'offboarded'];
const FILTER_STATUSES: readonly UserStatus[] = ['pending', 'active', 'paused', 'offboarded'];
const FILTER_PROVIDERS = ['google', 'microsoft', 'none'] as const;

type ManagedUser = User & { identity_bound: number };

type InviteDeliveryResult =
  | { ok: true; provider: string }
  | { ok: false; reason: 'configuration' | 'delivery' };

function isManager(locals: App.Locals): boolean {
  return !!locals.user && locals.user.role === 'manager';
}

function logAdminFailure(action: string, error: unknown): void {
  // Do not emit addresses, form values, provider responses, or SQL text to logs.
  console.error(`Admin user action failed: ${action}`, {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
}

function formId(value: FormDataEntryValue | null): string | null {
  return textField(value, 100);
}

function absoluteAppUrl(value: string): string {
  try {
    const url = new URL(value);
    const localHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password) return '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function safeInviteLink(value: string, appUrl: string): string {
  try {
    const url = new URL(value, `${appUrl}/`);
    const localHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return (url.protocol === 'https:' || localHttp) && !url.username && !url.password
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

async function deliverInvite(
  env: Env,
  actor: Pick<User, 'email' | 'display_name'>,
  user: Pick<User, 'email' | 'display_name'>,
  enrollmentToken: string,
  mailboxAddress?: string,
): Promise<InviteDeliveryResult> {
  const envRecord = env as unknown as Record<string, unknown>;
  const runtime = publicRuntimeConfig(envRecord);
  const settings = await loadOrgSettings(envRecord);
  const appUrl = absoluteAppUrl(settings.appUrl || runtime.appUrl);
  const mailDomain = normalizeDomain(runtime.mailDomain);
  const authEnv = env as unknown as Record<string, string | undefined>;
  const authProviders: AuthProvider[] = getEnabledProviders(authEnv).filter(
    (provider) => !!getProviderConfig(provider, authEnv),
  );
  const outboundProvider = detectProvider(envRecord);

  if (!appUrl || !mailDomain || authProviders.length === 0 || outboundProvider === 'none') {
    return { ok: false, reason: 'configuration' };
  }

  const configuredFrom = normalizeEmail(settings.systemEmail);
  const fromAddress = configuredFrom && isAddressAtDomain(configuredFrom, mailDomain)
    ? configuredFrom
    : `noreply@${mailDomain}`;
  const fromHeader = formatFromHeader(settings.systemFromName, fromAddress);
  const { subject, html, text } = generateInviteEmail({
    email: user.email,
    displayName: user.display_name || '',
    appName: settings.appName,
    appUrl,
    authProviders,
    enrollmentToken,
    senderName: actor.display_name || actor.email || 'An administrator',
    systemEmail: fromAddress,
    mailboxAddress,
    orgName: settings.orgName,
    orgShortName: settings.orgShortName,
    orgUrl: settings.orgUrl,
    supportEmail: settings.supportEmail,
    landingUrl: safeInviteLink(settings.landingUrl || appUrl, appUrl),
    policyUrl: safeInviteLink(settings.policyUrl || '/policy', appUrl),
  });

  try {
    const result = await sendEmail(
      { from: fromHeader, to: user.email, subject, html, text },
      envRecord,
    );
    if (!result.success) {
      console.error('Admin invite delivery failed', { provider: result.provider || outboundProvider });
      return { ok: false, reason: 'delivery' };
    }
    return { ok: true, provider: result.provider };
  } catch (error) {
    logAdminFailure('invite delivery', error);
    return { ok: false, reason: 'delivery' };
  }
}

export const load: PageServerLoad = async ({ platform, url, locals }) => {
  const env = platform?.env;
  if (!env) {
    return {
      users: [], search: '', page: 1, total: 0, totalPages: 1,
      mailDomain: '', currentUserId: '', inviteAvailable: false,
      roleFilter: '', statusFilter: '', providerFilter: '', configurationUnavailable: true,
    };
  }

  const search = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const requestedRole = url.searchParams.get('role') || '';
  const roleFilter = (USER_ROLES as readonly string[]).includes(requestedRole)
    ? requestedRole as UserRole
    : '';
  const requestedStatus = url.searchParams.get('status') || '';
  const statusFilter = (FILTER_STATUSES as readonly string[]).includes(requestedStatus)
    ? requestedStatus as UserStatus
    : '';
  const requestedProvider = url.searchParams.get('provider') || '';
  const providerFilter = (FILTER_PROVIDERS as readonly string[]).includes(requestedProvider)
    ? requestedProvider as typeof FILTER_PROVIDERS[number]
    : '';
  const requestedPage = boundedInteger(url.searchParams.get('page'), 1, 1, 10_000);
  const bindings: string[] = [];
  const clauses: string[] = [];
  if (search) {
    const term = `%${escapeLike(search)}%`;
    clauses.push(`(u.email LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')`);
    bindings.push(term, term);
  }
  if (roleFilter) {
    clauses.push('u.role = ?');
    bindings.push(roleFilter);
  }
  if (statusFilter) {
    clauses.push('u.status = ?');
    bindings.push(statusFilter);
  }
  if (providerFilter) {
    clauses.push(providerFilter === 'none'
      ? 'NOT EXISTS (SELECT 1 FROM user_identities filter_identity WHERE filter_identity.user_id = u.id)'
      : 'EXISTS (SELECT 1 FROM user_identities filter_identity WHERE filter_identity.user_id = u.id AND filter_identity.provider = ?)');
    if (providerFilter !== 'none') bindings.push(providerFilter);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countStatement = env.DB.prepare(`SELECT COUNT(*) AS count FROM users u ${where}`);
  const count = bindings.length
    ? await countStatement.bind(...bindings).first<{ count: number }>()
    : await countStatement.first<{ count: number }>();
  const total = count?.count || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;

  const userStatement = env.DB.prepare(
    `SELECT u.*,
            CASE WHEN EXISTS (
              SELECT 1 FROM user_identities identity WHERE identity.user_id = u.id
            ) THEN 1 ELSE 0 END AS identity_bound
     FROM users u ${where}
     ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`,
  );
  const users = bindings.length
    ? await userStatement.bind(...bindings, PAGE_SIZE, offset).all<ManagedUser>()
    : await userStatement.bind(PAGE_SIZE, offset).all<ManagedUser>();

  const runtime = publicRuntimeConfig(env as unknown as Record<string, unknown>);
  const settings = await loadOrgSettings(env as unknown as Record<string, unknown>);
  const authEnv = env as unknown as Record<string, string | undefined>;
  const enabledProviders = getEnabledProviders(authEnv).filter(
    (provider) => !!getProviderConfig(provider, authEnv),
  );

  return {
    users: users.results || [],
    search,
    roleFilter,
    statusFilter,
    providerFilter,
    page,
    total,
    totalPages,
    mailDomain: runtime.mailDomain,
    currentUserId: locals.user?.id || '',
    inviteAvailable:
      !!absoluteAppUrl(settings.appUrl || runtime.appUrl) &&
      enabledProviders.length > 0 &&
      detectProvider(env as unknown as Record<string, unknown>) !== 'none',
    configurationUnavailable: false,
  };
};

export const actions: Actions = {
  create: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service configuration is unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const data = await request.formData();
    const email = normalizeEmail(data.get('email'));
    const displayName = textField(data.get('display_name'), 120);
    const rawRole = data.get('role');
    const role = typeof rawRole === 'string' && (USER_ROLES as readonly string[]).includes(rawRole)
      ? rawRole as UserRole
      : null;
    const rawMailboxLocal = typeof data.get('mailbox_local') === 'string'
      ? String(data.get('mailbox_local')).trim()
      : '';
    const mailboxLocal = rawMailboxLocal ? normalizeMailboxLocalPart(rawMailboxLocal) : '';
    const sendInvite = data.get('send_invite') === 'on';
    const mailDomain = normalizeDomain(env.MAIL_DOMAIN);

    if (!email) return fail(400, { error: 'Enter a valid sign-in email address' });
    if (displayName === null) return fail(400, { error: 'Display name must be 120 characters or fewer' });
    if (!role) return fail(400, { error: 'Select a valid account role' });
    if (rawMailboxLocal && !mailboxLocal) {
      return fail(400, { error: 'Mailbox name must start and end with a letter or number and may contain dots, underscores, or hyphens' });
    }
    if (mailboxLocal && !mailDomain) {
      return fail(503, { error: 'MAIL_DOMAIN must be configured before creating mailboxes' });
    }

    const mailboxAddress = mailboxLocal && mailDomain ? `${mailboxLocal}@${mailDomain}` : '';
    const [existingUser, existingMailbox] = await Promise.all([
      env.DB.prepare('SELECT id FROM users WHERE lower(email) = ?').bind(email).first<{ id: string }>(),
      mailboxAddress
        ? env.DB.prepare('SELECT id FROM mailboxes WHERE lower(address) = ?').bind(mailboxAddress).first<{ id: string }>()
        : Promise.resolve(null),
    ]);
    if (existingUser) return fail(409, { error: 'An account already exists for that sign-in address' });
    if (existingMailbox) return fail(409, { error: 'That mailbox address is already in use' });

    const userId = generateId();
    const mailboxId = mailboxAddress ? generateId() : '';
    const statements = [
      env.DB.prepare(
        `INSERT INTO users (id, email, display_name, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
      ).bind(userId, email, displayName, role),
    ];
    if (mailboxAddress) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO mailboxes (id, address, display_name, type, status, created_at)
           VALUES (?, ?, ?, 'personal', 'active', datetime('now'))`,
        ).bind(mailboxId, mailboxAddress, displayName || mailboxLocal),
        env.DB.prepare(
          `INSERT INTO mailbox_assignments
             (mailbox_id, user_id, permissions, assigned_at, assigned_by)
           VALUES (?, ?, 'full', datetime('now'), ?)`,
        ).bind(mailboxId, userId, locals.user!.id),
      );
    }

    try {
      // D1 batches are transactional: the account cannot survive without its
      // requested personal mailbox/assignment, or vice versa.
      await env.DB.batch(statements);
    } catch (error) {
      logAdminFailure('create', error);
      return fail(409, { error: 'The account or mailbox could not be created; check for an existing address and try again' });
    }

    await audit(env.DB, {
      event_type: 'user.provisioned',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: userId,
      detail: `Provisioned ${role} account`,
    });
    if (mailboxAddress) {
      await audit(env.DB, {
        event_type: 'mailbox.created',
        actor_id: locals.user!.id,
        actor_role: 'manager',
        target: mailboxId,
        detail: 'Provisioned personal mailbox with full owner assignment',
      });
    }

    if (!sendInvite) {
      return {
        success: `User ${email} created${mailboxAddress ? ` with ${mailboxAddress}` : ''}`,
        warning: 'This account is pending and cannot sign in until a manager sends an invitation.',
      };
    }

    let enrollmentToken: string;
    try {
      ({ token: enrollmentToken } = await issueEnrollmentToken(env.DB, userId, locals.user!.id));
    } catch (error) {
      logAdminFailure('enrollment token issue', error);
      return {
        success: `User ${email} created`,
        warning: 'The account is pending, but a secure invitation could not be created. Use Send invitation to retry.',
      };
    }
    await audit(env.DB, {
      event_type: 'auth.enrollment_issued',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: userId,
      detail: 'Issued a single-use first-sign-in invitation',
    });

    const invite = await deliverInvite(
      env,
      locals.user!,
      { email, display_name: displayName },
      enrollmentToken,
      mailboxAddress || undefined,
    );
    await audit(env.DB, {
      event_type: invite.ok ? 'email.sent' : 'email.failed',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: userId,
      detail: invite.ok ? `Invite sent via ${invite.provider}` : 'Invite delivery unavailable',
    });

    if (!invite.ok) {
      const warning = invite.reason === 'configuration'
        ? 'User created, but invites require a safe APP_URL, an enabled sign-in provider, and an outbound email provider.'
        : 'User created, but the invite could not be delivered. Check outbound email operations before retrying.';
      return { success: `User ${email} created`, warning };
    }

    return { success: `User ${email} created and invite sent` };
  },

  updateStatus: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service configuration is unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const data = await request.formData();
    const userId = formId(data.get('user_id'));
    const rawStatus = data.get('status');
    const status = typeof rawStatus === 'string' && (MANAGED_STATUSES as readonly string[]).includes(rawStatus)
      ? rawStatus as UserStatus
      : null;
    if (!userId || !status) return fail(400, { error: 'Invalid account status request' });

    const user = await env.DB.prepare(
      'SELECT id, role, status FROM users WHERE id = ?',
    ).bind(userId).first<Pick<User, 'id' | 'role' | 'status'>>();
    if (!user) return fail(404, { error: 'Account not found' });
    if (user.status === status) return { success: `Account is already ${status}` };
    if (userId === locals.user!.id && status !== 'active') {
      return fail(409, { error: 'You cannot pause or offboard your own account' });
    }

    const statements = [
      env.DB.prepare(
        `UPDATE users SET status = ?, updated_at = datetime('now')
         WHERE id = ? AND (
           role <> 'manager' OR status <> 'active' OR ? = 'active' OR
           EXISTS (
             SELECT 1 FROM users
             WHERE role = 'manager' AND status = 'active' AND id <> ?
           )
         )`,
      ).bind(status, userId, status, userId),
    ];

    if (status === 'paused' || status === 'offboarded') {
      statements.push(
        env.DB.prepare(
          `UPDATE sessions SET revoked = 1
           WHERE user_id = ? AND EXISTS (
             SELECT 1 FROM users WHERE id = ? AND status = ?
           )`,
        ).bind(userId, userId, status),
      );
    }
    if (status === 'offboarded') {
      statements.push(
        env.DB.prepare(
          `UPDATE mailboxes SET status = 'disabled'
           WHERE type = 'personal'
             AND id IN (SELECT mailbox_id FROM mailbox_assignments WHERE user_id = ?)
             AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'offboarded')`,
        ).bind(userId, userId),
        env.DB.prepare(
          `DELETE FROM mailbox_assignments
           WHERE user_id = ?
             AND mailbox_id IN (SELECT id FROM mailboxes WHERE type = 'shared')
             AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'offboarded')`,
        ).bind(userId, userId),
      );
    }

    try {
      const results = await env.DB.batch(statements);
      if (!results[0]?.meta.changes) {
        return fail(409, { error: 'At least one other active manager is required before changing this account' });
      }
    } catch (error) {
      logAdminFailure('status update', error);
      return fail(500, { error: 'Account status could not be updated' });
    }

    await audit(env.DB, {
      event_type: status === 'offboarded' ? 'user.offboarded' : status === 'paused' ? 'user.paused' : 'user.reactivated',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: userId,
      detail: status === 'offboarded'
        ? 'Offboarded account, disabled personal mailboxes, and removed shared access'
        : status === 'active'
          ? 'Reactivated account; personal mailboxes remain in their existing state'
          : `Changed account status to ${status}`,
    });

    return {
      success: status === 'offboarded'
        ? 'Account offboarded; personal mailboxes were disabled and shared access was removed'
        : status === 'active'
          ? 'Account reactivated; review any disabled personal mailboxes separately'
          : `Account status updated to ${status}`,
    };
  },

  updateRole: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service configuration is unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const data = await request.formData();
    const userId = formId(data.get('user_id'));
    const rawRole = data.get('role');
    const role = typeof rawRole === 'string' && (USER_ROLES as readonly string[]).includes(rawRole)
      ? rawRole as UserRole
      : null;
    if (!userId || !role) return fail(400, { error: 'Invalid role request' });

    const user = await env.DB.prepare(
      'SELECT id, role, status FROM users WHERE id = ?',
    ).bind(userId).first<Pick<User, 'id' | 'role' | 'status'>>();
    if (!user) return fail(404, { error: 'Account not found' });
    if (user.role === role) return { success: `Account already has the ${role} role` };
    if (userId === locals.user!.id && role !== 'manager') {
      return fail(409, { error: 'You cannot remove your own manager role' });
    }

    const statements = [
      env.DB.prepare(
        `UPDATE users SET role = ?, updated_at = datetime('now')
         WHERE id = ? AND (
           role <> 'manager' OR status <> 'active' OR ? = 'manager' OR
           EXISTS (
             SELECT 1 FROM users
             WHERE role = 'manager' AND status = 'active' AND id <> ?
           )
         )`,
      ).bind(role, userId, role, userId),
    ];
    if (role === 'standard') {
      statements.push(
        env.DB.prepare(
          `UPDATE sessions SET revoked = 1
           WHERE user_id = ?
             AND EXISTS (SELECT 1 FROM users WHERE id = ? AND role = 'standard')`,
        ).bind(userId, userId),
      );
    }

    try {
      const results = await env.DB.batch(statements);
      if (!results[0]?.meta.changes) {
        return fail(409, { error: 'At least one other active manager is required before changing this role' });
      }
    } catch (error) {
      logAdminFailure('role update', error);
      return fail(500, { error: 'Account role could not be updated' });
    }

    await audit(env.DB, {
      event_type: 'user.role_changed',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: userId,
      detail: `Changed account role to ${role}`,
    });
    return { success: `Account role updated to ${role}` };
  },

  resendInvite: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service configuration is unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const data = await request.formData();
    const userId = formId(data.get('user_id'));
    if (!userId) return fail(400, { error: 'Invalid account' });

    const user = await env.DB.prepare(
      `SELECT u.id, u.email, u.display_name, u.status,
              CASE WHEN EXISTS (
                SELECT 1 FROM user_identities identity WHERE identity.user_id = u.id
              ) THEN 1 ELSE 0 END AS identity_bound
       FROM users u WHERE u.id = ?`,
    ).bind(userId).first<Pick<User, 'id' | 'email' | 'display_name' | 'status'> & { identity_bound: number }>();
    if (!user) return fail(404, { error: 'Account not found' });
    if (user.status === 'paused' || user.status === 'offboarded') {
      return fail(409, { error: 'Reactivate the account before sending another invite' });
    }
    if (user.identity_bound) {
      return fail(409, { error: 'This account already has an enrolled sign-in identity' });
    }

    const mailbox = await env.DB.prepare(
      `SELECT m.address, m.status
       FROM mailboxes m
       INNER JOIN mailbox_assignments a ON a.mailbox_id = m.id
       WHERE a.user_id = ? AND m.type = 'personal'
       ORDER BY CASE m.status WHEN 'active' THEN 0 ELSE 1 END, m.created_at ASC
       LIMIT 1`,
    ).bind(userId).first<{ address: string; status: 'active' | 'disabled' }>();

    let enrollmentToken: string;
    try {
      ({ token: enrollmentToken } = await issueEnrollmentToken(env.DB, userId, locals.user!.id));
    } catch (error) {
      logAdminFailure('enrollment token rotate', error);
      return fail(500, { error: 'A secure invitation could not be created' });
    }
    await audit(env.DB, {
      event_type: 'auth.enrollment_issued',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: userId,
      detail: 'Rotated the single-use first-sign-in invitation',
    });

    const invite = await deliverInvite(
      env,
      locals.user!,
      user,
      enrollmentToken,
      mailbox?.status === 'active' ? mailbox.address : undefined,
    );
    await audit(env.DB, {
      event_type: invite.ok ? 'email.sent' : 'email.failed',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: userId,
      detail: invite.ok ? `Invite resent via ${invite.provider}` : 'Invite resend unavailable',
    });

    if (!invite.ok) {
      return fail(invite.reason === 'configuration' ? 503 : 502, {
        error: invite.reason === 'configuration'
          ? 'Invites require a safe APP_URL, an enabled sign-in provider, and an outbound email provider'
          : 'The invite could not be delivered; check outbound email operations before retrying',
      });
    }

    return { success: 'Invite sent' };
  },
};
