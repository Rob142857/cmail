import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { audit, generateId } from '$lib/server/db';
import {
  ELIGIBLE_MAILBOX_ASSIGNEE_EXISTS_SQL,
  getEligibleMailboxAssignee,
} from '$lib/server/mailbox-assignees';
import { isAddressAtDomain, normalizeDomain, normalizeEmail } from '$lib/server/validation';

const ID_RX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const LOCAL_PART_RX = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const INVALID_SINGLE_LINE_RX = /[\u0000-\u001f\u007f]/;
const INVALID_MULTILINE_RX = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const PERMISSIONS = ['read', 'send-as', 'full'] as const;
const MAX_SORT_ORDER = 100_000;

type Visibility = 'internal' | 'public';
type ManagerLocals = App.Locals & { user: NonNullable<App.Locals['user']> };

interface OrganizationLayer {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

interface OrganizationUnit {
  id: string;
  layer_id: string;
  parent_id: string | null;
  name: string;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

interface OrganizationRole {
  id: string;
  title: string;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

interface OrganizationPosition {
  id: string;
  unit_id: string;
  role_id: string;
  user_id: string | null;
  title_override: string;
  occupant_display_name: string;
  work_email: string;
  visibility: Visibility;
  sort_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

interface PositionInput {
  unitId: string;
  roleId: string;
  userId: string;
  titleOverride: string;
  occupantDisplayName: string;
  workEmail: string;
  visibility: Visibility;
  sortOrder: number;
}

function requireManager(locals: App.Locals): asserts locals is ManagerLocals {
  if (!locals.user || locals.user.role !== 'manager') {
    throw error(403, 'Manager role required');
  }
}

function requireEnvironment(platform: App.Platform | undefined): App.Platform['env'] {
  if (!platform?.env) throw error(503, 'Platform not available');
  return platform.env;
}

function formText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function formDescription(data: FormData): string {
  return formText(data, 'description').replace(/\r\n?/g, '\n');
}

function validId(value: string, optional = false): boolean {
  return optional && !value ? true : ID_RX.test(value);
}

function validSingleLine(value: string, maxLength: number, required = true): boolean {
  if (required && !value) return false;
  return value.length <= maxLength && !INVALID_SINGLE_LINE_RX.test(value);
}

function validDescription(value: string): boolean {
  return value.length <= 2000 && !INVALID_MULTILINE_RX.test(value);
}

function parseSortOrder(data: FormData): number | null {
  const raw = formText(data, 'sort_order');
  if (!raw) return 0;
  if (!/^-?\d{1,6}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && Math.abs(value) <= MAX_SORT_ORDER ? value : null;
}

function parseVisibility(data: FormData): Visibility {
  const value = formText(data, 'visibility');
  return value === 'public' ? 'public' : 'internal';
}

function parseEnabled(data: FormData): boolean {
  return ['1', 'true', 'on', 'yes'].includes(formText(data, 'enabled').toLowerCase());
}

function changes(result: D1Result): number {
  return Number(result.meta?.changes || 0);
}

function isConstraintError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /constraint|unique|foreign key/i.test(message);
}

async function auditOrganization(
  db: D1Database,
  locals: ManagerLocals,
  eventType: string,
  target: string,
  detail: string,
): Promise<void> {
  await audit(db, {
    event_type: eventType,
    actor_id: locals.user.id,
    actor_role: 'manager',
    target,
    detail,
    session_id: locals.sessionId,
  });
}

async function organizationData(db: D1Database): Promise<{
  directoryEnabled: boolean;
  layers: OrganizationLayer[];
  units: OrganizationUnit[];
  roles: OrganizationRole[];
  positions: OrganizationPosition[];
}> {
  try {
    const [settings, layers, units, roles, positions] = await Promise.all([
      db.prepare(
        'SELECT enabled FROM organization_directory_settings WHERE singleton_id = 1',
      ).first<{ enabled: number }>(),
      db.prepare(
        `SELECT id, name, description, sort_order, created_at, updated_at, updated_by
         FROM organization_layers ORDER BY sort_order, name, id`,
      ).all<OrganizationLayer>(),
      db.prepare(
        `SELECT id, layer_id, parent_id, name, description, sort_order, created_at, updated_at, updated_by
         FROM organization_units ORDER BY sort_order, name, id`,
      ).all<OrganizationUnit>(),
      db.prepare(
        `SELECT id, title, description, sort_order, created_at, updated_at, updated_by
         FROM organization_roles ORDER BY sort_order, title, id`,
      ).all<OrganizationRole>(),
      db.prepare(
        `SELECT id, unit_id, role_id, user_id, title_override, occupant_display_name,
                work_email, visibility, sort_order, created_at, updated_at, updated_by
         FROM organization_positions ORDER BY sort_order, id`,
      ).all<OrganizationPosition>(),
    ]);

    return {
      directoryEnabled: settings?.enabled === 1,
      layers: layers.results || [],
      units: units.results || [],
      roles: roles.results || [],
      positions: positions.results || [],
    };
  } catch (cause) {
    // This makes a code-first deployment safe while migration 0003 is still
    // being applied. Mutations continue to fail closed until the migration runs.
    console.warn('Organisation tables are not available yet:', cause instanceof Error ? cause.message : 'unknown error');
    return { directoryEnabled: false, layers: [], units: [], roles: [], positions: [] };
  }
}

async function duplicateLayerName(db: D1Database, name: string, exceptId = ''): Promise<boolean> {
  const row = await db.prepare(
    `SELECT id FROM organization_layers
     WHERE name = ? COLLATE NOCASE AND (? = '' OR id <> ?) LIMIT 1`,
  ).bind(name, exceptId, exceptId).first();
  return !!row;
}

async function duplicateRoleTitle(db: D1Database, title: string, exceptId = ''): Promise<boolean> {
  const row = await db.prepare(
    `SELECT id FROM organization_roles
     WHERE title = ? COLLATE NOCASE AND (? = '' OR id <> ?) LIMIT 1`,
  ).bind(title, exceptId, exceptId).first();
  return !!row;
}

async function duplicateUnitName(
  db: D1Database,
  name: string,
  parentId: string,
  exceptId = '',
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT id FROM organization_units
     WHERE name = ? COLLATE NOCASE
       AND ((parent_id IS NULL AND ? = '') OR parent_id = ?)
       AND (? = '' OR id <> ?)
     LIMIT 1`,
  ).bind(name, parentId, parentId, exceptId, exceptId).first();
  return !!row;
}

async function unitWouldCycle(db: D1Database, unitId: string, parentId: string): Promise<boolean> {
  if (!parentId) return false;
  if (unitId === parentId) return true;
  const row = await db.prepare(
    `WITH RECURSIVE descendants(id) AS (
       SELECT id FROM organization_units WHERE parent_id = ?
       UNION
       SELECT child.id
       FROM organization_units child
       INNER JOIN descendants d ON child.parent_id = d.id
     )
     SELECT id FROM descendants WHERE id = ? LIMIT 1`,
  ).bind(unitId, parentId).first();
  return !!row;
}

async function validateUnitReferences(
  db: D1Database,
  layerId: string,
  parentId: string,
  unitId = '',
): Promise<string | null> {
  const layer = await db.prepare('SELECT id FROM organization_layers WHERE id = ?').bind(layerId).first();
  if (!layer) return 'Layer not found';

  if (parentId) {
    const parent = await db.prepare('SELECT id FROM organization_units WHERE id = ?').bind(parentId).first();
    if (!parent) return 'Parent unit not found';
    if (unitId && await unitWouldCycle(db, unitId, parentId)) {
      return 'A unit cannot be moved beneath itself or one of its descendants';
    }
  }
  return null;
}

function parsePositionInput(data: FormData): PositionInput | null {
  const unitId = formText(data, 'unit_id');
  const roleId = formText(data, 'role_id');
  const userId = formText(data, 'user_id');
  const titleOverride = formText(data, 'title_override');
  const occupantDisplayName = formText(data, 'occupant_display_name');
  const rawWorkEmail = formText(data, 'work_email');
  const normalizedWorkEmail = rawWorkEmail ? normalizeEmail(rawWorkEmail) : null;
  const sortOrder = parseSortOrder(data);

  if (!validId(unitId) || !validId(roleId) || !validId(userId, true)) return null;
  if (!validSingleLine(titleOverride, 120, false)) return null;
  if (!validSingleLine(occupantDisplayName, 120, false)) return null;
  if (rawWorkEmail && !normalizedWorkEmail) return null;
  if (sortOrder === null) return null;

  return {
    unitId,
    roleId,
    userId,
    titleOverride,
    occupantDisplayName,
    workEmail: normalizedWorkEmail || '',
    visibility: parseVisibility(data),
    sortOrder,
  };
}

async function validatePositionReferences(
  db: D1Database,
  mailDomain: string,
  input: PositionInput,
  retainedPosition?: { user_id: string | null; work_email: string },
): Promise<string | null> {
  const [unit, role] = await Promise.all([
    db.prepare('SELECT id FROM organization_units WHERE id = ?').bind(input.unitId).first(),
    db.prepare('SELECT id FROM organization_roles WHERE id = ?').bind(input.roleId).first(),
  ]);
  if (!unit) return 'Organisational unit not found';
  if (!role) return 'Role definition not found';

  if (!input.userId) {
    if (input.visibility === 'public') return 'A public position must have an assigned user';
    if (input.workEmail) return 'Assign a user before selecting a work email';
    return null;
  }

  const user = await db.prepare(
    `SELECT id, status FROM users
     WHERE id = ? AND status IN ('active', 'pending')`,
  ).bind(input.userId).first<{ id: string; status: string }>();
  if (!user) {
    const retainingHistoricalLink = input.visibility === 'internal'
      && retainedPosition?.user_id === input.userId
      && (input.workEmail === retainedPosition.work_email || !input.workEmail);
    return retainingHistoricalLink
      ? null
      : 'Choose an active or pending user with an eligible personal mailbox';
  }

  if (input.workEmail) {
    const domain = normalizeDomain(mailDomain);
    if (!domain || !isAddressAtDomain(input.workEmail, domain)) {
      return 'Work email must use the configured MAIL_DOMAIN';
    }
    const assignedMailbox = await db.prepare(
      `SELECT m.id
       FROM mailboxes m
       INNER JOIN mailbox_assignments ma ON ma.mailbox_id = m.id
       WHERE m.address = ? COLLATE NOCASE AND m.status = 'active' AND ma.user_id = ?
       LIMIT 1`,
    ).bind(input.workEmail, input.userId).first();
    if (!assignedMailbox) return 'Work email must be an active mailbox assigned to this user';
  }

  if (input.visibility === 'public') {
    if (user.status !== 'active') return 'Only active users can appear in the public directory';
    if (!input.workEmail) return 'A public position requires an assigned work email';
    if (!validSingleLine(input.occupantDisplayName, 120)) {
      return 'A public position requires an occupant display name';
    }
  }
  return null;
}

export const load: PageServerLoad = async ({ locals, platform }) => {
  requireManager(locals);
  const env = requireEnvironment(platform);

  const [mailboxes, assignments, users, workMailboxes, organization] = await Promise.all([
    env.DB.prepare(
      `SELECT id, address, display_name, status
       FROM mailboxes WHERE type = 'shared' ORDER BY address`,
    ).all<{ id: string; address: string; display_name: string; status: string }>(),
    env.DB.prepare(
      `SELECT ma.mailbox_id, ma.user_id, ma.permissions, u.display_name,
              personal.address AS personal_mailbox_address
       FROM mailbox_assignments ma
       INNER JOIN users u ON u.id = ma.user_id
       INNER JOIN mailboxes m ON m.id = ma.mailbox_id
       LEFT JOIN mailboxes personal ON personal.owner_user_id = u.id
         AND personal.type = 'personal' AND personal.status = 'active'
       WHERE m.type = 'shared'
       ORDER BY u.display_name, personal.address, u.id`,
    ).all<{ mailbox_id: string; user_id: string; permissions: string; display_name: string; personal_mailbox_address: string | null }>(),
    env.DB.prepare(
      `SELECT u.id, u.display_name, u.status, m.address AS personal_mailbox_address
       FROM users u
       INNER JOIN mailboxes m ON m.owner_user_id = u.id
       WHERE u.status IN ('active', 'pending')
         AND m.type = 'personal' AND m.status = 'active'
         AND lower(substr(m.address, instr(m.address, '@') + 1)) = ?
       GROUP BY u.id
       HAVING COUNT(*) = 1
       ORDER BY u.display_name, m.address, u.id`,
    ).bind(normalizeDomain(env.MAIL_DOMAIN) || '__invalid__').all<{ id: string; display_name: string; status: string; personal_mailbox_address: string }>(),
    env.DB.prepare(
      `SELECT m.id, m.address, m.display_name, m.type, m.status, ma.user_id
       FROM mailboxes m
       INNER JOIN mailbox_assignments ma ON ma.mailbox_id = m.id
       WHERE m.status = 'active'
       ORDER BY m.address, ma.user_id`,
    ).all<{ id: string; address: string; display_name: string; type: string; status: string; user_id: string }>(),
    organizationData(env.DB),
  ]);

  return {
    mailboxes: mailboxes.results || [],
    assignments: assignments.results || [],
    users: users.results || [],
    workMailboxes: workMailboxes.results || [],
    mailDomain: normalizeDomain(env.MAIL_DOMAIN) || '',
    ...organization,
    organization,
  };
};

export const actions: Actions = {
  toggleDirectory: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const enabled = parseEnabled(data);

    await env.DB.prepare(
      `INSERT INTO organization_directory_settings (singleton_id, enabled, updated_at, updated_by)
       VALUES (1, ?, datetime('now'), ?)
       ON CONFLICT(singleton_id) DO UPDATE SET
         enabled = excluded.enabled,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    ).bind(enabled ? 1 : 0, locals.user.id).run();

