# Configuration reference

cmail uses Cloudflare bindings for storage, plain environment variables for non-secret settings, provider secret stores for credentials, and optional D1-backed organisation settings.

## Storage bindings

Both applications require bindings to the same resources:

| Binding | Resource | Used by |
|---|---|---|
| `DB` | Cloudflare D1 database | Web application and email Worker |
| `STORAGE` | Cloudflare R2 bucket | Web application and email Worker |

Store deployment-specific IDs in local or deployment configuration, not reusable source templates.

Keep the web template's `nodejs_compat` compatibility flag enabled. Current SvelteKit server output uses Node.js APIs that Cloudflare exposes under that flag; review compatibility-date changes in staging before production rollout.

## Core web settings

| Variable | Required | Secret | Description |
|---|---:|---:|---|
| `APP_NAME` | Yes | No | Name shown by the application |
| `APP_URL` | Yes | No | Public HTTPS origin used to construct OAuth callbacks and first-party enrolment links |
| `MAIL_DOMAIN` | Yes | No | Domain appended to managed mailbox local parts |
| `SESSION_SECRET` | Yes | Yes | HMAC key for session tokens; use an independent random value per environment |

Do not include a trailing slash in `APP_URL`. `MAIL_DOMAIN` is a hostname only, without a scheme or path.

## OAuth

Configure at least one complete provider:

| Variable | Required when | Secret |
|---|---|---:|
| `GOOGLE_CLIENT_ID` | Google sign-in is enabled | Treat as configuration |
| `GOOGLE_CLIENT_SECRET` | Google sign-in is enabled | Yes |
| `MICROSOFT_CLIENT_ID` | Microsoft sign-in is enabled | Treat as configuration |
| `MICROSOFT_CLIENT_SECRET` | Microsoft sign-in is enabled | Yes |
| `MICROSOFT_TENANT_ID` | Optional for Microsoft; defaults to `common` | Treat as configuration |

A provider appears on the sign-in page only when its client ID and client
secret are present, `APP_URL` is a safe callback origin, and `SESSION_SECRET`
passes the minimum-strength check. An invalid Microsoft tenant value or any
missing shared prerequisite fails closed and does not enable the button.

For Microsoft sign-in, choose the audience deliberately:

- Set `MICROSOFT_TENANT_ID` to the deployment's tenant GUID for a single-tenant
  Entra application.
- Use `organizations` for work or school accounts from Entra tenants.
- Use `common` for Microsoft 365 work or school accounts plus personal
  Microsoft accounts such as Outlook.com, Hotmail, and Live. The Entra app
  registration must also select the supported account type that includes both
  organisational directories and personal Microsoft accounts.

Both providers use the OpenID Connect authorization-code flow with PKCE and the
`openid email profile` scopes. cmail exchanges the code, then uses the access
token to call the provider's UserInfo endpoint. Google uses
`https://openidconnect.googleapis.com/v1/userinfo`. Microsoft uses
`https://graph.microsoft.com/oidc/userinfo`; it is deliberately not the
Microsoft Graph `/me` profile endpoint. The durable identity key is the
provider name plus the UserInfo `sub` value. cmail does not use email, UPN, or
ID-token claims to resolve a returning account.

An ordinary user's first sign-in requires a manager-issued enrolment
invitation. Provider links use `<APP_URL>/enroll/google#token=...` and
`<APP_URL>/enroll/microsoft#token=...`. The fragment stays out of the HTTP
request, referrer, and server logs; the first-party page removes it from browser
history before a same-origin POST. The raw token is stored only as a hash in D1,
expires after 72 hours, and can be consumed once. The route validates it and
captures the pending enrolment in a 15-minute `HttpOnly`,
`SameSite=Lax` cookie (`Secure` on production HTTPS) before redirecting to the
provider, so the raw value does not continue through OIDC. Account binding also
requires a matching access-token-backed UserInfo email: Google must return
`email_verified=true`; Microsoft must return a non-empty OIDC UserInfo `email`
claim, because Microsoft UserInfo does not expose `email_verified`.
After binding, sign-in uses only provider plus `sub`; changing or reusing an
email cannot transfer the account.

