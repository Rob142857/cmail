# Upgrading and keeping your settings

This page explains where each kind of instance setting lives, what an upgrade
from upstream changes, and how to upgrade a plain copy or a fork without losing
anything. The detailed runbook is in [Running cmail: upgrade](operations.md#upgrade);
this page explains the why and the checks around it.

## Where your settings live

An upgrade replaces the code. Your settings live elsewhere, so they survive it.

| Setting | Where it lives | Changed by an upgrade? |
|---|---|---|
| Bindings, resource names, `[vars]`, crons | `apps/web/wrangler.toml`, `apps/email-worker/wrangler.toml`, `apps/backup-worker/wrangler.toml` | No. Git ignores them. New options appear only in the `*.example` files |
| Local development secrets | `.dev.vars` files | No. Git ignores them |
| Production secrets (OAuth, `SESSION_SECRET`, API tokens, keys) | Cloudflare Pages and Worker secrets | No |
| Organisation details set in the app (name, support address, links, system sender, sign-in countries) | D1 table `org_settings`, set in **Admin > Settings** | No. These override the matching `[vars]` |
| AI connections, directory, sender rules, signatures, usage policy, retention, inbox rules | Their own D1 tables, set in the app | No. Migrations can add tables and columns, so read the changelog before each one |
| Logo, icons, colour | `BRAND_*` variables pointing at your own files | No. The fallback assets in `apps/web/static/` are upstream's |
| Mail, users, mailboxes | D1 and R2 | No, apart from migrations |

`APP_URL` is set only in `[vars]`, never in the app, because sign-in callbacks
depend on it.

**Rule of thumb:** configure, don't edit code. Anything you change in tracked
files has to be carried forward by hand on every upgrade. See
[Downstream and private implementations](downstream-implementations.md#configure-rather-than-fork)
for the full list of settings.

## What an upgrade changes

- Source code in `apps/` and `packages/`.
- New D1 migrations in `packages/shared/migrations/`. They only move forward.
  No migration writes to `org_settings`.
- The `*.example` templates, when a new binding, variable, cron or secret
  is added.
- `CHANGELOG.md`, which lists anything you must do by hand.

## Upgrading a plain copy

Use this when your checkout tracks upstream directly and has no code changes.

1. Read the [changelog](../CHANGELOG.md) since your version. Note any new
   migration, binding, cron or secret.
2. Record the current Pages deployment and Worker versions, and take a backup
   point (see [Running cmail](operations.md#upgrade)).
3. Pull and check:

   ```sh
   git pull --ff-only origin main
   pnpm install --frozen-lockfile
   pnpm release:check
   ```

4. Check for new settings (next section).
5. Apply migrations and deploy:

   ```sh
   pnpm db:migrate
   pnpm deploy
   ```

   `pnpm deploy` deploys the email Worker first, then Pages. Deploy the
   backup Worker and the product page separately if they changed.
6. Smoke-test, then roll back straight away if anything fails.

The management console shows **Update available** when upstream has moved
on. See [Deployment: updating an existing instance](deployment.md#updating-an-existing-instance).

## After pulling: check for new settings

`config:check` checks bindings, but not `[vars]` or crons. A new variable
missing from your file silently uses the code's default. Check by hand. This
lists every variable named in the example, including commented-out optional
ones, that your file doesn't set:

```sh
for app in web email-worker backup-worker; do
  f=apps/$app/wrangler.toml
  [ -f "$f" ] || continue
  echo "== $app"
  comm -23 \
    <(grep -oE '^[#[:space:]]*[A-Z][A-Z0-9_]*[[:space:]]*=' "$f.example" | tr -d '#= \t' | sort -u) \
    <(grep -oE '^[[:space:]]*[A-Z][A-Z0-9_]*[[:space:]]*=' "$f" | tr -d '= \t' | sort -u)
  diff <(grep -h '^crons' "$f.example") <(grep -h '^crons' "$f") >/dev/null || echo "crons differ: compare by hand"
done
```

For each name it prints, read the comment beside it in the `.example` file
and decide whether you need it. Also compare new `[[...]]` binding blocks, such
as a queue consumer, by eye. New secrets are listed in the changelog and in the
[Configuration reference](configuration.md).

## Upgrading a fork

Use this when you keep your own changes in a private repository.

1. Keep upstream as a second remote:
   `git remote add upstream https://github.com/Rob142857/cmail.git`.
2. Fetch and bring your changes on top:
   `git fetch upstream && git rebase upstream/main` (or merge, if your team
   prefers).
3. Resolve conflicts. The fewer tracked files you've changed, the fewer
   conflicts you'll have.
4. Run `pnpm release:check`, then follow steps 4 to 6 of the plain upgrade.
5. If you deploy the product page, check that `landing/` still points at your
   own links, policy and analytics.

[Downstream and private implementations](downstream-implementations.md) covers
how to choose between a configured copy, a fork and an overlay, and the release
gate to use.

## Several instances

Upgrade one instance at a time. Finish testing each before starting the next,
and keep each instance's rollback IDs. Each instance has its own Wrangler files
and secrets, so keep a separate checkout per instance, or a separate
configuration directory.

## Rolling back

Code rolls back with Cloudflare's deployment history (see
[Running cmail: roll back](operations.md#roll-back)). Migrations can't be
undone: to undo a migration, restore D1 from Time Travel or a backup taken
before it. That's why you take a backup point before `pnpm db:migrate`.
