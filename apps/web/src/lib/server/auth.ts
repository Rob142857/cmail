import type { AuthProvider } from '@cmail/shared/types';
import { assertStrongSessionSecret } from './config';

export interface OAuthTokens {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in: number;
}

export interface OAuthUserInfo {
  subject: string;
  email: string;
  name: string;
  picture?: string;
  provider: AuthProvider;
  emailVerified: boolean;
}

interface OAuthProviderConfig {
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  clientId: string;
  clientSecret: string;
}

function getGoogleConfig(clientId: string, clientSecret: string): OAuthProviderConfig {
  return {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: ['openid', 'email', 'profile'],
    clientId,
    clientSecret,
  };
}

function getMicrosoftConfig(clientId: string, clientSecret: string, tenantId: string): OAuthProviderConfig {
  return {
    authorizationUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scopes: ['openid', 'email', 'profile'],
    clientId,
    clientSecret,
  };
}

function configuredValue(value: string | undefined, maxLength = 1000): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

// Deliberately narrower than AuthProvider: this gates the OAuth-only
// [provider] route param (login/callback), which 'email' never uses — it
// has its own routes under /auth/email. See AuthProvider's doc comment.
export function isAuthProvider(value: string): value is 'google' | 'microsoft' {
  return value === 'google' || value === 'microsoft';
}

export function getOAuthCallbackUrl(appUrl: string, provider: AuthProvider): string | null {
  try {
    const base = new URL(appUrl);
    const localHttp = base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.protocol !== 'https:' && !localHttp) return null;
    if (base.username || base.password || base.search || base.hash || (base.pathname !== '/' && base.pathname !== '')) {
      return null;
    }
    return new URL(`/auth/callback/${provider}`, base).toString();
  } catch {
    return null;
  }
}

function validMicrosoftTenant(value: string): boolean {
  return ['common', 'organizations', 'consumers'].includes(value)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function getProviderConfig(provider: AuthProvider, env: Record<string, string | undefined>): OAuthProviderConfig | null {
  const googleClientId = configuredValue(env.GOOGLE_CLIENT_ID);
  const googleClientSecret = configuredValue(env.GOOGLE_CLIENT_SECRET);
  if (provider === 'google' && googleClientId && googleClientSecret) {
    return getGoogleConfig(googleClientId, googleClientSecret);
  }
  const microsoftClientId = configuredValue(env.MICROSOFT_CLIENT_ID);
  const microsoftClientSecret = configuredValue(env.MICROSOFT_CLIENT_SECRET);
  if (provider === 'microsoft' && microsoftClientId && microsoftClientSecret) {
    const tenantId = configuredValue(env.MICROSOFT_TENANT_ID, 100) || 'common';
    if (!validMicrosoftTenant(tenantId)) return null;
    return getMicrosoftConfig(
      microsoftClientId,
      microsoftClientSecret,
      tenantId,
    );
  }
  return null;
}

export function getEnabledProviders(env: Record<string, string | undefined>): AuthProvider[] {
  try {
    assertStrongSessionSecret(env.SESSION_SECRET);
  } catch {
    return [];
  }

  const providers: AuthProvider[] = [];
  if (getProviderConfig('google', env) && getOAuthCallbackUrl(env.APP_URL || '', 'google')) providers.push('google');
  if (getProviderConfig('microsoft', env) && getOAuthCallbackUrl(env.APP_URL || '', 'microsoft')) providers.push('microsoft');
  return providers;
}

export function buildAuthorizationUrl(
  provider: AuthProvider,
  env: Record<string, string | undefined>,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  const config = getProviderConfig(provider, env);
  if (!config) throw new Error(`Auth provider "${provider}" is not configured`);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'select_account',
  });

  return `${config.authorizationUrl}?${params}`;
}

export async function exchangeCode(
  provider: AuthProvider,
  env: Record<string, string | undefined>,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<OAuthTokens> {
  const config = getProviderConfig(provider, env);
  if (!config) throw new Error(`Auth provider "${provider}" is not configured`);

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) throw new Error(`Token exchange failed with status ${res.status}`);
  const tokens = await res.json() as OAuthTokens;
  if (!tokens.access_token || typeof tokens.access_token !== 'string') {
    throw new Error('Token exchange response did not include an access token');
  }
  return tokens;
}

export async function fetchUserInfo(provider: AuthProvider, env: Record<string, string | undefined>, accessToken: string): Promise<OAuthUserInfo> {
  const config = getProviderConfig(provider, env);
  if (!config) throw new Error(`Auth provider "${provider}" is not configured`);

  const res = await fetch(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error(`UserInfo request failed with status ${res.status}`);

  const data = await res.json() as Record<string, unknown>;
  const subject = oidcSubject(data.sub);
  if (!subject) throw new Error('UserInfo response did not include a valid subject');

  if (provider === 'google') {
    return {
      subject,
      email: typeof data.email === 'string' ? data.email : '',
      name: typeof data.name === 'string' ? data.name : '',
      picture: typeof data.picture === 'string' ? data.picture : undefined,
      provider: 'google',
      emailVerified: data.email_verified === true,
    };
  }

  // Microsoft's OIDC UserInfo response exposes the standard `email` claim.
  // Graph mail/UPN fields and ID-token claims are deliberately not accepted.
  const email = typeof data.email === 'string' ? data.email : '';
  return {
    subject,
    email,
    name: typeof data.name === 'string' ? data.name : '',
    provider: 'microsoft',
    // Microsoft documents the complete OIDC UserInfo response without an
    // email_verified member. An email returned by this access-token-backed
    // endpoint is treated as the provider-asserted email for enrollment only.
    emailVerified: email.length > 0,
  };
}

export function oidcSubject(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 255) return null;
  return /[\u0000-\u001f\u007f]/.test(value) ? null : value;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64Url(random);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}
