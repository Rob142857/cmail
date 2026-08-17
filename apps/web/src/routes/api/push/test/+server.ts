import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAllowedPushEndpoint, pushConfigurationDiagnostic, sendTestPushNotification } from '@cmail/shared/push';
import { consumeRateLimit } from '$lib/server/rate-limit';

const RESPONSE_HEADERS = { 'Cache-Control': 'private, no-store' };
const TEST_LIMIT = 3;
const TEST_WINDOW_SECONDS = 60 * 60;
const MAX_REQUEST_BYTES = 4_096;

function deviceId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
}

function response(result: string, status: number, diagnostic?: string, extraHeaders: Record<string, string> = {}) {
  return json({ result, ...(diagnostic ? { diagnostic } : {}) }, { status, headers: { ...RESPONSE_HEADERS, ...extraHeaders } });
}

async function readTarget(request: Request): Promise<{ endpoint?: unknown; device_id?: unknown }> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new TypeError('content-type');
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) throw new RangeError('request-size');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_REQUEST_BYTES) throw new RangeError('request-size');
  return JSON.parse(new TextDecoder().decode(bytes)) as { endpoint?: unknown; device_id?: unknown };
}

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  const env = platform?.env;
  if (!locals.user) return response('unauthenticated', 401);
  if (locals.user.status !== 'active') return response('inactive', 403);
  if (!env) return response('configuration', 503, 'runtime_unavailable');
  let payload: { endpoint?: unknown; device_id?: unknown };
  try {
    payload = await readTarget(request);
  } catch (error) {
    return response(error instanceof RangeError ? 'request_too_large' : 'invalid_request', error instanceof RangeError ? 413 : 400);
  }
  if (!isAllowedPushEndpoint(payload?.endpoint, env) || !deviceId(payload?.device_id)) {
    return response('no_subscription', 409);
  }

  const configuration = pushConfigurationDiagnostic(env);
  if (configuration !== 'ready') return response('configuration', 503, configuration);

  let rate;
  try {
    rate = await consumeRateLimit(env.DB, 'push-test', locals.user.id, TEST_LIMIT, TEST_WINDOW_SECONDS);
  } catch {
    return response('transient', 503, 'rate_limit_store_unavailable');
  }
  if (!rate.allowed) return response('rate_limited', 429, undefined, { 'Retry-After': String(rate.retryAfter) });

  const summary = await sendTestPushNotification(env, locals.user.id, payload.device_id, payload.endpoint);
  if (summary.accepted > 0) return response('accepted', 200);
  if (summary.configuration > 0) return response('configuration', 503, 'push_configuration_rejected');
  if (summary.retryable > 0) return response('transient', 503, 'push_service_unavailable');
  if (summary.expired > 0) return response('expired', 409);
  if (summary.rejected > 0 || summary.invalid > 0) return response('rejected', 409);
  return response('no_subscription', 409);
};
