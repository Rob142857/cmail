import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizationUrl,
  fetchUserInfo,
  getEnabledProviders,
  getOAuthCallbackUrl,
  oidcSubject,
} from './auth';

const AUTH_RUNTIME = {
  APP_URL: 'https://mail.example.com',
  SESSION_SECRET: '9b31cc4df6ca42c3a60cedd53d63a90f8de45aae0b72a749',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('conditional OAuth providers', () => {
  it('hides every provider when configuration is absent or incomplete', () => {
    expect(getEnabledProviders({})).toEqual([]);
    expect(getEnabledProviders({ ...AUTH_RUNTIME, GOOGLE_CLIENT_ID: 'google-id' })).toEqual([]);
    expect(getEnabledProviders({ ...AUTH_RUNTIME, MICROSOFT_CLIENT_SECRET: 'microsoft-secret' })).toEqual([]);
  });

  it('enables Google only when its complete pair is present', () => {
    expect(getEnabledProviders({
      ...AUTH_RUNTIME,
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
    })).toEqual(['google']);
  });

  it('enables Microsoft for supported audiences and rejects invalid tenant input', () => {
    const base = {
      ...AUTH_RUNTIME,
      MICROSOFT_CLIENT_ID: 'microsoft-id',
      MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
    };
    expect(getEnabledProviders(base)).toEqual(['microsoft']);
    expect(getEnabledProviders({ ...base, MICROSOFT_TENANT_ID: 'organizations' })).toEqual(['microsoft']);
    expect(getEnabledProviders({ ...base, MICROSOFT_TENANT_ID: 'not/a/tenant' })).toEqual([]);
  });

  it('shows both independent providers when both configurations are complete', () => {
    expect(getEnabledProviders({
      ...AUTH_RUNTIME,
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      MICROSOFT_CLIENT_ID: 'microsoft-id',
      MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
      MICROSOFT_TENANT_ID: 'common',
    })).toEqual(['google', 'microsoft']);
  });

  it('hides otherwise complete providers when shared OAuth runtime settings are unsafe', () => {
    const google = { GOOGLE_CLIENT_ID: 'google-id', GOOGLE_CLIENT_SECRET: 'google-secret' };
    expect(getEnabledProviders({ ...google, SESSION_SECRET: AUTH_RUNTIME.SESSION_SECRET })).toEqual([]);
    expect(getEnabledProviders({ ...google, APP_URL: AUTH_RUNTIME.APP_URL, SESSION_SECRET: 'short' })).toEqual([]);
    expect(getEnabledProviders({ ...google, APP_URL: 'http://mail.example.com', SESSION_SECRET: AUTH_RUNTIME.SESSION_SECRET })).toEqual([]);
  });

  it('derives the exact callback from APP_URL instead of a second environment value', () => {
    const callback = getOAuthCallbackUrl('https://mail.example.com', 'google');
    expect(callback).toBe('https://mail.example.com/auth/callback/google');
    const authorization = new URL(buildAuthorizationUrl(
      'google',
      { GOOGLE_CLIENT_ID: 'google-id', GOOGLE_CLIENT_SECRET: 'google-secret' },
      callback!,
      'state-value',
      'challenge-value',
    ));
    expect(authorization.searchParams.get('redirect_uri')).toBe('https://mail.example.com/auth/callback/google');
    expect(authorization.searchParams.get('state')).toBe('state-value');
    expect(authorization.searchParams.get('code_challenge')).toBe('challenge-value');
  });

  it('requests only OpenID scopes for Microsoft accounts', () => {
    const authorization = new URL(buildAuthorizationUrl(
      'microsoft',
      {
        MICROSOFT_CLIENT_ID: 'microsoft-id',
        MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
        MICROSOFT_TENANT_ID: 'common',
      },
      'https://mail.example.com/auth/callback/microsoft',
      'state-value',
      'challenge-value',
    ));
    expect(authorization.searchParams.get('scope')).toBe('openid email profile');
    expect(authorization.searchParams.get('scope')).not.toContain('User.Read');
  });

  it('rejects unsafe or ambiguous callback bases', () => {
    expect(getOAuthCallbackUrl('http://mail.example.com', 'google')).toBeNull();
    expect(getOAuthCallbackUrl(`https://user:password${String.fromCharCode(64)}mail.example.com`, 'google')).toBeNull();
    expect(getOAuthCallbackUrl('https://mail.example.com/subpath', 'google')).toBeNull();
    expect(getOAuthCallbackUrl('http://localhost:5173', 'microsoft')).toBe(
      'http://localhost:5173/auth/callback/microsoft',
    );
  });
});

describe('access-token-backed OIDC UserInfo', () => {
  it('uses Google UserInfo and returns the exact immutable subject', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      sub: 'Google-Subject_123',
      email: 'Person@Example.com',
      email_verified: true,
      name: 'Example Person',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchUserInfo('google', {
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
    }, 'access-token')).resolves.toMatchObject({
      subject: 'Google-Subject_123',
      email: 'Person@Example.com',
      emailVerified: true,
      provider: 'google',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openidconnect.googleapis.com/v1/userinfo',
      { headers: { Authorization: 'Bearer access-token' } },
    );
  });

  it('uses Microsoft OIDC UserInfo and ignores Graph mail, UPN, and displayName fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      sub: 'microsoft-subject',
      mail: 'mail-field@example.com',
      userPrincipalName: 'upn@example.com',
      displayName: 'Graph Display Name',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchUserInfo('microsoft', {
      MICROSOFT_CLIENT_ID: 'microsoft-id',
      MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
      MICROSOFT_TENANT_ID: 'common',
    }, 'access-token')).resolves.toEqual({
      subject: 'microsoft-subject',
      email: '',
      name: '',
      provider: 'microsoft',
      emailVerified: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/oidc/userinfo',
      { headers: { Authorization: 'Bearer access-token' } },
    );
  });

  it('rejects missing or unsafe subjects without normalising valid values', async () => {
    expect(oidcSubject('Case Sensitive Subject')).toBe('Case Sensitive Subject');
    expect(oidcSubject('bad\u0000subject')).toBeNull();
    expect(oidcSubject('')).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      email: 'person@example.com',
      email_verified: true,
    })));
    await expect(fetchUserInfo('google', {
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
    }, 'access-token')).rejects.toThrow('valid subject');
  });
});
