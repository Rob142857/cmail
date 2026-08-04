# Security checklist

This checklist replaces deployment-specific audit notes. It is a starting point, not a security certification or substitute for an independent review.

## Source and supply chain

- [ ] Git history and current tree scanned for credentials and private data
- [ ] Any exposed credential revoked, not merely deleted
- [ ] Dependencies reviewed and updated deliberately
- [ ] Lockfile changes reviewed
- [ ] Build and deployment run from a protected branch or trusted environment
- [ ] Cloudflare tokens use the minimum required scope

## Authentication and sessions

- [ ] At least one OAuth provider configured with an exact callback allowlist
- [ ] OAuth client secrets stored only in Cloudflare Pages secrets
- [ ] Microsoft tenant choice matches the intended audience
- [ ] Provider consent limited to `openid email profile`
- [ ] Access-token UserInfo is used, including `https://graph.microsoft.com/oidc/userinfo` for Microsoft
- [ ] Returning users resolve only by provider plus immutable UserInfo `sub`, never email, UPN, or ID-token claim
- [ ] `SESSION_SECRET` is random, unique to the environment, and rotated through a planned process
- [ ] Identity-provider multi-factor authentication and admin controls enabled
- [ ] Paused and offboarded users tested
- [ ] First sign-in requires a hashed, single-use 72-hour manager invitation and verified-email match
- [ ] Invitation capture cookie is `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, short-lived, and raw tokens do not continue through OAuth
- [ ] Resending an invitation revokes the previous token; used, expired, mismatched, and conflicting enrolments fail closed
- [ ] Bootstrap requires both a strong `BOOTSTRAP_ADMIN_TOKEN` and exact `BOOTSTRAP_ADMIN_EMAIL`
- [ ] `/bootstrap` accepts the token only by same-origin POST and issues only a signed 10-minute `HttpOnly`, `SameSite=Lax`, production-`Secure` proof
- [ ] Both bootstrap secrets removed after first-manager creation; neither bootstrap credential appears in URLs or logs

## Authorization

- [ ] Manager checks verified on every Admin load and action
- [ ] Mailbox access checked server-side, not only hidden in the UI
- [ ] Read, send-as, and full permissions tested independently
- [ ] Attachment downloads require access to the parent mailbox
- [ ] User-controlled mailbox IDs, addresses, roles, and permission strings validated
- [ ] Self-lockout and last-manager behavior reviewed for the deployment

## Message and attachment handling

- [ ] HTML bodies rendered with an appropriate sandbox and restrictive content policy
- [ ] Remote images are blocked by default and load only after an explicit user action with no referrer
- [ ] Inbound decoded HTML/plain text is byte-, element-, and depth-bounded and sanitized once before storage
- [ ] Attachment filenames, types, sizes, and download headers reviewed
- [ ] Dangerous inbound and outbound attachment extensions tested
- [ ] Message headers protected from CR/LF injection
- [ ] Provider error bodies and private message content excluded from public logs
- [ ] Outbound bodies and attachments are staged only under private R2 keys
      before dispatch; no public bucket or predictable unauthenticated download
      path exposes journal objects
- [ ] SHA-256 digests for the staged HTML, plain text, and every attachment are
      immutable in D1 and verified against the actual R2 bytes before provider
      dispatch and before each local copy
- [ ] The outbound journal, targets, and attachments are immutable after
      creation; only one active/materialized row can exist per compose or
      draft-generation key
- [ ] Provider dispatch requires the atomic pending-to-dispatching claim, and
      accepted/materialized recovery cannot invoke the provider again
- [ ] Sent and internal copies use deterministic IDs/keys and the journal cannot
      become materialized until every target is recorded
- [ ] Invalid, unknown-recipient, oversized, guarded, and duplicate inbound attempts cannot amplify persistent trace rows

## Data protection

- [ ] D1 and R2 access restricted to required applications and administrators
- [ ] `MAILBOX_STORAGE_QUOTA_BYTES` matches on Pages and the Worker and covers inbound, Sent/internal copies, and drafts
- [ ] Draft save rate and owned per-user/mailbox draft-row cap are configured and tested
- [ ] Journal-linked quota reservations survive ordinary expiry until the send
      is materialized or reaches an atomically released confirmed-failure state
- [ ] Backup, restore, retention, deletion, and legal-hold requirements defined
- [ ] Test data contains no copied production mail
- [ ] Logs have an owner, retention period, and access policy
- [ ] Privacy notice and acceptable-use policy reviewed for the deployment's jurisdictions
- [ ] Incident notification obligations documented

## Mail and DNS

Use [Email authentication and sender requirements](email-authentication.md) for
the underlying RFCs, Cloudflare record sets, receiver policies, and
bulk-marketing boundary.

- [ ] All legitimate senders for the domain inventoried before SPF changes
- [ ] Exactly one SPF record exists at each evaluated domain and remains within
      the RFC 7208 ten-DNS-lookup limit
- [ ] Provider-issued DKIM records verified and controlled messages show the
      intended signing domain and `dkim=pass`
- [ ] DMARC uses current RFC 9989 syntax, has no historic `pct`, `rf`, or `ri`
      tags, and controlled messages show visible-From alignment
- [ ] DMARC aggregate and any failure-report destinations, external
      authorisations, privacy, access, and retention are approved
- [ ] Optional MTA-STS policy matches every legitimate MX and was tested with
      monitored TLS-RPT before enforcement
- [ ] Major receiver policies and the deployment's sender-volume
      classifications reviewed against current official sources
- [ ] cmail is not approved for bulk marketing without separate consent, RFC
      8058 unsubscribe, suppression, reputation, abuse, and legal controls
- [ ] Email Routing sends only intended traffic to the Worker
- [ ] `INBOUND_SENDER_HASH_KEY` is a distinct 32-byte Worker secret and sender-HMAC values contain no raw address
- [ ] Unknown and inactive recipients reject as expected
- [ ] Outbound From addresses restricted to verified domains
- [ ] `OUTBOUND_PROVIDER` selection and fallback behavior match the intended provider; an incomplete explicit selection fails closed
- [ ] Cloudflare native `EMAIL` binding belongs only to the email Worker, the Pages `EMAIL_SERVICE` binding points to the intended environment, and no outbound API token is present on the default path
- [ ] Optional Cloudflare REST fallback account ID points to the intended account and its API token is stored only as a Pages secret with **Email Sending: Edit**, when enabled
- [ ] Cloudflare's 50-recipient and 5-MiB general-send ceilings are exercised before provider submission, when enabled
- [ ] Cloudflare Email preview access and about-seven-day content retention are approved, or preview is disabled on the sending domain
- [ ] Bounce, complaint, and abuse handling procedures defined

## Cloudflare and provider controls

- [ ] Administrative accounts protected with multi-factor authentication
- [ ] Least-privilege roles used for deployers and operators
- [ ] Production, preview, and local D1 databases, R2 buckets, email Workers,
      service bindings, OAuth registrations, and secrets are separate
- [ ] Pages variables and secrets reviewed after every deployment change
- [ ] Worker-only `send_email` binding has not been added to Pages; the production email Worker has `workers_dev=false`, `preview_urls=false`, `routes=[]`, and a reviewed private service-binding boundary
- [ ] Preview Pages uses `OUTBOUND_PROVIDER=none`; the preview email Worker has no `send_email` binding, `workers_dev=false`, `preview_urls=false`, and `routes=[]`
- [ ] D1 and R2 resource IDs point to the intended environment
- [ ] Alerts configured for authentication, routing, delivery, and provider anomalies

## Browser notifications, when enabled

- [ ] The same VAPID pair and subject configured on Pages and the inbound Worker
- [ ] `VAPID_PRIVATE_KEY` stored only in each runtime's secret store
- [ ] Any `PUSH_ENDPOINT_HOSTS` additions reviewed as outbound network destinations
- [ ] Notification permission requested only after an explicit signed-in user gesture
- [ ] Notification payload verified to contain no sender, subject, mailbox, address, body, or attachment data
- [ ] Disable, unsubscribe, expired-subscription cleanup, and VAPID rotation behavior tested

## Release decision

Record:

- reviewed commit;
- reviewers and date;
- unresolved risks and owners;
- manual and automated evidence;
- backup/rollback point;
- approval to handle real mail.

Re-run the checklist after authentication, authorization, message rendering, attachments, storage, routing, dependencies, or deployment configuration changes.

[← Documentation home](README.md)
