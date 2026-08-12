import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchEligibleMailboxAssignees } from '$lib/server/mailbox-assignees';
import { normalizeDomain } from '$lib/server/validation';

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

export const GET: RequestHandler = async ({ locals, platform, url }) => {
  if (!locals.user) {
    return json({ error: 'Authentication required' }, { status: 401, headers: PRIVATE_NO_STORE });
  }
  if (locals.user.role !== 'manager') {
    return json({ error: 'Manager role required' }, { status: 403, headers: PRIVATE_NO_STORE });
  }

  const env = platform?.env;
  const mailDomain = normalizeDomain(env?.MAIL_DOMAIN);
  if (!env?.DB || !mailDomain) {
    return json({ error: 'Mailbox configuration is unavailable' }, { status: 503, headers: PRIVATE_NO_STORE });
  }

  const rawQuery = url.searchParams.get('q') || '';
  const query = rawQuery.trim();
  if (!query || query.length > 100) {
    return json(
      { error: 'Search text must contain between 1 and 100 characters' },
      { status: 400, headers: PRIVATE_NO_STORE },
    );
  }

  const assignees = await searchEligibleMailboxAssignees(env.DB, mailDomain, query, 8);
  return json(assignees, { headers: PRIVATE_NO_STORE });
};
