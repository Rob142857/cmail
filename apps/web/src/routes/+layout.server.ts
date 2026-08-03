import type { LayoutServerLoad } from './$types';
import { getEnabledProviders } from '$lib/server/auth';
import { publicRuntimeConfig } from '$lib/server/config';
import { loadOrgSettings } from '$lib/server/org-settings';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
  const env = platform?.env;
  if (!env) {
    return {
      user: locals.user,
      appName: 'cmail',
      appUrl: '',
      authProviders: [],
      supportEmail: '',
      orgName: '',
      brandLogoUrl: '/logo.svg',
      brandIconUrl: '/icon.svg',
      brandIcon192Url: '/icon-192.png',
      brandIcon512Url: '/icon-512.png',
      brandOgImageUrl: '/og-image.svg',
      brandPrimaryColor: '#2563eb',
      brandOnPrimary: '#ffffff',
      pushPublicKey: '',
      locale: 'en',
      timeZone: 'UTC',
    };
  }

  const runtime = publicRuntimeConfig(env as unknown as Record<string, unknown>);
  const settings = await loadOrgSettings(env as unknown as Record<string, unknown>);
  return {
    user: locals.user,
    ...runtime,
    appName: settings.appName || runtime.appName,
    appUrl: settings.appUrl || runtime.appUrl,
    orgName: settings.orgName,
    supportEmail: settings.supportEmail,
    authProviders: getEnabledProviders(env as unknown as Record<string, string | undefined>),
  };
};
