# Changelog

Notable changes to cmail are recorded here. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and intends to use
[Semantic Versioning](https://semver.org/) after the first stable release.

## [Unreleased]

### Added

- A Microsoft-style mailbox assignee picker that resolves people through their
  canonical organisational personal mailbox while persisting stable account
  identifiers.
- Durable personal-mailbox ownership and a fail-closed legacy migration that
  quarantines ambiguous records for deliberate operator review.
- Personal rich-text signatures, optional organisation-wide signatures, and
  Manager configure-and-lock controls with protected compose previews.
- A screenshot-led product tour using fictional demonstration data, plus a
  complete feature inventory and dedicated signature operator documentation.
- Standards-aligned High, Normal, and Low message importance across inbound
  parsing, drafts, external providers, Sent copies, and mail views.
- Reply all recipient handling, RFC-style References ancestry, inline MIME image
  rendering, and an RFC 9989-era SPF, DKIM, DMARC, MTA-STS, TLS-RPT, and
  receiver-policy operations guide.
- The official orange Deploy to Cloudflare button with an explicit guided-import
  boundary for the current Pages-plus-Worker monorepo.

### Changed

- Unavailable recipients now return one neutral, cmail-labelled permanent SMTP
  diagnostic for unknown, disabled, and offboarded addresses. The sender's mail
  system may render its own non-delivery report; cmail sends no autoresponder
  and consumes no outbound quota.
- Account provisioning now requires one personal mailbox on `MAIL_DOMAIN`;
  mailbox delegation is restricted to shared mailboxes and excludes paused,
  offboarded, disabled, ownerless, and wrong-domain identities.
- Offboarding now revokes sessions, invitations, and notification endpoints,
  disables the owned personal mailbox, removes shared-mailbox access, and makes
  published positions internal. Reactivation restores none of those grants.
- Signature layers now render personal then organisation content below the
  sender's text and above quoted history in new messages, replies, and forwards.
- Product security copy now distinguishes cmail controls and guidance from
  authentication policy enforced by the deployed receiving provider.
- Cloudflare production delivery now uses a private Pages service binding to the
  email Worker's native Email Sending binding; the API-token REST path remains
  an optional fallback. Opaque native delivery IDs are stored separately from
  RFC `Message-ID`; a validated REST `result.message_id` is used when present.
- Mixed local/external mail now preserves one canonical visible To/Cc set. The
  Cloudflare REST path uses raw MIME with a separate external SMTP envelope;
  native Cloudflare and Postmark route the complete recipient set through the
  provider so local recipients return through Email Routing exactly once.
- Reply and Forward preserve safely sanitised HTML quotes, Forward omits reply
  headers, expose original parts for deliberate forwarding, and keep Back
  navigation draft-safe. Reply from Sent targets the original recipients, and
  partial REST delivery is surfaced instead of appearing fully successful.

### Security

- Added non-enforcing, pseudonymized native Cloudflare inbound abuse signals
  with a separately rate-limited generic alert (at most once per colo/minute);
  these signals never reject mail or avoid recipient/D1 work.
- Unavailable-recipient rejection remains an early, read-only path: it neither
  discloses prior mailbox existence nor parses or stores message content,
  creates per-attempt trace/rate rows, or invokes any outbound provider.
- Mailbox and organisation-management surfaces no longer use or disclose an
  external Google/Microsoft sign-in address as the person's mail identity.
- Personal-mailbox ownership and its Full owner assignment are immutable at the
  database layer; lifecycle and delegation writes recheck eligibility at the
  point of mutation.
- Signature HTML is bounded and sanitised before storage and again before use;
  self-service saves cannot race and overwrite a Manager lock.
- Pinned the patched Nano ID 3.3.17 transitive dependency after the release
  audit identified GHSA-2v37-7h3g-55p8.
- Bounded and validated the private outbound Worker request, kept that Worker
  off public HTTP routes, verified production/preview Wrangler isolation, and
  restricted inline images to authenticated, same-origin safe raster
  attachments.
- Added an immutable D1/R2 outbound journal: provider dispatch is claimed once,
  accepted sends materialize locally with deterministic IDs, ambiguous outcomes
  fail closed, active quota reservations cannot expire underneath recovery,
  confirmed failures release quota atomically, and edited draft generations
  rotate without weakening accepted-send tombstones.

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
