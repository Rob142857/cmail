import type { Handle } from '@sveltejs/kit';
import { getSessionTokenFromCookie, verifySessionToken, hashToken } from '$lib/server/session';
import type { User } from '@cmail/shared/types';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  event.locals.sessionId = null;

  const env = event.platform?.env;
  if (!env) return resolve(event);

  const token = getSessionTokenFromCookie(event.request.headers.get('cookie'));
  if (!token) return resolve(event);

  const verified = await verifySessionToken(token, env.SESSION_SECRET);
  if (!verified) return resolve(event);

  // Check session in DB
  const tokenHash = await hashToken(token);
  const session = await env.DB.prepare(
    'SELECT id FROM sessions WHERE token_hash = ? AND revoked = 0 AND expires_at > datetime(\'now\')',
  ).bind(tokenHash).first<{ id: string }>();

  if (!session) return resolve(event);

  // Load user
  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE id = ? AND status IN (\'active\', \'pending\')',
  ).bind(verified.userId).first<User>();

  if (user) {
    event.locals.user = user;
    event.locals.sessionId = session.id;
  }

  // Probabilistic cleanup: ~1% of requests, delete expired/revoked sessions
  if (Math.random() < 0.01) {
    event.platform?.context.waitUntil(
      env.DB.prepare(
        'DELETE FROM sessions WHERE revoked = 1 OR expires_at < datetime(\'now\')',
      ).run().catch(() => {}),
    );
  }

  const response = await resolve(event);

  // ─── Security headers ────────────────────────────────────
  // CSP itself is configured in svelte.config.js (kit.csp) so SvelteKit can
  // auto-hash its own hydration <script> blocks. Email HTML is *also* rendered
  // inside a sandboxed iframe with its own restrictive CSP, so malformed
  // inbound mail can't escape.
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  // HSTS (Cloudflare may also add this at the edge — duplicate is harmless)
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  // Don't let search engines index the app
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  // Authenticated content should not sit in shared/proxy caches
  if (event.locals.user) {
    response.headers.set('Cache-Control', 'private, no-store');
  }

  return response;
};
