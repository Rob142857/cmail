# Deployment and verification

This guide describes a production deployment to Cloudflare. Provider interfaces and commands can change; confirm current Cloudflare, Google, Microsoft, or Postmark documentation during rollout.

## 1. Prepare a clean release

- Work from a reviewed commit.
- Run `pnpm release:check`.
- Confirm no secrets, real tenant IDs, private mail, or customer data are tracked.
- Review dependency changes and known advisories.
- Record the commit being deployed.

## 2. Provision Cloudflare resources

```sh
pnpm exec wrangler login
pnpm d1:create
pnpm r2:create
```

Copy the D1 database ID into the web and Worker Wrangler configuration. Confirm the same R2 bucket name is used by both applications.

Apply pending migrations:

```sh
pnpm db:migrate
```

The versioned files in `packages/shared/migrations` are the sole schema source.
Review every unapplied migration before running it against a live database. Do
not rewrite a migration that has already been applied; add a new forward
migration instead. Back up existing data and verify a restore path before
schema changes. Name local SQL exports with the `.d1-export.sql` suffix so the
repository ignore rules protect them from accidental commits; backups still
need access controls and storage outside the source checkout.

Create the Pages project before attempting to write Pages secrets:

```sh
pnpm exec wrangler pages project create cmail-web --production-branch main
```

If you choose another project name, use it consistently in deployment and secret commands.

## 3. Establish the final application origin

Set `APP_NAME`, `MAIL_DOMAIN`, and an initial `APP_URL` in
`apps/web/wrangler.toml`. The project origin is normally
`https://<pages-project>.pages.dev`. Make a provider-free baseline deployment:

```sh
pnpm deploy:web
```

Until credentials are configured, this deployment deliberately shows no sign-in providers. If using a custom hostname, attach it under the Pages project's **Custom domains**, wait for HTTPS to become active, then change `APP_URL` to that exact final origin. Do not continue with OAuth registration until the final origin is fixed and reachable.

## 4. Configure identity providers and secrets

Register callbacks from the production `APP_URL`:

```text
<APP_URL>/auth/callback/google
<APP_URL>/auth/callback/microsoft
```

Restrict consent, account types, tenant selection, and administrative access according to your organisation's identity policy. Both providers need only the OpenID Connect `openid email profile` scopes. Test with accounts that should and should not be admitted.

For Microsoft 365 plus Outlook, Hotmail, and Live accounts, register a **Web**
application that supports accounts in any organisational directory and personal
Microsoft accounts, then set `MICROSOFT_TENANT_ID=common`. For an internal-only
Entra deployment, select the single-tenant account type and set the variable to
that tenant's GUID. In both cases, register the exact Microsoft callback URL
shown above. cmail calls
`https://graph.microsoft.com/oidc/userinfo` with the access token; do not replace
this with `/v1.0/me` or broaden delegated permissions for cmail.

Now add a unique session key and the credentials for one or both registered
providers. The Pages project must already exist for these commands to work:

```sh
pnpm exec wrangler pages secret put SESSION_SECRET --project-name cmail-web
pnpm exec wrangler pages secret put GOOGLE_CLIENT_ID --project-name cmail-web
pnpm exec wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name cmail-web
# Optional Microsoft provider:
pnpm exec wrangler pages secret put MICROSOFT_CLIENT_ID --project-name cmail-web
pnpm exec wrangler pages secret put MICROSOFT_CLIENT_SECRET --project-name cmail-web
```

A provider button is shown only when its own credentials, the shared
`APP_URL`, and `SESSION_SECRET` are all ready. Add one outbound API key as a
Pages secret only if external sending is required.

cmail binds an account to the provider plus the immutable `sub` returned by
UserInfo. Returning sign-in never selects a user by email, UPN, or ID-token
claim. Email is checked only while consuming a manager-issued first-sign-in
invitation or the tightly scoped first-manager bootstrap flow: Google requires
a matching UserInfo email with `email_verified=true`; Microsoft requires its
matching non-empty access-token-backed OIDC UserInfo `email` claim plus the
independent capability, because Microsoft UserInfo omits `email_verified`.

### Required inbound Worker secret

