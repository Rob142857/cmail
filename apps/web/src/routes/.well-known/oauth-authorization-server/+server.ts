import type { RequestHandler } from './$types';
import { authorizationServerMetadata, metadataResponse } from '$lib/server/mcp/metadata';

export const GET: RequestHandler = async ({ platform }) => {
  const env = platform?.env as unknown as Record<string, unknown> | undefined;
  return metadataResponse(env ? authorizationServerMetadata(env) : null);
};
