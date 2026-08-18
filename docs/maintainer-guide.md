# Maintainer release guide

This guide covers public-repository and release hygiene. It does not replace
the deployment or operations checklists used by each cmail operator.

## Repository settings

After creating or transferring the public GitHub repository:

- set `main` as the default branch;
- set a concise repository description and add discoverability topics such as
  `email`, `self-hosted`, `cloudflare`, `sveltekit`, `oauth`, and
  `email-routing`;
- upload a PNG, JPG, or GIF social preview derived from
  `apps/web/static/og-image.svg` under **Settings → Social preview**;
- enable private vulnerability reporting and review the contact path in
  [SECURITY.md](../SECURITY.md);
- enable dependency graph, Dependabot alerts, secret scanning, and push
  protection where available;
- protect `main` with pull requests, successful CI checks, resolved review
  conversations, and protection from force pushes and deletion;
- grant write, administration, Pages, DNS, and provider access only to people
  who need it;
- create the labels referenced by issue forms and `.github/release.yml`, or
  adjust that metadata to the repository's chosen labels.

Repository security features complement the local release gates; they do not
make committed credentials safe. Revoke any exposed value before addressing
its Git history.

GitHub's current social-preview requirements are documented in
[Customizing your repository's social media preview](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).

## Prepare a release

1. Work from an up-to-date, reviewed branch with no unrelated changes.
2. Review `git diff`, dependency changes, documentation, and the full commit
   list. Run `pnpm db:migrate:verify` to apply and inspect migrations in a
   fresh temporary D1 (Cloudflare's hosted database).
3. Update [CHANGELOG.md](../CHANGELOG.md) with user-visible, operational,
   migration, security, and compatibility notes.
4. Run `pnpm release:check`. A source or reachable-history secret finding is a
   release blocker.
5. Complete affected manual scenarios from
   [deployment verification](deployment.md#verification) in an isolated staging
   environment.
6. Confirm rollback, backup, restore, and credential-rotation owners.
7. Create an annotated version tag only after the release commit is approved.

For identity changes, inspect the complete authorization-code and enrolment
flow, not just the sign-in button. Confirm both providers obtain identity from
access-token UserInfo, returning accounts resolve solely by provider plus
`sub`, invitation hashes remain single-use and expiring, resend revokes older
links, and raw invitation/bootstrap credentials never enter provider callbacks
or logs. A release must not reintroduce Microsoft `/me`, email/UPN lookup, or
ID-token claims as an account selector.

## Release notes

GitHub's generated release notes use `.github/release.yml` for categories.
Review generated notes rather than publishing them verbatim. Call out:

- required configuration or secret changes;
- D1 migrations and upgrade order;
- changes to OAuth callbacks, UserInfo endpoints, identity audiences, scopes,
  immutable subject binding, enrolment, bootstrap, or sessions;
- data exposure, retention, mail-flow, or DNS implications;
- known limitations and staging evidence.

Do not include private issue details, deployment identifiers, production URLs,
message content, personal data, or secret values in commits, tags, artifacts,
screenshots, or release notes.

[← Documentation home](README.md)