The default per-sender inbound limit fails closed unless the Worker has an
independent 32-byte HMAC key. Generate an unpadded base64url value locally, then
paste it into Wrangler's prompt; do not put it in a command argument, Wrangler
file, Pages variables, or source control:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
pnpm exec wrangler secret put INBOUND_SENDER_HASH_KEY --config apps/email-worker/wrangler.toml
```

Use a production-only value distinct from the development key generated by
`pnpm setup`. Confirm both runtimes use the same reviewed
`MAILBOX_STORAGE_QUOTA_BYTES`, and review the Worker's
`MAX_INBOUND_DECODED_BODY_BYTES` plus hourly inbound limits before routing mail.
Without a valid sender-HMAC key, inbound attempts receive a generic temporary
SMTP rejection and no message is persisted.

## 5. Configure optional browser notifications

Skip this step when browser notifications are not required. Generate one VAPID
pair with `pnpm push:keys`. Put the same public key and subject in the web and
Worker Wrangler `[vars]`, then store the same private key independently in both
runtime secret stores:

```sh
pnpm exec wrangler pages secret put VAPID_PRIVATE_KEY --project-name cmail-web
pnpm exec wrangler secret put VAPID_PRIVATE_KEY --config apps/email-worker/wrangler.toml
```

Do not put the private key in either Wrangler file. If supported clients use a
push service outside the built-in Google, Mozilla, Apple, or Microsoft hosts,
review that service before adding its hostname to `PUSH_ENDPOINT_HOSTS` in both
runtimes. See [Optional Web Push](configuration.md#optional-web-push).

## 6. Configure outbound delivery

Cloudflare Email Service is the recommended and committed default; Postmark is
the alternative. Verify the sending domain and configure a system sender
accepted by that provider. `OUTBOUND_PROVIDER` accepts `cloudflare`, `postmark`,
or `auto`. Auto mode uses the first complete configuration in Cloudflare →
Postmark order. An explicit selection fails closed when its configuration is
incomplete.

For Cloudflare Email Service:

1. Confirm the account uses the Workers Paid plan and accepts the operational
   risk of Email Sending's current public beta status.
2. In **Compute → Email Service → Email Sending**, onboard the sending domain.
   Cloudflare DNS is required. Review the proposed `cf-bounce` MX, SPF, DKIM,
   and DMARC records before accepting them.
3. Put `OUTBOUND_PROVIDER = "cloudflare"` and the non-secret
   `CLOUDFLARE_ACCOUNT_ID` in `apps/web/wrangler.toml`.
4. Create a Cloudflare API token limited to the intended account and **Email
   Sending: Edit**, then store it as a Pages secret:

   ```sh
   pnpm exec wrangler pages secret put CLOUDFLARE_EMAIL_API_TOKEN --project-name cmail-web
   ```

5. Check the sending domain's **Email preview** setting. New sending domains
   have it enabled automatically; while enabled, rendered HTML, text, headers,
   attachments, and raw source are retained for about seven days. Disable it if
   that content retention is not required and approved.
6. Verify the account's daily quota and stage messages within Cloudflare's
   general limit of 50 combined recipients and 5 MiB including attachments.

cmail's current Pages deployment uses Cloudflare's REST API. Do not add the
Worker-only `[[send_email]]` binding to the Pages configuration. A separate
private outbound Worker plus Pages service binding is a possible downstream
architecture when avoiding an application-held API token is worth the extra
runtime. In that architecture, local Worker simulation does not support binary
attachment buffers unless the email binding is remote; remote binding calls
send real mail.

For Postmark, set `OUTBOUND_PROVIDER=postmark`, store `POSTMARK_API_KEY` as a
Pages secret, and publish exactly the DNS records issued for your account.

Start with a restrictive DMARC rollout appropriate to your existing mail flow. Changing MX, SPF, DKIM, or DMARC can affect other senders using the domain, so inventory them first.

## 7. Deploy applications

```sh
pnpm deploy:web
pnpm deploy:email-worker
```

The combined command is:

```sh
pnpm deploy
```

Verify the resulting Pages origin and Worker name before changing mail routing.

## 8. Configure inbound routing

Enable Cloudflare Email Routing for the chosen mail domain. Route only intended addresses or an explicitly approved catch-all to the deployed email Worker. Email Routing is cmail's inbound path and is configured independently of the selected outbound provider, including when Cloudflare Email Service handles outbound delivery.

The Worker accepts mail only for active mailbox rows in D1 and rejects unknown recipients. Test a known address and an unknown address before broadening rules.

## 9. Bootstrap and lock down administration

Generate at least 32 random characters for a one-time bootstrap token, then set
both temporary Pages secrets and redeploy:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
pnpm exec wrangler pages secret put BOOTSTRAP_ADMIN_EMAIL --project-name cmail-web
pnpm exec wrangler pages secret put BOOTSTRAP_ADMIN_TOKEN --project-name cmail-web
pnpm deploy:web
```

Open `<APP_URL>/bootstrap` directly—never append the token to the URL. Submit it
through the same-origin form. A successful POST creates a signed
`cmail_bootstrap_proof` cookie for 10 minutes; it is `HttpOnly`,
`SameSite=Lax`, and `Secure` on production HTTPS. Continue immediately with the
provider account whose accepted UserInfo email exactly matches
`BOOTSTRAP_ADMIN_EMAIL`—Google with `email_verified=true`, or Microsoft with a
non-empty access-token-backed OIDC UserInfo `email` claim—and verify:

