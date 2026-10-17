import { describe, expect, it } from 'vitest';
import { authorizationServerMetadata, protectedResourceMetadata } from './metadata';
import {
  AuthorizePageError,
  AuthorizeRedirectError,
  answerAuthorizationRequest,
  storeAuthorizationRequest,
  validateAuthorizationRequest,
} from './oauth';
import { handleRevoke } from './oauth-http';
import { resolveClient } from './clients';
import { sha256Hex } from './crypto';
import { APP_URL, RESOURCE, createFixture } from './testing/harness';
import { REDIRECT, VERIFIER, authorize, authorizeParams, challenge, connect, mcp, register, token } from './testing/flow';

async function expectPageError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (caught) {
    expect(caught).toBeInstanceOf(AuthorizePageError);
    return (caught as Error).message;
  }
  throw new Error('expected AuthorizePageError');
}

async function expectRedirectError(promise: Promise<unknown>): Promise<URL> {
  try {
    await promise;
  } catch (caught) {
    expect(caught).toBeInstanceOf(AuthorizeRedirectError);
    return new URL((caught as AuthorizeRedirectError).redirectTo);
  }
  throw new Error('expected AuthorizeRedirectError');
}

describe('discovery metadata', () => {
  it('publishes RFC 9728 and RFC 8414 documents derived from APP_URL', () => {
    const env = { APP_URL: `${APP_URL}/` };
    expect(protectedResourceMetadata(env, 'cmail')).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [APP_URL],
      bearer_methods_supported: ['header'],
    });
    const server = authorizationServerMetadata(env);
    expect(server).toMatchObject({
      issuer: APP_URL,
      authorization_endpoint: `${APP_URL}/oauth/authorize`,
      token_endpoint: `${APP_URL}/oauth/token`,
      registration_endpoint: `${APP_URL}/oauth/register`,
      revocation_endpoint: `${APP_URL}/oauth/revoke`,
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  it('refuses to publish anything for a missing or non-https APP_URL', () => {
    expect(authorizationServerMetadata({})).toBeNull();
    expect(authorizationServerMetadata({ APP_URL: 'http://mail.example.test' })).toBeNull();
    expect(authorizationServerMetadata({ APP_URL: 'https://mail.example.test/sub' })).toBeNull();
    expect(authorizationServerMetadata({ APP_URL: 'http://localhost:5173' })).not.toBeNull();
  });
});

describe('dynamic client registration', () => {
  it('registers a public client and stores no secret', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    expect(client.client_id).toMatch(/^cmc_[0-9a-f]{32}$/);
    expect(client).not.toHaveProperty('client_secret');
    const row = fixture.db.sqlite.prepare('SELECT client_secret_hash FROM mcp_clients WHERE id = ?').get(client.client_id) as { client_secret_hash: string | null };
    expect(row.client_secret_hash).toBeNull();
  });

  it('issues a secret to a confidential client but stores only its hash', async () => {
    const fixture = createFixture();
    const client = await register(fixture, { token_endpoint_auth_method: 'client_secret_basic' });
    expect(client.client_secret).toMatch(/^cmcs_/);
    const row = fixture.db.sqlite.prepare('SELECT client_secret_hash FROM mcp_clients WHERE id = ?').get(client.client_id) as { client_secret_hash: string };
    expect(row.client_secret_hash).toBe(await sha256Hex(client.client_secret));
  });

  it.each([
    ['plain http on a public host', ['http://evil.example/callback']],
    ['javascript scheme', ['javascript:alert(1)']],
    ['a fragment', ['https://app.example/cb#frag']],
    ['credentials in the URI', [`https://${['user', 'pass'].join(':')}@app.example/cb`]],
    ['no redirect URIs', []],
  ])('rejects %s', async (_label, redirectUris) => {
    const fixture = createFixture();
    await expect(register(fixture, { redirect_uris: redirectUris })).rejects.toThrow(/register failed: 400/);
  });

  it('refuses registration while the organisation switch is off', async () => {
    const fixture = createFixture();
    fixture.db.sqlite.exec("UPDATE org_settings SET value = 'false' WHERE key = 'mcp_enabled'");
    await expect(register(fixture)).rejects.toThrow(/register failed: 403/);
  });
});

describe('authorization request validation', () => {
  it('shows an error page, never a redirect, for an unknown client or unregistered redirect URI', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    await expectPageError(validateAuthorizationRequest(fixture.db.d1, authorizeParams('cmc_unknownclient000000', { code_challenge: await challenge() }), APP_URL, RESOURCE));
    await expectPageError(validateAuthorizationRequest(fixture.db.d1, authorizeParams(client.client_id, {
      code_challenge: await challenge(),
      redirect_uri: 'https://attacker.example/steal',
    }), APP_URL, RESOURCE));
  });

  it('lets a loopback redirect change port but not path', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    const ok = await validateAuthorizationRequest(fixture.db.d1, authorizeParams(client.client_id, {
      code_challenge: await challenge(),
      redirect_uri: 'http://127.0.0.1:51999/callback',
    }), APP_URL, RESOURCE);
    expect(ok.redirectUri).toBe('http://127.0.0.1:51999/callback');
    await expectPageError(validateAuthorizationRequest(fixture.db.d1, authorizeParams(client.client_id, {
      code_challenge: await challenge(),
      redirect_uri: 'http://127.0.0.1:51999/other',
    }), APP_URL, RESOURCE));
  });

  it('requires PKCE with S256 and returns errors to the client with state and iss', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    const missing = await expectRedirectError(validateAuthorizationRequest(fixture.db.d1, authorizeParams(client.client_id, { code_challenge: null }), APP_URL, RESOURCE));
    expect(missing.searchParams.get('error')).toBe('invalid_request');
    expect(missing.searchParams.get('state')).toBe('state-123');
    expect(missing.searchParams.get('iss')).toBe(APP_URL);
    const plain = await expectRedirectError(validateAuthorizationRequest(fixture.db.d1, authorizeParams(client.client_id, {
      code_challenge: await challenge(),
      code_challenge_method: 'plain',
    }), APP_URL, RESOURCE));
    expect(plain.searchParams.get('error')).toBe('invalid_request');
  });

  it('rejects a resource that is not this MCP endpoint', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    const wrong = await expectRedirectError(validateAuthorizationRequest(fixture.db.d1, authorizeParams(client.client_id, {
      code_challenge: await challenge(),
      resource: 'https://other.example/mcp',
    }), APP_URL, RESOURCE));
    expect(wrong.searchParams.get('error')).toBe('invalid_target');
  });

  it('rejects duplicated parameters', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    const params = authorizeParams(client.client_id, { code_challenge: await challenge() });
    params.append('redirect_uri', 'https://attacker.example/cb');
    await expectPageError(validateAuthorizationRequest(fixture.db.d1, params, APP_URL, RESOURCE));
  });
});

