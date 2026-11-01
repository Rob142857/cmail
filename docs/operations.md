# Running cmail

The repeatable jobs for a live deployment, in one place: upgrading, backing up, restoring, rolling back, watching for trouble, and rotating secrets. Most procedures already live in [Deployment and verification](deployment.md); this page gives the order and links to them, and adds monitoring and secret rotation. Tick off the [Operations checklist](operations-checklist.md) as you go.

Examples use the default resource names (`cmail-web`, `cmail-db`, `cmail-storage`, `cmail-backup`). Use your own.

## Upgrade

1. Start from a clean checkout (`git status --short` is empty) and read the [changelog](../CHANGELOG.md) entries since your version. Note any new migration, binding, cron or secret.
2. Your `wrangler.toml` files are ignored by Git, so a pull never changes them. Compare each with its `wrangler.toml.example` and copy across any new binding, variable or cron by hand.
3. Record the current Pages deployment ID and email Worker version (see [Roll back](#roll-back)).
4. Take a fresh backup point (see [Back up](#back-up)). If a migration is pending, also record a D1 Time Travel bookmark (see [Restore](#restore)).
5. Follow [Updating an existing instance](deployment.md#updating-an-existing-instance): pull, `pnpm install --frozen-lockfile`, `pnpm release:check`, `pnpm db:migrate`, then `pnpm deploy` (the email Worker, then Pages). `pnpm deploy` doesn't cover the backup Worker or the landing page: if they changed, redeploy them too (`pnpm exec wrangler deploy` in `apps/backup-worker`, and `pnpm deploy:landing`).
6. Smoke-test: the home page loads, `/mail` redirects when signed out, a test account can sign in, and a test message arrives and opens. Then work through "After deployment" in the operations checklist.
7. If anything fails, [roll back](#roll-back) straight away, then investigate.

Deploy one instance at a time when you run several, and finish verifying each before starting the next.

## Back up

- **In the account:** the optional [backup Worker](deployment.md#automated-backups-optional) copies mail bodies and attachments hourly and dumps every D1 table daily into a private backup bucket. It needs no extra credentials.
- **Outside the account:** take a matching D1 export and R2 copy to separate, encrypted storage, as in [Back up and rehearse recovery](deployment.md#back-up-and-rehearse-recovery). Only this protects against losing the whole Cloudflare account.
- **History:** D1 Time Travel keeps 30 days on Workers Paid (7 on Free). It covers D1 only, not R2.

Rehearse a restore on preview or recovery resources before relying on any of these, and again after changing the backup setup.

## Restore

Pick the smallest restore that fixes the problem:

| What went wrong | Restore | Where |
|---|---|---|
| One message body or attachment deleted or damaged | Copy the object back from the backup bucket | [Automated backups](deployment.md#automated-backups-optional) |
| Bad data change in D1 (a migration, bulk action or script) | D1 Time Travel to a bookmark before the change | [Point-in-time recovery](deployment.md#point-in-time-recovery-with-d1-time-travel) |
| D1 database lost, or the change is outside the Time Travel window | Rebuild from the NDJSON dump or a D1 export into a **new** database | [Automated backups](deployment.md#automated-backups-optional), [Back up and rehearse recovery](deployment.md#back-up-and-rehearse-recovery) |
| Whole account lost | Restore the off-account D1 export and R2 copy together into new resources | [Back up and rehearse recovery](deployment.md#back-up-and-rehearse-recovery) |

A restore of live data rewinds or replaces mail people may have read since. Get approval, pause Email Routing and interactive writes first, and compare row counts before re-enabling routing. If the incident touched both D1 and R2, restore both to the same point.

## Roll back

A bad code release is the most likely incident. Roll Pages back first, then the email Worker, using the IDs you recorded before deploying. Don't roll code back past a D1 migration unless the older code works with the newer schema; deploy a forward fix instead. Full procedure: [Roll back a release](deployment.md#roll-back-a-release).

## Monitor

cmail has no built-in alerting. These are the places to look, and what should make you act.

**Uptime.** An external check every few minutes:

- `GET /` returns 200.
- `GET /mail` redirects when signed out: a 302 to `/` for a fresh visitor (a browser that remembers a sign-in provider gets a 303 to that provider's sign-in instead).
- `POST /mcp` without a token returns 401, and `GET /.well-known/oauth-protected-resource` returns 200, if you use the MCP connector.

**Scheduled jobs.** Check each Worker's Cron Trigger past events in the Cloudflare dashboard, or its logs:

| Worker | Schedule | A healthy run | Act when |
|---|---|---|---|
| Email Worker: retention | `17 3 * * *` (only if `RETENTION_JOBS_ENABLED`) | Completes, with audit events | `Retention run failed`, or `backlog remaining` on several days in a row |
| Email Worker: link list | `7 * * * *` | Shards update, or nothing changed | `Link blocklist refresh failed` or `kept the previous copy` for more than a day (links still open; checks go stale after two days). On Workers Free every refresh fails by design: the feature needs Workers Paid |
| Backup Worker | `23 * * * *` | Run succeeds; the day's manifest says `complete: true`; `d1/<date>/complete.json` exists | Any failed run. A **paused** run means objects vanished from the mail bucket: check the `SOURCE` binding before acknowledging (see [Automated backups](deployment.md#automated-backups-optional)) |

**Mail flow.**

- **Management → Mail trace**: accepted and rejected deliveries. **Delivery recovery** lists sends stuck in `dispatching` or `ambiguous`; reconcile them as the [Operations checklist](operations-checklist.md#routine-operations) describes.
- **Email Routing** analytics for the domain: dropped or rejected inbound mail. Rejections at SMTP time leave no cmail trace record.
- **Email Worker logs**: live with `wrangler tail` or the dashboard's log stream. To keep them for later review, add `[observability]` with `enabled = true` to the email Worker's `wrangler.toml` (the template doesn't enable it; the backup Worker's does) and use Workers Logs. Watch for `Inbound native rate-limit threshold observed`, `Inbox rules were skipped`, `Failed to clean up an inbound R2 object`, `Mail trace logging failed`, and calendar or contact errors. One-off warnings are normal; a sustained run of any of them needs a look.
- Outbound provider dashboards for bounces and complaints, and DMARC aggregate reports (see [Email authentication](email-authentication.md)).

**Growth.** D1 size and R2 object count in the dashboard, and mailbox quota denials in the trace. The backup Worker suits up to tens of thousands of mail objects.

Logs hold no message content by design. Keep it that way when you add your own monitoring: don't log subjects, bodies or full addresses.

## Rotate secrets

Rotate on a schedule your organisation sets, and immediately if a value is printed, committed or shared. Generate a new value, store it, redeploy, then check sign-in and mail flow. Every secret is per environment: rotating production never touches preview.

| Secret | Where | What rotating it does | How |
|---|---|---|---|
| `SESSION_SECRET` | Pages | Signs everyone out. Also ends sign-ins in progress, unused email sign-in codes and bootstrap proofs; message links signed earlier show the "link not verified" page until the message is opened again. MCP connections are unaffected | Plan it as a sign-out event: tell users, set the new value, redeploy Pages |
| `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET` | Pages | None for signed-in users; sign-in breaks if the provider and cmail disagree | Add a new secret at the provider, set it in cmail, redeploy, test a sign-in, then delete the old secret at the provider |
| `TURNSTILE_SECRET_KEY` | Pages | Code-request bot checks fail until both match | Rotate in the Turnstile dashboard, set the new value, redeploy |
| `INBOUND_SENDER_HASH_KEY` | Email Worker | Resets per-sender rate-limit buckets (a one-hour limit reset) | Generate 32 random bytes as unpadded base64url, `wrangler secret put` on the Worker |
| `VAPID_PRIVATE_KEY` with `VAPID_PUBLIC_KEY` | Pages and Email Worker (private); both `[vars]` (public) | Existing browser subscriptions stop working. Each browser re-subscribes the next time someone opens cmail with alerts on | Rotate the pair together in both runtimes, deploy the Worker then Pages |
| `POSTMARK_API_KEY`, `CLOUDFLARE_EMAIL_API_TOKEN` | Pages | Outbound fails while the provider and cmail disagree | Create the new key, set it, redeploy, send a test, then revoke the old key |
| `BOOTSTRAP_ADMIN_TOKEN`, `BOOTSTRAP_ADMIN_EMAIL` | Pages | Should not exist after the first manager is set up | If still present, delete both (see [Bootstrap](deployment.md#9-bootstrap-and-lock-down-administration)) |

Also review who holds Cloudflare, identity-provider and DNS access, and remove anyone who no longer needs it.

[← Documentation home](README.md)
