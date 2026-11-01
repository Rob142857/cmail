# Developer guide

How to do the common development jobs in this repository. For first-time
resource setup see [Getting started](getting-started.md); for the rules every
change must meet see [CONTRIBUTING.md](../CONTRIBUTING.md) and
[AGENTS.md](../AGENTS.md). Run every command from the repository root.

## Layout

| Path | What it is |
|---|---|
| `apps/web` | SvelteKit app on Cloudflare Pages (`@cmail/web`). Server code is in `src/lib/server`, imported as `#lib/server/...`. Routes are in `src/routes`. |
| `apps/email-worker` | Email Routing Worker (`@cmail/email-worker`). Inbound mail, the scheduled link-list refresh and retention, and the private native-outbound path. |
| `apps/backup-worker` | Optional scheduled backup Worker (`@cmail/backup-worker`). No HTTP surface. |
| `packages/shared` | Code both apps import (`@cmail/shared`), plus the D1 migrations in `packages/shared/migrations`. |
| `scripts` | Repository checks and setup (`setup.mjs`, `verify-*.mjs`, `check-*secrets.mjs`). |
| `e2e/mobile` | Playwright mobile and accessibility suite. |
| `landing` | Static product page, deployed on its own. |

## 1. Run it locally

```sh
git clone https://github.com/Rob142857/cmail.git
cd cmail
corepack enable
pnpm install --frozen-lockfile
pnpm setup
```

Check `pnpm --version` prints the version in the `packageManager` field of
`package.json` (an older global pnpm earlier on `PATH` is the usual cause of
odd install errors). The engines are Node 22.17 or later; `.nvmrc` says 24.

`pnpm setup` copies each `wrangler.toml.example` to an ignored `wrangler.toml`
(web and email Worker) and creates `apps/web/.dev.vars` and
`apps/email-worker/.dev.vars`, with a fresh development-only
`INBOUND_SENDER_HASH_KEY`. It never overwrites a file that exists. Set
`SESSION_SECRET` in `apps/web/.dev.vars` (32 characters or more); the app
refuses to run with a weak one. The backup Worker has a
`wrangler.toml.example` but `pnpm setup` does not copy it.

Then apply the migrations to Wrangler's local D1 state and start the apps:

```sh
pnpm db:migrate:local   # local only, never touches a remote database
pnpm dev                # web app (vite dev)
pnpm dev:worker         # email Worker (wrangler dev), in a second terminal
```

`pnpm db:migrate:local` reads the D1 binding from `apps/web/wrangler.toml`.
The `database_id` can stay a placeholder for local work.

