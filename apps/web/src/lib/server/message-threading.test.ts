import { describe, expect, it } from 'vitest';
import { deriveReplyThreading, safeReferences } from './message-threading';

describe('deriveReplyThreading', () => {
  it('appends a known source Message-ID to inherited ancestry', () => {
    expect(deriveReplyThreading({
      message_id_header: '<current@example.com>',
      in_reply_to: '<parent@example.net>',
      references_header: '<root@example.org> <parent@example.net>',
    })).toEqual({
      inReplyTo: '<current@example.com>',
      referencesHeader: '<root@example.org> <parent@example.net> <current@example.com>',
    });
  });

  it('preserves established ancestry when the provider did not expose the source wire ID', () => {
    expect(deriveReplyThreading({
      message_id_header: null,
      in_reply_to: '<parent@example.net>',
      references_header: '<root@example.org> <parent@example.net>',
    })).toEqual({
      inReplyTo: '<parent@example.net>',
      referencesHeader: '<root@example.org> <parent@example.net>',
    });
  });

  it('uses the newest valid reference when no explicit parent is stored', () => {
    expect(deriveReplyThreading({
      message_id_header: null,
      in_reply_to: null,
      references_header: '<root@example.org> <known@example.net>',
    })).toEqual({
      inReplyTo: '<known@example.net>',
      referencesHeader: '<root@example.org> <known@example.net>',
    });
  });

  it('deduplicates and bounds a References field body', () => {
    const references = safeReferences([
      '<root@example.org>',
      '<root@example.org>',
      ...Array.from({ length: 100 }, (_, index) => `<${index}@example.net>`),
    ].join(' '));

    expect(references).toBeTruthy();
    expect(references?.split(' ')[0]).toBe('<root@example.org>');
    expect(references?.split(' ').length).toBeLessThanOrEqual(50);
    expect(new TextEncoder().encode(`References: ${references}`).byteLength).toBeLessThanOrEqual(998);
  });
});
