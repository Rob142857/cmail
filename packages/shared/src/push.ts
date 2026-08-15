export interface PushEnvironment {
  DB: D1Database;
  APP_NAME?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  PUSH_ENDPOINT_HOSTS?: string;
}

export interface PushConfiguration {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface WebPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface StoredPushSubscription extends WebPushSubscription {
  id: string;
  user_id: string;
}

export interface WebPushRequest {
  endpoint: string;
  headers: Record<string, string>;
  body: Uint8Array<ArrayBuffer>;
}

export type PushDeliveryResult = 'accepted' | 'expired' | 'configuration' | 'retryable' | 'rejected' | 'invalid';

export interface PushDeliverySummary {
  attempted: number;
  accepted: number;
  expired: number;
  configuration: number;
  retryable: number;
  rejected: number;
  invalid: number;
}

interface NewMailNotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

const DEFAULT_PUSH_HOSTS = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

const encoder = new TextEncoder();
const PUSH_RECORD_SIZE = 4096;
const PUSH_HEADER_SIZE = 86;
const MAX_PUSH_PLAINTEXT = PUSH_RECORD_SIZE - PUSH_HEADER_SIZE - 16 - 1;
const PUSH_TTL_SECONDS = 15 * 60;

class InvalidPushSubscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPushSubscriptionError';
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function opaqueNotificationId(value: string): string | null {
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(trimmed) ? trimmed : null;
}

/**
 * Keep lock-screen payloads content-free while retaining enough opaque context
 * to take an authorised recipient to the correct personal or shared mailbox.
 */
export function newMailNotificationPayload(
  appName: string | undefined,
  mailboxId: string,
  messageId: string,
): NewMailNotificationPayload | null {
  const mailbox = opaqueNotificationId(mailboxId);
  const message = opaqueNotificationId(messageId);
  if (!mailbox || !message) return null;
  const title = text(appName).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) || 'cmail';
  return {
    title,
    body: 'A new message arrived.',
    url: `/mail/${encodeURIComponent(message)}?mailbox=${encodeURIComponent(mailbox)}`,
    // One tag per opaque delivery suppresses retries without collapsing alerts
    // for different messages or mailboxes shared with the same person.
    tag: `cmail:${mailbox}:${message}`,
  };
}

function validVapidSubject(value: string): boolean {
  if (!value || value.length > 300 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!value || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError('Invalid base64url value');
  }
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const decoded = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) decoded[index] = binary.charCodeAt(index);
  if (encodeBase64Url(decoded) !== value) throw new TypeError('Non-canonical base64url value');
  return decoded;
}

