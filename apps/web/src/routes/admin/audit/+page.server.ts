import type { PageServerLoad } from './$types';
import type { AuditRecord } from '@cmail/shared/types';

type AuditRow = AuditRecord & { actor_email?: string; actor_display_name?: string };

export const load: PageServerLoad = async ({ platform, url }) => {
  const env = platform?.env;
  if (!env) return { entries: [], page: 1, eventType: '', eventTypes: [] };

  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const eventType = url.searchParams.get('event_type');
  const pageSize = 100;
  const offset = (page - 1) * pageSize;

  const baseSelect = `SELECT a.*, u.email AS actor_email, u.display_name AS actor_display_name
                      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id`;

  let entries;
  if (eventType) {
    entries = await env.DB.prepare(
      `${baseSelect} WHERE a.event_type = ? ORDER BY a.timestamp DESC LIMIT ? OFFSET ?`,
    ).bind(eventType, pageSize, offset).all<AuditRow>();
  } else {
    entries = await env.DB.prepare(
      `${baseSelect} ORDER BY a.timestamp DESC LIMIT ? OFFSET ?`,
    ).bind(pageSize, offset).all<AuditRow>();
  }

  // Distinct event types for filter dropdown (live from data, not hardcoded)
  const eventTypesRow = await env.DB.prepare(
    'SELECT DISTINCT event_type FROM audit_log ORDER BY event_type ASC',
  ).all<{ event_type: string }>();

  return {
    entries: entries.results || [],
    page,
    eventType: eventType || '',
    eventTypes: (eventTypesRow.results || []).map(r => r.event_type),
  };
};