describe('consent', () => {
  it('grants only requested scopes and only mailboxes the user can access', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    const params = authorizeParams(client.client_id, { code_challenge: await challenge(), scope: 'mail.read' });
    const requestId = await storeAuthorizationRequest(fixture.db.d1, await validateAuthorizationRequest(fixture.db.d1, params, APP_URL, RESOURCE));
    const outcome = await answerAuthorizationRequest(fixture.db.d1, APP_URL, requestId, { id: 'user-alice' }, {
      approve: true,
      scopes: ['mail.read', 'mail.send'],
      mailboxIds: ['mb-alice'],
    });
    expect(outcome.ok && outcome.scopes).toEqual(['mail.read']);

    const second = await storeAuthorizationRequest(fixture.db.d1, await validateAuthorizationRequest(fixture.db.d1, params, APP_URL, RESOURCE));
    const foreign = await answerAuthorizationRequest(fixture.db.d1, APP_URL, second, { id: 'user-alice' }, {
      approve: true,
      scopes: ['mail.read'],
      mailboxIds: ['mb-bob'],
    });
    expect(foreign).toMatchObject({ ok: false, status: 400 });
  });

  it('can be answered only once, and a denial returns access_denied', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    const params = authorizeParams(client.client_id, { code_challenge: await challenge() });
    const requestId = await storeAuthorizationRequest(fixture.db.d1, await validateAuthorizationRequest(fixture.db.d1, params, APP_URL, RESOURCE));
    const denied = await answerAuthorizationRequest(fixture.db.d1, APP_URL, requestId, { id: 'user-alice' }, { approve: false, scopes: [], mailboxIds: [] });
    expect(denied.ok).toBe(true);
    if (denied.ok) {
      const url = new URL(denied.redirectTo);
      expect(url.searchParams.get('error')).toBe('access_denied');
      expect(url.searchParams.get('iss')).toBe(APP_URL);
    }
    const again = await answerAuthorizationRequest(fixture.db.d1, APP_URL, requestId, { id: 'user-alice' }, {
      approve: true, scopes: ['mail.read'], mailboxIds: ['mb-alice'],
    });
    expect(again).toMatchObject({ ok: false, status: 404 });
  });

  it('replaces an earlier grant from the same user to the same client', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    const first = await authorize(fixture, client.client_id);
    await authorize(fixture, client.client_id);
    const grants = fixture.db.sqlite.prepare('SELECT revoked_reason FROM mcp_grants ORDER BY created_epoch, rowid').all() as Array<{ revoked_reason: string | null }>;
    expect(grants.map((grant) => grant.revoked_reason)).toEqual(['replaced', null]);
    const stale = await token(fixture, { grant_type: 'authorization_code', code: first.code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: client.client_id });
    expect(stale.status).toBe(400);
  });
});

