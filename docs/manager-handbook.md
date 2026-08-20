# Manager handbook

This handbook covers cmail's management functions, for the **Manager** role.
Deployment bindings, secrets, DNS, identity-provider registration, backups,
and Cloudflare operations are the operator's job — see the
[deployment guide](deployment.md) for those.

cmail's management centre uses concepts familiar from enterprise mail systems,
but it is not Microsoft Exchange, is not affiliated with Microsoft, and does
not match it feature-for-feature.

## Three separate access concepts

Keep these models separate when granting access:

| Model | Values | What it controls |
|---|---|---|
| Account role | Standard, Manager | Access to the cmail management centre |
| Mailbox permission | Read, Send as, Full access | Actions in one assigned mailbox |
| Organisation role definition | A reusable title such as Service manager | Structure and optional directory display only |

Linking someone to an organisation position does not grant mailbox access or
the Manager role. Making someone a Manager does not grant access to every
mailbox. Grant only what's needed in each model, independently.

## Recommended first-run order

1. Open **Overview** and note incomplete deployment-readiness checks.
2. In **Settings**, confirm the system-mail identity, support address,
   organisation name and URLs, and the app name.
3. In **People**, provision at least two trusted managers, then create
   standard accounts and their required personal mailboxes.
4. In **Mailboxes**, create shared addresses and assign explicit permissions.
5. In **Organisation**, build layers, units, role definitions, and positions.
   Keep the public directory off until its publication preflight is clean.
6. In **Usage policy**, preview and publish the approved text.
7. Run controlled inbound, internal, and external message tests. Confirm
   results in **Mail trace** and changes in **Audit log**.

Test in a staging deployment first. Never make identity, routing, DNS, or
broad access changes for the first time during a live incident.

## Overview

**Management > Overview** shows activity totals, deployment readiness, quick
links, and the public-directory privacy state. Treat it as a starting point,
not complete monitoring — you still need provider consoles, Cloudflare
telemetry, backups, and external alerting.

## People

**Management > People** controls account creation, invitation delivery,
account roles, and lifecycle. Creating the account is not enough for
someone's first sign-in — they must also complete a current, manager-issued
invitation.

### Provision an account

1. Select **Add a person**.
2. Enter their work email address and a display name. You don't choose a
   sign-in method yourself — cmail works out who hosts the address and
   routes the invitation accordingly.
3. Create their personal mailbox address on your configured mail domain.
   cmail creates it active, with Full access permanently linked to that
   person's account.
4. Choose Standard or Manager. Choose Manager only for a Google- or
   Microsoft-hosted address: an email-code identity can never actually sign
   in as Manager, so inviting one that way is a dead end, not just a
   restriction you can lift later.
5. Send the invitation now if delivery is configured, or leave the person
   pending and use **Resend invitation** later.

