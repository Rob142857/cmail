import { describe, expect, it, vi } from 'vitest';
import type { User } from '@cmail/shared/types';
import { handle, handleError } from './hooks.server';
import { buildSessionCookie, createSessionToken } from './lib/server/session';

const SESSION_SECRET = 'f19c9967e0db9ad12f9c9b78f130f4a768d3517ddcf6c8cf';

interface InvokeOptions {
  path: string;
  method?: string;
  role?: 'standard' | 'manager';
  publishedPolicy?: boolean;
  headers?: Record<string, string>;
  /** What the sessions query returns for a signed-in caller. Default: the matching row. */
  sessionRow?: 'match' | 'none' | 'other-id' | 'other-user';
  /** False when the users query finds no active user (paused, offboarded). */
  userFound?: boolean;
  /** Flip the token's last signature character. */
  tamperToken?: boolean;
  /** SESSION_SECRET the server runs with; tokens are always signed with the real one. */
  serverSecret?: string;
  /** expires_at on the session row (sliding renewal). */
  expiresAt?: string;
}

function user(role: 'standard' | 'manager'): User {
  return {
    id: 'user-1',
    email: 'person@example.com',
    display_name: 'Example Person',
    role,
    status: 'active',
    auth_provider: 'google',
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    last_sign_in: null,
    last_auth_country: null,
  };
}

