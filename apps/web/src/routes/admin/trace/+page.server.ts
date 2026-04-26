import type { PageServerLoad } from './$types';
import type { MailTrace } from '@cmail/shared/types';

export const load: PageServerLoad = async ({ platform, url }) => {
  const env = platform?.env;
  if (!env) return { traces: [] };

  const search = url.searchParams.get('q');
  const direction = url.searchParams.get('direction');
  const page = parseInt(url.searchParams.get('page') || '1', 10);

  // ✅ Validate page number
  if (page < 1 || page > 10000) return { traces: [], search, direction, page: 1, error: 'Invalid page number' };

  const pageSize = 100;
  const offset = (page - 1) * pageSize;

  try {
    let traces;
    if (search) {
      // ✅ Parameterized query prevents SQL injection
      const term = `%${search}%`;
      traces = await env.DB.prepare(
        'SELECT * FROM mail_trace WHERE envelope_from LIKE ? OR envelope_to LIKE ? OR subject LIKE ? OR message_id_header LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      ).bind(term, term, term, term, pageSize, offset).all();
    } else if (direction) {
      // ✅ Validate direction enum
      if (!['inbound', 'outbound'].includes(direction)) {
        return { traces: [], search, direction, page, error: 'Invalid direction' };
      }
      traces = await env.DB.prepare(
        'SELECT * FROM mail_trace WHERE direction = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      ).bind(direction, pageSize, offset).all();
    } else {
      traces = await env.DB.prepare(
        'SELECT * FROM mail_trace ORDER BY created_at DESC LIMIT ? OFFSET ?',
      ).bind(pageSize, offset).all();
    }

    return {
      traces: traces.results || [],
      search: search || '',
      direction: direction || '',
      page,
    };
  } catch (e) {
    console.error('Failed to load mail traces:', e);
    return { traces: [], search, direction, page, error: `Failed to load traces: ${(e as Error).message}` };
  }
};
