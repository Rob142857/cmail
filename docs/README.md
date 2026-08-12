# cmail documentation

Use this page as the documentation entry point. cmail is pre-1.0 software, so
operators should read the deployment and security material before directing
real mail to it.

## Use cmail

- [User guide](user-guide.md) — first sign-in, navigation, reading, composing,
  folders, safety, and support.
- [Mobile app and notification guide](mobile-pwa.md) — installation and Web
  Push on iPhone, iPad, and Android, including permission troubleshooting.
- [Shared mailboxes](shared-mailboxes.md) — delegation, Send as, Full access,
  shared folders and read state, lifecycle, and product boundaries.
- [Email signatures](signatures.md) — personal sign-offs, optional
  organisation footers, Manager locking, message ordering, and safe formatting.
- [Manager handbook](manager-handbook.md) — People, Mailboxes, Organisation,
  Usage policy, Mail trace, Audit log, Settings, and safe operations.

## Deploy cmail

1. Read [Getting started](getting-started.md) to choose resource names, install
   dependencies, create Cloudflare storage, and start local development.
2. Use the [Configuration reference](configuration.md) to set the deployment
   origin, mail domain, OAuth providers, safety limits, and organisation
   defaults.
3. Read [Email authentication and sender requirements](email-authentication.md)
   before changing mail DNS or enabling external delivery.
4. Review [Architecture and trust boundaries](architecture.md) before changing
   authentication, authorization, mail flow, public data, or storage.
5. Follow [Deployment and verification](deployment.md) for the production
   sequence, including identity providers, DNS, bootstrap, and controlled mail
   tests.
6. Complete the [Security checklist](security-checklist.md) and
   [Operations checklist](operations-checklist.md) for every environment.

## Customisation and governance

- [Branding and first customisation](branding.md)
- [Downstream and private implementations](downstream-implementations.md) —
  keep proprietary deployment work separate while tracking public cmail.
- [Acceptable-use policy template](acceptable-use-policy-template.md)
- [Project roadmap](../ROADMAP.md)
- [Maintainer release guide](maintainer-guide.md)
- [Contributing](../CONTRIBUTING.md)
- [Support](../SUPPORT.md)
- [Security policy](../SECURITY.md)
- [Code of Conduct](../CODE_OF_CONDUCT.md)

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

The [README](../README.md#quick-start) contains the shortest deployment path;
these guides provide the operational and security context behind it.
