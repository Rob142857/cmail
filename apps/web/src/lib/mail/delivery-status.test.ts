import { describe, expect, it } from 'vitest';
import { deliveryStatus, deliveryStepLabel, elapsedLabel, type DeliveryEventView } from './delivery-status';

function event(recipient: string, event_type: string, occurred_at: string, terminal = 1, bounce_type: string | null = null): DeliveryEventView {
  return {
    recipient, event_type, terminal, bounce_type, occurred_at,
    smtp_status: null, smtp_response: null, reason: null, delivery_time_ms: null,
  };
}

describe('deliveryStatus', () => {
  it('shows nothing without events', () => {
    expect(deliveryStatus([], 2)).toBeNull();
  });

  it('reads delivered, and a partial picture against the recipient count', () => {
    expect(deliveryStatus([event('a@example.net', 'delivered', '2026-11-06 01:00:00')], 1)?.label).toBe('Delivered');
    expect(deliveryStatus([event('a@example.net', 'delivered', '2026-11-06 01:00:00')], 3)).toMatchObject({
      label: 'Delivered to 1 of 3', tone: 'ok',
    });
  });

  it('puts a failure first, then a delay', () => {
    const events = [
      event('a@example.net', 'delivered', '2026-11-06 01:00:00'),
      event('b@example.net', 'deferred', '2026-11-06 01:00:01', 0),
      event('c@example.net', 'bounced', '2026-11-06 01:00:02', 1, 'hard'),
    ];
    expect(deliveryStatus(events, 3)).toMatchObject({ label: 'Not delivered to 1 of 3', tone: 'danger' });
    expect(deliveryStatus(events.slice(0, 2), 2)).toMatchObject({ label: 'Delivery delayed to 1 of 2, retrying', tone: 'warning' });
  });

  it('follows each recipient to its latest state, case-insensitively', () => {
    const events = [
      event('A@example.net', 'deferred', '2026-11-06 01:00:00', 0),
      event('a@example.net', 'delivered', '2026-11-06 01:05:00'),
      event('a@example.net', 'deferred', '2026-11-06 01:06:00', 0),
    ];
    expect(deliveryStatus(events, 1)).toMatchObject({
      label: 'Delivered', recipients: [{ address: 'a@example.net', state: 'delivered', at: '2026-11-06 01:05:00' }],
    });
  });

  it('notes a spam complaint after delivery', () => {
    const events = [
      event('a@example.net', 'delivered', '2026-11-06 01:00:00'),
      event('a@example.net', 'complained', '2026-11-06 02:00:00'),
    ];
    expect(deliveryStatus(events, 1)).toMatchObject({ label: 'Delivered, marked as spam by 1', tone: 'warning' });
  });

  it('says "Not delivered" when every recipient failed', () => {
    expect(deliveryStatus([event('a@example.net', 'rejected', '2026-11-06 01:00:00')], 1)?.label).toBe('Not delivered');
  });
});

describe('deliveryStepLabel', () => {
  it('words each step', () => {
    expect(deliveryStepLabel({ event_type: 'bounced', terminal: 1, bounce_type: 'hard' })).toBe('Bounced (permanent)');
    expect(deliveryStepLabel({ event_type: 'bounced', terminal: 1, bounce_type: 'soft' })).toBe('Bounced (gave up after retries)');
    expect(deliveryStepLabel({ event_type: 'bounced', terminal: 0, bounce_type: 'soft' })).toBe('Bounced, will retry');
    expect(deliveryStepLabel({ event_type: 'deferred', terminal: 0, bounce_type: null })).toBe('Delayed, will retry');
    expect(deliveryStepLabel({ event_type: 'unknown', terminal: 0, bounce_type: null })).toBe('unknown');
  });
});

describe('elapsedLabel', () => {
  it('mixes ISO and SQLite times', () => {
    expect(elapsedLabel('2026-11-06T01:00:00.000Z', '2026-11-06 01:00:20')).toBe('+20 s');
    expect(elapsedLabel('2026-11-06 01:00:00', '2026-11-06 01:05:00')).toBe('+5 min');
    expect(elapsedLabel('2026-11-06 01:00:00', '2026-11-06 04:00:00')).toBe('+3 h');
    expect(elapsedLabel('2026-11-06 01:00:00', '2026-11-09 01:00:00')).toBe('+3 d');
  });

  it('is empty for an earlier or unreadable time', () => {
    expect(elapsedLabel('2026-11-06 01:00:00', '2026-11-06 00:59:00')).toBe('');
    expect(elapsedLabel('not a date', '2026-11-06 00:59:00')).toBe('');
  });
});
