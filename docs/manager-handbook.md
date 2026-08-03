# Manager handbook

This handbook covers the management functions available inside cmail. It is
for accounts with the **Manager** role. Deployment bindings, secrets, DNS,
identity-provider registration, backups, and Cloudflare operations remain
operator responsibilities; use the [deployment guide](deployment.md) for those
tasks.

cmail's management centre uses familiar enterprise-mail concepts and a
section-and-blade workflow. It is not Microsoft Exchange, is not affiliated
with Microsoft, and does not claim exact feature or protocol parity.

## Three separate access concepts

Keep these models separate when granting access:

| Model | Values | What it controls |
|---|---|---|
| Account role | Standard, Manager | Access to the cmail management centre |
| Mailbox permission | Read, Send as, Full access | Actions in one assigned mailbox |
| Organisation role definition | A reusable title such as Service manager | Structure and optional directory display only |

Linking a user to an organisation position does not grant mailbox access or the
Manager role. Promoting an account to Manager does not grant access to every
mailbox. Apply least privilege in each model independently.

## Recommended first-run order

1. Open **Overview** and note incomplete deployment-readiness checks.
2. In **Settings**, confirm system-mail identity, support address,
   organisation names and URLs, and the application name.
3. In **People**, provision at least two trusted managers, then create standard
   accounts and optional personal mailboxes.
4. In **Mailboxes**, create shared addresses and assign explicit permissions.
5. In **Organisation**, build layers, units, role definitions, and positions.
   Keep the public directory off until its publication preflight is clean.
6. In **Usage policy**, preview and publish the approved text.
7. Perform controlled inbound, internal, and external message tests. Confirm
   results in **Mail trace** and changes in **Audit log**.

Use a staging deployment first. Do not make identity, routing, DNS, or broad
access changes for the first time during a production incident.

## Overview

**Management > Overview** provides activity totals, deployment readiness, quick
links, and the public-directory privacy state. Treat it as a starting signal,
not as complete monitoring: provider consoles, Cloudflare telemetry, backups,
and external alerting still require separate operational checks.

## People

**Management > People** controls account provisioning, invitation delivery,
account roles, and lifecycle. Creating a database row is not enough for first
sign-in: the person must complete a current manager-issued enrolment invitation.

### Provision an account

1. Select **Add a person**.
2. Enter the exact verified Google or Microsoft UserInfo email and a display name.
3. Optionally create a personal mailbox local part on the configured mail
   domain. It is created active with Full access assigned to the new account.
4. Choose Standard or Manager.
5. Send an invitation now when delivery is configured, or deliberately leave
   the person pending and use **Resend invitation** later.

The account begins as **Pending** and unbound. The invitation contains an
enrolment link for each configured provider; the selected provider must return
the same recorded email from access-token-backed UserInfo. Google additionally
requires `email_verified=true`; Microsoft UserInfo does not expose that flag, so
its non-empty `email` claim is accepted only alongside the invitation. The link token is stored
hashed, expires after 72 hours, and can be used once. A validated link creates
a 15-minute protected first-party enrolment cookie before provider sign-in. On
success, the account becomes **Active** and is bound to that provider's
immutable UserInfo subject. A different provider or subject cannot be
substituted later through the UI, and a later provider-email change does not
change the binding.

Invitations depend on a safe application URL, at least one configured sign-in
provider, and an outbound email provider. Account creation can succeed even if
invitation delivery fails. In that case the account remains pending and cannot
sign in: read the result banner, check outbound operations, then use **Resend
invitation**. Resending issues a new token and immediately revokes the previous
link, so tell the recipient to use only the newest message.

Treat invitation links as credentials. Send them only to the intended address,
do not paste them into tickets or chat, and ask the recipient to report an
unexpected or forwarded invitation. An expired, used, or superseded link can be
replaced with **Resend invitation**. A provider-email mismatch, a subject
already bound to another person, or an account already bound differently is an
identity conflict: stop, verify the person and provider account through a
separate channel, and investigate audit records. Do not change the pending
email simply to force the enrolment through.

### Account lifecycle

| State change | Immediate effect | What remains for review |
|---|---|---|
| Pause | Revokes active sessions and prevents sign-in | Personal mailboxes and shared assignments remain |
| Reactivate | Allows sign-in again | Disabled personal mailboxes remain disabled; removed access is not restored |
| Offboard | Revokes sessions, disables personal mailboxes, removes shared access | Stored personal-mailbox data remains; ownership, retention, and reassignment need an explicit decision |

The UI prevents you from pausing or offboarding your own account and protects
the last active manager. Downgrading another manager to Standard revokes that
person's current sessions. Maintain at least two active managers and use a
separate emergency recovery process controlled by the operator.

Before offboarding:

