import type { PageServerLoad } from './$types';
import { loadOrgSettings } from '$lib/server/org-settings';
import { loadPublicDirectory } from '$lib/server/public-directory';

export const load: PageServerLoad = async ({ platform }) => {
  const env = platform?.env;
  const directory = await loadPublicDirectory(env?.DB, env?.MAIL_DOMAIN);
  const settings = env ? await loadOrgSettings(env as unknown as Record<string, unknown>) : null;
  return {
    ...directory,
    orgUrl: settings?.orgUrl || '',
  };
};
