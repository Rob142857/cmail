import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAllowedPushEndpoint, pushConfiguration } from '@cmail/shared/push';
import { generateId } from '$lib/server/db';

const RESPONSE_HEADERS = { 'Cache-Control': 'private, no-store' };
const MAX_SUBSCRIPTIONS_PER_USER = 5;
const MAX_REQUEST_BYTES = 10_000;

function requestTooLarge(request: Request): boolean {
  const length = Number(request.headers.get('content-length'));
  return Number.isFinite(length) && length > MAX_REQUEST_BYTES;
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new TypeError('content-type');
  }
  if (requestTooLarge(request)) throw new RangeError('request-size');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_REQUEST_BYTES) throw new RangeError('request-size');
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SyntaxError('json');
  }
}

function base64Url(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string'
    && value.length >= min
    && value.length <= max
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function deviceId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
}

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  const env = platform?.env;
  if (!locals.user) return json({ error: 'Authentication required' }, { status: 401, headers: RESPONSE_HEADERS });
  if (locals.user.status !== 'active') return json({ error: 'New-mail alerts are available after account activation' }, { status: 403, headers: RESPONSE_HEADERS });
  if (!env || !pushConfiguration(env)) return json({ error: 'Push notifications are not configured' }, { status: 404, headers: RESPONSE_HEADERS });
  let rawPayload: unknown;
  try {
    rawPayload = await readJson(request);
  } catch (error) {
    const status = error instanceof RangeError ? 413 : error instanceof TypeError ? 415 : 400;
    return json({ error: status === 413 ? 'Subscription request is too large' : 'A valid JSON subscription is required' }, { status, headers: RESPONSE_HEADERS });
  }
  const payload = rawPayload as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
    device_id?: unknown;
    enable?: unknown;
  } | null;
  const endpoint = payload?.endpoint;
  const p256dh = payload?.keys?.p256dh;
  const auth = payload?.keys?.auth;
  const device = payload?.device_id;
  const explicitEnable = payload?.enable === true;
  if (!isAllowedPushEndpoint(endpoint, env) || !base64Url(p256dh, 40, 180) || !base64Url(auth, 8, 100) || !deviceId(device)) {
    return json({ error: 'The browser returned an invalid push subscription' }, { status: 400, headers: RESPONSE_HEADERS });
  }

  try {
    if (explicitEnable) {
      // D1 batch executes atomically: only a direct Turn on clears the
      // server-side device block before writing a new browser capability.
      await env.DB.batch([
        env.DB.prepare(
          'DELETE FROM push_device_preferences WHERE user_id = ? AND device_id = ?',
        ).bind(locals.user.id, device),
        env.DB.prepare(
          `INSERT INTO push_subscriptions (id, user_id, device_id, endpoint, p256dh, auth, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(endpoint) DO UPDATE SET
             user_id = excluded.user_id,
             device_id = excluded.device_id,
             p256dh = excluded.p256dh,
             auth = excluded.auth,
             updated_at = datetime('now')`,
        ).bind(generateId(), locals.user.id, device, endpoint, p256dh, auth),
      ]);
    } else {
      // The marker test is part of the write. A stale worker cannot race an
      // opt-out by reading before its marker commits and inserting afterwards.
      const result = await env.DB.prepare(
        `INSERT INTO push_subscriptions (id, user_id, device_id, endpoint, p256dh, auth, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
         WHERE NOT EXISTS (
           SELECT 1 FROM push_device_preferences WHERE user_id = ? AND device_id = ?
         )
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           device_id = excluded.device_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           updated_at = datetime('now')
         WHERE NOT EXISTS (
           SELECT 1 FROM push_device_preferences WHERE user_id = ? AND device_id = ?
         )`,
      ).bind(
        generateId(), locals.user.id, device, endpoint, p256dh, auth,
        locals.user.id, device, locals.user.id, device,
      ).run();
      if (!Number(result.meta.changes || 0)) {
        await env.DB.prepare(
          'DELETE FROM push_subscriptions WHERE user_id = ? AND device_id = ?',
        ).bind(locals.user.id, device).run();
        return json({ error: 'New-mail alerts are disabled on this device. Select Turn on to enable them.' }, { status: 409, headers: RESPONSE_HEADERS });
      }
    }

    await env.DB.prepare(
      `DELETE FROM push_subscriptions
       WHERE user_id = ? AND id NOT IN (
         SELECT id FROM push_subscriptions
         WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?
       )`,
    ).bind(locals.user.id, locals.user.id, MAX_SUBSCRIPTIONS_PER_USER).run();
  } catch {
    return json({ error: 'The subscription could not be saved' }, { status: 503, headers: RESPONSE_HEADERS });
  }

  return json({ enabled: true }, { headers: RESPONSE_HEADERS });
};

export const DELETE: RequestHandler = async ({ request, locals, platform }) => {
  const env = platform?.env;
  if (!locals.user) return json({ error: 'Authentication required' }, { status: 401, headers: RESPONSE_HEADERS });
  if (!env) return json({ error: 'The subscription could not be removed' }, { status: 503, headers: RESPONSE_HEADERS });
  let rawPayload: unknown;
  try {
    rawPayload = await readJson(request);
  } catch (error) {
    const status = error instanceof RangeError ? 413 : error instanceof TypeError ? 415 : 400;
    return json({ error: 'A valid JSON subscription is required' }, { status, headers: RESPONSE_HEADERS });
  }
  const payload = rawPayload as { endpoint?: unknown; device_id?: unknown; disable?: unknown } | null;
  const endpoint = payload?.endpoint;
  const device = payload?.device_id;
  const disable = payload?.disable === true;
  if ((!disable && (typeof endpoint !== 'string' || endpoint.length > 2048)) || !deviceId(device)) {
    return json({ error: 'The subscription is invalid' }, { status: 400, headers: RESPONSE_HEADERS });
  }
  try {
    if (disable) {
      const statements = [
        env.DB.prepare(
          `INSERT INTO push_device_preferences (user_id, device_id, disabled_at, updated_at)
           VALUES (?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(user_id, device_id) DO UPDATE SET disabled_at = datetime('now'), updated_at = datetime('now')`,
        ).bind(locals.user.id, device),
        env.DB.prepare(
          'DELETE FROM push_subscriptions WHERE user_id = ? AND device_id = ?',
        ).bind(locals.user.id, device),
      ];
      // Pre-0009 subscriptions have a NULL device_id. When the browser still
      // knows that legacy endpoint, remove it in the same transaction too.
      if (typeof endpoint === 'string') {
        statements.push(env.DB.prepare(
          'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
        ).bind(locals.user.id, endpoint));
      }
      await env.DB.batch(statements);
    } else {
      await env.DB.prepare(
        'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
      ).bind(locals.user.id, endpoint).run();
    }
  } catch {
    return json({ error: 'The subscription could not be removed' }, { status: 503, headers: RESPONSE_HEADERS });
  }
  return json({ enabled: false }, { headers: RESPONSE_HEADERS });
};
