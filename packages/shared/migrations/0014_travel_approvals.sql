-- Travel approvals: organisation-approved sign-in countries, enforced after
-- authentication on every sign-in method (Google, Microsoft, and email
-- one-time code). See apps/web/src/lib/server/travel.ts for the gate and
-- apps/web/src/routes/admin/travel for the manager-facing panel.

-- One row per (user, country) sign-in attempt that was refused because the
-- country wasn't on the organisation's approved list. A user can accumulate
-- several *denied* rows for the same country over time, so a table-wide
-- UNIQUE(user_id, country, status) would be wrong — it would collide the
-- moment a second denial landed. Only one row may ever be *pending* for a
-- given (user, country) pair at once, so that's enforced with a partial
-- unique index instead, mirroring 0003's
-- idx_outbound_send_journal_active_idempotency. travel.ts's
-- recordTravelRequest() upserts against it with
-- `ON CONFLICT (user_id, country) WHERE status = 'pending' DO NOTHING`.
CREATE TABLE IF NOT EXISTS signin_country_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country TEXT NOT NULL CHECK (length(country) = 2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_epoch INTEGER NOT NULL CHECK (created_epoch > 0),
  -- Set together when a manager decides the request; both stay NULL while pending.
  decided_by TEXT REFERENCES users(id),
  decided_epoch INTEGER CHECK (decided_epoch IS NULL OR decided_epoch > 0),
  -- Throttles manager-notification email for this (user, country): only
  -- refreshed when a notification is actually sent (see recordTravelRequest).
  last_notified_epoch INTEGER CHECK (last_notified_epoch IS NULL OR last_notified_epoch > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signin_country_requests_pending
  ON signin_country_requests(user_id, country)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_signin_country_requests_status
  ON signin_country_requests(status, created_epoch DESC);

-- A manager-granted temporary exception letting one user sign in from one
-- extra country until it expires. Multiple exceptions can coexist for the
-- same user (different countries, or a renewed one issued before an older
-- one for the same country has expired) — deliberately no uniqueness
-- constraint here, unlike the requests table above.
CREATE TABLE IF NOT EXISTS signin_country_exceptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country TEXT NOT NULL CHECK (length(country) = 2),
  approved_by TEXT NOT NULL REFERENCES users(id),
  created_epoch INTEGER NOT NULL CHECK (created_epoch > 0),
  expires_epoch INTEGER NOT NULL CHECK (expires_epoch > 0)
);
CREATE INDEX IF NOT EXISTS idx_signin_country_exceptions_lookup
  ON signin_country_exceptions(user_id, country, expires_epoch);
