// Test-only helpers that drive the real OAuth endpoints end to end.
import type { User } from '@cmail/shared/types';
import { handleRegister, handleToken } from '../oauth-http';
import { answerAuthorizationRequest, storeAuthorizationRequest, validateAuthorizationRequest } from '../oauth';
import { handleMcpRequest } from '../protocol';
import { sha256Base64Url } from '../crypto';
import { APP_URL, RESOURCE, type Fixture } from './harness';

export const VERIFIER = 'test-verifier-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEFG';
export const REDIRECT = 'http://127.0.0.1:33418/callback';

export async function userRow(fixture: Fixture, id: string): Promise<User> {
  return (await fixture.db.d1.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>()) as User;
}

export async function register(fixture: Fixture, metadata: Record<string, unknown> = {}): Promise<Record<string, string>> {
  const response = await handleRegister(new Request(`${APP_URL}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: JSON.stringify({ client_name: 'Test Agent', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', ...metadata }),
  }), fixture.platform);
  if (response.status !== 201) throw new Error(`register failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<Record<string, string>>;
}

export function authorizeParams(clientId: string, overrides: Record<string, string | null> = {}): URLSearchParams {
  return new URLSearchParams(Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    state: 'state-123',
    code_challenge: '',
    code_challenge_method: 'S256',
    scope: 'mail.read mail.draft mail.send mailbox.manage calendar.read',
    resource: RESOURCE,
    ...overrides,
  }).filter((entry): entry is [string, string] => entry[1] !== null));
}

export async function challenge(): Promise<string> {
  return sha256Base64Url(VERIFIER);
}

/** Validate, store and approve an authorization request; returns the code from the redirect. */
export async function authorize(
  fixture: Fixture,
  clientId: string,
  options: { userId?: string; scopes?: string[]; mailboxIds?: string[]; params?: Record<string, string | null> } = {},
): Promise<{ code: string; redirect: URL }> {
  const params = authorizeParams(clientId, { code_challenge: await challenge(), ...options.params });
  const validated = await validateAuthorizationRequest(fixture.db.d1, params, APP_URL, RESOURCE);
  const requestId = await storeAuthorizationRequest(fixture.db.d1, validated);
  const outcome = await answerAuthorizationRequest(fixture.db.d1, APP_URL, requestId, { id: options.userId ?? 'user-alice' }, {
    approve: true,
    scopes: options.scopes ?? ['mail.read', 'mail.draft'],
    mailboxIds: options.mailboxIds ?? ['mb-alice', 'mb-desk'],
  });
  if (!outcome.ok) throw new Error(`consent failed: ${outcome.message}`);
  const redirect = new URL(outcome.redirectTo);
  return { code: redirect.searchParams.get('code') as string, redirect };
}

export async function token(fixture: Fixture, form: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> {
  return handleToken(new Request(`${APP_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '203.0.113.9', ...headers },
    body: new URLSearchParams(form).toString(),
  }), fixture.platform);
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/** Register a public client, approve it as a user, and exchange the code. */
export async function connect(
  fixture: Fixture,
  options: { userId?: string; scopes?: string[]; mailboxIds?: string[] } = {},
): Promise<{ clientId: string; tokens: Tokens }> {
  const client = await register(fixture);
  const { code } = await authorize(fixture, client.client_id, options);
  const response = await token(fixture, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    code_verifier: VERIFIER,
    client_id: client.client_id,
    resource: RESOURCE,
  });
  if (response.status !== 200) throw new Error(`token failed: ${response.status} ${await response.text()}`);
  return { clientId: client.client_id, tokens: await response.json() as Tokens };
}

let nextId = 1;

/** POST a legacy-era (initialize-based) JSON-RPC request to /mcp. */
export async function mcp(
  fixture: Fixture,
  accessToken: string | null,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, any> | null; headers: Headers }> {
  const response = await handleMcpRequest(new Request(`${APP_URL}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  }), fixture.platform, { waitUntil: () => undefined });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

export async function callTool(
  fixture: Fixture,
  accessToken: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ status: number; isError: boolean; text: string; structured: Record<string, any> | undefined; body: Record<string, any> | null }> {
  const result = await mcp(fixture, accessToken, 'tools/call', { name, arguments: args });
  const payload = result.body?.result;
  return {
    status: result.status,
    isError: payload?.isError === true,
    text: payload?.content?.[0]?.text ?? '',
    structured: payload?.structuredContent,
    body: result.body,
  };
}
