// Turns stored Email Sending events (delivery_events rows) into what people
// read: one delivery status for a Sent message, and a timeline step label for
// Admin > Mail trace. Rows come oldest first. Instances without the events
// subscription have no rows, and then nothing is shown.

export interface DeliveryEventView {
  recipient: string;
  event_type: string;
  terminal: number;
  bounce_type: string | null;
  smtp_status: string | null;
  smtp_response: string | null;
  reason: string | null;
  delivery_time_ms: number | null;
  occurred_at: string;
}

export type RecipientDeliveryState = 'delivered' | 'retrying' | 'failed' | 'complained';

export interface DeliveryStatus {
  label: string;
  tone: 'ok' | 'warning' | 'danger';
  recipients: { address: string; state: RecipientDeliveryState; at: string }[];
}

const FAILURE_TYPES = new Set(['bounced', 'failed', 'rejected']);

function stateOf(event: Pick<DeliveryEventView, 'event_type' | 'terminal'>): RecipientDeliveryState | null {
  if (event.event_type === 'delivered') return 'delivered';
  if (event.event_type === 'complained') return 'complained';
  if (event.event_type === 'deferred') return 'retrying';
  if (FAILURE_TYPES.has(event.event_type)) return event.terminal ? 'failed' : 'retrying';
  return null;
}

/**
 * The latest state per recipient, summed up in one label. `recipientCount` is
 * the number of addresses the message went to, when known, so a partial
 * picture reads "Delivered to 1 of 3" rather than "Delivered".
 */
export function deliveryStatus(events: DeliveryEventView[], recipientCount = 0): DeliveryStatus | null {
  const latest = new Map<string, { state: RecipientDeliveryState; at: string }>();
  for (const event of events) {
    const state = stateOf(event);
    if (!state) continue;
    const address = event.recipient.toLowerCase();
    // A complaint follows a delivery; a late deferral never undoes a final state.
    const previous = latest.get(address);
    if (state === 'retrying' && previous && previous.state !== 'retrying') continue;
    latest.set(address, { state, at: event.occurred_at });
  }
  if (!latest.size) return null;

  const recipients = [...latest].map(([address, value]) => ({ address, ...value }));
  const count = (state: RecipientDeliveryState) => recipients.filter((recipient) => recipient.state === state).length;
  const failed = count('failed');
  const retrying = count('retrying');
  const complained = count('complained');
  const arrived = count('delivered') + complained;
  const total = Math.max(recipientCount, recipients.length);

  if (failed) {
    return { label: failed === total ? 'Not delivered' : `Not delivered to ${failed} of ${total}`, tone: 'danger', recipients };
  }
  if (retrying) {
    return { label: retrying === total ? 'Delivery delayed, retrying' : `Delivery delayed to ${retrying} of ${total}, retrying`, tone: 'warning', recipients };
  }
  const delivered = arrived === total ? 'Delivered' : `Delivered to ${arrived} of ${total}`;
  if (complained) return { label: `${delivered}, marked as spam by ${complained}`, tone: 'warning', recipients };
  return { label: delivered, tone: 'ok', recipients };
}

export interface ListBadge {
  /** One word for the row. */
  text: string;
  /** The full status, for the tooltip and screen readers. */
  title: string;
  tone: DeliveryStatus['tone'];
}

/** The Sent list's one-word version of a delivery status. */
export function listBadge(status: DeliveryStatus | null): ListBadge | null {
  if (!status) return null;
  const text = status.tone === 'danger'
    ? 'Bounced'
    : status.tone === 'ok'
      ? 'Delivered'
      : status.recipients.some((recipient) => recipient.state === 'retrying') ? 'Delayed' : 'Spam report';
  return { text, title: status.label, tone: status.tone };
}

const STEP_LABELS: Record<string, string> = {
  delivered: 'Delivered',
  deferred: 'Delayed, will retry',
  bounced: 'Bounced',
  failed: 'Failed',
  rejected: 'Rejected before sending',
  complained: 'Marked as spam by the recipient',
};

/** Words for one timeline step. */
export function deliveryStepLabel(event: Pick<DeliveryEventView, 'event_type' | 'terminal' | 'bounce_type'>): string {
  const label = STEP_LABELS[event.event_type] || event.event_type;
  if (event.event_type === 'bounced') {
    if (!event.terminal) return 'Bounced, will retry';
    return event.bounce_type === 'soft' ? 'Bounced (gave up after retries)' : 'Bounced (permanent)';
  }
  return label;
}

function toTime(value: string): number {
  const text = value.includes('T') ? value : value.replace(' ', 'T');
  return new Date(/Z$|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`).getTime();
}

/** "+20 s", "+3 min", "+2 h" after `start`; empty when either time is unreadable or earlier. */
export function elapsedLabel(start: string, at: string): string {
  const seconds = Math.round((toTime(at) - toTime(start)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 90) return `+${seconds} s`;
  if (seconds < 90 * 60) return `+${Math.round(seconds / 60)} min`;
  if (seconds < 48 * 3600) return `+${Math.round(seconds / 3600)} h`;
  return `+${Math.round(seconds / 86400)} d`;
}
