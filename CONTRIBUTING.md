# Contributing to cmail

Contributions of code, tests, documentation, accessibility work, security hardening, and deployment experience are welcome. By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

Keep deployments, credentials, customer information, and organisation-specific material out of every contribution — issues, pull requests, commits, and screenshots included.

## Before opening an issue

- Search existing issues and pull requests first.
- Use a public issue for reproducible bugs, feature proposals, and non-sensitive documentation problems.
- Use the private process in [SECURITY.md](SECURITY.md) for suspected vulnerabilities. Do not put credentials, private mail, tenant identifiers, or exploit details in a public issue.

## Local setup

```sh
git clone https://github.com/Rob142857/cmail.git
cd cmail
pnpm install
pnpm setup
pnpm db:migrate:local
pnpm dev
```

Edit the ignored `apps/web/.dev.vars` created by `pnpm setup` and use
development-only credentials. Never reuse production secrets locally or commit
`.dev.vars`, Wrangler tenant configuration, database exports, message content,
or logs.

## Making a change

1. Keep the change focused; explain the user or operator problem it solves.
2. Follow existing TypeScript, Svelte, and SQL patterns.
3. Keep organisation names, domains, addresses, and deployment IDs configurable.
4. Treat every request value as untrusted, including values from managers.
5. Preserve role checks, mailbox-assignment checks, audit events, and safe handling of message HTML and attachments.
6. For schema changes, keep setup idempotent and document how an existing deployment upgrades.
7. Update user-facing documentation when configuration or deployment behavior changes.

## Validation

Run the checks in the repository:

```sh
pnpm lint
pnpm check
pnpm test
pnpm build
```

Before requesting review, run the combined suite:

```sh
pnpm validate
```

Maintainers preparing a public release or mirror must use the stricter gate,
which also scans every reachable Git object without printing matched values:

```sh
pnpm release:check
```

### Mobile and accessibility suite

UI changes also run the Playwright suite in `e2e/mobile/`. It builds the app,
serves it with `wrangler pages dev` over local HTTPS, applies every migration
to a throwaway local D1 under `.tmp/e2e-mobile/`, and seeds invented users and
messages (`e2e/mobile/seed-data.mjs`). Outbound delivery is off, so nothing
leaves the machine.

```sh
npx playwright install chromium webkit   # once per machine
pnpm test:mobile                         # Pixel 7, Galaxy S24 (360px), iPhone 14, desktop
pnpm test:mobile:update                  # refresh screenshot baselines after an intended UI change
pnpm test:mobile:report                  # open the HTML report
```

It checks console errors, sideways scroll at 360/375px, 44px touch targets,
keyboard focus, axe-core (serious and critical only), dark mode, the
on-screen keyboard, offline behaviour and per-device screenshots
(`e2e/mobile/__screenshots__/<platform>/<device>/`). Known bugs are listed in
`e2e/mobile/known-bugs.ts` and run as expected failures; when you fix one,
its test reports "Expected to fail, but passed" and you delete the entry.

Two narrower commands are also available: `pnpm secrets:scan` checks tracked
and untracked files for likely credentials, and `pnpm secrets:history` runs
just the Git-history scan that `release:check` includes.

Automated coverage is not yet complete. Manually exercise the paths your change affects and describe that verification in the pull request. For mail-flow changes, cover as applicable:

- unauthenticated and unauthorized requests;
- personal and shared mailbox permissions;
- internal and external recipients;
- inbound parsing and rejected recipients;
- attachments and blocked file types;
- drafts, retries, and provider failures;
- mobile layout and keyboard navigation.

Include a focused regression test with bug fixes when practical. Document any new test tooling and make it runnable from the workspace root.

SQL behaviour (triggers, constraints, `ORDER BY`) belongs in a test against the real migrations, not a hand-written mock. The web app uses `apps/web/src/lib/server/mcp/testing/harness.ts`; the email worker uses `apps/email-worker/src/testing/sqlite-d1.ts`. Both run every migration on in-memory `node:sqlite`. Email-worker tests that need Node modules are named `*.node.test.ts`, so the Worker code itself is still type-checked with Workers types only. `pnpm test` from the root runs them all.

## Pull requests

A useful pull request includes:

- a concise problem statement and solution;
- security, privacy, compatibility, and migration impact;
- screenshots for visible UI changes;
- commands and manual scenarios used for verification;
- documentation updates;
- no unrelated formatting or generated files.

Maintainers may ask for a smaller scope or more tests before review. Review does not guarantee a change is safe for every deployment — operators still need to assess their own environment.

## Commit hygiene

Use clear, imperative commit messages. Before pushing, inspect the full diff and staged file list:

```sh
git diff
git diff --staged
```

If a secret or private record enters Git, stop. Revoke or rotate it first, then follow an appropriate history-removal process — deleting the current copy does not remove it from Git history.

## License

By contributing, you agree your contribution is licensed under the repository's [MIT License](LICENSE).

For support and question routing, see [SUPPORT.md](SUPPORT.md).