Creating a user without sending an invitation intentionally leaves the account
pending and unbound. A manager must use **Resend invitation** before that person
can enrol. Resending rotates the enrolment token and invalidates the previous
link. Used or expired links, email mismatches, a subject already bound to
another user, or an account already bound to a different identity all fail
closed. Managers should investigate the conflict and issue a fresh invitation
rather than changing an email merely to bypass it.

## Optional Web Push

Browser new-mail notifications are off unless all three VAPID values are valid
and present. The deployed app must use HTTPS (localhost is accepted for local
development). Generate one pair from the repository root:

```sh
pnpm push:keys
```

Configure the same values on both the Pages application and inbound email
Worker:

| Variable | Secret | Purpose |
|---|---:|---|
| `VAPID_PUBLIC_KEY` | No | Browser-visible VAPID application-server key |
| `VAPID_PRIVATE_KEY` | Yes | Signing key; store independently as a secret in both runtimes |
| `VAPID_SUBJECT` | No | Monitored `mailto:` address or HTTPS operator URL |
| `PUSH_ENDPOINT_HOSTS` | No | Optional comma-separated additions to the built-in push-service hostname allowlist |

Put the public key and subject in `[vars]` in both local Wrangler files. For
local Worker testing, put only `VAPID_PRIVATE_KEY` in the ignored
`apps/email-worker/.dev.vars`; do not copy unrelated web credentials into the
Worker. For production, set the private key separately in Pages and the inbound
Worker:

```sh
pnpm exec wrangler pages secret put VAPID_PRIVATE_KEY --project-name cmail-web
pnpm exec wrangler secret put VAPID_PRIVATE_KEY --config apps/email-worker/wrangler.toml
```

The built-in endpoint allowlist covers the common Google, Mozilla, Apple, and
Microsoft browser push services. Extend `PUSH_ENDPOINT_HOSTS` only for a
verified HTTPS push-service domain required by supported clients; each addition
expands the external request boundary.

Even when the deployment is configured, a signed-in user must deliberately
enable notifications and approve the browser permission. Payloads are generic:
they contain no sender, subject, mailbox name, address, body, or attachment
data. Push delivery is best-effort and is never a substitute for mailbox state.
On iPhone and iPad, [standards-based Web Push is available to web apps added to
the Home Screen](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/);
the user must launch that installed app and use its **Turn on** control. Other
clients are detected by capability rather than browser name, so
the control stays hidden where Push, Notifications, or service workers are not
available.
Rotating the VAPID pair invalidates existing subscriptions, so communicate the
change and have users opt in again.

## Outbound delivery

| Variable | Secret | Purpose |
|---|---:|---|
| `OUTBOUND_PROVIDER` | No | `cloudflare` (committed default), `postmark`, or `auto` |
| `CLOUDFLARE_ACCOUNT_ID` | No | 32-character Cloudflare account ID containing the onboarded Email Sending domain |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Yes | Cloudflare REST credential with **Email Sending: Edit** permission |
| `POSTMARK_API_KEY` | Yes | Enable Postmark delivery |

In `auto` mode, cmail selects the first complete provider configuration in this
order: Cloudflare Email Service, then Postmark. Set an explicit provider
when deterministic selection is important. Explicit selection fails closed if
that provider's required values are absent or invalid; cmail does not silently
fall through to a different provider. If no provider is ready, external
outbound attempts fail while internal mailbox delivery remains available.

### Cloudflare Email Service

Cloudflare Email Service is the recommended external provider. cmail calls the
[Email Sending REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)
from its current Cloudflare Pages runtime. To enable it:

1. Confirm the account is on the Workers Paid plan. Email Sending is currently
   a public beta.
2. Use a domain hosted on Cloudflare DNS and onboard it under **Compute → Email
   Service → Email Sending**. Review the Cloudflare-created bounce MX, SPF,
   DKIM, and DMARC records against every existing sender for the domain.
3. Set `CLOUDFLARE_ACCOUNT_ID` as a non-secret Pages variable.
4. Create the narrowest suitable account-owned API token with **Email Sending:
   Edit** and store it only as the `CLOUDFLARE_EMAIL_API_TOKEN` Pages secret.
