# Getting started

This guide takes a new cmail deployment from an empty Cloudflare account to local development. See [deployment.md](deployment.md) for the production rollout.

## Prerequisites

- Node.js 22 or newer and Corepack-enabled pnpm 11
- Git
- A Cloudflare account and a domain using Cloudflare DNS
- A Google OAuth client, Microsoft Entra application, or both
- Cloudflare Email Service (recommended) or Postmark only when external outbound delivery is required

Provider account setup changes over time. Use this guide for cmail's expected
values, but confirm the exact steps in each provider's own current
documentation.

## Decide the deployment shape

Choose these values before creating resources:

| Setting | Example | Purpose |
|---|---|---|
| Pages project | `cmail-web` | Hosts the SvelteKit application |
| Worker name | `cmail-email-worker` | Receives Email Routing events and privately submits native Cloudflare outbound mail |
| D1 database | `cmail-db` | Stores users, mailbox metadata, messages, audit, and trace data |
| R2 bucket | `cmail-storage` | Stores message bodies and attachments |
| `APP_URL` | `https://mail.example.org` | Public origin and OAuth callback base |
| `MAIL_DOMAIN` | `example.org` | Domain used for mailbox addresses |
| `OUTBOUND_PROVIDER` | `cloudflare` | Selects Cloudflare Email Service; `postmark`, `auto`, and non-sending `none` are alternatives |

`APP_URL` and `MAIL_DOMAIN` can be different hostnames. OAuth callbacks always use `APP_URL`; email addresses use `MAIL_DOMAIN`.

## Install

```sh
git clone https://github.com/Rob142857/cmail.git
cd cmail
pnpm install
pnpm setup
```

The setup script copies each `wrangler.toml.example` to `wrangler.toml`, and
creates `apps/web/.dev.vars` and `apps/email-worker/.dev.vars` (with a fresh,
development-only `INBOUND_SENDER_HASH_KEY`) if they don't already exist. This
secret is never printed. Keep all generated configuration local.

## Create Cloudflare resources

Use the workspace's pinned Wrangler version:

```sh
pnpm exec wrangler login
pnpm d1:create
pnpm r2:create
```

Paste the returned D1 ID into both generated Wrangler files. Both apps share
the `DB` and `STORAGE` bindings. Pages also uses the `EMAIL_SERVICE` binding,
and the Worker owns the native `EMAIL` send binding — keep all four binding
names unless you also update the application code that references them.

## Create local secret configuration

Edit the ignored `apps/web/.dev.vars` file (created by `pnpm setup`) with
development-only OAuth credentials. Set:

- `APP_URL` to the origin printed by the local dev server;
- `MAIL_DOMAIN` to a test domain, or one reserved for this deployment;
- a unique `SESSION_SECRET`;
- one complete OAuth provider configuration; and
- a development-only `BOOTSTRAP_ADMIN_EMAIL` and strong `BOOTSTRAP_ADMIN_TOKEN`,
  for the first manager.

Generate a session secret with Node.js:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not commit the output.

Outbound delivery is optional for local setup. The default,
`OUTBOUND_PROVIDER=cloudflare`, is recommended. Use `none` for a deliberately
non-sending local or preview environment, `postmark` for that alternative, or
`auto` to pick the first complete configuration (Cloudflare, then Postmark).
If you set a provider explicitly but its configuration is incomplete, it
fails closed rather than sending anyway. Production needs no outbound API
token — it uses the Worker's native `EMAIL` binding plus the Pages app's
private `EMAIL_SERVICE` binding. To test the REST fallback locally instead,
put `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_API_TOKEN` only in the
ignored `.dev.vars`.

Sender limiting is on by default, so the generated Worker key is required for
local inbound processing — deleting or corrupting it makes the Worker fail
closed and reject mail with a generic, permanent SMTP error. Production needs
its own, different 32-byte key in the Worker secret store. Never reuse
session, OAuth, VAPID, or provider secrets across environments.

## Initialise local storage

Apply the versioned migrations to Wrangler's isolated local D1 state:

```sh
pnpm db:migrate:local
pnpm dev
```

`--local` never touches the remote D1 database. Apply the same, reviewed
migrations remotely during deployment with `pnpm db:migrate`.

## Register OAuth callbacks

For each enabled provider, register exactly one callback per environment:

```text
<APP_URL>/auth/callback/google
<APP_URL>/auth/callback/microsoft
```

OAuth providers reject a callback that doesn't match exactly, including the
scheme, hostname, port, path, and sometimes a trailing slash.

For Microsoft sign-in, `MICROSOFT_TENANT_ID=common` works for both Microsoft
365 and personal Outlook/Hotmail/Live accounts, but your app registration
must support both account types. Use a tenant GUID instead if only one Entra
tenant should be allowed.

