import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWebPushRequest,
  configuredPushHosts,
  isAllowedPushEndpoint,
  newMailNotificationPayload,
  publicPushKey,
  pushConfiguration,
  sendNewMailNotifications,
} from '@cmail/shared/push';

const encoder = new TextEncoder();

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function concatenate(...values: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(values.reduce((length, value) => length + value.byteLength, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

async function deriveHkdf(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  byteLength: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', asArrayBuffer(inputKeyMaterial), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: asArrayBuffer(salt),
    info: asArrayBuffer(info),
  }, material, byteLength * 8));
}

const validEnvironment = {
  VAPID_PUBLIC_KEY: encodeBase64Url(Uint8Array.from({ length: 65 }, (_, index) => index === 0 ? 4 : 0)),
  VAPID_PRIVATE_KEY: encodeBase64Url(new Uint8Array(32).fill(1)),
  VAPID_SUBJECT: 'mailto:operator@example.com',
};

async function notificationDeliveryFixture(
  responseStatus = 201,
  options: {
    messageRow?: { subject: string; from_name: string; from_address: string } | null;
    messageLookupFails?: boolean;
  } = {},
) {
  const vapidKeys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const vapidPrivate = await crypto.subtle.exportKey('jwk', vapidKeys.privateKey);
  const vapidPublic = new Uint8Array(await crypto.subtle.exportKey('raw', vapidKeys.publicKey));
  const subscriberKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair;
  const subscriberPublic = new Uint8Array(await crypto.subtle.exportKey('raw', subscriberKeys.publicKey));
  const subscription = {
    id: 'subscription-1',
    user_id: 'user-1',
    endpoint: 'https://fcm.googleapis.com/fcm/send/shared-mailbox-test',
    p256dh: encodeBase64Url(subscriberPublic),
    auth: encodeBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
  const subscriptions = [subscription];
  const queries: string[] = [];
  const selectedMailboxIds: unknown[][] = [];
  const removedEndpoints: unknown[][] = [];
  const messageLookupBindings: unknown[][] = [];
  const DB = {
    prepare(sql: string) {
      queries.push(sql);
      if (/SELECT subject, from_name, from_address\s+FROM messages/.test(sql)) {
        return {
          bind(...values: unknown[]) {
            messageLookupBindings.push(values);
            return {
              first: async () => {
                if (options.messageLookupFails) throw new Error('message lookup failed');
                return options.messageRow ?? null;
              },
            };
          },
        };
      }
      if (/SELECT DISTINCT ps\.id, ps\.user_id, ps\.endpoint/.test(sql) || /SELECT id, user_id, endpoint, p256dh, auth\s+FROM push_subscriptions/.test(sql)) {
        return {
          bind(...values: unknown[]) {
            selectedMailboxIds.push(values);
            return { all: async () => ({ results: subscriptions }) };
          },
        };
      }
      if (/DELETE FROM push_subscriptions WHERE id = \? AND user_id = \? AND endpoint = \?/.test(sql)) {
        return {
          bind(...values: unknown[]) {
            removedEndpoints.push(values);
            return { run: async () => ({ success: true }) };
          },
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const fetch = vi.fn().mockResolvedValue({ status: responseStatus });
  vi.stubGlobal('fetch', fetch);
  return {
    env: {
      DB,
      APP_NAME: 'Cmail',
      VAPID_PUBLIC_KEY: encodeBase64Url(vapidPublic),
      VAPID_PRIVATE_KEY: vapidPrivate.d!,
      VAPID_SUBJECT: 'mailto:operator@example.com',
    },
    subscription,
    subscriptions,
    queries,
    selectedMailboxIds,
    removedEndpoints,
    messageLookupBindings,
    fetch,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('Web Push configuration', () => {
  it('fails closed unless the complete VAPID configuration is valid', () => {
    expect(pushConfiguration(validEnvironment)).toEqual({
      publicKey: validEnvironment.VAPID_PUBLIC_KEY,
      privateKey: validEnvironment.VAPID_PRIVATE_KEY,
      subject: validEnvironment.VAPID_SUBJECT,
    });
    expect(publicPushKey(validEnvironment)).toBe(validEnvironment.VAPID_PUBLIC_KEY);
    expect(pushConfiguration({ ...validEnvironment, VAPID_PRIVATE_KEY: '' })).toBeNull();
    expect(pushConfiguration({ ...validEnvironment, VAPID_PUBLIC_KEY: 'B'.repeat(87) })).toBeNull();
    expect(pushConfiguration({ ...validEnvironment, VAPID_SUBJECT: 'javascript:alert(1)' })).toBeNull();
    expect(publicPushKey({ VAPID_PUBLIC_KEY: validEnvironment.VAPID_PUBLIC_KEY })).toBe('');
  });

  it('accepts only HTTPS endpoints on an explicit push-service host allowlist', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/example', validEnvironment)).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/example', validEnvironment)).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/Qexample', validEnvironment)).toBe(true);
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/example', validEnvironment)).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example/send/example', validEnvironment)).toBe(false);
    const credentialEndpoint = ['https', '://user:pass@fcm.googleapis.com/send/example'].join('');
    expect(isAllowedPushEndpoint(credentialEndpoint, validEnvironment)).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/send/example', validEnvironment)).toBe(false);
  });

  it('normalises valid operator-supplied endpoint hosts and rejects unsafe entries', () => {
    const environment = {
      ...validEnvironment,
      PUSH_ENDPOINT_HOSTS: ' Push.Example.org, .push.example.org., localhost, bad/value ',
    };
    expect(configuredPushHosts(environment)).toContain('push.example.org');
    expect(configuredPushHosts(environment)).not.toContain('localhost');
    expect(isAllowedPushEndpoint('https://region.push.example.org/subscription/123', environment)).toBe(true);
  });

  it('creates privacy-safe, mailbox-specific notification routes and dedupe tags', () => {
    expect(newMailNotificationPayload(' Cmail\n', 'mailbox_1', 'message-1')).toEqual({
      title: 'Cmail',
      body: 'A new message arrived.',
      url: '/mail/message-1?mailbox=mailbox_1',
      tag: 'cmail:mailbox_1:message-1',
    });
    expect(newMailNotificationPayload('cmail', 'mailbox 1', 'message-1')).toBeNull();
    expect(newMailNotificationPayload('cmail', 'mailbox-1', '../message')).toBeNull();
  });

  it('shows the sender and subject on the lock screen when supplied, capped and stripped of control characters', () => {
    expect(newMailNotificationPayload('Cmail', 'mailbox-1', 'message-1', ' Priya Patel ', ' Quarterly numbers\n')).toEqual({
      title: 'Priya Patel',
      body: 'Quarterly numbers',
      url: '/mail/message-1?mailbox=mailbox-1',
      tag: 'cmail:mailbox-1:message-1',
    });

    // Falls back per-field -- not to the fully generic alert -- when the
    // caller supplied empty strings, e.g. a message with no subject line.
    expect(newMailNotificationPayload('Cmail', 'mailbox-1', 'message-1', '', '')).toEqual({
      title: 'Cmail',
      body: 'New message',
      url: '/mail/message-1?mailbox=mailbox-1',
      tag: 'cmail:mailbox-1:message-1',
    });

    const controlChar = String.fromCharCode(0);
    const bellChar = String.fromCharCode(7);
    const longSender = `Attacker${controlChar.repeat(3)}${'A'.repeat(100)}`;
    const longSubject = `${'S'.repeat(200)}${bellChar}`;
    expect(newMailNotificationPayload('Cmail', 'mailbox-1', 'message-1', longSender, longSubject)).toEqual({
      title: `Attacker${'A'.repeat(52)}`,
      body: 'S'.repeat(120),
      url: '/mail/message-1?mailbox=mailbox-1',
      tag: 'cmail:mailbox-1:message-1',
    });
  });

  it('fans out once per browser for an active assigned shared mailbox', async () => {
    const fixture = await notificationDeliveryFixture();
    fixture.subscriptions.push({ ...fixture.subscription });

    await sendNewMailNotifications(fixture.env as never, 'shared-mailbox-1', 'message-1');

    const subscriptionQuery = fixture.queries.find((sql) => sql.includes('FROM push_subscriptions ps'));
    expect(subscriptionQuery).toMatch(/INNER JOIN users u ON u\.id = ps\.user_id AND u\.status = 'active'/);
    expect(subscriptionQuery).toMatch(/INNER JOIN mailbox_assignments ma ON ma\.user_id = ps\.user_id/);
    expect(subscriptionQuery).toMatch(/INNER JOIN mailboxes mailbox ON mailbox\.id = ma\.mailbox_id AND mailbox\.status = 'active'/);
    expect(fixture.messageLookupBindings).toEqual([['message-1', 'shared-mailbox-1']]);
    expect(fixture.selectedMailboxIds).toEqual([['shared-mailbox-1']]);
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
    expect(fixture.fetch).toHaveBeenCalledWith(fixture.subscription.endpoint, expect.objectContaining({
      method: 'POST',
      redirect: 'manual',
    }));
  });

  it('looks up the sender and subject for the lock-screen payload, scoped to the message and mailbox', async () => {
    const fixture = await notificationDeliveryFixture(201, {
      messageRow: { subject: 'Board packet', from_name: 'Priya Patel', from_address: 'priya@example.test' },
    });

    const summary = await sendNewMailNotifications(fixture.env as never, 'shared-mailbox-1', 'message-1');

    expect(fixture.messageLookupBindings).toEqual([['message-1', 'shared-mailbox-1']]);
    expect(summary.accepted).toBe(1);
  });

  it('still delivers a generic alert when the message row is missing or the lookup errors', async () => {
    const missing = await notificationDeliveryFixture(201, { messageRow: null });
    expect((await sendNewMailNotifications(missing.env as never, 'shared-mailbox-1', 'message-1')).accepted).toBe(1);

    const failing = await notificationDeliveryFixture(201, { messageLookupFails: true });
    expect((await sendNewMailNotifications(failing.env as never, 'shared-mailbox-1', 'message-1')).accepted).toBe(1);
  });

  it('purges an expired endpoint and rejects malformed delivery IDs before querying recipients', async () => {
    const fixture = await notificationDeliveryFixture(410);

    await sendNewMailNotifications(fixture.env as never, 'shared-mailbox-1', 'message-1');
    expect(fixture.removedEndpoints).toEqual([['subscription-1', 'user-1', fixture.subscription.endpoint]]);

    const queryCount = fixture.queries.length;
    await sendNewMailNotifications(fixture.env as never, 'shared mailbox', 'message-2');
    expect(fixture.queries).toHaveLength(queryCount);
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [201, 'accepted', false],
    [410, 'expired', true],
    [401, 'configuration', false],
    [403, 'configuration', false],
    [429, 'retryable', false],
    [503, 'retryable', false],
    [400, 'rejected', false],
  ])('classifies provider status %s as %s without logging capability data', async (status, result, removed) => {
    const fixture = await notificationDeliveryFixture(status);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const summary = await sendNewMailNotifications(fixture.env as never, 'shared-mailbox-1', 'message-1');

    expect(summary).toMatchObject({ attempted: 1, [result]: 1 });
    expect(fixture.removedEndpoints).toHaveLength(removed ? 1 : 0);
    expect(warning).not.toHaveBeenCalled();
  });

  // RFC 8030 permits a push service to redirect a delivery request (e.g.
  // during infrastructure migration). redirect:'manual' lets delivery
  // observe that instead of fetch() throwing an opaque TypeError that was
  // previously indistinguishable from a genuine transient network failure --
  // silently collapsing a followable redirect into a false 'retryable'.
  it('follows a single redirect to an allowlisted push-service host and delivers there', async () => {
    const fixture = await notificationDeliveryFixture();
    const redirectedEndpoint = 'https://fcm.googleapis.com/fcm/send/redirected-target';
    fixture.fetch.mockReset();
    fixture.fetch
      .mockResolvedValueOnce({ status: 302, headers: new Headers({ Location: redirectedEndpoint }) })
      .mockResolvedValueOnce({ status: 201, headers: new Headers() });

    const summary = await sendNewMailNotifications(fixture.env as never, 'shared-mailbox-1', 'message-1');

    expect(summary).toMatchObject({ attempted: 1, accepted: 1 });
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    expect(fixture.fetch.mock.calls[0][0]).toBe(fixture.subscription.endpoint);
    expect(fixture.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(fixture.fetch.mock.calls[1][0]).toBe(redirectedEndpoint);
    // Bounded to exactly one hop: the retry itself cannot be redirected again.
    expect(fixture.fetch.mock.calls[1][1]).toMatchObject({ redirect: 'error' });
    expect(fixture.removedEndpoints).toHaveLength(0);
  });

  it('rejects, without ever fetching it, a redirect to a host outside the push-service allowlist', async () => {
    const fixture = await notificationDeliveryFixture();
    fixture.fetch.mockReset();
    fixture.fetch.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ Location: 'https://attacker.example/steal' }),
    });

    const summary = await sendNewMailNotifications(fixture.env as never, 'shared-mailbox-1', 'message-1');

    expect(summary).toMatchObject({ attempted: 1, rejected: 1 });
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirect response with a missing or unparsable Location instead of throwing', async () => {
    const fixture = await notificationDeliveryFixture();
    fixture.fetch.mockReset();
    fixture.fetch.mockResolvedValueOnce({ status: 302, headers: new Headers() });

    const summary = await sendNewMailNotifications(fixture.env as never, 'shared-mailbox-1', 'message-1');

    expect(summary).toMatchObject({ attempted: 1, rejected: 1 });
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
  });

  it('treats a second consecutive redirect as a rejection rather than chasing it further', async () => {
    const fixture = await notificationDeliveryFixture();
    fixture.fetch.mockReset();
    fixture.fetch
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ Location: 'https://fcm.googleapis.com/fcm/send/hop-1' }),
      })
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ Location: 'https://fcm.googleapis.com/fcm/send/hop-2' }),
      });

    const summary = await sendNewMailNotifications(fixture.env as never, 'shared-mailbox-1', 'message-1');

    expect(summary).toMatchObject({ attempted: 1, rejected: 1 });
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });

  it('creates an authenticated request whose RFC 8291 payload decrypts for the subscriber', async () => {
    const vapidKeys = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    ) as CryptoKeyPair;
    const vapidPrivateJwk = await crypto.subtle.exportKey('jwk', vapidKeys.privateKey);
    const vapidPublic = new Uint8Array(await crypto.subtle.exportKey('raw', vapidKeys.publicKey));
    expect(vapidPrivateJwk.d).toBeTypeOf('string');

    const subscriberKeys = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    ) as CryptoKeyPair;
    const subscriberPublic = new Uint8Array(await crypto.subtle.exportKey('raw', subscriberKeys.publicKey));
    const authenticationSecret = crypto.getRandomValues(new Uint8Array(16));
    const configuration = {
      publicKey: encodeBase64Url(vapidPublic),
      privateKey: vapidPrivateJwk.d!,
      subject: 'mailto:operator@example.com',
    };
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-subscription',
      p256dh: encodeBase64Url(subscriberPublic),
      auth: encodeBase64Url(authenticationSecret),
    };
    const payload = JSON.stringify({ title: 'cmail', body: 'A new message arrived.', url: '/mail/message-1' });
    const now = Date.UTC(2026, 7, 3, 10, 0, 0);

    const request = await createWebPushRequest(configuration, subscription, payload, now);

    expect(request.endpoint).toBe(subscription.endpoint);
    expect(request.headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '900',
      Urgency: 'high',
    });
    expect(request.headers).not.toHaveProperty('Topic');
    expect(request.body.byteLength).toBeLessThanOrEqual(4096);
    expect(new DataView(request.body.buffer).getUint32(16, false)).toBe(4096);
    expect(request.body[20]).toBe(65);

    const authorization = /^vapid t=([^,]+), k=(.+)$/.exec(request.headers.Authorization);
    expect(authorization).not.toBeNull();
    expect(authorization![2]).toBe(configuration.publicKey);
    const tokenParts = authorization![1].split('.');
    expect(tokenParts).toHaveLength(3);
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(tokenParts[1])));
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(now / 1000) + 12 * 60 * 60,
      sub: configuration.subject,
    });
    expect(await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      vapidKeys.publicKey,
      asArrayBuffer(decodeBase64Url(tokenParts[2])),
      asArrayBuffer(encoder.encode(`${tokenParts[0]}.${tokenParts[1]}`)),
    )).toBe(true);

    const salt = request.body.slice(0, 16);
    const serverPublic = request.body.slice(21, 86);
    const serverPublicKey = await crypto.subtle.importKey(
      'raw',
      serverPublic,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'ECDH', public: serverPublicKey },
      subscriberKeys.privateKey,
      256,
    ));
    const keyInfo = concatenate(
      encoder.encode('WebPush: info'),
      new Uint8Array([0]),
      subscriberPublic,
      serverPublic,
    );
    const inputKeyMaterial = await deriveHkdf(sharedSecret, authenticationSecret, keyInfo, 32);
    const contentEncryptionKey = await deriveHkdf(
      inputKeyMaterial,
      salt,
      concatenate(encoder.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])),
      16,
    );
    const nonce = await deriveHkdf(
      inputKeyMaterial,
      salt,
      concatenate(encoder.encode('Content-Encoding: nonce'), new Uint8Array([0])),
      12,
    );
    const decryptionKey = await crypto.subtle.importKey(
      'raw',
      asArrayBuffer(contentEncryptionKey),
      'AES-GCM',
      false,
      ['decrypt'],
    );
    const plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asArrayBuffer(nonce), tagLength: 128 },
      decryptionKey,
      request.body.slice(86),
    ));
    expect(plaintext.at(-1)).toBe(0x02);
    expect(new TextDecoder().decode(plaintext.slice(0, -1))).toBe(payload);

    const secondRequest = await createWebPushRequest(configuration, subscription, payload, now);
    expect(Array.from(secondRequest.body.slice(0, 16))).not.toEqual(Array.from(request.body.slice(0, 16)));
    expect(Array.from(secondRequest.body.slice(21, 86))).not.toEqual(Array.from(request.body.slice(21, 86)));

    const largestRequest = await createWebPushRequest(configuration, subscription, 'x'.repeat(3993), now);
    expect(largestRequest.body.byteLength).toBe(4096);
    await expect(createWebPushRequest(configuration, subscription, 'x'.repeat(3994), now))
      .rejects.toThrow('Web Push payload is too large');
    await expect(createWebPushRequest(configuration, subscription, '😀'.repeat(999), now))
      .rejects.toThrow('Web Push payload is too large');
  });
});
