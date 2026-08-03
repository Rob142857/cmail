# Downstream and private implementations

Use the public cmail repository as the reusable product and keep
organisation-specific work in a separate private repository. GitHub
repositories have one
visibility setting: a branch in a public repository is public too. Do not put a
proprietary implementation on a "private branch" of public `cmail`.

## Choose a downstream model

Use a **private downstream repository** when you need to change application
code. Start it from cmail, preserve the public repository as a read-only
`upstream` remote, and use the private repository as `origin`:

```sh
git clone https://github.com/Rob142857/cmail.git cmail-private
cd cmail-private
git remote rename origin upstream
git remote add origin git@github.com:YOUR-ORG/cmail-private.git
git remote set-url --push upstream no_push
git push -u origin main
```

Create `YOUR-ORG/cmail-private` as a new private repository—not as a standard
GitHub fork of the public repository—before the final command. If an enterprise
GitHub policy offers isolated private forks, verify that policy before relying
on it. The deliberately invalid `upstream` push URL is a local guard against
publishing a private commit by mistake; fetching still uses the public URL.

Use a **thin private overlay** when the application itself does not need to
diverge. The private repository can pin a cmail tag or commit and hold only:

- infrastructure-as-code and deployment automation;
- organisation-owned brand assets and configuration-rendering scripts;
- the names of secrets expected by CI, never their values; and
- a small, reviewed patch series if configuration is not sufficient.

An overlay pipeline checks out the pinned public revision, applies its assets or
patches, generates deployment configuration from cmail's examples, validates
the combined tree, and deploys it. Prefer ordinary upstream contributions for
generally useful changes; this keeps the private layer small and upgrades
predictable.

## Bring in upstream releases

Integrate public changes on a temporary branch and prove them in a
non-production environment before updating the private main branch:

```sh
git fetch upstream --tags
git switch -c integrate-cmail-update main
git rebase upstream/main
pnpm install --frozen-lockfile
pnpm release:check
```

Resolve conflicts in private customisations, then test OAuth, inbound and
outbound delivery, shared-mailbox permissions, attachments, notification
opt-in, migration and recovery behavior in staging. Only merge and deploy after
those checks pass. Pinning a published tag or reviewed commit instead of moving
`main` is preferable for production overlays.

## Configure rather than fork

Run `pnpm setup` in each checkout to copy committed examples to ignored local
files. Treat `.env.example`, `apps/web/wrangler.toml.example`, and
`apps/email-worker/wrangler.toml.example` as the public contract; do not replace
their placeholders with deployment values.

The normal customisation surface is configuration:

| Concern | Configuration |
|---|---|
| Domain and origin | `MAIL_DOMAIN`, `APP_URL` |
| Product and organisation | `APP_NAME`, `ORG_NAME`, `ORG_SHORT_NAME`, `ORG_URL`, `SUPPORT_EMAIL`, `LANDING_URL`, `POLICY_URL` |
| Mail identity | `SYSTEM_EMAIL`, `SYSTEM_FROM_NAME` |
| Brand assets and colour | `BRAND_LOGO_URL`, `BRAND_ICON_URL`, `BRAND_ICON_192_URL`, `BRAND_ICON_512_URL`, `BRAND_OG_IMAGE_URL`, `BRAND_PRIMARY_COLOR` |
| Region | `LOCALE`, `TIME_ZONE` |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Microsoft sign-in | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` |
| Temporary first-manager bootstrap | `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_TOKEN` |
| External delivery | `OUTBOUND_PROVIDER`; Cloudflare uses `CLOUDFLARE_ACCOUNT_ID` plus `CLOUDFLARE_EMAIL_API_TOKEN`, while Postmark uses `POSTMARK_API_KEY` |
| Browser notifications | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_ENDPOINT_HOSTS` |

Google and Microsoft controls appear only when that provider's complete
configuration and the shared session prerequisites are valid. Keep `APP_URL`
at deployment level because it defines OAuth callbacks plus first-party
enrolment links. Managers can change supported organisation settings in the
app; those D1 values override the environment defaults for that deployment.

