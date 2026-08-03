import { describe, expect, it } from 'vitest';
import {
  createWebPushRequest,
  configuredPushHosts,
  isAllowedPushEndpoint,
  publicPushKey,
  pushConfiguration,
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
      TTL: '300',
      Urgency: 'normal',
      Topic: 'cmail-new-mail',
    });
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
