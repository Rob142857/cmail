import { describe, expect, it, vi } from 'vitest';
import type { User } from '@cmail/shared/types';
import { handle } from './hooks.server';
import { buildSessionCookie, createSessionToken } from './lib/server/session';

const SESSION_SECRET = 'f19c9967e0db9ad12f9c9b78f130f4a768d3517ddcf6c8cf';

interface InvokeOptions {
  path: string;
  method?: string;
  role?: 'standard' | 'manager';
  publishedPolicy?: boolean;
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
  };
}

async function invoke(options: InvokeOptions): Promise<{
  response: Response;
  resolve: ReturnType<typeof vi.fn>;
}> {
  const authenticatedUser = options.role ? user(options.role) : null;
  const session = authenticatedUser
    ? await createSessionToken(authenticatedUser.id, SESSION_SECRET, 60_000)
    : null;
  const requestUrl = new URL(options.path, 'https://mail.example.com');
  const headers = new Headers();
  if (session) {
    headers.set('cookie', buildSessionCookie(session.token, true).split(';', 1)[0]);
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
            return { id: session.sessionId, user_id: authenticatedUser?.id };
          }
          if (query.includes('FROM users')) return authenticatedUser;
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
        SESSION_SECRET,
      },
      context: { waitUntil: vi.fn() },
      caches: {},
    },
  };
  const resolve = vi.fn(async () => new Response('resolved', { status: 200 }));
  const response = await (handle as any)({ event, resolve });
  return { response, resolve };
}

describe('central admin authorization', () => {
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
