import type { LayoutServerLoad } from './$types';
import { getEnabledProviders } from '$lib/server/auth';
import { emailOtpEnabled, publicRuntimeConfig } from '$lib/server/config';
import { loadOrgSettings } from '$lib/server/org-settings';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
  const env = platform?.env;
  if (!env) {
    return {
      user: locals.user,
      appName: 'cmail',
      appUrl: '',
      authProviders: [],
      otpEnabled: false,
      supportEmail: '',
      orgName: '',
      orgUrl: '',
      landingUrl: '',
      brandLogoUrl: '/logo.svg',
      brandIconUrl: '/icon.svg',
      brandIcon192Url: '/icon-192.png',
      brandIcon512Url: '/icon-512.png',
      brandOgImageUrl: '/og-image.svg',
      brandPrimaryColor: '#0078d4',
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
    orgUrl: settings.orgUrl,
    landingUrl: settings.landingUrl,
    supportEmail: settings.supportEmail,
    authProviders: getEnabledProviders(env as unknown as Record<string, string | undefined>),
    otpEnabled: emailOtpEnabled(env as unknown as Record<string, unknown>),
  };
};