Use an independent OAuth registration for each environment. cmail requests
`openid email profile`, calls UserInfo with the access token, and binds users by
provider plus immutable `sub`. A pending user enrols only through a hashed,
single-use manager invitation plus a matching UserInfo email (Google with
`email_verified=true`; Microsoft with its non-empty OIDC UserInfo `email` claim); there is no
portable setting that enables email-only account lookup. Do not patch around
that boundary in an organisation overlay.

## Isolate every environment

Give development, staging, and production distinct Cloudflare resources and
credentials. For example, use names such as `cmail-web-staging`,
`cmail-email-worker-staging`, `cmail-db-staging`, and
`cmail-storage-staging`, with corresponding `-production` resources. Never
point a development process at production D1 or R2.

Generate each environment's ignored Wrangler files from the committed examples
and set its own resource names, D1 ID, public variables, and OAuth origin.
Configure both applications with the same environment-specific D1 database and
R2 bucket. Keep production configuration in the deployment platform or a
private infrastructure repository; do not edit and commit the public examples.

Store sensitive values with Cloudflare, not in Wrangler `[vars]` or source. For
example:

```sh
pnpm exec wrangler pages secret put SESSION_SECRET --project-name cmail-web-staging
pnpm exec wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name cmail-web-staging
pnpm exec wrangler pages secret put MICROSOFT_CLIENT_SECRET --project-name cmail-web-staging
pnpm exec wrangler pages secret put CLOUDFLARE_EMAIL_API_TOKEN --project-name cmail-web-staging
pnpm exec wrangler pages secret put BOOTSTRAP_ADMIN_EMAIL --project-name cmail-web-staging
pnpm exec wrangler pages secret put BOOTSTRAP_ADMIN_TOKEN --project-name cmail-web-staging
pnpm exec wrangler secret put VAPID_PRIVATE_KEY --config apps/email-worker/wrangler.toml
```

Wrangler prompts for each value. The inbound Worker needs the VAPID private key
only when Web Push is enabled; it does not need OAuth, session, or outbound
provider secrets. Delete both `BOOTSTRAP_ADMIN_EMAIL` and
`BOOTSTRAP_ADMIN_TOKEN` immediately after the first manager has signed in and
been verified. Use independent bootstrap tokens, session secrets, OAuth
clients, outbound credentials, and VAPID pairs so environments cannot admit or
authenticate one another's identities. Invitations also belong to the issuing
environment's `APP_URL`; never rewrite or forward a staging invitation into
production.

Cloudflare Email Service uses the REST API from cmail's Pages runtime. Keep its
account ID in environment-specific deployment variables and scope its token to
the intended account with **Email Sending: Edit**. A native `send_email` binding
requires a separate Worker reached through a Pages service binding or a future
move of the web runtime to Workers; do not add it directly to the Pages template.
Review Cloudflare Email preview separately in every environment because new
sending domains enable about seven days of message-content preview by default.

## Release gate

Before a private build or public contribution:

```sh
pnpm release:check
git diff --check
```

Also review `git status --ignored`, the proposed diff, generated assets, and CI
logs. Deploy to staging, apply migrations there, exercise real provider flows,
and verify backup and rollback procedures before production. `release:check`
scans source and reachable Git history, but it cannot prove that screenshots,
external CI artifacts, or another repository are clean.

Never commit or attach any of the following to an issue or pull request:

- session secrets, OAuth client secrets, API tokens, provider keys, private
  VAPID keys, signing keys, certificates, or recovery codes;
- `.dev.vars`, populated `.env` files, local `wrangler.toml` files, Cloudflare
  credentials, or CI secret exports;
- tenant resource IDs, private DNS or domain configuration, production
  addresses, bootstrap identities, or customer-specific policy material;
- D1/R2 exports, database snapshots, message bodies, attachments, production
  logs, support bundles, or screenshots containing account or personal data.

If a secret or private datum enters Git, assume it is exposed: revoke or rotate
it first, then remove it from every reachable object before publishing. A later
deletion commit does not erase Git history.

See the [configuration reference](configuration.md), [deployment guide](deployment.md),
[security checklist](security-checklist.md), and [maintainer release guide](maintainer-guide.md)
for the complete operational controls.

[← Documentation home](README.md)
