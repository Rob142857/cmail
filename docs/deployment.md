# Deployment and verification

This guide walks through a production deployment to Cloudflare. Provider interfaces and commands change over time — check current Cloudflare, Google, Microsoft, and Postmark docs as you go.

## Guided repository import

The **Deploy to Cloudflare** button in the project README starts Cloudflare's repository-import flow. It's a guided starting point, not a one-click production deploy.

cmail has a SvelteKit Pages application (Cloudflare's frontend hosting) and a separate email Worker (Cloudflare's serverless function runtime). Both share workspace code, D1 (Cloudflare's hosted database), and R2 (Cloudflare's object storage). The Worker receives routed mail and handles the private native outbound path. Cloudflare's [deployment-button documentation](https://developers.cloudflare.com/workers/platform/deploy-buttons/) says buttons support Workers only: no Pages, no full monorepo support, and no deploying multiple Workers together. The button also skips OAuth registrations, production secrets, Email Sending domain onboarding, Email Routing rules, a custom domain, and cmail's one-time bootstrap.

Use the button only to import the repository, then complete every step below before calling the environment deployed. If you fork cmail, point the button at your own reviewed source, not the upstream badge — otherwise it imports upstream cmail instead of your fork. A future move to [SvelteKit on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/sveltekit/) may automate more of this, but the email Worker and provider setup will still need manual steps.

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

