# User guide

This guide is for anyone who reads and sends mail in cmail. If you manage the
service, start with the [manager handbook](manager-handbook.md) instead. For
installing cmail on a phone or tablet, see the [mobile app guide](mobile-pwa.md).

## Before you sign in

A manager must create your account and send you an invitation before you can
sign in for the first time. Always use the newest invitation you received: the
link is private, works once, and expires after 72 hours. If a manager resends
your invitation, every older link stops working. Do not forward the link or
paste it into a support request. If no invitation arrives, ask a manager to
check it was sent and use **Resend invitation** — opening the normal sign-in
page will not work until your account is enrolled.

Use one of the sign-in options shown on the page:

- **Google** — the Google account matching your sign-in email.
- **Microsoft** — Microsoft 365 work or school accounts. Outlook, Hotmail, and
  Live personal accounts also work if your organisation has enabled them.

Sign in with the matching Google or Microsoft button and the exact address
that received the invitation. cmail then links your account to that sign-in
permanently, and the invitation stops working. Use the same provider on other
browsers and devices — once enrolled, just open the organisation's normal
cmail URL.

If you pick the wrong provider, use a different email, let the link expire, or
see an "identity already bound" message: stop and contact your manager. Do not
ask anyone to weaken this check, or forward someone else's invitation — a
manager can verify your account and send a fresh link.

cmail only requests basic profile information (OpenID) to identify you, never
access to your personal inbox, files, contacts, or search history. Signing in
again uses your provider's permanent account ID, not just your email, so
nobody can hijack your cmail account by reusing an old or matching address.

If your organisation has published a usage policy, you must read and accept
the current version before you can open Mail. If a new version is published
later, you will need to accept that too.

## Find your way around Mail

On a wide screen, the navigation menu stays on the left. On a phone, open it
with the menu button.

- **All mailboxes** shows messages from every active mailbox assigned to you.
  Pick a specific mailbox when the address matters.
- **Personal** holds mailboxes set up for one individual.
- **Shared** holds team or function addresses delegated to you. See
  [Shared mailboxes](shared-mailboxes.md) before you change a message's state.
- **Inbox, Sent, Drafts, Archive, Spam, and Trash** pick a folder, keeping your
  current mailbox selection.
- **Search this folder** searches only the folder and mailbox you're currently
  viewing. Clear the mailbox selection to search that folder across all your
  mailboxes.

The Inbox checks for new mail while it's open. Use **Refresh** any time you
want an immediate update. cmail needs a network connection — it does not store
mail for offline access.

## Read mail safely

Opening an unread message marks it as read. In a shared mailbox, everyone with
access sees that same read state — it is not private to you.

cmail protects you in a few ways:

- Images hosted elsewhere are blocked by default, since loading them can tell
  the sender you opened the message. Select **Load images** only if you trust
  the sender.
- Message content is cleaned before it's shown, but links can still lead
  outside your organisation — check where a link goes before you click it.
- Attachments always download as files. cmail does not scan them for malware,
  so open only files you trust and follow your organisation's security
  process. The label under each attachment tells you what kind of file it is.
  On an Android phone, opening a Word, Excel, or PowerPoint file links you to
  the free Microsoft app for it if you don't already have one installed.
  Google Docs, Sheets, and Slides files open in your browser instead of
  downloading.

What you can do depends on your mailbox permission. Everyone with access can
view mail and mark it read or unread. You need Full access to star, move,
archive, mark as spam, restore, trash, or permanently delete a message — the
same applies when doing this to several messages at once.

Deleting a message normally moves it to Trash. Deleting it again from Trash
permanently removes the message body and attachments — this cannot be undone.

## Compose, reply, and forward

Select **Compose**, **Reply**, **Reply all**, or **Forward**, then check the
**From** field before you send. It only lists active mailboxes where you have
Send as or Full access. Recipients see that selected address, not the personal
account you signed in with.

**Reply** uses the message's Reply-To address if it has one, otherwise the
sender. **Reply all** also includes the original To and Cc recipients, minus
your own mailbox addresses. Replying from a Sent item targets the original
recipients, not yourself. Always check the recipient fields before sending,
especially from a shared mailbox.

The composer supports To, Cc, a subject, plain-text content, and attachments
up to the limits shown next to the attachment button. Reply and Forward keep
the original formatted message in a separate, non-editable preview with
remote images removed, so an old tracking pixel cannot notify its sender when
your recipient opens the conversation. cmail asks you to confirm before a
message leaves the organisation, though provider or organisation rate limits
can still reject a send.

As you type in **To** or **Cc**, cmail suggests addresses — first from
everyone the selected **From** mailbox has actually written to or heard from,
then from the organisation directory. Switching **From** switches the
suggestions, since each mailbox keeps its own history.

Only use **Importance** when the recipient genuinely needs the High or Low
signal (a red exclamation mark or downward arrow in cmail, Outlook, and other
compatible apps). It's saved with the draft, but does not speed up delivery,
bypass spam filters, or guarantee anyone notices. A new reply or forward
always starts at Normal, even if the original was High or Low.

cmail saves your draft shortly after you stop typing, or you can save it
manually; edits made during a save are queued for the next one. **Back to
message** waits for the latest save, then returns you to the message with a
**Draft saved** confirmation. A local recovery copy protects unsaved text if
you reload, and is removed once the save succeeds. If another tab saved a
different version, cmail keeps your local copy and asks you to restore or
discard it before you continue — it never silently overwrites either one.

Attachments stay only in the current browser tab until you send — they are
not saved with the draft, and cmail warns you before you leave a composer
that still has them. Forwarding does not automatically re-attach original
files or embedded images, since forwarding drops the references that showed
them inline; instead, the Forward screen gives you a download link for each
original part, so you choose exactly what to reattach. Drafts stay private to
whoever created them, even from a shared mailbox — other delegates only see
the Sent copy once it's delivered, not the unfinished draft.

### Email signatures

Open **Mail > Settings > Email signature** to set your personal sign-off.
cmail adds it below your new text and above any quoted history, in every
message, reply, or forward — below an organisation signature too, if one is
enabled. The toolbar supports basic formatting. Pasted content becomes plain
text, and any unsafe markup is stripped before saving.

If the page says **Admin managed**, a Manager has locked your signature — you
can preview it but not change it. Clearing it removes only your layer, not any
organisation-wide footer. See [Email signatures](signatures.md) for the full
rules.

After sending, cmail stores a Sent copy in the mailbox you sent from. If a
message is accepted by the provider but the Sent copy fails to save, do not
resend it — ask a manager to check Mail trace.

## New-mail alerts

When your operator has set up Web Push and your browser supports it, the mail
navigation includes **New-mail alerts**. Select **Turn on** and approve the
browser prompt. Alerts are optional, and you need to turn them on separately
for every browser, installed app, and device.

The lock-screen text is deliberately minimal — it just says new mail arrived,
with no sender, subject, mailbox, or message content. Treat alerts as a
convenience, not a guarantee. Open cmail to check your actual mail.

For installation, permissions, and troubleshooting, see the
[iOS, iPadOS, and Android guide](mobile-pwa.md).

## Sign out and get help

Use **Sign out** in the account area when you finish, especially on a shared
or unmanaged device. Closing the browser alone does not sign you out.

Contact the support address shown in cmail if:

- your account is not registered, is paused, or uses a different sign-in
  provider;
- a mailbox or From address you expect is missing;
- mail is still missing after you Refresh;
- sending keeps failing; or
- you think a message, attachment, or account is unsafe.

Do not include passwords, OAuth codes, session cookies, or confidential
message content in a support request.
