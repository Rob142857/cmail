import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { Mailbox, MailboxAssignment, UserStatus } from '@cmail/shared/types';
import { audit, generateId } from '$lib/server/db';
import {
  ELIGIBLE_MAILBOX_ASSIGNEE_EXISTS_SQL,
  getEligibleMailboxAssignee,
} from '$lib/server/mailbox-assignees';
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
  display_name: string;
  personal_mailbox_address: string | null;
  user_status: UserStatus;
  permissions: MailboxAssignment['permissions'];
  assigned_at: string;
}

type MailboxRow = Mailbox & {
  message_count: number;
  owner_display_name: string | null;
};
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
          AND (u_search.display_name LIKE ? ESCAPE '\\' OR EXISTS (
            SELECT 1 FROM mailboxes personal_search
            WHERE personal_search.owner_user_id = u_search.id
              AND personal_search.type = 'personal'
              AND personal_search.address LIKE ? ESCAPE '\\'
          ))
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
    `SELECT m.*, owner.display_name AS owner_display_name,
            (SELECT COUNT(*) FROM messages msg WHERE msg.mailbox_id = m.id) AS message_count
     FROM mailboxes m
     LEFT JOIN users owner ON owner.id = m.owner_user_id
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
              u.display_name, u.status AS user_status, personal.address AS personal_mailbox_address
       FROM mailbox_assignments ma
       INNER JOIN users u ON u.id = ma.user_id
       LEFT JOIN mailboxes personal ON personal.owner_user_id = u.id AND personal.type = 'personal'
       WHERE ma.mailbox_id IN (${placeholders})
       ORDER BY u.display_name, personal.address, u.id`,
    ).bind(...mailboxes.map((mailbox) => mailbox.id)).all<AssignmentSummary & { mailbox_id: string }>();
    const byMailbox = new Map<string, AssignmentSummary[]>();
    for (const assignment of assignmentResult.results || []) {
      const list = byMailbox.get(assignment.mailbox_id) || [];
      list.push({
        user_id: assignment.user_id,
        display_name: assignment.display_name,
        personal_mailbox_address: assignment.personal_mailbox_address,
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
    const delegateEntry = data.get('delegate_user_id');
    const delegateUserId = delegateEntry === null ? '' : formId(delegateEntry);
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
    if (delegateUserId === null) {
      return fail(400, { error: 'Choose a valid initial delegate from the results list' });
    }
    if (delegateUserId && !permissions) {
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
      delegateUserId
        ? getEligibleMailboxAssignee(env.DB, mailDomain, delegateUserId)
        : Promise.resolve(null),
    ]);
    if (existing) return fail(409, { error: 'That mailbox address is already in use' });
    if (delegateUserId && !delegate) return fail(409, { error: 'Choose an active or pending account with an active personal mailbox' });

    const mailboxId = generateId();
    try {
      const statements = [
        delegate
          ? env.DB.prepare(
            `INSERT INTO mailboxes (id, address, display_name, type, status, created_at)
             SELECT ?, ?, ?, 'shared', 'active', datetime('now')
             WHERE ${ELIGIBLE_MAILBOX_ASSIGNEE_EXISTS_SQL}`,
          ).bind(mailboxId, address, displayName, mailDomain, delegate.userId)
          : env.DB.prepare(
            `INSERT INTO mailboxes (id, address, display_name, type, status, created_at)
             VALUES (?, ?, ?, 'shared', 'active', datetime('now'))`,
          ).bind(mailboxId, address, displayName),
      ];
      if (delegate && permissions) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO mailbox_assignments
               (user_id, mailbox_id, permissions, assigned_at, assigned_by)
             SELECT ?, ?, ?, datetime('now'), ?
             WHERE ${ELIGIBLE_MAILBOX_ASSIGNEE_EXISTS_SQL}`,
          ).bind(delegate.userId, mailboxId, permissions, locals.user!.id, mailDomain, delegate.userId),
        );
      }
      const results = await env.DB.batch(statements);
      if (results.some((result) => !result.meta.changes)) {
        return fail(409, { error: 'The selected account changed; refresh and choose an eligible personal mailbox' });
      }
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
        detail: `Granted ${permissions} access to account ${delegate.userId}`,
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
    const userId = formId(data.get('user_id'));
    const rawPermissions = data.get('permissions');
    const permissions = typeof rawPermissions === 'string' && (MAILBOX_PERMISSIONS as readonly string[]).includes(rawPermissions)
      ? rawPermissions as MailboxAssignment['permissions']
      : null;
    if (!mailboxAddress || !userId || !permissions) {
      return fail(400, { error: 'Choose an active or pending account with an active personal mailbox and a valid access level' });
    }

    const [mailbox, user, existingAssignment] = await Promise.all([
      env.DB.prepare('SELECT id, type FROM mailboxes WHERE lower(address) = ?')
        .bind(mailboxAddress).first<Pick<Mailbox, 'id' | 'type'>>(),
      getEligibleMailboxAssignee(env.DB, normalizeDomain(env.MAIL_DOMAIN) || '__invalid__', userId),
      env.DB.prepare(
        `SELECT ma.permissions
         FROM mailbox_assignments ma
         INNER JOIN mailboxes m ON m.id = ma.mailbox_id
         WHERE lower(m.address) = ? AND ma.user_id = ?`,
      ).bind(mailboxAddress, userId).first<Pick<MailboxAssignment, 'permissions'>>(),
    ]);
    if (!mailbox) return fail(404, { error: 'Mailbox not found' });
    if (!user) return fail(409, { error: 'Choose an active or pending account with an active personal mailbox' });
    if (mailbox.type === 'personal') {
      return fail(400, { error: 'Personal mailbox ownership is managed from People and cannot be delegated' });
    }
    if (existingAssignment?.permissions === permissions) {
      // This is intentionally read-only. Lifecycle cleanup remains
      // authoritative if the account changes after the eligibility read.
      return { success: `${mailboxPermissionLabel(permissions)} is already assigned to this account` };
    }

    try {
      const result = await env.DB.prepare(
        `INSERT INTO mailbox_assignments
           (user_id, mailbox_id, permissions, assigned_at, assigned_by)
         SELECT ?, m.id, ?, datetime('now'), ?
         FROM mailboxes m
         WHERE m.id = ? AND m.type = 'shared'
           AND ${ELIGIBLE_MAILBOX_ASSIGNEE_EXISTS_SQL}
         ON CONFLICT(user_id, mailbox_id) DO UPDATE SET
           permissions = excluded.permissions,
           assigned_at = excluded.assigned_at,
           assigned_by = excluded.assigned_by`,
      ).bind(
        user.userId,
        permissions,
        locals.user!.id,
        mailbox.id,
        normalizeDomain(env.MAIL_DOMAIN) || '__invalid__',
        user.userId,
      ).run();
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
        ? `Changed account ${user.userId} from ${existingAssignment.permissions} to ${permissions} access`
        : `Granted ${permissions} access to account ${user.userId}`,
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
    if (assignment.type === 'personal') {
      return fail(400, { error: 'Personal mailbox ownership is managed from People and cannot be removed here' });
    }

    try {
      const result = await env.DB.prepare(
        `DELETE FROM mailbox_assignments
         WHERE mailbox_id = ? AND user_id = ?
           AND EXISTS (SELECT 1 FROM mailboxes m WHERE m.id = ? AND m.type = 'shared')`,
      ).bind(mailboxId, userId, mailboxId).run();
      if (!result.meta.changes) {
        return fail(409, { error: 'The mailbox assignment changed; refresh and try again' });
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
               AND ma.user_id = mailboxes.owner_user_id
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
