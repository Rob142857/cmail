# Template security review — 13 September 2026

Scope: authentication and sessions; manager authorization and auditing; mailbox and draft isolation; attachment access and HTML rendering; inbound/outbound email and calendar processing; quotas; dependencies, secrets handling and CI. This is a source review with regression testing, not an independent penetration-test certification or proof that no vulnerabilities remain.

## Findings and changes

| Area | Finding and resolution |
|---|---|
| Inbound calendar authorization — high | Untrusted calendar parts could change stored events. Automatic writes now require trusted DMARC results and sender/organizer or responding-attendee matching. Updates must also match the existing event's organizer, preventing a different authenticated sender from claiming a known UID. |
| Calendar resource consumption — medium | Calendar MIME parts lacked separate parsing and database fan-out budgets. Input bytes, physical lines, event and attendee counts, and field lengths are now bounded. Oversized identifiers are rejected rather than truncated into another identity. |
| Calendar sending — medium | Create, cancel and RSVP paths bypassed compose's user-wide send/work limits. These paths now consume the same rate-limit buckets before sending or modifying meeting state. |
| Draft isolation — medium | Legacy ownerless drafts were admitted by a NULL-owner visibility rule. The shared predicate now excludes unowned drafts and preserves owner-only access for drafts moved into Trash or other folders. Regression tests execute the actual predicate in SQLite, including NULL semantics. |
| Manager lifecycle | Creation, promotion and reinvitation now enforce the existing Google/Microsoft identity requirement, including accounts with no bound identity. This closes eligibility gaps and avoids issuing unusable manager invitations. |
| Database diagnostics | Dashboard, Audit, Investigate and Trace failures use a safe message and opaque reference. Bounded exception diagnostics stay in server logs with that reference. Trace now displays its loader failure instead of silently appearing empty. Server logs must remain access-controlled. |
| HTML complexity scan — CodeQL #3/#4 | Replaced an overlapping tag regex on untrusted email HTML with a forward-only scanner. Existing tree sanitization and size/depth limits remain in place. No timing benchmark was performed; the scanner's high security label is not a measured denial-of-service result. |
| Configured push hosts — CodeQL #2 | Replaced boundary-dot regex trimming with linear index trimming. Input is operator configuration, so the scanner's high label does not establish an unauthenticated exploit path. |
| Text conversion / paste — CodeQL #1/#7 | Replaced regex tag stripping in the plain-text converter and paste-emptiness check. These are defensive changes; no XSS exploit was demonstrated. Plain-text output still requires HTML escaping, and the paste fixture is not a browser sanitizer security proof. |
| CI supply chain | GitHub Actions use verified full commit IDs rather than movable major-version tags. No workflow permissions were expanded. |

The originally reported intermittent Investigate D1 failure was not reproduced. Schema and production bindings were healthy during the operational investigation. Filter/count/summary parameter wiring has regression coverage, but that mocked test does not reproduce Cloudflare runtime behavior. The new reference and server diagnostic support further investigation if the incident recurs.

## Update notifications

The management console identifies the web build and checks the configured public GitHub repository's `main` branch hourly while open. It distinguishes newer source, identical history, custom/diverged builds, and unavailable checks. The manager can review a comparison and open a support-email draft. `UPDATE_SUPPORT_EMAIL` in the web Wrangler manifest selects the service desk; a blank value falls back to normal site support. No deployment credentials or automatic updater are added to the application.

## Review evidence

- Final `pnpm release:check` passed: 55 shared tests, 134 email-worker tests, 571 web tests (760 total), type checks, lint, production build, image-runtime validation, configuration checks, and source/history secret scans.
- Local D1 fresh-install and upgrade verification passed for all 15 existing migrations; this release introduces no schema migration.
- Dependency auditing and GitHub Dependabot reported no known advisories in the pinned dependency set at review time.
- Source and reachable Git-history secret scans passed. These scanners cover known patterns and do not establish that every possible credential format is absent.
- Five open CodeQL alerts on the preceding source revision were assigned for review. Scanner severity is distinct from demonstrated exploitability. Alert status requires a fresh GitHub analysis of the committed changes; alerts are not manually dismissed as part of this work.
- CI action references are pinned to verified full commit IDs. Existing Dependabot configuration can propose future action updates.

## Operational limits

The update notice measures the web build, not the separately deployed email Worker. New commits are not automatically certified releases. Private repositories and unavailable history require operator review. Browser-based authenticated production verification requires an existing signed-in session; an unauthenticated page check does not establish successful mail delivery or manager workflows.

When `INBOUND_AUTHSERV_ID` is unset or trusted DMARC does not pass, received email and its calendar attachments remain available but automatic inbound calendar mutations are skipped. Do not guess the identifier: verify the receiving boundary's actual Authentication-Results behavior before configuring trust. Attachment malware scanning and user-enabled remote-image tracking remain outside these fixes.
