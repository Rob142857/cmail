import type { PageServerLoad } from './$types';
import type { MailTrace } from '@cmail/shared/types';

export const load: PageServerLoad = async ({ platform, url }) => {
  const env = platform?.env;
  if (!env) return { traces: [] };

  const search = url.searchParams.get('q');
  const direction = url.searchParams.get('direction');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSize = 100;
  const offset = (page - 1) * pageSize;

  let traces;
  if (search) {
    const term = `%${search}%`;
    traces = await env.DB.prepare(
      'SELECT * FROM mail_trace WHERE envelope_from LIKE ? OR envelope_to LIKE ? OR subject LIKE ? OR message_id_header LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    ).bind(term, term, term, term, pageSize, offset).all<MailTrace>();
  } else if (direction) {
    traces = await env.DB.prepare(
      'SELECT * FROM mail_trace WHERE direction = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    ).bind(direction, pageSize, offset).all<MailTrace>();
  } else {
    traces = await env.DB.prepare(
      'SELECT * FROM mail_trace ORDER BY created_at DESC LIMIT ? OFFSET ?',
    ).bind(pageSize, offset).all<MailTrace>();
  }

  return {
    traces: traces.results || [],
    search: search || '',
    direction: direction || '',
    page,
  };
};
