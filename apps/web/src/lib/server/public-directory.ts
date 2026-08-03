import { normalizeDomain } from './validation';

export interface PublicDirectoryEntry {
  occupantDisplayName: string;
  workEmail: string;
  positionTitle: string;
}

export interface PublicDirectoryResult {
  enabled: boolean;
  entries: PublicDirectoryEntry[];
}

const EMPTY_RESULT: PublicDirectoryResult = { enabled: false, entries: [] };

export async function isPublicDirectoryEnabled(db: D1Database | undefined): Promise<boolean> {
  if (!db) return false;
  try {
    const row = await db.prepare(
      'SELECT enabled FROM organization_directory_settings WHERE singleton_id = 1',
    ).first<{ enabled: number }>();
    return row?.enabled === 1;
  } catch {
    return false;
  }
}

export async function loadPublicDirectory(
  db: D1Database | undefined,
  rawMailDomain: unknown,
): Promise<PublicDirectoryResult> {
  const mailDomain = normalizeDomain(rawMailDomain);
  if (!db || !mailDomain || !await isPublicDirectoryEnabled(db)) return EMPTY_RESULT;

  try {
    // Deliberately select only the approved public projection. Login addresses,
    // user IDs, unit names, hierarchy, and internal position metadata never
    // cross this boundary. Active account and mailbox eligibility are checked
    // again at read time so offboarding or unassignment fails closed.
    const result = await db.prepare(
      `SELECT
         substr(trim(p.occupant_display_name), 1, 120) AS occupantDisplayName,
         p.work_email AS workEmail,
         COALESCE(NULLIF(trim(p.title_override), ''), trim(r.title)) AS positionTitle
       FROM organization_positions p
       INNER JOIN organization_units ou ON ou.id = p.unit_id
       INNER JOIN organization_roles r ON r.id = p.role_id
       INNER JOIN users u ON u.id = p.user_id AND u.status = 'active'
       WHERE p.visibility = 'public'
         AND trim(p.work_email) <> ''
         AND lower(substr(p.work_email, instr(p.work_email, '@') + 1)) = ?
         AND trim(p.occupant_display_name) <> ''
         AND EXISTS (
           SELECT 1
           FROM mailbox_assignments ma
           INNER JOIN mailboxes m ON m.id = ma.mailbox_id
           WHERE ma.user_id = u.id
             AND m.status = 'active'
             AND m.address = p.work_email COLLATE NOCASE
         )
       ORDER BY p.sort_order, positionTitle, occupantDisplayName, p.id`,
    ).bind(mailDomain).all<PublicDirectoryEntry>();
    return { enabled: true, entries: result.results || [] };
  } catch {
    return EMPTY_RESULT;
  }
}
