// OAuth client records: Dynamic Client Registration (RFC 7591, kept for the
// many clients that still use it) and Client ID Metadata Documents (the
// mechanism the 2026-07-28 MCP revision prefers).
import { CIMD_CACHE_SECONDS, CIMD_MIN_CACHE_SECONDS } from './config';
import { nowEpoch, randomToken, sha256Hex, timingSafeEqual } from './crypto';
import { validateRedirectUriList } from './redirect-uri';

export type ClientAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';

export interface McpClient {
  id: string;
  registration_type: 'dcr' | 'cimd';
  client_name: string;
  client_uri: string;
  redirect_uris: string[];
  token_endpoint_auth_method: ClientAuthMethod;
  client_secret_hash: string | null;
}

interface ClientRow extends Omit<McpClient, 'redirect_uris'> {
  redirect_uris: string;
  metadata_expires_epoch: number | null;
}

export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

const AUTH_METHODS: readonly ClientAuthMethod[] = ['none', 'client_secret_post', 'client_secret_basic'];
const CIMD_MAX_BYTES = 16 * 1024;
const CIMD_TIMEOUT_MS = 5000;

/** Strip control characters and bound a display string supplied by a client. */
export function cleanClientText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max);
}

function cleanHttpsUri(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
  } catch {
    return '';
  }
}

function rowToClient(row: ClientRow): McpClient {
  let redirectUris: string[];
  try {
    const parsed = JSON.parse(row.redirect_uris) as unknown;
    redirectUris = Array.isArray(parsed) ? parsed.filter((uri): uri is string => typeof uri === 'string') : [];
  } catch {
    redirectUris = [];
  }
  return {
    id: row.id,
    registration_type: row.registration_type,
    client_name: row.client_name,
    client_uri: row.client_uri,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: row.token_endpoint_auth_method,
    client_secret_hash: row.client_secret_hash,
  };
}

export interface RegistrationResult {
  client: McpClient;
  clientSecret: string | null;
  response: Record<string, unknown>;
}

