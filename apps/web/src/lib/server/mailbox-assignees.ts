import { escapeLike, normalizeDomain } from '$lib/server/validation';

export interface MailboxAssignee {
  userId: string;
  displayName: string;
  mailboxAddress: string;
}

interface MailboxAssigneeRow {
  user_id: string;
  display_name: string;
  mailbox_address: string;
}

const ELIGIBLE_ASSIGNEE_SELECT = `SELECT u.id AS user_id,
       u.display_name,
       personal.address AS mailbox_address
  FROM users u
  INNER JOIN mailboxes personal ON personal.owner_user_id = u.id
 WHERE u.status IN ('active', 'pending')
   AND personal.type = 'personal'
   AND personal.status = 'active'
   AND lower(substr(personal.address, instr(personal.address, '@') + 1)) = ?`;

/**
 * SQL used at mutation time to repeat the canonical assignee eligibility
 * check. The two placeholders are MAIL_DOMAIN and the immutable user id.
 */
export const ELIGIBLE_MAILBOX_ASSIGNEE_EXISTS_SQL = `EXISTS (
  ${ELIGIBLE_ASSIGNEE_SELECT}
   AND u.id = ?
 GROUP BY u.id
HAVING COUNT(*) = 1
)`;

function mapAssignee(row: MailboxAssigneeRow | null): MailboxAssignee | null {
  return row
    ? {
      userId: row.user_id,
      displayName: row.display_name,
      mailboxAddress: row.mailbox_address,
    }
    : null;
}

export async function getEligibleMailboxAssignee(
  db: D1Database,
  mailDomain: string,
  userId: string,
): Promise<MailboxAssignee | null> {
  const domain = normalizeDomain(mailDomain);
  if (!domain || !userId) return null;

  const row = await db.prepare(
    `${ELIGIBLE_ASSIGNEE_SELECT}
       AND u.id = ?
     GROUP BY u.id
    HAVING COUNT(*) = 1`,
  ).bind(domain, userId).first<MailboxAssigneeRow>();

  return mapAssignee(row);
}

export async function searchEligibleMailboxAssignees(
  db: D1Database,
  mailDomain: string,
  query: string,
  limit = 8,
): Promise<MailboxAssignee[]> {
  const domain = normalizeDomain(mailDomain);
  const normalizedQuery = query.trim().slice(0, 100).toLowerCase();
  if (!domain || !normalizedQuery) return [];

  const term = `%${escapeLike(normalizedQuery)}%`;
  const boundedLimit = Math.max(1, Math.min(8, Math.trunc(limit) || 8));
  const result = await db.prepare(
    `${ELIGIBLE_ASSIGNEE_SELECT}
       AND (
         lower(u.display_name) LIKE ? ESCAPE '\\'
         OR lower(personal.address) LIKE ? ESCAPE '\\'
       )
     GROUP BY u.id
    HAVING COUNT(*) = 1
     ORDER BY lower(u.display_name), lower(personal.address), u.id
     LIMIT ?`,
  ).bind(domain, term, term, boundedLimit).all<MailboxAssigneeRow>();

  return (result.results || []).map((row) => mapAssignee(row)!);
}
