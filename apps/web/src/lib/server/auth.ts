import type { AuthProvider } from '@cmail/shared/types';

export interface OAuthTokens {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in: number;
}

export interface OAuthUserInfo {
  email: string;
  name: string;
  picture?: string;
  provider: AuthProvider;
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
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scopes: ['openid', 'email', 'profile'],
    clientId,
    clientSecret,
  };
}

function getMicrosoftConfig(clientId: string, clientSecret: string, tenantId: string): OAuthProviderConfig {
  return {
    authorizationUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: ['openid', 'email', 'profile', 'User.Read'],
    clientId,
    clientSecret,
  };
}

export function getProviderConfig(provider: AuthProvider, env: Record<string, string | undefined>): OAuthProviderConfig | null {
  if (provider === 'google' && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return getGoogleConfig(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  }
  if (provider === 'microsoft' && env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    return getMicrosoftConfig(
      env.MICROSOFT_CLIENT_ID,
      env.MICROSOFT_CLIENT_SECRET,
      env.MICROSOFT_TENANT_ID || 'common',
    );
  }
  return null;
}

export function getEnabledProviders(env: Record<string, string | undefined>): AuthProvider[] {
  const providers: AuthProvider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push('google');
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) providers.push('microsoft');
  return providers;
}

export function buildAuthorizationUrl(provider: AuthProvider, env: Record<string, string | undefined>, redirectUri: string, state: string): string {
  const config = getProviderConfig(provider, env);
  if (!config) throw new Error(`Auth provider "${provider}" is not configured`);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state,
    access_type: 'offline',
    prompt: 'select_account',
  });

  return `${config.authorizationUrl}?${params}`;
}

export async function exchangeCode(provider: AuthProvider, env: Record<string, string | undefined>, code: string, redirectUri: string): Promise<OAuthTokens> {
  const config = getProviderConfig(provider, env);
  if (!config) throw new Error(`Auth provider "${provider}" is not configured`);

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<OAuthTokens>;
}

export async function fetchUserInfo(provider: AuthProvider, env: Record<string, string | undefined>, accessToken: string): Promise<OAuthUserInfo> {
  const config = getProviderConfig(provider, env);
  if (!config) throw new Error(`Auth provider "${provider}" is not configured`);

  const res = await fetch(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`UserInfo fetch failed (${res.status}): ${text}`);
  }

  const data = await res.json() as Record<string, unknown>;

  if (provider === 'google') {
    return {
      email: data.email as string,
      name: data.name as string || '',
      picture: data.picture as string | undefined,
      provider: 'google',
    };
  }

  // Microsoft Graph returns mail or userPrincipalName
  return {
    email: (data.mail as string) || (data.userPrincipalName as string) || '',
    name: data.displayName as string || '',
    provider: 'microsoft',
  };
}
