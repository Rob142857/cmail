import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import type { Mailbox } from '@cmail/shared/types';
import { getEnabledProviders, isAuthProvider } from '$lib/server/auth';
import { BOOTSTRAP_PROOF_COOKIE } from '$lib/server/bootstrap';
import { ENROLLMENT_COOKIE } from '$lib/server/identity';
import { PROVIDER_PREFERENCE_COOKIE } from '$lib/server/provider-preference';

export const load: LayoutServerLoad = async ({ locals, platform, cookies, request, url, isDataRequest, setHeaders }) => {
  const env = platform?.env;
  if (!locals.user) {
    setHeaders({ 'Cache-Control': 'no-store', Vary: 'Cookie' });
    const provider = cookies.get(PROVIDER_PREFERENCE_COOKIE);
    // Only direct mailbox entry may resume a previous provider. OAuth errors
    // and logout land on /, which always keeps the normal chooser available.
    if (env && request.method === 'GET' && url.pathname === '/mail' && !isDataRequest
      && provider && isAuthProvider(provider)
      && !cookies.get(ENROLLMENT_COOKIE) && !cookies.get(BOOTSTRAP_PROOF_COOKIE)
      && getEnabledProviders(env as unknown as Record<string, string | undefined>).includes(provider)) {
      throw redirect(303, `/auth/login/${provider}?sso=1`);
    }
    throw redirect(302, '/');
  }

  if (!env) throw redirect(302, '/');

  // Per-mailbox unread counts (inbox folder)
  const userMailboxes = await env.DB.prepare(
    `SELECT m.id, m.address, m.type, m.display_name, m.status, ma.permissions,
            (SELECT COUNT(*) FROM messages WHERE mailbox_id = m.id AND folder = 'inbox' AND is_read = 0) as unread_count
     FROM mailboxes m
     INNER JOIN mailbox_assignments ma ON m.id = ma.mailbox_id
     WHERE ma.user_id = ? AND m.status = 'active'
     ORDER BY CASE m.type WHEN 'personal' THEN 0 ELSE 1 END, m.address ASC`,
  ).bind(locals.user.id).all<Mailbox & { unread_count: number; permissions: string }>();

  const mailboxes = userMailboxes.results || [];
  const totalUnread = mailboxes.reduce((sum, m) => sum + (m.unread_count || 0), 0);

  return {
    user: locals.user,
    mailboxes,
    totalUnread,
  };
};
