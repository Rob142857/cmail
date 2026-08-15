import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Handler = (event: any) => void;

async function serviceWorkerHarness(preference = 'on') {
  const handlers = new Map<string, Handler>();
  const replacement = {
    endpoint: 'https://push.example/next',
    toJSON: () => ({ endpoint: 'https://push.example/next' }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  const subscribe = vi.fn().mockResolvedValue(replacement);
  const postMessage = vi.fn();
  const focus = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  const indexedDB = {
    open: vi.fn(() => {
      const request: Record<string, any> = {};
      queueMicrotask(() => {
        request.result = {
          transaction: () => ({
            objectStore: () => ({
              get: (key: string) => {
                const getRequest: Record<string, any> = {};
                queueMicrotask(() => {
                  getRequest.result = key === 'cmail_push_device_id'
                    ? '3f1263cc-7ba2-4d7a-bc3f-e83f2b744a89'
                    : preference;
                  getRequest.onsuccess?.();
                });
                return getRequest;
              },
            }),
          }),
          close: vi.fn(),
        };
        request.onsuccess?.();
      });
      return request;
    }),
  };
  const self = {
    addEventListener(type: string, handler: Handler) { handlers.set(type, handler); },
    skipWaiting: vi.fn(),
    registration: {
      pushManager: { subscribe },
      showNotification: vi.fn().mockResolvedValue(undefined),
    },
    clients: {
      claim: vi.fn(),
      matchAll: vi.fn().mockResolvedValue([{ postMessage, focus }]),
      openWindow: vi.fn(),
    },
  };
  const script = await readFile(new URL('../../../static/sw.js', import.meta.url), 'utf8');
  runInNewContext(script, {
    self,
    fetch,
    indexedDB,
    queueMicrotask,
    caches: { keys: async () => [], delete: async () => true },
  });
  return { handlers, replacement, subscribe, postMessage, focus, fetch, self };
}

describe('push service worker', () => {
  it('re-subscribes with the prior public key, persists it, and asks open pages to refresh', async () => {
    const harness = await serviceWorkerHarness();
    let pending: Promise<unknown> | undefined;
    harness.handlers.get('pushsubscriptionchange')?.({
      newSubscription: null,
      oldSubscription: { options: { applicationServerKey: new Uint8Array([4, 1, 2]) } },
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;

    expect(harness.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([4, 1, 2]),
    });
    expect(harness.fetch).toHaveBeenCalledWith('/api/push/subscriptions', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ ...harness.replacement.toJSON(), device_id: '3f1263cc-7ba2-4d7a-bc3f-e83f2b744a89' }),
    }));
    expect(harness.postMessage).toHaveBeenCalledWith({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
  });

  it('does not resurrect a notification subscription after a durable opt-out', async () => {
    const harness = await serviceWorkerHarness('off');
    let pending: Promise<unknown> | undefined;
    harness.handlers.get('pushsubscriptionchange')?.({
      newSubscription: harness.replacement,
      oldSubscription: null,
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;

    expect(harness.replacement.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.subscribe).not.toHaveBeenCalled();
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('honours an immediate off message even before durable preference reads settle', async () => {
    const harness = await serviceWorkerHarness('on');
    harness.handlers.get('message')?.({ data: { type: 'PUSH_PREFERENCE', preference: 'off' } });
    let pending: Promise<unknown> | undefined;
    harness.handlers.get('pushsubscriptionchange')?.({
      newSubscription: harness.replacement,
      oldSubscription: null,
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;

    expect(harness.replacement.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('keeps opaque mailbox/message deep links distinct while retaining a generic notification body', async () => {
    const harness = await serviceWorkerHarness();
    let pending: Promise<unknown> | undefined;
    harness.handlers.get('push')?.({
      data: { json: () => ({
        title: 'Cmail',
        body: 'A new message arrived.',
        url: '/mail/message-1?mailbox=mailbox-1',
        tag: 'cmail:mailbox-1:message-1',
      }) },
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;

    expect(harness.self.registration.showNotification).toHaveBeenCalledWith('Cmail', expect.objectContaining({
      body: 'A new message arrived.',
      tag: 'cmail:mailbox-1:message-1',
      data: { url: '/mail/message-1?mailbox=mailbox-1' },
    }));
  });

  it('opens a shared-mailbox deep link in an existing app window', async () => {
    const harness = await serviceWorkerHarness();
    const close = vi.fn();
    let pending: Promise<unknown> | undefined;
    harness.handlers.get('notificationclick')?.({
      notification: {
        close,
        data: { url: '/mail/message-1?mailbox=shared-mailbox-1' },
      },
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;

    expect(close).toHaveBeenCalledOnce();
    expect(harness.postMessage).toHaveBeenCalledWith({
      type: 'OPEN_NOTIFICATION',
      url: '/mail/message-1?mailbox=shared-mailbox-1',
    });
    expect(harness.focus).toHaveBeenCalledOnce();
    expect(harness.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a new app window and rejects unsafe notification targets', async () => {
    const harness = await serviceWorkerHarness();
    harness.self.clients.matchAll.mockResolvedValueOnce([]);
    let pending: Promise<unknown> | undefined;
    harness.handlers.get('notificationclick')?.({
      notification: {
        close: vi.fn(),
        data: { url: 'https://attacker.example/mail/message-1' },
      },
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;

    expect(harness.self.clients.openWindow).toHaveBeenCalledWith('/mail');
  });
});
