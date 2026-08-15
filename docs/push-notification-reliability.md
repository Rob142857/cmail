# Push notification reliability blueprint

> Design blueprint only — this is not implemented in cmail today.

## Current boundary

cmail currently stores inbound mail first, then directly attempts generic Web
Push delivery to active assigned subscribers. That fan-out is best-effort: it
has no durable per-attempt record, retry queue, dead-letter queue, or proof that
a device displayed an alert. A push-service `accepted` response only confirms
that the service accepted the request. The mailbox and mail trace remain the
authoritative source of mail state.

## Recommended future design

Use a transactional D1 outbox plus [Cloudflare Queues](https://developers.cloudflare.com/queues/):

1. In the same D1 transaction that commits a mail delivery, insert an opaque,
   tenant-scoped notification outbox row with a deterministic idempotency key.
   Do not put sender, subject, mailbox address or body content in the Queue
   payload.
2. A bounded dispatcher publishes pending outbox rows to a tenant-scoped Queue
   and records the publish state atomically enough to make replay safe.
3. A Queue consumer resolves current user, mailbox-assignment and subscription
   state immediately before sending. Revoked, inactive and offboarded users
   must receive nothing.
4. Store an attempt/result record keyed by outbox event and endpoint. Use
   idempotency keys and endpoint-safe de-duplication so Queue retries cannot
   multiply notifications.
5. Configure a [dead-letter queue](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)
   for bounded failed deliveries. Alert operators on DLQ growth; do not retry
   indefinitely or turn provider outages into fan-out storms.

## Recovery and operations

Use a [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
only as a recovery sweep for stranded outbox rows, expired leases and DLQ
review. It is not the primary delivery path. The primary path remains
event-driven Queue consumption. Keep D1 as the durable audit/outbox store and
apply its transaction and size limits from the [D1 documentation](https://developers.cloudflare.com/d1/).

## Tenant isolation and security

- Include a tenant identifier in every outbox, Queue and attempt key; validate
  it at every producer and consumer boundary.
- Bind consumers to the least-privilege D1 and Queue resources for that tenant.
- Keep VAPID private keys in runtime secret stores only. Queue payloads and
  logs must contain opaque identifiers, never endpoint keys or email content.
- Re-check access at send time and delete expired/invalid endpoints. Treat the
  push provider and any endpoint-host additions as external network boundaries.
- Apply per-tenant and per-endpoint rate limits, bounded concurrency and
  backoff. Preserve the existing generic lock-screen payload.

## Acceptance gates before implementation

- Demonstrate exactly-once *intent* through idempotent outbox publication and
  at-least-once Queue handling; do not claim exactly-once device display.
- Test revoke/offboard/disabled-mailbox races, endpoint rotation, replay,
  partial provider outage, DLQ recovery, and tenant-crossing attempts.
- Publish retention, operator alerting, replay authority, DLQ access control,
  incident response and rollback procedures.
- Load-test a heavily shared mailbox without starving mail storage or outbound
  delivery. Verify Queue consumer failure never rejects an already-stored mail.

Cloudflare service behaviour, limits and pricing can change; use the linked
primary documentation when converting this blueprint into an approved design.
