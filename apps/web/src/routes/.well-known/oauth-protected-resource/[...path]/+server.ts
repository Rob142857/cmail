import type { RequestHandler } from './$types';
import { loadOrgSettings } from '#lib/server/org-settings.js';
import { metadataResponse, protectedResourceMetadata } from '#lib/server/mcp/metadata.js';

// RFC 9728 metadata, served at the root form and at the path-suffixed form
// (/.well-known/oauth-protected-resource/mcp) that clients derive from the
// MCP endpoint URL. Any other suffix is not a resource on this server.
export const GET: RequestHandler = async ({ params, platform }) => {
  if (params.path !== '' && params.path !== 'mcp') return new Response('Not found', { status: 404 });
  const env = platform?.env as unknown as Record<string, unknown> | undefined;
  if (!env) return metadataResponse(null);
  const settings = await loadOrgSettings(env);
  return metadataResponse(protectedResourceMetadata(env, `${settings.appName}${settings.orgShortName ? ` (${settings.orgShortName})` : ''}`));
};
