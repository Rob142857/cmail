-- Server-authoritative per-user/device push opt-outs. A browser capability can
-- rotate its endpoint, so endpoint-only deletion cannot express a durable
-- opt-out. The device ID is a random browser-local pseudonymous identifier;
-- it is never exposed or logged by cmail.
ALTER TABLE push_subscriptions ADD COLUMN device_id TEXT
  CHECK (device_id IS NULL OR length(device_id) = 36);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_device
  ON push_subscriptions(user_id, device_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS push_device_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL CHECK (length(device_id) = 36),
  disabled_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, device_id)
);
