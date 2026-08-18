# cmail documentation

This page is the map for all cmail documentation. cmail is pre-1.0 software: operators should read the deployment and security guides before sending real mail through it.

## Use cmail

- [User guide](user-guide.md) — for anyone reading and sending mail. First sign-in, navigation, reading, composing, folders, safety, and support.
- [Mobile app and notifications](mobile-pwa.md) — for anyone on iPhone, iPad, or Android. Installing cmail and turning on new-mail alerts, plus troubleshooting.
- [Push notification reliability blueprint](push-notification-reliability.md) — for engineers planning ahead. A design, not yet built, for a more durable notification pipeline.
- [Mail client connectivity architecture](mail-client-connectivity.md) — for anyone asking "can I use Outlook or Gmail instead?". The current PWA-only boundary and the staged plan for JMAP and optional IMAP support.
- [Shared mailboxes](shared-mailboxes.md) — for anyone using a team address. Delegation, Send as, Full access, shared folders and read state, and lifecycle.
- [Email signatures](signatures.md) — for anyone who sends mail, and for Managers. Personal sign-offs, the optional organisation footer, locking, and safe formatting.
- [Manager handbook](manager-handbook.md) — for the Manager role. People, Mailboxes, Organisation, Usage policy, Mail trace, Audit log, Settings, and safe operating practice.
- [Spam and quarantine](spam-and-quarantine.md) — for anyone whose mail lands in Spam, and for Managers. How scoring works, what quarantine means, releasing your own mail, and organisation-wide sender allow/block rules.
- [Support process](support-process.md) — for Managers and internal support staff. L1 triage, safe evidence handling, and when to escalate to RME Solutions Technology.

## Deploy cmail

For engineers and operators setting up a deployment, roughly in this order:

1. [Getting started](getting-started.md) — choose resource names, install dependencies, create Cloudflare storage, and start local development.
2. [Configuration reference](configuration.md) — set the deployment origin, mail domain, OAuth providers, safety limits, and organisation defaults.
3. [Email authentication and sender requirements](email-authentication.md) — read before changing mail DNS or enabling external delivery.
4. [Architecture and trust boundaries](architecture.md) — read before changing authentication, authorisation, mail flow, public data, or storage.
5. [Deployment and verification](deployment.md) — the production sequence, including identity providers, DNS, bootstrap, and controlled mail tests.
6. [Security checklist](security-checklist.md) and [Operations checklist](operations-checklist.md) — complete both for every environment.

## Customisation and governance

- [Security, privacy, and assurance](assurance.md) — for managers, reviewers, and auditors. The public responsibility boundary, control matrix, limitations, and a deployment evidence checklist.
- [ISO and ITIL alignment](standards-alignment.md) — for compliance reviewers. Applicable standards, current editions, service-management practices, and the evidence an operator or support provider must establish.
- [Privacy and data-handling guide](privacy-and-data-handling.md) — for operators and privacy reviewers. Data inventory, provider boundary, public-directory, retention, rights, and a privacy-notice checklist.
- [Branding and first customisation](branding.md) — for whoever brands the deployment.
- [Downstream and private implementations](downstream-implementations.md) — for teams maintaining a private fork. Keeping proprietary work separate while tracking public cmail.
- [Acceptable-use policy template](acceptable-use-policy-template.md) — for Managers publishing a usage policy. A starting point to adapt and have reviewed.
- [Project roadmap](../ROADMAP.md) — where cmail is headed.
- [Maintainer release guide](maintainer-guide.md) — for maintainers cutting a release.
- [Contributing](../CONTRIBUTING.md), [Support](../SUPPORT.md), [Security policy](../SECURITY.md), [Code of Conduct](../CODE_OF_CONDUCT.md) — standard project files, for contributors.

## Command reference

Run commands from the repository root:

| Command | Use |
|---|---|
| `pnpm setup` | Create ignored local configuration from committed templates |
| `pnpm dev` | Start the SvelteKit development server |
| `pnpm db:migrate:local` | Apply migrations to isolated local D1 state |
| `pnpm db:migrate:preview` | Apply migrations to the explicitly isolated preview D1 database |
| `pnpm config:check` | Verify committed and active Wrangler bindings remain isolated and fail closed |
| `pnpm deploy:email-worker:preview` | Deploy the isolated, non-sending preview email Worker |
| `pnpm push:keys` | Generate a VAPID pair for optional browser notifications |
| `pnpm validate` | Run source, lint, type, test, migration, build, and dependency checks |
| `pnpm release:check` | Run validation plus the reachable Git-history secret gate |

The [README](../README.md#quick-start) has the shortest deployment path. These guides give the operational and security context behind it.
