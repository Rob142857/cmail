-- Invitation-scoped email one-time-code (OTP) sign-in: a third sign-in
-- method, alongside Google and Microsoft, for people whose mail is hosted
-- by neither. It is manager-invited only, never self-serve.
--
-- Deliberate scope note on `users.auth_provider`
-- ------------------------------------------------
-- This migration widens `user_identities.provider` to accept 'email', but
-- intentionally does NOT widen `users.auth_provider`'s CHECK the same way.
-- `user_identities` is the authoritative identity record (see its own
-- comment below); `auth_provider` on `users` is only ever a denormalised
-- display cache that identity.ts/bootstrap.ts copy the provider into after
-- binding. Widening it would require rebuilding `users` itself, and `users`
-- is the parent of a foreign key from more than a dozen other tables here
-- (several declared ON DELETE CASCADE or ON DELETE SET NULL: user_identities,
-- sessions, enrollment_tokens, mailbox_assignments, messages.draft_owner_id,
-- mailbox_reservations.draft_owner_id, send_idempotency, personal_signatures,
-- push_subscriptions, push_device_preferences, organization_* tables, ...).
--
-- On Cloudflare D1 (verified empirically against this repo's pinned
-- wrangler/D1, 4.118.0, before writing this file), DROP TABLE on a table
-- that other tables reference with ON DELETE CASCADE/SET NULL fires those
-- actions immediately, exactly as if every row had been individually
-- DELETEd — and `PRAGMA foreign_keys=OFF` does not prevent this (D1
-- re-enforces foreign keys on every statement, so the pragma has no
-- observable effect across statements in the same migration file). A
-- create-copy-drop-rename rebuild of `users` would therefore silently wipe
-- every session, identity, invitation, mailbox assignment, and draft
-- ownership row in one migration. `user_identities` is not referenced by
-- any other table's foreign key (only `enrollment_tokens.bound_provider`
-- was suspected — it isn't a real column; identity.ts derives it with a
-- LEFT JOIN), so rebuilding it is safe and carries no such risk.
--
-- Email-OTP users therefore keep `auth_provider = ''`. The existing admin
-- UI already renders that combination (an enrolled identity whose provider
-- isn't 'google' or 'microsoft') as "Identity enrolled" without any change
-- (apps/web/src/routes/admin/users/+page.svelte, providerLabel()).

CREATE TABLE user_identities_new (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'email')),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, subject)
);

INSERT INTO user_identities_new (provider, subject, user_id, created_at)
SELECT provider, subject, user_id, created_at FROM user_identities;

DROP TABLE user_identities;

ALTER TABLE user_identities_new RENAME TO user_identities;

-- Geo-change auditing (see email-otp.ts / auth.otp.country_changed): the
-- country of a user's most recent successful sign-in, so a later sign-in
-- from a different country can be flagged. Nullable, no CHECK constraint of
-- its own, so this is a plain column add — not a rebuild.
ALTER TABLE users ADD COLUMN last_auth_country TEXT;

-- One-time codes for invitation-scoped email sign-in/enrollment. One active
-- code per (address, purpose): issuing a new one deletes prior rows for that
-- pair outright (see issueOtp in email-otp.ts), so — unlike enrollment_tokens
-- — no separate "still pending" partial index is needed here.
CREATE TABLE IF NOT EXISTS auth_otp_codes (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('enroll', 'signin')),
  address TEXT NOT NULL CHECK (address = lower(address) AND length(address) BETWEEN 3 AND 320),
  code_hash TEXT NOT NULL CHECK (length(code_hash) = 64),
  -- Opaque uuid bound into the signed proof cookie; verify requires both the
  -- cookie and this row to agree on it.
  request_id TEXT NOT NULL CHECK (length(request_id) = 36),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_epoch INTEGER NOT NULL CHECK (created_epoch > 0),
  expires_epoch INTEGER NOT NULL CHECK (expires_epoch > 0)
);
CREATE INDEX IF NOT EXISTS idx_auth_otp_codes_address_purpose
  ON auth_otp_codes(address, purpose);
