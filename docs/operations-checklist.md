# Operations checklist

Use this checklist for each environment. Adapt it to your organisation's change-management, privacy, retention, and incident-response requirements. See [Email authentication and sender requirements](email-authentication.md) for DNS validation, current receiver policies, and the bulk-marketing boundary.

## Before a release

- [ ] Release commit reviewed and recorded
- [ ] `pnpm release:check` passes, including the reachable-history secret scan
- [ ] Manual regression scenarios recorded
- [ ] Dependency and security advisories reviewed
- [ ] No secrets, tenant IDs, private mail, or personal data in the diff
- [ ] D1/R2 (Cloudflare's database and storage) backup point recorded together (D1 export checksum, R2 prefix, source resources, and creation time)
- [ ] Isolated D1/R2 restore rehearsal completed and validated before production mail flow
- [ ] Schema changes reviewed against existing data
- [ ] OAuth callback URLs verified
- [ ] OIDC scopes and access-token UserInfo endpoints verified
- [ ] Invitation enrolment, expiry, single-use, and resend rotation tested
- [ ] Provider and Cloudflare administrative access reviewed
- [ ] Rollback owner, decision point, prior Worker/Pages deployment IDs, and migration-compatibility decision recorded

## After deployment

- [ ] Pages health and sign-in page verified
- [ ] Only intended OAuth providers shown
- [ ] Manager and standard-user authorization checked
- [ ] Known inbound recipient tested
- [ ] Unknown inbound recipient rejected
- [ ] A disabled or offboarded address returns the same generic SMTP-time rejection as an unknown address; no cmail outbound auto-reply is sent
- [ ] Worker-only `INBOUND_SENDER_HASH_KEY` present and malformed/missing-key fail-closed behavior tested
- [ ] Native inbound actor, aggregate, and one-per-minute alert bindings have unique production/preview namespaces; a controlled threshold emits at most one generic no-PII Worker warning per colo/minute while delivery continues
- [ ] Inbound byte/count/body-complexity limits and shared mailbox storage quota exercised at exact boundaries
- [ ] Internal delivery tested
- [ ] External outbound tested, when enabled
- [ ] Outbound journal tested with a controlled failure before provider dispatch, after provider acceptance, and during Sent/internal materialization; accepted mail recovers without a second provider call
- [ ] Email Worker deployed before Pages; private `EMAIL_SERVICE` binding reaches the intended environment, while its opaque tracking ID remains separate from the wire RFC `Message-ID`
- [ ] Mixed local/external test delivers exactly once to each recipient and shows identical complete `To`/`Cc` roles internally and externally
- [ ] Production, preview, and local D1/R2/Worker resources are distinct; preview has `OUTBOUND_PROVIDER=none`, no `send_email` binding, no public Worker URL or route, and no production secrets
- [ ] Controlled received headers show `spf=pass`, `dkim=pass`, and aligned `dmarc=pass` at each material receiver
- [ ] MTA-STS policy fetch and TLS-RPT reporting verified, when enabled
- [ ] Current Google, Yahoo, Microsoft, and other material receiver policies and sender-volume classifications reviewed
- [ ] Outbound auto/explicit provider selection and incomplete-provider fail-closed behavior tested
- [ ] Cloudflare general-send 50-recipient and 5-MiB ceilings tested, when Cloudflare Email Service is enabled
- [ ] Sent/internal copies and draft create/growth/move refuse over-quota writes before provider or R2 side effects
- [ ] Draft save rate and per-user/mailbox row cap tested
- [ ] Attachment upload and download tested
- [ ] Audit and trace entries inspected
- [ ] Provider dashboards checked for errors
- [ ] Cloudflare Email preview retention is approved or disabled, and Email Sending logs—not inbound Email Routing summaries—are used for outbound checks
- [ ] Both bootstrap secrets absent after first-manager creation
- [ ] No bootstrap token/proof in URLs or logs; invitation tokens are removed before callbacks and absent from referrers/logs
- [ ] Browser notifications tested with generic payloads only, when enabled
- [ ] Web Push private key absent from Wrangler files and source, when enabled

## Routine operations

- [ ] Review active, paused, and offboarded users
- [ ] Review pending/unbound users and resend only after confirming the intended identity
- [ ] Review shared mailbox assignments and send-as/full permissions
- [ ] Review audit and trace anomalies
- [ ] Review **Admin → Mail trace → Delivery recovery**; reconcile every `dispatching` or `ambiguous` send with the provider before taking action, and allow `accepted` records to finish idempotent local materialization
- [ ] Review mailbox reservation denials, D1/R2 growth, and orphan-object reconciliation results
- [ ] Review bounces, complaints, and provider reputation signals
- [ ] Review Cloudflare Email Routing/Worker rejection metrics and logs for sustained abuse or unexpected unavailable-recipient volume; rejected inbound attempts are not durable per-attempt cmail trace records
- [ ] Review DMARC aggregate reports, authentication drift, and unauthorised senders; investigate every sustained failure
- [ ] Review MTA-STS and TLS-RPT failures, certificate changes, and MX drift, when enabled
- [ ] Confirm message purpose and volume remain within cmail's non-bulk scope; stop marketing or campaign use until the documented missing controls exist
- [ ] Review Cloudflare Email Sending quota, activity logs, native/service bindings, optional REST-token access, and preview setting, when enabled
- [ ] Confirm backups and perform scheduled restore exercises
- [ ] Retain D1 and R2 recovery points as matching pairs; test an isolated restore before relying on a new backup process
- [ ] Rotate secrets according to local policy
- [ ] Remove expired OAuth credentials and administrator access
- [ ] Apply dependency and platform security updates
- [ ] Review retention and policy versions with accountable owners
- [ ] Review retention audit events and Worker warnings; investigate any recurring `retention.backlog_remaining` or `retention.failed` event
- [ ] Confirm DNS and domain registrations remain controlled
- [ ] Review Web Push subscriptions, endpoint-host additions, and VAPID rotation plans, when enabled

## Incident response

1. Preserve relevant logs and record times in UTC.
2. Contain the affected account, credential, mailbox, route, or provider.
3. Rotate exposed secrets and revoke active provider credentials.
4. Assess mailbox, attachment, audit, trace, D1, R2, and build-log exposure.
5. Notify the appropriate internal, provider, legal, and regulatory contacts.
6. Restore service from a known-good state.
7. Document root cause, impact, and corrective actions.

For an unresolved outbound journal entry, preserve the journal row, targets, provider-result snapshot, audit records, and provider evidence. Never delete the row or release its reservations merely to make a retry possible. If the provider confirms acceptance, reconcile it as accepted and materialize the local copies; if it confirms non-acceptance, follow the documented terminal cancel path. If the outcome cannot be proven, retain the ambiguous tombstone and communicate with recipients rather than sending automatically again.

Do not paste private messages, access tokens, OAuth secrets, or raw production exports into public issues.

[← Documentation home](README.md)
