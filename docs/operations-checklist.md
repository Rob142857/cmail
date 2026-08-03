# Operations checklist

Use this checklist for each environment. Adapt it to your organisation's change-management, privacy, retention, and incident-response requirements.

## Before a release

- [ ] Release commit reviewed and recorded
- [ ] `pnpm release:check` passes, including the reachable-history secret scan
- [ ] Manual regression scenarios recorded
- [ ] Dependency and security advisories reviewed
- [ ] No secrets, tenant IDs, private mail, or personal data in the diff
- [ ] D1/R2 backup or recovery point confirmed
- [ ] Schema changes reviewed against existing data
- [ ] OAuth callback URLs verified
- [ ] OIDC scopes and access-token UserInfo endpoints verified
- [ ] Invitation enrolment, expiry, single-use, and resend rotation tested
- [ ] Provider and Cloudflare administrative access reviewed
- [ ] Rollback owner and decision point identified

## After deployment

- [ ] Pages health and sign-in page verified
- [ ] Only intended OAuth providers shown
- [ ] Manager and standard-user authorization checked
- [ ] Known inbound recipient tested
- [ ] Unknown inbound recipient rejected
- [ ] Worker-only `INBOUND_SENDER_HASH_KEY` present and malformed/missing-key fail-closed behavior tested
- [ ] Inbound byte/count/body-complexity limits and shared mailbox storage quota exercised at exact boundaries
- [ ] Internal delivery tested
- [ ] External outbound tested, when enabled
- [ ] Sent/internal copies and draft create/growth/move refuse over-quota writes before provider or R2 side effects
- [ ] Draft save rate and per-user/mailbox row cap tested
- [ ] Attachment upload and download tested
- [ ] Audit and trace entries inspected
- [ ] Provider dashboards checked for errors
- [ ] Both bootstrap secrets absent after first-manager creation
- [ ] No bootstrap token/proof in URLs or logs; invitation tokens are removed before callbacks and absent from referrers/logs
- [ ] Browser notifications tested with generic payloads only, when enabled
- [ ] Web Push private key absent from Wrangler files and source, when enabled

## Routine operations

- [ ] Review active, paused, and offboarded users
- [ ] Review pending/unbound users and resend only after confirming the intended identity
- [ ] Review shared mailbox assignments and send-as/full permissions
- [ ] Review audit and trace anomalies
- [ ] Review mailbox reservation denials, D1/R2 growth, and orphan-object reconciliation results
- [ ] Review bounces, complaints, and provider reputation signals
- [ ] Confirm backups and perform scheduled restore exercises
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

Do not paste private messages, access tokens, OAuth secrets, or raw production exports into public issues.

[← Documentation home](README.md)