Copy the D1 database ID into the web and Worker Wrangler (Cloudflare's CLI) configuration. Confirm both applications use the same R2 bucket name.

The copied `apps/web/wrangler.toml` and `apps/email-worker/wrangler.toml` files are ignored by Git — they're environment-specific manifests that `pnpm deploy` reads directly. Store them in access-controlled operator documentation, not Git. Never copy a manifest, resource ID, bucket name, or Worker name between Cloudflare accounts.

Replace all six `namespace_id` placeholders in `apps/email-worker/wrangler.toml`: three production IDs, three preview IDs. Use positive integers, unique within this Cloudflare account, and never reuse one between production and preview. Record the chosen IDs with the environment manifest. The config check catches duplicate IDs, but it can't tell if a placeholder is wrong for your account.

Apply pending migrations:

```sh
pnpm db:migrate
```

The versioned files in `packages/shared/migrations` are the sole schema source. Review every unapplied migration before running it against a live database. Never rewrite a migration that's already been applied — add a new forward migration instead. Back up existing data and verify a restore path before schema changes. Name local SQL exports with the `.d1-export.sql` suffix so the repository's ignore rules protect them from accidental commits. Store backups outside the source checkout, with access controls.

### Back up and rehearse recovery

Mail metadata, bodies, and attachments live in separate D1 and R2 resources. Back up and restore both together, as one recovery point. Cloudflare has no single atomic snapshot across D1 and R2 — use a controlled maintenance window when you need strict point-in-time consistency. Exports contain private mail, addresses, and audit data: write them only to an encrypted, access-controlled location outside this checkout. Never use a production export as preview or development data.

Use Cloudflare's [D1 export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) and an S3-compatible client such as the documented [`rclone` integration](https://developers.cloudflare.com/r2/examples/rclone/). Give the R2 client a restricted token and a separately controlled backup destination. A D1 export blocks other database requests while it runs. For a routine recovery point: pre-copy R2, export D1, then copy R2 again — the second copy catches objects committed around the export without deleting backup objects. For a strict recovery point, pause Email Routing and interactive writes before the first command, and resume only after validation. Replace all names and the date before running:

```sh
rclone copy r2-production:cmail-storage r2-backup:cmail-storage-YYYY-MM-DD --checksum
pnpm exec wrangler d1 export cmail-db --remote --output ../cmail-backups/cmail-db-YYYY-MM-DD.d1-export.sql
rclone copy r2-production:cmail-storage r2-backup:cmail-storage-YYYY-MM-DD --checksum
rclone check r2-production:cmail-storage r2-backup:cmail-storage-YYYY-MM-DD --one-way
```

Hash the D1 export (`sha256sum` on Unix, or `Get-FileHash -Algorithm SHA256` in PowerShell) and keep the checksum with the R2 prefix and maintenance-window record. A two-pass live copy can include harmless extra R2 objects created after the D1 snapshot — it's not a substitute for pausing writes when you need exact consistency.

Before production mail flow starts, rehearse recovery at least once into **new, isolated** resources — never overwrite production. Create a recovery D1 database and R2 bucket, then import the matching export and object backup:

```sh
pnpm exec wrangler d1 create cmail-db-recovery
pnpm exec wrangler d1 execute cmail-db-recovery --remote --file ../cmail-backups/cmail-db-YYYY-MM-DD.d1-export.sql
rclone copy r2-backup:cmail-storage-YYYY-MM-DD r2-recovery:cmail-storage-recovery --checksum
rclone check r2-backup:cmail-storage-YYYY-MM-DD r2-recovery:cmail-storage-recovery --one-way
```

Record the D1 export checksum, R2 backup prefix, creation time, source resource names, and confirmation the recovery validated. Check table counts and a small approved sample of message bodies/attachments on the isolated resources. Restoring a live environment needs an approved outage plan: stop mail routing and writes, restore the matching D1 and R2 point together, update both application bindings together, then test before re-enabling routing.

Create the Pages project before writing Pages secrets:

```sh
pnpm exec wrangler pages project create cmail-web --production-branch main
```

If you choose another project name, use it consistently in deployment and secret commands.

### Isolate preview deployments

Pages preview builds must never inherit production mail data, storage, service bindings, or outbound capability. The committed Wrangler examples repeat every non-inheritable preview binding and variable on purpose — don't collapse those blocks into production defaults.

1. Create a separate `cmail-db-preview` D1 database and
   `cmail-storage-preview` R2 bucket. Put the preview database ID only in
   `env.preview` in both ignored Wrangler files.
2. Keep Pages preview bound to `cmail-email-worker-preview`. The Worker preview
   environment has `workers_dev=false`, `preview_urls=false`, empty routes, and
   no `send_email` binding. Its Pages variables keep
   `OUTBOUND_PROVIDER="none"`.
3. Apply and deploy the isolated preview resources:

   ```sh
   pnpm db:migrate:preview
   pnpm deploy:email-worker:preview
   ```

4. In the Pages dashboard, create separate Preview values/secrets for session,
   OAuth, bootstrap, and notification configuration. Use preview-only OAuth
   clients and callback URLs. Never copy production client secrets or bootstrap
   capabilities into Preview.
5. Never point production Email Routing at the preview Worker. If you need
   inbound preview testing, use a separate test domain and separate Worker
   secrets. Protect preview URLs with Cloudflare Access or equivalent controls,
   and restrict which branches create previews.

Before each deploy, inspect the resolved environment and confirm Preview names,
IDs, and bindings can't reach `cmail-db`, `cmail-storage`, the production email
Worker, or an outbound provider.

## 3. Establish the final application origin

Set `APP_NAME`, `MAIL_DOMAIN`, and an initial `APP_URL` in
`apps/web/wrangler.toml`. The project origin is normally
`https://<pages-project>.pages.dev`. The Pages configuration references the
private `EMAIL_SERVICE` binding, so deploy the email Worker first, then make a
provider-free baseline web deployment:

```sh
pnpm deploy:email-worker
pnpm deploy:web
```

Until you configure credentials, this deployment deliberately shows no sign-in providers. If you're using a custom hostname, attach it under the Pages project's **Custom domains**, wait for HTTPS to activate, then change `APP_URL` to that exact final origin. Don't continue to OAuth registration until the final origin is fixed and reachable.

## 4. Configure identity providers and secrets

Register callbacks from the production `APP_URL`:

```text
<APP_URL>/auth/callback/google
<APP_URL>/auth/callback/microsoft
```

Restrict consent, account types, tenant selection, and admin access per your organisation's identity policy. Both providers need only the OpenID Connect (OIDC, a standard sign-in protocol) `openid email profile` scopes. Test with accounts that should and shouldn't be admitted.

For Microsoft 365 plus Outlook, Hotmail, and Live accounts, register a **Web**
application that supports accounts in any organisational directory and personal
Microsoft accounts, then set `MICROSOFT_TENANT_ID=common`. For an internal-only
Entra deployment, select the single-tenant account type and set the variable to
that tenant's GUID. Either way, register the exact Microsoft callback URL
shown above. cmail calls
`https://graph.microsoft.com/oidc/userinfo` with the access token — don't replace
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

A provider's sign-in button appears only once its own credentials, the shared `APP_URL`, and `SESSION_SECRET` are all set. The default Cloudflare outbound path needs no Pages API token — add an outbound secret only for Postmark or the optional Cloudflare REST fallback.

cmail binds an account to the provider plus the immutable `sub` (subject ID) returned by UserInfo. Returning sign-in never selects a user by email, UPN (Microsoft's internal username-like ID), or ID-token claim. Email is checked only when consuming a manager-issued first-sign-in invitation, or during the tightly scoped first-manager bootstrap flow: Google requires a matching UserInfo email with `email_verified=true`; Microsoft requires its matching non-empty access-token-backed OIDC UserInfo `email` claim plus the independent capability, since Microsoft UserInfo omits `email_verified`.

A third sign-in method needs no provider registration at all: an
invitation-scoped email one-time code, for invitees whose mail isn't hosted
by Google or Microsoft. It's on by default; set `EMAIL_OTP_ENABLED=false` to
remove it entirely. To add a bot check on the code-request form, create a
Cloudflare Turnstile widget for `APP_URL`, set `TURNSTILE_SITE_KEY` as a
Pages variable, and store `TURNSTILE_SECRET_KEY` as a Pages secret — both
must be present for the widget to appear. See [Email one-time-code
sign-in](configuration.md#email-one-time-code-sign-in). The Manager role
always requires Google or Microsoft, regardless of this setting.

### Required inbound Worker secret

The default per-sender inbound limit fails closed unless the Worker has an independent 32-byte HMAC (cryptographic signing) key. Generate an unpadded base64url value locally, then paste it into Wrangler's prompt. Never put it in a command argument, Wrangler file, Pages variables, or source control:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
pnpm exec wrangler secret put INBOUND_SENDER_HASH_KEY --config apps/email-worker/wrangler.toml
```

Use a production-only value, distinct from the development key `pnpm setup` generates. Confirm both runtimes use the same reviewed `MAILBOX_STORAGE_QUOTA_BYTES`, and review the Worker's `MAX_INBOUND_DECODED_BODY_BYTES` plus hourly inbound limits before routing mail. Without a valid sender-HMAC key, inbound attempts get a generic temporary SMTP rejection and no message is stored.

## 5. Configure optional browser notifications

Skip this step if you don't need browser notifications. Generate one VAPID (keys that authenticate your server to push services) pair with `pnpm push:keys`. Put the same public key and subject in the web and Worker Wrangler `[vars]`, then store the same private key independently in both runtime secret stores:

```sh
pnpm exec wrangler pages secret put VAPID_PRIVATE_KEY --project-name cmail-web
pnpm exec wrangler secret put VAPID_PRIVATE_KEY --config apps/email-worker/wrangler.toml
```

Never put the private key in either Wrangler file. If supported clients use a push service outside the built-in Google, Mozilla, Apple, or Microsoft hosts, review that service before adding its hostname to `PUSH_ENDPOINT_HOSTS` in both runtimes. See [Optional Web Push](configuration.md#optional-web-push).

## 6. Configure outbound delivery

Cloudflare Email Service is the recommended default; Postmark is the alternative. Verify the sending domain and configure a system sender accepted by that provider. `OUTBOUND_PROVIDER` accepts `cloudflare`, `postmark`, `auto`, or `none`. Auto mode uses the first complete configuration, checking Cloudflare then Postmark. An explicit selection fails closed if its configuration is incomplete.

For Cloudflare Email Service:

1. Confirm the account uses the Workers Paid plan and accepts the operational
   risk of Email Sending's current public beta status.
2. In **Compute → Email Service → Email Sending**, onboard the sending domain.
   Cloudflare DNS is required. Review the proposed `cf-bounce` MX, SPF, DKIM,
   and DMARC records (DNS entries that route and authenticate mail) before
   accepting them.
3. Keep `OUTBOUND_PROVIDER = "cloudflare"`. In the email Worker configuration,
   keep `[[send_email]]` named `EMAIL`, `workers_dev = false`,
   `preview_urls = false`, and `routes = []`. In Pages, keep the private
   `EMAIL_SERVICE` service binding pointed
   at the same environment's email Worker.
4. Check the sending domain's **Email preview** setting. New sending domains
   enable it automatically; while on, rendered HTML, text, headers,
   attachments, and raw source are retained for about seven days. Disable it
   unless that retention is required and approved.
5. Verify the account's daily quota and stage messages within Cloudflare's
   general limit of 50 combined recipients and 5 MiB including attachments.

Deploy the email Worker before Pages. Pages sends only a bounded request over the private service binding; the Worker calls its native Email Sending binding and returns an opaque Cloudflare tracking ID — not the wire RFC `Message-ID`. Never add `[[send_email]]` directly to the Pages configuration.

For local or non-service-binding environments only, set the non-secret `CLOUDFLARE_ACCOUNT_ID` and store a narrowly scoped `CLOUDFLARE_EMAIL_API_TOKEN` with **Email Sending: Edit** as a Pages secret. This enables the REST fallback. Cloudflare's REST success response doesn't consistently show every optional field in its narrative examples, but the generated API reference includes RFC-style `result.message_id`, and cmail validates it when present. REST credentials also enable a single `send_raw` call for mixed local/external messages, keeping external envelope recipients separate from the full visible To/Cc headers. Without those credentials, native Cloudflare or Postmark submits the full recipient set once, and local recipients return through Email Routing. Local Worker email bindings are simulated unless you explicitly enable remote sending — remote calls send real mail.

For Postmark, set `OUTBOUND_PROVIDER=postmark`, store `POSTMARK_API_KEY` as a Pages secret, and publish exactly the DNS records issued for your account.

Begin DMARC at `p=none`, collect authorised aggregate reports, and verify alignment for every legitimate sender before advancing deliberately to `p=quarantine` and then `p=reject`. Don't use the historic `pct` tag for staged enforcement. Changing MX, SPF, DKIM, or DMARC can affect other senders on the domain, so inventory them first and follow [Email authentication and sender requirements](email-authentication.md).

## 7. Deploy applications

```sh
pnpm deploy:email-worker
pnpm deploy:web
```

The combined command is:

```sh
pnpm deploy
```

Verify the resulting Pages origin and Worker name before changing mail routing.

### Roll back a release

Before each release, record the deployed Git commit and the exact prior Worker version and Pages deployment IDs. These read-only commands list the current rollback candidates:

```sh
pnpm exec wrangler deployments list --config apps/email-worker/wrangler.toml
pnpm exec wrangler pages deployment list --project-name cmail-web
```

Keep a known-good release available until the new release passes verification. Normal releases deploy a backward-compatible Worker first, then Pages. A full rollback reverses that order: roll Pages back first, while the newer Worker still supports the previous private API, then roll the Worker back. This avoids leaving the newer Pages application calling an older Worker contract. Use the Pages project's **Deployments → Rollback to this deployment** action, then roll back the Worker to the recorded version:

```sh
pnpm exec wrangler rollback <WORKER_VERSION_ID> --config apps/email-worker/wrangler.toml --message "Rollback to reviewed release"
```

Cloudflare documents [Pages rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/) and [Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/). If the incident is isolated to one runtime, roll back only that runtime, after confirming its counterpart is still compatible. Pause routing changes and outbound tests while deciding, and repeat controlled smoke tests after each rollback.

Do **not** blindly roll application code back after a D1 migration. Migrations are forward-only: an older application version may not understand the current schema. Roll back only after confirming the prior release is schema-compatible — otherwise deploy a forward corrective release. If recovery requires restoring D1, restore the matching R2 point too. Rehearse with the isolated recovery steps above first, and don't re-enable Email Routing until both bindings and mail-flow verification succeed.

## 8. Configure inbound routing

Enable Cloudflare Email Routing for the chosen mail domain. Route only intended addresses, or an explicitly approved catch-all, to the deployed email Worker. Email Routing is cmail's inbound path and is configured independently of the outbound provider — even when Cloudflare Email Service also handles outbound delivery.

The Worker accepts mail only for active mailbox rows in D1. Unknown, disabled, and offboarded addresses all get one generic SMTP-time rejection; the response doesn't reveal whether an address ever existed or why it's unavailable. The sending MTA (mail transfer agent — the server relaying the message) normally generates any non-delivery report (NDR) to its own sender. cmail deliberately sends no branded auto-reply or bounce email for rejected inbound attempts: this uses no cmail outbound quota, prevents backscatter (bounce mail sent to a forged sender), and can't be amplified by a spammer. An SMTP rejection doesn't guarantee a human receives an NDR — sender-side policy and delivery software decide that.

Test a known address and an unknown address before broadening rules. Also test an offboarded address, and confirm it gets the same generic result. Use Cloudflare Email Routing/Worker metrics and logs to monitor rejection patterns — cmail deliberately keeps no durable per-attempt log for rejected addresses.

## 9. Bootstrap and lock down administration

Generate at least 32 random characters for a one-time bootstrap token, then set
both temporary Pages secrets and redeploy:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
pnpm exec wrangler pages secret put BOOTSTRAP_ADMIN_EMAIL --project-name cmail-web
pnpm exec wrangler pages secret put BOOTSTRAP_ADMIN_TOKEN --project-name cmail-web
pnpm deploy:web
```

Open `<APP_URL>/bootstrap` directly — never append the token to the URL. Submit it through the same-origin form. A successful POST creates a signed `cmail_bootstrap_proof` cookie, valid for 10 minutes, marked `HttpOnly`, `SameSite=Lax`, and `Secure` on production HTTPS. Continue immediately with the provider account whose accepted UserInfo email exactly matches `BOOTSTRAP_ADMIN_EMAIL` — Google with `email_verified=true`, or Microsoft with a non-empty access-token-backed OIDC UserInfo `email` claim — and verify:

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

If the 10-minute proof expires, a binding conflict occurs, or the token may have leaked into a log or screenshot, rotate `BOOTSTRAP_ADMIN_TOKEN`, clear the browser state, and start again. Don't use bootstrap to recover or add later managers. Configure organisation and system-mail values in **Admin → Settings**, then invite at least one additional trusted manager through **People**.

## Verification

Complete at least these checks:

### Authentication and authorization

- Google and/or Microsoft sign-in succeeds.
- Provider consent requests only `openid email profile`, and Microsoft uses the OIDC UserInfo endpoint.
- A pending user can't sign in without a valid manager-issued enrolment link.
- A 72-hour invitation is single-use; resending revokes the previous link.
- First-sign-in email must match the invitation: Google requires
  `email_verified=true`; Microsoft requires its non-empty OIDC UserInfo `email`
  claim plus the invitation capability.
- A returning account is resolved by provider plus immutable subject even if its provider email changes.
- Subject collisions, email mismatches, expired links, and provider-binding conflicts fail closed.
- A disabled, paused, or offboarded account can't enter the mailbox.
- A standard user receives a forbidden response for Admin routes.
- A user sees only assigned mailboxes.
- Logout invalidates the browser session.
- If email one-time-code sign-in is enabled, a test invitee to an address
  hosted by neither Google nor Microsoft receives and can use a code, and an
  attempt to make that account a Manager is refused.
- If sign-in is restricted to approved countries, a sign-in from outside the
  list creates a pending travel request and notifies managers; approving,
  denying, and revoking it all work from **Management > Travel approvals**.

### Mail flow

- An inbound plain-text message arrives in the correct mailbox.
- An inbound HTML message renders without escaping its sandbox.
- Allowed attachments can be downloaded by an assigned user.
- Blocked attachment extensions are rejected.
- Internal delivery reaches each intended mailbox.
- External outbound succeeds through the configured provider.
- Native Cloudflare sends persist opaque provider tracking IDs separately from RFC `Message-ID` headers.
- A REST test validates and stores `result.message_id` when present, and records it as unavailable rather than fabricating one when it's absent.
- A mixed-recipient test keeps identical visible To/Cc roles externally and internally, sends each recipient exactly once, and exercises both the raw-REST and provider-loopback plans the deployment will use.
- Explicit outbound selection fails closed when that provider's required values are incomplete; auto selection follows the documented priority.
- cmail rejects a staged Cloudflare message above either the 50-recipient or 5-MiB general-send limit before provider submission.
- Provider failures are visible and never appear as successful sends.
- Unknown inbound recipients are rejected.
- If `SPAM_QUARANTINE_SCORE` or a sender allow/block rule is configured, a test message confirms filing to Spam, and release back to Inbox, both work — see [Spam and quarantine](spam-and-quarantine.md).

### Administration and policy

- Managers can create users and mailboxes and assign permissions.
- Creating a user without sending mail leaves the person pending and unbound; **Resend invitation** makes enrolment possible.
- Policy publication and acknowledgement work for a new user.
- Relevant actions appear in audit and mail-trace views.
- Organisation sender and support settings appear in generated invitations.
- The public organisation directory is off by default.
- When enabled, `/api/organization` exposes only explicitly public positions' occupant display name, work email, and title — internal positions and hierarchy stay hidden.

### Browser notifications, when enabled

- Notification controls remain unavailable when any required VAPID value is absent or invalid.
- Enabling notifications requires a deliberate signed-in user action and browser permission.
- A new-mail notification contains only generic copy and no message or mailbox metadata.
- Disabling notifications removes the user's subscription.
- A VAPID rotation and re-subscription procedure has been tested.

### DNS and operations

- MX, SPF, DKIM, and DMARC results match the intended providers.
- Controlled messages at every material receiver show `spf=pass`, `dkim=pass`,
  and aligned `dmarc=pass` in received authentication results.
- The deployment's current Google, Yahoo, Microsoft, and other material
  receiver classifications and sender policies have been reviewed.
- The accountable owner has confirmed cmail won't be used as a bulk-marketing
  system without the missing consent, unsubscribe, suppression, reputation, and
  compliance controls described in the authentication guide.
- When Cloudflare handles outbound delivery, Email preview retention and dashboard access are approved, or preview is disabled.
- D1 and R2 backup/restore procedures have been exercised.
- Monitoring covers provider errors, authentication anomalies, and mail-routing failures.
- A rollback target and credential-rotation procedure are recorded.

Don't use delivery to real recipients as the first production test. Use controlled accounts, and get approval before changing a domain with existing mail traffic.

## Official platform references

- [Use Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Deploy SvelteKit to Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-a-svelte-kit-site/)
- [Configure Pages bindings and secrets](https://developers.cloudflare.com/pages/functions/bindings/)
- [Apply Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Route inbound mail to a Cloudflare Worker](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)
- [Onboard a Cloudflare Email Sending domain](https://developers.cloudflare.com/email-service/get-started/send-emails/)
- [Configure a Cloudflare Email Sending binding](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Use a Pages service binding](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings)
- [Use the Cloudflare Email Sending Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Use the optional Cloudflare Email Sending REST fallback](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)
- [Review Cloudflare Email Service limits](https://developers.cloudflare.com/email-service/platform/limits/)
- [Review Cloudflare Email authentication](https://developers.cloudflare.com/email-service/concepts/email-authentication/)
- [Configure and test Cloudflare MTA-STS](https://developers.cloudflare.com/email-service/configuration/mta-sts/)
- [Review Cloudflare Email preview](https://developers.cloudflare.com/email-service/observability/logs/#message-preview)
- [Configure Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Register a Microsoft Entra application](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- [Choose Microsoft supported account types](https://learn.microsoft.com/en-us/entra/identity-platform/single-and-multi-tenant-apps)
- [Microsoft OpenID Connect UserInfo](https://learn.microsoft.com/en-us/entra/identity-platform/userinfo)
- [Generate and use VAPID keys with `web-push`](https://github.com/web-push-libs/web-push/blob/master/README.md#command-line)
- [Follow browser notification permission best practices](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API#requesting_permission)

[← Documentation home](README.md)