describe('token endpoint', () => {
  it('exchanges a code with the right verifier for audience-bound, hashed tokens', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'mail.read mail.draft' });
    expect(tokens.access_token).toMatch(/^cmat_/);
    expect(tokens.refresh_token).toMatch(/^cmrt_/);
    const stored = fixture.db.sqlite.prepare('SELECT token_hash, resource FROM mcp_tokens').all() as Array<{ token_hash: string; resource: string }>;
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.token_hash)).toContain(await sha256Hex(tokens.access_token));
    expect(JSON.stringify(stored)).not.toContain(tokens.access_token);
    expect(stored.every((row) => row.resource === RESOURCE)).toBe(true);
  });

  it('rejects a wrong PKCE verifier and burns the code', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    const { code } = await authorize(fixture, client.client_id);
    const bad = await token(fixture, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: `${VERIFIER}x`, client_id: client.client_id });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_grant' });
    const retry = await token(fixture, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: client.client_id });
    expect(retry.status).toBe(400);
  });

  it('rejects a mismatched redirect_uri or client', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    const other = await register(fixture);
    const first = await authorize(fixture, client.client_id);
    const wrongRedirect = await token(fixture, { grant_type: 'authorization_code', code: first.code, redirect_uri: 'http://127.0.0.1:1/elsewhere', code_verifier: VERIFIER, client_id: client.client_id });
    expect(await wrongRedirect.json()).toMatchObject({ error: 'invalid_grant' });
    const second = await authorize(fixture, client.client_id);
    const wrongClient = await token(fixture, { grant_type: 'authorization_code', code: second.code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: other.client_id });
    expect(await wrongClient.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('rejects an expired code', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    const { code } = await authorize(fixture, client.client_id);
    fixture.db.sqlite.exec('UPDATE mcp_auth_codes SET expires_epoch = unixepoch() - 1');
    const expired = await token(fixture, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: client.client_id });
    expect(await expired.json()).toMatchObject({ error: 'invalid_grant', error_description: 'Authorization code expired' });
  });

  it('treats a replayed code as theft and revokes everything it issued', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    const { code } = await authorize(fixture, client.client_id);
    const form = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: client.client_id };
    const first = await token(fixture, form);
    const tokens = await first.json() as { access_token: string };
    expect((await mcp(fixture, tokens.access_token, 'tools/list')).status).toBe(200);
    const replay = await token(fixture, form);
    expect(replay.status).toBe(400);
    expect((await mcp(fixture, tokens.access_token, 'tools/list')).status).toBe(401);
    const audit = fixture.db.sqlite.prepare("SELECT detail FROM audit_log WHERE event_type = 'mcp.grant_revoked'").all() as Array<{ detail: string }>;
    expect(audit[0]?.detail).toContain('Authorization code reused');
  });

  it('rotates refresh tokens and revokes the grant when an old one is reused', async () => {
    const fixture = createFixture();
    const { clientId, tokens } = await connect(fixture);
    const rotated = await token(fixture, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId, resource: RESOURCE });
    expect(rotated.status).toBe(200);
    const next = await rotated.json() as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcp(fixture, next.access_token, 'tools/list')).status).toBe(200);

    const reuse = await token(fixture, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
    expect(reuse.status).toBe(400);
    expect(await reuse.json()).toMatchObject({ error: 'invalid_grant' });
    expect((await mcp(fixture, next.access_token, 'tools/list')).status).toBe(401);
    const afterTheft = await token(fixture, { grant_type: 'refresh_token', refresh_token: next.refresh_token, client_id: clientId });
    expect(afterTheft.status).toBe(400);
    const grant = fixture.db.sqlite.prepare('SELECT revoked_reason FROM mcp_grants').get() as { revoked_reason: string };
    expect(grant.revoked_reason).toBe('refresh_reuse');
  });

  it('only lets a refresh narrow scopes, never widen them', async () => {
    const fixture = createFixture();
    const { clientId, tokens } = await connect(fixture);
    const widen = await token(fixture, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId, scope: 'mail.read mail.send' });
    expect(await widen.json()).toMatchObject({ error: 'invalid_scope' });
    const narrow = await token(fixture, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId, scope: 'mail.read' });
    expect(await narrow.json()).toMatchObject({ scope: 'mail.read' });
  });

  it('authenticates confidential clients with Basic or post credentials', async () => {
    const fixture = createFixture();
    const client = await register(fixture, { token_endpoint_auth_method: 'client_secret_basic' });
    const { code } = await authorize(fixture, client.client_id);
    const form = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER };
    const missing = await token(fixture, { ...form, client_id: client.client_id });
    expect(missing.status).toBe(401);
    const wrongSecret = await token(fixture, form, { authorization: `Basic ${btoa(`${client.client_id}:wrong`)}` });
    expect(wrongSecret.status).toBe(401);
    expect(wrongSecret.headers.get('www-authenticate')).toContain('Basic');
    const second = await authorize(fixture, client.client_id);
    const ok = await token(fixture, { ...form, code: second.code }, { authorization: `Basic ${btoa(`${client.client_id}:${client.client_secret}`)}` });
    expect(ok.status).toBe(200);
  });

  it('rejects unsupported grant types and non-form bodies', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    const password = await token(fixture, { grant_type: 'password', client_id: client.client_id, username: 'a', password: 'b' });
    expect(await password.json()).toMatchObject({ error: 'unsupported_grant_type' });
    const response = await (await import('./oauth-http')).handleToken(new Request(`${APP_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code' }),
    }), fixture.platform);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('stops issuing tokens when the organisation switch is turned off', async () => {
    const fixture = createFixture();
    const client = await register(fixture);
    const { code } = await authorize(fixture, client.client_id);
    fixture.db.sqlite.exec("UPDATE org_settings SET value = 'false' WHERE key = 'mcp_enabled'");
    const response = await token(fixture, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: client.client_id });
    expect(response.status).toBe(403);
  });
});

describe('revocation and lifetime', () => {
  async function revoke(fixture: ReturnType<typeof createFixture>, clientId: string, value: string): Promise<Response> {
    return handleRevoke(new Request(`${APP_URL}/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: value, client_id: clientId }).toString(),
    }), fixture.platform);
  }

  it('revokes an access token, and a refresh token revokes the whole grant', async () => {
    const fixture = createFixture();
    const { clientId, tokens } = await connect(fixture);
    expect((await revoke(fixture, clientId, tokens.access_token)).status).toBe(200);
    expect((await mcp(fixture, tokens.access_token, 'tools/list')).status).toBe(401);
    const refreshed = await token(fixture, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
    const next = await refreshed.json() as { access_token: string; refresh_token: string };
    expect((await revoke(fixture, clientId, next.refresh_token)).status).toBe(200);
    expect((await mcp(fixture, next.access_token, 'tools/list')).status).toBe(401);
  });

  it('ignores another client\'s token and unknown tokens with a 200', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    const other = await register(fixture);
    expect((await revoke(fixture, other.client_id, tokens.access_token)).status).toBe(200);
    expect((await mcp(fixture, tokens.access_token, 'tools/list')).status).toBe(200);
    expect((await revoke(fixture, other.client_id, 'cmat_not-a-real-token')).status).toBe(200);
  });

  it('rejects expired access tokens and tokens for another audience', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    fixture.db.sqlite.exec("UPDATE mcp_tokens SET expires_epoch = unixepoch() - 1 WHERE kind = 'access'");
    expect((await mcp(fixture, tokens.access_token, 'tools/list')).status).toBe(401);
    const second = await connect(fixture);
    fixture.db.sqlite.exec("UPDATE mcp_tokens SET resource = 'https://other.example/mcp' WHERE kind = 'access'");
    expect((await mcp(fixture, second.tokens.access_token, 'tools/list')).status).toBe(401);
  });

  it('stops working when the user is paused or offboarded', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    fixture.db.sqlite.exec("UPDATE users SET status = 'paused' WHERE id = 'user-alice'");
    expect((await mcp(fixture, tokens.access_token, 'tools/list')).status).toBe(401);
  });
});

