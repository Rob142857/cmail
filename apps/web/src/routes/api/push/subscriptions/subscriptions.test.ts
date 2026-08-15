import { describe, expect, it, vi } from 'vitest';
import { DELETE, POST } from './+server';

const pushEnvironment = {
  VAPID_PUBLIC_KEY: `B${'A'.repeat(86)}`,
  VAPID_PRIVATE_KEY: 'A'.repeat(43),
  VAPID_SUBJECT: 'mailto:operator@example.com',
};

const activeUser = {
  id: 'user-1',
  email: 'person@example.com',
  display_name: 'Example Person',
  role: 'standard',
  status: 'active',
};

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
  keys: {
    p256dh: 'A'.repeat(65),
    auth: 'B'.repeat(22),
  },
};

function request(method: 'POST' | 'DELETE', body: unknown): Request {
  return new Request('https://mail.example.com/api/push/subscriptions', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function database(options: { failInsert?: boolean } = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const prepare = vi.fn((sql: string) => ({
    bind(...values: unknown[]) {
      calls.push({ sql, values });
      return {
        run: async () => {
          if (options.failInsert && /INSERT INTO push_subscriptions/.test(sql)) throw new Error('D1 unavailable');
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
  }));
  return { DB: { prepare }, calls };
}

describe('push subscription API', () => {
  it('requires an active authenticated account and complete server configuration', async () => {
    const db = database();
    const unauthenticated = await POST({
      request: request('POST', subscription),
      locals: {},
      platform: { env: { DB: db.DB, ...pushEnvironment } },
    } as never);
    expect(unauthenticated.status).toBe(401);

    const inactive = await POST({
      request: request('POST', subscription),
      locals: { user: { ...activeUser, status: 'offboarded' } },
      platform: { env: { DB: db.DB, ...pushEnvironment } },
    } as never);
    expect(inactive.status).toBe(403);

    const unconfigured = await POST({
      request: request('POST', subscription),
      locals: { user: activeUser },
      platform: { env: { DB: db.DB } },
    } as never);
    expect(unconfigured.status).toBe(404);
    expect(db.calls).toEqual([]);
  });

  it('upserts a valid browser endpoint and keeps only the five newest for that user', async () => {
    const db = database();
    const response = await POST({
      request: request('POST', subscription),
      locals: { user: activeUser },
      platform: { env: { DB: db.DB, ...pushEnvironment } },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enabled: true });
    expect(db.calls).toHaveLength(2);
    expect(db.calls[0].sql).toMatch(/ON CONFLICT\(endpoint\) DO UPDATE SET/);
    expect(db.calls[0].values.slice(1)).toEqual([
      activeUser.id,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
    ]);
    expect(db.calls[1].sql).toMatch(/ORDER BY updated_at DESC, id DESC LIMIT \?/);
    expect(db.calls[1].values).toEqual([activeUser.id, activeUser.id, 5]);
  });

  it('rejects an untrusted endpoint before any database write', async () => {
    const db = database();
    const response = await POST({
      request: request('POST', { ...subscription, endpoint: 'https://fcm.googleapis.com.attacker.example/device' }),
      locals: { user: activeUser },
      platform: { env: { DB: db.DB, ...pushEnvironment } },
    } as never);

    expect(response.status).toBe(400);
    expect(db.calls).toEqual([]);
  });

  it('reports a retryable save failure and scopes deletion to the signed-in user and endpoint', async () => {
    const failing = database({ failInsert: true });
    const failedSave = await POST({
      request: request('POST', subscription),
      locals: { user: activeUser },
      platform: { env: { DB: failing.DB, ...pushEnvironment } },
    } as never);
    expect(failedSave.status).toBe(503);

    const db = database();
    const removed = await DELETE({
      request: request('DELETE', { endpoint: subscription.endpoint }),
      locals: { user: activeUser },
      platform: { env: { DB: db.DB } },
    } as never);
    expect(removed.status).toBe(200);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toBe('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?');
    expect(db.calls[0].values).toEqual([activeUser.id, subscription.endpoint]);
  });
});
