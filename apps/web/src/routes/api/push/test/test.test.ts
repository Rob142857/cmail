import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

vi.mock('@cmail/shared/push', () => ({
  isAllowedPushEndpoint: vi.fn().mockReturnValue(true),
  pushConfigurationDiagnostic: vi.fn().mockReturnValue('ready'),
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

function event(DB = database(), EMAIL_SERVICE?: { fetch: typeof fetch }) {
  return {
    request: new Request('https://mail.example.test/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target) }),
    locals: { user },
    platform: { env: { DB, ...(EMAIL_SERVICE ? { EMAIL_SERVICE } : {}) } },
  } as never;
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
    [{ attempted: 1, accepted: 1, expired: 0, configuration: 0, retryable: 0, rejected: 0, invalid: 0 }, 'accepted', 200, undefined],
    [{ attempted: 1, accepted: 0, expired: 0, configuration: 1, retryable: 0, rejected: 0, invalid: 0 }, 'configuration', 503, 'push_configuration_rejected'],
    [{ attempted: 1, accepted: 0, expired: 0, configuration: 0, retryable: 1, rejected: 0, invalid: 0 }, 'transient', 503, 'push_service_unavailable'],
    [{ attempted: 0, accepted: 0, expired: 0, configuration: 0, retryable: 0, rejected: 0, invalid: 0 }, 'no_subscription', 409, undefined],
  ])('reports %s without disclosing subscription data', async (summary, result, status, diagnostic) => {
    vi.mocked(sendTestPushNotification).mockResolvedValueOnce(summary as never);
    const response = await POST(event());
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      result,
      ...(diagnostic ? { diagnostic } : {}),
      // Only the accepted path asks the Worker runtime for its own push
      // diagnostic; with no EMAIL_SERVICE binding configured in this event,
      // that ask is unreachable.
      ...(result === 'accepted' ? { workerPush: 'unreachable' } : {}),
    });
    expect(sendTestPushNotification).toHaveBeenCalledWith(expect.anything(), user.id, target.device_id, target.endpoint);
  });

  it('reports a safe configuration diagnostic before spending a test-send allowance', async () => {
    const { pushConfigurationDiagnostic } = await import('@cmail/shared/push');
    vi.mocked(sendTestPushNotification).mockClear();
    vi.mocked(pushConfigurationDiagnostic).mockReturnValueOnce('vapid_not_configured');
    const response = await POST(event());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ result: 'configuration', diagnostic: 'vapid_not_configured' });
    expect(sendTestPushNotification).not.toHaveBeenCalled();
  });

  describe('worker-runtime push diagnostic', () => {
    const acceptedSummary = { attempted: 1, accepted: 1, expired: 0, configuration: 0, retryable: 0, rejected: 0, invalid: 0 };

    it('reports the Worker runtime status alongside a successfully sent test', async () => {
      vi.mocked(sendTestPushNotification).mockResolvedValueOnce(acceptedSummary as never);
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'vapid_invalid' }), { status: 200 }));

      const response = await POST(event(database(), { fetch }));

      await expect(response.json()).resolves.toEqual({ result: 'accepted', workerPush: 'vapid_invalid' });
      expect(fetch).toHaveBeenCalledWith(
        'https://cmail-email-worker.internal/internal/push-diagnostic',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('reports unreachable when the service binding throws, times out, or returns nonsense', async () => {
      vi.mocked(sendTestPushNotification).mockResolvedValueOnce(acceptedSummary as never);
      const rejecting = vi.fn().mockRejectedValue(new Error('boom'));

      const response = await POST(event(database(), { fetch: rejecting }));

      await expect(response.json()).resolves.toEqual({ result: 'accepted', workerPush: 'unreachable' });
    });

    it('never lets a Worker-runtime failure downgrade the already-sent web result', async () => {
      vi.mocked(sendTestPushNotification).mockResolvedValueOnce(acceptedSummary as never);
      const notOk = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));

      const response = await POST(event(database(), { fetch: notOk }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ result: 'accepted', workerPush: 'unreachable' });
    });
  });
});
