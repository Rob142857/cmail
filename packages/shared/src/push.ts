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

/** Safe operator-facing state only; never return key material or endpoint data. */
export type PushConfigurationDiagnostic = 'ready' | 'vapid_not_configured' | 'vapid_invalid';

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

// Strip ASCII control characters (C0 controls 0-31 and DEL/127) from
// notification text. Built from character codes so the intent stays
// unambiguous rather than relying on a dense escape-range literal.
const CONTROL_CHARACTER_PATTERN = new RegExp(
  '[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']',
  'g',
);
const NOTIFICATION_TITLE_MAX_LENGTH = 60;
const NOTIFICATION_BODY_MAX_LENGTH = 120;

function sanitizeNotificationText(value: unknown, maxLength: number): string {
  return text(value).replace(CONTROL_CHARACTER_PATTERN, '').slice(0, maxLength);
}

/**
 * Build the lock-screen payload for a new-mail alert. When the caller (see
 * sendNewMailNotifications) supplies the message's sender and subject, they
 * become the title and body -- each falls back individually (sender -> app
 * name, subject -> 'New message') if empty. When sender/subject are omitted
 * entirely, e.g. because the row lookup failed or was skipped, the alert
 * falls back to the original generic, content-free text so a lookup problem
 * never blocks the notification itself. url/tag always carry only opaque
 * IDs, enough to take an authorised recipient to the correct personal or
 * shared mailbox.
 */
export function newMailNotificationPayload(
  appName: string | undefined,
  mailboxId: string,
  messageId: string,
  sender?: string,
  subject?: string,
): NewMailNotificationPayload | null {
  const mailbox = opaqueNotificationId(mailboxId);
  const message = opaqueNotificationId(messageId);
  if (!mailbox || !message) return null;
  const url = `/mail/${encodeURIComponent(message)}?mailbox=${encodeURIComponent(mailbox)}`;
  // One tag per opaque delivery suppresses retries without collapsing alerts
  // for different messages or mailboxes shared with the same person.
  const tag = `cmail:${mailbox}:${message}`;
  const appTitle = sanitizeNotificationText(appName, NOTIFICATION_TITLE_MAX_LENGTH) || 'cmail';
  if (sender === undefined && subject === undefined) {
    return { title: appTitle, body: 'A new message arrived.', url, tag };
  }
  const senderTitle = sanitizeNotificationText(sender, NOTIFICATION_TITLE_MAX_LENGTH);
  const subjectBody = sanitizeNotificationText(subject, NOTIFICATION_BODY_MAX_LENGTH);
  return {
    title: senderTitle || appTitle,
    body: subjectBody || 'New message',
    url,
    tag,
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

export function pushConfigurationDiagnostic(env: Partial<PushEnvironment>): PushConfigurationDiagnostic {
  const publicKey = text(env.VAPID_PUBLIC_KEY);
  const privateKey = text(env.VAPID_PRIVATE_KEY);
  const subject = text(env.VAPID_SUBJECT);
  if (!publicKey || !privateKey || !subject) return 'vapid_not_configured';
  return pushConfiguration(env) ? 'ready' : 'vapid_invalid';
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

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

function classifyPushResponseStatus(status: number): PushDeliveryResult | 'redirect' {
  if (status >= 200 && status < 300) return 'accepted';
  if (status === 404 || status === 410) return 'expired';
  if (status === 401 || status === 403) return 'configuration';
  if (status === 429 || status >= 500) return 'retryable';
  if (REDIRECT_STATUS_CODES.has(status)) return 'redirect';
  return 'rejected';
}

function resolveRedirectTarget(location: string, base: string): string | null {
  try {
    return new URL(location, base).href;
  } catch {
    return null;
  }
}

async function postWebPushRequest(request: WebPushRequest, redirectMode: 'manual' | 'error'): Promise<Response> {
  return fetch(request.endpoint, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    redirect: redirectMode,
  });
}

/**
 * Push services are explicitly permitted (RFC 8030) to redirect a delivery
 * request -- e.g. during infrastructure migrations -- and a client that
 * cannot handle that is expected to treat it as a delivery attempt like any
 * other. redirect:'error' turned that case into an opaque, unlogged
 * TypeError thrown by fetch() itself, indistinguishable from a genuine
 * network failure, so a legitimate redirect and a real transient outage both
 * silently collapsed into the same 'retryable' outcome with no diagnostic
 * trail. redirect:'manual' lets this code see the redirect instead. The
 * Location is re-validated against the SAME endpoint-host allowlist used for
 * the original subscription before it is ever followed -- and followed at
 * most once, with redirect:'error' on the retry -- so this cannot become an
 * open redirect / SSRF vector: an unlisted or unparsable target is rejected,
 * never fetched.
 */
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
    const response = await postWebPushRequest(request, 'manual');
    const outcome = classifyPushResponseStatus(response.status);
    if (outcome !== 'redirect') {
      if (outcome === 'expired') await removeSubscription(env.DB, subscription);
      return outcome;
    }

    const location = response.headers.get('Location');
    const target = location && resolveRedirectTarget(location, request.endpoint);
    if (!target || !isAllowedPushEndpoint(target, env)) return 'rejected';

    const redirected = await createWebPushRequest(
      configuration,
      { endpoint: target, p256dh: subscription.p256dh, auth: subscription.auth },
      payload,
    );
    const followUp = await postWebPushRequest(redirected, 'error');
    // A second consecutive redirect is rejected outright rather than chased.
    const followOutcome = classifyPushResponseStatus(followUp.status);
    if (followOutcome === 'expired') await removeSubscription(env.DB, subscription);
    return followOutcome === 'redirect' ? 'rejected' : followOutcome;
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

export async function sendNewMailNotifications(
  env: PushEnvironment,
  mailboxId: string,
  messageId: string,
): Promise<PushDeliverySummary> {
  const configuration = pushConfiguration(env);
  if (!configuration) return { ...emptyDeliverySummary(), configuration: 1 };
  if (!opaqueNotificationId(mailboxId) || !opaqueNotificationId(messageId)) return emptyDeliverySummary();

  // Best-effort lookup of the sender/subject to show on the lock screen.
  // Any failure here -- including a message row that is not yet visible to
  // this read -- must fall back to the original generic alert rather than
  // skip sending or reject the (already-delivered) mail.
  let sender: string | undefined;
  let subject: string | undefined;
  try {
    const row = await env.DB.prepare(
      'SELECT subject, from_name, from_address FROM messages WHERE id = ? AND mailbox_id = ? LIMIT 1',
    ).bind(messageId, mailboxId).first<{ subject: string; from_name: string; from_address: string }>();
    if (row) {
      subject = row.subject;
      sender = row.from_name || row.from_address;
    }
  } catch {
    // Leave sender/subject undefined; newMailNotificationPayload falls back
    // to the generic alert below.
  }

  const notification = newMailNotificationPayload(env.APP_NAME, mailboxId, messageId, sender, subject);
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
