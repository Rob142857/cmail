# AGENTS.md: cmail

> **Code floor:** no secrets in code, stage by path, lint and tests pass, no swallowed errors, validate every input, check auth on the server, no personal data in logs or git, and a fresh-context review before merge. The rules below and `CONTRIBUTING.md` still apply.

An open-source email platform on Cloudflare: a SvelteKit web app (`apps/web`), an Email Routing worker (`apps/email-worker`), an optional scheduled backup worker (`apps/backup-worker`) and shared code (`packages/shared`). It uses D1, R2 and Google or Microsoft sign-in. MIT licence. This repo is public.

## Commands (pnpm workspace)
- `pnpm install`
- `pnpm lint`: ESLint in `apps/web`, `tsc --noEmit` in the email worker (Workers types for Worker code; `tsconfig.node-tests.json` for Node-only `*.node.test.ts` files), and a type check in `packages/shared`
- `pnpm check`, `pnpm test`, `pnpm build`
- `pnpm validate`: the full gate (secrets scan, landing assets check, config check, lint, check, test, image runtime test, migration check, build, audit). Run it before asking for a review.
- `pnpm release:check`: `validate` plus a scan of the whole git history, for releases and mirrors.

## Rules
- **Public repo.** No secrets, tokens, real domains, organisation names, addresses, deployment IDs or personal data in code, docs, tests or commits. Keep everything deployment-specific configurable.
- Each deployment's config stays in its own clone, never in shared code.
- Treat every request value as untrusted, including values from managers. Keep role checks, mailbox-assignment checks, audit events and safe handling of message HTML and attachments.
- Schema changes are idempotent, come with an upgrade note, and need the owner's yes before any remote D1 migration.
- Stage by path. Never `git add -A`. Read `git diff --staged` before every commit.
- If a secret enters git: stop, rotate it first, then clean the history.
- A fresh-context review (a reviewer that didn't write the change) before merge. Fix or answer every finding in the PR.