async function invoke(options: InvokeOptions): Promise<{
  response: Response;
  resolve: ReturnType<typeof vi.fn>;
  locals: { user: User | null; sessionId: string | null };
  waitUntil: ReturnType<typeof vi.fn>;
}> {
  const authenticatedUser = options.role ? user(options.role) : null;
  const session = authenticatedUser
    ? await createSessionToken(authenticatedUser.id, SESSION_SECRET, 60_000)
    : null;
  const requestUrl = new URL(options.path, 'https://mail.example.com');
  const headers = new Headers(options.headers);
  if (session) {
    const last = session.token.slice(-1);
    const token = options.tamperToken ? `${session.token.slice(0, -1)}${last === 'a' ? 'b' : 'a'}` : session.token;
    headers.set('cookie', buildSessionCookie(token, true).split(';', 1)[0]);
  }
  if (options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method)) {
    headers.set('origin', requestUrl.origin);
  }

  const db = {
    prepare(query: string) {
      const statement = {
        bind() {
          return statement;
        },
        async first() {
          if (query.includes('FROM sessions') && session) {
            const row = options.sessionRow ?? 'match';
            if (row === 'none') return null;
            return {
              id: row === 'other-id' ? 'session-other' : session.sessionId,
              user_id: row === 'other-user' ? 'user-other' : authenticatedUser?.id,
              expires_at: options.expiresAt,
            };
          }
          if (query.includes('FROM users')) return options.userFound === false ? null : authenticatedUser;
          if (query.includes('FROM ict_policy_versions')) {
            return options.publishedPolicy ? { id: 'policy-1' } : null;
          }
          if (query.includes('FROM ict_policy_signatures')) return null;
          return null;
        },
        async run() {
          return { success: true, meta: { changes: 0 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;

  const event = {
    url: requestUrl,
    request: new Request(requestUrl, { method: options.method || 'GET', headers }),
    locals: { user: null, sessionId: null },
    platform: {
      env: {
        DB: db,
        STORAGE: {} as R2Bucket,
        SESSION_SECRET: options.serverSecret ?? SESSION_SECRET,
      },
      context: { waitUntil: vi.fn() },
      caches: {},
    },
  };
  const resolve = vi.fn(async () => new Response('resolved', { status: 200 }));
  const response = await (handle as any)({ event, resolve });
  return { response, resolve, locals: event.locals, waitUntil: event.platform.context.waitUntil };
}

describe('session cookie checks', () => {
  const cleared = (response: Response) => (response.headers.get('set-cookie') || '').includes('Max-Age=0');

  it('signs in a caller whose token, session row and user all match (control)', async () => {
    const { response, locals } = await invoke({ path: '/mail', role: 'standard' });
    expect(locals.user?.id).toBe('user-1');
    expect(locals.sessionId).not.toBeNull();
    expect(cleared(response)).toBe(false);
  });

  it.each([
    ['a token with a bad signature', { tamperToken: true }],
    ['no live session row (expired, revoked or unknown)', { sessionRow: 'none' as const }],
    ['a session row with a different id', { sessionRow: 'other-id' as const }],
    ['a session row for a different user', { sessionRow: 'other-user' as const }],
    ['a user who is no longer active (paused or offboarded)', { userFound: false }],
    ['a weak SESSION_SECRET on the server', { serverSecret: 'too-short' }],
  ])('treats %s as signed out and clears the cookie', async (_label, extra) => {
    const { response, resolve, locals } = await invoke({ path: '/mail', role: 'standard', ...extra });
    expect(locals.user).toBeNull();
    expect(locals.sessionId).toBeNull();
    expect(resolve).toHaveBeenCalled();
    expect(cleared(response)).toBe(true);
  });

  it('clears an invalid cookie on the admin redirect too', async () => {
    const { response, resolve } = await invoke({ path: '/admin', role: 'manager', sessionRow: 'none' });
    expect(response.status).toBe(303);
    expect(resolve).not.toHaveBeenCalled();
    expect(cleared(response)).toBe(true);
  });

  it('extends a session that is close to expiry, and leaves a fresh one alone', async () => {
    const soon = await invoke({ path: '/mail', role: 'standard', expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    expect(soon.locals.user).not.toBeNull();
    expect(soon.waitUntil).toHaveBeenCalledTimes(1);

    const fresh = await invoke({ path: '/mail', role: 'standard', expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() });
    expect(fresh.waitUntil).not.toHaveBeenCalled();
  });
});

describe('central admin authorization', () => {
  it('does not authenticate Access headers or an Access cookie as a cmail session', async () => {
    const { response, resolve } = await invoke({
      path: '/admin',
      headers: {
        'Cf-Access-Authenticated-User-Email': 'manager@example.com',
        'Cf-Access-Jwt-Assertion': 'unverified-assertion',
        cookie: 'CF_Authorization=unverified-assertion',
      },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/');
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    '/admin',
    '/admin/users/__data.json',
    '/admin/internal/export',
  ])('redirects an unauthenticated %s request without resolving the route', async (path) => {
    const { response, resolve } = await invoke({ path });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    { path: '/admin/users/__data.json', method: 'GET' },
    { path: '/admin/users?/pause', method: 'POST' },
    { path: '/admin/internal/export', method: 'POST' },
  ])('returns 403 for a standard user requesting $path', async ({ path, method }) => {
    const { response, resolve } = await invoke({
      path,
      method,
      role: 'standard',
      publishedPolicy: true,
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Admin access required');
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    { path: '/admin/users/__data.json', method: 'GET' },
    { path: '/admin/users?/pause', method: 'POST' },
    { path: '/admin/internal/export', method: 'POST' },
  ])('allows a manager request for $path to continue', async ({ path, method }) => {
    const { response, resolve } = await invoke({ path, method, role: 'manager' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('resolved');
    expect(resolve).toHaveBeenCalledOnce();
  });

  it.each(['/administrator', '/administer', '/organization']) (
    'does not treat the non-admin route %s as part of the admin segment',
    async (path) => {
      const { response, resolve } = await invoke({
        path,
        role: 'standard',
        publishedPolicy: true,
      });
      expect(response.status).toBe(200);
      expect(resolve).toHaveBeenCalledOnce();
    },
  );
});

describe('central ICT policy gate', () => {
  it.each(['/mail', '/mail/compose', '/admin/users']) (
    'redirects an unsigned user from %s before resolving the route',
    async (path) => {
      const { response, resolve } = await invoke({
        path,
        role: 'manager',
        publishedPolicy: true,
      });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/policy');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(resolve).not.toHaveBeenCalled();
    },
  );

  it('returns a policy-required API response instead of redirecting', async () => {
    const { response, resolve } = await invoke({
      path: '/api/messages/message-1',
      role: 'standard',
      publishedPolicy: true,
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'policy_required' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each(['/policy', '/auth/logout', '/_app/immutable/assets/app.css']) (
    'does not apply the policy gate to %s',
    async (path) => {
      const { response, resolve } = await invoke({
        path,
        role: 'standard',
        publishedPolicy: true,
      });
      expect(response.status).toBe(200);
      expect(resolve).toHaveBeenCalledOnce();
    },
  );
});

describe('Workers runtime platform (adapter-cloudflare 8)', () => {
  it('fills event.platform from the runtime module when the adapter provides none', async () => {
    const runtime = { env: { DB: {} as D1Database, STORAGE: {} as R2Bucket, SESSION_SECRET }, context: { waitUntil: vi.fn() } };
    vi.resetModules();
    vi.doMock('#lib/server/cloudflare-runtime.js', () => ({ runtimePlatform: () => runtime }));
    const { handle: freshHandle } = await import('./hooks.server');

    const requestUrl = new URL('/', 'https://mail.example.com');
    const event: { url: URL; request: Request; locals: Record<string, unknown>; platform?: unknown } = {
      url: requestUrl,
      request: new Request(requestUrl),
      locals: { user: null, sessionId: null },
    };
    await (freshHandle as any)({ event, resolve: vi.fn(async () => new Response('ok')) });
    expect(event.platform).toBe(runtime);

    vi.doUnmock('#lib/server/cloudflare-runtime.js');
    vi.resetModules();
  });

  it('keeps a platform the caller already supplied', async () => {
    const { response } = await invoke({ path: '/' });
    expect(response.status).toBe(200);
  });
});

describe('handleError (SvelteKit 3 passes every error kind)', () => {
  const url = new URL('/mail/missing', 'https://mail.example.com');
  const event = { url, request: new Request(url) };

  it('keeps the status and message of an error thrown with error()', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = (handleError as any)({ kind: 'app', error: { message: 'Message not found' }, event });
    expect(result).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it.each([
    { kind: 'unknown', error: new Error('D1_ERROR: no such table'), logged: 'D1_ERROR: no such table' },
    { kind: 'framework', error: { status: 404, message: 'Not Found' }, logged: 'Not Found' },
  ])('replaces a $kind error with a logged support reference', ({ kind, error, logged }) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = (handleError as any)({ kind, error, event });
    expect(result).toEqual({ message: 'An unexpected error occurred', reference: expect.any(String) });
    expect(log).toHaveBeenCalledWith('Unhandled request error', expect.objectContaining({
      reference: result.reference,
      path: '/mail/missing',
      error: logged,
    }));
    log.mockRestore();
  });
});
