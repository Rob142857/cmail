// Shared constants and deployment-derived values for cmail's MCP server and
// its OAuth 2.1 authorization server. Everything security-relevant is derived
// from APP_URL (a deployment boundary, never a D1 setting) so the issuer and
// token audience cannot drift away from the real origin.
import { boundedInteger } from '../validation';

export const MCP_SCOPES = ['mail.read', 'mail.draft', 'mail.send', 'mailbox.manage', 'calendar.read'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/** Pre-ticked on the consent screen. Everything else is opt-in. */
export const DEFAULT_CONSENT_SCOPES: readonly McpScope[] = ['mail.read', 'mail.draft'];

export const SCOPE_DESCRIPTIONS: Record<McpScope, { label: string; detail: string; risk: 'low' | 'medium' | 'high' }> = {
  'mail.read': {
    label: 'Read mail',
    detail: 'Search and read messages, threads and folder counts in the mailboxes you choose. Attachments are listed but not downloaded.',
    risk: 'medium',
  },
  'mail.draft': {
    label: 'Write drafts',
    detail: 'Create and edit drafts in your Drafts folder. Drafts are not sent.',
    risk: 'low',
  },
  'mail.send': {
    label: 'Send email as you',
    detail: 'Send messages from the mailboxes you choose, without asking you first. Only allow this if you trust the app and the person using it.',
    risk: 'high',
  },
  'mailbox.manage': {
    label: 'Organise mail',
    detail: 'Move messages between Inbox, Archive, Spam and Trash, mark them read or unread, and star them. Never deletes permanently.',
    risk: 'medium',
  },
  'calendar.read': {
    label: 'Read calendar',
    detail: 'See calendar events cmail has recorded from meeting invitations in the mailboxes you choose.',
    risk: 'low',
  },
};

export const ORG_SETTING_MCP_ENABLED = 'mcp_enabled';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const GRANT_MAX_LIFETIME_SECONDS = 90 * 24 * 60 * 60;
export const AUTH_CODE_TTL_SECONDS = 5 * 60;
export const AUTH_REQUEST_TTL_SECONDS = 10 * 60;
/** CIMD documents are cached for their Cache-Control max-age, kept within these bounds; 24 h when none is given. */
export const CIMD_CACHE_SECONDS = 24 * 60 * 60;
export const CIMD_MIN_CACHE_SECONDS = 5 * 60;

/** Request body ceilings. Drafts may carry a 1 MB body, so /mcp allows a little more. */
export const MAX_MCP_REQUEST_BYTES = 1_200_000;
export const MAX_OAUTH_REQUEST_BYTES = 16 * 1024;

export const MODERN_PROTOCOL_VERSIONS = ['2026-07-28'] as const;
export const LEGACY_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS];

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

/** Parse a space-delimited scope string, dropping unknown values and duplicates, in canonical order. */
export function parseScopes(value: unknown): McpScope[] {
  if (typeof value !== 'string' || value.length > 1000) return [];
  const requested = new Set(value.split(/\s+/).filter(Boolean));
  return MCP_SCOPES.filter((scope) => requested.has(scope));
}

export function formatScopes(scopes: readonly McpScope[]): string {
  return MCP_SCOPES.filter((scope) => scopes.includes(scope)).join(' ');
}

/**
 * The canonical issuer (APP_URL without a trailing slash). Only https, or
 * http on a loopback host for local development, is accepted. Returns null
 * when APP_URL is missing or unsafe, which disables MCP entirely.
 */
export function mcpIssuer(env: Record<string, unknown>): string | null {
  const raw = typeof env.APP_URL === 'string' ? env.APP_URL.trim() : '';
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) return null;
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The MCP endpoint's canonical URI, used as the RFC 8707 resource / token audience. */
export function mcpResource(env: Record<string, unknown>): string | null {
  const issuer = mcpIssuer(env);
  return issuer ? `${issuer}/mcp` : null;
}

export function protectedResourceMetadataUrl(env: Record<string, unknown>): string | null {
  const issuer = mcpIssuer(env);
  return issuer ? `${issuer}/.well-known/oauth-protected-resource` : null;
}

/**
 * RFC 8707 resource match. Scheme and host compare case-insensitively (the
 * spec asks servers to accept upper case there); one trailing slash is
 * tolerated; anything else must match exactly.
 */
export function resourceMatches(candidate: string, resource: string): boolean {
  if (!candidate || candidate.length > 2048) return false;
  try {
    const url = new URL(candidate);
    if (url.hash || url.search || url.username || url.password) return false;
    const normalised = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
    return normalised === resource;
  } catch {
    return false;
  }
}

/** Per-grant hourly ceiling for mail.send tool calls, on top of the user's own outbound limits. */
export function mcpSendRatePerHour(env: Record<string, unknown>): number {
  return boundedInteger(env.MCP_SEND_RATE_PER_HOUR, 10, 1, 200);
}

/** Read the org switch. Any failure, or an absent row, means OFF. */
export async function isMcpEnabled(db: D1Database | undefined): Promise<boolean> {
  if (!db) return false;
  try {
    const row = await db.prepare('SELECT value FROM org_settings WHERE key = ?')
      .bind(ORG_SETTING_MCP_ENABLED).first<{ value: string }>();
    return row?.value === 'true';
  } catch {
    return false;
  }
}
