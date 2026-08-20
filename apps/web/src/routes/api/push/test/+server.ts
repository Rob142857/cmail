import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAllowedPushEndpoint, pushConfigurationDiagnostic, sendTestPushNotification } from '@cmail/shared/push';
import { consumeRateLimit } from '$lib/server/rate-limit';

const RESPONSE_HEADERS = { 'Cache-Control': 'private, no-store' };
const TEST_LIMIT = 3;
const TEST_WINDOW_SECONDS = 60 * 60;
const MAX_REQUEST_BYTES = 4_096;
const WORKER_DIAGNOSTIC_TIMEOUT_MS = 3_000;

type WorkerPushStatus = 'ready' | 'vapid_not_configured' | 'vapid_invalid' | 'unreachable';

function deviceId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
}

function response(
  result: string,
  status: number,
  diagnostic?: string,
  extraHeaders: Record<string, string> = {},
  extraBody: Record<string, unknown> = {},
) {
  return json(
    { result, ...extraBody, ...(diagnostic ? { diagnostic } : {}) },
    { status, headers: { ...RESPONSE_HEADERS, ...extraHeaders } },
  );
}

/**
 * The web runtime's own VAPID configuration (checked above via
 * pushConfigurationDiagnostic) only proves this half of push is set up. Real
 * new-mail alerts are sent by the email Worker runtime, which holds its own,
 * independently-configured copy of the same VAPID keys. This asks that
 * runtime for its own three-state diagnostic over the private service
 * binding, mirroring how lib/server/outbound.ts's sendViaCloudflareService
 * reaches the same Worker for outbound mail. Best-effort: an unreachable or
 * slow Worker must never fail the (already-sent) web-side test.
 */
async function workerPushDiagnostic(env: App.Platform['env']): Promise<WorkerPushStatus> {
  const service = env.EMAIL_SERVICE;
  if (!service || typeof service.fetch !== 'function') return 'unreachable';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_DIAGNOSTIC_TIMEOUT_MS);
  try {
    const result = await service.fetch('https://cmail-email-worker.internal/internal/push-diagnostic', {
      method: 'POST',
      signal: controller.signal,
    });
    if (!result.ok) return 'unreachable';
    const data = await result.json() as { status?: unknown };
    return data.status === 'ready' || data.status === 'vapid_not_configured' || data.status === 'vapid_invalid'
      ? data.status
      : 'unreachable';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timeout);
  }
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
  if (summary.accepted > 0) {
    // Only worth asking once the web half actually sent something — the
    // client only surfaces this on top of a successful "Accepted" result.
    const workerPush = await workerPushDiagnostic(env);
    return response('accepted', 200, undefined, {}, { workerPush });
  }
  if (summary.configuration > 0) return response('configuration', 503, 'push_configuration_rejected');
  if (summary.retryable > 0) return response('transient', 503, 'push_service_unavailable');
  if (summary.expired > 0) return response('expired', 409);
  if (summary.rejected > 0 || summary.invalid > 0) return response('rejected', 409);
  return response('no_subscription', 409);
};