- identify personal and shared mailboxes the person uses;
- transfer any team responsibilities and unfinished shared drafts;
- decide how the personal mailbox and retained data must be handled;
- check organisation positions that name the person, especially public ones;
- perform the offboard action and review Audit log; and
- test the successor's access without using the former user's session.

## Mailboxes

**Management > Mailboxes** lists personal and shared mailboxes, status, stored
message counts, and direct user assignments.

- Personal mailboxes are normally created with a person and must retain at
  least one active or pending owner with Full access before they can be active.
- Shared mailboxes are created independently for a team or function address.
- Assigning existing access updates its permission bundle.
- Removing an assignment removes access but does not delete messages.
- Disabling a mailbox hides it, prevents sending, and rejects new delivery
  until re-enabled; retained mail remains stored.

Use **Read**, **Send as**, and **Full** according to the table in
[Shared mailboxes](shared-mailboxes.md#permission-bundles). Full access includes
permanent deletion from Trash, so it is not a routine default.

For a shared mailbox rollout, define who may respond as the function, who owns
filing and deletion, and what shared read/unread means operationally. Test the
workflow with at least two delegates before publishing the address.

## Organisation and public directory

**Management > Organisation** models structure without assuming a particular
sector or reporting shape:

- **Layers** are broad levels, regions, service lines, or other top-level
  groupings.
- **Units** are departments, teams, branches, or nested sub-units within a
  layer.
- **Role definitions** are reusable position titles and descriptions.
- **Positions** place a role in a unit and can optionally link an account,
  display title, occupant name, and assigned work email.

Build from layer to unit to role definition to position. Parent resources
cannot be deleted while dependent resources remain; move or delete the
dependants first. Use sort order to make the hierarchy predictable.

Positions are **Internal** by default. Marking a position Public requires an
active linked user, an occupant display name, and an active work mailbox
already assigned to that user. Even then, nothing is published unless the
master **Public organisation directory** switch is on.

The public endpoint returns exactly three fields for qualifying positions:
occupant name, position title, and work email. Account email, account status,
mailbox permissions, internal structure, notes, and other personal information
remain internal. Review the publication preflight and the public directory as
an unauthenticated visitor after every structural or staffing change.

## Usage policy

**Management > Usage policy** publishes immutable, versioned plain text. Always
use Preview and obtain the organisation's approval before **Publish and
enforce**.

Publication immediately makes that version current. Every signed-in user who
has not accepted it is redirected to the policy before Mail, Management, or
protected APIs can be used. The history shows acceptance counts for recent
versions; publishing a correction creates another version rather than editing
old evidence.

Do not paste secrets or unnecessary personal information into policy text. Use
the [acceptable-use template](acceptable-use-policy-template.md) as a starting
point and have the final policy reviewed for the deploying jurisdiction.

## Mail trace

**Management > Mail trace** is the first stop for delivery diagnostics. Search
by address, subject, message identifier, or source IP, and filter by direction
and status. Detail can include envelope and header addresses, status detail,
message size, authentication results, spam score, TLS version, source IP, and
provider relay response where recorded.

Trace is metadata, not a copy of the email body. A **Sent** or **Delivered**
state describes the stage recorded by cmail; it is not proof that a person read
the message. When investigating, record the trace identifier and time without
copying more address or subject data than the support channel needs.

## Audit log

**Management > Audit log** records security-sensitive, administrative, account,
policy, mailbox, organisation, and message-state events implemented by the
application. Filter by event type and review actor, target, time, and detail.

Use it to verify that a requested change occurred and to reconstruct an
administrative sequence. It is not a substitute for protected, exported audit
retention: access to the same deployment and database must be considered in the
organisation's evidence and backup design.

## Settings

**Management > Settings** changes public organisation details, service-generated
mail identity, support contact, application label, landing URL, and policy URL.
Changes take effect immediately and are audited.

OAuth credentials, session secrets, Cloudflare bindings, mail domain, outbound
provider keys, Web Push private keys, and other security-sensitive runtime
settings intentionally remain environment-controlled. If one of those must
change, follow the [configuration reference](configuration.md) and the
organisation's deployment change process.

## Safe operating routine

- Review Overview, Mail trace, Audit log, provider health, and backup results on
  a defined schedule.
- Test sign-in, policy gating, one inbound message, one internal message, and
  one external send after configuration or deployment changes.
- Grant Manager and Full access only where needed; review both regularly.
- Pause an account first when facts are uncertain, then investigate before a
  final offboard decision.
- Keep public positions internal during staffing changes until the three
  published fields have been checked.
- Never place credentials, exported mail, user lists, production Wrangler
  files, or incident evidence in the source repository.
- Treat notification delivery as best-effort. Mail trace and the mailbox itself
  are the authoritative operational checks.

Use the [operations checklist](operations-checklist.md) for recurring controls
and the [security checklist](security-checklist.md) before production use.
