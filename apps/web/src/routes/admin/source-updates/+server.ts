import { error, json } from '@sveltejs/kit';
import {
  checkSourceUpdates, DEFAULT_REPOSITORY, procedureUrl, type Build, type UpdateStatus,
} from '#lib/server/source-updates.js';
import type { RequestHandler } from './$types';

declare const __CMAIL_BUILD__: Build;
const HIT_TTL_S = 60 * 60;
const MISS_TTL_S = 10 * 60;
let cached: { key: string; expires: number; value: Promise<UpdateStatus> } | undefined;

/** The edge cache outlives single isolates, so one colo asks GitHub about once an hour. */
function edgeCache(): Cache | null {
  try { return (globalThis as { caches?: { default?: Cache } }).caches?.default || null; } catch { return null; }
}

async function check(build: Build, repository: string): Promise<UpdateStatus> {
  const cache = edgeCache();
  const key = `https://cmail-update-check.invalid/v2?repo=${encodeURIComponent(repository)}&rev=${encodeURIComponent(build.revision)}`;
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return await hit.json() as UpdateStatus;
    } catch { /* Cache trouble only costs a fresh check. */ }
  }
  const status = await checkSourceUpdates(build, repository);
  if (cache) {
    const ttl = status.checkedAt ? HIT_TTL_S : MISS_TTL_S;
    try {
      await cache.put(key, new Response(JSON.stringify(status), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` },
      }));
    } catch { /* Ignore. */ }
  }
  return status;
}

export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!locals.user) throw error(401, 'Sign in required');
  if (locals.user.role !== 'manager') throw error(403, 'Manager access required');
  const env = platform?.env;
  const repository = env?.REPO_URL?.trim() || DEFAULT_REPOSITORY;
  if (/^(off|false|0|no)$/i.test(env?.UPDATE_CHECK?.trim() || '')) {
    const disabled: UpdateStatus = {
      build: __CMAIL_BUILD__, status: 'disabled', ahead: null, latest: null, checkedAt: null,
      changesUrl: null, procedureUrl: procedureUrl(repository), reason: 'Update checks are turned off for this instance',
    };
    return json(disabled, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (!cached || cached.key !== repository || cached.expires <= Date.now()) {
    const value = check(__CMAIL_BUILD__, repository);
    cached = { key: repository, expires: Date.now() + HIT_TTL_S * 1000, value };
    value.then((status) => {
      if (!status.checkedAt && cached?.value === value) cached.expires = Date.now() + MISS_TTL_S * 1000;
    }, () => { if (cached?.value === value) cached = undefined; });
  }
  return json(await cached.value, { headers: { 'Cache-Control': 'private, no-store' } });
};
