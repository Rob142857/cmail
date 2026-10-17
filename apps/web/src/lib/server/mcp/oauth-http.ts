// HTTP handlers for the machine-facing OAuth endpoints (register, token,
// revoke). They never read cookies; clients authenticate with PKCE and, for
// confidential DCR clients, a client secret.
import { consumeRateLimit } from '../rate-limit';
import { MAX_OAUTH_REQUEST_BYTES, isMcpEnabled, mcpIssuer, mcpResource } from './config';
import { OAuthError, authenticateClient, presentedClientCredentials, registerClient } from './clients';
import { exchangeAuthorizationCode, exchangeRefreshToken, revokeToken } from './oauth';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...NO_STORE, ...headers },
  });
}

function oauthError(error: OAuthError, basicUsed = false): Response {
  return oauthJson(
    { error: error.error, error_description: error.description },
    error.status,
    error.status === 401 && basicUsed ? { 'WWW-Authenticate': 'Basic realm="cmail"' } : {},
  );
}

function clientIp(request: Request): string {
  return (request.headers.get('cf-connecting-ip') || 'unknown').slice(0, 64);
}

async function readBody(request: Request, expectedType: string): Promise<string> {
  const contentType = (request.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== expectedType) throw new OAuthError('invalid_request', `Content-Type must be ${expectedType}`);
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_OAUTH_REQUEST_BYTES) throw new OAuthError('invalid_request', 'Request too large', 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_OAUTH_REQUEST_BYTES) throw new OAuthError('invalid_request', 'Request too large', 413);
  return text;
}

function parseForm(text: string): URLSearchParams {
  const form = new URLSearchParams(text);
  const seen = new Set<string>();
  for (const key of form.keys()) {
    if (seen.has(key)) throw new OAuthError('invalid_request', `Parameter ${key.slice(0, 40)} was sent more than once`);
    seen.add(key);
  }
  return form;
}

type Platformish = App.Platform | undefined;

function platformEnv(platform: Platformish): (Record<string, unknown> & { DB: D1Database }) | undefined {
  return platform?.env as unknown as (Record<string, unknown> & { DB: D1Database }) | undefined;
}

async function guard(platform: Platformish, request: Request, scope: string, limit: number, windowSeconds: number) {
  const env = platformEnv(platform);
  const db = env?.DB;
  const issuer = env ? mcpIssuer(env) : null;
  const resource = env ? mcpResource(env) : null;
  if (!env || !db || !issuer || !resource) throw new OAuthError('temporarily_unavailable', 'OAuth is not configured on this server', 503);
  if (!(await isMcpEnabled(db))) {
    throw new OAuthError('access_denied', 'AI agent (MCP) connections are turned off for this organisation', 403);
  }
  const rate = await consumeRateLimit(db, scope, clientIp(request), limit, windowSeconds);
  if (!rate.allowed) throw new OAuthError('slow_down', 'Too many requests; try again later', 429);
  return { env, db, issuer, resource };
}

export async function handleRegister(request: Request, platform: Platformish): Promise<Response> {
  try {
    const { db } = await guard(platform, request, 'oauth_register', 20, 60 * 60);
    let metadata: unknown;
    try {
      metadata = JSON.parse(await readBody(request, 'application/json'));
    } catch (caught) {
      if (caught instanceof OAuthError) throw caught;
      throw new OAuthError('invalid_client_metadata', 'Body must be valid JSON');
    }
    const result = await registerClient(db, metadata);
    return oauthJson(result.response, 201);
  } catch (caught) {
    if (caught instanceof OAuthError) return oauthError(caught);
    throw caught;
  }
}

export async function handleToken(request: Request, platform: Platformish): Promise<Response> {
  let basicUsed = false;
  try {
    const { db, resource } = await guard(platform, request, 'oauth_token', 120, 10 * 60);
    const form = parseForm(await readBody(request, 'application/x-www-form-urlencoded'));
    const credentials = presentedClientCredentials(request, form);
    basicUsed = credentials.method === 'client_secret_basic';
    const client = await authenticateClient(db, credentials);
    const grantType = form.get('grant_type');
    if (grantType === 'authorization_code') return oauthJson(await exchangeAuthorizationCode(db, client, form, resource));
    if (grantType === 'refresh_token') return oauthJson(await exchangeRefreshToken(db, client, form, resource));
    throw new OAuthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported');
  } catch (caught) {
    if (caught instanceof OAuthError) return oauthError(caught, basicUsed);
    throw caught;
  }
}

export async function handleRevoke(request: Request, platform: Platformish): Promise<Response> {
  let basicUsed = false;
  try {
    const db = platformEnv(platform)?.DB;
    if (!db) throw new OAuthError('temporarily_unavailable', 'OAuth is not configured on this server', 503);
    // Revocation stays available while the org switch is off, so clients can clean up.
    const rate = await consumeRateLimit(db, 'oauth_revoke', clientIp(request), 120, 10 * 60);
    if (!rate.allowed) throw new OAuthError('slow_down', 'Too many requests; try again later', 429);
    const form = parseForm(await readBody(request, 'application/x-www-form-urlencoded'));
    const credentials = presentedClientCredentials(request, form);
    basicUsed = credentials.method === 'client_secret_basic';
    // Revocation only concerns clients that already hold tokens, so it never
    // needs to fetch a metadata document (it also works while the switch is off).
    const client = await authenticateClient(db, credentials, null);
    await revokeToken(db, client, form.get('token'));
    return new Response(null, { status: 200, headers: NO_STORE });
  } catch (caught) {
    if (caught instanceof OAuthError) return oauthError(caught, basicUsed);
    throw caught;
  }
}
