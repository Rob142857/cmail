# Configuration reference

cmail is configured through Cloudflare bindings for storage, plain environment variables for non-secret settings, provider secret stores for credentials, and optional organisation settings stored in D1 (Cloudflare's hosted database).

## Storage bindings

Both applications require bindings to the same resources:

| Binding | Resource | Used by |
|---|---|---|
| `DB` | Cloudflare D1 database | Web application and email Worker |
| `STORAGE` | Cloudflare R2 bucket | Web application and email Worker |

Store deployment-specific IDs in local or deployment configuration, not reusable source templates.

Keep the web template's `nodejs_compat` compatibility flag enabled — SvelteKit's server output uses Node.js APIs that Cloudflare exposes under that flag. Review compatibility-date changes in staging before rolling out to production.

## Core web settings

| Variable | Required | Secret | Description |
|---|---:|---:|---|
| `APP_NAME` | Yes | No | Name shown by the application |
| `APP_URL` | Yes | No | Public HTTPS origin used to construct OAuth callbacks and first-party enrolment links |
| `MAIL_DOMAIN` | Yes | No | Domain appended to managed mailbox local parts |
| `SESSION_SECRET` | Yes | Yes | HMAC key for session tokens; use an independent random value per environment |

Don't add a trailing slash to `APP_URL`. `MAIL_DOMAIN` is a bare hostname — no scheme, no path.

## OAuth

Configure at least one complete provider:

| Variable | Required when | Secret |
|---|---|---:|
| `GOOGLE_CLIENT_ID` | Google sign-in is enabled | Treat as configuration |
| `GOOGLE_CLIENT_SECRET` | Google sign-in is enabled | Yes |
| `MICROSOFT_CLIENT_ID` | Microsoft sign-in is enabled | Treat as configuration |
| `MICROSOFT_CLIENT_SECRET` | Microsoft sign-in is enabled | Yes |
| `MICROSOFT_TENANT_ID` | Optional for Microsoft; defaults to `common` | Treat as configuration |

A provider's button appears only when its client ID and secret are present, `APP_URL` is a safe callback origin, and `SESSION_SECRET` passes the minimum-strength check. An invalid Microsoft tenant value, or any missing shared prerequisite, fails closed and keeps the button off.

For Microsoft sign-in, choose the audience deliberately:

- Set `MICROSOFT_TENANT_ID` to the deployment's tenant GUID for a single-tenant Entra app.
- Use `organizations` for work or school accounts across Entra tenants.
- Use `common` for Microsoft 365 work/school accounts plus personal accounts (Outlook.com, Hotmail, Live). The Entra app registration must also select the account type that covers both organisational directories and personal Microsoft accounts.

Both providers use the OpenID Connect (OIDC, a standard sign-in protocol) authorization-code flow with PKCE and the `openid email profile` scopes. cmail exchanges the code, then calls the provider's UserInfo endpoint with the access token: Google at `https://openidconnect.googleapis.com/v1/userinfo`, Microsoft at `https://graph.microsoft.com/oidc/userinfo` — deliberately not the Microsoft Graph `/me` endpoint. The durable identity key is the provider name plus the UserInfo `sub` value. cmail never uses email, UPN (Microsoft's internal username-like ID), or ID-token claims to resolve a returning account.

An ordinary user's first sign-in needs a manager-issued enrolment invitation. Provider links look like `<APP_URL>/enroll/google#token=...` and `<APP_URL>/enroll/microsoft#token=...`. The `#token` fragment never reaches the HTTP request, referrer, or server logs — the first-party page strips it from browser history before a same-origin POST. The raw token is stored only as a hash in D1, expires after 72 hours, and works once. The route validates it and captures the pending enrolment in a 15-minute `HttpOnly`, `SameSite=Lax` cookie (`Secure` on production HTTPS) before redirecting to the provider, so the raw token never continues into OIDC. Binding also needs a matching UserInfo email: Google must return `email_verified=true`; Microsoft must return a non-empty OIDC UserInfo `email` claim, since Microsoft UserInfo has no `email_verified`. After binding, sign-in uses only provider plus `sub` — changing or reusing an email can't transfer the account.

