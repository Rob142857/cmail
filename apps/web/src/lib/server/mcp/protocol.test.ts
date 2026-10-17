import { describe, expect, it } from 'vitest';
import { handleMcpRequest, decodeHeaderValue } from './protocol';
import { APP_URL, createFixture } from './testing/harness';
import { connect, mcp } from './testing/flow';

async function modern(
  fixture: ReturnType<typeof createFixture>,
  accessToken: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const params = (body.params as Record<string, unknown> | undefined) ?? {};
  const response = await handleMcpRequest(new Request(`${APP_URL}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': String(body.method),
      ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      ...body,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': headers['x-body-version'] ?? '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  }), fixture.platform, { waitUntil: () => undefined });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe('MCP endpoint authentication', () => {
  it('answers 401 with a WWW-Authenticate challenge pointing at the resource metadata', async () => {
    const fixture = createFixture();
    const response = await mcp(fixture, null, 'tools/list');
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') || '';
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(`resource_metadata="${APP_URL}/.well-known/oauth-protected-resource"`);
    expect(challenge).toContain('scope="mail.read mail.draft"');
  });

  it('marks a bad token invalid_token and never falls back to cookies', async () => {
    const fixture = createFixture();
    const response = await mcp(fixture, 'cmat_bogus', 'tools/list', {}, { cookie: 'cmail_session=anything' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('rejects GET and DELETE with 405 and cross-origin browser calls with 403', async () => {
    const fixture = createFixture();
    const get = await handleMcpRequest(new Request(`${APP_URL}/mcp`, { method: 'GET' }), fixture.platform);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    const del = await handleMcpRequest(new Request(`${APP_URL}/mcp`, { method: 'DELETE' }), fixture.platform);
    expect(del.status).toBe(405);
    const { tokens } = await connect(fixture);
    const crossOrigin = await mcp(fixture, tokens.access_token, 'tools/list', {}, { origin: 'https://evil.example' });
    expect(crossOrigin.status).toBe(403);
  });

  it('returns 403 when the organisation has AI app connections switched off', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    fixture.db.sqlite.exec("UPDATE org_settings SET value = 'false' WHERE key = 'mcp_enabled'");
    const response = await mcp(fixture, tokens.access_token, 'tools/list');
    expect(response.status).toBe(403);
    expect(response.body?.error?.message).toMatch(/turned off/);
    fixture.db.sqlite.exec("DELETE FROM org_settings WHERE key = 'mcp_enabled'");
    expect((await mcp(fixture, tokens.access_token, 'tools/list')).status).toBe(403);
  });

  it('returns 403 until the user has accepted the latest usage policy', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    fixture.db.sqlite.exec("INSERT INTO ict_policy_versions (id, version_label, body_text) VALUES ('policy-2', 'v2', 'Be kind')");
    expect((await mcp(fixture, tokens.access_token, 'tools/list')).status).toBe(403);
    fixture.db.sqlite.exec("INSERT INTO ict_policy_signatures (id, user_id, policy_version_id) VALUES ('sig-1', 'user-alice', 'policy-2')");
    expect((await mcp(fixture, tokens.access_token, 'tools/list')).status).toBe(200);
  });

  it('rate limits each connection', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    fixture.db.sqlite.exec(`INSERT INTO rate_limits (key, count, expires_at)
      SELECT 'mcp-call-min:' || id || ':' || (unixepoch() / 60), 60, unixepoch() + 60 FROM mcp_grants`);
    const response = await mcp(fixture, tokens.access_token, 'tools/list');
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('legacy (initialize-based) protocol', () => {
  it('initializes statelessly and negotiates a supported version', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    const response = await mcp(fixture, tokens.access_token, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' },
    }, { 'mcp-protocol-version': '' });
    expect(response.status).toBe(200);
    expect(response.body?.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'cmail' } });
    expect(response.body?.result.instructions).toMatch(/untrusted/);
    expect(response.headers.get('mcp-session-id')).toBeNull();
    const future = await mcp(fixture, tokens.access_token, 'initialize', { protocolVersion: '2099-01-01' });
    expect(future.body?.result.protocolVersion).toBe('2025-11-25');
  });

  it('accepts notifications with 202 and rejects batches and unknown versions', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    const notification = await handleMcpRequest(new Request(`${APP_URL}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.access_token}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }), fixture.platform, { waitUntil: () => undefined });
    expect(notification.status).toBe(202);
    const batch = await handleMcpRequest(new Request(`${APP_URL}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.access_token}` },
      body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]),
    }), fixture.platform, { waitUntil: () => undefined });
    expect(batch.status).toBe(400);
    const unknown = await mcp(fixture, tokens.access_token, 'tools/list', {}, { 'mcp-protocol-version': '1999-01-01' });
    expect(unknown.status).toBe(400);
    expect(unknown.body?.error).toMatchObject({ code: -32022, data: { supported: expect.arrayContaining(['2026-07-28', '2025-11-25']) } });
  });

  it('lists only the tools the granted scopes allow', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture, { scopes: ['mail.read'] });
    const response = await mcp(fixture, tokens.access_token, 'tools/list');
    const names = (response.body?.result.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).toEqual(['list_mailboxes', 'list_folders', 'search_messages', 'get_message', 'get_thread']);
    const tool = response.body?.result.tools.find((candidate: { name: string }) => candidate.name === 'get_message');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false, required: ['message_id'] });
  });

  it('answers a call without the needed scope with a 403 insufficient_scope challenge', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture, { scopes: ['mail.read'] });
    const response = await mcp(fixture, tokens.access_token, 'tools/call', { name: 'send_message', arguments: {} });
    expect(response.status).toBe(403);
    const challenge = response.headers.get('www-authenticate') || '';
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="mail.read mail.send"');
    const audit = fixture.db.sqlite.prepare('SELECT tool, result, error_code FROM mcp_tool_calls').get();
    expect(audit).toEqual({ tool: 'send_message', result: 'denied', error_code: 'insufficient_scope' });
  });

  it('returns JSON-RPC errors for unknown tools and methods', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    expect((await mcp(fixture, tokens.access_token, 'tools/call', { name: 'delete_everything' })).body?.error.code).toBe(-32602);
    const unknown = await mcp(fixture, tokens.access_token, 'resources/list');
    expect(unknown.status).toBe(200);
    expect(unknown.body?.error.code).toBe(-32601);
  });
});

