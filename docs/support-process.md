# Support process

This is a practical operating model for organisations deploying cmail. It
describes a support workflow; it does not create a service-level agreement,
guarantee response or resolution times, or certify the application or a
deployment against any standard.

The workflow maps to the service desk, incident, service request, problem,
change enablement, knowledge, service level, supplier, information-security,
monitoring, and continual-improvement practices described in the
[standards and service-management alignment guide](standards-alignment.md).
ISO/IEC 20000-1 is the primary service-management-system reference. This is an
alignment statement, not an ISO or ITIL certification claim.

## Roles and escalation boundary

**Level 1 (L1): internally trained organisation people** receive user reports,
confirm the impact, apply approved runbooks, and use the in-app Mail trace and
Audit log without exposing message content. L1 owns user communication and the
organisation's incident, privacy, and change-management processes.

**Level 2 (L2): RME Solutions Technology** may be contacted through the
organisation's agreed ticket or email channel when L1 has a reproducible cmail
product defect or needs separately scoped assistance. The request should state
whether it is a defect escalation or a request for quoted work. RME Solutions
Technology does not receive access to systems, accounts, or data unless the
organisation separately authorises it under an appropriate arrangement.

The open-source project support policy remains in [SUPPORT.md](../SUPPORT.md).
Security vulnerabilities follow the private process in
[SECURITY.md](../SECURITY.md), not an ordinary support ticket.

## Intake and triage

L1 should record a case identifier, reporter contact, affected service or
mailbox, first-observed time in UTC, current user impact, and any immediate
containment. Classify urgency using the organisation's own incident policy; do
not infer an SLA from this guide.

Use a ticket or email subject that is easy to route, such as `cmail defect`,
`cmail configuration request`, or `cmail security/privacy incident`. Keep the
case record factual and update it as evidence changes.

Before escalating, L1 should:

1. Check active mailbox status, assignments, configuration, Mail trace, Audit
   log, provider health, and the relevant approved runbook.
2. Reproduce the behaviour in a safe staging or local environment where
   practical, using synthetic data.
3. Capture the deployed commit or version, component and route, environment
   shape, time window, safe steps, expected result, actual result, and relevant
   redacted error or trace identifiers.
4. State the business impact and any containment already applied.

## What to escalate

Escalate as a **product bug** when the current, supported cmail code has a
clear, reproducible behaviour that conflicts with documented or expected
functionality, and the report includes enough safe evidence to investigate.

Treat the following as **quoted or separately scoped work**, not an included
product-defect response: deployment architecture or detailed design;
Cloudflare, identity-provider, DNS, email-provider, or domain configuration;
data migration or recovery; bespoke integrations; training; investigation that
cannot be reproduced; and troubleshooting caused by local changes, providers,
accounts, or operating procedures. L1 should obtain the appropriate approval
and scope before sharing access or commissioning this work.

Operational assistance expressly included in a separate support agreement is
handled under that agreement. This public process creates no additional
entitlement; RME Solutions Technology confirms the applicable scope before
work begins and may provide a written estimate or quote for work outside it.

If the boundary is unclear, label the request as `scope review` and provide the
facts rather than presuming a defect or entitlement.

## Protect people, data, and systems

Do not put message bodies, attachments, credentials, OAuth or session values,
API keys, private URLs, database exports, unredacted logs, or unnecessary
personal data in tickets or email. Prefer timestamps, trace identifiers,
commit IDs, redacted screenshots, and synthetic reproductions. Share the
minimum information required through the organisation-approved channel.

Suspected account compromise, unauthorised access, data exposure, or other
security or privacy incident must be contained and handled through the
organisation's security/privacy and incident-response process. Do not wait for
ordinary support triage. Follow [SECURITY.md](../SECURITY.md) for a suspected
cmail vulnerability and preserve evidence according to the organisation's
policy.

## Close and learn

L1 records the outcome, customer communication, workaround or change, and any
follow-up owner. For material incidents, record root cause, impact, corrective
actions, and lessons learned in the organisation's own governance process.
Review recurring cases for runbook, training, configuration, or product
improvements.

[← Documentation home](README.md)
