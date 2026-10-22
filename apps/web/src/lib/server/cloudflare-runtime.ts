import { env, waitUntil } from 'cloudflare:workers';

interface WorkersRuntime {
  env: Cloudflare.Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

/**
 * adapter-cloudflare 8 removed `event.platform` and exposes the Workers runtime
 * through the `cloudflare:workers` module instead. Server code here is written
 * against `event.platform.env` / `event.platform.context.waitUntil`, and its
 * tests build that shape by hand, so `handle` rebuilds exactly that shape once
 * per request from the runtime module. This file is the only place that
 * imports `cloudflare:workers`.
 *
 * Outside a Workers request (unit tests, prerender) the module refuses to hand
 * out bindings; that case yields `undefined`, the same as a missing platform
 * before the upgrade. The runtime argument is a test seam.
 */
export function runtimePlatform(runtime: WorkersRuntime = { env, waitUntil }): App.Platform | undefined {
  try {
    void runtime.env.DB;
  } catch {
    return undefined;
  }
  return { env: runtime.env, context: { waitUntil: runtime.waitUntil } };
}