**Seed data.** There is no seed script for day-to-day development. Create
users and mailboxes through the app after bootstrapping the first manager
([Getting started](getting-started.md#bootstrap-local-administration)).

**Signing in without Google or Microsoft.** There is no development sign-in
bypass in the app, and the first-manager bootstrap still finishes with a real
provider sign-in. Two ways to get a signed-in session without one:

- Use a throwaway Google or Microsoft app registration with a localhost
  callback, as in [Getting started](getting-started.md#register-oauth-callbacks).
- Run the test fixture server. It builds the app, serves it over local HTTPS
  with local D1 and R2 under `.tmp/e2e-mobile/`, seeds invented users,
  mailboxes and messages, and writes a signed session token per user:

  ```sh
  node e2e/mobile/serve.mjs
  ```

  Then open the origin printed in `.tmp/e2e-mobile/sessions.json` and set the
  `cmail_session` cookie to a user's token from that file (browser developer
  tools, Application tab). Outbound delivery is off, so nothing is sent. The
  state is deleted and rebuilt every time the script starts. Set
  `E2E_SKIP_BUILD=1` to reuse the last build.

A local server cannot reproduce Cloudflare Email Routing. Test the inbound
path with the Worker's unit tests (section 5) and in an isolated Cloudflare
environment.

## 2. Run the tests

| Job | Command |
|---|---|
| Whole gate | `pnpm validate` |
| Gate plus full git-history secret scan (releases) | `pnpm release:check` |
| Lint (ESLint in web, `tsc` in the Workers and shared) | `pnpm lint` |
| Type checks (`svelte-check`, `tsc`) | `pnpm check` |
| All unit tests | `pnpm test` |
| One package | `pnpm --filter @cmail/web test` (also `@cmail/email-worker`, `@cmail/backup-worker`, `@cmail/shared`) |
| One Vitest file | `pnpm --filter @cmail/web exec vitest run src/hooks.csrf.test.ts` |
| Tests matching a name | `pnpm --filter @cmail/web exec vitest run -t "<test name>"` |
| Mobile and accessibility suite, every device | `pnpm test:mobile` |
| Refresh screenshot baselines after an intended UI change | `pnpm test:mobile:update` |
| Open the Playwright report | `pnpm test:mobile:report` |
| Accessibility and smoke only, as CI runs them | `pnpm exec playwright test e2e/mobile/a11y.spec.ts e2e/mobile/smoke.spec.ts --project=pixel-7 --project=desktop-chrome` |

`pnpm validate` runs, in order: `secrets:scan`, `landing:check`,
`config:check`, `lint`, `check`, `test`, `test:image-runtime`,
`db:migrate:verify`, `build`, then `pnpm audit --audit-level=low`. It stops at
the first failure. There is no timing figure in the repository; CI gives the
whole job, install included, 20 minutes. On a slow machine run the parts you
changed first (`lint`, `check`, one package's `test`), then `pnpm validate`
once before asking for review.

Test file conventions:

- Unit tests are `*.test.ts` beside the code and run under Vitest, except in
  `packages/shared`, which uses `node --test`.
- Tests that need Node-only modules (`node:sqlite`) are named
  `*.node.test.ts`. Vitest still runs them, but they are type-checked by
  `tsconfig.node-tests.json`, so Worker code is checked against Workers types
  only. `pnpm check` and `pnpm lint` cover both configs.
- Anything depending on SQL behaviour (triggers, constraints, `ORDER BY`)
  should run against the real migrations, not a hand-written mock. See
  sections 3 and 5 for the two harnesses.

Install the Playwright browsers once per machine with
`pnpm exec playwright install chromium webkit` (CI installs only Chromium, with
`--with-deps`). The suite builds the app and seeds invented data itself, as in
[CONTRIBUTING.md](../CONTRIBUTING.md#mobile-and-accessibility-suite). Fixed
known bugs are listed in `e2e/mobile/known-bugs.ts`; delete an entry when its
test reports "Expected to fail, but passed".

**What CI runs** (`.github/workflows`), on pull requests and pushes to `main`:

| Workflow | Job |
|---|---|
| `ci.yml` | `pnpm install --frozen-lockfile` then `pnpm release:check`, on Node 22, 24 and 26 (Ubuntu, full git history, 20-minute limit). |
| `e2e.yml` | Axe and smoke specs on `pixel-7` and `desktop-chrome`, Node 24 (25-minute limit). The visual spec is not run in CI because screenshot baselines are platform-specific. A failed run uploads the report and traces for 7 days. |
| `codeql.yml` | CodeQL for JavaScript and TypeScript, also weekly. |

Dependabot is configured in `.github/dependabot.yml` (weekly npm, monthly
Actions). Actions are pinned by commit SHA; keep it that way.

## 3. Add a D1 migration

Migrations live in `packages/shared/migrations` and are the only schema
source. Both apps' Wrangler files point their `migrations_dir` at that folder.

1. Add the next file, `NNNN_short_snake_case_name.sql` (four digits, no gaps,
   for example the one after `0018_inbox_rules.sql`).
2. Never edit a migration that has been applied anywhere. Add a new one.
3. Make it safe to run once and to upgrade over older data. Existing files use
   `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` and
   `CREATE TRIGGER IF NOT EXISTS`. `ALTER TABLE ... ADD COLUMN` needs a default
   so existing rows stay valid. Put a comment at the top saying what the table
   is for.
4. Run `pnpm db:migrate:verify`. It applies every migration to a throwaway
   local D1 (in the system temp folder, nothing remote), replays the pre-`0006`
   upgrade path, and asserts exact counts of application tables, indexes,
   triggers and defaults. **A new table, index or trigger therefore means
   updating the expected numbers in `scripts/verify-migrations.mjs`** (the
   `assertEqual` lines and the summary message) in the same pull request.
5. Apply it locally with `pnpm db:migrate:local`.
6. Write tests against the real schema (section 5 covers the harnesses) and
   add a `CHANGELOG.md` line under `[Unreleased]` that says which command an
   existing deployment must run and in what order (for example, migrate before
   deploying the Worker and web app).

Remote migrations (`pnpm db:migrate`, and `pnpm db:migrate:preview` for the
isolated preview database) are a separate, deliberate step. They change
shared production data and cannot be rolled back by redeploying code, so they
need the owner's explicit go-ahead, a fresh backup or D1 Time Travel bookmark
first, and a review of every pending file. Do not run them from a feature
branch or from CI. See [Deployment](deployment.md#back-up-and-rehearse-recovery) and
`AGENTS.md`.

## 4. Add a route or server endpoint

- Pages and form actions are `+page.server.ts` files, and JSON endpoints are
  `+server.ts` files, under `apps/web/src/routes`. API routes are in
  `routes/api`; manager pages are under `routes/admin`.
- Shared server logic goes in `apps/web/src/lib/server`, not in the route file.
  Import it with `#lib/server/<file>.js`. Useful helpers already there:
  `db.ts` (`generateId`, `nowISO`, `audit`, `traceEmail`), `validation.ts`
  (`normalizeEmail`, `parseRecipientList`, `textField`, `boundedInteger`,
  `escapeLike`), `message-access.ts` (`messageOwnershipPredicate`),
  `rate-limit.ts` (`consumeRateLimit`) and `session.ts`.
- Bindings come from `platform.env` (typed in `src/app.d.ts`). If it is
  missing, return early rather than throwing, as the existing endpoints do.
- **Authentication.** `hooks.server.ts` verifies the session cookie against the
  `sessions` table on every request and sets `locals.user` and
  `locals.sessionId`. It does not reject anonymous requests for you outside
  `/admin`: your handler must check `locals.user` itself (API endpoints return
  401, pages redirect).
- **Roles.** `/admin` and everything below it is blocked in the hook unless
  `locals.user.role === 'manager'`, and `routes/admin/+layout.server.ts`
  checks again. Endpoints elsewhere that are manager-only must check the role
  themselves, as `routes/admin/mailboxes/assignees/+server.ts` does.
  `/mail`, `/admin` and `/api/*` (except `/api/organization`) also redirect or
  return `403 policy_required` until the signed-in user has signed the latest
  usage policy.
- **Mailbox access.** Check the caller's assignment and permission level for
  the mailbox in SQL (join `mailbox_assignments` on `locals.user.id`), as
  `routes/api/contacts/+server.ts` and `routes/api/messages/bulk/+server.ts`
  do. Never trust an id from the request on its own, including from managers.
- **CSRF.** The hook replaces SvelteKit's built-in guard (`csrf.trustedOrigins`
  is `['*']` in `vite.config.ts`). Any unsafe-method request with
  `sec-fetch-site: cross-site` or a different `Origin` gets 403, and a
  form-encoded POST, PUT, PATCH or DELETE must carry an `Origin` equal to the
  app's own. Only `/oauth/token` and `/oauth/revoke` are exempt. Do not add to
  that list without a security review. `/bootstrap` and `/enroll/*` get
  `Referrer-Policy: strict-origin` on purpose; do not change it to
  `no-referrer`, which makes browsers send `Origin: null` and the guard rejects
  the page's own POST.
- Write an `audit(...)` record for state changes and keep personal data out of
  logs. Unexpected errors are logged by `handleError` with a reference id and
  no request data.
- **Tests to add.** A Vitest file beside the route or helper covering:
  signed-out (401 or redirect), signed-in without permission, signed-in with
  permission, and bad input. Existing examples:
  `routes/api/contacts/contacts.test.ts`, `src/hooks.csrf.test.ts`,
  `src/hooks.server.test.ts`. For SQL-heavy code use
  `src/lib/server/mcp/testing/harness.ts` (`createTestDatabase`, `createFixture`,
  `seedMessage`), which runs every real migration on in-memory `node:sqlite`.
- Update the user or manager docs if behaviour changed, and `CHANGELOG.md`.

## 5. Change the email Worker

`apps/email-worker/src/index.ts` exports three handlers: `fetch` (the private
service-binding path for native outbound), `scheduled` (the link-list refresh
on its own cron; every other schedule runs retention, which is off unless
`RETENTION_JOBS_ENABLED` is set) and `email` (inbound mail). The inbound flow
in `email()` runs in this order, and each step that rejects stops the rest:

1. Validate the envelope address and the declared size, before reading the
   message body.
2. Record non-enforcing rate-limit signals (`INBOUND_*_RATE_LIMITER` bindings).
3. Look up the recipient mailbox; unknown recipients get a generic permanent
   rejection and write no rows.
4. Suppress replays of a known `Message-ID`, then reserve delivery against the
   per-mailbox, per-sender and storage guards (`inbound-guard.ts`).
5. Parse with `postal-mime`, enforcing body and attachment-count limits.
6. The rest (sanitising HTML and filenames, authentication results, spam
   scoring and placement through `@cmail/shared/inbound-risk`, inbox rules,
   calendar parts, the D1 and R2 writes, push notifications) is in the same
   function and the modules it imports. Read `index.ts` before changing the
   order, because the guards above must stay ahead of any D1 write.

Rejections use `message.setReject(...)`, which is a permanent SMTP failure, so
keep rejection text generic and never store attacker-controlled data for a
rejected message.

Testing:

- `src/testing/delivery.ts` is a Vitest harness for calling the `email()`
  handler with a recording in-memory D1 and R2 (`deliveryDatabase` takes hooks
  to answer or fail specific queries). Start from `index.test.ts`,
  `delivery-failures.test.ts` and `delivery-rejections.test.ts`.
- `src/testing/sqlite-d1.ts` (`migratedDatabase()`) gives a D1-shaped adapter
  over in-memory `node:sqlite` with every real migration applied. Use it, in a
  `*.node.test.ts` file, when SQL behaviour matters; see
  `inbound-guard.sql.node.test.ts`.
- MIME parsing changes: see `postal-mime-fixtures.ts`,
  `postal-mime-fixtures.expected.json` and `postal-mime-upgrade.test.ts`.
- Run `pnpm --filter @cmail/email-worker test` and `pnpm --filter
  @cmail/email-worker lint`.
- New Worker settings go in `apps/email-worker/wrangler.toml.example` (public
  values) or `.dev.vars.example` (secrets, with an empty value), then in
  [Configuration](configuration.md). Run `pnpm config:check` afterwards.

## 6. Change the shared package

`packages/shared` is not built or published. Each file is listed under
`exports` in its `package.json` (for example `@cmail/shared/inbox-rules`) and
both apps import the TypeScript source directly, so a change is picked up by
the next `pnpm dev`, test run or build with no extra step.

When you add a file:

1. Add it to `exports` in `packages/shared/package.json`.
2. Add it to the file list in that package's `check` script (it type-checks an
   explicit list, so a file missing from the list is not checked).
3. Put its test beside it as `*.test.ts` (run with `node --test`, so keep it
   free of Vitest imports).

Anything here runs in the Worker, the Pages runtime and the tests, so keep it
free of Node-only and browser-only APIs. After a change run
`pnpm --filter @cmail/shared test`, then `pnpm check` and `pnpm test` so both
apps are re-checked against it. Migrations also live in this package; a
change to a table a shared helper reads or writes needs both together.

## 7. Update dependencies

- One pull request per update (or per Dependabot group), so a regression is
  easy to bisect. Dependabot opens grouped weekly npm updates and monthly
  Actions updates.
- Use the pinned pnpm: `pnpm update <package>`, or edit `package.json`, then
  `pnpm install` to refresh `pnpm-lock.yaml`. Commit the lockfile with the
  change. CI installs with `--frozen-lockfile`, so a stale lockfile fails.
- Several dependencies are pinned to exact versions; keep them exact unless
  the update is the point of the pull request.
- Run `pnpm validate`, and the mobile suite if UI dependencies changed.
- `pnpm-workspace.yaml` also holds `overrides`, `allowBuilds` (which packages
  may run install scripts) and `minimumReleaseAgeExclude` (versions allowed
  inside the release-age gate). Add to the last only when needed, with the
  exact version, and remove entries once the version ages out.
- **Audit exceptions.** `pnpm audit --audit-level=low` is part of
  `validate`. A known advisory with no available fix may be ignored only in
  `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`. Each entry needs a
  comment naming the package, why it is not reachable or only affects
  build time, and what ends the exception. Remove the entry as soon as a fix
  ships. Never loosen `--audit-level`.
- Record major upgrades and compatibility boundaries in a dated review under
  `docs/`, as in [the September 2026 review](dependency-review-2026-09-22.md).

## 8. Preview deployments and `config:check`

`pnpm config:check` (`scripts/verify-wrangler-config.mjs`) reads both
`wrangler.toml.example` files, and the ignored `wrangler.toml` files if they
exist, and fails if preview could touch production. Among other things it
requires the preview D1 database, R2 bucket and service binding to differ
from production, the preview `OUTBOUND_PROVIDER` to be `"none"`, no preview
send binding on the Worker, inbound rate-limit `namespace_id` values to be
unique positive integers, and the web and Worker files to agree on the
production and preview D1 and R2 resources. Every deploy script runs it first.

If you edit a `wrangler.toml.example`, repeat each non-inheritable preview
binding and variable in `env.preview`, keep placeholder names generic, and run
`pnpm config:check` before committing. The preview commands, with generic
names, are:

```sh
pnpm db:migrate:preview            # remote, preview database only
pnpm deploy:email-worker:preview   # isolated, non-sending preview Worker
```

Preview resources must never hold production data, secrets or routing. The
full setup is in
[Deployment](deployment.md#isolate-preview-deployments). Use a separate test
domain for any inbound preview test.

## 9. Common errors

| Symptom | Cause and fix |
|---|---|
| `pnpm` complains about the engine or behaves like an older version | A global pnpm earlier on `PATH`. Run `corepack enable`, check `pnpm --version` matches `packageManager`, and use Corepack's shims for the whole shell session. Do not bypass the engine check. |
| `pnpm install --frozen-lockfile` fails because the lockfile is out of date | CI and the docs use `pnpm install --frozen-lockfile`. If you changed a dependency, run `pnpm install` once and commit `pnpm-lock.yaml`. |
| App starts but throws about `SESSION_SECRET` | It must be a random value of 32 or more characters in `apps/web/.dev.vars`. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. |
| Local inbound mail is rejected with a generic permanent error | `INBOUND_SENDER_HASH_KEY` is missing or malformed in `apps/email-worker/.dev.vars`, and sender limiting fails closed. Set the line to `INBOUND_SENDER_HASH_KEY=` (empty) and re-run `pnpm setup`, which generates a key without printing it, or paste 32 random bytes as unpadded base64url. |
| `.dev.vars` or `wrangler.toml` missing | Run `pnpm setup`. It only creates files that do not exist. They are ignored by git; do not commit them. |
| `pnpm config:check` fails after a Wrangler edit | Read the message: it names the file and field (a preview binding reused from production, a duplicate `namespace_id`, a preview that can send). Fix the config, not the checker. |
| `pnpm db:migrate:verify` reports a wrong table, index or trigger count | You added schema. Update the expected numbers in `scripts/verify-migrations.mjs`. |
| `pnpm audit` fails on `validate` | Update the dependency. Only if no fix exists, add a narrow, commented `ignoreGhsas` entry as in section 7. |
| Mobile suite fails to start on a fresh machine | Run `pnpm exec playwright install chromium webkit` once. The suite builds the app itself and needs the local HTTPS server on port 4321 (`E2E_PORT` changes it). |
| Playwright visual specs fail only on your machine | Baselines are per platform in `e2e/mobile/__screenshots__/<platform>/`. Update them only after an intended UI change, with `pnpm test:mobile:update`. |
| Login or form POST returns 403 "Cross-origin" or "Cross-site form submissions are forbidden" | The CSRF rules in section 4. Make sure `APP_URL` matches the origin in the browser and that the request carries a matching `Origin`. |
| OAuth sign-in fails with a redirect mismatch | The registered callback must match `<APP_URL>/auth/callback/<provider>` exactly: scheme, host, port, path and trailing slash. |
| Windows: line-ending noise in `git status` or lint | `.gitattributes` sets `eol=lf` and `.editorconfig` sets LF. If files come out CRLF (an editor setting or a `core.autocrlf` override), re-checkout them and keep your editor on LF. |

Wrangler is pinned through the workspace (`wrangler` is a dev dependency of
the root and each app). Use the `pnpm` scripts or `pnpm exec wrangler ...`
rather than a global `wrangler`, so you do not mix versions.

## 10. Release

The maintainer checklist is in the [Maintainer release guide](maintainer-guide.md#prepare-a-release).
In short:

1. `CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
   Add entries under `## [Unreleased]` as you work, grouped as `### Added`,
   `### Changed`, `### Fixed`, `### Security`. When releasing, rename
   `[Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and add a fresh empty
   `[Unreleased]` above it.
2. Bump `version` to match in the root `package.json` and in each of
   `apps/web`, `apps/email-worker`, `apps/backup-worker` and `packages/shared`
   (all are 0.2.0 today), and in `CITATION.cff` (`version` and
   `date-released`). `.zenodo.json` has no version field; check its title,
   description and keywords are still accurate.
3. Run `pnpm release:check` and complete the manual staging checks.
4. After the release commit is approved and merged, create an annotated tag
   (`git tag -a vX.Y.Z -m "cmail X.Y.Z"`), push it, and publish the GitHub
   release. Review the notes GitHub generates from `.github/release.yml`
   before publishing.

[← Documentation home](README.md)