    await auditOrganization(
      env.DB,
      locals,
      'organization.directory_toggled',
      'public-directory',
      enabled ? 'Enabled public organisation directory' : 'Disabled public organisation directory',
    );
    return { success: enabled ? 'Public directory enabled' : 'Public directory disabled', directoryEnabled: enabled };
  },

  createLayer: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const name = formText(data, 'name');
    const description = formDescription(data);
    const sortOrder = parseSortOrder(data);
    if (!validSingleLine(name, 120) || !validDescription(description) || sortOrder === null) {
      return fail(400, { error: 'Enter a valid layer name, description, and sort order' });
    }
    if (await duplicateLayerName(env.DB, name)) return fail(409, { error: 'A layer with that name already exists' });

    const id = generateId();
    try {
      await env.DB.prepare(
        `INSERT INTO organization_layers
           (id, name, description, sort_order, created_at, updated_at, updated_by)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
      ).bind(id, name, description, sortOrder, locals.user.id).run();
    } catch (cause) {
      if (isConstraintError(cause)) return fail(409, { error: 'A layer with that name already exists' });
      throw cause;
    }
    await auditOrganization(env.DB, locals, 'organization.layer_created', id, `Created layer ${name}`);
    return { success: 'Layer created', layerId: id };
  },

  updateLayer: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const id = formText(data, 'layer_id');
    const name = formText(data, 'name');
    const description = formDescription(data);
    const sortOrder = parseSortOrder(data);
    if (!validId(id) || !validSingleLine(name, 120) || !validDescription(description) || sortOrder === null) {
      return fail(400, { error: 'Invalid layer update' });
    }
    if (await duplicateLayerName(env.DB, name, id)) return fail(409, { error: 'A layer with that name already exists' });

    try {
      const result = await env.DB.prepare(
        `UPDATE organization_layers
         SET name = ?, description = ?, sort_order = ?, updated_at = datetime('now'), updated_by = ?
         WHERE id = ?`,
      ).bind(name, description, sortOrder, locals.user.id, id).run();
      if (!changes(result)) return fail(404, { error: 'Layer not found' });
    } catch (cause) {
      if (isConstraintError(cause)) return fail(409, { error: 'A layer with that name already exists' });
      throw cause;
    }
    await auditOrganization(env.DB, locals, 'organization.layer_updated', id, `Updated layer ${name}`);
    return { success: 'Layer updated' };
  },

  deleteLayer: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const id = formText(data, 'layer_id');
    if (!validId(id)) return fail(400, { error: 'Invalid layer' });
    const usage = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM organization_units WHERE layer_id = ?',
    ).bind(id).first<{ count: number }>();
    if ((usage?.count || 0) > 0) return fail(409, { error: 'Move or delete units in this layer first' });
    try {
      const result = await env.DB.prepare('DELETE FROM organization_layers WHERE id = ?').bind(id).run();
      if (!changes(result)) return fail(404, { error: 'Layer not found' });
    } catch (cause) {
      if (isConstraintError(cause)) return fail(409, { error: 'Move or delete units in this layer first' });
      throw cause;
    }
    await auditOrganization(env.DB, locals, 'organization.layer_deleted', id, 'Deleted organisation layer');
    return { success: 'Layer deleted' };
  },

  createUnit: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const name = formText(data, 'name');
    const description = formDescription(data);
    const layerId = formText(data, 'layer_id');
    const parentId = formText(data, 'parent_id');
    const sortOrder = parseSortOrder(data);
    if (!validSingleLine(name, 120) || !validDescription(description) || !validId(layerId)
      || !validId(parentId, true) || sortOrder === null) {
      return fail(400, { error: 'Enter a valid unit name, layer, parent, and sort order' });
    }
    const referenceError = await validateUnitReferences(env.DB, layerId, parentId);
    if (referenceError) return fail(400, { error: referenceError });
    if (await duplicateUnitName(env.DB, name, parentId)) {
      return fail(409, { error: 'A unit with that name already exists under this parent' });
    }

    const id = generateId();
    try {
      await env.DB.prepare(
        `INSERT INTO organization_units
           (id, layer_id, parent_id, name, description, sort_order, created_at, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
      ).bind(id, layerId, parentId || null, name, description, sortOrder, locals.user.id).run();
    } catch (cause) {
      if (isConstraintError(cause)) return fail(409, { error: 'Unit conflicts with the current hierarchy' });
      throw cause;
    }
    await auditOrganization(env.DB, locals, 'organization.unit_created', id, `Created unit ${name}`);
    return { success: 'Unit created', unitId: id };
  },

