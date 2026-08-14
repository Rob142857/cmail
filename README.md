<p align="center">
  <img src="apps/web/static/icon.svg" width="96" alt="">
</p>

<h1 align="center">cmail</h1>

<p align="center"><strong>Self-hosted organisational email on Cloudflare.</strong></p>

<p align="center">
  <a href="https://github.com/Rob142857/cmail/actions/workflows/ci.yml"><img src="https://github.com/Rob142857/cmail/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/Rob142857/cmail/actions/workflows/codeql.yml"><img src="https://github.com/Rob142857/cmail/actions/workflows/codeql.yml/badge.svg" alt="CodeQL status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2563eb.svg" alt="MIT License"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D22-339933.svg" alt="Node.js 22 or newer"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/assurance.md">Security &amp; assurance</a> ·
  <a href="ROADMAP.md">Roadmap</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/Rob142857/cmail"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>
</p>

> [!IMPORTANT]
> **Guided repository import, not one-click production deployment.** The
> current cmail topology is a Cloudflare Pages application plus a separate
> email Worker in a shared pnpm monorepo. Cloudflare's button supports Workers
> applications, not Pages or multiple applications in one deployment. Use it
> to begin the public-repository import, then complete the documented resource,
> secret, DNS, routing, and bootstrap steps in [Deployment and
> verification](docs/deployment.md#guided-repository-import).
> Forks and private downstream repositories must replace the button's `url=`
> value with their reviewed repository URL; the upstream button deliberately
> imports `Rob142857/cmail` and cannot infer the page from which it was copied.

cmail is an open-source email application for organisations that want personal
and shared mailboxes on a domain they control. It combines a SvelteKit web
application with Cloudflare Email Routing, Workers, D1, and R2. External
outbound delivery uses Cloudflare Email Service through a private Worker binding
by default, with Postmark as an alternative.

> [!IMPORTANT]
> cmail is pre-1.0 software. Review the code and threat model for your environment, test recovery procedures, and complete the [security checklist](docs/security-checklist.md) before handling sensitive or production mail.

## Why cmail

- **Portable by default:** domain, organisation, branding, identity providers,
  safety limits, and deployment resources are configuration rather than forks.
- **Email-aware administration:** users, mailbox assignments, policy,
  organisation structure, audit records, and mail trace share one management
  model.
- **Fail-closed sign-in:** Google and Microsoft are independently enabled and a
  provider is shown only when its complete configuration is ready. New users
  must enrol through a manager-issued invitation; returning users are resolved
  only by their immutable provider subject.
- **Privacy-conscious directory:** the optional public endpoint returns only an
  explicitly public position's occupant name, work email, and title.
- **Operator-owned:** cmail is MIT licensed and self-hosted; your organisation
  controls its accounts, domain, data, provider relationships, and deployment.

## What is included

- Google and Microsoft OpenID Connect sign-in with invitation-bound enrolment
- Personal and shared mailboxes with read, send-as, and full assignments
- Inbound delivery through Cloudflare Email Routing
- External outbound delivery through Cloudflare Email Service or Postmark
- Internal delivery between cmail mailboxes
- Draft autosave, attachments, Reply, Reply all, Forward, message importance,
  standards-compatible threading, search, bulk actions, and mailbox folders
- Personal signatures with safe rich formatting, optional organisation
  signatures or disclaimers, and Manager-controlled locking where required
- Durable outbound journaling that prevents an accepted message from being
  resent while safely recovering missing Sent or internal-recipient copies
- Manager tools for users, mailboxes, organisation settings, policy versions, audit records, and mail trace
- Optional organisation directory with configurable layers, units, roles, and positions
- Privacy-first public directory projection: only an explicitly public position's name, title, and work email can be exposed
- Policy acknowledgement before mailbox access when a policy is published
- Optional, user-enabled browser notifications with privacy-minimised new-mail copy
- Responsive web UI with installable PWA metadata

cmail is an application, not a hosted service. Operators remain responsible for their Cloudflare account, identity-provider configuration, outbound provider, DNS, backups, monitoring, privacy obligations, and provider charges. Check each provider's current documentation and terms before deploying.

cmail is not currently a bulk-marketing or campaign platform. It does not
provide the consent, list, RFC 8058 one-click unsubscribe, complaint, or
deliverability controls required for that use. See [Email authentication and
sender requirements](docs/email-authentication.md) before enabling external
mail flow.

## Use and manage cmail

- [User guide](docs/user-guide.md) — first sign-in, mail navigation, reading,
  composing, folders, and safety.
- [Mobile app and notification guide](docs/mobile-pwa.md) — install cmail on
  iPhone, iPad, or Android and troubleshoot optional new-mail alerts.
- [Shared mailboxes](docs/shared-mailboxes.md) — delegation, From identity,
  permission bundles, and shared message state.
- [Email signatures](docs/signatures.md) — personal sign-offs, optional
  organisation footers, Manager locking, ordering, and safe formatting.
- [Manager handbook](docs/manager-handbook.md) — account lifecycle, mailboxes,
  organisation structure, directory privacy, policy, trace, audit, and settings.
- [Email authentication and sender requirements](docs/email-authentication.md)
  — current SPF, DKIM, DMARC, Cloudflare, and major-provider requirements.

## Architecture

```text
Inbound sender
    |
    v
Cloudflare Email Routing
    |
    v
Email Worker ---------> D1 (mail metadata, users, audit and trace)
    |                   R2 (message bodies and attachments)
    |                         ^
    |                         |
User browser -> Cloudflare Pages -> SvelteKit application
                    |              |
                    |              +-> Postmark alternative -> external recipient
                    v
          private EMAIL_SERVICE
                    |
                    +-> Email Worker -> native EMAIL/send_email
                                         -> Cloudflare Email Service
                                         -> external recipient
```

The web application authorises each send, then calls the email Worker over the
private `EMAIL_SERVICE` service binding. The Worker handles both Email Routing
and native Cloudflare outbound submission through its `EMAIL` (`send_email`)
binding. It remains unavailable on `workers.dev` and has no public HTTP route.
Both applications bind to the same D1 database and R2 bucket.

## Repository layout

```text
apps/web/                    SvelteKit web application
apps/email-worker/           Cloudflare Email Routing and private native-outbound Worker
packages/shared/             Shared types, push utilities, and D1 migrations
scripts/setup.mjs            Creates local Wrangler files from templates
scripts/verify-migrations.mjs  Verifies the schema in a fresh temporary D1
docs/                        Setup, deployment, security, and policy guidance
landing/                     Optional static project landing page
```

## Quick start

### Prerequisites

- Node.js 22 or newer
- pnpm 11 or newer
- A Cloudflare account and a domain managed in Cloudflare
- A Google Cloud OAuth client, a Microsoft Entra application, or both
- Cloudflare Email Service (recommended) or Postmark if external outbound mail is required

### 1. Clone and install

```sh
git clone https://github.com/Rob142857/cmail.git
cd cmail
pnpm install
pnpm setup
```

`pnpm setup` copies the committed Wrangler templates to local `wrangler.toml`
files, creates `apps/web/.dev.vars`, and creates
`apps/email-worker/.dev.vars` with a fresh development-only sender-HMAC key
when those files do not already exist. Replace all placeholders with values
from your own deployment. Local Wrangler files and `.dev.vars` can contain
tenant data or secrets and must not be committed.

### 2. Create storage

Authenticate Wrangler, then create D1 and R2 resources:

```sh
pnpm exec wrangler login
pnpm d1:create
pnpm r2:create
```

Copy the D1 database ID into both:

- `apps/web/wrangler.toml`
- `apps/email-worker/wrangler.toml`

Confirm that both files use the same D1 database and R2 bucket. Then apply the versioned D1 migrations:

```sh
pnpm db:migrate
```

For an isolated local database, use:

```sh
pnpm db:migrate:local
```

### 3. Configure the web application

Set non-secret deployment values in `apps/web/wrangler.toml`:

- `APP_NAME`: application name shown in the UI
- `APP_URL`: public HTTPS origin of the web application, without a trailing slash
- `MAIL_DOMAIN`: domain used for cmail mailbox addresses

Configure at least one OAuth provider and a strong, unique `SESSION_SECRET`. For local development, edit the ignored `apps/web/.dev.vars` created by `pnpm setup`, then start the app:

```sh
pnpm dev
```

Before writing production secrets, create the Pages project. Replace the project name everywhere if you do not use `cmail-web`:

```sh
pnpm exec wrangler pages project create cmail-web --production-branch main
```

Use the resulting `https://cmail-web.pages.dev` origin, or attach and verify a [custom Pages domain](https://developers.cloudflare.com/pages/configuration/custom-domains/), before finalising `APP_URL`. Register OAuth callbacks against that final origin. Changing `APP_URL` later also requires updating both identity-provider registrations and redeploying.

For production, store secrets in Cloudflare rather than in source-controlled files. For example:

```sh
pnpm exec wrangler pages secret put SESSION_SECRET --project-name cmail-web
pnpm exec wrangler pages secret put GOOGLE_CLIENT_ID --project-name cmail-web
pnpm exec wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name cmail-web
```

Microsoft OAuth uses `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_TENANT_ID`. Set the tenant to `common` and configure the app registration for organisational plus personal Microsoft accounts to support Microsoft 365, Outlook, Hotmail, and Live; use a tenant GUID for a single-tenant Entra deployment.

For external outbound mail, the committed template selects
`OUTBOUND_PROVIDER=cloudflare`. In production, Pages calls the email Worker over
the private `EMAIL_SERVICE` service binding; that Worker owns Cloudflare's
native `send_email` binding, so no outbound API token is required. The
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_API_TOKEN` pair remains an
optional REST fallback for local or non-service-binding environments. Postmark
is the portable alternative and uses `OUTBOUND_PROVIDER=postmark` plus
`POSTMARK_API_KEY`. `auto` remains available for deployments that want
configuration detection; it selects Cloudflare then Postmark. An explicitly
selected provider fails closed when its configuration is incomplete.

#### Fast OAuth setup

`APP_URL` is the single callback base. There are no separate callback URL
environment variables to become inconsistent:

| Provider | Configure | Register this Web callback | Login-page result |
|---|---|---|---|
| Google | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` | `<APP_URL>/auth/callback/google` | Google button appears only when both values are non-empty |
| Microsoft | `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`; optional `MICROSOFT_TENANT_ID` | `<APP_URL>/auth/callback/microsoft` | Microsoft button appears only when both values and a valid tenant selector are present |

Configure either row or both. Every provider also requires a valid `APP_URL`
and a strong `SESSION_SECRET`; when either shared prerequisite or a provider's
own row is incomplete, that provider is hidden instead of rendering a dead
button. With no ready provider, the login page shows an operator configuration
notice.

For local development, put the chosen values in the ignored
`apps/web/.dev.vars`. For Cloudflare Pages, keep `APP_URL` and
`MICROSOFT_TENANT_ID` in deployment variables and add credentials through the
secret store, for example:

```sh
pnpm exec wrangler pages secret put GOOGLE_CLIENT_ID --project-name cmail-web
pnpm exec wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name cmail-web
pnpm exec wrangler pages secret put MICROSOFT_CLIENT_ID --project-name cmail-web
pnpm exec wrangler pages secret put MICROSOFT_CLIENT_SECRET --project-name cmail-web
```

Restart local development after changing `.dev.vars`; redeploy Pages after
changing production variables or secrets. cmail requests only the OpenID
Connect `openid email profile` scopes and uses the resulting access token to
call the provider's UserInfo endpoint. Google uses
`https://openidconnect.googleapis.com/v1/userinfo`; Microsoft uses
`https://graph.microsoft.com/oidc/userinfo`. Google and Microsoft accounts are
bound by the provider plus UserInfo `sub`, not by email, UPN, or an ID-token
claim.

A manager must create and invite each ordinary user. Invitation links use
`<APP_URL>/enroll/google#token=...` or
`<APP_URL>/enroll/microsoft#token=...`. A URL fragment is not included in the
HTTP request, referrer, or server logs. The first-party page removes it from
browser history before posting it to the same origin; the route then validates the
72-hour, single-use token and keeps the
pending enrolment in a 15-minute `HttpOnly`, `SameSite=Lax` cookie. The cookie
is `Secure` on production HTTPS. Binding additionally requires the invited
email from access-token-backed UserInfo: Google must return
`email_verified=true`; Microsoft must return its non-empty OIDC UserInfo
`email` claim (Microsoft UserInfo does not expose `email_verified`). After enrolment,
returning sign-in resolves only the stored provider and immutable subject; a
matching email alone can never select or take over an account. Creating a
person without sending the invitation leaves that person pending and
unbound—use **Resend invitation** in Management before they attempt sign-in.
Resending revokes the previous link.

See [configuration](docs/configuration.md) for the complete reference.

#### Optional browser notifications

Web Push is disabled unless a complete VAPID public key, private key, and
subject are configured. Generate one key pair:

```sh
pnpm push:keys
```

Use the same `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` for
the Pages application and inbound email Worker. Keep the private key in each
runtime's secret store; the public key and subject belong in their respective
Wrangler `[vars]`. Users must still opt in with an explicit gesture and approve
the browser permission. Production Web Push requires the app to run on HTTPS;
localhost remains suitable for development. Notification payloads deliberately say only that new
mail arrived—they do not include sender, subject, mailbox, or message content.

See [configuration](docs/configuration.md#optional-web-push) for commands,
endpoint allowlisting, and rotation guidance.

### 4. Configure mail flow

Sender limiting is enabled by default and fails closed without its independent
Worker-only HMAC key. Generate 32 bytes, then paste the unpadded base64url value
when Wrangler prompts:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
pnpm exec wrangler secret put INBOUND_SENDER_HASH_KEY --config apps/email-worker/wrangler.toml
```

Do this before enabling routing. Never add the value to a Wrangler file or the
repository. Review `MAX_INBOUND_DECODED_BODY_BYTES`, the three inbound hourly
limits, and the shared `MAILBOX_STORAGE_QUOTA_BYTES` in the committed templates;
the web app uses that same storage quota for Sent/internal copies and drafts.

In Cloudflare Email Routing, create routing rules for the mail domain and direct inbound messages to the cmail email Worker. The Worker accepts only active mailbox rows in D1. Unknown, disabled, and offboarded personal addresses receive the same generic SMTP-time rejection; cmail does not disclose whether an address once existed. The sending mail system normally generates any non-delivery report to its sender. cmail never sends a branded follow-up or auto-reply for these rejected attempts, so this protection consumes no cmail outbound quota and cannot be amplified into backscatter during abuse. Email Routing remains the inbound path regardless of which outbound provider you select.

For external outbound delivery, verify the sending domain and sender required
by your chosen provider. Follow [Email authentication and sender
requirements](docs/email-authentication.md) to publish and verify current SPF,
DKIM, and DMARC records, stage enforcement, and check receiver policy. Do not
copy DNS records from an unrelated deployment.

The quickest supported Cloudflare setup is: use a Workers Paid account, onboard
the sending domain under **Compute → Email Service → Email Sending**, keep the
committed email Worker's `[[send_email]]` binding and the Pages application's
private `EMAIL_SERVICE` service binding, then deploy the email Worker before the
web application. This default path needs no outbound API token and retains the
opaque Cloudflare tracking ID for trace and lifecycle reconciliation. Cloudflare
separately controls the wire `Message-ID`; the native binding does not expose
that header. Existing reply ancestry remains standards-compatible, but the first
external reply to a brand-new native-binding conversation may not join its local
Sent thread automatically.
Email Sending is currently public beta on the Workers Paid plan and limits
general sends to 50 combined recipients and 5 MiB including attachments. Review Cloudflare's
[sending setup](https://developers.cloudflare.com/email-service/get-started/send-emails/),
[limits](https://developers.cloudflare.com/email-service/platform/limits/), and
[Email preview](https://developers.cloudflare.com/email-service/observability/logs/#message-preview)
before production use. Preview can retain rendered bodies, headers,
attachments, and raw message source for about seven days and is enabled by
default for new sending domains; disable it when that content retention is not
appropriate for your organisation.

For local development without a service binding, the REST fallback can be
enabled with `CLOUDFLARE_ACCOUNT_ID` and a narrowly scoped
`CLOUDFLARE_EMAIL_API_TOKEN`. Cloudflare's REST API reference includes the
authoritative RFC-style `result.message_id`; cmail validates and uses it when
present and never fabricates one. When those REST credentials are available,
mixed local/external messages use one raw-MIME call so the external SMTP
envelope can differ from the complete visible To/Cc headers while local delivery
remains synchronous. Without REST credentials, native Cloudflare and Postmark
use one all-recipient provider submission; local recipients return through the
normal Email Routing path. See [Outbound delivery](docs/configuration.md#outbound-delivery)
for the trade-offs and verification steps.

### 5. Deploy

```sh
pnpm deploy:email-worker
pnpm deploy:web
```

Or deploy both:

```sh
pnpm deploy
```

Deployment does not create Email Routing rules, OAuth registrations, provider accounts, or DNS records. Complete those steps in the relevant provider consoles.

### 6. Bootstrap the first manager

Bootstrap requires two temporary Pages secrets: the exact expected UserInfo
email for the initial manager and a strong, independently generated one-time
token. Generate the token locally, store both values, and redeploy:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
pnpm exec wrangler pages secret put BOOTSTRAP_ADMIN_EMAIL --project-name cmail-web
pnpm exec wrangler pages secret put BOOTSTRAP_ADMIN_TOKEN --project-name cmail-web
pnpm deploy:web
```

Open `<APP_URL>/bootstrap` directly over HTTPS and submit the token in the
first-run form. The same-origin POST exchanges it for a signed
`cmail_bootstrap_proof` cookie valid for 10 minutes. The cookie is `HttpOnly`,
`SameSite=Lax`, and `Secure` on production HTTPS; the token and proof never
enter a URL or log. Do not put the token in an invitation, command argument,
screenshot, or issue. Complete sign-in with the provider account whose accepted
UserInfo email exactly matches `BOOTSTRAP_ADMIN_EMAIL`: Google must return
`email_verified=true`; Microsoft must return its non-empty access-token-backed
OIDC UserInfo `email` claim. Then verify the manager and mailbox.

Delete both bootstrap secrets immediately and redeploy:

```sh
pnpm exec wrangler pages secret delete BOOTSTRAP_ADMIN_TOKEN --project-name cmail-web
pnpm exec wrangler pages secret delete BOOTSTRAP_ADMIN_EMAIL --project-name cmail-web
pnpm deploy:web
```

If bootstrap fails or either value may have been exposed, rotate the token and
start again from a clean browser session. Do not leave either bootstrap value
enabled as standing configuration.

## Development commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the web development server |
| `pnpm dev:worker` | Start the email Worker development process |
| `pnpm lint` | Run workspace lint checks |
| `pnpm check` | Run Svelte and TypeScript checks |
| `pnpm test` | Run workspace tests |
| `pnpm build` | Build the web application |
| `pnpm db:migrate:local` | Apply pending migrations to local D1 |
| `pnpm db:migrate:verify` | Apply and inspect all migrations in a fresh temporary D1 |
| `pnpm push:keys` | Generate a VAPID key pair for optional browser notifications |
| `pnpm secrets:scan` | Scan tracked and untracked source files for likely credentials |
| `pnpm secrets:history` | Scan every reachable Git object without printing secret values |
| `pnpm deploy` | Deploy the web application and email Worker |
| `pnpm validate` | Run the secret scan, lint, type checks, tests, migration verification, build, and dependency audit |
| `pnpm release:check` | Run validation plus the Git-history secret gate before publication |

Automated tests and CI cover authentication, configuration, sessions, invitation enrolment,
compose guardrails, inbound parsing, retention, rate limits, and validation.
Identity-provider, DNS, and live delivery integrations still need end-to-end
testing in your own staging environment. Run `pnpm release:check` and manually
test every affected mail flow before a production release.

## Documentation

- [Documentation home](docs/README.md)
- [User guide](docs/user-guide.md)
- [Mobile app and notification guide](docs/mobile-pwa.md)
- [Shared mailboxes](docs/shared-mailboxes.md)
- [Manager handbook](docs/manager-handbook.md)
- [Support and service-management process](docs/support-process.md)
- [ISO and ITIL alignment map](docs/standards-alignment.md)
- [Security, privacy, and assurance](docs/assurance.md)
- [Architecture and trust boundaries](docs/architecture.md)
- [Getting started](docs/getting-started.md)
- [Configuration reference](docs/configuration.md)
- [Branding and first customisation](docs/branding.md)
- [Downstream and private implementations](docs/downstream-implementations.md)
- [Deployment and verification](docs/deployment.md)
- [Operations checklist](docs/operations-checklist.md)
- [Security checklist](docs/security-checklist.md)
- [Acceptable-use policy template](docs/acceptable-use-policy-template.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Roadmap](ROADMAP.md)
- [Maintainer release guide](docs/maintainer-guide.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## Contributing

Issues and pull requests are welcome. Keep deployments, credentials, customer information, and organisation-specific material out of contributions. Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md).

## License

cmail is available under the [MIT License](LICENSE). If it helps your organisation, consider contributing fixes, documentation, testing, or support back to the community.
