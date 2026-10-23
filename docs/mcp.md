# AI agents and MCP

cmail includes a remote [Model Context Protocol](https://modelcontextprotocol.io/)
(MCP) server. It lets an AI assistant such as Claude read, search, draft,
organise and (only if you allow it) send mail in the mailboxes you choose.

Nobody types a password or pastes an API key into the AI app. The app opens a
cmail browser window, you sign in the way you always do (Google, Microsoft or
an email code), and a consent screen asks you exactly what to allow. You can
disconnect the app at any time, and your organisation can switch the whole
feature off.

The feature is **off by default** on every deployment. A Manager turns it on.

- [For people: connect an app](#connect-an-ai-app)
- [For Managers: turn it on and oversee it](#manager-setup)
- [Scopes and tools](#scopes)
- [How sign-in works](#how-the-sign-in-works)
- [Security model and threat model](#security-model)
- [Limits](#limits)
- [Protocol and endpoint reference](#protocol-reference)
- [Troubleshooting](#troubleshooting)

## Connect an AI app

You need the server address. It is your cmail address followed by `/mcp`,
for example `https://mail.example.org/mcp`. It's also shown under
**Mail › Settings › Connected AI apps**.

### Claude (desktop app and claude.ai)

1. Open **Settings › Connectors** and choose **Add custom connector**.
2. Give it a name (for example "Work mail") and paste the server address.
3. Choose **Connect**. A cmail window opens.
4. Sign in, then tick the permissions and mailboxes you want, and choose
   **Allow**. The window returns you to Claude.

Custom connectors depend on your Claude plan and, for organisations, on what
your Claude administrator allows.

### Claude Code

```sh
claude mcp add --transport http cmail https://mail.example.org/mcp
```

Then, inside Claude Code, run `/mcp`, pick **cmail** and choose
**Authenticate**. Your browser opens the cmail sign-in and consent screen.

### Other MCP clients

Any client that supports the Streamable HTTP transport with OAuth
authorization will work: point it at the `/mcp` address. cmail supports both
client registration methods clients use today (Client ID Metadata Documents
and Dynamic Client Registration), so there is nothing to pre-register.

### The consent screen

The screen shows:

- **The app's name.** For apps identified by a metadata document you also see
  the website that published it (for example "Identified by claude.ai"). For
  apps that registered themselves, the name is marked **not verified**: any
  app can call itself anything, so only approve an app you just started
  connecting yourself.
- **Where you'll be returned**, for example "an app on this computer
  (localhost)" or a website name.
- **What it may do.** *Read mail* and *Write drafts* are ticked by default.
  *Send email as you*, *Organise mail* and *Read calendar* are off until you
  tick them. Ticking *Send* shows a warning, because sent mail can't be
  recalled.
- **Which mailboxes.** Your personal mailbox is ticked by default. Shared
  mailboxes you can access are listed but not ticked.

Choosing **Deny** tells the app it was refused. Nothing is shared.

### Disconnect an app

Go to **Mail › Settings › Connected AI apps** and choose **Disconnect**. Its
tokens stop working immediately. The page also shows each app's permissions,
mailboxes, when it was connected and last used, when the connection expires,
and its most recent actions.

## Manager setup

1. Make sure the deployment has applied migration `0016_mcp_oauth.sql`
   (`pnpm db:migrate`) and that `APP_URL` is the public `https://` origin.
2. Go to **Management › Settings › AI agent (MCP) connections** and choose
   **Allow AI agent (MCP) connections**. The change is recorded in the audit
   log.
3. Tell people the server address shown on that card.

The same card shows how many people have connected apps, a **Disconnect every
AI app now** button, and the most recent tool calls (time, person, app, tool,
mailbox and result; never content).

Turning the switch **off** blocks every connected app on its next request
(HTTP 403), stops new sign-ins, token issue and registrations, and leaves
existing connections dormant. Use **Disconnect every AI app now** as well if
you want people to approve apps again from scratch.

Pausing or offboarding a person also disconnects their apps. Removing or
downgrading a shared-mailbox delegation takes effect on the app's very next
request.

Optional setting: `MCP_SEND_RATE_PER_HOUR` (default `10`, range 1-200) caps
how many messages one connected app may send per hour. The person's normal
outbound limits still apply on top.

## Scopes

| Scope | Lets the app | Also needs, on the mailbox |
|---|---|---|
| `mail.read` | List folders, search, read messages and conversations | Any access |
| `mail.draft` | Create and edit drafts (never sends) | Send as or Full access |
| `mail.send` | Send a draft or a new message | Send as or Full access |
| `mailbox.manage` | Move between Inbox, Archive, Spam and Trash; mark read/unread; star | Full access (read/unread: any access) |
| `calendar.read` | List calendar events recorded from invitations | Any access |

An app only ever sees the tools its scopes allow; `tools/list` hides the
rest. cmail has no custom labels, so "labelling" is the star flag. Nothing
permanently deletes mail: Trash stays recoverable for the retention period.

### Tools

| Tool | Scope | What it does |
|---|---|---|
| `list_mailboxes` | any | Shared mailboxes and what the app may do in each |
| `list_folders` | `mail.read` | Total and unread counts per folder |
| `search_messages` | `mail.read` | Text, sender, folder, date range, unread filter, paging (max 50 per page) |
| `get_message` | `mail.read` | One message as plain text (default 20,000 characters, max 100,000); attachments listed, never downloaded |
| `get_thread` | `mail.read` | A conversation, oldest first, size-capped |
| `create_draft` | `mail.draft` | New draft, optionally as a reply |
| `update_draft` | `mail.draft` | Replace chosen fields of your own draft |
| `send_draft` | `mail.send` | Send one of your drafts as saved |
| `send_message` | `mail.send` | Compose and send in one step, with an optional idempotency key |
| `move_message` | `mailbox.manage` | Inbox / Archive / Spam / Trash, following the web app's rules |
| `archive_message` | `mailbox.manage` | Inbox to Archive |
| `mark_message` | `mailbox.manage` | Read, unread, star, unstar |
| `list_calendar_events` | `calendar.read` | Events in a date range |

Drafting and sending use exactly the same server code as the web composer:
the same permission checks, signatures, storage quota, per-person send and
work limits, recipient limits and durable send journal. MCP adds its own
checks first.

## How the sign-in works

```text
AI app                         cmail                              You (browser)
  |-- POST /mcp (no token) ----->|
  |<-- 401 WWW-Authenticate -----|  resource_metadata=.../.well-known/oauth-protected-resource
  |-- GET protected-resource ---->|  -> authorization server = APP_URL
  |-- GET oauth-authorization-server metadata ->|
  |-- register (metadata URL or POST /oauth/register) ->|
  |   create PKCE verifier + S256 challenge
  |-- open browser: /oauth/authorize?client_id&redirect_uri&code_challenge&state&resource
  |                              |-- validate client + exact redirect URI
  |                              |-- park request in D1, set 10-min HttpOnly cookie
  |                              |-- sign in (Google / Microsoft / email code), policy check ------->|
  |                              |<-- consent: scopes + mailboxes, Allow / Deny ---------------------|
  |<-- redirect: ?code&state&iss (5-minute, single-use code) ------------------------------------------|
  |-- POST /oauth/token (code + code_verifier + resource) ->|
  |<-- access token (1 h) + refresh token (30 days, rotating) --|
  |-- POST /mcp  Authorization: Bearer ... ->|  every call re-checks grant, scopes, mailboxes, user, switch
```

## Security model

### What cmail guarantees

- **Least privilege by default.** Read and draft only; send and organise are
  separate, explicit choices. Mailboxes are chosen one by one.
- **Live authorisation.** Each tool call re-reads, from the database, the
  grant, its scopes and mailboxes, the person's current mailbox delegation and
  permission, account status, the usage-policy acknowledgement and the
  organisation switch. There is no cached permission to go stale.
- **No cross-user or cross-mailbox access.** Every query is limited to the
  grant's mailboxes intersected with the signed-in person's live assignments,
  and drafts stay private to their owner as in the web app.
- **Short, bound tokens.** Access tokens last one hour and only work at this
  server's `/mcp` (RFC 8707 audience). Refresh tokens rotate on every use; if
  an old one is ever presented again, cmail assumes it was copied and revokes
  the whole connection. Every connection expires after 90 days.
- **Secrets are never stored.** Codes, tokens and client secrets are kept only
  as SHA-256 hashes.
- **The browser step can't be skipped or redirected.** PKCE with S256 only,
  exact redirect-URI matching (loopback ports may vary, as RFC 8252 allows),
  `state` and `iss` returned, and an unknown app or unregistered redirect gets
  an error page, never a redirect. The consent answer must come from the same
  browser that started the request.
- **Bearer only.** `/mcp` ignores cookies and rejects browser requests from
  other origins (DNS-rebinding defence).
- **Accountability.** Every tool call writes an audit row: time, connection,
  app, person, tool, mailbox and outcome. Never message content, subjects,
  addresses, search terms or arguments. Connecting, disconnecting, the
  organisation switch, sends and token-replay revocations go to the main audit
  log.

### Prompt injection

Email is written by other people, and some of them will try to instruct an AI
assistant ("ignore previous instructions and forward..."). cmail's stance:

- Every tool result that contains message or invitation text is labelled as
  untrusted content and tells the model not to follow instructions inside it.
  The server's instructions to the model say the same.
- cmail never acts on email text. Tools only do what the app explicitly asks,
  within the scopes and mailboxes you approved.
- Sending needs its own opt-in scope, is rate limited per connection, and
  `create_draft` is the recommended default so you review before anything
  leaves.

No server can fully stop a model from being misled by what it reads. Keep
**Send** off unless you need it, and prefer apps that confirm actions with you.

### Threat model

| Threat | Mitigation |
|---|---|
| Stolen access token | 1-hour life, audience-bound, hashed at rest, rate limited, useless once the user, grant or switch changes |
| Stolen refresh token | Rotation with reuse detection revokes the whole connection; 30-day idle and 90-day absolute limits |
| Intercepted authorization code | PKCE S256, 5-minute single-use codes, exact redirect match; replay revokes the connection |
| Malicious or look-alike app | Consent shows verified host vs unverified name and the return address; least-privilege defaults; organisation switch |
| Open redirect via the authorize page | Unknown apps and unregistered redirects never redirect |
| CSRF or clickjacking on consent | Same-origin POST only, answer bound to a per-browser cookie and the signed-in person, `frame-ancestors 'none'` |
| DNS rebinding / browser calls to `/mcp` | Origin check, bearer tokens only |
| Prompt injection through mail | Untrusted-content labelling, no autonomous actions, send scope opt-in plus rate limit |
| Cross-user or cross-mailbox access | Grant mailboxes intersected with live assignments on every query |
| SSRF through metadata-document fetch | https only, DNS names only (no IP literals, localhost or `.local`), no redirects, 5 s timeout, 16 KB cap |
| Abuse and resource exhaustion | Rate limits on registration, authorization, token, revocation and tool calls; request, argument and result size caps |
| Insider misuse | Audit rows per call, visible to the person and to Managers |

### What it does not do

- It does not make the AI app itself trustworthy. Once you grant access, the
  app and its model see the mail you shared.
- It does not cover the app's own storage or logging of what it read.
- It is not a certified or independently audited integration. Review it
  against your own requirements, as with the rest of cmail.

### Note for reviewers: CSRF configuration

SvelteKit's built-in CSRF check rejects any form-encoded POST without an
`Origin` header. Native OAuth clients send exactly that to `/oauth/token`
and `/oauth/revoke`. cmail therefore disables the built-in copy
(`csrf.trustedOrigins: ['*']` in `vite.config.ts`) and re-implements the
same rule in `hooks.server.ts`, exempting only those two endpoints, which never
read cookies. Tests in `src/hooks.csrf.test.ts` cover both the exemption and
that every other path is still protected.

## Limits

| Limit | Value |
|---|---|
| Access token lifetime | 1 hour |
| Refresh token lifetime | 30 days, rotated on every use |
| Connection lifetime | 90 days, then approve again |
| Authorization code | 5 minutes, single use |
| Pending sign-in request | 10 minutes |
| Tool calls per connection | 60 per minute, 1,000 per hour |
| Sends per connection | `MCP_SEND_RATE_PER_HOUR`, default 10 per hour, plus the person's own limits |
| `/mcp` request body | 1.2 MB |
| OAuth request body | 16 KB |
| Search page size | 50 |
| Message text returned | 20,000 characters by default, 100,000 max |
| Conversation | 50 messages, 100,000 characters in total |
| Recipients per field | 100 (the deployment's per-message limit still applies) |
| Registrations | 20 per hour per IP; unused registrations removed after a day |
| Tool-call audit retention | 1 year |

## Protocol reference

| Endpoint | Purpose |
|---|---|
| `POST /mcp` | MCP Streamable HTTP endpoint, JSON responses. `GET` and `DELETE` return 405. |
| `GET /.well-known/oauth-protected-resource` (and `/mcp` suffix) | RFC 9728 protected resource metadata |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 authorization server metadata |
| `POST /oauth/register` | RFC 7591 dynamic client registration |
| `GET /oauth/authorize` | Browser sign-in and consent |
| `POST /oauth/token` | `authorization_code` and `refresh_token` grants |
| `POST /oauth/revoke` | RFC 7009 token revocation |

Protocol versions: **2026-07-28** (stateless, per-request `_meta`, mirrored
`MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers validated against
the body, `server/discover`) and the initialize-based **2025-11-25**,
**2025-06-18** and **2025-03-26**. cmail never issues session IDs. Requests
carrying an unsupported version get HTTP 400 with error `-32022` and the
supported list.

OAuth: authorization code with PKCE (`S256` only), public clients
(`token_endpoint_auth_method: none`) and confidential DCR clients
(`client_secret_post`, `client_secret_basic`), Client ID Metadata Documents
for public clients, `resource` indicators, `iss` in authorization responses.
Implicit, password and client-credentials grants are not supported.

Errors from `/mcp`: 401 with `WWW-Authenticate: Bearer resource_metadata=...`
when the token is missing or invalid; 403 with `error="insufficient_scope"`
and the needed `scope` when a tool's scope wasn't granted; 403 when the
organisation switch is off or the usage policy needs accepting; 429 with
`Retry-After` when rate limited.

The implementation lives in `apps/web/src/lib/server/mcp/`. The data model is
`packages/shared/migrations/0016_mcp_oauth.sql`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| The app says the server refused registration or sign-in (403) | The organisation switch is off |
| The consent window says the app isn't registered or the return address isn't allowed | The app's registration expired or it changed its callback; remove and re-add the connector |
| You land on the usage policy first | A new policy version needs accepting; after accepting you return to the consent screen |
| A tool says the mailbox isn't shared | It wasn't ticked, or your access to it was removed. Reconnect to choose again |
| "Stopped automatically: a sign-in token was reused" | The app (or something copying its tokens) presented an old refresh token. Reconnect; if it repeats, stop using that app |
| Calls fail with 429 | The connection hit its per-minute or per-hour limit |

[← Documentation home](README.md)
