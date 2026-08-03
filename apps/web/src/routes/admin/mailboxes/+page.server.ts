import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { Mailbox, MailboxAssignment, User, UserStatus } from '@cmail/shared/types';
import { audit, generateId } from '$lib/server/db';
import {
  boundedInteger,
  escapeLike,
  isAddressAtDomain,
  normalizeDomain,
  normalizeEmail,
  normalizeMailboxLocalPart,
  textField,
} from '$lib/server/validation';
import {
  MAILBOX_PERMISSIONS,
  MAILBOX_STATUSES,
  mailboxPermissionLabel,
  parseMailboxStatusFilter,
  parseMailboxTypeFilter,
} from './mailbox-management';

const PAGE_SIZE = 20;

interface AssignmentSummary {
  user_id: string;
  email: string;
  display_name: string;
  user_status: UserStatus;
  permissions: MailboxAssignment['permissions'];
  assigned_at: string;
}

type MailboxRow = Mailbox & { message_count: number };
type MailboxWithAssignments = MailboxRow & { assignments: AssignmentSummary[] };

interface MailboxSummary {
  total: number;
  shared: number;
  personal: number;
  active: number;
  disabled: number;
  delegations: number;
}

function isManager(locals: App.Locals): boolean {
  return !!locals.user && locals.user.role === 'manager';
}

function formId(value: FormDataEntryValue | null): string | null {
  return textField(value, 100);
}

