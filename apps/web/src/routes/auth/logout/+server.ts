import type { RequestHandler } from './$types';
import { clearSessionCookie } from '$lib/server/session';
import { audit } from '$lib/server/db';
import { clearProviderPreferenceCookie } from '$lib/server/provider-preference';

export const POST: RequestHandler = async ({ locals, platform, url }) => {
  const env = platform?.env;
  if (env && locals.user && locals.sessionId) {
    // Revoke session
    await env.DB.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').bind(locals.sessionId).run();
    await audit(env.DB, {
      event_type: 'auth.session_expired',
      actor_id: locals.user.id,
      actor_role: locals.user.role as 'standard' | 'manager',
      detail: 'User signed out',
      session_id: locals.sessionId,
    });
  }

  const headers = new Headers();
  headers.set('Set-Cookie', clearSessionCookie(url.protocol === 'https:'));
  headers.append('Set-Cookie', clearProviderPreferenceCookie());
  headers.set('Cache-Control', 'no-store');
  headers.set('Location', '/');
  return new Response(null, { status: 303, headers });
};
