import type { Message } from '@cmail/shared/types';
import { deliveryStatus, listBadge, type DeliveryEventView, type ListBadge } from '#lib/mail/delivery-status.js';

// One small Delivered / Delayed / Bounced tag per row of the Sent list. The
// open message shows the full picture; this is the at-a-glance version.

type BadgeSource = Pick<Message, 'id' | 'direction' | 'provider_message_ids' | 'failed_recipients' | 'to_addresses' | 'cc_addresses' | 'bcc_addresses'>;

const MAX_IDS_PER_MESSAGE = 50;

function stringList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function recipientCount(message: BadgeSource): number {
  return new Set(
    [message.to_addresses, message.cc_addresses, message.bcc_addresses]
      .flatMap(stringList)
      .map((address) => address.toLowerCase()),
  ).size;
}

/** Badges by message id, for the outbound messages on one page of a list. */
export async function loadDeliveryBadges(db: D1Database, messages: BadgeSource[]): Promise<Record<string, ListBadge>> {
  const badges: Record<string, ListBadge> = {};
  const owners = new Map<string, string[]>();
  for (const message of messages) {
    if (message.direction !== 'outbound') continue;
    // A recipient refused while sending is already known to have failed.
    const failed = new Set(stringList(message.failed_recipients).map((address) => address.toLowerCase())).size;
    if (failed) {
      const total = Math.max(recipientCount(message), failed);
      badges[message.id] = { text: 'Bounced', title: failed === total ? 'Not delivered' : `Not delivered to ${failed} of ${total}`, tone: 'danger' };
      continue;
    }
    for (const id of [...new Set(stringList(message.provider_message_ids))].slice(0, MAX_IDS_PER_MESSAGE)) {
      owners.set(id, [...(owners.get(id) || []), message.id]);
    }
  }
  if (!owners.size) return badges;

  let rows: Array<DeliveryEventView & { provider_message_id: string }>;
  try {
    const result = await db.prepare(
      `SELECT provider_message_id, recipient, event_type, terminal, bounce_type, smtp_status, smtp_response, reason, delivery_time_ms,
              COALESCE(datetime(event_timestamp), received_at) AS occurred_at
       FROM delivery_events
       WHERE provider_message_id IN (SELECT value FROM json_each(?))
       ORDER BY COALESCE(strftime('%Y-%m-%d %H:%M:%f', event_timestamp), received_at) DESC, received_at DESC, event_id DESC
       LIMIT 5000`,
    ).bind(JSON.stringify([...owners.keys()])).all<DeliveryEventView & { provider_message_id: string }>();
    // Newest first so a very busy page loses its oldest events, not the ones
    // that decide each final state; then back to oldest first for deliveryStatus.
    rows = (result.results || []).reverse();
  } catch {
    // Badges are a hint; a failed lookup must not hide the list.
    return badges;
  }

  const byMessage = new Map<string, DeliveryEventView[]>();
  for (const row of rows) {
    for (const messageId of owners.get(row.provider_message_id) || []) {
      byMessage.set(messageId, [...(byMessage.get(messageId) || []), row]);
    }
  }
  for (const message of messages) {
    const events = byMessage.get(message.id);
    if (!events) continue;
    const badge = listBadge(deliveryStatus(events, recipientCount(message)));
    if (badge) badges[message.id] = badge;
  }
  return badges;
}
