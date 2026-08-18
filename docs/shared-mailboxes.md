# Shared mailboxes

A shared mailbox is a team or function address — such as `support@example.org` or `accounts@example.org` — that several people can access without sharing a password. A Manager grants access to named accounts, and each person signs in with their own Google or Microsoft identity.

These terms — shared mailbox, Send as, Full access, Mail trace — describe cmail's own permission model. cmail is not Microsoft Exchange, is not affiliated with Microsoft, and does not match it feature-for-feature.

## Permission bundles

Permissions are assigned directly to a person, for one mailbox. They do not come from an organisation position, an account role, or a group.

| Permission | Read and mark read/unread | Send as this address; use shared drafts | Star, move, archive, spam, trash, restore, delete |
|---|---:|---:|---:|
| **Read** | Yes | No | No |
| **Send as** | Yes | Yes | No |
| **Full access** | Yes | Yes | Yes |

The management screen sometimes shortens **Full access** to **Full**. Personal-mailbox owners always have Full access; shared mailboxes have no special "owner" account.

Give people only the access they need:

- **Read** — for reviewers who need to see incoming work, but should not reply as the team or reorganise its mail.
- **Send as** — for responders who need to reply as the shared address, while a smaller group controls filing and deletion.
- **Full access** — for mailbox coordinators. Only give this to people you trust to change anything for the whole team, including permanently deleting mail from Trash.

## Shared state

cmail stores one copy of each message, with one state. So everyone with access shares:

- read or unread status;
- starred status;
- which folder it is in (Inbox, Sent, Drafts, Archive, Spam, or Trash); and
- the contents of drafts saved in that mailbox.

Opening a message marks it read for everyone. If someone with Full access moves or deletes it, everyone sees that change. Anyone with Send as or Full access can open and edit a shared draft. Attachments chosen in the composer are not saved with the draft — they stay only in that browser tab until the message is sent.

Agree on ground rules before you launch a shared mailbox — for example, leave unhandled items unread, only use Archive once something is finished, and only permanently delete mail as part of a documented retention process. cmail does not currently offer per-person read status, categories, assigning items to a specific person, "send on behalf of", or approval workflows.

## From identity and replies

The composer's **From** list shows active mailboxes where you have Send as or Full access. Choosing the shared address makes that the sender address recipients see. cmail never shows your personal sign-in address as the sender, and does not add a "sent on behalf of" label.

Replying uses the mailbox that received the message, as long as you can send from it. Always check **From** before you send, especially if you have several personal and shared mailboxes. Read permission alone does not add the shared address to From. A Sent copy is stored in the mailbox you sent from, so other people with access can see the team's response.

Internal recipients on the same cmail deployment get an internal mailbox copy. External recipients are sent through the configured outbound provider. Mail trace records delivery details, but it is not a copy of the message content.

## Manager setup flow

1. In **Management > People**, create a sign-in account for each delegate.
2. In **Management > Mailboxes**, select **Create a shared mailbox**. Choose an address on your mail domain, and give it a clear display name.
3. Select **Assign mailbox access**, choose the mailbox and an active or pending account, then grant Read, Send as, or Full access.
4. Repeat for every delegate. If continuity matters, give at least two trusted people Full access.
5. Test inbound mail, a reply from the shared address, Sent visibility, shared read state, and the agreed filing workflow.
6. Review **Mail trace** and **Audit log** for your test, then tell the team the agreed ground rules.

Assigning access to someone who already has it just updates their permission — it does not create a duplicate. Removing access does not delete mailbox data. Organisation positions and the public directory are separate from mailbox access.

## Disable, re-enable, and offboard

Disabling a mailbox hides it, stops it sending, and stops new mail arriving until it is enabled again. Existing messages stay stored. Use disable as a controlled pause, not as deletion.

Pausing a user ends their active sessions but keeps their mailbox assignments. Reactivating restores the account with those assignments still in place.

Offboarding a user ends every session, cancels any pending invitation and device alerts, disables their personal mailbox, removes their shared-mailbox access, and makes any public position internal again. Reactivating the account later does not automatically undo any of this — a manager must review and restore each part by hand.

Before removing the last active delegate from a shared mailbox, hand over responsibility and check that retention, pending drafts, and unresolved mail are all handled. Review the Audit log after any access change.

## What this does not cover

Shared-mailbox access only works inside the cmail web app. cmail does not support Exchange, Microsoft Graph, IMAP, POP, or other native mail-client access, and cannot automatically add a mailbox into Outlook or another mail app. Cloudflare Email Routing handles inbound mail, and the configured outbound provider handles sending to external recipients.

For new mail, cmail sends a generic alert (Web Push) to each active delegate who has subscribed on a device. It does not name the mailbox, sender, subject, or message on the lock screen. Alerts are best-effort and do not reserve the item for one person. Tapping an alert opens the message in its shared mailbox — the server checks your current access again at that point, so a revoked or disabled mailbox stays hidden even from an old alert.

For administration details and safe lifecycle procedures, see the [manager handbook](manager-handbook.md). For day-to-day message use, see the [user guide](user-guide.md).
