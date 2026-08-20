# Security, privacy, and assurance

- **Document status:** public project assurance guide
- **Last reviewed:** 14 August 2026
- **Applies to:** the latest supported revision of the pre-1.0 cmail project
- **Deployment owner:** the organisation operating each deployment

This page gives managers, reviewers, and auditors a concise map of cmail's
security and governance controls. It is a product-capability statement and an
evidence checklist—not a certification, legal opinion, or assurance report for
an individual deployment.

An auditor should record the exact deployed commit, configuration, providers,
DNS state, and evidence date. A source-code capability is not proof that an
operator enabled, monitored, or retained it correctly.

## Responsibility boundary

This table shows who is responsible for what, from the cmail codebase to
your cloud, identity, and mail providers.

| Party | Responsible for |
|---|---|
| cmail project | Application code, server-side authorization, mailbox model, message processing, documented defaults, migrations, tests, and published gaps |
| Deployment operator | Cloudflare account security, domains and DNS, OAuth registrations, manager access, policies, retention, backups, restore tests, monitoring, incident handling, privacy notices, legal duties, and evidence preservation |
| Cloudflare | The behavior and security of the selected Pages, Workers, D1 (hosted database), R2 (object storage), Email Routing, Email Service, and related account services under the operator's agreement |
| Google or Microsoft | Identity verification and any MFA (multi-factor authentication), conditional-access, account-lifecycle, or risk policies configured by the operator |
| Outbound provider | Delivery transport, signing and bounce behavior for the selected provider. Postmark remains an optional alternative to Cloudflare Email Service |

## Control and evidence matrix

For each area, this table lists what cmail already does and what evidence
you still need to collect.

| Area | Product capability | Deployment evidence required |
|---|---|---|
| Identity | Google and Microsoft OIDC (OpenID Connect sign-in), plus an invitation-scoped email one-time code for invitees hosted elsewhere; no cmail password database; invited-account enrolment binds the provider subject, or a bound email identity, to a cmail person; sign-in can be restricted to approved countries with a manager approval flow for exceptions | OAuth app registrations and callbacks, permitted tenants/accounts, provider MFA or conditional-access policy, email one-time-code and Turnstile configuration where used, approved sign-in countries where used, emergency access and administrator review |
| Sessions | Signed sessions are stored as hashes; configurable lifetime and concurrency; pause/offboard revokes sessions | Effective settings, sampled revocation test, manager and Cloudflare access review |
| Authorization | Roles and mailbox delegation are checked server-side; shared mailboxes use Read, Send as, or Full access | Current people/mailbox assignment export or reviewed screenshots, least-privilege review date, offboarding sample |
| Public directory privacy | Directory output is globally gated and each position is internal by default; public positions expose only approved name, work email, and title | Current directory setting, approved public-position list, privacy owner sign-off, public-page review |
| Message content | Inbound HTML is allowlist-sanitized and rendered in a sandboxed frame; attachments and message bodies are bounded; stored content is separated between D1 metadata and R2 objects | Provider and storage locations, Cloudflare Email Preview decision, storage-access review, controlled malicious-content test |
| Mail standards | Message format, MIME, threading, attachment names, and plain-text alternatives are implemented in code | Live SPF, DKIM, DMARC, MTA-STS/TLS-RPT records as applicable; received-header tests; current receiver/provider requirements |
| Audit and trace | The application has no edit/delete action for audit entries and records administrative and mail-flow metadata without message bodies | Export/protection method, access review, retention setting, sampled events, independent log destination if immutability is required |
| Retention and deletion | Separate periods exist for deleted mail, attachments, trace, and audit data; scheduled cleanup is deliberately disabled until the operator enables it | Effective periods, job-enabled state, approval, recovery boundary, deletion test, applicable legal/privacy review |
| Backup and recovery | Cloudflare provides D1 export/time-travel and R2 object operations; cmail documents ordering and validation | Encrypted backup location, access list, latest successful backup, restore-test date and results, recovery objectives |
| Policy acknowledgement | Managers publish versioned organisation policy text; protected access is gated on acceptance of the latest version | Current approved policy, version history, acceptance records, exception/escalation procedure |
| Vulnerability handling | Private reporting guidance, secret scans, dependency audit, CodeQL and CI release gates are published | Deployed revision, update owner, vulnerability intake channel, patch/rollback procedure, latest release-gate result |

