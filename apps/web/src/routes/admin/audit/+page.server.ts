import type { PageServerLoad } from './$types';
import type { AuditRecord } from '@cmail/shared/types';

export const load: PageServerLoad = async ({ platform, url }) => {
  const env = platform?.env;
  if (!env) return { entries: [] };

  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const eventType = url.searchParams.get('event_type');
  const pageSize = 100;
  const offset = (page - 1) * pageSize;

  let entries;
  if (eventType) {
    entries = await env.DB.prepare(
      'SELECT * FROM audit_log WHERE event_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    ).bind(eventType, pageSize, offset).all<AuditRecord>();
  } else {
    entries = await env.DB.prepare(
      'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?',
    ).bind(pageSize, offset).all<AuditRecord>();
  }

  return {
    entries: entries.results || [],
    page,
    eventType: eventType || '',
  };
};
