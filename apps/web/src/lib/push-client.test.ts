import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPushPreference, setPushPreference, stopPushBeforeSignOut } from './push-client';

afterEach(() => vi.unstubAllGlobals());

describe('browser push lifecycle', () => {
  it('removes the current endpoint locally and on the server before sign-out', async () => {
    const values = new Map<string, string>();
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue({
              endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
              unsubscribe,
            }),
          },
        }),
      },
    });
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal('fetch', fetch);

    setPushPreference('on');
    expect(getPushPreference()).toBe('on');
    await stopPushBeforeSignOut();

    expect(getPushPreference()).toBe('off');
    expect(fetch).toHaveBeenCalledWith('/api/push/subscriptions', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/device-1' }),
    }));
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('never blocks sign-out when the browser has no service-worker support', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal('navigator', {});

    await expect(stopPushBeforeSignOut()).resolves.toBeUndefined();
    expect(getPushPreference()).toBe('off');
  });
});
