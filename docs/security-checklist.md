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
- [ ] Invalid, unknown-recipient, oversized, guarded, and duplicate inbound attempts cannot amplify persistent trace rows

## Data protection

- [ ] D1 and R2 access restricted to required applications and administrators
- [ ] `MAILBOX_STORAGE_QUOTA_BYTES` matches on Pages and the Worker and covers inbound, Sent/internal copies, and drafts
- [ ] Draft save rate and owned per-user/mailbox draft-row cap are configured and tested
- [ ] Backup, restore, retention, deletion, and legal-hold requirements defined
- [ ] Test data contains no copied production mail
- [ ] Logs have an owner, retention period, and access policy
- [ ] Privacy notice and acceptable-use policy reviewed for the deployment's jurisdictions
- [ ] Incident notification obligations documented

## Mail and DNS

- [ ] All legitimate senders for the domain inventoried before SPF changes
- [ ] Provider-issued DKIM records verified
- [ ] DMARC policy and reporting destinations approved
- [ ] Email Routing sends only intended traffic to the Worker
- [ ] `INBOUND_SENDER_HASH_KEY` is a distinct 32-byte Worker secret and sender-HMAC values contain no raw address
- [ ] Unknown and inactive recipients reject as expected
- [ ] Outbound From addresses restricted to verified domains
- [ ] Bounce, complaint, and abuse handling procedures defined

## Cloudflare and provider controls

- [ ] Administrative accounts protected with multi-factor authentication
- [ ] Least-privilege roles used for deployers and operators
- [ ] Production and development resources separated
- [ ] Pages variables and secrets reviewed after every deployment change
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
