# Getting started

This guide takes a new cmail deployment from an empty Cloudflare account to local development. Use [deployment.md](deployment.md) for the production rollout and verification sequence.

## Prerequisites

- Node.js 22 or newer and Corepack-enabled pnpm 11
- Git
- A Cloudflare account and a domain using Cloudflare DNS
- A Google OAuth client, Microsoft Entra application, or both
- Resend or Postmark only when external outbound delivery is required

Provider accounts and interfaces change over time. Use this guide for cmail's
expected values and confirm the account-side steps in each provider's current
official documentation.

## Decide the deployment shape

Choose these values before creating resources:

| Setting | Example | Purpose |
|---|---|---|
| Pages project | `cmail-web` | Hosts the SvelteKit application |
| Worker name | `cmail-email-worker` | Receives Cloudflare Email Routing events |
| D1 database | `cmail-db` | Stores users, mailbox metadata, messages, audit, and trace data |
| R2 bucket | `cmail-storage` | Stores message bodies and attachments |
| `APP_URL` | `https://mail.example.org` | Public origin and OAuth callback base |
| `MAIL_DOMAIN` | `example.org` | Domain used for mailbox addresses |

`APP_URL` and `MAIL_DOMAIN` can refer to different hostnames. OAuth callbacks always use `APP_URL`; email addresses use `MAIL_DOMAIN`.

## Install

```sh
git clone https://github.com/Rob142857/cmail.git
cd cmail
pnpm install
pnpm setup
```

The setup script copies each `wrangler.toml.example` file to `wrangler.toml`,
creates `apps/web/.dev.vars`, and creates `apps/email-worker/.dev.vars` with a
fresh development-only `INBOUND_SENDER_HASH_KEY` if the targets are absent.
The secret is never printed. Keep all generated configuration local.

## Create Cloudflare resources

Use the workspace's pinned Wrangler version:

```sh
pnpm exec wrangler login
pnpm d1:create
pnpm r2:create
```

Paste the returned D1 ID into both generated Wrangler files. The web
application and inbound Worker must share the same D1 database and R2 bucket.
The binding names must remain `DB` and `STORAGE` unless the application code is
updated with them.

## Create local secret configuration

Edit the ignored `apps/web/.dev.vars` created by `pnpm setup` and use development-only OAuth credentials. Set:

- `APP_URL` to the origin printed by the local development server;
- `MAIL_DOMAIN` to a test domain or domain reserved for this deployment;
- a unique `SESSION_SECRET`;
- one complete OAuth provider configuration; and
- a development-only `BOOTSTRAP_ADMIN_EMAIL` and strong
  `BOOTSTRAP_ADMIN_TOKEN` for the first manager.

Generate a session secret with Node.js:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not commit the output.

Sender limiting is enabled by default. The generated Worker key is therefore
required for local inbound processing; deleting or corrupting it makes the
Worker fail closed with a generic temporary SMTP rejection. Production needs a
different 32-byte key in the Worker secret store. Do not reuse session, OAuth,
VAPID, or provider secrets.

## Initialise local storage

Apply the versioned migrations to Wrangler's isolated local D1 state:

```sh
pnpm db:migrate:local
pnpm dev
```

`--local` does not modify the remote D1 database. Apply the same reviewed
migrations remotely during deployment with `pnpm db:migrate`.

## Register OAuth callbacks

For each enabled provider, register exactly one callback per environment:

```text
<APP_URL>/auth/callback/google
<APP_URL>/auth/callback/microsoft
```

OAuth providers reject callback mismatches, including differences in scheme, hostname, port, path, and sometimes trailing slash.

For Microsoft sign-in, `MICROSOFT_TENANT_ID=common` is the portable setting for
Microsoft 365 and personal Outlook, Hotmail, or Live identities, but the app
registration must support both organisational and personal Microsoft accounts.
Use a tenant GUID instead when only one Entra tenant should be accepted.

Both providers use only `openid email profile`. cmail calls UserInfo with the
access token—Microsoft uses `https://graph.microsoft.com/oidc/userinfo`—and
stores the provider plus immutable `sub` as the durable account identity. It
does not resolve returning users from email, UPN, or ID-token claims.

Except for the first manager, first sign-in starts from a manager-generated
`<APP_URL>/enroll/google#token=...` or
`<APP_URL>/enroll/microsoft#token=...` link. The fragment is excluded from the
HTTP request, referrer, and server logs, and the page removes it from browser
history before a same-origin POST. The hashed database token is single-use and
expires after 72 hours. Its first-party route replaces the raw token with a
15-minute `HttpOnly`, `SameSite=Lax` enrolment cookie. Google must then return
the matching UserInfo email with `email_verified=true`; Microsoft must return
the matching non-empty email from access-token-backed OIDC UserInfo, which does
not expose `email_verified`. Resending an invitation
rotates the token and revokes the old link.

## Bootstrap local administration

Start the app, open `<APP_URL>/bootstrap` directly, and submit the
development-only bootstrap token through the form. Do not append it to a URL.
The same-origin POST creates a signed `cmail_bootstrap_proof` cookie valid for
10 minutes before provider sign-in. Use the provider identity whose verified
email exactly matches `BOOTSTRAP_ADMIN_EMAIL`.

After the manager exists, remove both bootstrap values from
`apps/web/.dev.vars` and restart the local server. If a token is exposed or an
attempt conflicts, generate a new token, clear the browser state, and begin
again; do not weaken the email or identity checks.

## Optional browser notifications

Notifications are not required for mail flow. To make the opt-in control
available, generate one VAPID pair with `pnpm push:keys`, then configure the
same public key, private key, and subject for the Pages application and inbound
email Worker. Store each private-key copy as a secret. See
[Optional Web Push](configuration.md#optional-web-push) for the complete setup.

Configuration does not grant browser permission. Each user must enable
notifications through an explicit application gesture and approve the browser
prompt.

## Start the applications

```sh
pnpm dev
```

To work on the inbound Worker separately:

```sh
pnpm dev:worker
```

An HTTP development server cannot reproduce Cloudflare Email Routing by itself. Test inbound delivery in an isolated Cloudflare environment before enabling a production catch-all rule.

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

Automated tests do not replace staging mail-flow checks, so record manual results for your deployment.

[← Documentation home](README.md)
