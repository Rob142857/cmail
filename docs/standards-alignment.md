# Standards and service-management alignment

- **Document status:** public alignment guide
- **Last reviewed:** 14 August 2026
- **Scope:** the cmail product, an organisation operating a deployment, and any
  separately contracted support service

This guide identifies the standards and service-management practices
relevant to cmail. It is an implementation and evidence roadmap, not a claim
of certification, conformity, legal compliance, or endorsement.

Certification applies to a defined organisation, management system, service,
and audit scope. It does not automatically apply to source code or a
deployed feature. ISO does not certify organisations. ITIL is a
PeopleCert-owned practice framework. An application or support desk is not
“ITIL certified”. Use the terms **alignment target**, **practice mapping**,
and **supports evidence for** unless an accredited, scoped assessment says
otherwise.

Do not copy ISO control text or ITIL practice guides into this repository.
They are licensed publications. The descriptions below are independently
written summaries. An organisation seeking formal conformity must obtain the
current standards and qualified advice.

## Primary alignment targets

This table shows the standards most relevant to cmail: why each one matters,
what cmail already provides, and what the operator or support provider must
still establish.

| Reference | Why it is relevant | What cmail contributes | What the operator or support provider must establish |
|---|---|---|---|
| [ISO/IEC 27001:2022](https://www.iso.org/standard/27001) with Amendment 1:2024 and [ISO/IEC 27002:2022](https://www.iso.org/standard/75652.html) | Information-security management and control guidance | Server-side access checks, delegated identity, session controls, sanitisation, audit/trace records, secret and dependency checks, documented backup and release gates | A scoped ISMS (information security management system), risk and asset ownership, statement of applicability, provider assessment, administrative MFA (multi-factor authentication), monitoring, incident handling, control review, internal audit, and management review |
| [ISO/IEC 20000-1:2018](https://www.iso.org/standard/70636.html) with Amendment 1:2024 | Service-management-system requirements for planning, transition, delivery, support, measurement, and improvement | Versioned releases, deployment and operations checklists, support documentation, audit/trace surfaces, and rollback guidance | Service scope and ownership, catalogue, support channels/hours, incident/request/problem/change records, service targets, supplier management, reporting, review, and continual improvement |
| [ISO/IEC 27701:2025](https://www.iso.org/standard/27701) | Privacy-information management for PII (personally identifiable information) controllers and processors | Data inventory guidance, directory privacy defaults, retention controls, offboarding, and documented responsibility boundaries | Controller/processor roles, lawful purposes, notices, minimisation, rights handling, retention approval, breach workflow, contracts, subprocessors, and evidence of privacy review |
| [ISO 22301:2019](https://www.iso.org/standard/75106.html) with Amendment 1:2024 | Business-continuity management | Paired D1/R2 (Cloudflare’s database and object storage) recovery guidance, isolated restore rehearsal, rollback instructions, and dependency inventory | Business-impact analysis, recovery objectives, continuity roles, communications, tested runbooks, provider failure and exit planning, and exercise evidence |
| [ISO/IEC 27035-1:2023](https://www.iso.org/standard/78973.html) and [ISO/IEC 27035-2:2023](https://www.iso.org/standard/78974.html) | Information-security incident preparation, assessment, response, recovery, and learning | Private vulnerability reporting, safe evidence guidance, security logging, and release/rollback controls | Security-event intake, severity, incident command, containment and recovery authority, evidence preservation, notification decisions, exercises, and lessons/corrective actions |
| [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) | Product-quality model for specifying and evaluating software quality | Automated tests, accessibility-oriented UI, interoperability, security controls, migration checks, maintainable configuration, and documented gaps | Measurable quality requirements and acceptance criteria for functional suitability, performance, compatibility, usability, reliability, security, maintainability, flexibility, and safety |

ISO/IEC 27002 and ISO/IEC 25010 are guidance/reference models, not
stand-alone management-system certifications. ISO/IEC 27035 provides
incident-management guidance. It does not imply certification of an
incident workflow.

## Conditional and supporting references

These references apply only in specific situations, shown in the table
below.

| Reference | Apply when |
|---|---|
| [ISO/IEC 27017:2015](https://www.iso.org/standard/43757.html) | Evaluating cloud-customer/provider shared responsibilities, environment separation, privileged support access, portability, and deletion. A second edition is under publication as of this review; verify its publication status before starting a formal mapping. |
| [ISO/IEC 27018:2025](https://www.iso.org/standard/27018) | A hosted service or public-cloud provider acts as a PII processor. It does not make the self-hosted upstream project a processor of each deployment’s data. |
| [ISO 15489-1:2016](https://www.iso.org/standard/62542.html) | Defining which email, policy, audit, ticket, and change artifacts are business records and how they are captured, protected, retained, and disposed of. |
| [ISO 30301:2019](https://www.iso.org/standard/74292.html) with Amendment 1:2024 | An organisation needs a formal management system for records. The standard is under revision, so verify the current edition before a conformity project. |
| [ISO 9001:2015](https://www.iso.org/standard/62085.html) with Amendment 1:2024 | A support or development organisation uses a general quality-management system. A replacement edition is under publication as of this review; ISO/IEC 20000-1 remains the more specific service-management target. |

Cloudflare, Microsoft, Google, Postmark, or another supplier having a
certificate does not transfer that certification to cmail or its operator.
Record each supplier’s scope, current certificate, contract, data location,
configuration, and shared-responsibility boundary separately.

## ITIL service-management practice map

The following ITIL practices are useful operating references. This is a
descriptive mapping to [PeopleCert’s current ITIL practice
modules](https://www.peoplecert.org/ITIL4-practices), not a reproduction of
the licensed practice guides or a claim of PeopleCert endorsement.

| ITIL practice | cmail operating application |
|---|---|
| Service desk | One visible route for help, ownership from intake to closure, useful communications, and feedback. The organisation’s trained Level 1 contact is the user-facing desk. |
| Incident management | Restore normal service quickly using recorded impact, urgency, severity, timestamps, owner, escalation, workaround, recovery, and communications. |
| Service request management | Use predefined, approved workflows for invitations, access, shared-mailbox delegation, offboarding, exports, and routine configuration. |
| Problem management | Group recurring incidents, record known errors and workarounds, investigate causes, and track permanent fixes independently of immediate restoration. |
| Change enablement | Assess risk and impact; distinguish standard, normal, and emergency change; authorise, schedule, test, communicate, record, and retain rollback evidence. |
| Monitoring and event management | Define health and security signals, thresholds, ownership, triage, and escalation. An event or alert becomes an incident only after assessment. |
| Service level management | Publish the support scope and agreed response/update/restoration targets. Do not imply an SLA (service level agreement) where no contract defines one. |
| Knowledge management | Maintain versioned user guidance, known errors, runbooks, support scripts, ownership, review dates, and access restrictions for sensitive material. |
| Information security management | Connect service operation to the organisation’s risks, policies, controls, awareness, supplier reviews, and security-incident process. |
| Supplier management | Review identity, Cloudflare, DNS, mail transport, backup, and support suppliers; record responsibilities, service commitments, incidents, and exit plans. |
| Continual improvement | Keep an evidence-based improvement register with baseline, desired outcome, owner, priority, due date, result, and review cadence. |

## Support tiers and accountability

The canonical support workflow is in [Support and service
management](support-process.md). Its minimum model:

1. **Self-help:** in-app help, manager handbook, operational runbooks, and known
   errors.
2. **Level 1 — organisation:** internally trained people provide the first
   contact, verify the user and affected service, follow approved procedures,
   protect personal and message data, gather safe evidence, and restore known
   issues where authorised.
3. **Level 2 — RME Solutions Technology:** Level 1 raises a ticket or email
   through the configured support channel when it cannot resolve the issue.
   RME triages genuine reproducible product defects separately from
   deployment-specific design, configuration, integration, provider, and
   extended troubleshooting work.
4. **Level 3 — engineering or supplier:** RME coordinates an upstream defect,
   security process, Cloudflare/identity/mail-provider case, or specialist
   engagement where required.

Detailed design, customisation, configuration, migration, integration, and
troubleshooting beyond a verified product defect or agreed operational scope
may require a written estimate or quote. No response time, restoration target,
or support entitlement exists unless a support agreement states it. Security
vulnerabilities always use the private process in
[SECURITY.md](../SECURITY.md), not ordinary tickets.

## Evidence an operator should retain

Keep records that show you are following these practices:

- approved service scope, owners, users, support routes, hours, and agreements;
- current deployed commit and configuration, provider and supplier register,
  privacy roles, and risk decisions;
- tickets separated into incidents, service requests, problems, changes,
  security events, and commercial/design enquiries;
- severity, impact, timeline, actions, approvals, communications, resolution,
  closure, and any linked problem/change/knowledge record;
- service measures the organisation defines—such as acknowledgement time,
  restoration time, reopen rate, backlog age, change success, availability,
  and restore-test success—without publishing invented targets;
- incident exercises, paired D1/R2 restore tests, post-incident reviews,
  corrective actions, and continual-improvement results;
- periodic access, supplier, risk, privacy, retention, knowledge, and service
  reviews with accountable approval.

## Review triggers

Review this map at least annually and whenever a referenced edition changes, a
new hosted/support service is introduced, a provider or data location changes,
the product scope changes materially, or an organisation begins a formal
certification or assurance project. Record the exact editions and purchased
standards used by that project.

[← Documentation home](README.md)
