import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

vi.mock('@cmail/shared/push', () => ({
  isAllowedPushEndpoint: vi.fn().mockReturnValue(true),
  sendTestPushNotification: vi.fn(),
}));
import { sendTestPushNotification } from '@cmail/shared/push';

const user = { id: 'user-1', status: 'active' };

function database(count = 1) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue({ count }) })),
    })),
  };
}

const target = { endpoint: 'https://fcm.googleapis.com/fcm/send/device-1', device_id: '3f1263cc-7ba2-4d7a-bc3f-e83f2b744a89' };

function event(DB = database()) {
  return { request: new Request('https://mail.example.test/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target) }), locals: { user }, platform: { env: { DB } } } as never;
}

describe('push test alert API', () => {
  it('requires an active authenticated account', async () => {
    expect((await POST({ request: new Request('https://mail.example.test/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target) }), locals: {}, platform: { env: { DB: database() } } } as never)).status).toBe(401);
    expect((await POST({
      request: new Request('https://mail.example.test/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target) }),
      locals: { user: { ...user, status: 'offboarded' } },
      platform: { env: { DB: database() } },
    } as never)).status).toBe(403);
  });

  it('rejects malformed or oversized target input before consuming a test send', async () => {
    const malformed = await POST({
      request: new Request('https://mail.example.test/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }),
      locals: { user }, platform: { env: { DB: database() } },
    } as never);
    expect(malformed.status).toBe(400);
    const oversized = await POST({
      request: new Request('https://mail.example.test/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(4_100) }) }),
      locals: { user }, platform: { env: { DB: database() } },
    } as never);
    expect(oversized.status).toBe(413);
    expect(sendTestPushNotification).not.toHaveBeenCalled();
  });

  it('rate limits a signed-in user before sending', async () => {
    const response = await POST(event(database(4)));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeTruthy();
    expect(sendTestPushNotification).not.toHaveBeenCalled();
  });

  it.each([
    [{ attempted: 1, accepted: 1, expired: 0, configuration: 0, retryable: 0, rejected: 0, invalid: 0 }, 'accepted', 200],
    [{ attempted: 1, accepted: 0, expired: 0, configuration: 1, retryable: 0, rejected: 0, invalid: 0 }, 'configuration', 503],
    [{ attempted: 1, accepted: 0, expired: 0, configuration: 0, retryable: 1, rejected: 0, invalid: 0 }, 'transient', 503],
    [{ attempted: 0, accepted: 0, expired: 0, configuration: 0, retryable: 0, rejected: 0, invalid: 0 }, 'no_subscription', 409],
  ])('reports %s without disclosing subscription data', async (summary, result, status) => {
    vi.mocked(sendTestPushNotification).mockResolvedValueOnce(summary as never);
    const response = await POST(event());
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ result });
    expect(sendTestPushNotification).toHaveBeenCalledWith(expect.anything(), user.id, target.device_id, target.endpoint);
  });
});
