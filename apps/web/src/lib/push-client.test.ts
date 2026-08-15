import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPushPreference, pushDeviceId, setPushPreference, stopPushBeforeSignOut } from './push-client';

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

    await setPushPreference('on');
    expect(getPushPreference()).toBe('on');
    await stopPushBeforeSignOut();

    expect(getPushPreference()).toBe('off');
    expect(fetch).toHaveBeenCalledWith('/api/push/subscriptions', expect.objectContaining({
      method: 'DELETE',
      body: expect.stringContaining('"endpoint":"https://fcm.googleapis.com/fcm/send/device-1"'),
    }));
    const request = fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ disable: true });
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

  it('recovers a stable device ID from IndexedDB when localStorage is unavailable', async () => {
    const persisted = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: Record<string, any> = {};
        queueMicrotask(() => {
          request.result = {
            transaction: (_store: string, mode: string) => {
              const transaction: Record<string, any> = {
                objectStore: () => ({
                  get: (key: string) => {
                    const getRequest: Record<string, any> = {};
                    queueMicrotask(() => { getRequest.result = persisted.get(key); getRequest.onsuccess?.(); });
                    return getRequest;
                  },
                  put: (value: string, key: string) => { persisted.set(key, value); queueMicrotask(() => transaction.oncomplete?.()); },
                }),
              };
              if (mode === 'readonly') delete transaction.oncomplete;
              return transaction;
            },
            close: vi.fn(),
          };
          request.onsuccess?.();
        });
        return request;
      },
    });

    const first = await pushDeviceId();
    const second = await pushDeviceId();
    expect(first).toMatch(/^[a-f\d-]{36}$/i);
    expect(second).toBe(first);
  });
});
