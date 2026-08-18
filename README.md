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
> **The button starts a guided import, not a one-click production deployment.**
> cmail is a Cloudflare Pages application plus a separate email Worker in one
> pnpm monorepo, and Cloudflare's button only supports single-Worker apps. Use
> it to import the repository, then complete the resource, secret, DNS,
> routing, and bootstrap steps in [Deployment and
> verification](docs/deployment.md#guided-repository-import).
> Forks and private downstream repositories must replace the button's `url=`
> value with their own repository — otherwise it always imports
> `Rob142857/cmail`.

cmail is open-source email for organisations that want personal and shared
mailboxes on a domain they control. It combines a SvelteKit web application
with Cloudflare Email Routing, Workers, D1 (Cloudflare's hosted database), and
R2 (Cloudflare's object storage). Outbound mail uses Cloudflare Email Service
by default, with Postmark as an alternative.

> [!IMPORTANT]
> cmail is pre-1.0 software. Review the code and threat model for your environment, test recovery procedures, and complete the [security checklist](docs/security-checklist.md) before handling sensitive or production mail.

## Key features

- **Portable by default** — domain, organisation, branding, identity
  providers, safety limits, and deployment resources are configuration, not
  forks.
- **Fail-closed sign-in** — Google and Microsoft OpenID Connect, each shown
  only once fully configured; new users enrol through a manager-issued
  invitation, and returning users resolve only by their immutable provider
  subject.
- **Personal and shared mailboxes** — read, send-as, and full delegation, plus
  internal delivery between cmail mailboxes.
- **Full mail flow** — inbound via Cloudflare Email Routing; external outbound
  via Cloudflare Email Service or Postmark; autosaved drafts, attachments,
  reply/reply all/forward, message importance, standards-compatible
  threading, search, bulk actions, and folders.
- **Durable outbound journaling** — prevents a message from resending while
  recovering any missing Sent or internal copy.
- **Signatures** — personal, with safe rich formatting, optional organisation
  signatures or disclaimers, and manager-controlled locking.
- **Manager tools** — users, mailboxes, organisation structure, policy
  versions, audit records, and mail trace.
- **Optional organisation directory** — configurable layers, units, roles,
  and positions.
- **Privacy-first public directory** — only an explicitly public position's
  name, title, and work email can ever be exposed.
- **Policy acknowledgement** — required before mailbox access whenever a
  policy is published.
- **Optional browser notifications** — user-enabled, with privacy-minimised
  new-mail copy only.
- **Responsive, installable PWA** — works on desktop and mobile browsers.

cmail is an application, not a hosted service: your organisation owns its
Cloudflare account, identity-provider configuration, outbound provider, DNS,
backups, monitoring, privacy obligations, and provider charges. Check each
provider's current terms before deploying.

cmail is not a bulk-marketing or campaign platform — it has no consent, list,
RFC 8058 one-click unsubscribe, complaint, or deliverability controls for that
use. See [Email authentication and sender requirements](docs/email-authentication.md)
before enabling external mail flow.

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

Prerequisites:

- Node.js 22 or newer, and pnpm 11 or newer
- A Cloudflare account with a domain on Cloudflare DNS
- A Google OAuth client, a Microsoft Entra application, or both
- Cloudflare Email Service (recommended) or Postmark, if you need external
  outbound mail

```sh
git clone https://github.com/Rob142857/cmail.git
cd cmail
pnpm install
pnpm setup
```

`pnpm setup` copies the committed Wrangler templates into local
`wrangler.toml` files and creates `.dev.vars` files with a fresh
development-only key. Replace every placeholder with your own values — local
Wrangler files and `.dev.vars` can hold tenant data or secrets and must never
be committed.

Follow [Getting started](docs/getting-started.md) for the rest: creating D1
and R2 storage, configuring OAuth and mail flow, and bootstrapping the first
manager locally.

## Deploy to production

Follow [Deployment and verification](docs/deployment.md) for the full
sequence — provisioning Cloudflare resources, identity providers, outbound
mail, deployment, inbound routing, and bootstrapping the first manager. Use
the [Configuration reference](docs/configuration.md) for every setting along
the way.

## Standards and assurance

cmail maps to ISO 27001, ISO 20000-1, ISO 27701, and related standards, and to
ITIL service-management practices. See the [ISO and ITIL alignment
map](docs/standards-alignment.md) for the detail, and [Security, privacy, and
assurance](docs/assurance.md) for the control matrix, limitations, and a
deployment evidence checklist. None of this is a certification or legal
opinion — your organisation still owns compliance for its own deployment.

## Documentation and contributing

- Full documentation index: [docs/README.md](docs/README.md)
- To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a
  change
- Report vulnerabilities through the private process in
  [SECURITY.md](SECURITY.md)
- For help, see [SUPPORT.md](SUPPORT.md)

## License

cmail is available under the [MIT License](LICENSE). If it helps your
organisation, consider contributing fixes, documentation, testing, or support
back to the community.
