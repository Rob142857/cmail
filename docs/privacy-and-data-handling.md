# Privacy and data-handling guide

**Last reviewed:** 14 August 2026

This guide helps a deployment operator prepare its own privacy notice, records
of processing, provider review, and individual-rights procedure. It is not a
ready-made legal notice and is not legal advice. The organisation must adapt it
to its jurisdiction, contracts, workforce, users, message purposes, and actual
Cloudflare/identity/outbound-provider configuration.

cmail is self-hosted software. The upstream project does not receive a
deployment's accounts or mail merely because the software is used. The
deployment operator normally determines why and how personal information is
processed and must identify its own legal role. Cloudflare, Google, Microsoft,
Postmark, support providers, DNS/reporting services, and backup destinations
may have separate roles under their agreements and the operator's law.

## Data inventory

Review the deployed schema, provider settings, logs, and local modifications.
A typical cmail deployment can process:

| Category | Examples | Typical purpose |
|---|---|---|
| Account and identity | Name, sign-in email, provider and immutable provider subject, account status, role, sessions | Enrolment, authentication, authorization, support, offboarding |
| Organisation directory | Position title, work email, layer, unit, role, reporting structure, public/internal setting | Internal administration and an optional public directory |
| Mail content | Sender/recipient fields, subject, plain text, sanitized HTML, attachments, inline images, drafts, signatures | Receiving, composing, storing, finding, and delivering organisational mail |
| Mail-flow and security metadata | Envelope addresses, message identifiers, size, provider response, authentication results, suspicious-link/risk information | Delivery, investigation, abuse prevention, troubleshooting |
| Administrative evidence | Manager action, actor, target, timestamp, source address, policy version and acceptance | Security review, accountability, policy administration |
| Device notification data | Push endpoint, keys, browser/device capability and subscription timestamps | Optional new-mail notification delivery |
| Operational configuration | Organisation name, domains, support contacts, provider choices, retention and quota settings | Running and supporting the deployment |

Do not collect extra data merely because a field or provider feature is
available. Do not copy secrets, raw access tokens, message bodies, attachments,
or push endpoints into tickets or audit packs unless strictly required and
approved.

## Storage and disclosures

- D1 stores application records and message metadata. R2 stores message bodies
  and attachments. Cloudflare account administrators with sufficient access
  are inside the deployment trust boundary.
- Cloudflare Email Routing receives inbound mail before invoking the Worker.
  Cloudflare Email Service or Postmark handles external outbound delivery when
  selected. Review current service terms, locations, retention, subprocessor,
  and abuse-handling information for the exact services used.
- Review Cloudflare Email Preview for every sending domain. Where the provider
  enables temporary content preview, document whether it is disabled or
  approved, who can access it, and its current retention behavior.
- Google or Microsoft receives sign-in requests and returns the configured
  identity claims. cmail requests identity scopes; it does not thereby gain
  access to a person's consumer inbox, drive, contacts, or search history.
- Web Push sends a minimal notification through the endpoint's push service.
  Push is optional and should not contain message content.
- Backups, exports, support artifacts, DMARC/TLS reports, and independent logs
  are separate processing locations. Inventory and protect each one.

Record the actual regions, subprocessors, transfers, and contracts for the
deployment. Source documentation cannot establish those facts.

## Public directory privacy

The public directory is off unless the global setting is enabled. Positions
are internal by default and must be explicitly made public. A public position
may expose only the approved occupant name, work email, and position title;
account identifiers, sign-in addresses, permissions, reporting details, and
other personal information remain internal.

Before enabling publication:

- identify the purpose and lawful authority;
- approve each public position and work address;
- give affected people the required notice;
- review the rendered public page without authentication; and
- define who removes or corrects information and how quickly.

Offboarding makes the person's public positions internal. A manager must still
review successor details and any separately published copies.

## Retention, deletion, and preservation

The operator chooses separate periods for deleted mail, attachments, mail
trace, and application audit records. Scheduled retention is off by default.
Do not enable destructive cleanup until periods, backup, recovery, privacy,
records, litigation/preservation, and contractual requirements are approved.

cmail has no legal-hold workflow and its application audit log is not an
independently immutable archive. If preservation, eDiscovery, WORM storage, or
protected export is required, implement and test it outside cmail before
destructive retention is enabled.

Offboarding revokes access and disables the personal mailbox; it does not
automatically erase retained mail or every backup. Document the difference
between access removal, mailbox disablement, ordinary retention, backup expiry,
and an approved deletion request.

## Individual requests and organisational mail

Publish a contact and verified procedure for access, correction, objection,
restriction, portability, or deletion requests that apply in the operator's
jurisdiction. A request may involve other people, confidential correspondence,
records duties, legal privilege, or security evidence; do not provide raw
database/R2 exports without review and redaction.

The operator should be able to locate a person's account, owned mailbox,
policy acknowledgements, public positions, mailbox grants, and relevant audit
records. Mail content and backups require a separately controlled search and
review process; cmail does not provide a complete privacy-request or eDiscovery
workflow.

## Operator notice checklist

An organisation-specific notice or internal policy should accurately state:

- the accountable organisation and privacy/support contacts;
- purposes and applicable lawful bases or authorities;
- categories of people and information;
- recipients, providers, subprocessors, and international transfers;
- public-directory behavior and approval;
- retention periods, backup expiry, preservation exceptions, and deletion
  process;
- security and access-control approach without exposing defensive detail;
- how people exercise applicable rights or raise a complaint;
- monitoring, audit, mail trace, DMARC/TLS reporting, and push-notification use;
- incident-notification approach; and
- publication date, owner, review date, and change-notification process.

Retain the approved notice with the deployed commit and the evidence checklist
in [Security, privacy, and assurance](assurance.md). Re-review it whenever the
domain, provider, data location, purpose, public directory, retention,
monitoring, backup, or support arrangement changes.

[← Documentation home](README.md)