  updateUnit: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const id = formText(data, 'unit_id');
    const name = formText(data, 'name');
    const description = formDescription(data);
    const layerId = formText(data, 'layer_id');
    const parentId = formText(data, 'parent_id');
    const sortOrder = parseSortOrder(data);
    if (!validId(id) || !validSingleLine(name, 120) || !validDescription(description)
      || !validId(layerId) || !validId(parentId, true) || sortOrder === null) {
      return fail(400, { error: 'Invalid unit update' });
    }
    const existing = await env.DB.prepare('SELECT id FROM organization_units WHERE id = ?').bind(id).first();
    if (!existing) return fail(404, { error: 'Unit not found' });
    const referenceError = await validateUnitReferences(env.DB, layerId, parentId, id);
    if (referenceError) return fail(400, { error: referenceError });
    if (await duplicateUnitName(env.DB, name, parentId, id)) {
      return fail(409, { error: 'A unit with that name already exists under this parent' });
    }

    try {
      const result = await env.DB.prepare(
        `UPDATE organization_units
         SET layer_id = ?, parent_id = ?, name = ?, description = ?, sort_order = ?,
             updated_at = datetime('now'), updated_by = ?
         WHERE id = ?`,
      ).bind(layerId, parentId || null, name, description, sortOrder, locals.user.id, id).run();
      if (!changes(result)) return fail(404, { error: 'Unit not found' });
    } catch (cause) {
      if (isConstraintError(cause)) return fail(409, { error: 'Unit conflicts with the current hierarchy' });
      throw cause;
    }
    await auditOrganization(env.DB, locals, 'organization.unit_updated', id, `Updated unit ${name}`);
    return { success: 'Unit updated' };
  },

