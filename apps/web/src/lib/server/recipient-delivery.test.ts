import { describe, expect, it } from 'vitest';
import { planRecipientDelivery } from './recipient-delivery';

describe('recipient delivery planning', () => {
  it('keeps purely internal delivery on the direct local path', () => {
    expect(planRecipientDelivery(
      ['alice@example.com'],
      ['carol@example.com'],
      new Set(['alice@example.com', 'carol@example.com']),
    )).toEqual({
      externalRecipients: [],
      providerTo: [],
      providerCc: [],
      providerRecipients: [],
      localRecipients: ['alice@example.com', 'carol@example.com'],
    });
  });

  it('preserves To and Cc exactly for a mixed internal/external message', () => {
    expect(planRecipientDelivery(
      ['alice@example.com'],
      ['bob@example.net'],
      new Set(['alice@example.com']),
    )).toEqual({
      externalRecipients: ['bob@example.net'],
      providerTo: ['alice@example.com'],
      providerCc: ['bob@example.net'],
      providerRecipients: ['bob@example.net'],
      localRecipients: ['alice@example.com'],
    });
  });

  it('uses the provider for the complete visible list when any recipient is external', () => {
    expect(planRecipientDelivery(
      ['alice@example.com', 'bob@example.net'],
      ['carol@example.com', 'dave@example.net'],
      new Set(['alice@example.com', 'carol@example.com']),
    )).toMatchObject({
      externalRecipients: ['bob@example.net', 'dave@example.net'],
      providerTo: ['alice@example.com', 'bob@example.net'],
      providerCc: ['carol@example.com', 'dave@example.net'],
      providerRecipients: ['bob@example.net', 'dave@example.net'],
      localRecipients: ['alice@example.com', 'carol@example.com'],
    });
  });

  it('uses one all-recipient provider path when the transport cannot separate the envelope', () => {
    expect(planRecipientDelivery(
      ['alice@example.com'],
      ['bob@example.net'],
      new Set(['alice@example.com']),
      false,
    )).toEqual({
      externalRecipients: ['bob@example.net'],
      providerTo: ['alice@example.com'],
      providerCc: ['bob@example.net'],
      providerRecipients: ['alice@example.com', 'bob@example.net'],
      localRecipients: [],
    });
  });
});
