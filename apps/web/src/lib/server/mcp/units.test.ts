import { describe, expect, it } from 'vitest';
import { classifyRedirectUri, redirectUriMatches, validateRedirectUriList } from './redirect-uri';
import { MCP_RESUME_PATH, mcpResumeLocation } from './resume';
import { cimdCacheSeconds, isClientIdMetadataUrl, presentedClientCredentials } from './clients';
import { mcpIssuer, parseScopes, resourceMatches } from './config';
import { isValidCodeChallenge, isValidCodeVerifier, verifyPkceS256, sha256Base64Url } from './crypto';
import { mcpMaintenanceStatements } from './maintenance';
import { createTestDatabase } from './testing/harness';

describe('redirect URI policy', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', 'https'],
    ['http://127.0.0.1:8080/cb', 'loopback'],
    ['http://[::1]:8080/cb', 'loopback'],
    ['http://localhost/cb', 'loopback'],
    ['com.example.app:/oauth', 'private-use'],
    ['cursor://anysphere.cursor-mcp/oauth/callback', 'private-use'],
  ])('accepts %s as %s', (uri, kind) => {
    expect(classifyRedirectUri(uri)).toBe(kind);
  });

  it.each([
    'http://example.com/cb', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'https://a.example/cb#x',
    `https://${['user', 'pw'].join(':')}@a.example/cb`, 'vbscript:x', ' https://a.example/cb', 'https://a.example/c b', 'ws://a.example', '',
  ])('rejects %s', (uri) => {
    expect(classifyRedirectUri(uri)).toBeNull();
  });

  it('matches https exactly and loopback by everything except port', () => {
    const registered = ['https://app.example/cb', 'http://127.0.0.1:1234/callback'];
    expect(redirectUriMatches('https://app.example/cb', registered)).toBe(true);
    expect(redirectUriMatches('https://app.example/cb/', registered)).toBe(false);
    expect(redirectUriMatches('https://APP.example/cb', registered)).toBe(false);
    expect(redirectUriMatches('http://127.0.0.1:9999/callback', registered)).toBe(true);
    expect(redirectUriMatches('http://localhost:9999/callback', registered)).toBe(false);
    expect(redirectUriMatches('http://127.0.0.1:9999/callback?x=1', registered)).toBe(false);
  });

  it('caps registration lists', () => {
    expect(validateRedirectUriList(Array.from({ length: 11 }, (_, index) => `https://a.example/${index}`))).toBeNull();
    expect(validateRedirectUriList(['https://a.example/cb', 'https://a.example/cb'])).toEqual(['https://a.example/cb']);
  });
});

describe('post sign-in resume', () => {
  it('only ever returns the fixed consent path, and only for a well-formed request id', () => {
    const id = `cmar_${'a'.repeat(43)}`;
    expect(mcpResumeLocation(id, '/mail')).toBe(MCP_RESUME_PATH);
    expect(mcpResumeLocation(id, '/policy')).toBe('/policy');
    expect(mcpResumeLocation('https://evil.example', '/mail')).toBe('/mail');
    expect(mcpResumeLocation(undefined, '/mail')).toBe('/mail');
    expect(MCP_RESUME_PATH.startsWith('/') && !MCP_RESUME_PATH.startsWith('//')).toBe(true);
  });
});

describe('small helpers', () => {
  it('recognises metadata-document client ids conservatively', () => {
    expect(isClientIdMetadataUrl('https://claude.ai/oauth/claude-code-client-metadata')).toBe(true);
    for (const value of ['https://claude.ai', 'https://claude.ai/', 'https://1.2.3.4/x', 'https://a.local/x', 'https://a.example/x?y=1', 'https://a.example/x#y', 'http://a.example/x']) {
      expect(isClientIdMetadataUrl(value)).toBe(false);
    }
  });

  it('caches metadata documents per Cache-Control, between 5 minutes and a day', () => {
    expect(cimdCacheSeconds(null)).toBe(86_400);
    expect(cimdCacheSeconds('public, max-age=3600')).toBe(3600);
    expect(cimdCacheSeconds('max-age=10')).toBe(300);
    expect(cimdCacheSeconds('max-age=31536000')).toBe(86_400);
    expect(cimdCacheSeconds('no-store')).toBe(300);
    expect(cimdCacheSeconds('max-age=600, no-cache')).toBe(300);
    expect(cimdCacheSeconds('max-age="900"')).toBe(900);
    expect(cimdCacheSeconds('private')).toBe(86_400);
  });

  it('parses scopes, issuers and resources strictly', () => {
    expect(parseScopes('mail.send openid mail.read mail.read')).toEqual(['mail.read', 'mail.send']);
    expect(mcpIssuer({ APP_URL: 'https://Mail.Example.test/' })).toBe('https://mail.example.test');
    expect(mcpIssuer({ APP_URL: 'https://mail.example.test/?x=1' })).toBeNull();
    expect(resourceMatches('HTTPS://MAIL.EXAMPLE.TEST/mcp/', 'https://mail.example.test/mcp')).toBe(true);
    expect(resourceMatches('https://mail.example.test/mcp/other', 'https://mail.example.test/mcp')).toBe(false);
    expect(resourceMatches('https://mail.example.test/mcp#x', 'https://mail.example.test/mcp')).toBe(false);
  });

  it('verifies PKCE S256 only for well-formed values', async () => {
    const verifier = 'v'.repeat(43);
    const challenge = await sha256Base64Url(verifier);
    expect(isValidCodeVerifier(verifier)).toBe(true);
    expect(isValidCodeVerifier('short')).toBe(false);
    expect(isValidCodeChallenge(challenge)).toBe(true);
    expect(await verifyPkceS256(verifier, challenge)).toBe(true);
    expect(await verifyPkceS256(verifier, verifier)).toBe(false);
  });

  it('reads client credentials from Basic or the body, never both', () => {
    const basic = new Request('https://x.example', { headers: { authorization: `Basic ${btoa('cid:secret+1')}` } });
    expect(presentedClientCredentials(basic, new URLSearchParams())).toEqual({ clientId: 'cid', clientSecret: 'secret 1', method: 'client_secret_basic' });
    expect(() => presentedClientCredentials(basic, new URLSearchParams('client_secret=x'))).toThrow();
    expect(presentedClientCredentials(new Request('https://x.example'), new URLSearchParams('client_id=a'))).toEqual({ clientId: 'a', clientSecret: null, method: 'none' });
  });

  it('runs every maintenance statement against the real schema', async () => {
    const { d1 } = createTestDatabase();
    for (const statement of mcpMaintenanceStatements(d1)) await statement.run();
  });
});
