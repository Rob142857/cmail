# How sending works

This page follows one message from the compose page to the recipient. It is for
developers and operators who need to know what cmail checks, what it stores,
and what each error means. For the security model behind it, see
[Architecture and trust boundaries](architecture.md#outbound-mail). For the
settings named here, see the [Configuration reference](configuration.md).

## The pieces

| Piece | Where | Job |
|---|---|---|
| Compose page | `apps/web/src/routes/mail/compose/` | Saves drafts, sends, handles "Unblock and send again" |
| Provider layer | `apps/web/src/lib/server/outbound.ts` | Picks a provider, checks size limits, submits |
| Outbound journal | `apps/web/src/lib/server/outbound-journal.ts` | Makes a send safe to retry and recover |
| Email Worker | `apps/email-worker/src/index.ts` | Holds the `send_email` binding and talks to Cloudflare Email Sending |
| D1 | `DB` binding | Drafts, messages, journal, trace, rate limits, quota reservations |
| R2 | `STORAGE` binding | Message bodies, attachments, staged send payloads |

## Saving a draft

The compose page saves through its `?/save` action.

- **Idempotent create.** A new draft takes its ID from a token the browser
  generates, so a retried save never makes two drafts.
- **Version check.** Each draft has a `draft_version` number. A save must send
  the version it started from, and the save bumps it. If another tab saved
  first, the save fails with a conflict and the page offers to reload and
  compare. This stops two tabs from overwriting each other.
- **Storage.** The body goes to R2; the row goes to `messages` with
  `folder='drafts'`. Before writing, cmail reserves the extra bytes against the
  mailbox quota (`mailbox_reservations`, enforced by a D1 trigger). A full
  mailbox returns "Mailbox storage or draft limit reached".
- **Limits.** Subject 500 characters, body 1 MiB, at most 200 addresses per
  field (addresses are checked properly at send time, not on save).
  `DRAFT_SAVE_RATE_PER_HOUR` (default 300) and `MAX_DRAFTS_PER_MAILBOX_USER`
  (default 100) cap draft activity.

## Sending, step by step

The `?/send` action runs these steps in order. Any failure stops the send
before anything leaves cmail, unless the step says otherwise.

1. **Size checks.** The whole request must be under 24 MiB and the body under
   1 MiB. Quoted HTML from a reply is cleaned and capped (512 KiB, 10,000
   elements, nesting depth 128).
2. **Recipients.** To, Cc and Bcc are parsed and de-duplicated (an address in
   To is dropped from Cc and Bcc). The total must be within
   `MAX_RECIPIENTS_PER_MESSAGE` (default 50, maximum 100).
3. **Idempotency.** Every send carries a compose token, and a draft send also
   carries its `draft_version`. Together they form an idempotency key. If a
   send with that key already exists, cmail resumes or reports it instead of
   sending again.
4. **Permission.** The user needs **Send as** or **Full access** on the
   sending mailbox. See [Shared mailboxes](shared-mailboxes.md).
5. **Attachments.** Up to 25 files and 20 MiB in total. Executable and script
   types (for example `.exe`, `.js`, `.ps1`) are refused. File names are
   cleaned.
6. **Internal or external.** Recipients who have a mailbox in this cmail
   instance get a local copy straight into their Inbox, with their inbox rules
   applied. Everyone else goes to the mail provider.
7. **Body.** HTML is the authored text, then the signature, then any quoted
   message, wrapped in the organisation's default font. A plain-text part is
   built alongside it. See [Email signatures](signatures.md).
8. **Headers.** The Message-ID is `<uuid@MAIL_DOMAIN>`. Replies get
   `In-Reply-To` and `References` so threads stay together. Bcc is never
   written as a header; it travels only in the envelope.
9. **Provider preflight.** cmail estimates the final message size before it
   submits. Cloudflare Email Sending accepts up to 5 MiB per message and 32
   attachments, and cmail keeps 256 KiB spare for headers, so the practical
   limit is about 4.75 MiB after encoding. Attachments grow by about a third
   when encoded, so roughly 3.5 MiB of attachments is the real ceiling on
   Cloudflare. Postmark allows 10 MiB in total.
10. **Rate limits.** Two hourly limits per user: `OUTBOUND_RATE_LIMIT_PER_HOUR`
    (messages, default 60) and `OUTBOUND_WORK_LIMIT_PER_HOUR` (work units,
    default 600, where a message costs the largest of its recipients, stored
    objects and MiB). Over the limit, the user is told how many minutes to
    wait.
11. **Quota.** cmail reserves space for the Sent copy and every internal copy.
    If any mailbox is full, nothing is sent.
12. **Stage.** The body and attachments are written to R2 under
    `outbound-journal/<id>/` with SHA-256 checksums, and the send is recorded
    in D1 (`outbound_send_journal`, `outbound_send_targets`,
    `outbound_send_attachments`). D1 triggers stop the staged payload from
    changing.
13. **Dispatch.** The journal moves to `dispatching` and cmail calls the
    provider. The provider's answer is saved to R2 before cmail acts on it, so
    a crash at this point can be reconciled later.
14. **Trace.** A `mail_trace` row records the provider's message IDs, the
    envelope, the status and any failed recipients. This row is what later
    delivery events are matched against, so cmail retries the write once if it
    fails.
15. **Materialise.** cmail writes the Sent copy and the internal Inbox copies,
    merges any bounce that arrived in the meantime, deletes the draft and
    cleans up the staging area. The user lands on the Sent folder.

## How the message leaves Cloudflare

`OUTBOUND_PROVIDER` chooses the route: `cloudflare`, `postmark`, `auto` or
`none`. An explicit choice never falls back to another provider.

- **Native Cloudflare (recommended).** The Pages app calls the email Worker
  over the private `EMAIL_SERVICE` service binding. The Worker checks the
  request (size, recipients, allowed headers) and calls
  `env.EMAIL.send()` through its `[[send_email]]` binding. No API token is
  needed. Cloudflare returns a tracking ID, not the RFC Message-ID.
- **Cloudflare REST API.** Used when there is no service binding but
  `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_API_TOKEN` are set. cmail
  builds raw MIME itself. This route can split the envelope, so internal and
  external recipients see the same To and Cc lines while only external ones
  go to Cloudflare.
- **Postmark.** Needs `POSTMARK_API_KEY`. cmail sets its own Message-ID.
  Postmark can't split the envelope for mixed internal and external sends.
  Delivery events and blocked-address handling are not available on Postmark.

Setting up the sending domain is covered in
[Deployment, step 6](deployment.md#6-configure-outbound-delivery) and
[Email authentication](email-authentication.md).

## The journal states

| State | Meaning | What happens next |
|---|---|---|
| `pending` | Staged, not yet sent | Dispatch |
| `dispatching` | Provider call in progress | Becomes one of the states below |
| `accepted` | Provider took it | Copies are written, then `materialized` |
| `materialized` | Done | Final. The key can't be reused, so it can't send twice |
| `ambiguous` | Unknown: timeout, 5xx or unreadable reply | Never retried automatically. Shown in **Admin > Mail trace** |
| `retryable_failure` | Provider refused, safe to try again | Draft kept |
| `permanent_failure` | Every recipient refused | Draft kept |
| `cancelled` | Stopped before dispatch | Staging cleaned up |

## What the user sees when it fails

| Message | Cause |
|---|---|
| "Delivery status is unknown. Don't resend…" | `ambiguous`: the provider may or may not have sent it |
| "The provider didn't accept this message. Your draft was kept" | `retryable_failure` |
| List of addresses that can't receive mail | `permanent_failure`, or blocked recipients (see [Delivery and bounces](delivery-and-bounces.md#blocked-addresses)) |
| "…Sent copy is still recovering. Retry this draft — cmail won't send it again." | The provider accepted it but writing the Sent copy failed. Retrying only finishes the copy |
| "Cloudflare Email Service has a 5 MiB message limit" | Preflight size check |
| "External email delivery is not configured" | No provider is set up |
| A wait time in minutes | Rate limit |

## Tests

Sending is covered by `outbound.test.ts`, `outbound.errors.test.ts`, the
`outbound-journal*.test.ts` files, `recipient-delivery.test.ts`,
`send-idempotency.test.ts`, `rate-limit.test.ts`, `compose-limits.test.ts` and
`compose-body.test.ts` in `apps/web/src/lib/server/`, plus
`routes/mail/compose/send-recipients.test.ts`, the email Worker's
`index.test.ts`, and the Playwright test `e2e/mobile/compose.spec.ts`.