Creating a user without sending an invitation leaves the account pending and unbound on purpose. A manager must use **Resend invitation** before that person can enrol; resending rotates the token and invalidates the previous link. Used or expired links, email mismatches, a subject already bound to another user, or an account already bound to a different identity all fail closed. Investigate the conflict and issue a fresh invitation rather than changing an email just to bypass it.

## Optional Web Push

Browser new-mail notifications stay off unless all three VAPID (keys that authenticate your server to push services) values are valid and present. The deployed app needs HTTPS (localhost is fine for local development). Generate one pair from the repository root:

```sh
pnpm push:keys
```

Configure the same values on both the Pages application and inbound email Worker:

| Variable | Secret | Purpose |
|---|---:|---|
| `VAPID_PUBLIC_KEY` | No | Browser-visible VAPID application-server key |
| `VAPID_PRIVATE_KEY` | Yes | Signing key; store independently as a secret in both runtimes |
| `VAPID_SUBJECT` | No | Monitored `mailto:` address or HTTPS operator URL |
| `PUSH_ENDPOINT_HOSTS` | No | Optional comma-separated additions to the built-in push-service hostname allowlist |

Put the public key and subject in `[vars]` in both local Wrangler files. For local Worker testing, put only `VAPID_PRIVATE_KEY` in the ignored `apps/email-worker/.dev.vars` — don't copy unrelated web credentials into the Worker. For production, set the private key separately in Pages and the inbound Worker:

```sh
pnpm exec wrangler pages secret put VAPID_PRIVATE_KEY --project-name cmail-web
pnpm exec wrangler secret put VAPID_PRIVATE_KEY --config apps/email-worker/wrangler.toml
```

The built-in endpoint allowlist covers the common Google, Mozilla, Apple, and Microsoft browser push services. Extend `PUSH_ENDPOINT_HOSTS` only for a verified HTTPS push-service domain that supported clients actually need — each addition expands the external request boundary.

Even when configured, a signed-in user must deliberately enable notifications and approve the browser permission. Payloads are generic: no sender, subject, mailbox name, address, body, or attachment data. Push delivery is best-effort, never a substitute for mailbox state. The in-product **Send test alert** control is rate-limited to three requests per active account per hour, targets only the current browser/device registration, and is scoped server-side to the signed-in user. An `accepted` result means the browser push service accepted the request — device presentation can still be delayed or suppressed by OS, browser, network, battery, or Do Not Disturb controls.

On iPhone and iPad, [standards-based Web Push is available to web apps added to the Home Screen](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/); the user must launch that installed app and use its **Turn on** control. Other clients are detected by capability, not browser name, so the control stays hidden wherever Push, Notifications, or service workers aren't available. Rotating the VAPID pair invalidates existing subscriptions — communicate the change and have users opt in again.

This notification path is direct and best-effort, not a durable queue. See the non-implemented [push notification reliability blueprint](push-notification-reliability.md) before designing a higher-assurance delivery path.

## Outbound delivery

| Variable | Secret | Purpose |
|---|---:|---|
| `OUTBOUND_PROVIDER` | No | `cloudflare` (committed default), `postmark`, `auto`, or `none` to disable external delivery |
| `EMAIL_SERVICE` | Binding | Private Pages service binding to the email Worker; recommended Cloudflare production path |
| `CLOUDFLARE_ACCOUNT_ID` | No | Optional REST fallback: 32-character Cloudflare account ID containing the onboarded Email Sending domain |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Yes | Optional REST fallback credential with **Email Sending: Edit** permission |
| `POSTMARK_API_KEY` | Yes | Enable Postmark delivery |