function logAdminFailure(action: string, error: unknown): void {
  // Values from forms, addresses, SQL, and provider/database responses are
  // deliberately excluded from logs.
  console.error(`Admin mailbox action failed: ${action}`, {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
}

export const load: PageServerLoad = async ({ platform, url }) => {
  const env = platform?.env;
  if (!env) {
    return {
      mailboxes: [] as MailboxWithAssignments[],
      search: '',
      page: 1,
      total: 0,
      totalPages: 1,
      mailDomain: '',
      typeFilter: '',
      statusFilter: '',
      summary: {
        total: 0,
        shared: 0,
        personal: 0,
        active: 0,
        disabled: 0,
        delegations: 0,
      } satisfies MailboxSummary,
      configurationUnavailable: true,
    };
  }

  const search = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const typeFilter = parseMailboxTypeFilter(url.searchParams.get('type'));
  const statusFilter = parseMailboxStatusFilter(url.searchParams.get('status'));
  const requestedPage = boundedInteger(url.searchParams.get('page'), 1, 1, 10_000);
  const bindings: string[] = [];
  const clauses: string[] = [];
  if (search) {
    const term = `%${escapeLike(search)}%`;
    clauses.push(`(
      m.address LIKE ? ESCAPE '\\' OR
      m.display_name LIKE ? ESCAPE '\\' OR
      EXISTS (
        SELECT 1
        FROM mailbox_assignments ma_search
        INNER JOIN users u_search ON u_search.id = ma_search.user_id
        WHERE ma_search.mailbox_id = m.id
          AND (u_search.email LIKE ? ESCAPE '\\' OR u_search.display_name LIKE ? ESCAPE '\\')
      )
    )`);
    bindings.push(term, term, term, term);
  }
  if (typeFilter) {
    clauses.push('m.type = ?');
    bindings.push(typeFilter);
  }
  if (statusFilter) {
    clauses.push('m.status = ?');
    bindings.push(statusFilter);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countStatement = env.DB.prepare(`SELECT COUNT(*) AS count FROM mailboxes m ${where}`);
  const [count, summaryRow] = await Promise.all([
    bindings.length
      ? countStatement.bind(...bindings).first<{ count: number }>()
      : countStatement.first<{ count: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN type = 'shared' THEN 1 ELSE 0 END), 0) AS shared,
              COALESCE(SUM(CASE WHEN type = 'personal' THEN 1 ELSE 0 END), 0) AS personal,
              COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active,
              COALESCE(SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END), 0) AS disabled,
              (SELECT COUNT(*) FROM mailbox_assignments) AS delegations
       FROM mailboxes`,
    ).first<MailboxSummary>(),
  ]);
  const total = count?.count || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;

  const mailboxStatement = env.DB.prepare(
    `SELECT m.*,
            (SELECT COUNT(*) FROM messages msg WHERE msg.mailbox_id = m.id) AS message_count
     FROM mailboxes m
     ${where}
     ORDER BY CASE m.type WHEN 'shared' THEN 0 ELSE 1 END,
              CASE m.status WHEN 'active' THEN 0 ELSE 1 END,
              m.address, m.id
     LIMIT ? OFFSET ?`,
  );
  const mailboxResult = bindings.length
    ? await mailboxStatement.bind(...bindings, PAGE_SIZE, offset).all<MailboxRow>()
    : await mailboxStatement.bind(PAGE_SIZE, offset).all<MailboxRow>();
  const mailboxes: MailboxWithAssignments[] = (mailboxResult.results || []).map((mailbox) => ({
    ...mailbox,
    message_count: Number(mailbox.message_count) || 0,
    assignments: [],
  }));

  if (mailboxes.length) {
    const placeholders = mailboxes.map(() => '?').join(', ');
    const assignmentResult = await env.DB.prepare(
      `SELECT ma.mailbox_id, ma.user_id, ma.permissions, ma.assigned_at,
              u.email, u.display_name, u.status AS user_status
       FROM mailbox_assignments ma
       INNER JOIN users u ON u.id = ma.user_id
       WHERE ma.mailbox_id IN (${placeholders})
       ORDER BY u.display_name, u.email, u.id`,
    ).bind(...mailboxes.map((mailbox) => mailbox.id)).all<AssignmentSummary & { mailbox_id: string }>();
    const byMailbox = new Map<string, AssignmentSummary[]>();
    for (const assignment of assignmentResult.results || []) {
      const list = byMailbox.get(assignment.mailbox_id) || [];
      list.push({
        user_id: assignment.user_id,
        email: assignment.email,
        display_name: assignment.display_name,
        user_status: assignment.user_status,
        permissions: assignment.permissions,
        assigned_at: assignment.assigned_at,
      });
      byMailbox.set(assignment.mailbox_id, list);
    }
    for (const mailbox of mailboxes) {
      mailbox.assignments = byMailbox.get(mailbox.id) || [];
    }
  }

  return {
    mailboxes,
    search,
    typeFilter,
    statusFilter,
    page,
    total,
    totalPages,
    mailDomain: normalizeDomain(env.MAIL_DOMAIN) || '',
    summary: {
      total: Number(summaryRow?.total) || 0,
      shared: Number(summaryRow?.shared) || 0,
      personal: Number(summaryRow?.personal) || 0,
      active: Number(summaryRow?.active) || 0,
      disabled: Number(summaryRow?.disabled) || 0,
      delegations: Number(summaryRow?.delegations) || 0,
    } satisfies MailboxSummary,
    configurationUnavailable: false,
  };
};

export const actions: Actions = {
  create: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service configuration is unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const data = await request.formData();
    const rawAddress = textField(data.get('address'), 254);
    const displayName = textField(data.get('display_name'), 120);
    const delegateEntry = data.get('delegate_email');
    const rawDelegateEmail = delegateEntry === null ? '' : textField(delegateEntry, 254);
    if (rawDelegateEmail === null) {
      return fail(400, { error: 'Initial delegate email must be 254 characters or fewer' });
    }
    const delegateEmail = rawDelegateEmail ? normalizeEmail(rawDelegateEmail) : '';
    const rawPermissions = data.get('permissions');
    const permissions = typeof rawPermissions === 'string' && (MAILBOX_PERMISSIONS as readonly string[]).includes(rawPermissions)
      ? rawPermissions as MailboxAssignment['permissions']
      : null;
    const mailDomain = normalizeDomain(env.MAIL_DOMAIN);
    if (!mailDomain) {
      return fail(503, { error: 'MAIL_DOMAIN must be configured before creating mailboxes' });
    }
    if (!rawAddress) return fail(400, { error: 'Enter a mailbox name or address' });
    if (displayName === null) {
      return fail(400, { error: 'Display name must be 120 characters or fewer' });
    }
    if (!displayName) return fail(400, { error: 'Enter a display name for the shared mailbox' });
    if (rawDelegateEmail && !delegateEmail) {
      return fail(400, { error: 'Enter a valid initial delegate email address' });
    }
    if (delegateEmail && !permissions) {
      return fail(400, { error: 'Select a valid permission level for the initial delegate' });
    }

    const fullAddress = normalizeEmail(rawAddress);
    const candidateLocalPart = fullAddress ? fullAddress.slice(0, fullAddress.lastIndexOf('@')) : rawAddress;
    const localPart = normalizeMailboxLocalPart(candidateLocalPart);
    if (!localPart || (fullAddress && !isAddressAtDomain(fullAddress, mailDomain))) {
      return fail(400, {
        error: `Mailbox addresses must use @${mailDomain}; names may contain letters, numbers, dots, underscores, and hyphens`,
      });
    }
    const address = `${localPart}@${mailDomain}`;

    const [existing, delegate] = await Promise.all([
      env.DB.prepare('SELECT id FROM mailboxes WHERE lower(address) = ?')
        .bind(address).first<{ id: string }>(),
      delegateEmail
        ? env.DB.prepare('SELECT id, status FROM users WHERE lower(email) = ?')
          .bind(delegateEmail).first<Pick<User, 'id' | 'status'>>()
        : Promise.resolve(null),
    ]);
    if (existing) return fail(409, { error: 'That mailbox address is already in use' });
    if (delegateEmail && !delegate) return fail(404, { error: 'The initial delegate account was not found' });
    if (delegate && delegate.status !== 'active' && delegate.status !== 'pending') {
      return fail(409, { error: 'Reactivate the initial delegate account before adding mailbox delegation' });
    }

    const mailboxId = generateId();
    try {
      const statements = [
        env.DB.prepare(
          `INSERT INTO mailboxes (id, address, display_name, type, status, created_at)
           VALUES (?, ?, ?, 'shared', 'active', datetime('now'))`,
        ).bind(mailboxId, address, displayName),
      ];
      if (delegate && permissions) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO mailbox_assignments
               (user_id, mailbox_id, permissions, assigned_at, assigned_by)
             VALUES (?, ?, ?, datetime('now'), ?)`,
          ).bind(delegate.id, mailboxId, permissions, locals.user!.id),
        );
      }
      await env.DB.batch(statements);
    } catch (error) {
      logAdminFailure('create', error);
      return fail(409, { error: 'The mailbox could not be created; check for an existing address and try again' });
    }

    await audit(env.DB, {
      event_type: 'mailbox.created',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: mailboxId,
      detail: 'Created shared mailbox',
    });
    if (delegate && permissions) {
      await audit(env.DB, {
        event_type: 'mailbox.assigned',
        actor_id: locals.user!.id,
        actor_role: 'manager',
        target: mailboxId,
        detail: `Granted ${permissions} access to account ${delegate.id}`,
      });
    }
    return {
      success: delegate
        ? `Shared mailbox ${address} created with its initial delegation`
        : `Shared mailbox ${address} created; add mailbox delegation so someone can use it`,
    };
  },

  assign: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service configuration is unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const data = await request.formData();
    const mailboxAddress = normalizeEmail(data.get('mailbox_address'));
    const userEmail = normalizeEmail(data.get('user_email'));
    const rawPermissions = data.get('permissions');
    const permissions = typeof rawPermissions === 'string' && (MAILBOX_PERMISSIONS as readonly string[]).includes(rawPermissions)
      ? rawPermissions as MailboxAssignment['permissions']
      : null;
    if (!mailboxAddress || !userEmail || !permissions) {
      return fail(400, { error: 'Enter a mailbox, an active or pending account, and a valid access level' });
    }

    const [mailbox, user, existingAssignment] = await Promise.all([
      env.DB.prepare('SELECT id, type FROM mailboxes WHERE lower(address) = ?')
        .bind(mailboxAddress).first<Pick<Mailbox, 'id' | 'type'>>(),
      env.DB.prepare('SELECT id, status FROM users WHERE lower(email) = ?')
        .bind(userEmail).first<Pick<User, 'id' | 'status'>>(),
      env.DB.prepare(
        `SELECT ma.permissions
         FROM mailbox_assignments ma
         INNER JOIN mailboxes m ON m.id = ma.mailbox_id
         INNER JOIN users u ON u.id = ma.user_id
         WHERE lower(m.address) = ? AND lower(u.email) = ?`,
      ).bind(mailboxAddress, userEmail).first<Pick<MailboxAssignment, 'permissions'>>(),
    ]);
    if (!mailbox) return fail(404, { error: 'Mailbox not found' });
    if (!user) return fail(404, { error: 'Account not found' });
    if (user.status !== 'active' && user.status !== 'pending') {
      return fail(409, { error: 'Reactivate the account before changing mailbox delegation' });
    }
    if (mailbox.type === 'personal' && permissions !== 'full') {
      return fail(400, { error: 'Personal mailbox owners must have Full access' });
    }
    if (existingAssignment?.permissions === permissions) {
      return { success: `${mailboxPermissionLabel(permissions)} is already assigned to this account` };
    }

    try {
      const result = await env.DB.prepare(
        `INSERT INTO mailbox_assignments
           (user_id, mailbox_id, permissions, assigned_at, assigned_by)
         SELECT u.id, m.id, ?, datetime('now'), ?
         FROM users u, mailboxes m
         WHERE u.id = ? AND u.status IN ('active', 'pending')
           AND m.id = ? AND (m.type = 'shared' OR ? = 'full')
         ON CONFLICT(user_id, mailbox_id) DO UPDATE SET
           permissions = excluded.permissions,
           assigned_at = excluded.assigned_at,
           assigned_by = excluded.assigned_by`,
      ).bind(permissions, locals.user!.id, user.id, mailbox.id, permissions).run();
      if (!result.meta.changes) {
        return fail(409, { error: 'The account or mailbox changed; refresh and try again' });
      }
    } catch (error) {
      logAdminFailure('assign', error);
      return fail(500, { error: 'Mailbox delegation could not be updated' });
    }

    await audit(env.DB, {
      event_type: existingAssignment ? 'mailbox.permission_changed' : 'mailbox.assigned',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: mailbox.id,
      detail: existingAssignment
        ? `Changed account ${user.id} from ${existingAssignment.permissions} to ${permissions} access`
        : `Granted ${permissions} access to account ${user.id}`,
    });
    return {
      success: existingAssignment
        ? `Mailbox delegation updated to ${mailboxPermissionLabel(permissions)}`
        : `${mailboxPermissionLabel(permissions)} delegation added`,
    };
  },

  unassign: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service configuration is unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const data = await request.formData();
    const mailboxId = formId(data.get('mailbox_id'));
    const userId = formId(data.get('user_id'));
    if (!mailboxId || !userId) return fail(400, { error: 'Invalid mailbox delegation request' });

    const assignment = await env.DB.prepare(
      `SELECT ma.user_id, m.type, m.status
       FROM mailbox_assignments ma
       INNER JOIN mailboxes m ON m.id = ma.mailbox_id
       WHERE ma.mailbox_id = ? AND ma.user_id = ?`,
    ).bind(mailboxId, userId).first<{
      user_id: string;
      type: Mailbox['type'];
      status: Mailbox['status'];
    }>();
    if (!assignment) return fail(404, { error: 'Mailbox assignment not found' });

    try {
      const result = await env.DB.prepare(
        `DELETE FROM mailbox_assignments
         WHERE mailbox_id = ? AND user_id = ?
           AND EXISTS (
             SELECT 1 FROM mailboxes m
             WHERE m.id = ? AND (
               m.type = 'shared' OR m.status = 'disabled' OR
               EXISTS (
                 SELECT 1
                 FROM mailbox_assignments remaining
                 INNER JOIN users u ON u.id = remaining.user_id
                 WHERE remaining.mailbox_id = m.id
                   AND remaining.user_id <> ?
                   AND remaining.permissions = 'full'
                   AND u.status IN ('active', 'pending')
               )
             )
           )`,
      ).bind(mailboxId, userId, mailboxId, userId).run();
      if (!result.meta.changes) {
        return fail(409, {
          error: 'An active personal mailbox must retain at least one active or pending owner with Full access',
        });
      }
    } catch (error) {
      logAdminFailure('unassign', error);
      return fail(500, { error: 'Mailbox delegation could not be removed' });
    }

    await audit(env.DB, {
      event_type: 'mailbox.unassigned',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: mailboxId,
      detail: `Removed access for account ${userId}`,
    });
    return { success: 'Mailbox delegation removed' };
  },

  updateStatus: async ({ request, platform, locals }) => {
    const env = platform?.env;
    if (!env) return fail(503, { error: 'Service configuration is unavailable' });
    if (!isManager(locals)) return fail(403, { error: 'Manager role required' });

    const data = await request.formData();
    const mailboxId = formId(data.get('mailbox_id'));
    const rawStatus = data.get('status');
    const status = typeof rawStatus === 'string' && (MAILBOX_STATUSES as readonly string[]).includes(rawStatus)
      ? rawStatus as Mailbox['status']
      : null;
    if (!mailboxId || !status) return fail(400, { error: 'Invalid mailbox status request' });

    const mailbox = await env.DB.prepare(
      'SELECT id, type, status FROM mailboxes WHERE id = ?',
    ).bind(mailboxId).first<Pick<Mailbox, 'id' | 'type' | 'status'>>();
    if (!mailbox) return fail(404, { error: 'Mailbox not found' });
    if (mailbox.status === status) return { success: `Mailbox is already ${status}` };

    try {
      const result = await env.DB.prepare(
        `UPDATE mailboxes SET status = ?
         WHERE id = ? AND (
           ? = 'disabled' OR type = 'shared' OR
           EXISTS (
             SELECT 1
             FROM mailbox_assignments ma
             INNER JOIN users u ON u.id = ma.user_id
             WHERE ma.mailbox_id = mailboxes.id
               AND ma.permissions = 'full'
               AND u.status IN ('active', 'pending')
           )
         )`,
      ).bind(status, mailboxId, status).run();
      if (!result.meta.changes) {
        return fail(409, {
          error: 'Assign an active or pending owner with Full access before enabling this personal mailbox',
        });
      }
    } catch (error) {
      logAdminFailure('status update', error);
      return fail(500, { error: 'Mailbox status could not be updated' });
    }

    await audit(env.DB, {
      event_type: status === 'active' ? 'mailbox.enabled' : 'mailbox.disabled',
      actor_id: locals.user!.id,
      actor_role: 'manager',
      target: mailboxId,
      detail: `Changed mailbox status to ${status}`,
    });
    return { success: `Mailbox ${status === 'active' ? 'enabled' : 'disabled'}` };
  },
};
