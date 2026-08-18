# Spam and quarantine

cmail can score inbound mail and file the worst of it into the **Spam**
folder instead of Inbox. Filing is off until a Manager turns it on, and
quarantine never deletes anything — it just chooses a folder.

## How scoring works

Cloudflare Email Routing already blocks mail that fails SPF and DKIM
together, breaks the sender's DMARC policy, or comes from a known bad
address — see [Email authentication](email-authentication.md). What reaches
cmail has already cleared that check. Cloudflare then reports a spam score
on the `X-CF-SpamH-Score` header for whatever gets through.

Cloudflare doesn't publish what that score means, so cmail always records it
in **Management > Mail trace**, for every inbound message, whether or not
filing is turned on. Recording is not filing: a score alone never moves a
message until an operator sets `SPAM_QUARANTINE_SCORE` (see
[Configuration reference](configuration.md#inbound-worker-limits)). Left
blank, cmail only records the score and always delivers to Inbox.

## What quarantine means

A quarantined message is filed straight to the recipient's **Spam** folder,
the same folder you can already move mail to and from by hand. It is not
deleted, not hidden from search, and not treated differently for storage or
retention than any other folder. The only difference is where it lands.

## Getting your own mail back

If a real message ends up in Spam, move it back yourself: open **Spam**,
select the message, and move it to **Inbox** — the same folder controls
described in the [user guide](user-guide.md#find-your-way-around-mail). This
needs Full access to the mailbox, the same permission any other folder move
needs; see [Shared mailboxes](shared-mailboxes.md#permission-bundles) if the
mailbox is shared.

## Organisation-wide sender rules

A Manager can also allow or block a specific sender for the whole
organisation, from **Management > Quarantine** (`/admin/quarantine`). A rule
is either a full address (`person@example.com`) or a bare domain
(`example.com`), lowercased, and applies to every mailbox:

- **An exact address always beats a domain rule.** Blocking `example.com`
  but allowing `person@example.com` still delivers that one person to Inbox.
- **Block always beats allow at the same level** — the safer outcome wins
  if a sender is somehow both allowed and blocked at the same level.
- **Allow skips scoring entirely.** An allowed sender always reaches Inbox
  even with a high score; a blocked sender always goes to Spam even with a
  low score or none at all.
- Rules take effect on the next inbound message. They aren't retroactive and
  don't move mail that already arrived.

## The quarantine page

**Management > Quarantine** lists messages currently sitting in Spam, across
every mailbox. For each one, a Manager can:

- **Release** it — move it back to the owning mailbox's Inbox.
- **Delete** it — the same permanent removal as deleting from Trash.
- **Allow** or **block** the sender — adds an organisation-wide rule so
  future mail from that address or domain is handled the same way
  automatically.

This is the same message everyone else sees in that mailbox's Spam folder,
not a separate copy — releasing or deleting it here is exactly like doing so
from the mailbox itself.

## Choosing a threshold

Start with `SPAM_QUARANTINE_SCORE` unset. Every score is still visible in
Mail trace, so watch real traffic for a while before you file anything away
automatically. When you're ready:

- A **higher** threshold quarantines fewer messages — safer, but more spam
  reaches Inbox.
- A **lower** threshold quarantines more — less spam gets through, but a
  real message is more likely to be caught by mistake.

Pick a number you've actually seen separate spam from legitimate mail in
your own trace data, not a guess. `SPAM_QUARANTINE_SCORE` is a Worker-only
setting — see [Configuration reference](configuration.md#inbound-worker-limits)
for where it lives.

## What this is not

Quarantine is a filing choice inside cmail, not a replacement for the SPF,
DKIM, and DMARC boundary Cloudflare Email Routing already enforces before a
message reaches cmail at all, and not a bulk-unsubscribe or mailing-list
management tool. See [Email authentication and sender requirements](email-authentication.md)
for that boundary.

[← Documentation home](README.md)
