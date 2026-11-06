-- Outbound delivery events from Cloudflare Email Sending, received through a
-- Queues event subscription on each sending domain. The email Worker's queue()
-- consumer stores one row per provider event that matches mail cmail sent
-- (by the provider tracking ID in mail_trace.provider_message_ids). The
-- provider's eventId is the key, so a redelivered queue message is a no-op.
-- Rows are deleted with their mail_trace row when trace retention runs.
CREATE TABLE IF NOT EXISTS delivery_events (
  event_id TEXT PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 128),
  trace_id TEXT NOT NULL REFERENCES mail_trace(trace_id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL CHECK (length(provider_message_id) BETWEEN 1 AND 998),
  recipient TEXT NOT NULL CHECK (length(recipient) BETWEEN 3 AND 320),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained')
  ),
  terminal INTEGER NOT NULL DEFAULT 0 CHECK (terminal IN (0, 1)),
  bounce_type TEXT CHECK (bounce_type IS NULL OR bounce_type IN ('hard', 'soft')),
  smtp_status TEXT CHECK (smtp_status IS NULL OR length(smtp_status) <= 32),
  smtp_response TEXT CHECK (smtp_response IS NULL OR length(smtp_response) <= 500),
  event_timestamp TEXT CHECK (event_timestamp IS NULL OR length(event_timestamp) <= 40),
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_delivery_events_trace
  ON delivery_events(trace_id, received_at);
-- Sent copies written after an event arrived look up its failures by ID.
CREATE INDEX IF NOT EXISTS idx_delivery_events_provider
  ON delivery_events(provider_message_id);

-- The consumer matches an event to recent outbound traces, then to the
-- sender's recent outbound messages. Cloudflare sends have no stored
-- Message-ID, so both lookups go by time and provider tracking ID.
CREATE INDEX IF NOT EXISTS idx_trace_outbound_timestamp
  ON mail_trace(timestamp)
  WHERE direction = 'outbound';
CREATE INDEX IF NOT EXISTS idx_messages_outbound_mailbox_time
  ON messages(mailbox_id, received_at)
  WHERE direction = 'outbound';
