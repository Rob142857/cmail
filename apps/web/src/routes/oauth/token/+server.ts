import type { RequestHandler } from './$types';
import { handleToken } from '$lib/server/mcp/oauth-http';

// Machine-facing OAuth endpoint for MCP clients; never reads cookies. See docs/mcp.md.
export const POST: RequestHandler = ({ request, platform }) => handleToken(request, platform);
