import { describe, expect, it, vi } from 'vitest';
import { runtimePlatform } from './cloudflare-runtime';

describe('runtimePlatform', () => {
  it('rebuilds the event.platform shape from the Workers runtime module', () => {
    const waitUntil = vi.fn();
    const env = { DB: { prepare: vi.fn() }, STORAGE: {}, SESSION_SECRET: 'x' } as unknown as Cloudflare.Env;

    const platform = runtimePlatform({ env, waitUntil });
    expect(platform?.env).toBe(env);
    const work = Promise.resolve();
    platform?.context.waitUntil(work);
    expect(waitUntil).toHaveBeenCalledWith(work);
  });

  it('returns undefined outside a Workers request instead of throwing', () => {
    const env = new Proxy({}, {
      get() {
        throw new Error('Cannot access cloudflare:workers outside a request');
      },
    }) as Cloudflare.Env;
    expect(runtimePlatform({ env, waitUntil: vi.fn() })).toBeUndefined();
  });

  it('returns undefined when the default runtime is used outside a request', () => {
    expect(runtimePlatform()).toBeUndefined();
  });
});
