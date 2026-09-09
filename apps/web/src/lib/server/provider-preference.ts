// This cookie is a navigation preference, never authentication or an account
// selector. __Host- requires Secure, Path=/, and no Domain attribute.
export const PROVIDER_PREFERENCE_COOKIE = '__Host-cmail_last_provider';
export const PROVIDER_PREFERENCE_TTL_SECONDS = 30 * 24 * 60 * 60;

export function providerPreferenceCookie(provider: 'google' | 'microsoft'): string {
  return `${PROVIDER_PREFERENCE_COOKIE}=${provider}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${PROVIDER_PREFERENCE_TTL_SECONDS}`;
}

export function clearProviderPreferenceCookie(): string {
  return `${PROVIDER_PREFERENCE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
