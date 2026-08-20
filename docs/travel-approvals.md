# Travel approvals

Travel approvals lets an organisation restrict sign-in to specific countries — across every sign-in method, Google, Microsoft, and email sign-in code alike — and gives managers a way to let someone through anyway when they're legitimately travelling.

## What it does

A manager chooses the organisation's approved sign-in countries in **Admin → Settings → Sign-in security**, using a searchable picker built from the full ISO 3166-1 country list. **Off by default**: with no countries chosen, sign-in is allowed from anywhere, exactly as before this feature existed.

Once at least one country is chosen, every sign-in is checked *after* the person's identity is confirmed — the OAuth provider (or the email code) has already proven who they are — but *before* a session is created. A sign-in from a country not on the list is refused. The person sees a plain explanation that their managers have been notified and to try again once approved. Nothing about the check is hidden from them, because at this point they've already proven who they are; there's nothing left to protect by staying vague.

A refused attempt creates a pending request for that person and country, and every active manager is emailed with a link to **Management → Travel approvals**. From there a manager can:

- **Approve** the request for 24 hours, 7 days, or 30 days — this grants a temporary exception, and the person can sign in normally from that country until it expires.
- **Deny** the request — the person stays blocked from that country. They aren't notified of a denial; silence is the deny.
- **Revoke** an active exception early.

The panel also shows the last 20 decisions and every currently active exception, each with who approved or denied it and when.

## Bootstrap is exempt

The very first manager, created through the [bootstrap flow](configuration.md#bootstrap), is exempt from this gate. A fresh deployment has no approved countries configured yet regardless (the feature defaults off), but even once an operator turns it on, bootstrap must still work from wherever the operator happens to be — a deployment can never be allowed to lock itself out of creating its first manager.

## Notification throttle

Repeated sign-in attempts from the same disallowed country don't repeatedly email every manager. A manager notification for one (person, country) pair is sent at most once every six hours; further refusals in that window still create/update the pending request and are still fully audited, they just don't send another email. A separate, global cap (20 manager notifications per hour, shared across every notification kind) protects against a burst of unrelated triggers turning into a mail flood — when it's hit, the notification is dropped, never queued, and the refusal is still audited.

## Audit events

Every decision and refusal is recorded in the audit log (**Management → Audit log**):

| Event | When |
|---|---|
| `auth.sign_in_denied` | A sign-in was refused for being outside the approved countries (detail includes `country_blocked`) |
| `user.travel_approved` | A manager approved a request, granting a temporary exception |
| `user.travel_denied` | A manager denied a request |
| `user.travel_exception_revoked` | A manager revoked an active exception before it expired |

## Relationship to the old email-code-only setting

Earlier builds of email one-time-code sign-in had their own, OTP-only environment variable for a country allowlist. That variable is gone — sign-in geography is now one setting, in the product, that applies to every sign-in method. If you previously set that variable, reconfigure the same countries in **Admin → Settings** instead.

[← Documentation home](README.md)