/** RFC 7591 registration. Throws OAuthError with invalid_redirect_uri / invalid_client_metadata. */
export async function registerClient(db: D1Database, metadata: unknown): Promise<RegistrationResult> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new OAuthError('invalid_client_metadata', 'Registration body must be a JSON object');
  }
  const input = metadata as Record<string, unknown>;
  const redirectUris = validateRedirectUriList(input.redirect_uris);
  if (!redirectUris) {
    throw new OAuthError('invalid_redirect_uri', 'Provide 1-10 redirect_uris: https, http on a loopback host, or a private-use app scheme, with no fragment');
  }
  const authMethod = (input.token_endpoint_auth_method ?? 'none') as ClientAuthMethod;
  if (!AUTH_METHODS.includes(authMethod)) {
    throw new OAuthError('invalid_client_metadata', 'token_endpoint_auth_method must be none, client_secret_post or client_secret_basic');
  }
  const grantTypes = input.grant_types ?? ['authorization_code', 'refresh_token'];
  if (!Array.isArray(grantTypes) || !grantTypes.includes('authorization_code')
    || grantTypes.some((grant) => grant !== 'authorization_code' && grant !== 'refresh_token')) {
    throw new OAuthError('invalid_client_metadata', 'grant_types must be authorization_code, optionally with refresh_token');
  }
  const responseTypes = input.response_types ?? ['code'];
  if (!Array.isArray(responseTypes) || responseTypes.length !== 1 || responseTypes[0] !== 'code') {
    throw new OAuthError('invalid_client_metadata', 'response_types must be ["code"]');
  }

  const clientName = cleanClientText(input.client_name, 120) || 'Unnamed app';
  const clientUri = cleanHttpsUri(input.client_uri);
  const softwareId = cleanClientText(input.software_id, 200);
  const softwareVersion = cleanClientText(input.software_version, 100);
  const clientId = `cmc_${crypto.randomUUID().replace(/-/g, '')}`;
  const clientSecret = authMethod === 'none' ? null : randomToken('cmcs_');
  const secretHash = clientSecret ? await sha256Hex(clientSecret) : null;
  const issuedAt = nowEpoch();

  await db.prepare(
    `INSERT INTO mcp_clients
      (id, registration_type, client_name, client_uri, redirect_uris, token_endpoint_auth_method,
       client_secret_hash, software_id, software_version, created_epoch)
     VALUES (?, 'dcr', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(clientId, clientName, clientUri, JSON.stringify(redirectUris), authMethod, secretHash, softwareId, softwareVersion, issuedAt).run();

  const client: McpClient = {
    id: clientId,
    registration_type: 'dcr',
    client_name: clientName,
    client_uri: clientUri,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: authMethod,
    client_secret_hash: secretHash,
  };
  return {
    client,
    clientSecret,
    response: {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
      client_name: clientName,
      ...(clientUri ? { client_uri: clientUri } : {}),
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: authMethod,
    },
  };
}

/** A CIMD client_id: an https URL with a non-root path, no query, fragment or credentials, and a DNS host name. */
export function isClientIdMetadataUrl(value: string): boolean {
  if (!value.startsWith('https://') || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return false;
    if (url.pathname === '/' || url.pathname === '') return false;
    if (url.toString() !== value) return false;
    const host = url.hostname.toLowerCase();
    // No IP literals or local names: the fetch must only reach public DNS hosts.
    if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host) || !host.includes('.')) return false;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
    return true;
  } catch {
    return false;
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * How long to cache a metadata document, from its Cache-Control header.
 * no-store, no-cache and short max-age values still get the minimum, so one
 * sign-in doesn't refetch the document at every step.
 */
export function cimdCacheSeconds(cacheControl: string | null): number {
  if (!cacheControl) return CIMD_CACHE_SECONDS;
  const directives = cacheControl.toLowerCase().split(',').map((part) => part.trim());
  if (directives.some((part) => part === 'no-store' || part === 'no-cache')) return CIMD_MIN_CACHE_SECONDS;
  const maxAge = directives.map((part) => /^max-age="?(\d{1,10})"?$/.exec(part)).find(Boolean);
  if (!maxAge) return CIMD_CACHE_SECONDS;
  return Math.min(CIMD_CACHE_SECONDS, Math.max(CIMD_MIN_CACHE_SECONDS, Number(maxAge[1])));
}

/** Fetch and validate a Client ID Metadata Document. Never follows redirects. */
export async function fetchClientMetadataDocument(
  clientId: string,
  fetcher: typeof fetch = fetch,
): Promise<Omit<McpClient, 'client_secret_hash'> & { cacheSeconds: number }> {
  if (!isClientIdMetadataUrl(clientId)) throw new OAuthError('invalid_client', 'client_id is not a valid metadata document URL', 401);
  let response: Response;
  try {
    response = await fetcher(clientId, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
    });
  } catch {
    throw new OAuthError('invalid_client', 'The client metadata document could not be fetched', 401);
  }
  if (response.status !== 200) throw new OAuthError('invalid_client', 'The client metadata document could not be fetched', 401);
  const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json' && !contentType.endsWith('+json')) {
    throw new OAuthError('invalid_client', 'The client metadata document must be JSON', 401);
  }
  let parsed: unknown;
  try {
    const text = await readBoundedText(response, CIMD_MAX_BYTES);
    if (text === null) throw new Error('too large');
    parsed = JSON.parse(text);
  } catch {
    throw new OAuthError('invalid_client', 'The client metadata document is not valid JSON within 16 KB', 401);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OAuthError('invalid_client', 'The client metadata document must be a JSON object', 401);
  }
  const document = parsed as Record<string, unknown>;
  if (document.client_id !== clientId) {
    throw new OAuthError('invalid_client', 'The metadata document client_id does not match its URL', 401);
  }
  const redirectUris = validateRedirectUriList(document.redirect_uris);
  if (!redirectUris) throw new OAuthError('invalid_client', 'The metadata document has no acceptable redirect_uris', 401);
  const method = document.token_endpoint_auth_method ?? 'none';
  if (method !== 'none') {
    throw new OAuthError('invalid_client', 'Only public clients (token_endpoint_auth_method "none") may use a metadata document here', 401);
  }
  const name = cleanClientText(document.client_name, 120);
  if (!name) throw new OAuthError('invalid_client', 'The metadata document must include client_name', 401);
  return {
    id: clientId,
    registration_type: 'cimd',
    client_name: name,
    client_uri: cleanHttpsUri(document.client_uri),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    cacheSeconds: cimdCacheSeconds(response.headers.get('cache-control')),
  };
}

/**
 * Look up a client by id. URL-shaped ids are resolved as Client ID Metadata
 * Documents (cached in D1 per their Cache-Control, 5 min to a day); anything else must be a DCR client.
 * Pass `fetcher: null` to use only stored clients and never fetch.
 */
export async function resolveClient(
  db: D1Database,
  clientId: unknown,
  fetcher: typeof fetch | null = fetch,
): Promise<McpClient | null> {
  if (typeof clientId !== 'string' || clientId.length < 8 || clientId.length > 2048) return null;
  const row = await db.prepare(
    `SELECT id, registration_type, client_name, client_uri, redirect_uris, token_endpoint_auth_method,
            client_secret_hash, metadata_expires_epoch
     FROM mcp_clients WHERE id = ?`,
  ).bind(clientId).first<ClientRow>();
  const now = nowEpoch();
  if (row && (row.registration_type === 'dcr' || (row.metadata_expires_epoch ?? 0) > now)) return rowToClient(row);
  if (!fetcher || !isClientIdMetadataUrl(clientId)) return null;

  let cacheSeconds: number;
  let fetched: Omit<McpClient, 'client_secret_hash'>;
  try {
    ({ cacheSeconds, ...fetched } = await fetchClientMetadataDocument(clientId, fetcher));
  } catch {
    return null;
  }
  await db.prepare(
    `INSERT INTO mcp_clients
       (id, registration_type, client_name, client_uri, redirect_uris, token_endpoint_auth_method, metadata_expires_epoch)
     VALUES (?, 'cimd', ?, ?, ?, 'none', ?)
     ON CONFLICT(id) DO UPDATE SET client_name = excluded.client_name, client_uri = excluded.client_uri,
       redirect_uris = excluded.redirect_uris, metadata_expires_epoch = excluded.metadata_expires_epoch
     WHERE mcp_clients.registration_type = 'cimd'`,
  ).bind(fetched.id, fetched.client_name, fetched.client_uri, JSON.stringify(fetched.redirect_uris), now + cacheSeconds).run();
  return { ...fetched, client_secret_hash: null };
}

/** Host shown to the user as the verified origin of a CIMD client. */
export function verifiedClientHost(client: McpClient): string | null {
  if (client.registration_type !== 'cimd') return null;
  try {
    return new URL(client.id).host;
  } catch {
    return null;
  }
}

export interface PresentedClientCredentials {
  clientId: string | null;
  clientSecret: string | null;
  method: ClientAuthMethod;
}

/** Read client credentials from Authorization: Basic or the form body. Rejects mixed methods. */
export function presentedClientCredentials(request: Request, form: URLSearchParams): PresentedClientCredentials {
  const header = request.headers.get('authorization') || '';
  const bodyId = form.get('client_id');
  const bodySecret = form.get('client_secret');
  if (/^basic\s+/i.test(header)) {
    if (bodySecret) throw new OAuthError('invalid_request', 'Use only one client authentication method');
    let decoded: string;
    try {
      decoded = atob(header.replace(/^basic\s+/i, '').trim());
    } catch {
      throw new OAuthError('invalid_client', 'Malformed Basic credentials', 401);
    }
    const separator = decoded.indexOf(':');
    if (separator < 0) throw new OAuthError('invalid_client', 'Malformed Basic credentials', 401);
    let clientId: string;
    let clientSecret: string;
    try {
      // RFC 6749 2.3.1: both parts are form-urlencoded before Basic encoding.
      clientId = decodeURIComponent(decoded.slice(0, separator).replace(/\+/g, ' '));
      clientSecret = decodeURIComponent(decoded.slice(separator + 1).replace(/\+/g, ' '));
    } catch {
      throw new OAuthError('invalid_client', 'Malformed Basic credentials', 401);
    }
    if (bodyId && bodyId !== clientId) throw new OAuthError('invalid_request', 'client_id does not match the Basic credentials');
    return { clientId, clientSecret, method: 'client_secret_basic' };
  }
  if (bodySecret) return { clientId: bodyId, clientSecret: bodySecret, method: 'client_secret_post' };
  return { clientId: bodyId, clientSecret: null, method: 'none' };
}

/** Authenticate the client at the token or revocation endpoint. */
export async function authenticateClient(
  db: D1Database,
  credentials: PresentedClientCredentials,
  fetcher: typeof fetch | null = fetch,
): Promise<McpClient> {
  const client = await resolveClient(db, credentials.clientId, fetcher);
  if (!client) throw new OAuthError('invalid_client', 'Unknown client', 401);
  if (client.token_endpoint_auth_method !== credentials.method) {
    throw new OAuthError('invalid_client', 'Client authentication method does not match registration', 401);
  }
  if (client.token_endpoint_auth_method !== 'none') {
    if (!credentials.clientSecret || credentials.clientSecret.length > 200 || !client.client_secret_hash) {
      throw new OAuthError('invalid_client', 'Client authentication failed', 401);
    }
    const presented = await sha256Hex(credentials.clientSecret);
    if (!timingSafeEqual(presented, client.client_secret_hash)) {
      throw new OAuthError('invalid_client', 'Client authentication failed', 401);
    }
  }
  return client;
}
