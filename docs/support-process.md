# Support process

This is a practical support model for organisations running cmail. It describes a workflow — it is not a service-level agreement, and it does not promise response or resolution times or certify cmail against any standard.

This workflow lines up with standard service-management practices, such as incident, problem, and change management. See the [standards and service-management alignment guide](standards-alignment.md) for details; this is an alignment statement, not an ISO or ITIL certification.

## Roles and escalation

**Level 1 (L1) — your own trained staff** take user reports, confirm impact, follow approved runbooks (step-by-step guides for common issues), and use the in-app Mail trace and Audit log without exposing message content. L1 owns user communication and your organisation's incident, privacy, and change processes.

**Level 2 (L2) — RME Solutions Technology** can be contacted through your agreed ticket or email channel when L1 has a reproducible cmail product defect, or needs separately scoped help. State clearly whether you're reporting a defect or requesting quoted work. RME Solutions Technology gets no access to your systems, accounts, or data unless you separately authorise it.

The open-source project support policy is in [SUPPORT.md](../SUPPORT.md). Report security vulnerabilities through the private process in [SECURITY.md](../SECURITY.md), not an ordinary support ticket.

## Intake and triage

L1 should record a case ID, reporter contact, affected service or mailbox, first-observed time (UTC), current user impact, and any immediate containment. Classify urgency using your own incident policy; do not assume an SLA from this guide.

Use a ticket or email subject that is easy to route, such as `cmail defect`, `cmail configuration request`, or `cmail security/privacy incident`. Keep the case record factual and update it as you learn more.

Before escalating, L1 should:

1. Check mailbox status, assignments, configuration, Mail trace, Audit log, provider health, and the relevant runbook.
2. Reproduce the problem in a safe staging or local environment where possible, using test data rather than real mail.
3. Record the deployed version, affected component and route, environment, time window, safe reproduction steps, expected result, actual result, and any redacted error or trace IDs.
4. Note the business impact and any containment already applied.

## What to escalate

Escalate as a **product bug** when current, supported cmail code clearly and reproducibly conflicts with its documented or expected behaviour, and you can provide enough safe evidence to investigate.

Treat the following as **quoted or separately scoped work**, not an included defect fix: deployment architecture or detailed design; Cloudflare, identity-provider, DNS, email-provider, or domain configuration; data migration or recovery; custom integrations; training; issues that cannot be reproduced; and problems caused by local changes, providers, accounts, or your own procedures. Get the right approval and scope agreed before sharing access or commissioning this work.

If a separate support agreement covers operational help, that agreement applies. This process alone creates no extra entitlement. RME Solutions Technology confirms scope before starting work, and may quote for anything outside it.

If you are not sure which category applies, label the request `scope review` and give the facts rather than assuming it is a defect or included work.

## Protect people, data, and systems

Do not put message bodies, attachments, credentials, OAuth or session values, API keys, private URLs, database exports, unredacted logs, or unnecessary personal data in tickets or email. Use timestamps, trace IDs, commit IDs, redacted screenshots, and test data instead. Share only the minimum through your approved channel.

If you suspect account compromise, unauthorised access, a data exposure, or another security or privacy incident, contain it immediately through your own security/privacy and incident-response process; do not wait for ordinary support triage. Follow [SECURITY.md](../SECURITY.md) for a suspected cmail vulnerability, and preserve evidence according to your policy.

## Close and learn

L1 records the outcome, customer communication, workaround or fix, and any follow-up owner. For serious incidents, record root cause, impact, corrective actions, and lessons learned in your own governance process. Review recurring cases for gaps in runbooks, training, configuration, or the product.

[← Documentation home](README.md)
