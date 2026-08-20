import { describe, expect, it } from 'vitest';
import { planRecipientDelivery } from './recipient-delivery';

describe('recipient delivery planning', () => {
  it('keeps purely internal delivery on the direct local path', () => {
    expect(planRecipientDelivery(
      ['alice@example.com'],
      ['carol@example.com'],
      [],
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
      [],
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
      [],
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
      [],
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

  describe('Bcc', () => {
    it('keeps purely internal Bcc off the provider and out of every visible header', () => {
      expect(planRecipientDelivery(
        ['alice@example.com'],
        [],
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

    it('sends an external-only Bcc through the envelope without touching To/Cc', () => {
      expect(planRecipientDelivery(
        ['alice@example.com'],
        [],
        ['bob@example.net'],
        new Set(['alice@example.com']),
      )).toEqual({
        externalRecipients: [],
        providerTo: ['alice@example.com'],
        providerCc: [],
        providerRecipients: ['bob@example.net'],
        localRecipients: ['alice@example.com'],
      });
    });

    it('adds external Bcc to the envelope alongside visible external recipients', () => {
      expect(planRecipientDelivery(
        ['alice@example.com'],
        ['dana@example.net'],
        ['bob@example.net'],
        new Set(['alice@example.com']),
      )).toEqual({
        externalRecipients: ['dana@example.net'],
        providerTo: ['alice@example.com'],
        providerCc: ['dana@example.net'],
        providerRecipients: ['dana@example.net', 'bob@example.net'],
        localRecipients: ['alice@example.com'],
      });
    });

    it('delivers internal Bcc directly and never lumps it into providerTo/providerCc even without separated envelope', () => {
      expect(planRecipientDelivery(
        ['alice@example.com'],
        ['dana@example.net'],
        ['carol@example.com'],
        new Set(['alice@example.com', 'carol@example.com']),
        false,
      )).toEqual({
        externalRecipients: ['dana@example.net'],
        providerTo: ['alice@example.com'],
        providerCc: ['dana@example.net'],
        providerRecipients: ['alice@example.com', 'dana@example.net'],
        localRecipients: ['carol@example.com'],
      });
    });

    it('still routes external Bcc through the envelope when the transport cannot separate the visible envelope', () => {
      expect(planRecipientDelivery(
        ['alice@example.com'],
        [],
        ['bob@example.net'],
        new Set(['alice@example.com']),
        false,
      )).toEqual({
        externalRecipients: [],
        providerTo: ['alice@example.com'],
        providerCc: [],
        providerRecipients: ['alice@example.com', 'bob@example.net'],
        localRecipients: [],
      });
    });
  });
});
