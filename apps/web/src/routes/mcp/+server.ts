import type { RequestHandler } from './$types';
import { handleMcpRequest } from '#lib/server/mcp/protocol.js';

// Streamable HTTP MCP endpoint. Bearer tokens only; see docs/mcp.md.
export const POST: RequestHandler = ({ request, platform }) => handleMcpRequest(request, platform);
export const GET: RequestHandler = ({ request, platform }) => handleMcpRequest(request, platform);
export const DELETE: RequestHandler = ({ request, platform }) => handleMcpRequest(request, platform);
