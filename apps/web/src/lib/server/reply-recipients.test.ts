import { describe, expect, it } from 'vitest';
import { buildReplyRecipients, replyAllAddsRecipients } from './reply-recipients';

describe('reply recipient construction', () => {
  it('replies only to an inbound sender and Reply all keeps non-self recipients', () => {
    const source = {
      from_address: 'sender@example.net',
      to_addresses: JSON.stringify(['me@example.com', 'colleague@example.net']),
      cc_addresses: JSON.stringify(['copy@example.net', 'ME@example.com']),
      reply_to_addresses: '[]',
      direction: 'inbound',
      folder: 'inbox',
    };
    expect(buildReplyRecipients(source, ['me@example.com'], false)).toEqual({
      to: ['sender@example.net'],
      cc: [],
    });
    expect(buildReplyRecipients(source, ['me@example.com'], true)).toEqual({
      to: ['sender@example.net', 'colleague@example.net'],
      cc: ['copy@example.net'],
    });
  });

  it('targets original recipients rather than the sender when replying from Sent', () => {
    const source = {
      from_address: 'me@example.com',
      to_addresses: JSON.stringify(['one@example.net', 'two@example.net']),
      cc_addresses: JSON.stringify(['copy@example.net']),
      reply_to_addresses: '[]',
      direction: 'outbound',
      folder: 'sent',
    };
    expect(buildReplyRecipients(source, ['me@example.com'], false)).toEqual({
      to: ['one@example.net', 'two@example.net'],
      cc: [],
    });
    expect(buildReplyRecipients(source, ['me@example.com'], true)).toEqual({
      to: ['one@example.net', 'two@example.net'],
      cc: ['copy@example.net'],
    });
  });

  it('deduplicates case-insensitively and ignores malformed stored values', () => {
    expect(buildReplyRecipients({
      from_address: 'Sender@Example.net',
      to_addresses: '["sender@example.net", 42, "bad"]',
      cc_addresses: 'not-json',
      reply_to_addresses: '[]',
      direction: 'inbound',
      folder: 'inbox',
    }, [], true)).toEqual({ to: ['sender@example.net'], cc: [] });
  });

  it('uses every valid Reply-To mailbox instead of From', () => {
    expect(buildReplyRecipients({
      from_address: 'automated@example.net',
      to_addresses: JSON.stringify(['me@example.com']),
      cc_addresses: '[]',
      reply_to_addresses: JSON.stringify(['desk@example.net', 'owner@example.net']),
      direction: 'inbound',
      folder: 'inbox',
    }, ['me@example.com'], false)).toEqual({
      to: ['desk@example.net', 'owner@example.net'],
      cc: [],
    });
  });

  it('preserves quoted local-parts and domain literals through Reply all', () => {
    expect(buildReplyRecipients({
      from_address: '"team,desk"@example.net',
      to_addresses: JSON.stringify(['me@example.com', 'user@[192.0.2.1]']),
      cc_addresses: JSON.stringify(['"copy@desk"@example.net']),
      reply_to_addresses: '[]',
      direction: 'inbound',
      folder: 'inbox',
    }, ['me@example.com'], true)).toEqual({
      to: ['"team,desk"@example.net', 'user@[192.0.2.1]'],
      cc: ['"copy@desk"@example.net'],
    });
  });

  it('offers Reply all when a Bcc delivery has a visible non-self recipient', () => {
    expect(replyAllAddsRecipients({
      from_address: 'sender@example.net',
      to_addresses: JSON.stringify(['visible-recipient@example.net']),
      cc_addresses: '[]',
      reply_to_addresses: '[]',
      direction: 'inbound',
      folder: 'inbox',
    }, ['hidden-recipient@example.com'])).toBe(true);
  });

  it('hides Reply all when every additional recipient is another assigned mailbox', () => {
    expect(replyAllAddsRecipients({
      from_address: 'sender@example.net',
      to_addresses: JSON.stringify(['primary@example.com', 'shared@example.com']),
      cc_addresses: JSON.stringify(['alias@example.com']),
      reply_to_addresses: '[]',
      direction: 'inbound',
      folder: 'inbox',
    }, ['primary@example.com', 'shared@example.com', 'alias@example.com'])).toBe(false);
  });
});