- the user has manager status;
- the personal mailbox address is correct;
- Admin routes reject a standard user;
- the OAuth callback uses the intended production origin.

Delete both values immediately after successful bootstrap and redeploy:

```sh
pnpm exec wrangler pages secret delete BOOTSTRAP_ADMIN_TOKEN --project-name cmail-web
pnpm exec wrangler pages secret delete BOOTSTRAP_ADMIN_EMAIL --project-name cmail-web
pnpm deploy:web
```

If the 10-minute proof expires, a binding conflict occurs, or the token may
have entered a log or screenshot, rotate `BOOTSTRAP_ADMIN_TOKEN`, clear the
browser state, and start again. Do not use bootstrap to recover or add later
managers. Configure organisation and system-mail values in **Admin → Settings**,
then invite at least one additional trusted manager through **People**.

## Verification

Complete at least these checks:

### Authentication and authorization

- Google and/or Microsoft sign-in succeeds.
- Provider consent requests only `openid email profile`, and Microsoft uses the OIDC UserInfo endpoint.
- A pending user cannot sign in without a valid manager-issued enrolment link.
- A 72-hour invitation is single-use; resending revokes the previous link.
- First-sign-in email must match the invitation: Google requires
  `email_verified=true`; Microsoft requires its non-empty OIDC UserInfo `email`
  claim together with the invitation capability.
- A returning account is resolved by provider plus immutable subject even if its provider email changes.
- Subject collisions, email mismatches, expired links, and provider-binding conflicts fail closed.
- A disabled, paused, or offboarded account cannot enter the mailbox.
- A standard user receives a forbidden response for Admin routes.
- A user sees only assigned mailboxes.
- Logout invalidates the browser session.

### Mail flow

- An inbound plain-text message arrives in the correct mailbox.
- An inbound HTML message renders without escaping its sandbox.
- Allowed attachments can be downloaded by an assigned user.
- Blocked attachment extensions are rejected.
- Internal delivery reaches each intended mailbox.
- External outbound succeeds through the configured provider.
- Explicit outbound selection fails closed when that provider's required values are incomplete; auto selection follows the documented priority.
- cmail rejects a staged Cloudflare message above either the 50-recipient or 5-MiB general-send limit before provider submission.
- Provider failures are visible and do not appear as successful sends.
- Unknown inbound recipients are rejected.

### Administration and policy

- Managers can create users and mailboxes and assign permissions.
- Creating a user without sending mail leaves the person pending and unbound; **Resend invitation** makes enrolment possible.
- Policy publication and acknowledgement work for a new user.
- Relevant actions appear in audit and mail-trace views.
- Organisation sender and support settings appear in generated invitations.
- The public organisation directory is off by default.
- When enabled, `/api/organization` exposes only explicitly public positions' occupant display name, work email, and title; internal positions and hierarchy remain absent.

### Browser notifications, when enabled

- Notification controls remain unavailable when any required VAPID value is absent or invalid.
- Enabling notifications requires a deliberate signed-in user action and browser permission.
- A new-mail notification contains only generic copy and no message or mailbox metadata.
- Disabling notifications removes the user's subscription.
- A VAPID rotation and re-subscription procedure has been tested.

### DNS and operations

- MX, SPF, DKIM, and DMARC results match the intended providers.
- Cloudflare Email preview retention and dashboard access are approved or preview is disabled, when Cloudflare handles outbound delivery.
- D1 and R2 backup/restore procedures have been exercised.
- Monitoring covers provider errors, authentication anomalies, and mail-routing failures.
- A rollback target and credential-rotation procedure are recorded.

Do not use delivery to real recipients as the first production test. Use controlled accounts and obtain approval before changing a domain with existing mail traffic.

## Official platform references

- [Deploy SvelteKit to Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-a-svelte-kit-site/)
- [Configure Pages bindings and secrets](https://developers.cloudflare.com/pages/functions/bindings/)
- [Apply Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Route inbound mail to a Cloudflare Worker](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)
- [Onboard a Cloudflare Email Sending domain](https://developers.cloudflare.com/email-service/get-started/send-emails/)
- [Use the Cloudflare Email Sending REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)
- [Review Cloudflare Email Service limits](https://developers.cloudflare.com/email-service/platform/limits/)
- [Review Cloudflare Email preview](https://developers.cloudflare.com/email-service/observability/logs/#message-preview)
- [Configure Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Register a Microsoft Entra application](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- [Choose Microsoft supported account types](https://learn.microsoft.com/en-us/entra/identity-platform/single-and-multi-tenant-apps)
- [Microsoft OpenID Connect UserInfo](https://learn.microsoft.com/en-us/entra/identity-platform/userinfo)
- [Generate and use VAPID keys with `web-push`](https://github.com/web-push-libs/web-push/blob/master/README.md#command-line)
- [Follow browser notification permission best practices](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API#requesting_permission)

[← Documentation home](README.md)