In `auto` mode, cmail picks the first complete provider configuration, checking Cloudflare Email Service then Postmark. Set an explicit provider when you need deterministic selection — explicit selection fails closed if that provider's required values are missing or invalid, and cmail never silently falls through to a different provider. If no provider is ready, external outbound attempts fail while internal mailbox delivery keeps working.

### Cloudflare Email Service

Cloudflare Email Service is the recommended external provider. In production, Pages calls the cmail email Worker over the private `EMAIL_SERVICE` service binding. That Worker owns Cloudflare's native `send_email` binding, so the web application holds no outbound Cloudflare API token. Its result is an opaque Cloudflare tracking ID for activity and lifecycle reconciliation, not the wire RFC `Message-ID`. To enable it:

1. Confirm the account is on the Workers Paid plan — Email Sending is currently a public beta.
2. Use a domain hosted on Cloudflare DNS and onboard it under **Compute → Email Service → Email Sending**. Review the Cloudflare-created bounce MX, SPF, DKIM, and DMARC records (DNS entries that route and authenticate mail) against every existing sender for the domain.
3. Keep `[[send_email]]` with `name = "EMAIL"` in the email Worker's Wrangler file, and keep that Worker off `workers.dev` and public HTTP routes.
4. Keep the Pages `[[services]]` binding named `EMAIL_SERVICE` pointed at that environment's email Worker. Deploy the Worker before Pages.
5. Keep the template's `OUTBOUND_PROVIDER=cloudflare`. Use `auto` only when a complete Postmark configuration should act as a fallback.

Follow [Email authentication and sender requirements](email-authentication.md) for the current RFC 9989 DMARC rollout, record verification, major receiver policies, and the boundary that keeps cmail from being used as a bulk-marketing system. Provider onboarding doesn't replace that review.