## Important limitations and non-claims

Know these limits before you rely on cmail for compliance or evidence.

- cmail has not been independently certified against ISO 27001, SOC 2, PCI
  DSS, HIPAA, GDPR, the Australian Privacy Act, or another regulatory or
  assurance framework.
- Application audit rows are append-only through the supported interface, but
  they are not independently immutable, cryptographically sealed, or a WORM
  (write-once, read-many) archive. Cloudflare/database administrators remain
  inside the trust boundary.
- cmail has no legal-hold, eDiscovery, DLP, malware-sandbox, SIEM export,
  records-disposition approval, or formal evidence-package feature.
- Retention cleanup is off by default. Enabling a schedule without approved
  periods, backup, restore, legal-hold alternatives, and recovery testing is
  unsafe.
- MFA and conditional access are provider/operator controls. Using Google or
  Microsoft sign-in does not prove that either control is enabled.
- Email one-time-code sign-in carries none of an OAuth account's ongoing
  multi-factor or revocation guarantees. Its session lifetime is capped
  independently of the general session setting, and the Manager role always
  requires a Google or Microsoft identity.
- SPF, DKIM, DMARC, MTA-STS, and TLS-RPT depend on live DNS, provider behavior,
  and operator monitoring. Documentation cannot make a deployment compliant.
- Accessibility work targets good keyboard, contrast, motion, and semantic
  behavior, but no formal WCAG (Web Content Accessibility Guidelines)
  conformance audit has been completed.
- cmail is organisational and transactional email software, not a bulk
  marketing platform. It lacks campaign consent, preference, unsubscribe,
  complaint, suppression, and reputation-management controls.

## Deployment evidence checklist

Create an evidence folder outside the public repository. Do not include
secrets, message bodies, attachments, raw OAuth data, private keys, push
endpoints, or unnecessary personal information.

- [ ] Deployment name, mail domain, application origin, owner, environment,
      deployed commit, review date, and accountable approver recorded.
- [ ] Cloudflare, identity-provider, outbound-provider, DNS, support, and
      incident-response owners recorded; subprocessors and data locations
      reviewed under the organisation's privacy obligations.
- [ ] Cloudflare and identity-provider administrative access reviewed; MFA and
      conditional-access evidence captured where required.
- [ ] OAuth callbacks, tenant/account restrictions, bootstrap-secret removal,
      session settings, and manager roles verified.
- [ ] SPF, DKIM, DMARC, MTA-STS, and TLS-RPT records verified where applicable;
      controlled messages demonstrate expected alignment and transport.
- [ ] Email Routing rules, accepted recipients, unavailable-recipient behavior,
      sender limits, attachment limits, and storage quota tested.
- [ ] Personal/shared mailbox ownership and delegation reviewed; offboarding
      test demonstrates session revocation, grant removal, mailbox disablement,
      and public-position privacy.
- [ ] Current organisation policy approved and acceptance behavior sampled.
- [ ] Retention-job state and periods recorded; absence of legal hold accepted
      or compensated by an approved external process.
- [ ] D1 and R2 backup completed, protected, and restored into an isolated test
      environment; counts and selected non-sensitive records reconciled.
- [ ] Audit and trace access, export/preservation approach, and retention
      reviewed; any independent immutability requirement met externally.
- [ ] `pnpm release:check` and the deployment smoke tests passed for the exact
      revision; open gaps and accepted risks have owners and review dates.

## Auditor starting points

Start with these documents:

- [Architecture and trust boundaries](architecture.md)
- [Deployment and verification](deployment.md)
- [Configuration reference](configuration.md)
- [Email authentication and sender requirements](email-authentication.md)
- [ISO and ITIL alignment map](standards-alignment.md)
- [Support and service management](support-process.md)
- [Security checklist](security-checklist.md)
- [Operations checklist](operations-checklist.md)
- [Manager handbook](manager-handbook.md)
- [Acceptable-use policy template](acceptable-use-policy-template.md)
- [Security policy](../SECURITY.md)
- [Change log](../CHANGELOG.md)

The running application's public **Help → Standards & assurance** page is the
manager-friendly companion to this document. Use the page's print action to
save a dated PDF snapshot. Retain the source URL plus deployed commit with
that snapshot.

[← Documentation home](README.md)