The account starts **Pending**, with no sign-in linked yet. cmail checks
whether the address is hosted by Google, by Microsoft, or by neither. A
Google or Microsoft address gets a single **Activate your mailbox** button
that leads straight into that provider's sign-in; whichever the person uses
must return the same email you entered. Google also confirms the email is
verified; Microsoft does not provide that confirmation, so its email is
trusted only because it arrives through the invitation. An address hosted
elsewhere gets the same **Activate your mailbox** button, but it leads to a
one-time email code instead — the person requests a code and enters it,
rather than picking a provider. See the [user guide](user-guide.md#before-you-sign-in)
for what an invitee sees at each step. If cmail can't confirm who hosts the
address at all, the invitation is refused up front with a plain error; try
again shortly, or double-check the address. Either way, the link expires
after 72 hours and
works once. On success, the account becomes **Active**, permanently linked to
that sign-in — nobody can switch it to a different provider, method, or
account later, even if the email address changes afterward.

Invitations need a valid application URL, at least one sign-in provider, and
a working outbound email setup. Creating the account can succeed even if the
invitation email fails to send — the account stays pending and cannot sign
in. Check the result banner and your outbound email status, then use
**Resend invitation**. This issues a new link and immediately cancels the old
one, so tell the recipient to use only the newest email.

Treat invitation links like passwords: send them only to the intended
address, never paste them into tickets or chat, and ask recipients to report
an unexpected or forwarded invitation. Replace an expired, used, or
superseded link with **Resend invitation**. If the email doesn't match, the
account is already bound to someone else, or you see any other binding
conflict, stop: verify the person through a separate channel and check the
audit records. Never change the pending email just to force enrolment
through.

### Account lifecycle

| State change | Immediate effect | What remains for review |
|---|---|---|
| Pause | Revokes active sessions and prevents sign-in | Personal mailboxes and shared assignments remain |
| Reactivate | Allows sign-in again | Disabled personal mailboxes remain disabled; removed access is not restored |
| Offboard | Revokes every session, pending invitation, and device notification; disables their personal mailbox; removes shared access; and makes published positions internal | Stored personal-mailbox data and its owner link remain; reactivation does not restore a mailbox, invitation, device notification, public listing, or shared access |

You cannot pause or offboard your own account, and the system protects the
last active manager. Downgrading another manager to Standard ends their
current sessions. Keep at least two active managers, and rely on the
operator's separate emergency recovery process if needed.

### Ownership migration follow-up

An ownership migration (for deployments upgraded from an earlier version)
only auto-links a personal mailbox that has just one Full-access assignment.
If a person had more than one valid candidate mailbox, only the oldest gets
linked — the rest stay ownerless, disabled, and excluded from delegation,
along with any mailbox that had extra or conflicting assignments. Before any
retention, successor, or address-reuse decision, back up the database and
inspect these records directly in D1 (cmail's database). There is no quick
fix built in for this: keep the disabled record and its mail, and follow a
separately reviewed migration or retention process.

Before offboarding:

- list the personal and shared mailboxes they use;
- hand over team responsibilities and unfinished shared drafts;
- decide what happens to their personal mailbox and its data;
- check organisation positions that name them, especially public ones;
- tell the successor or contact owner how correspondence should be
  redirected — cmail will not send a departure notice to future senders;
- offboard the account and review the Audit log; and
- test the successor's access using their own session, not the former
  user's.

### Unavailable former addresses

After offboarding, mail to the person's old address is rejected during
delivery, with the same generic response cmail uses for any unknown or
disabled address, so senders cannot tell it was offboarded rather than never
existing. cmail sends no bounce, auto-reply, or departure notice of its own;
whether the original sender sees any notice at all depends on their own
provider.

Use Cloudflare Email Routing and Worker metrics/logs to watch for unusual
rejection rates or abuse — Mail trace does not keep a lasting, per-address
record of these rejections.

## Mailboxes

**Management > Mailboxes** lists personal and shared mailboxes, their status,
stored message counts, and who's assigned to them.

- Personal mailboxes are created together with a person, and keep a
  permanent owner link with Full access, retained for audit. They are not
  meant for general delegation.
- Shared mailboxes are created separately, for a team or function address.
- Assigning access to someone who already has it just updates their
  permission.
- Removing an assignment removes access, but not the messages.
- Disabling a mailbox hides it, stops it sending, and rejects new mail until
  it's re-enabled; stored mail is kept.

Use **Read**, **Send as**, and **Full** as described in
[Shared mailboxes](shared-mailboxes.md#permission-bundles). Full access
includes permanently deleting from Trash, so do not hand it out by default.

Before rolling out a shared mailbox, decide who can respond as the function,
who owns filing and deletion, and what shared read/unread status means for
the team in practice. Test the workflow with at least two delegates before
you publish the address.

## Email signatures

**Management > Email signatures** controls the optional organisation-wide
signature, and lets you govern personal signatures. Use **Append to outgoing
mail** for an approved footer, branding, or legal notice — turning it off
keeps the saved content but stops using it. Under **Personal signatures**,
edit a person's layer and use **Lock personal signature** to take control of
it; saving here replaces only that person's layer, never the organisation
footer.

Keep signature content concise and approved: no secrets, tracking pixels, or
unnecessary personal information. Review locked signatures when staff or
roles change, and check the Audit log for signature and lock changes. See
[Email signatures](signatures.md) for the full procedure and ordering rules.

## Organisation and public directory

**Management > Organisation** models your structure, without assuming any
particular shape:

- **Layers** — broad levels, regions, or service lines.
- **Units** — departments, teams, branches, or sub-units within a layer.
- **Role definitions** — reusable position titles and descriptions.
- **Positions** — a role placed in a unit, optionally linked to an account,
  with a display title, occupant name, and work email.

Build in order: layer, then unit, then role definition, then position. You
cannot delete something while it still has dependants — move or delete those
first. Use sort order to keep the hierarchy predictable.

Positions are **Internal** by default. To make one Public, it needs an active
linked user, an occupant display name, and an active work mailbox already
assigned to that user — and even then, nothing publishes until the master
**Public organisation directory** switch is on.

The public page shows exactly three fields per qualifying position: occupant
name, position title, and work email. Account email, account status, mailbox
permissions, internal structure, notes, and other personal information stay
internal. After every structural or staffing change, check the publication
preflight, and view the public directory as an outside visitor would.

## Usage policy

**Management > Usage policy** publishes plain text as a fixed, versioned
record. Always use Preview and get your organisation's approval before you
select **Publish and enforce**.

Publishing makes that version current immediately. Anyone signed in who
hasn't accepted it gets redirected to the policy before they can use Mail,
Management, or anything else protected. The history shows acceptance counts
for past versions — publishing a correction creates a new version, rather
than editing old evidence.

Do not put secrets or unnecessary personal information in the policy text.
Use the [acceptable-use template](acceptable-use-policy-template.md) as a
starting point, and have the final version reviewed for your jurisdiction.

## Mail trace

**Management > Mail trace** is the first place to check for delivery
problems. Search by address, subject, message ID, or source IP, and filter by
direction and status. Details can include envelope and header addresses,
status, message size, authentication results, spam score, TLS version, source
IP, and the provider's relay response where recorded.

Trace shows metadata, not a copy of the message body. **Sent** or
**Delivered** describes the stage cmail recorded — it is not proof someone
read the message. When investigating, record the trace ID and time, and copy
only as much address or subject data as your support channel actually needs.

## Spam and quarantine

**Management > Quarantine** lists messages cmail filed to Spam instead of
Inbox, across every mailbox. For each one you can **Release** it back to
Inbox, **Delete** it, or **Allow**/**Block** its sender for the whole
organisation. Allow and block rules take effect on the next message from
that address or domain; an exact address always beats a rule for its bare
domain, and block always wins a same-level conflict.

A message only reaches Spam when `SPAM_QUARANTINE_SCORE` is configured and
the inbound score met it, or a block rule matched — see
[Spam and quarantine](spam-and-quarantine.md) for the full explanation,
including how to choose a threshold. Quarantine is filing, not deletion:
nothing is removed until someone explicitly deletes it, whether from this
page or from the mailbox's own Spam folder. Review it on the same schedule
as Mail trace and Audit log.

## Audit log

**Management > Audit log** records security-sensitive, administrative,
account, policy, mailbox, organisation, and message-state events. Filter by
event type, and review the actor, target, time, and detail of each.

Use it to confirm a change happened, or to reconstruct a sequence of admin
actions. It is not a substitute for protected, exported audit retention —
anyone with access to the same deployment and database should be factored
into your evidence and backup design.

## Settings

**Management > Settings** changes public organisation details, the service's
mail identity, support contact, app label, landing URL, and policy URL. The
**Sign-in security** section is where you restrict sign-in — across Google,
Microsoft, and email-code sign-in alike — to an approved list of countries.
It's off by default; picking at least one country turns it on, and a
**Restore default — allow all countries** button turns it back off. Once
it's on, a sign-in from anywhere else is paused rather than refused outright,
and the person is told their managers have been notified. Approve, deny, or
revoke those requests from **Management > Travel approvals**. See
[Travel approvals](travel-approvals.md) for the full notification and audit
behaviour. Changes here take effect immediately and are recorded in the
Audit log.

OAuth credentials, session secrets, Cloudflare bindings, mail domain,
outbound provider keys, Web Push private keys, and other security-sensitive
settings are deliberately kept out of this screen and controlled at the
deployment level instead. To change one, follow the
[configuration reference](configuration.md) and your organisation's
deployment change process.

## Safe operating routine

- Review Overview, Mail trace, Audit log, provider health, and backup results
  on a set schedule.
- After any configuration or deployment change, test sign-in, policy gating,
  one inbound message, one internal message, and one external send.
- Grant Manager and Full access only where needed, and review both
  regularly.
- If the facts are unclear, pause an account first and investigate before
  deciding to offboard.
- During staffing changes, keep public positions internal until you've
  checked the three published fields.
- Never put credentials, exported mail, user lists, production Wrangler
  files, or incident evidence in the source repository.
- Treat notifications as best-effort only. Mail trace and the mailbox itself
  are the real operational checks.

## Support and escalation

Train designated internal people as your first support level (L1): own user
communication, follow approved runbooks (step-by-step guides for common
issues), use Mail trace and Audit log without copying message content, and
apply your organisation's incident and privacy processes. Escalate a real,
reproducible cmail product defect to RME Solutions Technology through your
agreed channel, with a safe reproduction, the deployed version, impact, time
window, and redacted trace or error IDs.

Design and configuration work, provider or DNS issues, bespoke changes, and
problems that cannot be reproduced are separately scoped or quoted work, not
an included defect response, unless a separate support agreement covers them.
Never include credentials, message bodies, attachments, raw exports, or
unnecessary personal data in a case. Handle a suspected vulnerability through
[the security policy](../SECURITY.md), and follow your organisation's
incident process for security or privacy incidents. See the full
[support process](support-process.md) for intake, scope, and evidence in
detail — this is not a service-level agreement or a certification.

Use the [operations checklist](operations-checklist.md) for recurring
controls and the [security checklist](security-checklist.md) before
production use.
