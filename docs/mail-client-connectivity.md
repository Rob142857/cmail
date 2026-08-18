# Mail client connectivity architecture

## Where cmail stands today

cmail is a browser app and installable Progressive Web App (PWA). It does not support IMAP, POP, JMAP, Exchange ActiveSync, Microsoft Graph, EWS, or general-purpose SMTP — the protocols native apps like Outlook or Apple Mail use to reach a mailbox directly. See the [mobile PWA guide](mobile-pwa.md) for the supported iPhone, iPad, and Android experience.

Cloudflare Email Service moves mail in and out of cmail. It is not a hosted mailbox a mail client could connect to. Email Routing delivers inbound mail to cmail's Worker, and Email Sending submits outbound mail through that Worker, a REST API, or authenticated SMTP. Neither exposes a way to browse a cmail mailbox. cmail's own database and file storage remain the single source of truth for your mail.

- [Cloudflare Email Service](https://developers.cloudflare.com/email-service/)
- [Cloudflare Email Routing rules](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)

## Current and future support

| Client or protocol | Today | Planned | Notes |
| --- | --- | --- | --- |
| cmail web app / PWA | Supported | Existing app API and Web Push | The full current product experience. |
| JMAP clients | Not yet supported | JMAP Core and JMAP Mail (RFC 8620/8621) | The preferred modern mailbox API. Covers attachments, sending, state changes, and push updates. |
| Outlook for iOS/Android | Not yet supported | Optional IMAP + SMTP adapter | Outlook only offers manual IMAP/POP setup, which syncs mail only, not calendar or contacts. |
| Gmail app for iOS/Android | Not yet supported | Optional IMAP + SMTP adapter | Gmail supports this as an "Other (IMAP)" account. |
| Apple Mail | Not yet supported | Optional IMAP + SMTP adapter | Apple Mail supports manual IMAP or POP; cmail would support IMAP only. Calendar and contacts would need separate work. |
| Exchange ActiveSync, Microsoft Graph, EWS | Not supported | Not planned as a built-in option | These need a real Exchange mailbox (Graph/EWS) or a large protocol build (ActiveSync), so cmail will not imitate them. |

Sources: [JMAP Core (RFC 8620)](https://www.rfc-editor.org/rfc/rfc8620), [JMAP Mail (RFC 8621)](https://www.rfc-editor.org/rfc/rfc8621), [Outlook IMAP setup](https://support.microsoft.com/en-us/outlook/how-do-i-set-up-an-imap-account), [Gmail app setup](https://support.google.com/mail/answer/6078445), [Apple Mail setup](https://support.apple.com/en-gb/102619), [Microsoft Graph mail scope](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview?view=graph-rest-1.0), [Exchange ActiveSync](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/exchange-activesync/exchange-activesync).

Do not add:

- **POP** — downloads, and often deletes, mail from the server. Does not fit cmail's multi-device design.
- **Basic authentication** — sends a password with every request. Not an acceptable credential boundary.
- **A fake Exchange Autodiscover endpoint** — would make clients try a protocol cmail does not actually support.

## Recommended architecture

### JMAP is the modern core

Add a separate, independently versioned JMAP service in front of cmail's existing mailbox system. Publish a JMAP Session resource at `/.well-known/jmap`, and advertise only features that are actually built. This service translates JMAP requests into cmail's own data model — it never gives a client direct access to the database (D1) or file storage (R2).

The first version should cover listing mailboxes, reading/searching/sending mail, threads, size-limited attachment upload and download, and `EmailSubmission` routed through the existing outbound delivery path. State tokens (used to track what has changed) must be opaque, scoped to one mailbox, and safely invalidated when retention or access changes. The `changes` feature must let a reconnecting client catch up without re-downloading the whole mailbox.

JMAP Mail requires JMAP Push and `EmailDelivery` state changes. Treat a push notification as a hint to sync, never as proof of delivery or a copy of message content. JMAP Push sends to a registered HTTPS address and needs its own protection against SSRF (tricking a service into calling an address it should not reach), plus encryption keys and rate limits. It is not a replacement for the PWA's browser push, or a future native app's Apple/Google push service.

### An optional, separate IMAP and SMTP adapter

If supporting Outlook, Gmail, and Apple Mail becomes a requirement, run this as its own service: an independent, always-connected, encrypted (TLS) mail-access server, separate from the main app. It translates IMAP actions (folders, flags, search, moving and copying mail, streaming message content) and SMTP Submission (sending) into the same operations the web app already uses. It must never query or change D1 or R2 directly.

Use OAuth 2.0/OIDC (sign-in tokens, not passwords) with short-lived access tokens, refresh-token rotation, device/session records, and a clear way to revoke access. Never accept a mailbox password or Basic authentication. Sending through this adapter must follow the same rules as the web app — no duplicate sends, the same permission checks, audit trail, provider-error handling, and Sent-copy behaviour. The adapter is not a separate, independent sender.

Expose only encrypted IMAP and submission addresses, with a TLS certificate that matches them. RFC 6186 defines SRV records (DNS records that tell a mail app where to connect) for email submission and access — publish records such as `_imaps._tcp`, `_imap._tcp`, and `_submission._tcp` only once those services are actually live. RFC 8314 sets the TLS expectations. SRV helps compatible clients set up automatically, but not every client supports it.

- [RFC 6186 — service-discovery SRV records](https://www.rfc-editor.org/rfc/rfc6186/)
- [RFC 8314 — TLS for submission and access](https://www.rfc-editor.org/rfc/rfc8314/)
- [Mozilla/Thunderbird autoconfig format](https://wiki.mozilla.org/Thunderbird:Autoconfiguration:ConfigFileFormat)

A Mozilla/Thunderbird autoconfig file may be added later for clients that support it, listing only real, live IMAP and submission addresses. This is separate from Microsoft's Exchange Autodiscover. Do not publish either discovery file early, or claim automatic setup works, until it has been tested end-to-end with real clients.

## Permissions, shared mailboxes, and the account lifecycle

Every request, on any protocol, must check the signed-in person, their session/device, and the requested mailbox against cmail's existing permission model. Personal mailboxes stay private. Shared mailboxes still need Full or Send as permission, as they do today. The server decides which mailboxes are visible and what each person can do, including which From address they can use — it never trusts a mailbox ID or sender address supplied by the client.

Pausing a user, removing a role, disabling a mailbox, offboarding, resetting credentials, or revoking a manager's session must immediately revoke access for both the web app and any external mail client. Recheck permissions on every sync and every send, and close active connections where the system allows it. Never reveal that a mailbox exists but is unavailable through discovery responses, detailed login errors, or protocol-specific error text.

Log security-relevant access and sending events under the same privacy and retention rules as the web app. Do not turn routine client activity, such as polling or a failed login, into permanent records containing message content.

## Operational requirements

Cloudflare Pages and Email Service alone cannot run this. A public IMAP/SMTP server needs long-lived, stateful connections and its own network, TLS handling, abuse controls, connection limits, and monitoring. Keep it separate from the Pages web app and the inbound email Worker, connected only through a narrow, authenticated internal API for mailbox operations. Cloudflare still handles inbound routing and outbound delivery — it is not the server end users connect to.

Before making this available, define: connection limits per user/device; mailbox and attachment size limits; how large transfers are handled; OAuth client registration; encrypted token storage; how revocation reaches every service; credential rotation; logs that never contain message content; alerting; backups; and incident runbooks.

## Build, test, and rollout plan

1. **Contract and threat model.** Define the JMAP features, data mappings, permission checks, state-token lifecycle, OAuth scopes, device revocation, and abuse controls for push registration. Review shared-mailbox and offboarding cases before building anything.
2. **JMAP read path.** Build a separate, authenticated service with tests covering Session, mailboxes, search, changes, pagination, and attachments. Test retention and what happens when the web app and JMAP change the same data at once.
3. **JMAP writes and submission.** Add the ability to change data, upload attachments, and send mail (`EmailSubmission`), all routed through cmail's existing, guarded sending logic. Verify duplicate-send protection, Sent copies, From-address permissions, trace/audit behaviour, provider failures, and revocation.
4. **Push and operations.** Build verified, rate-limited JMAP Push with no message content in the notification or logs. Load-test many clients reconnecting at once, monitor overall health, and rehearse a compromised token and a device removal.
5. **Optional IMAP/SMTP adapter.** Once the JMAP core is stable, deploy a separate adapter on a non-production domain and test it with Outlook mobile, Gmail, Apple Mail, and one standards-based client. Test folder/flag syncing, attachments, shared access, disabled accounts, OAuth expiry, revocation, and retrying a failed send.
6. **Discoverability and production.** Publish SRV and autoconfig records only for endpoints that are verified and live. Roll out to an allowlist of pilot accounts first, keep a one-step switch to disable the adapter, monitor without logging mail content, and keep the PWA fully available as a fallback.
