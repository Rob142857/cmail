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

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  const env = platform?.env;
  if (!locals.user) return json({ error: 'Authentication required' }, { status: 401, headers: RESPONSE_HEADERS });
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
  } | null;
  const endpoint = payload?.endpoint;
  const p256dh = payload?.keys?.p256dh;
  const auth = payload?.keys?.auth;
  if (!isAllowedPushEndpoint(endpoint, env) || !base64Url(p256dh, 40, 180) || !base64Url(auth, 8, 100)) {
    return json({ error: 'The browser returned an invalid push subscription' }, { status: 400, headers: RESPONSE_HEADERS });
  }

  try {
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         updated_at = datetime('now')`,
    ).bind(generateId(), locals.user.id, endpoint, p256dh, auth).run();

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
  const payload = rawPayload as { endpoint?: unknown } | null;
  const endpoint = payload?.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 2048) {
    return json({ error: 'The subscription is invalid' }, { status: 400, headers: RESPONSE_HEADERS });
  }
  await env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
  ).bind(locals.user.id, endpoint).run().catch(() => undefined);
  return json({ enabled: false }, { headers: RESPONSE_HEADERS });
};
