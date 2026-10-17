// OAuth 2.1 authorization server for cmail's MCP endpoint: authorization
// requests, consent, authorization codes, token issue/rotation, revocation
// and bearer-token validation. All state is in D1; only hashes of secrets.
import type { User } from '@cmail/shared/types';
import { audit, generateId } from '../db';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  AUTH_REQUEST_TTL_SECONDS,
  GRANT_MAX_LIFETIME_SECONDS,
  MCP_SCOPES,
  REFRESH_TOKEN_TTL_SECONDS,
  formatScopes,
  parseScopes,
  resourceMatches,
  type McpScope,
} from './config';
import { OAuthError, resolveClient, type McpClient } from './clients';
import { isValidCodeChallenge, nowEpoch, randomToken, sha256Hex, verifyPkceS256 } from './crypto';
import { buildRedirect, redirectUriMatches } from './redirect-uri';

export type GrantRevocationReason =
  | 'user' | 'admin' | 'admin_all' | 'replaced' | 'refresh_reuse' | 'code_reuse' | 'offboarded' | 'paused' | 'client_revocation';

/** Raised before the client and redirect URI are trusted: shown to the user, never redirected. */
export class AuthorizePageError extends Error {}

export interface ValidAuthorizationRequest {
  client: McpClient;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  requestedScopes: McpScope[];
  resource: string;
}

export interface StoredAuthRequest extends ValidAuthorizationRequest {
  id: string;
}

/** An error to send back to the client's redirect URI (RFC 6749 4.1.2.1). */
export class AuthorizeRedirectError extends Error {
  constructor(readonly redirectTo: string) {
    super('authorization error redirect');
  }
}

export function errorRedirect(issuer: string, redirectUri: string, state: string, error: string, description: string): string {
  return buildRedirect(redirectUri, { error, error_description: description, state: state || undefined, iss: issuer });
}

/**
 * Validate the query of GET /oauth/authorize. The client and redirect URI
 * are checked first; problems with them are AuthorizePageError (no redirect).
 * Later problems are AuthorizeRedirectError carrying the client redirect.
 */
