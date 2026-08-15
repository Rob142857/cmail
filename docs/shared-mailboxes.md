# Shared mailboxes

A shared mailbox is a function or team address—such as `support@example.org`
or `accounts@example.org`—that several provisioned users can access without
sharing a password. Managers delegate access to named user accounts, and each
delegate signs in with their own Google or Microsoft identity.

cmail uses administration terms familiar to people who manage enterprise mail:
shared mailbox, Send as, Full access, and Mail trace. These describe cmail's
own permission model. cmail is not Microsoft Exchange, is not affiliated with
Microsoft, and does not claim feature or protocol parity.

## Permission bundles

Permissions are assigned directly to a user for one mailbox. They do not come
from an organisation position, an account role, or a nested group.

| Permission | Read and mark read/unread | Send from address and use shared drafts | Star, move, archive, spam, trash, restore, delete |
|---|---:|---:|---:|
| **Read** | Yes | No | No |
| **Send as** | Yes | Yes | No |
| **Full access** | Yes | Yes | Yes |

The management interface may shorten **Full access** to **Full**. Personal
mailbox owners always require Full access; shared mailboxes have no special
owner account.

Use least privilege:

- **Read** suits reviewers who must see incoming work but must not respond as
  the function or reorganise its records.
- **Send as** suits responders who need the shared identity while a smaller
  group controls filing and deletion.
- **Full access** suits mailbox coordinators. Give it only to people trusted to
  change state for the whole team, including permanent deletion from Trash.

## Shared state

cmail stores one copy of each mailbox message and one state for that copy. All
delegates therefore share:

- read or unread state;
- starred state;
- Inbox, Sent, Drafts, Archive, Spam, and Trash placement; and
- the contents of drafts saved in that mailbox.

Opening a message marks it read for the team. A Full access delegate moving or
deleting it changes what everyone sees. A Send as or Full access delegate can
open and edit a shared draft. Attachments selected in the composer are not part
of a saved draft; they remain only in that browser tab until sent.

Agree on a working convention before launch—for example, leave unhandled items
unread, use Archive only after completion, and reserve permanent deletion for a
documented retention process. cmail does not currently provide per-user read
state, categories, assignment-to-agent, Send on behalf, or approval workflows.

## From identity and replies

The composer **From** list contains active mailboxes for which the signed-in
user has Send as or Full access permission. Selecting the shared address makes
that address the sender recipients see. cmail does not expose the delegate's
personal sign-in address as the From identity and does not add a “sent on
behalf of” label.

Replying to a message prefers the mailbox that received it when the user can
send from that mailbox. Always check **From** before sending, particularly when
you have several personal and shared mailboxes. Read permission alone does not
make the shared address available in From. A Sent copy is stored in the selected
From mailbox, so other delegates with access can see the team response.

Internal recipients hosted by the same cmail deployment receive an internal
mailbox copy. External recipients are submitted through the deployment's
configured outbound provider. Mail trace records delivery metadata, but it is
not a second copy of message content.

## Manager setup flow

1. In **Management > People**, provision each delegate's own sign-in account.
2. In **Management > Mailboxes**, select **Create a shared mailbox**, choose a
   function address on the configured mail domain, and give it a clear display
   name.
3. Select **Assign mailbox access**, choose the mailbox and active or pending
   account, then grant Read, Send as, or Full access.
4. Repeat for every delegate. Grant at least two trusted people Full access
   when continuity requires it.
5. Test inbound mail, a reply from the shared address, Sent visibility, shared
   read state, and the agreed filing workflow.
6. Review **Mail trace** and **Audit log** for the test, then communicate the
   team's operating convention.

Assigning a user who already has access updates that user's permission; it does
not create a duplicate assignment. Removing access does not delete mailbox
data. Organisation positions and the public directory are independent of
mailbox delegation.

## Disable, re-enable, and offboard

Disabling a mailbox hides it from users, stops sending from it, and stops new
inbound delivery until it is enabled again. Existing messages remain stored.
Use disable for a controlled hold; do not treat it as data deletion.

Pausing a user revokes active sessions but preserves mailbox assignments.
Reactivation restores the account with those assignments still present.

Offboarding a user revokes every session, pending invitation, and device
notification subscription; disables that user's owned personal mailbox; removes
their shared-mailbox assignments; and makes any public position internal. Reactivating the account later does not
automatically re-enable personal mailboxes, issue an invitation, republish a
position, or restore shared access; a manager must review each explicitly.

Before removing the final operational delegate from a shared mailbox, transfer
responsibility and confirm that retention, pending drafts, and unresolved mail
have been handled. Review the Audit log after any access change.

## Operational boundaries

Shared-mailbox access works only inside the cmail web application. The current
product does not expose Exchange, Microsoft Graph, IMAP, POP, or end-user SMTP
mailbox access; it does not automap a mailbox into Outlook or another native
mail client. Cloudflare Email Routing handles inbound transport and the
configured outbound provider handles external submission.

For new mail, cmail attempts a generic Web Push alert to each active delegate
who has subscribed on a device. It does not identify the shared mailbox,
sender, subject, or message on the lock screen. Alerts are best-effort and do
not reserve work for one team member. Tapping an alert opens the message in
the relevant shared mailbox; the server checks the person's current assignment
again, so a revoked or disabled mailbox is not exposed by an old alert.

For administration details and safe lifecycle procedures, see the
[manager handbook](manager-handbook.md). For day-to-day message use, see the
[user guide](user-guide.md).
