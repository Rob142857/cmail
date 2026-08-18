# Email signatures

cmail can add two signatures to your outgoing mail:

1. Your **personal signature**.
2. An optional **organisation signature** — a company-wide footer or disclaimer that a Manager controls.

If both are on, cmail puts your personal signature first, then the organisation signature. Both sit below your new text and above any quoted message history, in new messages, replies, and forwards. They also appear in the plain-text version of your message.

## Your signature

Go to **Mail > Settings > Email signature** to add or change your personal sign-off. Keep it short — it goes on every message you send.

The editor supports simple formatting: bold/italic, lists, tables, inline styling, images, and links (`https`, `http`, or `mailto`). If you paste from a webpage or Word, cmail keeps the formatting but strips anything unsafe, such as scripts or hidden styling.

Clearing your signature removes only your personal layer — it does not turn off the organisation signature. If the page says **Admin managed**, a Manager has locked your signature. You can preview it but not change it; ask that Manager to update it. You can preview both layers on the settings page, but the final version is assembled when you actually send the message.

## For Managers

Go to **Management > Email signatures**.

- Set the **organisation signature** for an approved footer, branding, contact details, or legal notice. Turn on **Append to outgoing mail** to use it. Turning it off keeps the saved text but stops adding it to mail.
- Under **Personal signatures**, pick a person to edit and save their personal layer. Select **Lock personal signature** to lock in that exact version and take control of it — the person can no longer edit it. Clear the lock to hand control back.
- Saving a personal signature replaces only that person's layer. It never touches the organisation signature.

Treat signature text as public-facing content: use an approved template, include only necessary contact details, and review locked signatures whenever someone changes role, name, or contact details. Signature changes and locks are recorded in the Audit log.

## Safety and limits

cmail cleans signature HTML twice — once when you save it, and again before it's used — removing scripts, forms, frames, unsafe links, external style loads, and other unsupported markup.

Images are allowed from `https` links, files attached to the message, or embedded image data. Links with a username or password built into the URL are blocked. Every image loads lazily with no referrer sent, so it can't be used as a tracking pixel.

Don't rely on signatures for secrets, tracking, legal compliance in every jurisdiction, or content that changes per recipient. Signature HTML is limited to 64 KB, and its plain-text version to 16,384 characters.

The organisation signature always sits below the personal one, and you can't reorder this in the composer. This keeps a stable company footer while still letting you keep your own sign-off, unless it's locked.