  deleteUnit: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const id = formText(data, 'unit_id');
    if (!validId(id)) return fail(400, { error: 'Invalid unit' });
    const [children, positions] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS count FROM organization_units WHERE parent_id = ?').bind(id).first<{ count: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM organization_positions WHERE unit_id = ?').bind(id).first<{ count: number }>(),
    ]);
    if ((children?.count || 0) > 0) return fail(409, { error: 'Move or delete child units first' });
    if ((positions?.count || 0) > 0) return fail(409, { error: 'Move or delete positions in this unit first' });
    try {
      const result = await env.DB.prepare('DELETE FROM organization_units WHERE id = ?').bind(id).run();
      if (!changes(result)) return fail(404, { error: 'Unit not found' });
    } catch (cause) {
      if (isConstraintError(cause)) return fail(409, { error: 'Move or delete child units and positions first' });
      throw cause;
    }
    await auditOrganization(env.DB, locals, 'organization.unit_deleted', id, 'Deleted organisational unit');
    return { success: 'Unit deleted' };
  },

  createRole: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const title = formText(data, 'title');
    const description = formDescription(data);
    const sortOrder = parseSortOrder(data);
    if (!validSingleLine(title, 120) || !validDescription(description) || sortOrder === null) {
      return fail(400, { error: 'Enter a valid role title, description, and sort order' });
    }
    if (await duplicateRoleTitle(env.DB, title)) return fail(409, { error: 'A role with that title already exists' });

    const id = generateId();
    try {
      await env.DB.prepare(
        `INSERT INTO organization_roles
           (id, title, description, sort_order, created_at, updated_at, updated_by)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
      ).bind(id, title, description, sortOrder, locals.user.id).run();
    } catch (cause) {
      if (isConstraintError(cause)) return fail(409, { error: 'A role with that title already exists' });
      throw cause;
    }
    await auditOrganization(env.DB, locals, 'organization.role_created', id, `Created role ${title}`);
    return { success: 'Role created', roleId: id };
  },

  updateRole: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const id = formText(data, 'role_id');
    const title = formText(data, 'title');
    const description = formDescription(data);
    const sortOrder = parseSortOrder(data);
    if (!validId(id) || !validSingleLine(title, 120) || !validDescription(description) || sortOrder === null) {
      return fail(400, { error: 'Invalid role update' });
    }
    if (await duplicateRoleTitle(env.DB, title, id)) return fail(409, { error: 'A role with that title already exists' });
    try {
      const result = await env.DB.prepare(
        `UPDATE organization_roles
         SET title = ?, description = ?, sort_order = ?, updated_at = datetime('now'), updated_by = ?
         WHERE id = ?`,
      ).bind(title, description, sortOrder, locals.user.id, id).run();
      if (!changes(result)) return fail(404, { error: 'Role not found' });
    } catch (cause) {
      if (isConstraintError(cause)) return fail(409, { error: 'A role with that title already exists' });
      throw cause;
    }
    await auditOrganization(env.DB, locals, 'organization.role_updated', id, `Updated role ${title}`);
    return { success: 'Role updated' };
  },

  deleteRole: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const id = formText(data, 'role_id');
    if (!validId(id)) return fail(400, { error: 'Invalid role' });
    const usage = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM organization_positions WHERE role_id = ?',
    ).bind(id).first<{ count: number }>();
    if ((usage?.count || 0) > 0) return fail(409, { error: 'Move or delete positions using this role first' });
    try {
      const result = await env.DB.prepare('DELETE FROM organization_roles WHERE id = ?').bind(id).run();
      if (!changes(result)) return fail(404, { error: 'Role not found' });
    } catch (cause) {
      if (isConstraintError(cause)) return fail(409, { error: 'Move or delete positions using this role first' });
      throw cause;
    }
    await auditOrganization(env.DB, locals, 'organization.role_deleted', id, 'Deleted role definition');
    return { success: 'Role deleted' };
  },

  createPosition: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const input = parsePositionInput(data);
    if (!input) return fail(400, { error: 'Enter valid position details' });
    const referenceError = await validatePositionReferences(env.DB, env.MAIL_DOMAIN, input);
    if (referenceError) return fail(400, { error: referenceError });

    const id = generateId();
    try {
      await env.DB.prepare(
        `INSERT INTO organization_positions
           (id, unit_id, role_id, user_id, title_override, occupant_display_name, work_email,
            visibility, sort_order, created_at, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
      ).bind(
        id,
        input.unitId,
        input.roleId,
        input.userId || null,
        input.titleOverride,
        input.occupantDisplayName,
        input.workEmail,
        input.visibility,
        input.sortOrder,
        locals.user.id,
      ).run();
    } catch (cause) {
      if (isConstraintError(cause)) return fail(409, { error: 'Position conflicts with current organisation data' });
      throw cause;
    }
    await auditOrganization(
      env.DB,
      locals,
      'organization.position_created',
      id,
      `Created ${input.visibility} position`,
    );
    return { success: 'Position created', positionId: id };
  },

  updatePosition: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const id = formText(data, 'position_id');
    const input = parsePositionInput(data);
    if (!validId(id) || !input) return fail(400, { error: 'Invalid position update' });
    const existing = await env.DB.prepare(
      'SELECT id, user_id, work_email FROM organization_positions WHERE id = ?',
    ).bind(id).first<{ id: string; user_id: string | null; work_email: string }>();
    if (!existing) return fail(404, { error: 'Position not found' });
    const referenceError = await validatePositionReferences(env.DB, env.MAIL_DOMAIN, input, existing);
    if (referenceError) return fail(400, { error: referenceError });

    try {
      const result = await env.DB.prepare(
        `UPDATE organization_positions
         SET unit_id = ?, role_id = ?, user_id = ?, title_override = ?, occupant_display_name = ?,
             work_email = ?, visibility = ?, sort_order = ?, updated_at = datetime('now'), updated_by = ?
         WHERE id = ?`,
      ).bind(
        input.unitId,
        input.roleId,
        input.userId || null,
        input.titleOverride,
        input.occupantDisplayName,
        input.workEmail,
        input.visibility,
        input.sortOrder,
        locals.user.id,
        id,
      ).run();
      if (!changes(result)) return fail(404, { error: 'Position not found' });
    } catch (cause) {
      if (isConstraintError(cause)) return fail(409, { error: 'Position conflicts with current organisation data' });
      throw cause;
    }
    await auditOrganization(
      env.DB,
      locals,
      'organization.position_updated',
      id,
      `Updated position visibility to ${input.visibility}`,
    );
    return { success: 'Position updated' };
  },

  deletePosition: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const id = formText(data, 'position_id');
    if (!validId(id)) return fail(400, { error: 'Invalid position' });
    const result = await env.DB.prepare('DELETE FROM organization_positions WHERE id = ?').bind(id).run();
    if (!changes(result)) return fail(404, { error: 'Position not found' });
    await auditOrganization(env.DB, locals, 'organization.position_deleted', id, 'Deleted organisation position');
    return { success: 'Position deleted' };
  },

  // Shared-mailbox actions are retained for backwards compatibility with the
  // earlier admin page. They are separate from organisation positions.
  updateName: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const mailboxId = formText(data, 'mailbox_id');
    const displayName = formText(data, 'display_name');
    if (!validId(mailboxId) || !validSingleLine(displayName, 120, false)) {
      return fail(400, { error: 'Invalid mailbox name' });
    }
    const result = await env.DB.prepare(
      `UPDATE mailboxes SET display_name = ? WHERE id = ? AND type = 'shared'`,
    ).bind(displayName, mailboxId).run();
    if (!changes(result)) return fail(404, { error: 'Mailbox not found' });
    await auditOrganization(env.DB, locals, 'mailbox.updated', mailboxId, 'Updated shared mailbox display name');
    return { success: 'Mailbox name updated' };
  },

  assign: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    let mailboxId = formText(data, 'mailbox_id');
    const userId = formText(data, 'user_id');
    const localPart = formText(data, 'local_part').toLowerCase();
    const displayName = formText(data, 'display_name');
    const permission = formText(data, 'permissions') || 'read';
    if (!validId(userId) || !(PERMISSIONS as readonly string[]).includes(permission)) {
      return fail(400, { error: 'Select a user and valid permission level' });
    }
    if (!validSingleLine(displayName, 120, false)) return fail(400, { error: 'Display name is too long' });

    const domain = normalizeDomain(env.MAIL_DOMAIN);
    if (!domain) return fail(503, { error: 'MAIL_DOMAIN is not configured' });
    const user = await getEligibleMailboxAssignee(env.DB, domain, userId);
    if (!user) return fail(409, { error: 'Choose an active or pending user with one active owned personal mailbox on the organisation domain' });

    let mailboxToCreate: { id: string; address: string; displayName: string } | null = null;
    if (!mailboxId) {
      if (!LOCAL_PART_RX.test(localPart)) {
        return fail(400, { error: 'Mailbox name must use letters, numbers, dots, underscores, or hyphens' });
      }
      const address = `${localPart}@${domain}`;
      const existing = await env.DB.prepare('SELECT id FROM mailboxes WHERE address = ?').bind(address).first<{ id: string }>();
      if (existing) {
        mailboxId = existing.id;
      } else {
        mailboxId = generateId();
        mailboxToCreate = { id: mailboxId, address, displayName: displayName || localPart };
      }
    }
    if (!validId(mailboxId)) return fail(400, { error: 'Invalid mailbox' });

    const mailbox = mailboxToCreate || await env.DB.prepare(
      `SELECT id, address FROM mailboxes WHERE id = ? AND type = 'shared' AND status = 'active'`,
    ).bind(mailboxId).first<{ id: string; address: string }>();
    if (!mailbox) return fail(404, { error: 'Shared mailbox not found or disabled' });

    const statements: D1PreparedStatement[] = [];
    if (mailboxToCreate) {
      // D1 batches are transactional. The mailbox and its first delegation use
      // the same mutation-time eligibility predicate, so an offboard or mailbox
      // disable before this batch leaves neither record behind.
      statements.push(env.DB.prepare(
        `INSERT INTO mailboxes (id, address, display_name, type, status, created_at)
         SELECT ?, ?, ?, 'shared', 'active', datetime('now')
         WHERE ${ELIGIBLE_MAILBOX_ASSIGNEE_EXISTS_SQL}`,
      ).bind(
        mailboxToCreate.id,
        mailboxToCreate.address,
        mailboxToCreate.displayName,
        domain,
        user.userId,
      ));
    }
    statements.push(env.DB.prepare(
      `INSERT INTO mailbox_assignments (mailbox_id, user_id, permissions, assigned_at, assigned_by)
       SELECT m.id, ?, ?, datetime('now'), ?
       FROM mailboxes m
       WHERE m.id = ? AND m.type = 'shared' AND m.status = 'active'
         AND ${ELIGIBLE_MAILBOX_ASSIGNEE_EXISTS_SQL}
       ON CONFLICT(user_id, mailbox_id) DO UPDATE SET
         permissions = excluded.permissions,
         assigned_at = excluded.assigned_at,
         assigned_by = excluded.assigned_by`,
    ).bind(user.userId, permission, locals.user.id, mailbox.id, domain, user.userId));

    try {
      const results = await env.DB.batch(statements);
      if (results.some((result) => !changes(result))) {
        return fail(409, { error: 'The user or mailbox changed; refresh and try again' });
      }
    } catch (cause) {
      if (isConstraintError(cause)) {
        return fail(409, { error: 'The mailbox or delegation conflicts with current data; refresh and try again' });
      }
      throw cause;
    }
    if (mailboxToCreate) {
      await auditOrganization(env.DB, locals, 'mailbox.created', mailbox.id, 'Created shared mailbox with initial delegation');
    }
    await auditOrganization(
      env.DB,
      locals,
      'mailbox.assigned',
      mailbox.address,
      `Assigned user ${user.userId} with ${permission} permission`,
    );
    return { success: `${user.mailboxAddress} assigned to ${mailbox.address}` };
  },

  unassign: async ({ request, platform, locals }) => {
    requireManager(locals);
    const env = requireEnvironment(platform);
    const data = await request.formData();
    const mailboxId = formText(data, 'mailbox_id');
    const userId = formText(data, 'user_id');
    if (!validId(mailboxId) || !validId(userId)) return fail(400, { error: 'Invalid assignment' });
    const result = await env.DB.prepare(
      `DELETE FROM mailbox_assignments
       WHERE mailbox_id = ? AND user_id = ?
         AND EXISTS (
           SELECT 1 FROM mailboxes
           WHERE id = ? AND type = 'shared'
         )`,
    ).bind(mailboxId, userId, mailboxId).run();
    if (!changes(result)) return fail(404, { error: 'Shared mailbox assignment not found' });
    await auditOrganization(env.DB, locals, 'mailbox.unassigned', mailboxId, `Removed user ${userId} from shared mailbox`);
    return { success: 'Assignment removed' };
  },
};