describe('client ID metadata documents', () => {
  const documentUrl = 'https://agent.example.com/oauth/client.json';
  function fetcher(document: Record<string, unknown>, init: ResponseInit = {}): typeof fetch {
    return (async () => new Response(JSON.stringify(document), { status: 200, headers: { 'content-type': 'application/json' }, ...init })) as unknown as typeof fetch;
  }

  it('accepts a valid document whose client_id matches its URL', async () => {
    const fixture = createFixture();
    const client = await resolveClient(fixture.db.d1, documentUrl, fetcher({
      client_id: documentUrl,
      client_name: 'Example Agent',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
    }));
    expect(client).toMatchObject({ id: documentUrl, registration_type: 'cimd', client_name: 'Example Agent' });
    const params = authorizeParams(documentUrl, { code_challenge: await challenge() });
    const validated = await validateAuthorizationRequest(fixture.db.d1, params, APP_URL, RESOURCE);
    expect(validated.client.id).toBe(documentUrl);
  });

  it.each([
    ['a mismatched client_id', { client_id: 'https://evil.example/client.json', client_name: 'X', redirect_uris: [REDIRECT] }],
    ['a confidential auth method', { client_id: documentUrl, client_name: 'X', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_post' }],
    ['no client_name', { client_id: documentUrl, redirect_uris: [REDIRECT] }],
    ['an unsafe redirect', { client_id: documentUrl, client_name: 'X', redirect_uris: ['http://evil.example/cb'] }],
  ])('rejects %s', async (_label, document) => {
    const fixture = createFixture();
    expect(await resolveClient(fixture.db.d1, documentUrl, fetcher(document))).toBeNull();
  });

  it('never fetches IP literals, local names or redirecting documents', async () => {
    const fixture = createFixture();
    let calls = 0;
    const counting = (async () => { calls += 1; return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
    for (const url of ['https://127.0.0.1/c.json', 'https://[::1]/c.json', 'https://localhost/c.json', 'https://intranet/c.json', 'http://agent.example.com/c.json', 'https://agent.example.com/']) {
      expect(await resolveClient(fixture.db.d1, url, counting)).toBeNull();
    }
    expect(calls).toBe(0);
    const redirecting = (async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } })) as unknown as typeof fetch;
    expect(await resolveClient(fixture.db.d1, documentUrl, redirecting)).toBeNull();
  });
});