function concatenate(...values: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(values.reduce((length, value) => length + value.byteLength, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function validVapidKeyShape(publicKey: string, privateKey: string): boolean {
  try {
    const publicBytes = decodeBase64Url(publicKey);
    const privateBytes = decodeBase64Url(privateKey);
    return publicBytes.byteLength === 65 && publicBytes[0] === 0x04 && privateBytes.byteLength === 32;
  } catch {
    return false;
  }
}

export function pushConfiguration(env: Partial<PushEnvironment>): PushConfiguration | null {
  const publicKey = text(env.VAPID_PUBLIC_KEY);
  const privateKey = text(env.VAPID_PRIVATE_KEY);
  const subject = text(env.VAPID_SUBJECT);
  if (!validVapidKeyShape(publicKey, privateKey)) return null;
  if (!validVapidSubject(subject)) return null;
  return { publicKey, privateKey, subject };
}

export function publicPushKey(env: Partial<PushEnvironment>): string {
  return pushConfiguration(env)?.publicKey || '';
}

export function configuredPushHosts(env: Partial<PushEnvironment>): string[] {
  const additions = text(env.PUSH_ENDPOINT_HOSTS)
    .split(',')
    .map((host) => host.trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter((host) => /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(host));
  return [...new Set([...DEFAULT_PUSH_HOSTS, ...additions])];
}

export function isAllowedPushEndpoint(value: unknown, env: Partial<PushEnvironment>): value is string {
  if (typeof value !== 'string' || value.length < 20 || value.length > 2048) return false;
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) return false;
    if (endpoint.port && endpoint.port !== '443') return false;
    const hostname = endpoint.hostname.toLowerCase();
    return configuredPushHosts(env).some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

async function deriveHkdf(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  byteLength: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', asArrayBuffer(inputKeyMaterial), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: asArrayBuffer(salt),
    info: asArrayBuffer(info),
  }, key, byteLength * 8);
  return new Uint8Array(bits);
}

async function createVapidAuthorization(
  configuration: PushConfiguration,
  audience: string,
  now: number,
): Promise<string> {
  const publicKey = decodeBase64Url(configuration.publicKey);
  const privateKey = decodeBase64Url(configuration.privateKey);
  if (publicKey.byteLength !== 65 || publicKey[0] !== 0x04 || privateKey.byteLength !== 32) {
    throw new TypeError('Invalid VAPID key material');
  }

  const x = encodeBase64Url(publicKey.subarray(1, 33));
  const y = encodeBase64Url(publicKey.subarray(33, 65));
  const signingKey = await crypto.subtle.importKey('jwk', {
    kty: 'EC',
    crv: 'P-256',
    x,
    y,
    d: configuration.privateKey,
    ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const header = encodeBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = encodeBase64Url(encoder.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: configuration.subject,
  })));
  const unsignedToken = `${header}.${claims}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    asArrayBuffer(encoder.encode(unsignedToken)),
  ));
  if (signature.byteLength !== 64) throw new TypeError('Unexpected ES256 signature format');
  return `vapid t=${unsignedToken}.${encodeBase64Url(signature)}, k=${configuration.publicKey}`;
}

function parseSubscription(subscription: WebPushSubscription): {
  endpoint: URL;
  publicKey: Uint8Array<ArrayBuffer>;
  authenticationSecret: Uint8Array<ArrayBuffer>;
} {
  let endpoint: URL;
  let publicKey: Uint8Array<ArrayBuffer>;
  let authenticationSecret: Uint8Array<ArrayBuffer>;
  try {
    endpoint = new URL(subscription.endpoint);
    publicKey = decodeBase64Url(subscription.p256dh);
    authenticationSecret = decodeBase64Url(subscription.auth);
  } catch {
    throw new InvalidPushSubscriptionError('Malformed push subscription');
  }
  if (
    endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash ||
    publicKey.byteLength !== 65 || publicKey[0] !== 0x04 || authenticationSecret.byteLength !== 16
  ) {
    throw new InvalidPushSubscriptionError('Invalid push subscription');
  }
  return { endpoint, publicKey, authenticationSecret };
}

export async function createWebPushRequest(
  configuration: PushConfiguration,
  subscription: WebPushSubscription,
  payload: string,
  now = Date.now(),
): Promise<WebPushRequest> {
  const parsed = parseSubscription(subscription);
  const payloadBytes = encoder.encode(payload);
  if (payloadBytes.byteLength > MAX_PUSH_PLAINTEXT) throw new RangeError('Web Push payload is too large');

  let clientPublicKey: CryptoKey;
  try {
    clientPublicKey = await crypto.subtle.importKey(
      'raw',
      asArrayBuffer(parsed.publicKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
  } catch {
    throw new InvalidPushSubscriptionError('Invalid subscription public key');
  }

  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  ) as CryptoKeyPair;
  const serverPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeyPair.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey },
    serverKeyPair.privateKey,
    256,
  ));

  const keyInfo = concatenate(
    encoder.encode('WebPush: info'),
    new Uint8Array([0]),
    parsed.publicKey,
    serverPublicKey,
  );
  const inputKeyMaterial = await deriveHkdf(sharedSecret, parsed.authenticationSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
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
  const encryptionKey = await crypto.subtle.importKey(
    'raw',
    asArrayBuffer(contentEncryptionKey),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const record = concatenate(payloadBytes, new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv: asArrayBuffer(nonce),
    tagLength: 128,
  }, encryptionKey, asArrayBuffer(record)));

  const header = new Uint8Array(PUSH_HEADER_SIZE);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, PUSH_RECORD_SIZE, false);
  header[20] = serverPublicKey.byteLength;
  header.set(serverPublicKey, 21);
  const body = concatenate(header, ciphertext);
  if (body.byteLength > PUSH_RECORD_SIZE) throw new RangeError('Web Push body is too large');

  const authorization = await createVapidAuthorization(configuration, parsed.endpoint.origin, now);
  return {
    endpoint: parsed.endpoint.href,
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(PUSH_TTL_SECONDS),
      Urgency: 'high',
    },
    body,
  };
}

async function removeSubscription(db: D1Database, subscription: StoredPushSubscription): Promise<void> {
  await db.prepare(
    'DELETE FROM push_subscriptions WHERE id = ? AND user_id = ? AND endpoint = ?',
  ).bind(subscription.id, subscription.user_id, subscription.endpoint).run().catch(() => undefined);
}

function emptyDeliverySummary(): PushDeliverySummary {
  return { attempted: 0, accepted: 0, expired: 0, configuration: 0, retryable: 0, rejected: 0, invalid: 0 };
}

function addDeliveryResult(summary: PushDeliverySummary, result: PushDeliveryResult): void {
  summary.attempted += 1;
  summary[result] += 1;
}

async function deliver(
  env: PushEnvironment,
  configuration: PushConfiguration,
  subscription: StoredPushSubscription,
  payload: string,
): Promise<PushDeliveryResult> {
  if (!isAllowedPushEndpoint(subscription.endpoint, env)) {
    await removeSubscription(env.DB, subscription);
    return 'invalid';
  }

  let request: WebPushRequest;
  try {
    request = await createWebPushRequest(configuration, subscription, payload);
  } catch (error) {
    if (error instanceof InvalidPushSubscriptionError) {
      await removeSubscription(env.DB, subscription);
    }
    return 'invalid';
  }

  try {
    const response = await fetch(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      redirect: 'error',
    });
    if (response.status >= 200 && response.status < 300) return 'accepted';
    if (response.status === 404 || response.status === 410) {
      await removeSubscription(env.DB, subscription);
      return 'expired';
    }
    if (response.status === 401 || response.status === 403) return 'configuration';
    if (response.status === 429 || response.status >= 500) return 'retryable';
    return 'rejected';
  } catch {
    // Push is best-effort. Network failures must never reject mail delivery.
    return 'retryable';
  }
}

async function deliverSubscriptions(
  env: PushEnvironment,
  configuration: PushConfiguration,
  subscriptions: StoredPushSubscription[],
  payload: string,
): Promise<PushDeliverySummary> {
  const summary = emptyDeliverySummary();
  for (let index = 0; index < subscriptions.length; index += 8) {
    const results = await Promise.all(subscriptions.slice(index, index + 8).map((subscription) =>
      deliver(env, configuration, subscription, payload)));
    for (const result of results) addDeliveryResult(summary, result);
  }
  return summary;
}

function testNotificationPayload(appName: string | undefined): NewMailNotificationPayload {
  const title = text(appName).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 72) || 'cmail';
  return { title, body: 'Test alert: notifications are working.', url: '/mail', tag: 'cmail:test:alert' };
}

export async function sendNewMailNotifications(
  env: PushEnvironment,
  mailboxId: string,
  messageId: string,
): Promise<PushDeliverySummary> {
  const configuration = pushConfiguration(env);
  if (!configuration) return { ...emptyDeliverySummary(), configuration: 1 };
  const notification = newMailNotificationPayload(env.APP_NAME, mailboxId, messageId);
  if (!notification) return emptyDeliverySummary();

  let subscriptions: StoredPushSubscription[] = [];
  try {
    const result = await env.DB.prepare(
      `SELECT DISTINCT ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       INNER JOIN users u ON u.id = ps.user_id AND u.status = 'active'
       INNER JOIN mailbox_assignments ma ON ma.user_id = ps.user_id
       INNER JOIN mailboxes mailbox ON mailbox.id = ma.mailbox_id AND mailbox.status = 'active'
       WHERE ma.mailbox_id = ?
       ORDER BY ps.updated_at DESC
       LIMIT 500`,
    ).bind(mailboxId).all<StoredPushSubscription>();
    // DISTINCT is enforced in D1 as the primary guard. The second bounded
    // dedupe keeps a malformed adapter/mock/result set from sending the same
    // browser endpoint twice for one delivery.
    subscriptions = [...new Map((result.results || []).map((subscription) => [
      subscription.endpoint,
      subscription,
    ])).values()];
  } catch {
    // A deployment that has not applied the optional migration fails closed.
    return emptyDeliverySummary();
  }

  const payload = JSON.stringify(notification);

  // Bound concurrent external requests so a heavily shared mailbox cannot
  // turn one inbound delivery into an unbounded fan-out burst.
  return deliverSubscriptions(env, configuration, subscriptions, payload);
}

/** Send a generic alert to the signed-in user's own browser subscriptions. */
export async function sendTestPushNotification(
  env: PushEnvironment,
  userId: string,
  deviceId: string,
  endpoint: string,
): Promise<PushDeliverySummary> {
  const configuration = pushConfiguration(env);
  if (!configuration) return { ...emptyDeliverySummary(), configuration: 1 };

  let subscriptions: StoredPushSubscription[] = [];
  try {
    const result = await env.DB.prepare(
      `SELECT id, user_id, endpoint, p256dh, auth
       FROM push_subscriptions
       WHERE user_id = ? AND device_id = ? AND endpoint = ?
       LIMIT 1`,
    ).bind(userId, deviceId, endpoint).all<StoredPushSubscription>();
    subscriptions = result.results || [];
  } catch {
    return { ...emptyDeliverySummary(), retryable: 1 };
  }
  return deliverSubscriptions(env, configuration, subscriptions, JSON.stringify(testNotificationPayload(env.APP_NAME)));
}