Cloudflare limits a general outbound message to 50 total `to`/`cc`/`bcc` recipients and 5 MiB including attachments. cmail enforces those limits before submission, even if an application setting would otherwise allow more. New Cloudflare accounts also start with conservative daily quotas — check the [current limits](https://developers.cloudflare.com/email-service/platform/limits/) and stage real mail flow before switching production traffic.

Cloudflare Email preview is a separate privacy decision. When enabled, dashboard users can inspect rendered HTML, plain text, headers, attachments, and raw message source, retained for about seven days. Cloudflare turns it on by default for new sending domains. Review access and disable it in the sending domain's settings unless you need that extra retention. See [Email logs and message preview](https://developers.cloudflare.com/email-service/observability/logs/#message-preview).

The committed topology implements exactly this private Worker path: Pages must never receive a `[[send_email]]` block directly, only the `EMAIL_SERVICE` service binding. The Worker accepts the bounded internal send request, uses its `EMAIL` binding, and has no public fetch route. See Cloudflare's [Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/), and [Pages service bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings).

#### Cloudflare message identifiers

Keep the two identifier classes separate:

- Native Workers `send()` returns an opaque Cloudflare tracking ID. cmail stores it in the provider-ID array used by trace and lifecycle investigations.
- Cloudflare controls the wire `Message-ID` header. The native binding doesn't expose it, so cmail never treats the tracking ID as an RFC header.
- The REST API reference declares an RFC-style `result.message_id`; cmail validates and stores it as the authoritative wire header when present, but tolerates an omitted field (some response examples don't show it) rather than inventing a replacement.

So `In-Reply-To` and `References` preserve existing ancestry, but the first external reply to a brand-new native-binding conversation may not join the local Sent thread automatically. A production acceptance test must inspect an actually received copy and its reply — a successful API response alone doesn't prove thread correlation.

#### Mixed local and external recipients

Every recipient must see the same visible To/Cc roles. cmail picks one of two safe plans:

- If a valid Cloudflare account ID and Email Sending API token are configured, one REST `send_raw` call carries only external SMTP-envelope recipients while its MIME headers keep the complete To/Cc lists. Local copies persist synchronously.
- On the token-free native path, or with Postmark, one structured provider call carries the complete To/Cc set, and active local recipients return asynchronously through Cloudflare Email Routing. This avoids duplicate delivery and Cc-to-To promotion, but depends on working inbound routing, quotas, and storage.

The REST raw-MIME path is automatically preferred for mixed messages once its credential pair is ready, even if `EMAIL_SERVICE` is also bound. External-only mail still prefers the token-free native binding. Test internal-only, external-only, and mixed To/Cc cases before launch.

For local development, or a platform without service bindings, configure both `CLOUDFLARE_ACCOUNT_ID` and a narrowly scoped `CLOUDFLARE_EMAIL_API_TOKEN`; cmail then uses Cloudflare's [REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/). The REST success response reports delivered, queued, and permanently bounced recipients, and the generated API reference includes `result.message_id`, which cmail validates when returned. The same credentials enable the single-call raw-MIME plan for mixed recipients described above. Local email bindings simulate delivery unless deliberately configured for remote use — remote mode sends real mail. See the [local sending guide](https://developers.cloudflare.com/email-service/local-development/sending/).

### Postmark alternative

Set `OUTBOUND_PROVIDER=postmark`, store `POSTMARK_API_KEY` as a Pages secret, and verify the sender or domain in Postmark. cmail checks Postmark's 50-recipient and 10 MB total-message limits before submission — confirm current limits in Postmark's [email API documentation](https://postmarkapp.com/developer/user-guide/send-email-with-api).

The sender address used for invitations and system messages must be accepted by the chosen provider. Configure it in **Admin → Settings** after bootstrap, or supply a `SYSTEM_EMAIL` default.

## Bootstrap

The first manager is the only account that doesn't start with a manager-issued invitation. Bootstrap stays disabled unless both temporary values are present and valid:

| Variable | Secret | Purpose |
|---|---:|---|
| `BOOTSTRAP_ADMIN_EMAIL` | Yes | Exact expected access-token-backed UserInfo email allowed to create the first manager |
| `BOOTSTRAP_ADMIN_TOKEN` | Yes | Strong one-time bootstrap credential; at least 32 cryptographically random characters |

Generate a separate token of at least 32 strong random characters for every environment. The operator opens `<APP_URL>/bootstrap` and submits it in a same-origin POST. cmail exchanges it for a signed `cmail_bootstrap_proof` cookie, valid for 10 minutes, before starting OIDC — `HttpOnly`, `SameSite=Lax`, and `Secure` on production HTTPS. Never put the token or proof in a URL or query string, send it by email, or copy it into logs, screenshots, issue trackers, shell history, Wrangler files, or source.

The accepted UserInfo email must match `BOOTSTRAP_ADMIN_EMAIL`: Google requires `email_verified=true`; Microsoft requires its non-empty OIDC UserInfo `email` claim alongside the independent bootstrap proof. The provider plus immutable UserInfo `sub` becomes the new manager's durable binding. Delete both bootstrap secrets and redeploy immediately after verifying that account. If an attempt expires, conflicts, or the token may have leaked, rotate `BOOTSTRAP_ADMIN_TOKEN`, clear the browser bootstrap state, and start again. Rotating `SESSION_SECRET` also invalidates signed bootstrap proofs and application sessions — plan that rotation as a sign-out event.

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

Managers can override these in **Admin → Settings**; those overrides are stored in D1 and take precedence. `APP_URL` is deliberately excluded — it stays a deployment-level variable so OAuth callbacks, invitation links, and provider registrations can't drift apart. Keep environment values as safe deployment defaults.

## Organisation directory and public endpoint

Manage the organisation model under **Admin → Organisation**: ordered layers, hierarchical units, reusable roles, and positions. The public directory has its own master switch and is disabled by default.

`GET /api/organization` is intentionally unauthenticated so a deployment can use it on a public website. It returns `[]` unless the master switch is enabled. Even then, a position is returned only when all of these are true:

- it's explicitly marked **Public**;
- its assigned user is active;
- its selected work address is an active assigned mailbox on `MAIL_DOMAIN`;
- its occupant display name and position title are both present.

Each returned object contains exactly these fields:

```json
{
  "occupantDisplayName": "Alex Example",
  "workEmail": "alex@example.com",
  "positionTitle": "Operations Lead"
}
```

The public endpoint never selects user IDs, login addresses, personal contact data, units, reporting hierarchy, internal positions, or other organisation metadata. Responses use `Cache-Control: no-store`. Treat enabling the directory as a privacy change: get any required consent, review every public position, and test the endpoint before linking it from another site.

## Brand and regional defaults

| Variable | Default | Description |
|---|---|---|
| `BRAND_LOGO_URL` | `/logo.svg` | Relative path or HTTPS URL for the primary logo |
| `BRAND_ICON_URL` | `/icon.svg` | Relative path or HTTPS URL for the compact icon |
| `BRAND_ICON_192_URL` | `/icon-192.png` | Relative path or HTTPS URL for the 192×192 PWA and Apple touch icon |
| `BRAND_ICON_512_URL` | `/icon-512.png` | Relative path or HTTPS URL for the 512×512 installed-app icon |
| `BRAND_OG_IMAGE_URL` | `/og-image.svg` | Relative path or HTTPS URL for the social sharing image |
| `BRAND_PRIMARY_COLOR` | `#0078d4` | Six-digit hexadecimal accent colour |
| `LOCALE` | `en` | Unicode locale identifier used by configurable formatting |
| `TIME_ZONE` | `UTC` | IANA time-zone name used by configurable formatting |

`REPO_URL` appears in the example configuration as deployment metadata only — the application doesn't render it automatically.

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

The message-count limit applies to every submitted send, including internal-only mail. The workload limit charges the greatest of recipient count, aggregate recipient-payload MiB, or the number of R2 body/attachment objects created — so a many-recipient or attachment-heavy send costs more than a small one-recipient message.

Draft autosaves and explicit saves share the per-user, per-mailbox hourly limit. New drafts and mailbox moves atomically reserve one owned draft slot, so concurrent requests can't exceed the row cap. Draft growth reserves only its UTF-8 stored-HTML size delta; moving a draft reserves its full stored size in the destination mailbox. Draft R2 bodies use versioned keys, so a failed metadata update leaves the prior body intact.

Fixed per-send ceilings also apply, regardless of configuration: 250 MiB aggregate delivery payload, 100 MiB duplicated internal R2 content, and 250 new R2 objects. A message body is capped at 1 MiB and attachments at 20 MiB total; compose requests declaring a length above 24 MiB are rejected before form parsing, and every parsed form is checked again. Each internal message owns its R2 keys, and deletion removes those objects — so internal copies are bounded rather than sharing blobs.

## Inbound Worker limits

Before any D1 lookup, the optional native Cloudflare Rate Limiting bindings in `apps/email-worker/wrangler.toml` record a generous per-colo (Cloudflare edge location) abuse threshold: 120 messages/minute for a trusted source IP (or, without a trusted boundary IP, the sender-controlled envelope sender), plus a 1,000 messages/minute per-colo aggregate circuit breaker. Actor inputs are SHA-256 pseudonymized — not anonymized — before reaching the counter key. This surfaces unavailable-recipient spraying without spending outbound-send quota. Cloudflare documents Email Workers `setReject()` as a permanent SMTP error, so cmail deliberately does **not** turn this signal into a misleading `451` or drop mail. The bindings fail open when absent or faulty, so this optional protection can't cause a mail outage; namespaces must be positive, account-unique integers, and preview must use different namespaces from production. Thresholds never alter delivery or block D1 reads. A third, one-per-minute-per-colo alert binding allows one generic no-PII Worker warning when either signal is over limit; if that binding is absent, denied, or faulty, cmail just omits the warning. Native counters are local to one colo, so the D1-backed limits below remain the durable mailbox and sender controls.

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
| `SPAM_QUARANTINE_SCORE` | unset | — | Spam score at or above which a message is filed to Spam instead of Inbox; unset or non-numeric means never quarantine on score alone |
| `RETENTION_JOBS_ENABLED` | `false` | — | Set to `true` only after reviewing retention policy |

The three inbound hourly limits and the shared storage quota accept an exact numeric `0` to disable that one control. Invalid, negative, non-finite, or sub-one positive values don't disable protection — they fall back to the default. Positive decimals are floored, and values above the hard maximum are clamped. Keep at least one mailbox-wide control enabled in production.

Generate the independent sender-HMAC key locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
pnpm exec wrangler secret put INBOUND_SENDER_HASH_KEY --config apps/email-worker/wrangler.toml
```

For local Worker development, put the generated value only in the ignored `apps/email-worker/.dev.vars`. If this secret is absent or malformed, the default sender control fails closed with a generic permanent rejection controlled by Cloudflare. The ledger stores only a mailbox-scoped HMAC, never the raw sender address. Rotating the HMAC key creates new sender buckets — plan rotation as a deliberate one-hour rate-limit reset.

The decoded-body ceiling is checked before and after sanitization, with fixed ceilings of 10,000 elements and 128 levels of nesting. Plain text is byte-bounded before escaping, and its escaped form must still fit the same retained-output ceiling. Active content is stripped once at ingest; the mail viewer also applies a sandbox and blocks remote images until the user explicitly chooses to load them.

After recipient and duplicate checks, the Worker reserves all enabled limits in one D1 insert. SQLite triggers check mailbox count, raw bytes, sender count, and retained-storage allowance in that same write transaction — before message parsing or any R2 write, and with no read-then-write concurrency gap. A confirmed duplicate consumes no allowance; the unique reservation key lets only one concurrent copy proceed.

Hourly accounting uses a rolling 3,600-second window and charges the Cloudflare `rawSize` of every accepted attempt, even if later MIME or attachment validation rejects it — so intentionally malformed mail can't gain free retries. The storage check uses the non-negative `messages.size_bytes` metadata for every retained folder/direction, plus non-expired in-flight reservations and the current raw message size, so trash keeps counting until its message row is actually purged. This is a cheap, safe estimate, not an R2 inventory — legacy zero/incorrect size metadata or encoding differences can under- or over-count actual billed R2 bytes.

The web application uses the same D1 reservation rule before contacting an external provider or writing any Sent, internal-recipient, or draft R2 object. Every copy reserves the exact UTF-8 escaped/sanitized HTML plus attachment bytes its message row records. A multi-mailbox send proceeds only once every mailbox reservation succeeds; a denied group is released with no provider side effects. The immutable outbound journal then stages the canonical body and attachments under private, deterministic R2 keys, records every target and reservation in D1, and atomically claims `dispatching` before calling the provider. Provider results are snapshotted before reconciliation. `accepted` and `materialized` per-compose or per-draft-generation keys are permanent idempotency tombstones: recovery creates any missing Sent/internal copies with stable IDs and keys, but never calls the provider again. A newer saved draft generation gets a new key without weakening recovery of the older accepted send. `dispatching` or `ambiguous` records need operator reconciliation and must never be blindly retried.

An inserted message atomically converts its temporary storage reservation into the durable `messages.size_bytes` charge. Terminal failures release the pending storage charge but keep the one-hour abuse charge; confirmed non-acceptance and its reservation release share one D1 state transition. Ordinary interrupted pending charges expire after 15 minutes; journal-linked reservations stay held until the send is materialized or explicitly cancelled. The short-lived ledger prunes other old rows opportunistically. D1 and R2 share no cross-service transaction, so caught failures are cleaned up with deterministic recovery at the boundary. The one irreducible case — a runtime termination after a provider accepts mail but before cmail records the result — is marked for operator reconciliation instead of risking a duplicate send.

Guardrail denials use a generic plain-text reason for quota and dependency failures; Cloudflare controls the permanent SMTP rejection. They add no sender, recipient, subject, source IP, message ID, or sender hash to audit/trace records, and Worker warnings stay generic so attacker-controlled mail can't enter new telemetry.

The Worker template schedules a daily retention pass that does nothing while `RETENTION_JOBS_ENABLED` is false. Once enabled, it applies the D1 `retention_config` periods in bounded batches: trash messages and their R2 objects, trash attachments, mail trace, and audit records. It runs multiple fair catch-up batches per invocation, stopping at fixed batch, row, and runtime ceilings. Each run writes `retention.completed`, `retention.backlog_remaining`, or `retention.failed` to `audit_log`; a backlog also raises a Worker warning so operators can monitor it. Review legal-hold, backup, and recovery requirements before enabling this destructive retention.

`SPAM_QUARANTINE_SCORE` only controls scoring-based filing. The organisation-wide sender allow/block list a Manager maintains at **Management > Quarantine** is evaluated on every inbound message regardless of this setting, and an explicit block or allow always overrides the score. See [Spam and quarantine](spam-and-quarantine.md) for how scoring, filing, and sender rules fit together, and for guidance on choosing a threshold.

## Where values belong

| Value type | Local development | Production |
|---|---|---|
| D1/R2 bindings and public settings | Local `wrangler.toml` | Cloudflare deployment configuration |
| OAuth credentials, session key, optional outbound fallback/API tokens, temporary bootstrap pair | `apps/web/.dev.vars` | Cloudflare Pages secrets |
| Outbound provider selection and optional REST-fallback account ID | `apps/web/.dev.vars` or local `wrangler.toml` | Cloudflare Pages variables |
| Native Cloudflare outbound bindings | Local Wrangler configuration | Email Worker `EMAIL` send binding plus Pages `EMAIL_SERVICE` service binding |
| Inbound sender-HMAC key | `apps/email-worker/.dev.vars` | Email Worker secret `INBOUND_SENDER_HASH_KEY` |
| Organisation settings | Environment defaults or Admin UI | Environment defaults or Admin UI |

The email Worker always needs the shared D1 and R2 bindings, and owns the native Cloudflare outbound `EMAIL` binding. When Web Push is enabled, it also needs the same public VAPID configuration and its own stored copy of `VAPID_PRIVATE_KEY`. Never copy OAuth, session, or outbound-provider API credentials into the Worker.

## Secret handling

- Use different secrets for development, staging, and production.
- Never place secrets in `.env.example`, Wrangler templates, screenshots, issues, or support logs.
- Treat raw invitation links and bootstrap proofs as credentials — don't log or forward them.
- Restrict provider dashboards and use multi-factor authentication.
- If the optional Cloudflare REST fallback is enabled, scope its token to the required account and **Email Sending: Edit** permission — anyone holding it can send from onboarded domains in that account.
- Review Cloudflare Email preview before sending sensitive mail; its optional dashboard preview retains message content and attachments for about seven days.
- Rotate a value immediately if it's printed, committed, or shared outside its intended secret store.
- Remember that deleting a tracked file doesn't erase prior Git objects.

For platform-specific behavior, check Cloudflare's current [Pages bindings and secrets](https://developers.cloudflare.com/pages/functions/bindings/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), [Email Sending setup](https://developers.cloudflare.com/email-service/get-started/send-emails/), and [Email Service limits](https://developers.cloudflare.com/email-service/platform/limits/) docs. Check identity-provider setup against [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Microsoft app registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), and [Microsoft OpenID Connect UserInfo](https://learn.microsoft.com/en-us/entra/identity-platform/userinfo).

[← Documentation home](README.md)
