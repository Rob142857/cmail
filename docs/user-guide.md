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
- **Email code** — for mailboxes hosted somewhere other than Google or
  Microsoft. Your invitation tells you which method applies to you; you don't
  choose it yourself. Select **Sign in with an email code**, request a code,
  and enter the 8-digit code cmail emails you within 5 minutes. This option
  never appears for the Manager role, which always needs a Google or
  Microsoft identity.

Sign in with the matching button and the exact address that received the
invitation. cmail then links your account to that sign-in permanently, and the
invitation stops working. Use the same method on other browsers and devices —
once enrolled, just open the organisation's normal cmail URL.

If you pick the wrong method, use a different email, let the link expire, or
see an "identity already bound" message: stop and contact your manager. Do not
ask anyone to weaken this check, or forward someone else's invitation — a
manager can verify your account and send a fresh link. If your organisation
restricts sign-in to specific countries and you're travelling, an unrecognised
country pauses your sign-in with a plain explanation and notifies your
managers automatically — try again once one of them approves it.

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
- Message content is cleaned before it's shown. If a link's visible text names
  one site but actually points somewhere else, or its address uses
  look-alike international characters, cmail sends you to a warning page
  first instead of straight to the link — read it before you continue.
- A banner marks the first message you've ever received from a sender, so you
  can give a request for payment, credentials, or urgency extra scrutiny
  before acting on it.
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

The composer supports To, Cc, Bcc, a subject, a formatted or plain-text
message, and attachments up to the limits shown next to the attachment button. Select
**Bcc** next to Cc to add one. Bcc is envelope-only: nobody in To or Cc ever
sees who you blind-copied, your own Sent copy still shows the full list
including Bcc, and a reply to your message never carries the original Bcc
list forward. Reply and Forward keep the original formatted message in a
separate, non-editable preview with remote images removed, so an old
tracking pixel cannot notify its sender when your recipient opens the
conversation. Provider or organisation rate limits can still reject a send.

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

### Formatting your message

The message box is a rich-text editor with a formatting bar across the top,
laid out like Outlook's **Format text** ribbon:

- **Font** and **Font size** (8 to 36 pt). The fonts are email-safe: Aptos,
  Calibri, Arial, Times New Roman, Georgia, Verdana and Courier New, each with
  fallbacks for devices that don't have it.
- **Bold**, **Italic**, **Underline** and **Strikethrough**.
- **Font colour** and **Highlight colour**, from a fixed palette. **Automatic**
  (or **No colour**) takes the colour off again.
- **Bulleted list**, **Numbered list**, **Decrease indent** and **Increase
  indent**. In a list, indenting nests the item.
- **Align left**, **Centre** and **Align right**.
- **Link**, **Quote**, **Clear formatting**, **Undo** and **Redo**.

Buttons show when their formatting is on, and hovering one shows its name and
shortcut. The keyboard shortcuts match Outlook: Ctrl+B, Ctrl+I, Ctrl+U,
Ctrl+K for a link, Ctrl+M and Ctrl+Shift+M to indent and outdent, Ctrl+Z to
undo and Ctrl+Y to redo (Cmd on a Mac). Ctrl+Shift+L, E and R align left,
centre and right. With the bar focused, the arrow keys move between its
controls.

**Link** (or Ctrl+K) opens a small box for a web or email address; typing
`example.org` links to `https://example.org`. Only web (http/https) and email
(mailto) links are accepted. To change or remove a link, put the cursor in it
and press **Link** again.

On a phone the bar is one row you can swipe sideways, with the most-used
controls (bold, italic, underline, size, colour, bulleted list and link) and
**More** (…) for the rest. It stays at the top of the message box while you
type, above the on-screen keyboard.

Text pasted from Word, Outlook, a web page or another email keeps bold,
italic, underline, lists, links, colours, sizes and the fonts listed above.
Office clutter (hidden Word styles, classes and comments), other fonts,
tables and images are removed.

#### Default font

New messages, replies and forwards start in **Aptos, 12 pt**, in black, the
same as Outlook. To change it, open **Mail > Settings > Font and signature**
and choose a font and size under **Default font**. It's saved to your
account, so it follows you to every device. The message is sent with that
font and size set on the whole body, so it looks the same in the recipient's
Outlook, Gmail or Apple Mail.

Prefer plain text? Select **Plain text** above the message box. Switching
from rich text to plain text removes the formatting (cmail asks first if
there is any text), and switching back turns your paragraphs and line breaks
into rich text. cmail remembers your choice for new messages on that device,
and a saved draft always reopens in the mode it was written in.

Every message is sent with both a formatted (HTML) version and a plain-text
version, so recipients whose email app shows only plain text still see your
lists, quotes and link addresses. cmail cleans the formatting on the server
before saving or sending: anything beyond the toolbar's options, including
scripts, images and any other styling, is removed.

### Email signatures

Open **Mail > Settings > Font and signature** to set your personal sign-off.
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

## Inbox rules

Rules file new mail for you, like rules in Outlook: for example, move
newsletters to **Archive** or star everything from your manager. Open
**Settings > Rules**, choose **New rule**, then add conditions (such as
**From** or **Subject includes**) and actions (**Move to**, **Mark as read**,
**Star it**, **Mark with importance**). To start from a message, open it and
choose **Create rule**. Rules run in order on mail arriving in the Inbox, after
your organisation's junk filtering. They never forward mail. See
[Inbox rules](inbox-rules.md).

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

## Connect an AI assistant

If your organisation allows it, you can connect an AI assistant such as Claude
to your mail. The assistant opens a cmail window; you sign in and choose what
it may do and which mailboxes it may use. Reading and drafting are offered by
default; sending is off unless you turn it on. See and disconnect your apps in
**Settings > Connected AI apps**. Remember that email is written by other
people: don't let an assistant act on instructions it finds in a message. See
[AI agents and MCP](mcp.md).

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