5. Keep the template's `OUTBOUND_PROVIDER=cloudflare`. Use `auto` only when a
   complete Postmark configuration should act as a fallback.

Cloudflare limits a general outbound message to 50 total `to`, `cc`, and `bcc`
recipients and 5 MiB including attachments. cmail applies those provider limits
before submission, even if an application setting would otherwise allow more.
New Cloudflare accounts also begin with conservative daily quotas; inspect the
[current limits](https://developers.cloudflare.com/email-service/platform/limits/)
and stage real mail flow before switching production traffic.

Cloudflare Email preview deserves a separate privacy decision. When enabled, it
lets dashboard users inspect rendered HTML, plain text, headers, attachments,
and raw message source, retained for about seven days. Cloudflare enables it by
default for new sending domains. Review access and disable it in the sending
domain's settings unless this extra content retention is required. See
[Email logs and message preview](https://developers.cloudflare.com/email-service/observability/logs/#message-preview).

Cloudflare also offers a native `send_email` binding for Workers, which avoids
putting an API token in the application environment. cmail currently deploys
the web application as Pages Functions and therefore uses the REST API; do not
add `[[send_email]]` to the Pages Wrangler file. A downstream deployment may
move submission into a separate private Worker reached through a Pages service
binding, or migrate the web runtime to Workers. For that architecture, note
that local `wrangler dev` simulates delivery unless `remote = true`; remote mode
sends real mail, and binary attachment buffers cannot be serialized by the
non-remote simulator. Refer to Cloudflare's [Workers
API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
and [local sending guide](https://developers.cloudflare.com/email-service/local-development/sending/).

### Postmark alternative

Set `OUTBOUND_PROVIDER=postmark`, store `POSTMARK_API_KEY` as a Pages secret,
and verify the sender or domain in Postmark. cmail preflights Postmark's
50-recipient and 10 MB total-message limits before submission; confirm current
limits in Postmark's [email API documentation](https://postmarkapp.com/developer/user-guide/send-email-with-api).

The sender address used for invitations and system messages must be accepted by the chosen provider. Configure it in **Admin → Settings** after bootstrap or provide a `SYSTEM_EMAIL` default.

## Bootstrap

The first manager is the only account that does not start with a manager-issued
invitation. Bootstrap is disabled unless both temporary values are present and
valid:

| Variable | Secret | Purpose |
|---|---:|---|
| `BOOTSTRAP_ADMIN_EMAIL` | Yes | Exact expected access-token-backed UserInfo email allowed to create the first manager |
| `BOOTSTRAP_ADMIN_TOKEN` | Yes | Strong one-time bootstrap credential; at least 32 cryptographically random characters |

Generate a separate token of at least 32 strong random characters for every
environment. The operator opens `<APP_URL>/bootstrap` and submits it in a
same-origin POST. cmail exchanges it for a signed `cmail_bootstrap_proof` cookie
valid for 10 minutes before starting OIDC. The cookie is `HttpOnly`,
`SameSite=Lax`, and `Secure` on production HTTPS. Never place the token or proof
in a URL or query string, send it by email, or copy it into logs, screenshots,
issue trackers, shell history, Wrangler files, or source.

The accepted UserInfo email must normalise to `BOOTSTRAP_ADMIN_EMAIL`: Google
requires `email_verified=true`, while Microsoft requires its non-empty OIDC
UserInfo `email` claim alongside the independent bootstrap proof. The provider
plus immutable UserInfo `sub` is stored as
the new manager's durable binding. Delete both bootstrap secrets and redeploy
immediately after verifying that account. If an attempt expires, conflicts, or
may have exposed the token, rotate `BOOTSTRAP_ADMIN_TOKEN`, clear the browser
bootstrap state, and begin again. Rotating `SESSION_SECRET` also invalidates
signed bootstrap proofs and application sessions; plan that rotation as a
sign-out event.

## Organisation defaults

The application can read these optional defaults:

| Variable | Description |
|---|---|
| `ORG_NAME` | Full organisation name |
| `ORG_SHORT_NAME` | Short name used in compact copy |
| `ORG_URL` | Public organisation URL |
| `SYSTEM_EMAIL` | From address for invitations and system mail |
| `SYSTEM_FROM_NAME` | Display name for system mail |
| `SUPPORT_EMAIL` | User-facing support address |
| `LANDING_URL` | Public landing-page URL |
| `POLICY_URL` | Public policy URL; defaults to the in-app policy route |

Managers can override the corresponding organisation values in **Admin → Settings**. Those overrides are stored in D1 and take precedence in the settings helper. `APP_URL` is deliberately excluded: it remains a deployment-level variable so OAuth callbacks, invitation links, and provider registrations cannot drift apart. Keep environment values as safe deployment defaults.

## Organisation directory and public endpoint

The organisation model is managed under **Admin → Organisation**. Managers can
define ordered layers, hierarchical units, reusable roles, and positions. The
public directory is controlled by a separate master switch and is disabled by
default.

`GET /api/organization` is intentionally unauthenticated so a deployment can
use it on a public website. It returns `[]` unless the master switch is enabled.
Even when enabled, a position is returned only when all of these conditions are
true:

- the position is explicitly marked **Public**;
- its assigned user is active;
- its selected work address is an active assigned mailbox on `MAIL_DOMAIN`;
- its occupant display name and position title are present.

Each returned object contains exactly these public fields:

```json
{
  "occupantDisplayName": "Alex Example",
  "workEmail": "alex@example.com",
  "positionTitle": "Operations Lead"
}
```

User IDs, login addresses, personal contact data, units, reporting hierarchy,
internal positions, and other organisation metadata are not selected by the
public endpoint. Responses use `Cache-Control: no-store`. Treat enabling the
directory as a privacy change: obtain any required consent, review every public
position, and test the endpoint before linking it from another site.

## Brand and regional defaults

| Variable | Default | Description |
|---|---|---|
| `BRAND_LOGO_URL` | `/logo.svg` | Relative path or HTTPS URL for the primary logo |
| `BRAND_ICON_URL` | `/icon.svg` | Relative path or HTTPS URL for the compact icon |
| `BRAND_ICON_192_URL` | `/icon-192.png` | Relative path or HTTPS URL for the 192×192 PWA and Apple touch icon |
| `BRAND_ICON_512_URL` | `/icon-512.png` | Relative path or HTTPS URL for the 512×512 installed-app icon |
| `BRAND_OG_IMAGE_URL` | `/og-image.svg` | Relative path or HTTPS URL for the social sharing image |
| `BRAND_PRIMARY_COLOR` | `#2563eb` | Six-digit hexadecimal accent colour |
| `LOCALE` | `en` | Unicode locale identifier used by configurable formatting |
| `TIME_ZONE` | `UTC` | IANA time-zone name used by configurable formatting |

`REPO_URL` is present in the example configuration as deployment metadata. The application does not currently render it automatically.

## Web guardrails

The configuration layer defines bounded values for:

| Variable | Default | Accepted range |
|---|---:|---:|
| `MAX_RECIPIENTS_PER_MESSAGE` | 50 | 1–100 |
| `OUTBOUND_RATE_LIMIT_PER_HOUR` | 60 | 1–1000 |
| `OUTBOUND_WORK_LIMIT_PER_HOUR` | 600 | 1–1000 |
| `DRAFT_SAVE_RATE_PER_HOUR` | 300 | 1–2000 |
| `MAX_DRAFTS_PER_MAILBOX_USER` | 100 | 1–1000 |
| `SESSION_TTL_HOURS` | 8 | 1–168 |
| `MAX_SESSIONS_PER_USER` | 5 | 1–20 |

Keep limits conservative until workload, provider, abuse, and recovery behavior have been tested.

The message-count limit applies to every submitted send, including internal-only
mail. The workload limit is charged by the greatest of recipient count,
aggregate recipient-payload MiB, or the number of R2 body/attachment objects
created. This prevents many-recipient and attachment-heavy sends from costing
the same as a small one-recipient message.

Draft autosaves and explicit saves share the per-user, per-mailbox hourly
limit. New drafts and moves between mailboxes atomically reserve one owned
draft slot, so concurrent requests cannot exceed the row cap. Draft growth
reserves only its UTF-8 stored-HTML size delta; moving a draft reserves its full
stored size in the destination mailbox. Draft R2 bodies use versioned keys so a
failed metadata update leaves the prior body intact.

Non-configurable per-send safety ceilings additionally limit aggregate delivery
payload to 250 MiB, duplicated internal R2 content to 100 MiB, and new R2
objects to 250. A message body is limited to 1 MiB and attachments to 20 MiB
total; compose requests with a declared length above 24 MiB are rejected before
form parsing and every parsed form is checked again. Because each internal message currently owns its R2 keys and deletion
removes those objects, internal copies are bounded rather than sharing blobs.

## Inbound Worker limits

| Variable | Default | Hard maximum | Behavior |
|---|---:|---:|---|
| `MAX_INBOUND_BYTES` | 10 MiB | 25 MiB | Maximum raw size of one inbound message |
| `MAX_ATTACHMENTS_PER_MESSAGE` | 25 | 50 | Maximum attachment count in one inbound message |
| `MAX_INBOUND_DECODED_BODY_BYTES` | 512 KiB | 2 MiB | Maximum sanitized decoded HTML/plain-body bytes retained after MIME parsing |
| `INBOUND_MAILBOX_MESSAGES_PER_HOUR` | 120 | 10,000 | Accepted inbound attempts for one mailbox in the preceding rolling hour |
| `INBOUND_MAILBOX_BYTES_PER_HOUR` | 100 MiB | 25 GiB | Sum of raw message bytes accepted for one mailbox in the preceding rolling hour |
| `INBOUND_SENDER_MESSAGES_PER_HOUR` | 30 | 10,000 | Accepted attempts from one envelope sender to one mailbox in the preceding rolling hour |
| `MAILBOX_STORAGE_QUOTA_BYTES` | 1 GiB | 1 TiB | Shared approximate retained-message bytes allowed for one mailbox |
| `INBOUND_SENDER_HASH_KEY` | none | exactly 32 bytes | Required Worker secret, encoded as unpadded base64url, while sender limiting is enabled |
| `RETENTION_JOBS_ENABLED` | `false` | — | Set to `true` only after reviewing retention policy |

The three inbound hourly limits and shared storage quota accept an exact
numeric `0` to disable that individual control. Invalid, negative, non-finite, or sub-one positive values
do not disable protection; they return to the default. Positive decimals are
floored and values above the hard maximum are clamped. Keep at least one
mailbox-wide control enabled in production.

Generate the independent sender-HMAC key locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
pnpm exec wrangler secret put INBOUND_SENDER_HASH_KEY --config apps/email-worker/wrangler.toml
```

For local Worker development, put the generated value only in the ignored
`apps/email-worker/.dev.vars`. The default sender control fails closed with a
generic temporary SMTP rejection when this secret is absent or malformed. The
ledger stores only a mailbox-scoped HMAC, never the raw sender address. Rotating
the HMAC key creates new sender buckets, so plan rotation as a deliberate
one-hour rate-limit reset.

The decoded-body ceiling is checked before and after sanitization, with
additional fixed ceilings of 10,000 elements and 128 levels of nesting. Plain
text is byte-bounded before escaping, and its bounded escaped representation
must fit the same retained-output ceiling. Active content is removed once at
ingest; the mail viewer applies a sandbox and blocks remote images until the
user explicitly chooses to load them.

After recipient and duplicate checks, the Worker reserves all enabled limits
with one D1 insert. SQLite triggers evaluate mailbox count, raw bytes, sender
count, and retained-storage allowance in the same write transaction. This
avoids a read-then-write concurrency gap and happens before message parsing or
any R2 body/attachment write. An established duplicate consumes no allowance;
the unique reservation key permits only one concurrent copy to proceed.

Hourly accounting uses a rolling 3,600-second window and charges the
Cloudflare `rawSize` of every accepted attempt, even if later MIME or attachment
validation rejects it. That prevents intentionally malformed mail from gaining
free retries. The storage check uses the non-negative `messages.size_bytes`
metadata for every retained folder/direction, plus non-expired in-flight
reservations and the current raw message size. Trash therefore continues to
count until its message row is actually purged. This is a safe, inexpensive
quota estimate rather than an R2 inventory: legacy zero/incorrect size metadata
or encoding differences can under- or over-count actual billed R2 bytes.

The web application uses the same D1 reservation invariant before contacting
an external provider or writing any Sent, internal-recipient, or draft R2
object. Every copy reserves the exact UTF-8 escaped/sanitized HTML plus
attachment bytes that its message row records. A multi-mailbox send proceeds
only after every mailbox reservation succeeds; a denied group is released
without provider or R2 side effects. Provider idempotency remains keyed by the
compose token, so a provider-accepted message is never automatically resent if
later local persistence fails.

An inserted message atomically converts its temporary storage reservation into
the durable `messages.size_bytes` charge. Terminal failures release the pending
storage charge but keep the one-hour abuse charge. Interrupted pending charges
expire after 15 minutes, and the short-lived ledger prunes old rows
opportunistically. D1 and R2 do not provide a cross-service transaction, so
caught failures are cleaned up but an abrupt runtime termination at the exact
R2/D1 boundary can still require orphan-object reconciliation.

Guardrail denials use the same generic `451 Message temporarily unavailable`
response for quota and dependency failures. They add no sender, recipient,
subject, source IP, message ID, or sender hash to audit/trace records; Worker
warnings are generic so attacker-controlled mail cannot enter new telemetry.

The Worker template schedules a daily retention pass. It does nothing while
`RETENTION_JOBS_ENABLED` is false. When explicitly enabled, the pass applies
the D1 `retention_config` periods in bounded batches: trash messages and their
R2 objects, trash attachments, mail trace, and audit records. It takes multiple
fair catch-up batches per invocation, stopping at fixed batch, row, and runtime
ceilings. Each run writes `retention.completed`, `retention.backlog_remaining`,
or `retention.failed` to `audit_log`; backlog also produces a Worker warning so
operators can monitor it. Review legal-hold, backup, and recovery requirements
before enabling destructive retention.

## Where values belong

| Value type | Local development | Production |
|---|---|---|
| D1/R2 bindings and public settings | Local `wrangler.toml` | Cloudflare deployment configuration |
| OAuth credentials, session key, outbound API tokens, temporary bootstrap pair | `apps/web/.dev.vars` | Cloudflare Pages secrets |
| Cloudflare account ID and outbound provider selection | `apps/web/.dev.vars` or local `wrangler.toml` | Cloudflare Pages variables |
| Inbound sender-HMAC key | `apps/email-worker/.dev.vars` | Email Worker secret `INBOUND_SENDER_HASH_KEY` |
| Organisation settings | Environment defaults or Admin UI | Environment defaults or Admin UI |

The inbound email Worker always needs the shared D1 and R2 bindings. When Web
Push is enabled, it also needs the same public VAPID configuration and an
independently stored copy of `VAPID_PRIVATE_KEY`. Do not copy OAuth, session, or
outbound-provider credentials into the Worker.

## Secret handling

- Use different secrets for development, staging, and production.
- Never place secrets in `.env.example`, Wrangler templates, screenshots, issues, or support logs.
- Treat raw invitation links and bootstrap proofs as credentials; do not log or forward them.
- Restrict provider dashboards and use multi-factor authentication.
- Scope the Cloudflare Email Service token to the required account and **Email Sending: Edit** permission; anyone holding it can send from onboarded domains in that account.
- Review Cloudflare Email preview before sending sensitive mail; its optional dashboard preview retains message content and attachments for about seven days.
- Rotate a value immediately if it is printed, committed, or shared outside its intended secret store.
- Remember that deleting a tracked file does not erase prior Git objects.

For platform-specific behavior, refer to Cloudflare's current
[Pages bindings and secrets](https://developers.cloudflare.com/pages/functions/bindings/),
[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), and
[Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/),
[Email Sending setup](https://developers.cloudflare.com/email-service/get-started/send-emails/), and
[Email Service limits](https://developers.cloudflare.com/email-service/platform/limits/)
documentation. Identity-provider setup should be checked against the current
[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
[Microsoft app registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app),
and [Microsoft OpenID Connect UserInfo](https://learn.microsoft.com/en-us/entra/identity-platform/userinfo)
guides.

[← Documentation home](README.md)
