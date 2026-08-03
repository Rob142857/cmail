# User guide

This guide is for people who read and send mail in cmail. If you manage the
service, start with the [manager handbook](manager-handbook.md). For phone and
tablet installation, see the [mobile app guide](mobile-pwa.md).

## Before you sign in

Your manager must create your account and send an invitation before your first
sign-in. Use only the newest invitation: its private enrolment link expires
after 72 hours, works once, and an invitation resend cancels every older link.
Do not forward the link or paste it into a support request. If no invitation
arrives, ask a manager to check delivery and use **Resend invitation**; opening
the ordinary sign-in page cannot enrol a pending, unbound account.

Use a sign-in method shown on the page:

- **Google** accepts the Google account configured for your sign-in email.
- **Microsoft** accepts Microsoft 365 work or school accounts. Outlook,
  Hotmail, and Live accounts also work when the organisation has enabled
  personal Microsoft accounts.

Choose the appropriate Google or Microsoft button in the invitation and sign in
with the exact address that received it. The provider must confirm that email
before cmail binds its immutable account identifier to your cmail account. The
invitation then becomes unusable. Continue using that same provider on other
browsers and devices; after enrolment you can open the organisation's normal
cmail URL directly.

If you choose the wrong provider, use a different provider email, let the link
expire, or see a message that the identity is already bound, stop and contact
your manager. Do not ask anyone to weaken the check or forward another person's
invitation. A manager can verify the account and issue a fresh link.

cmail requests only basic OpenID profile information to identify you. It does
not receive access to your personal inbox, files, contacts, or search history.
Returning sign-in uses the provider's immutable account identifier rather than
email alone, so another account cannot take over your cmail account merely by
acquiring an old or matching address.

If the organisation has published a usage policy, read and accept the current
version before entering Mail. A newly published version must be accepted again.

## Find your way around Mail

On a wide screen, navigation stays at the left. On a phone, open it with the
menu button.

- **All mailboxes** combines messages from every active mailbox assigned to
  you. Choose a specific mailbox when the address matters.
- **Personal** contains mailboxes provisioned for an individual.
- **Shared** contains team or function addresses delegated to you. See
  [Shared mailboxes](shared-mailboxes.md) before changing message state.
- **Inbox, Sent, Drafts, Archive, Spam, and Trash** select a folder while
  keeping the current mailbox selection.
- **Search this folder** searches only the folder and mailbox currently shown.
  Clear the mailbox selection to search that folder across all your assigned
  mailboxes.

The Inbox checks for new mail while it is visible. Use **Refresh** whenever you
need an immediate update. cmail requires a network connection and deliberately
does not cache mail for offline access.

## Read mail safely

Opening an unread message marks it read. In a shared mailbox that state is
visible to every delegate; it is not a private per-user marker.

cmail applies several safety boundaries:

- Remote images are blocked initially because loading them can reveal that a
  message was opened. Use **Load images** only when you trust the sender.
- Message HTML is isolated and cleaned before display, but links can still lead
  outside the organisation. Check destinations before opening them.
- Attachment downloads are forced, but attachments are not malware-scanned by
  cmail. Open only files you trust and follow your organisation's security
  process.

Available actions depend on your mailbox permission. Everyone with access can
view mail and mark it read or unread. Full access is required to star, move,
archive, classify as spam, restore, trash, or permanently delete a message.
The same rules apply to bulk actions.

Deleting a message normally moves it to Trash. Deleting it from Trash removes
the message body and attachments permanently; that action cannot be undone.

## Compose, reply, and forward

Select **Compose**, **Reply**, or **Forward**, then check the **From** field
before sending. It lists only active mailboxes from which you have Send as or
Full access permission. Recipients see that selected mailbox address, not the
personal account used to sign in.

The composer supports To, Cc, a subject, formatted message content, and up to
the limits displayed next to attachments. cmail asks for confirmation when a
message will leave the organisation. Provider and organisational rate limits
can still reject a send.

Drafts can be saved manually and are also saved periodically while you work.
Attachments remain only in the current browser tab until the message is sent;
they are not stored with a saved draft. A draft stored in a shared mailbox is
also shared with delegates who have permission to send from that mailbox.

After sending, cmail stores a Sent copy in the selected From mailbox. If a
provider accepts a message but the local Sent copy fails, do not send it again;
ask a manager to inspect Mail trace.

## New-mail alerts

When the operator has configured Web Push and your browser supports it, the
mail navigation includes **New-mail alerts**. Select **Turn on** and approve the
browser prompt. Alerts are optional and are enabled separately for every
browser, installed web app, and device.

Lock-screen text is deliberately minimal: it says that new mail arrived and
does not include the sender, subject, mailbox address, or message content. Treat
alerts as a convenience rather than guaranteed delivery; open cmail to confirm
current mail.

For installation, permissions, and troubleshooting, follow the
[iOS, iPadOS, and Android guide](mobile-pwa.md).

## Sign out and get help

Use **Sign out** in the account area when you finish, especially on a shared or
unmanaged device. Closing the browser alone does not sign you out.

Contact the support address shown in cmail if:

- your account has not been registered, is paused, or uses a different sign-in
  provider;
- an expected mailbox or From address is missing;
- mail remains absent after Refresh;
- sending fails repeatedly; or
- you believe a message, attachment, or account is unsafe.

Do not send passwords, OAuth codes, session cookies, or confidential message
content in a support request.
