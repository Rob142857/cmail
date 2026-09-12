import { error, json } from '@sveltejs/kit';
import { checkSourceUpdates, type Build, type UpdateStatus } from '$lib/server/source-updates';
import type { RequestHandler } from './$types';

declare const __CMAIL_BUILD__: Build;
let cached: { key: string; expires: number; value: Promise<UpdateStatus> } | undefined;

export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!locals.user) throw error(401, 'Sign in required');
  if (locals.user.role !== 'manager') throw error(403, 'Manager access required');
  const repository = platform?.env.REPO_URL || 'https://github.com/Rob142857/cmail';
  if (!cached || cached.key !== repository || cached.expires <= Date.now()) {
    cached = {
      key: repository,
      expires: Date.now() + 60 * 60 * 1000,
      value: checkSourceUpdates(__CMAIL_BUILD__, repository),
    };
  }
  return json(await cached.value, { headers: { 'Cache-Control': 'private, no-store' } });
};
