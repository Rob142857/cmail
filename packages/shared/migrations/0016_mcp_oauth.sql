-- Remote MCP (Model Context Protocol) access for AI agents, authorised with
-- OAuth 2.1 (authorization code + PKCE S256) through cmail's own sign-in and
-- an explicit consent screen. See docs/mcp.md for the flow and threat model.
--
-- Additive only: every table here is new, and no existing table is rebuilt
-- (see 0013_email_otp.sql for why rebuilding a parent table is unsafe on D1).
-- The organisation switch lives in the existing org_settings table under the
-- key 'mcp_enabled'; when the key is absent the feature is OFF.
--
-- Secrets are never stored: client secrets, authorization codes, access
-- tokens and refresh tokens are kept only as SHA-256 hex digests.

-- OAuth clients. 'dcr' rows come from Dynamic Client Registration (RFC 7591);
-- 'cimd' rows cache a fetched Client ID Metadata Document, keyed by its URL.
CREATE TABLE IF NOT EXISTS mcp_clients (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 2048),
  registration_type TEXT NOT NULL CHECK (registration_type IN ('dcr', 'cimd')),
  client_name TEXT NOT NULL DEFAULT '' CHECK (length(client_name) <= 200),
  client_uri TEXT NOT NULL DEFAULT '' CHECK (length(client_uri) <= 2048),
  redirect_uris TEXT NOT NULL CHECK (json_valid(redirect_uris) AND json_type(redirect_uris) = 'array'),
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none'
    CHECK (token_endpoint_auth_method IN ('none', 'client_secret_post', 'client_secret_basic')),
  client_secret_hash TEXT CHECK (client_secret_hash IS NULL OR length(client_secret_hash) = 64),
  software_id TEXT NOT NULL DEFAULT '' CHECK (length(software_id) <= 200),
  software_version TEXT NOT NULL DEFAULT '' CHECK (length(software_version) <= 100),
  metadata_expires_epoch INTEGER,
  created_epoch INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_epoch INTEGER,
  CHECK ((token_endpoint_auth_method = 'none') = (client_secret_hash IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_mcp_clients_created ON mcp_clients(created_epoch);

-- A browser authorization request waiting for sign-in and consent. Short
-- lived; the id is a random capability held in an HttpOnly cookie or form.
CREATE TABLE IF NOT EXISTS mcp_auth_requests (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 32 AND 128),
  client_id TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL CHECK (length(redirect_uri) <= 2048),
  state TEXT NOT NULL DEFAULT '' CHECK (length(state) <= 1024),
  code_challenge TEXT NOT NULL CHECK (length(code_challenge) = 43),
  requested_scopes TEXT NOT NULL DEFAULT '' CHECK (length(requested_scopes) <= 1000),
  resource TEXT NOT NULL CHECK (length(resource) <= 2048),
  created_epoch INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_epoch INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mcp_auth_requests_expiry ON mcp_auth_requests(expires_epoch);

-- What a user approved for one client. Revoking a grant revokes every token
-- issued under it.
CREATE TABLE IF NOT EXISTS mcp_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL DEFAULT '' CHECK (length(client_name) <= 200),
  scopes TEXT NOT NULL CHECK (length(scopes) BETWEEN 1 AND 500),
  resource TEXT NOT NULL CHECK (length(resource) <= 2048),
  created_epoch INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_epoch INTEGER NOT NULL,
  last_used_epoch INTEGER,
  revoked_epoch INTEGER,
  revoked_reason TEXT CHECK (revoked_reason IS NULL OR revoked_reason IN (
    'user', 'admin', 'admin_all', 'replaced', 'refresh_reuse', 'code_reuse', 'offboarded', 'paused', 'client_revocation'
  ))
);
CREATE INDEX IF NOT EXISTS idx_mcp_grants_user ON mcp_grants(user_id, revoked_epoch);
CREATE INDEX IF NOT EXISTS idx_mcp_grants_client ON mcp_grants(client_id);

CREATE TABLE IF NOT EXISTS mcp_grant_mailboxes (
  grant_id TEXT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  PRIMARY KEY (grant_id, mailbox_id)
);
CREATE INDEX IF NOT EXISTS idx_mcp_grant_mailboxes_mailbox ON mcp_grant_mailboxes(mailbox_id);

CREATE TABLE IF NOT EXISTS mcp_auth_codes (
  code_hash TEXT PRIMARY KEY CHECK (length(code_hash) = 64),
  grant_id TEXT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL CHECK (length(redirect_uri) <= 2048),
  code_challenge TEXT NOT NULL CHECK (length(code_challenge) = 43),
  expires_epoch INTEGER NOT NULL,
  used_epoch INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mcp_auth_codes_expiry ON mcp_auth_codes(expires_epoch);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  grant_id TEXT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  resource TEXT NOT NULL CHECK (length(resource) <= 2048),
  scopes TEXT NOT NULL CHECK (length(scopes) BETWEEN 1 AND 500),
  created_epoch INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_epoch INTEGER NOT NULL,
  -- Refresh tokens: set when rotated. Presenting a rotated token again is
  -- treated as theft and revokes the grant.
  used_epoch INTEGER,
  revoked_epoch INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_grant ON mcp_tokens(grant_id, kind);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_expiry ON mcp_tokens(expires_epoch);

-- One row per MCP tool call. Identifiers and outcome only: never message
-- content, subjects, addresses, queries or arguments.
CREATE TABLE IF NOT EXISTS mcp_tool_calls (
  id TEXT PRIMARY KEY,
  created_epoch INTEGER NOT NULL DEFAULT (unixepoch()),
  grant_id TEXT,
  client_id TEXT NOT NULL DEFAULT '' CHECK (length(client_id) <= 2048),
  user_id TEXT,
  tool TEXT NOT NULL CHECK (length(tool) <= 64),
  mailbox_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('ok', 'denied', 'error', 'rate_limited', 'invalid')),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) <= 64)
);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_time ON mcp_tool_calls(created_epoch DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_grant ON mcp_tool_calls(grant_id, created_epoch DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_user ON mcp_tool_calls(user_id, created_epoch DESC);
