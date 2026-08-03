import type { Handle, HandleServerError } from '@sveltejs/kit';
import type { User } from '@cmail/shared/types';
import { assertStrongSessionSecret, publicRuntimeConfig } from '$lib/server/config';
import { clearSessionCookie, getSessionTokenFromCookie, hashToken, verifySessionToken } from '$lib/server/session';

function appendVary(headers: Headers, value: string): void {
  const values = new Set(
    (headers.get('Vary') || '').split(',').map((item) => item.trim()).filter(Boolean),
  );
  values.add(value);
  headers.set('Vary', [...values].join(', '));
}

function secureResponse(response: Response, authenticated: boolean, isHttps: boolean): Response {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (isHttps) response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (authenticated) {
    response.headers.set('Cache-Control', 'private, no-store');
    appendVary(response.headers, 'Cookie');
  }
  return response;
}

function isUnsafeCrossOrigin(request: Request, requestOrigin: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return false;
  if (request.headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = request.headers.get('origin');
  return !!origin && origin !== requestOrigin;
}

function isAdminRequestPath(pathname: string): boolean {
  // SvelteKit form-action query strings are excluded from pathname, while
  // internal page-data requests remain below the /admin segment (for example,
  // /admin/users/__data.json). Match a complete path segment so an unrelated
  // route such as /administrator is not treated as an admin route.
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  event.locals.sessionId = null;

  const env = event.platform?.env;
  const isHttps = event.url.protocol === 'https:';

  if (isUnsafeCrossOrigin(event.request, event.url.origin)) {
    return secureResponse(new Response('Cross-origin request blocked', { status: 403 }), false, isHttps);
  }

  let clearInvalidCookie = false;
  const token = getSessionTokenFromCookie(event.request.headers.get('cookie'));
  if (env && token) {
    try {
      assertStrongSessionSecret(env.SESSION_SECRET);
      const verified = await verifySessionToken(token, env.SESSION_SECRET);
      if (verified) {
        const tokenHash = await hashToken(token);
        const session = await env.DB.prepare(
          `SELECT id, user_id FROM sessions
           WHERE token_hash = ? AND revoked = 0 AND expires_at > datetime('now')`,
        ).bind(tokenHash).first<{ id: string; user_id: string }>();

        if (session && session.id === verified.sessionId && session.user_id === verified.userId) {
          const user = await env.DB.prepare(
            `SELECT * FROM users WHERE id = ? AND status IN ('active', 'pending')`,
          ).bind(verified.userId).first<User>();
          if (user) {
            event.locals.user = user;
            event.locals.sessionId = session.id;
          }
        }
      }
      clearInvalidCookie = !event.locals.user;
    } catch {
      clearInvalidCookie = true;
    }
  }

  if (isAdminRequestPath(event.url.pathname) && event.locals.user?.role !== 'manager') {
    const denied = event.locals.user
      ? new Response('Admin access required', { status: 403 })
      : new Response(null, { status: 303, headers: { Location: '/' } });
    // Admin authorization responses must never be shared between callers,
    // including the unauthenticated redirect response.
    const response = secureResponse(denied, true, isHttps);
    if (clearInvalidCookie) response.headers.append('Set-Cookie', clearSessionCookie(isHttps));
    return response;
  }

  const protectedPath = event.url.pathname.startsWith('/mail')
    || isAdminRequestPath(event.url.pathname)
    || (event.url.pathname.startsWith('/api/') && event.url.pathname !== '/api/organization');
  if (env && event.locals.user && protectedPath) {
    const latestPolicy = await env.DB.prepare(
      'SELECT id FROM ict_policy_versions ORDER BY published_at DESC, id DESC LIMIT 1',
    ).first<{ id: string }>();
    if (latestPolicy) {
      const signature = await env.DB.prepare(
        'SELECT id FROM ict_policy_signatures WHERE user_id = ? AND policy_version_id = ?',
      ).bind(event.locals.user.id, latestPolicy.id).first<{ id: string }>();
      if (!signature) {
        const response = event.url.pathname.startsWith('/api/')
          ? Response.json({ error: 'policy_required' }, { status: 403 })
          : new Response(null, { status: 303, headers: { Location: '/policy' } });
        return secureResponse(response, true, isHttps);
      }
    }
  }

  if (env && Math.random() < 0.01) {
    event.platform?.context.waitUntil(
      Promise.all([
        env.DB.prepare(`DELETE FROM sessions WHERE revoked = 1 OR expires_at < datetime('now')`).run(),
        env.DB.prepare(`DELETE FROM rate_limits WHERE expires_at < unixepoch('now')`).run(),
        env.DB.prepare(`DELETE FROM enrollment_tokens WHERE consumed_at IS NOT NULL OR expires_at < unixepoch('now')`).run(),
        env.DB.prepare(`DELETE FROM send_idempotency WHERE created_at < datetime('now', '-7 days')`).run(),
      ]).then(() => undefined).catch(() => undefined),
    );
  }

  const locale = env
    ? publicRuntimeConfig(env as unknown as Record<string, unknown>).locale
    : 'en';
  const response = secureResponse(await resolve(event, {
    transformPageChunk: ({ html }) => html.replace('<html lang="en">', `<html lang="${locale}">`),
  }), !!event.locals.user, isHttps);
  if (event.url.pathname === '/bootstrap' || event.url.pathname.startsWith('/enroll/')) {
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    appendVary(response.headers, 'Cookie');
  }
  if (clearInvalidCookie) response.headers.append('Set-Cookie', clearSessionCookie(isHttps));
  return response;
};

export const handleError: HandleServerError = ({ error, event }) => {
  const reference = crypto.randomUUID();
  console.error('Unhandled request error', {
    reference,
    method: event.request.method,
    path: event.url.pathname,
    error: error instanceof Error ? error.message : String(error),
  });
  return { message: 'An unexpected error occurred', reference };
};
