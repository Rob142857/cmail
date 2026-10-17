// Discovery documents: RFC 9728 protected resource metadata and RFC 8414
// authorization server metadata. Both are public and contain no tenant
// secrets; every URL is derived from APP_URL.
import { MCP_SCOPES, mcpIssuer, mcpResource } from './config';

export function protectedResourceMetadata(env: Record<string, unknown>, resourceName: string): Record<string, unknown> | null {
  const issuer = mcpIssuer(env);
  const resource = mcpResource(env);
  if (!issuer || !resource) return null;
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: resourceName,
    resource_documentation: 'https://github.com/Rob142857/cmail/blob/main/docs/mcp.md',
  };
}

export function authorizationServerMetadata(env: Record<string, unknown>): Record<string, unknown> | null {
  const issuer = mcpIssuer(env);
  if (!issuer) return null;
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: 'https://github.com/Rob142857/cmail/blob/main/docs/mcp.md',
  };
}

export function metadataResponse(body: Record<string, unknown> | null): Response {
  if (!body) {
    return new Response(JSON.stringify({ error: 'not_configured' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      // Discovery documents are read by MCP clients, some of which run in browsers.
      'Access-Control-Allow-Origin': '*',
    },
  });
}