describe('modern (2026-07-28) protocol', () => {
  it('serves server/discover and stateless tools/list with resultType', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    const discover = await modern(fixture, tokens.access_token, { method: 'server/discover' });
    expect(discover.status).toBe(200);
    expect(discover.body.result).toMatchObject({
      resultType: 'complete',
      supportedVersions: expect.arrayContaining(['2026-07-28']),
      capabilities: { tools: { listChanged: false } },
    });
    const list = await modern(fixture, tokens.access_token, { method: 'tools/list' });
    expect(list.body.result.resultType).toBe('complete');
    expect(list.body.result.tools.length).toBeGreaterThan(3);
  });

  it('rejects header and body mismatches with -32020', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    const method = await modern(fixture, tokens.access_token, { method: 'tools/list' }, { 'mcp-method': 'tools/call' });
    expect(method.status).toBe(400);
    expect(method.body.error.code).toBe(-32020);
    const name = await modern(fixture, tokens.access_token, { method: 'tools/call', params: { name: 'list_mailboxes', arguments: {} } }, { 'mcp-name': 'send_message' });
    expect(name.body.error.code).toBe(-32020);
    const version = await modern(fixture, tokens.access_token, { method: 'tools/list' }, { 'x-body-version': '2026-01-01' });
    expect(version.body.error.code).toBe(-32020);
  });

  it('accepts a Base64-encoded Mcp-Name and runs the tool', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    const encoded = `=?base64?${btoa('list_mailboxes')}?=`;
    const response = await modern(fixture, tokens.access_token, { method: 'tools/call', params: { name: 'list_mailboxes', arguments: {} } }, { 'mcp-name': encoded });
    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({ resultType: 'complete', isError: false });
  });

  it('answers unknown modern methods with 404 and -32601', async () => {
    const fixture = createFixture();
    const { tokens } = await connect(fixture);
    const response = await modern(fixture, tokens.access_token, { method: 'resources/list' });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe(-32601);
  });

  it('decodes header sentinels strictly', () => {
    expect(decodeHeaderValue('plain')).toBe('plain');
    expect(decodeHeaderValue(`=?base64?${btoa('x')}?=`)).toBe('x');
    expect(decodeHeaderValue('=?base64?!!!?=')).toBe('=?base64?!!!?=');
  });
});
