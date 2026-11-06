-- More of each Email Sending event, for the delivery timeline in Admin > Mail
-- trace and the delivery status on a Sent message. All columns are optional:
-- rows stored before this migration simply leave them empty.
--   delivery_time_ms       time from send to the event, as the provider reports it
--   provider               the receiving mail provider, as the provider names it
--   bounce_classification  the provider's bounce class (for example a permanent failure)
--   reason                 the bounce, failure or rejection reason in words
--   rejection_party        who rejected the message, for rejected events
ALTER TABLE delivery_events ADD COLUMN delivery_time_ms INTEGER
  CHECK (delivery_time_ms IS NULL OR delivery_time_ms >= 0);
ALTER TABLE delivery_events ADD COLUMN provider TEXT
  CHECK (provider IS NULL OR length(provider) <= 64);
ALTER TABLE delivery_events ADD COLUMN bounce_classification TEXT
  CHECK (bounce_classification IS NULL OR length(bounce_classification) <= 64);
ALTER TABLE delivery_events ADD COLUMN reason TEXT
  CHECK (reason IS NULL OR length(reason) <= 500);
ALTER TABLE delivery_events ADD COLUMN rejection_party TEXT
  CHECK (rejection_party IS NULL OR length(rejection_party) <= 32);
