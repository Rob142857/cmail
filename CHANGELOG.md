# Changelog

Notable changes to cmail are recorded here. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and intends to use
[Semantic Versioning](https://semver.org/) after the first stable release.

## [Unreleased]

## [0.1.0] - 2026-08-04

### Added

- Generic, environment-driven organisation branding and deployment settings.
- Versioned D1 migrations, local migration verification, automated tests, CI,
  CodeQL analysis, dependency updates, and source/history secret gates.
- Configurable organisation hierarchy and privacy-safe directory controls.
- Google and Microsoft sign-in that appears only when the selected provider is
  completely configured, with immutable provider-subject bindings and
  single-use invitation enrolment.
- Public-project documentation, contribution guidance, issue forms, and
  repeatable Cloudflare setup templates.
- Optional, user-enabled Web Push notifications with generic new-mail payloads
  and no sender, subject, mailbox, address, body, or attachment data.
- Atomic inbound, retained-storage, outbound-work, and draft guardrails that
  fail closed before provider or object-storage work.

### Changed

- Hardened OAuth, sessions, policy acceptance, message permissions, inbound and
  outbound processing, rate limits, idempotency, attachment handling, and error
  responses.
- Reworked mail and administration experiences for accessibility, responsive
  use, and clearer management workflows.

### Security

- Kept deployment credentials, tenant identifiers, and organisation-specific
  material out of reusable templates.
- Added release checks that reject likely credentials in the source tree or
  reachable Git history without printing matched values.
