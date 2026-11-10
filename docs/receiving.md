# How receiving works

This page follows one message from Cloudflare Email Routing to a user's
Inbox. Everything here runs in the email Worker's `email()` handler in
`apps/email-worker/src/index.ts`. For the trust model, see
[Architecture: inbound mail](architecture.md#inbound-mail). For the limits named
here, see [Configuration: inbound Worker limits](configuration.md#inbound-worker-limits).

## Rejecting versus failing

A message can end in one of three ways:

- **Accepted.** It is stored and shown.
- **Rejected.** The Worker calls `setReject()`. The sender's server gets a
  permanent error with a short, neutral reason. Nothing is stored except,
  for most rejects, a `mail_trace` row.
- **Failed.** Storage threw an error. Email Routing retries the message later,
  and cmail's de-duplication makes the retry safe.

## Step by step

1. **Envelope check.** The envelope addresses are lower-cased and checked
   (address up to 320 characters, local part 64, domain 255).
2. **Size.** `rawSize` is checked before the message is read.
   `MAX_INBOUND_BYTES` defaults to 10 MiB, with a hard cap of 25 MiB.
3. **Mailbox.** The envelope recipient must exactly match an active row in
   `mailboxes` (personal or shared). There are no aliases, no plus-addressing
   (`name+tag@`) and no catch-all mailbox in cmail itself: Email Routing
   decides which addresses reach the Worker, and cmail rejects any address
   without a mailbox, using wording that doesn't reveal whether it exists.
4. **De-duplication.** The message ID inside cmail is a SHA-256 of the mailbox
   and the `Message-ID` header, and a unique index stops a second copy. A
   repeat delivery returns quietly.
5. **Guardrails.** One D1 insert into `mailbox_reservations` reserves space,
   and a trigger checks every limit in the same transaction:
   - messages per mailbox per hour (`INBOUND_MAILBOX_MESSAGES_PER_HOUR`, default 120);
   - bytes per mailbox per hour (`INBOUND_MAILBOX_BYTES_PER_HOUR`, default 100 MiB);
   - messages per sender per hour (`INBOUND_SENDER_MESSAGES_PER_HOUR`, default 30). The sender is stored only as an HMAC, keyed by `INBOUND_SENDER_HASH_KEY`;
   - the mailbox quota (`MAILBOX_STORAGE_QUOTA_BYTES`, default 1 GiB).

   Setting a limit to exactly `0` turns it off. If D1 can't be reached, the
   message is rejected; this check fails closed.
6. **Parse.** MIME is parsed with `postal-mime`. A message that can't be
   parsed is rejected.
7. **Clean the body.** HTML is sanitised before it is stored (see
   [Reading mail safely](reading-mail-safely.md)). Plain text is escaped. Limits:
   `MAX_INBOUND_DECODED_BODY_BYTES` (512 KiB default, 2 MiB hard), 10,000
   elements, nesting depth 128.
8. **Sender authentication.** cmail reads the first `Authentication-Results`
   header and records the SPF, DKIM, DMARC and ARC results, but only when the
   header's authserv-id matches `INBOUND_AUTHSERV_ID` (so a sender can't forge
   them). These results are shown to users and used for calendar updates. They
   are not used to decide spam.
9. **Attachments.** At most `MAX_ATTACHMENTS_PER_MESSAGE` (default 25, hard
   cap 50) and 15 MiB in total. Executable and script types (`.exe`, `.bat`,
   `.cmd`, `.scr`, `.js`, `.vbs`, `.ps1`, `.msi` and others) are rejected.
10. **Addresses.** To, Cc and Reply-To together may hold at most 100
    addresses. If To is empty (the user was Bcc'd), the envelope recipient is
    used.
11. **Threading.** The thread ID is the first `References` entry, else
    `In-Reply-To`, else the message's own ID. Long reference chains are
    trimmed to the root and the newest 50.
12. **Spam or Inbox.** See [Spam and quarantine](spam-and-quarantine.md). In order:
    - a **block** sender rule sends the message to Spam;
    - an **allow** rule sends it to the Inbox;
    - otherwise Cloudflare's spam score (`X-CF-SpamH-Score`) is compared with
      `SPAM_QUARANTINE_SCORE`. With no threshold set, nothing is quarantined.

    An address rule beats a domain rule, and block beats allow.
13. **First contact.** If this mailbox has never exchanged mail with the
    sender, the message is flagged so the reading view can warn about it.
14. **Inbox rules.** For mail going to the Inbox only. See
    [Inbox rules: how they run](inbox-rules.md#how-rules-run).
15. **Store.** The body and attachments go to R2 under random UUID keys.
    Metadata goes to D1 (`messages`, `attachments`) in one transaction. If any
    write fails, the new R2 objects are deleted and the error is thrown, so
    Email Routing retries.
16. **Trace.** A `mail_trace` row records the result: delivered, or
    quarantined with the reason.
17. **Afterwards.** In the background: a push notification (unless a rule
    moved the message or marked it read), the contact list update, and any
    calendar invitation. Calendar updates are applied only when DMARC passed
    and the organiser matches the From address. See [Calendar](calendar.md).
    These never block delivery.

## Data

| Store | What |
|---|---|
| D1 `messages` | One row per message per mailbox: headers, folder, spam score, quarantine reason, thread |
| D1 `attachments` | Name, type, size, inline or attached, R2 key |
| D1 `mailbox_reservations` | Quota and rate charges; pending charges expire after 15 minutes |
| D1 `mail_trace` | Delivered, quarantined or rejected |
| R2 `messages/…` | Sanitised body |
| R2 `attachments/…` | Attachment bytes |

Storage used is the raw size of each message, counted across all folders.

## Scheduled jobs in the email Worker

| Cron | Job |
|---|---|
| `17 3 * * *` | Retention clean-up (old trace rows, sessions, rate-limit buckets and similar). Does nothing unless `RETENTION_JOBS_ENABLED="true"` |
| `7 * * * *` | Refreshes the link blocklist (see [Reading mail safely](reading-mail-safely.md#link-checks)) |

## Tests

`apps/email-worker/src/index.test.ts` covers the limits, rejects,
de-duplication, sender authentication and sender rules.
`inbound-guard.sql.node.test.ts` runs the quota trigger against the real
migrations. Also see `inbound-risk.test.ts`, `calendar.test.ts`,
`authentication-results.test.ts` and `postal-mime-upgrade.test.ts`.