Both providers use only the `openid email profile` scope. cmail calls
UserInfo with the access token (Microsoft's endpoint is
`https://graph.microsoft.com/oidc/userinfo`), and stores the provider plus
its permanent `sub` ID as the account's real identity — not email, UPN, or
ID-token claims.

A third sign-in method, an invitation-scoped email one-time code for
invitees hosted by neither Google nor Microsoft, needs no callback
registration and is on by default. Set `EMAIL_OTP_ENABLED=false` in
`.dev.vars` to turn it off locally, or add `TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET_KEY` to try the optional bot check on its request form.
See [Email one-time-code sign-in](configuration.md#email-one-time-code-sign-in).

Except for the first manager, first sign-in starts from a manager-generated
link: `<APP_URL>/enroll/google#token=...` or
`<APP_URL>/enroll/microsoft#token=...`. The `#token=...` fragment never
reaches the server — not in the HTTP request, referrer, or logs — and the
page clears it from browser history before submitting. The token is stored
hashed, single-use, and expires after 72 hours; a valid one is exchanged for
a 15-minute, `HttpOnly`, `SameSite=Lax` enrolment cookie. Google must then
return a verified UserInfo email (`email_verified=true`) that matches;
Microsoft must return a matching, non-empty email, since its UserInfo does
not expose that verified flag. Resending an invitation rotates the token and
revokes the old link.

## Bootstrap local administration

Start the app, open `<APP_URL>/bootstrap` directly, and submit the
development-only bootstrap token through the form — never append it to a
URL. This creates a signed `cmail_bootstrap_proof` cookie, valid for 10
minutes, before you sign in with a provider. Use the provider identity whose
verified email exactly matches `BOOTSTRAP_ADMIN_EMAIL`.

Once the manager account exists, remove both bootstrap values from
`apps/web/.dev.vars` and restart the local server. If a token is exposed, or
you hit a conflict, generate a new token, clear your browser state, and
start again — never weaken the email or identity checks.

## Optional browser notifications

Notifications aren't required for mail to work. To offer the opt-in control,
generate one VAPID pair with `pnpm push:keys`, then set the same public key,
private key, and subject on both the Pages application and the inbound email
Worker. Store each private-key copy as a secret. See
[Optional Web Push](configuration.md#optional-web-push) for the full setup.

Configuration alone does not grant browser permission — each user must turn
on notifications in the app and approve the browser prompt themselves.

## Optional external outbound delivery

Cloudflare Email Service is the recommended option (Email Sending is
currently public beta, on the Workers Paid plan). Use a domain on Cloudflare
DNS, onboard it under **Compute → Email Service → Email Sending**, deploy the
email Worker with its native `EMAIL` binding, then deploy Pages with the
private `EMAIL_SERVICE` binding. This path needs no outbound API token. Keep
test messages within 50 combined recipients and 5 MiB including attachments.

Check the sending domain's **Email preview** setting before using real
content. Cloudflare turns preview on by default for new sending domains, and
while it's on, the dashboard may keep rendered content, headers, attachments,
and raw source for about seven days. Turn it off if your data or privacy
policy doesn't allow that.

See [Outbound delivery](configuration.md#outbound-delivery) for provider
selection, binding setup, and mixed-recipient delivery. Email Routing is a
separate, inbound configuration — it does not change based on your outbound
choice.

Before enabling branch previews, create the isolated preview D1, R2, and
Worker resources described in
[Deployment and verification](deployment.md#isolate-preview-deployments). The
committed preview setup is non-sending by default, and must never inherit
production mail data, routing, or secrets.

## Start the applications

```sh
pnpm dev
```

To work on the email Worker's inbound and native-outbound paths separately:

```sh
pnpm dev:worker
```

A local HTTP dev server cannot reproduce Cloudflare Email Routing by itself —
test inbound delivery in an isolated Cloudflare environment before you enable
a production catch-all rule.

## First useful checks

Before moving to production:

1. Run `pnpm lint`, `pnpm check`, `pnpm test`, and `pnpm build`.
2. Confirm the sign-in page exposes only configured OAuth providers.
3. Bootstrap a manager through `/bootstrap`, then remove both bootstrap values.
4. Create a pending user without sending an invitation and confirm direct sign-in fails.
5. Use **Resend invitation**, enrol through the correct provider, and confirm the link cannot be reused.
6. Create a personal mailbox and shared mailbox.
7. Verify a user without an assignment cannot access the shared mailbox.
8. Exercise internal delivery, drafts, folder actions, and attachments.
9. Follow the full [deployment verification](deployment.md#verification).

Automated tests do not replace staging mail-flow checks — record your manual
results for this deployment.

[← Documentation home](README.md)
