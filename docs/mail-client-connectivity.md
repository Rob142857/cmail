# Mail client connectivity architecture

## Current product boundary

cmail is currently a browser application and installable PWA. It does not provide IMAP, POP, JMAP, Exchange ActiveSync, Microsoft Graph, EWS, or a general-purpose SMTP submission service for end-user mail clients. Use the [mobile PWA guide](mobile-pwa.md) for the supported iPhone, iPad, and Android experience.

Cloudflare Email Service is cmail's transport boundary, not a hosted mailbox service: Email Routing delivers inbound mail to a Worker or verified destination and Email Sending sends outbound mail through its Worker binding, REST API, or authenticated SMTP. It does not expose a cmail mailbox-access protocol. Cmail's application database and object storage remain the source of truth.

- [Cloudflare Email Service](https://developers.cloudflare.com/email-service/)
- [Cloudflare Email Routing rules](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)

## Compatibility and direction

| Client or protocol | Current support | Future interface | Scope and decision |
| --- | --- | --- | --- |
| cmail web app / PWA | Supported | Existing authenticated application API and Web Push | Full current product experience. |
| JMAP clients | Not yet supported | JMAP Core and JMAP Mail | Preferred modern mailbox API: RFC 8620/8621, including blobs, `EmailSubmission`, state changes, and JMAP Push. |
| Outlook for iOS/Android | Not yet supported | Optional IMAP + SMTP Submission adapter | Outlook documents manual IMAP/POP setup. IMAP/POP synchronise mail only, not calendar or contacts. |
| Gmail app for iOS/Android | Not yet supported | Optional IMAP + SMTP Submission adapter | Gmail documents “Other (IMAP)” account setup. |
| Apple Mail | Not yet supported | Optional IMAP + SMTP Submission adapter | Apple Mail supports manual IMAP or POP setup; cmail would support IMAP only. Calendar/contacts would require separate CalDAV/CardDAV work. |
| Exchange ActiveSync, Microsoft Graph, EWS | Not supported | Do not emulate as a first-party compatibility layer | Graph/EWS require Exchange mailboxes; EAS is a substantial Exchange protocol implementation. |

Primary sources: [JMAP Core (RFC 8620)](https://www.rfc-editor.org/rfc/rfc8620), [JMAP Mail (RFC 8621)](https://www.rfc-editor.org/rfc/rfc8621), [Outlook IMAP setup](https://support.microsoft.com/en-us/outlook/how-do-i-set-up-an-imap-account), [Gmail app account setup](https://support.google.com/mail/answer/6078445), [Apple Mail account setup](https://support.apple.com/en-gb/102619), [Microsoft Graph mail scope](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview?view=graph-rest-1.0), and [Exchange ActiveSync](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/exchange-activesync/exchange-activesync).

Do not add POP, Basic authentication, or a synthetic Exchange Autodiscover endpoint. POP loses the multi-device mailbox semantics cmail needs; Basic authentication is not an acceptable credential boundary; and advertising Autodiscover without a real Exchange-compatible endpoint makes clients select the wrong protocol.

## Recommended architecture

### JMAP is the modern core

Add a separately versioned JMAP service in front of cmail's existing mailbox domain model. Publish a JMAP Session resource at `/.well-known/jmap`; advertise only capabilities actually implemented. The service owns protocol-to-domain translation and never grants a client direct D1 or R2 access.

The initial capability set should cover mailbox listing, email query/get/set, threads, search, bounded blob upload/download, and `EmailSubmission` routed to the existing outbound delivery path. State tokens must be opaque, mailbox-scoped and invalidated safely when retention or access changes occur. `changes` must make reconnecting clients converge without re-downloading the mailbox.

JMAP Mail requires JMAP Push and `EmailDelivery` state changes. Treat push as a hint to synchronise, never as proof of delivery or a source of message content. JMAP Push sends to a registered HTTPS endpoint and has SSRF, encryption-key and rate-limit requirements; it is not a replacement for the PWA's browser push or a future native app's APNs/FCM notification service.

### IMAP plus SMTP Submission is an optional, isolated adapter

If Outlook, Gmail, and Apple Mail compatibility becomes a product requirement, operate an independent, stateful TLS mail-access service. It translates IMAP folders, flags, search, APPEND, MOVE/COPY, MIME streaming, and SMTP Submission into the same mailbox and outbound-delivery domain operations as the web app. It must not query or mutate D1/R2 as an uncontrolled protocol backend.

Use OAuth 2.0/OIDC bearer-token authentication with short-lived access tokens, refresh-token rotation, device/session records, and explicit revocation. Do not accept mailbox passwords or Basic authentication. Submission must preserve existing idempotency, authorisation, audit, provider-error, and sent-copy rules; the adapter is not a separate sender of record.

Expose only encrypted IMAP and submission endpoints, with a certificate whose names match the endpoints. RFC 6186 defines discovery SRV records for email submission and access; publish appropriate records only once the corresponding services are live (for example `_imaps._tcp`, `_imap._tcp`, and `_submission._tcp`). RFC 8314 updates TLS expectations. SRV assists compatible clients but does not guarantee automatic setup in every client.

- [RFC 6186 — service-discovery SRV records](https://www.rfc-editor.org/rfc/rfc6186/)
- [RFC 8314 — TLS for submission and access](https://www.rfc-editor.org/rfc/rfc8314/)
- [Mozilla/Thunderbird autoconfig format](https://wiki.mozilla.org/Thunderbird:Autoconfiguration:ConfigFileFormat)

Mozilla/Thunderbird autoconfig XML may be added later for clients that support it, using only actual IMAP and submission endpoints. It is distinct from Microsoft Exchange Autodiscover. Do not publish either discovery document early or claim automatic configuration until it has end-to-end client coverage.

## Authorisation, shared mailboxes, and lifecycle

Every protocol request resolves the authenticated person, session/device, and requested mailbox through cmail's existing authorisation model. Personal mailboxes remain private; shared mailboxes require the existing Full or Send as permission as appropriate. Calculate visible mailboxes and per-operation rights server-side, including From identity selection, rather than trusting a client-provided mailbox ID or sender address.

Pause, role removal, mailbox disablement, offboarding, credential reset, and administrator session revocation must revoke both web and external-client credentials promptly. Recheck permissions on every sync and submission operation; terminate active connections where the runtime permits. Do not leak an unavailable mailbox through discovery, detailed login failures, or protocol-specific error text.

Audit security-relevant authorization and submission outcomes under the same privacy and retention rules as the web product. Do not turn every client poll, sync cursor, or failed login into permanent message-content telemetry.

## Runtime and operational boundary

This cannot be delivered by Cloudflare Pages or Email Service alone. A public IMAP/SMTP server requires long-lived, stateful network protocol handling and its own network/runtime, TLS termination, abuse controls, connection limits, and observability. Keep it isolated from the Pages UI and inbound email Worker, with a narrow authenticated internal API for mailbox operations. Cloudflare continues to provide inbound routing and outbound delivery; it is not the end-user access server.

Before exposing an endpoint, define per-user/device connection limits, mailbox and attachment size limits, streaming/back-pressure, OAuth client registration, token storage/encryption, revocation propagation, credential rotation, structured no-content logs, alerting, backups, and incident runbooks.

## Staged build, test, and deployment plan

1. **Contract and threat model.** Specify JMAP capabilities, data mappings, ACL checks, state-token lifecycle, OAuth scopes, device revocation, and push-registration abuse controls. Review shared-mailbox and offboarding cases before implementation.
2. **JMAP read path.** Build a separate authenticated service with conformance tests for Session, mailboxes, query/get, changes, pagination, blobs, and permission changes. Test retention and concurrent web/JMAP mutations.
3. **JMAP writes and submission.** Add set, upload, and EmailSubmission through cmail's existing guarded delivery commands. Verify idempotency, sent copies, From permissions, trace/audit behaviour, provider failures, and revocation.
4. **Push and operations.** Implement verified, rate-limited JMAP Push with no message content in payloads or logs. Load-test reconnect storms, observe aggregate health, and rehearse token compromise and device removal.
5. **Optional IMAP/SMTP adapter.** After the JMAP core is stable, deploy a separate adapter in a non-production domain and test Outlook mobile, Gmail, Apple Mail, and one standards client. Test folder/flag convergence, attachments, shared access, disabled accounts, OAuth expiry, revocation, and submission retries.
6. **Discoverability and production.** Publish SRV/autoconfig records only for verified live endpoints. Roll out by allowlisted pilot accounts, retain a one-step disable switch at the adapter edge, monitor without logging mail content, and keep the PWA fully available as the recovery client.
