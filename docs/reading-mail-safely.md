# Reading mail safely

Email is untrusted input. This page explains how cmail shows a message without
running the sender's code, tracking the reader, or leading them to a known-bad
site. For the wider threat model, see
[Architecture and trust boundaries](architecture.md#trust-boundaries).

## Cleaning HTML

`packages/shared/src/sanitize-email.ts` cleans HTML twice: once when the
message arrives, before it is stored, and again when it is shown.

- It uses `rehype-sanitize` with an allow-list of tags. Scripts, styles,
  frames, forms, SVG, MathML and objects are removed.
- Inline `style` is kept only for an allow-list of properties, and any value
  containing `url(`, `expression(`, `@import` or `behavior:` is dropped.
- Links may only be `http`, `https` or `mailto`. Every link opens in a new tab
  with `rel="noopener noreferrer nofollow"`.
- Images may only be `https`, `cid:` (inline attachments) or `data:` images
  (GIF, JPEG, PNG, WebP). They load lazily and never send a referrer.

## The message frame

The cleaned HTML is shown in a sandboxed `<iframe srcdoc>`
(`apps/web/src/lib/mail/EmailHtmlFrame.svelte`):

- **Scripts never run.** The sandbox never includes `allow-scripts`.
- **A strict CSP.** The frame has its own Content Security Policy. It blocks
  scripts, network connections, forms, plugins and nested frames.
- **The page around it** has its own CSP, refuses to be framed
  (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), and never sends a
  referrer.

## Images

- **Remote images are blocked** by default, because a sender can use them to
  see when and where a message was opened. The message shows "Images blocked
  to stop the sender tracking you" and a **Load images** button. The choice
  resets for each message.
- **Inline images** (`cid:`) are served by cmail from the attachment
  (`/api/attachment/<id>?inline=1`). Only image types marked inline are
  served, and the response has its own sandbox CSP and is never cached.

## Link checks

Every web link in a message goes through cmail's `/link` page before it
opens.

### Before the click

When a message is shown, each `http` or `https` link is rewritten to
`/link?u=<address>&s=<signature>`. The signature is an HMAC tied to the reader,
keyed from `SESSION_SECRET`, and valid for 7 to 14 days. A `/link` address therefore
only works for the person who received it, and cmail can't be used as an open
redirect.

Links that look deceptive are flagged and get no signature
(`packages/shared/src/link-risk.ts`):

- **Look-alike domains:** the host uses punycode, which can disguise one letter
  as another.
- **Mismatched text:** the link text shows one domain but the link goes to
  another.

These links get a wavy underline and a warning sign, and a banner at the top of
the message lists them.

### On click

The `/link` page (`apps/web/src/routes/link/`) checks the host against a local
copy of a public list of known phishing and scam domains, the
[CERT Polska Warning List](https://cert.pl/en/warning-list/).

| Result | What the user sees |
|---|---|
| Host is on the list | A warning, always: "This site is on a known-bad list" |
| Look-alike or mismatched link | A warning explaining the risk |
| Signed link, not on the list | Straight to the site |
| Signed link, list unavailable or older than 2 days | Straight to the site. The check fails open, so mail keeps working |
| Unsigned or unreadable link | A page asking the user to check the address first |

The warning page shows the full address, the host, and a note if it is plain
`http`. The user can go back to their mail or continue anyway.

### Privacy

No request leaves cmail when a link is clicked: the check is entirely local.
The `/link` response is never cached and sends only the origin as referrer.
Logs record the decision, and the host only when it was on the list.

### Keeping the list current

The email Worker downloads the list every hour (cron `7 * * * *`,
`apps/email-worker/src/link-blocklist-refresh.ts`). It stores it in R2 under
`link-blocklist/v1/` as 256 shards plus a `meta.json` file, which is written
last, so a reader never sees half an update. These safety checks guard the
refresh:

- 20-second timeout;
- 25 MiB maximum;
- at least 1,000 entries;
- a download less than half the size of the last one is ignored until it has
  been seen 3 times.

There is no switch to turn link checks off. They run whenever the `STORAGE`
binding and `SESSION_SECRET` exist. Rotating `SESSION_SECRET` makes links in
already-open messages ask the user to check them once. See
[Running cmail: rotate secrets](operations.md#rotate-secrets).

## Tests

`apps/web/src/lib/server/sanitize-email.test.ts`, `inline-images.test.ts`,
`link-check.test.ts`, `link-blocklist.test.ts`, `link-risk.test.ts`,
`apps/web/src/lib/mail/email-html-frame.test.ts`,
`apps/web/src/routes/link/link-route.test.ts` and
`apps/email-worker/src/link-blocklist-refresh.test.ts`.
