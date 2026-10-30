# Changelog

Notable changes to cmail are recorded here. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and intends to use
[Semantic Versioning](https://semver.org/) after the first stable release.

## [Unreleased]

### Added
- Click-time link checks: message links go through `/link`, which checks the site against a local copy of the CERT Polska Warning List (refreshed hourly by the email Worker; needs Workers Paid) and shows a warning for listed sites. A backstop only: coverage is mostly Polish threats, and unlisted links are never called safe. Signed links prevent `/link` being used as an open redirect.
- Optional backup Worker (`apps/backup-worker`): hourly incremental copy of mail bodies and attachments to a separate private R2 bucket, a daily manifest of every object, a daily NDJSON dump of every D1 table plus the schema, and deletion-honouring retention (deleted mail is dropped from the backup after `BACKUP_RETENTION_DAYS`, default 30). Scheduled only, no HTTP surface. See docs/deployment.md, "Automated backups".
- Inbox rules, like Outlook's (Mail > Settings > Rules): per-mailbox rules for anyone with full access, with conditions (From, Sent to, subject/body/header/address text, where my address appears, attachment, importance, size, or all messages), exceptions, and actions (move to Archive, Junk or Deleted, mark read, star, set importance). Rules run in order with "stop processing more rules", on external mail in the email worker and on mail between cmail mailboxes, after organisation junk filtering, and never on quarantined mail. Includes Create rule from a message, Run now on the newest 1,000 Inbox messages, mail-trace notes, and audit records. Rules never forward or redirect mail. New `inbox_rules` table (migration `0018`): run `pnpm db:migrate` before deploying the email worker and web app.
- Outlook-style formatting bar in compose: font and size, bold, italic, underline, strikethrough, font and highlight colour, lists, indent, alignment, link (Ctrl+K, http(s) and mailto only), quote, clear formatting, undo and redo, with Outlook's shortcuts, pressed states, tooltips and arrow-key navigation. Built on TipTap's text-style and text-align extensions (3.31.4), plus a small indent extension. On phones it is one swipeable row with the most-used controls, a More sheet and 44px targets, stuck above the keyboard.
- Default font: new messages, replies and forwards start in Aptos 12 pt (falling back to Calibri, Arial, sans-serif), in black, like Exchange/Outlook. Each person can pick another font and size under Mail > Settings > Font and signature (new `compose_preferences` table, migration `0017`; existing deployments run `pnpm db:migrate` before `deploy:web`, and until then compose falls back to Aptos 12 pt). Sent HTML is wrapped in a container with that font and size so Outlook, Gmail and Apple Mail start from the same font.
- Paste from Word and Outlook keeps bold, italic, underline, lists (Word's paragraph lists become real lists), links, colours and sizes, and strips `mso-` styles, classes and conditional comments.

### Changed
- Docs: deployment guide adds point-in-time recovery with D1 Time Travel (bookmark before migrations, approved in-place restore, rehearsal on a preview database) and notes that it does not cover R2.
- CI: a new `E2E accessibility` workflow runs the axe and smoke specs of the mobile suite (Pixel 7 and desktop Chrome) on every pull request and push to main, against a local build with invented fixtures.
- Patch updates (late October 2026): TipTap 3.32.1, Svelte 5.57.3, typescript-eslint 8.72.1, Wrangler 4.155.0 and workers-types 5.20261029.1. No behaviour change intended.
- MCP 2026-07-28 recommendations: every modern result carries `serverInfo` in `_meta`; a modern `ping` gets HTTP 404 and `-32601` (ping was removed in that revision; legacy clients keep it); `move_message` is marked destructive so hosts can ask before moving mail to Trash or Spam; Client ID Metadata Documents are cached for their `Cache-Control` max-age (5 minutes to 24 hours, 24 hours when none is given) instead of always a day; and the consent screen warns when an app asks to return to a program on this computer (a loopback address).
- MCP 2026-07-28 conformance: modern `server/discover` and `tools/list` results now carry the required caching hints (`ttlMs` and `cacheScope`: `public` for discover, `private` for the scope-dependent tool list), and a modern request whose `_meta` lacks `io.modelcontextprotocol/clientCapabilities` (or, with a modern `MCP-Protocol-Version` header, lacks `io.modelcontextprotocol/protocolVersion`) is rejected with HTTP 400 and `-32602`, as the revision requires. Legacy (initialize-based) clients are unaffected.
- Compose polish: the message body has comfortable inner padding (20px on desktop, 16px on phones) so text and the caret no longer sit on the edge; the compose column fills the pane up to 1120px instead of 820px; and in dark mode the body sits on the surface tone (display-only colour inversion, so default and pasted black text read light) instead of a bright white sheet, with a primary underline as the focus cue. Styling only.
- No-borders pass on the mail surfaces: compose drops its framing card (header lines keep one faint hairline, the formatting bar loses its grey band and button boxes, Rich text / Plain text are quiet tabs, Save draft and Add files are text buttons), the inbox list and reading pane lose their outer frames, attachment chips and labels are tone-only, and in the mail sidebar the mailbox picker is a quiet select, the pane and footer dividers become a tone step, section labels drop their caps and New-mail alerts' Turn off is a text button. Styling only.
- No-borders pass for settings, management, calendar, sign-in and help: card frames, boxed sub-panels and outlined secondary buttons are gone; sections are separated by headings and space, secondary actions are quiet text buttons (one filled primary per view), lists keep only quiet row separators, and fields are single typed-on lines. Focus rings, checkbox and toggle outlines, popover and side-panel edges, and the Google and Microsoft sign-in buttons keep their borders. Restyle only.
- Sleek uplift: sign-in, email-code sign-in and the help centre are lighter: hairline cards, typed-on-line code fields, one title size and plain section labels. Styling only.
- Calendar looks lighter: the agenda is one hairline-edged surface with quiet day headings and thin row separators instead of a shadowed card with grey day bars, and the new-meeting form uses single typed-on lines with a hairline rule instead of boxed fields.
- The Management centre looks lighter, like Outlook on the web: pages sit on a white canvas, form fields are typed-on lines with a small label instead of boxes, settings are grouped by headings instead of bordered cards, tables and lists drop their outer boxes for quiet row separators with muted secondary text, row buttons on People are quiet and show on hover with a mouse, status labels lose their caps and borders, page titles share one size, and the public organisation directory follows suit.
- Reading a message looks lighter, like Outlook on the web: the toolbar is a quiet command bar (Reply is the one filled button), the message sits on one surface with a hairline edge instead of a shadowed card, attachments are plain file chips without a grey panel, the message body no longer has a second box around it (dark mode keeps a hairline edge on the white sheet), and the Details list and safety notices drop their heavy borders.
- Sleek uplift for settings: Font and signature, Rules (list and editor) and Connected AI apps use typed-on-line fields, hairline rules and a quiet list instead of boxed cards and fields. Restyle only.
- The inbox list is quieter, like Outlook on the web: no shadowed card, hairline row separators, plain muted mailbox labels instead of grey chips, and a bulk-action bar of quiet text buttons that fade (rather than grey out) when nothing is selected. Same actions, same behaviour.
- Compose, reply and forward look like Outlook: From, To, Cc, Bcc and Subject are single typed-on lines with a hairline rule instead of boxed fields, importance sits at the end of the subject line, and the message body fills the rest of the page without a heavy border.
- Dependency upgrade (October 2026): SvelteKit 3 with adapter-cloudflare 8 (settings now live in the `sveltekit()` options in `apps/web/vite.config.ts`; `svelte.config.js` is gone; `$lib` imports became `#lib`; `handle` rebuilds `event.platform` from `cloudflare:workers` because the adapter no longer provides it; MCP authorisation errors redirect with `external: true`), postal-mime 4 (fixture suite in `apps/email-worker/src/postal-mime-fixtures.ts`), TipTap 3.32, Vite 8.3.5, Vitest 5.0.5, Wrangler 4.151.3, ESLint 10.13, pnpm 12.15.0 and newer GitHub Actions. The web app stays on TypeScript 6.0.x because SvelteKit 3 and svelte-check require it; `svelte-check --tsgo` still checks with TypeScript 7.0.2. Node 22.17 is now the minimum (SvelteKit 3).
- The compose sanitizer now keeps a minimal `style` allowlist on span, p, li, blockquote and div (font family from the fixed list, bounded font size, hex/rgb colour and highlight, text-align, underline/line-through, weight, italic, bounded margin-left). Every other property, and any style with url(), expression(), escapes, comments or behaviour, is removed. The reading sanitizer and CSP are unchanged. Plain-text mode and the generated text/plain part are unchanged.
- Mail > Settings > Email signature is now **Font and signature**.

### Fixed
- Links in a message now open in a normal tab. They opened in a tab that inherited the message frame's sandbox, which sites with strict headers (Instagram, Facebook) refuse with `ERR_BLOCKED_BY_RESPONSE`. The frame adds `allow-popups-to-escape-sandbox`; it still never runs script.
- Pages no longer break on a hard refresh behind a Cloudflare zone with Email Address Obfuscation on (the default for new zones). Cloudflare rewrote addresses in the served HTML, so the inbox failed to hydrate (`hydration_mismatch`). The app shell now wraps the page body in `<!--email_off-->` comments, which Cloudflare honours, so pages are left alone while still being compressed at the edge. The retired `interest-cohort` feature is dropped from `Permissions-Policy`, which browsers reported as unrecognised.
- On phones, the bottom bar in new message, reply, reply all and forward ran off the right edge once a draft saved: Send and Save draft were pushed off-screen and the page scrolled sideways. Back and Discard draft are now icon buttons on phones (named for screen readers), and the bar wraps rather than overflowing at very large text sizes. The same sideways stretch is fixed on Management > Quarantine (its tables now scroll inside their cards), in the approved sign-in country list, and in the help guides.
- Manager update notices showed "Update status unavailable" on Cloudflare because GitHub's unauthenticated REST limit is shared across Cloudflare egress addresses. The check now reads upstream `main` from Git's ref advertisement, shows "Up to date" or "Update available: <version>", caches at the edge, explains any failure, links the procedure for the configured `REPO_URL`, and can be turned off with `UPDATE_CHECK = "off"`.
- `deploy:landing` now requires `--project-name` and passes it to Wrangler, so a stray `wrangler.toml` in the checkout can't send the product page to another Pages project.

### Added

- Remote MCP (Model Context Protocol) server at `/mcp` so AI assistants
  such as Claude can work with mail, off until a Manager enables it in
  Management > Settings. Streamable HTTP, stateless, dual-era: the 2026-07-28
  revision (per-request metadata, validated mirrored headers,
  `server/discover`) and the initialize-based 2025-11-25, 2025-06-18 and
  2025-03-26 revisions. Thirteen tools for reading, searching, drafting,
  sending, organising and calendar reading, each limited by scope, by the
  mailboxes the person approved, and by their live delegation.
- OAuth 2.1 authorization server for it: RFC 9728 and RFC 8414 discovery,
  Client ID Metadata Documents and RFC 7591 registration, authorization code
  with PKCE (S256 only), exact redirect matching, RFC 8707 audience binding,
  RFC 9207 `iss`, 1-hour access tokens, rotating refresh tokens with reuse
  detection, a 90-day connection limit, and RFC 7009 revocation. Codes,
  tokens and client secrets are stored only as hashes.
- Browser consent screen showing the app (verified host or unverified name),
  return address, scopes (read and draft pre-ticked, send opt-in) and
  personal and shared mailboxes.
- Mail > Settings > Connected AI apps, to review and disconnect apps.
- Per-call audit rows (tool, mailbox, outcome; no content), per-connection
  rate limits, and `MCP_SEND_RATE_PER_HOUR`.
- Migration `0016_mcp_oauth.sql` (additive: new tables only).
- [AI agents and MCP](docs/mcp.md) guide with the threat model and limits.

### Changed

- SvelteKit's built-in CSRF origin check is now enforced by an identical
  check in `hooks.server.ts`, which exempts only the cookie-less
  `/oauth/token` and `/oauth/revoke` endpoints that native OAuth clients
  call without an `Origin` header.
- Pausing or offboarding a person also disconnects their AI apps.
- Message move rules are shared between the message APIs and MCP tools.

### Fixed

- Message bodies shown in a frame (reading view, quoted originals) were not
  resized to their content after a full page load. Svelte's server render
  turned the frame's load handler into an inline `onload` attribute, which
  the app's CSP blocks, so the load event was lost before hydration. The
  listener is now attached in script and a frame that already loaded is
  measured straight away.
- A signature stored only as plain text now also appears in the HTML part of
  outgoing mail (it was previously sent in the text part only).
- In development builds, a full page load of compose (or of mail with a
  pending toast) threw "Cannot call replaceState(...) before router is
  initialized" from `afterNavigate`, which stopped the draft id reaching the
  URL. The URL update now runs right after router start-up.

- Compose opened by a full page load (bookmark, new tab, refresh of
  `/mail/compose`) could not send. The page pinned its recovery id in the URL
  with `replaceState()` from `onMount`, which on hydration runs inside
  SvelteKit's root constructor, before the router has a root. The throw left
  the router without one, so the first autosave failed with "Cannot read
  properties of undefined (reading '$set')", the next save reported "Draft
  changed in another tab", and Send never completed. The URL is now pinned
  from `afterNavigate`, and a URL update can no longer leave a saved draft
  with a stale version.
- `pnpm deploy`, `deploy:web`, and `deploy:email-worker` now call each app's
  `deploy` script with `pnpm --filter … run deploy`. Under pnpm 12 the bare
  `pnpm --filter … deploy` form invokes pnpm's built-in workspace deploy
  command and fails with `ERR_PNPM_INVALID_DEPLOY_TARGET`.

### Security

- Clear all 22 `pnpm audit` findings with in-range overrides: undici ^7.29.1,
  devalue 5.9.4, brace-expansion ^5.0.12, source-map-js ^1.2.2,
  postcss-selector-parser ^7.1.6, and Miniflare's Sharp 0.35.5 (install
  scripts still denied). No majors changed.

### Changed

- Upgrade the build and mail toolchain to pnpm 12.5.1, TypeScript 7.0.2,
  Vitest 5.0.1, postal-mime 3.0.0, Vite 8.3.0, Svelte 5.57.1, and Wrangler
  4.136.1, alongside current compatible direct dependencies and pinned CI
  actions. Node 24 LTS is recommended; Node 22.12 is the minimum.
- Keep TypeScript 6.0.3 solely as the web tooling's required compiler API,
  while validating Svelte with both the existing checker and TypeScript 7's
  native checker. No peer constraints are bypassed. See the
  [dependency upgrade review](docs/dependency-review-2026-09-22.md).

### Added

- Rich-text compose. The message box is now a TipTap (ProseMirror) editor with
  bold, italic, underline, links, bulleted and numbered lists, quote and clear
  formatting, and pasted content is cleaned before it enters the editor. A
  **Plain text** toggle keeps the old textarea, the choice is remembered per
  device, and drafts reopen in the mode they were saved in. The editor is
  loaded on demand by the compose page only. The server never trusts editor
  output: it re-sanitizes the HTML with a narrow compose allowlist (no
  attributes except checked link targets, no styles, scripts or images) using
  the existing rehype-sanitize pipeline, then derives the text/plain part
  from the sanitized tree, so every message goes out as multipart/alternative
  with readable lists, quotes and link addresses. Replies and forwards keep
  the quoted original as HTML, now also quoted with `> ` in the text part.
  Reading and its CSP are unchanged. No migration.

- Remember the provider only after successful returning-account OAuth so a
  later signed-out mailbox visit can start fresh OAuth without guessing an
  identity. The bounded host-only preference is cleared on explicit logout;
  errors retain the normal chooser and enrollment/bootstrap remain explicit.
- Local PNG/AVIF and Miniflare Images checks in the validation gate.
- Pin Vitest and its mocker to 4.1.11 and scope a Sharp 0.35.4 override to
  Miniflare, addressing GHSA-82fw-gwwq-j7x9 and GHSA-rgj7-g3m4-5g8c without
  changing the pnpm or Wrangler toolchain. Sharp install scripts are denied.
- Optional `?sso=1` provider sign-in links that reuse an existing cmail session
  or allow the provider to reuse its browser session without a forced account
  chooser. Invitation and bootstrap account selection remain explicit; the
  existing provider-subject binding and authorization gates are unchanged.
  See the [staff sign-in contract](docs/staff-sign-in.md).
- Provider-aware manager invitations: a Google- or Microsoft-hosted address
  gets a one-button "Activate your mailbox" email straight into that
  provider's sign-in; an address hosted elsewhere gets the same button, but
  it leads to invitation-scoped email one-time-code enrolment instead; and a
  host that can't be verified is refused with a plain error rather than
  silently accepted.
- Email one-time-code sign-in as a third, invitation-scoped identity method
  alongside Google and Microsoft: 8-digit hashed codes with a 5-minute
  expiry and 5 attempts, an identical response regardless of why a request
  or code failed, optional Cloudflare Turnstile on the request form, and a
  session-lifetime cap independent of the configured session TTL. The
  Manager role still always requires a Google or Microsoft identity.
- Manager travel approvals: an organisation can restrict sign-in to approved
  countries across every sign-in method, off by default. A refused sign-in
  creates a pending request, notifies managers by throttled email, and is
  approved for 24 hours, 7 days, or 30 days, denied, or revoked from a
  dedicated panel with a full audit trail. The very first manager's
  bootstrap sign-in is exempt, so a deployment can never lock itself out.
- Real Bcc support end to end: envelope-only delivery so To/Cc recipients
  never see who was blind-copied, deduplication against To and Cc, a
  combined recipient cap, the sender's own sent-copy view of who was
  Bcc'd, and replies that never inherit the original Bcc list.
- Inbound spam scoring and quarantine: the boundary's spam score is recorded
  on every message and in Mail trace, quarantine engages only at an explicit
  operator-set threshold, organisation-wide sender allow/block rules always
  apply, and a Manager release page restores quarantined mail to the inbox.
- An in-app and public support process with trained internal Level 1 triage,
  safe evidence handling, RME Solutions Technology Level 2 escalation, and a
  clear boundary between defects, agreed operational support, and quoted work.
- A current ISO and ITIL alignment map covering information security, service
  management, privacy, continuity, incident response, software quality,
  records, cloud responsibilities, and evidence without claiming certification.
- A public, printable Security & Assurance summary, an in-app deployment
  evidence checklist, and an operator privacy/data-handling guide for managers,
  reviewers, and auditors.
- Recovery-grade D1/R2 backup and isolated-restore guidance plus version-aware
  Worker/Pages rollback procedures for new deployments.
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

- Compose no longer asks for confirmation before a message leaves the
  organisation. The warning step added friction without a matching safety
  benefit, so it's gone by design; provider and organisation rate limits can
  still reject a send.
- Signature previews in the editor, compose, and settings now render in a
  pinned light colour scheme, so a signature authored with dark, app-theme
  text no longer disappears against the app's own dark background.
- Admin → Mail trace, Investigate, and Audit log now surface the underlying
  error when a query fails, instead of the same empty state a genuinely
  empty result would show.
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

- Updated the transitive `nanoid` override to 3.3.18 to incorporate the latest
  upstream security fix; the release dependency audit reports no known
  vulnerabilities.
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