export async function validateAuthorizationRequest(
  db: D1Database,
  params: URLSearchParams,
  issuer: string,
  resource: string,
  fetcher: typeof fetch = fetch,
): Promise<ValidAuthorizationRequest> {
  for (const key of ['client_id', 'redirect_uri', 'response_type', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource']) {
    if (params.getAll(key).length > 1) throw new AuthorizePageError(`The ${key} parameter was sent more than once.`);
  }
  const client = await resolveClient(db, params.get('client_id'), fetcher);
  if (!client) throw new AuthorizePageError('This app is not registered with this mail service, or its registration could not be verified.');
  const redirectUri = params.get('redirect_uri');
  if (!redirectUriMatches(redirectUri, client.redirect_uris)) {
    throw new AuthorizePageError('This app asked to return to an address it did not register. For your safety the request was stopped.');
  }
  const state = params.get('state') || '';
  if (state.length > 1024) throw new AuthorizePageError('The request state is too long.');
  const fail = (error: string, description: string) => new AuthorizeRedirectError(errorRedirect(issuer, redirectUri, state, error, description));

  if (params.get('response_type') !== 'code') throw fail('unsupported_response_type', 'Only response_type=code is supported');
  const codeChallenge = params.get('code_challenge');
  if (!isValidCodeChallenge(codeChallenge)) throw fail('invalid_request', 'A PKCE code_challenge is required');
  if (params.get('code_challenge_method') !== 'S256') throw fail('invalid_request', 'code_challenge_method must be S256');
  const requestedResource = params.get('resource');
  if (requestedResource !== null && !resourceMatches(requestedResource, resource)) {
    throw fail('invalid_target', 'The resource parameter must identify this mail service\'s MCP endpoint');
  }
  const scopeParam = params.get('scope');
  const requestedScopes = parseScopes(scopeParam || '');
  // Unknown-only scope requests (for example "openid") fall back to offering
  // every cmail scope; the consent screen still starts least-privileged.
  return {
    client,
    redirectUri,
    state,
    codeChallenge,
    requestedScopes: requestedScopes.length ? requestedScopes : [...MCP_SCOPES],
    resource,
  };
}

export async function storeAuthorizationRequest(db: D1Database, request: ValidAuthorizationRequest): Promise<string> {
  const id = randomToken('cmar_');
  const now = nowEpoch();
  await db.prepare(
    `INSERT INTO mcp_auth_requests
       (id, client_id, redirect_uri, state, code_challenge, requested_scopes, resource, created_epoch, expires_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, request.client.id, request.redirectUri, request.state, request.codeChallenge,
    formatScopes(request.requestedScopes), request.resource, now, now + AUTH_REQUEST_TTL_SECONDS,
  ).run();
  return id;
}

export function isAuthRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^cmar_[A-Za-z0-9_-]{43}$/.test(value);
}

export async function loadAuthorizationRequest(db: D1Database, id: unknown): Promise<StoredAuthRequest | null> {
  if (!isAuthRequestId(id)) return null;
  const row = await db.prepare(
    `SELECT id, client_id, redirect_uri, state, code_challenge, requested_scopes, resource
     FROM mcp_auth_requests WHERE id = ? AND expires_epoch > ?`,
  ).bind(id, nowEpoch()).first<{
    id: string; client_id: string; redirect_uri: string; state: string; code_challenge: string; requested_scopes: string; resource: string;
  }>();
  if (!row) return null;
  const client = await resolveClient(db, row.client_id);
  if (!client || !redirectUriMatches(row.redirect_uri, client.redirect_uris)) return null;
  const requestedScopes = parseScopes(row.requested_scopes);
  return {
    id: row.id,
    client,
    redirectUri: row.redirect_uri,
    state: row.state,
    codeChallenge: row.code_challenge,
    requestedScopes: requestedScopes.length ? requestedScopes : [...MCP_SCOPES],
    resource: row.resource,
  };
}

export interface ConsentMailbox {
  id: string;
  address: string;
  display_name: string;
  type: 'personal' | 'shared';
  permissions: 'read' | 'send-as' | 'full';
}

export async function consentMailboxes(db: D1Database, userId: string): Promise<ConsentMailbox[]> {
  const rows = await db.prepare(
    `SELECT m.id, m.address, m.display_name, m.type, ma.permissions
     FROM mailboxes m INNER JOIN mailbox_assignments ma ON ma.mailbox_id = m.id
     WHERE ma.user_id = ? AND m.status = 'active'
     ORDER BY CASE m.type WHEN 'personal' THEN 0 ELSE 1 END, m.address`,
  ).bind(userId).all<ConsentMailbox>();
  return rows.results || [];
}

/** Atomically take (delete) a pending request so it can be answered exactly once. */
async function takeAuthorizationRequest(db: D1Database, id: string): Promise<StoredAuthRequest | null> {
  const request = await loadAuthorizationRequest(db, id);
  if (!request) return null;
  const deleted = await db.prepare('DELETE FROM mcp_auth_requests WHERE id = ?').bind(id).run();
  return deleted.meta.changes ? request : null;
}

export function revokeGrantStatements(db: D1Database, grantId: string, reason: GrantRevocationReason, now = nowEpoch()): D1PreparedStatement[] {
  return [
    db.prepare('UPDATE mcp_grants SET revoked_epoch = ?, revoked_reason = ? WHERE id = ? AND revoked_epoch IS NULL')
      .bind(now, reason, grantId),
    db.prepare('UPDATE mcp_tokens SET revoked_epoch = ? WHERE grant_id = ? AND revoked_epoch IS NULL').bind(now, grantId),
    db.prepare('DELETE FROM mcp_auth_codes WHERE grant_id = ?').bind(grantId),
  ];
}

export async function revokeGrant(db: D1Database, grantId: string, reason: GrantRevocationReason): Promise<void> {
  await db.batch(revokeGrantStatements(db, grantId, reason));
}

/** Replay of a code or refresh token: revoke the whole grant and leave an audit trail. */
async function revokeForReplay(db: D1Database, grantId: string, reason: 'code_reuse' | 'refresh_reuse'): Promise<void> {
  await revokeGrant(db, grantId, reason);
  const owner = await db.prepare('SELECT user_id, client_name FROM mcp_grants WHERE id = ?')
    .bind(grantId).first<{ user_id: string; client_name: string }>().catch(() => null);
  await audit(db, {
    event_type: 'mcp.grant_revoked',
    actor_id: owner?.user_id ?? null,
    actor_role: 'system',
    target: grantId,
    detail: `${reason === 'code_reuse' ? 'Authorization code' : 'Refresh token'} reused; AI app connection "${(owner?.client_name || '').slice(0, 80)}" revoked as a precaution`,
  });
}

/** Revoke every active grant held by a user (pause, offboarding). */
export function revokeUserGrantsStatements(db: D1Database, userId: string, reason: GrantRevocationReason): D1PreparedStatement[] {
  const now = nowEpoch();
  return [
    db.prepare(
      `UPDATE mcp_tokens SET revoked_epoch = ?
       WHERE revoked_epoch IS NULL AND grant_id IN (SELECT id FROM mcp_grants WHERE user_id = ? AND revoked_epoch IS NULL)`,
    ).bind(now, userId),
    db.prepare(
      `DELETE FROM mcp_auth_codes WHERE grant_id IN (SELECT id FROM mcp_grants WHERE user_id = ? AND revoked_epoch IS NULL)`,
    ).bind(userId),
    db.prepare('UPDATE mcp_grants SET revoked_epoch = ?, revoked_reason = ? WHERE user_id = ? AND revoked_epoch IS NULL')
      .bind(now, reason, userId),
  ];
}

export function revokeAllGrantsStatements(db: D1Database): D1PreparedStatement[] {
  const now = nowEpoch();
  return [
    db.prepare('UPDATE mcp_tokens SET revoked_epoch = ? WHERE revoked_epoch IS NULL').bind(now),
    db.prepare('DELETE FROM mcp_auth_codes'),
    db.prepare("UPDATE mcp_grants SET revoked_epoch = ?, revoked_reason = 'admin_all' WHERE revoked_epoch IS NULL").bind(now),
  ];
}

export interface ConsentDecision {
  approve: boolean;
  scopes: string[];
  mailboxIds: string[];
}

export type ConsentOutcome =
  | { ok: true; redirectTo: string; grantId: string | null; client: McpClient; scopes: McpScope[] }
  | { ok: false; status: 400 | 404; message: string };

/**
 * Answer a pending request for a signed-in user. On approval this creates the
 * grant (replacing any earlier grant this user gave the same client) and a
 * single-use authorization code.
 */
export async function answerAuthorizationRequest(
  db: D1Database,
  issuer: string,
  requestId: string,
  user: Pick<User, 'id'>,
  decision: ConsentDecision,
): Promise<ConsentOutcome> {
  const request = await takeAuthorizationRequest(db, requestId);
  if (!request) return { ok: false, status: 404, message: 'This sign-in request has expired. Start again from your AI app.' };

  if (!decision.approve) {
    return {
      ok: true,
      grantId: null,
      client: request.client,
      scopes: [],
      redirectTo: errorRedirect(issuer, request.redirectUri, request.state, 'access_denied', 'The user denied the request'),
    };
  }

  const chosen = parseScopes(decision.scopes.join(' ')).filter((scope) => request.requestedScopes.includes(scope));
  if (!chosen.length || decision.scopes.length > MCP_SCOPES.length) {
    return { ok: false, status: 400, message: 'Choose at least one permission.' };
  }
  const available = new Map((await consentMailboxes(db, user.id)).map((mailbox) => [mailbox.id, mailbox]));
  const mailboxIds = [...new Set(decision.mailboxIds)];
  if (!mailboxIds.length || mailboxIds.length > 200 || mailboxIds.some((id) => !available.has(id))) {
    return { ok: false, status: 400, message: 'Choose at least one of your mailboxes.' };
  }

  const now = nowEpoch();
  const grantId = generateId();
  const code = randomToken('cmac_');
  const codeHash = await sha256Hex(code);
  const previous = await db.prepare(
    'SELECT id FROM mcp_grants WHERE user_id = ? AND client_id = ? AND revoked_epoch IS NULL',
  ).bind(user.id, request.client.id).all<{ id: string }>();

  await db.batch([
    ...(previous.results || []).flatMap((grant) => revokeGrantStatements(db, grant.id, 'replaced', now)),
    db.prepare(
      `INSERT INTO mcp_grants (id, user_id, client_id, client_name, scopes, resource, created_epoch, expires_epoch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(grantId, user.id, request.client.id, request.client.client_name, formatScopes(chosen), request.resource, now, now + GRANT_MAX_LIFETIME_SECONDS),
    ...mailboxIds.map((mailboxId) => db.prepare(
      'INSERT INTO mcp_grant_mailboxes (grant_id, mailbox_id) VALUES (?, ?)',
    ).bind(grantId, mailboxId)),
    db.prepare(
      `INSERT INTO mcp_auth_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, expires_epoch)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(codeHash, grantId, request.client.id, request.redirectUri, request.codeChallenge, now + AUTH_CODE_TTL_SECONDS),
  ]);

  return {
    ok: true,
    grantId,
    client: request.client,
    scopes: chosen,
    redirectTo: buildRedirect(request.redirectUri, { code, state: request.state || undefined, iss: issuer }),
  };
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface GrantRow {
  id: string;
  user_id: string;
  client_id: string;
  scopes: string;
  resource: string;
  expires_epoch: number;
  revoked_epoch: number | null;
  user_status: string;
}

async function loadGrant(db: D1Database, grantId: string): Promise<GrantRow | null> {
  return db.prepare(
    `SELECT g.id, g.user_id, g.client_id, g.scopes, g.resource, g.expires_epoch, g.revoked_epoch, u.status AS user_status
     FROM mcp_grants g INNER JOIN users u ON u.id = g.user_id WHERE g.id = ?`,
  ).bind(grantId).first<GrantRow>();
}

function grantUsable(grant: GrantRow | null, now: number): grant is GrantRow {
  return !!grant && grant.revoked_epoch === null && grant.expires_epoch > now && grant.user_status === 'active';
}

async function issueTokens(db: D1Database, grant: GrantRow, scopes: McpScope[], now: number, extra: D1PreparedStatement[] = []): Promise<TokenResponse> {
  const accessToken = randomToken('cmat_');
  const refreshToken = randomToken('cmrt_');
  const scopeString = formatScopes(scopes);
  const accessExpiry = Math.min(now + ACCESS_TOKEN_TTL_SECONDS, grant.expires_epoch);
  const refreshExpiry = Math.min(now + REFRESH_TOKEN_TTL_SECONDS, grant.expires_epoch);
  await db.batch([
    ...extra,
    db.prepare(
      `INSERT INTO mcp_tokens (token_hash, grant_id, kind, resource, scopes, created_epoch, expires_epoch)
       VALUES (?, ?, 'access', ?, ?, ?, ?)`,
    ).bind(await sha256Hex(accessToken), grant.id, grant.resource, scopeString, now, accessExpiry),
    db.prepare(
      `INSERT INTO mcp_tokens (token_hash, grant_id, kind, resource, scopes, created_epoch, expires_epoch)
       VALUES (?, ?, 'refresh', ?, ?, ?, ?)`,
    ).bind(await sha256Hex(refreshToken), grant.id, grant.resource, scopeString, now, refreshExpiry),
    db.prepare('UPDATE mcp_grants SET last_used_epoch = ? WHERE id = ?').bind(now, grant.id),
  ]);
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: accessExpiry - now,
    refresh_token: refreshToken,
    scope: scopeString,
  };
}

/** grant_type=authorization_code */
export async function exchangeAuthorizationCode(
  db: D1Database,
  client: McpClient,
  form: URLSearchParams,
  resource: string,
): Promise<TokenResponse> {
  const code = form.get('code');
  const redirectUri = form.get('redirect_uri');
  const verifier = form.get('code_verifier');
  if (!code || !/^cmac_[A-Za-z0-9_-]{43}$/.test(code)) throw new OAuthError('invalid_grant', 'Invalid authorization code');
  if (!verifier) throw new OAuthError('invalid_request', 'code_verifier is required');
  const requestedResource = form.get('resource');
  if (requestedResource !== null && !resourceMatches(requestedResource, resource)) {
    throw new OAuthError('invalid_target', 'The resource parameter must identify this mail service\'s MCP endpoint');
  }

  const now = nowEpoch();
  const codeHash = await sha256Hex(code);
  const row = await db.prepare(
    `SELECT code_hash, grant_id, client_id, redirect_uri, code_challenge, expires_epoch, used_epoch
     FROM mcp_auth_codes WHERE code_hash = ?`,
  ).bind(codeHash).first<{
    code_hash: string; grant_id: string; client_id: string; redirect_uri: string; code_challenge: string; expires_epoch: number; used_epoch: number | null;
  }>();
  if (!row) throw new OAuthError('invalid_grant', 'Invalid authorization code');
  if (row.used_epoch !== null) {
    // RFC 9700 4.2.1 / OAuth 2.1: a replayed code revokes everything it issued.
    await revokeForReplay(db, row.grant_id, 'code_reuse');
    throw new OAuthError('invalid_grant', 'Authorization code already used');
  }
  // Any failed check burns the code: a stolen code cannot be retried with guesses.
  const burn = () => db.prepare('UPDATE mcp_auth_codes SET used_epoch = ? WHERE code_hash = ? AND used_epoch IS NULL').bind(now, codeHash).run();
  if (row.expires_epoch <= now) {
    await burn();
    throw new OAuthError('invalid_grant', 'Authorization code expired');
  }
  if (row.client_id !== client.id || redirectUri !== row.redirect_uri || !(await verifyPkceS256(verifier, row.code_challenge))) {
    await burn();
    throw new OAuthError('invalid_grant', 'Authorization code, client, redirect_uri or code_verifier do not match');
  }
  const claimed = await burn();
  if (!claimed.meta.changes) {
    await revokeForReplay(db, row.grant_id, 'code_reuse');
    throw new OAuthError('invalid_grant', 'Authorization code already used');
  }
  const grant = await loadGrant(db, row.grant_id);
  if (!grantUsable(grant, now) || grant.client_id !== client.id) throw new OAuthError('invalid_grant', 'This authorization is no longer valid');
  return issueTokens(db, grant, parseScopes(grant.scopes), now);
}

/** grant_type=refresh_token, with rotation and reuse detection. */
export async function exchangeRefreshToken(
  db: D1Database,
  client: McpClient,
  form: URLSearchParams,
  resource: string,
): Promise<TokenResponse> {
  const token = form.get('refresh_token');
  if (!token || !/^cmrt_[A-Za-z0-9_-]{43}$/.test(token)) throw new OAuthError('invalid_grant', 'Invalid refresh token');
  const requestedResource = form.get('resource');
  if (requestedResource !== null && !resourceMatches(requestedResource, resource)) {
    throw new OAuthError('invalid_target', 'The resource parameter must identify this mail service\'s MCP endpoint');
  }
  const now = nowEpoch();
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(
    `SELECT t.token_hash, t.grant_id, t.scopes, t.expires_epoch, t.used_epoch, t.revoked_epoch, g.client_id
     FROM mcp_tokens t INNER JOIN mcp_grants g ON g.id = t.grant_id
     WHERE t.token_hash = ? AND t.kind = 'refresh'`,
  ).bind(tokenHash).first<{
    token_hash: string; grant_id: string; scopes: string; expires_epoch: number; used_epoch: number | null; revoked_epoch: number | null; client_id: string;
  }>();
  if (!row || row.client_id !== client.id) throw new OAuthError('invalid_grant', 'Invalid refresh token');
  if (row.used_epoch !== null) {
    await revokeForReplay(db, row.grant_id, 'refresh_reuse');
    throw new OAuthError('invalid_grant', 'Refresh token already used; this authorization has been revoked');
  }
  if (row.revoked_epoch !== null || row.expires_epoch <= now) throw new OAuthError('invalid_grant', 'Refresh token expired or revoked');

  const tokenScopes = parseScopes(row.scopes);
  let scopes = tokenScopes;
  const scopeParam = form.get('scope');
  if (scopeParam !== null) {
    const narrowed = parseScopes(scopeParam);
    if (!narrowed.length || scopeParam.split(/\s+/).filter(Boolean).some((scope) => !tokenScopes.includes(scope as McpScope))) {
      throw new OAuthError('invalid_scope', 'A refresh can only keep or narrow the granted scopes');
    }
    scopes = narrowed;
  }

  const rotated = await db.prepare(
    'UPDATE mcp_tokens SET used_epoch = ? WHERE token_hash = ? AND used_epoch IS NULL AND revoked_epoch IS NULL',
  ).bind(now, tokenHash).run();
  if (!rotated.meta.changes) {
    await revokeForReplay(db, row.grant_id, 'refresh_reuse');
    throw new OAuthError('invalid_grant', 'Refresh token already used; this authorization has been revoked');
  }
  const grant = await loadGrant(db, row.grant_id);
  if (!grantUsable(grant, now)) throw new OAuthError('invalid_grant', 'This authorization is no longer valid');
  // The previous access token keeps its original short expiry (at most 1 h).
  return issueTokens(db, grant, scopes, now);
}

/** RFC 7009. Unknown tokens and tokens of other clients are ignored (still 200). */
export async function revokeToken(db: D1Database, client: McpClient, token: string | null): Promise<void> {
  if (!token || token.length > 200 || !/^cm(at|rt)_[A-Za-z0-9_-]{43}$/.test(token)) return;
  const row = await db.prepare(
    `SELECT t.kind, t.grant_id, g.client_id FROM mcp_tokens t INNER JOIN mcp_grants g ON g.id = t.grant_id WHERE t.token_hash = ?`,
  ).bind(await sha256Hex(token)).first<{ kind: 'access' | 'refresh'; grant_id: string; client_id: string }>();
  if (!row || row.client_id !== client.id) return;
  if (row.kind === 'refresh') {
    await revokeGrant(db, row.grant_id, 'client_revocation');
  } else {
    await db.prepare('UPDATE mcp_tokens SET revoked_epoch = ? WHERE token_hash = ? AND revoked_epoch IS NULL')
      .bind(nowEpoch(), await sha256Hex(token)).run();
  }
}

export interface BearerContext {
  grantId: string;
  clientId: string;
  clientName: string;
  scopes: McpScope[];
  user: User;
  lastUsedEpoch: number | null;
}

export type BearerResult =
  | { ok: true; context: BearerContext }
  | { ok: false; reason: 'missing' | 'invalid' };

export function bearerFromRequest(request: Request): string | null | 'malformed' {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{1,200})$/.exec(header.trim());
  return match ? match[1] : 'malformed';
}

/**
 * Validate an access token for the MCP resource: known, unexpired, unrevoked,
 * audience equal to this server, grant live, user active.
 */
export async function validateAccessToken(db: D1Database, token: string, resource: string): Promise<BearerContext | null> {
  if (!/^cmat_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const now = nowEpoch();
  const row = await db.prepare(
    `SELECT t.resource AS token_resource, t.scopes, g.id AS grant_id, g.client_id, g.client_name, g.last_used_epoch, u.*
     FROM mcp_tokens t
     INNER JOIN mcp_grants g ON g.id = t.grant_id
     INNER JOIN users u ON u.id = g.user_id
     WHERE t.token_hash = ? AND t.kind = 'access' AND t.revoked_epoch IS NULL AND t.expires_epoch > ?
       AND g.revoked_epoch IS NULL AND g.expires_epoch > ? AND u.status = 'active'`,
  ).bind(await sha256Hex(token), now, now).first<User & {
    token_resource: string; scopes: string; grant_id: string; client_id: string; client_name: string; last_used_epoch: number | null;
  }>();
  if (!row || row.token_resource !== resource) return null;
  const { scopes, grant_id, client_id, client_name, last_used_epoch, ...user } = row;
  delete (user as Partial<typeof user>).token_resource;
  return {
    grantId: grant_id,
    clientId: client_id,
    clientName: client_name,
    scopes: parseScopes(scopes),
    user: user as User,
    lastUsedEpoch: last_used_epoch,
  };
}
