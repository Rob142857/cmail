# Email signatures

cmail can apply two independently managed signature layers to outgoing mail:

1. a **personal signature** for the signed-in sender; and
2. an optional **organisation signature** or disclaimer managed by a Manager.

When both are present, cmail places the personal signature first, then the
organisation signature. Both appear below the newly authored text and above
quoted conversation history in new messages, replies, and forwards. They are
also included in the generated plain-text alternative.

## For people sending mail

Open **Mail > Settings > Email signature** to create or change your personal
sign-off. Keep it short: it is added to every message you send. The editor
supports a limited, email-safe subset of rich text: emphasis, lists, and
`https`, `http`, or `mailto` links. Pasted content is plain text, so copied web
tracking markup and hidden styling are not carried into your signature.

An empty personal signature removes only your personal layer. It does not
disable an organisation signature. If the page says **Admin managed**, a
Manager has set and locked the personal signature; contact that Manager for a
change. You can preview the personal and organisation layers on the settings
page, but the final signature is applied by the server when the message is
sent.

## For Managers

Open **Management > Email signatures**.

- Set the **Organisation signature** for an approved footer, branding detail,
  contact information, or a legal notice. Use **Append to outgoing mail** to
  enable it. Turning it off retains the saved content but stops appending it.
- In **Personal signatures**, select a person, edit their personal layer, and
  save it. Selecting **Lock personal signature** makes that exact personal
  layer Manager-controlled; clear the lock to return control to the person.
- Saving a personal signature replaces that person's existing personal layer.
  It never replaces the organisation layer.

Treat signature text as published organisational content. Use an approved
template, include only necessary contact information, and review locked
signatures during role, name, or contact-detail changes. Signature updates and
lock changes are recorded in the Audit log.

## Safety and limits

cmail sanitises signature HTML before storing it and sanitises again before it
is used. Active content, images (including remote tracking pixels), forms,
frames, unsafe URL schemes, external style loads, and unsupported markup are removed. Do not rely on signatures for
secrets, tracking pixels, legal compliance in every jurisdiction, or dynamic
per-recipient content. Signature HTML is limited to 64 KB and its plain-text
alternative to 16,384 characters.

The organisation signature is intentionally applied beneath the personal one
and cannot be changed in the composer. This gives Managers a stable final
footer without preventing an unlocked sender from maintaining their own
professional sign-off.
