# Delivery status and bounces

After a message leaves cmail, Cloudflare reports what happened to it:
delivered, delayed, bounced, rejected or marked as spam. This page explains how
cmail receives those reports, what users see, and how blocked addresses work.
How the message got to Cloudflare is covered in [How sending works](sending.md).

Delivery status needs native Cloudflare Email Sending. Postmark sends get no
delivery events and no blocked-address checks.

## Where delivery events come from

cmail does not read bounce emails. It uses Cloudflare Email Sending **event
subscriptions**:

1. Cloudflare publishes an event for each recipient to a Cloudflare Queue.
2. The email Worker consumes the queue in its `queue()` handler
   (`apps/email-worker/src/delivery-events.ts`).
3. Each event is parsed. Only `email.sending` events of type `delivered`,
   `deferred`, `bounced`, `failed`, `rejected` or `complained` are used. cmail
   keeps the SMTP status and reply, the bounce type (hard or soft), the reason
   and who rejected it.
4. The event is matched to the `mail_trace` row of the send by the provider's
   message ID, looking back 30 days.
5. The event is stored in `delivery_events`. The event ID is the primary key,
   so a repeated event does nothing.
6. If the event is a final failure (bounced, failed or rejected), the
   recipient is added to `failed_recipients` on the trace row and on each Sent
   copy, and an **Undeliverable** notice is created (see below).

Setup is in [Deployment: bounce and complaint feedback](deployment.md#bounce-and-complaint-feedback-optional).
The queue consumer is commented out in `apps/email-worker/wrangler.toml.example`
(queue `cmail-email-events`, `max_retries = 5`, optional dead-letter queue);
turn it on there.

### Timing and retries

An event can arrive before cmail has written the Sent copy. When an event
can't be matched yet, the Worker asks the queue to retry it, up to 3 times, a
minute apart, and then drops it. Other errors back off from 30 seconds up to 5
minutes. If the Sent copy is written after the event arrived, cmail merges the
failure in at that point, so a fast bounce still shows on the Sent copy.

## What users see

| Where | What |
|---|---|
| **Sent list** | A small tag on each message: **Delivered**, **Delayed**, **Bounced** or **Spam report**. Hovering shows counts, such as "Delivered to 1 of 3". A delay never hides a final result. |
| **Opened Sent message** | A status line, such as "Delivered", "Delivery delayed, retrying", "Not delivered to 1 of 3" or "…, marked as spam by 1", with each recipient's state and time under Details. |
| **Inbox** | An **Undeliverable** notice for each final failure. |
| **Admin > Mail trace** | The full timeline of each send: Delivered, Delayed, will retry, Bounced, Failed, Rejected before sending, or Marked as spam by the recipient, with the time between steps. |

The Sent tags come from `apps/web/src/lib/server/delivery-badges.ts`, which
loads all events for the visible page in one query, and
`apps/web/src/lib/mail/delivery-status.ts`, which picks the latest state per
recipient.

## The Undeliverable notice

`apps/email-worker/src/bounce-notice.ts` writes the notice straight into the
sender's Inbox, like Outlook's non-delivery reports:

- From "Mail Delivery System", subject `Undeliverable: <original subject>`,
  marked high importance, in the same thread as the Sent copy.
- The text explains **what went wrong, who needs to fix it and how**, in plain
  words. The advice is based on the SMTP enhanced status code (RFC 3463) and
  the receiving server's reply. The technical details (code, reply, servers)
  follow underneath for IT staff.
- One notice per event per mailbox, up to 5 mailboxes holding a Sent copy. The
  notice ID is derived from the event ID, so retries never make a second
  notice, and a notice the user deleted never comes back.
- A new-mail push notification is sent if notifications are on.

## Blocked addresses

When an address hard-bounces or someone marks your mail as spam, Cloudflare
adds the address to a **suppression list** and refuses later sends to it. cmail
handles this in `apps/web/src/lib/server/suppressions.ts`.

### How a block is detected

The email Worker gets error `E_RECIPIENT_SUPPRESSED` back from Cloudflare.
cmail cancels the send, keeps the draft, and shows which addresses are blocked
and why. With a suppressions API token it asks Cloudflare for the details of up
to 10 addresses. Without one it uses its own delivery events instead.

### "Send again" and "Unblock and send again"

- **Send again** sends the same draft through the normal path. This is for
  when the block was temporary, or after a recipient was removed.
- **Unblock and send again** removes the block at Cloudflare, then sends. It
  appears only when every block on those addresses is a bounce (hard or soft)
  that this sending domain can lift.

Unblocking needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_SUPPRESSIONS_API_TOKEN`,
**Send as** or **Full access** on the mailbox, and a refused send to that
address from this mailbox in the last day. It is limited to 10 addresses an hour per user
and recorded in the audit log as `email.suppression_lifted`.

cmail **never** lifts:

- spam complaints;
- manual and policy blocks;
- blocks Cloudflare marks read-only;
- account-wide blocks.

A refused unblock says so in plain words.

## Data

| Table | Holds |
|---|---|
| `mail_trace` | One row per send: provider message IDs, envelope, status, failed recipients |
| `delivery_events` | One row per Cloudflare event, linked to `mail_trace` (deleted with it by retention) |
| `messages` | `provider_message_ids` and `failed_recipients` on the Sent copy |

Migrations: `0019_delivery_events.sql` and `0020_delivery_event_details.sql` in
`packages/shared/migrations/`.

## Settings

`OUTBOUND_PROVIDER`, `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_SUPPRESSIONS_API_TOKEN`, and the queue consumer in the email Worker's
Wrangler file. See the [Configuration reference](configuration.md#outbound-delivery).

## Tests

`apps/email-worker/src/delivery-events.sql.node.test.ts` and
`bounce-notice.sql.node.test.ts` run against the real migrations.
`apps/web/src/lib/mail/delivery-status.test.ts`,
`apps/web/src/lib/server/delivery-badges.test.ts`, `suppressions.test.ts` and
`outbound-journal.delivery-events.test.ts` cover the web side.
