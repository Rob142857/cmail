import type { LayoutServerLoad } from './$types';
import { getEnabledProviders } from '$lib/server/auth';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
  const env = platform?.env;
  return {
    user: locals.user,
    appName: env?.APP_NAME || 'cmail',
    appUrl: env?.APP_URL || '',
    authProviders: env ? getEnabledProviders(env as unknown as Record<string, string | undefined>) : [],
  };
};
