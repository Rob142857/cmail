import { describe, expect, it } from 'vitest';
import PostalMime from 'postal-mime';
import { flattenParsedParticipants, inboundFromParticipant } from './index';
import { FIXTURES, fixtureBytes, projectParsed } from './postal-mime-fixtures';
import expected from './postal-mime-fixtures.expected.json';

/**
 * Parser contract for inbound mail. The fixtures in postal-mime-fixtures.ts are
 * parsed in full and compared with postal-mime-fixtures.expected.json.
 *
 * The expected file was generated with postal-mime 4.0.11 after a field-by-field
 * differential run against 3.0.1 (the production version before the upgrade).
 * Everything the worker stores or routes on (addresses, display names, groups,
 * subject, headers, attachment names, types, content-ids, dispositions and the
 * bytes of binary attachments) matched 3.0.1 exactly. The only differences were
 * the intentional 4.x corrections pinned in the 'intentional 4.x differences'
 * block below, plus a few malformed-address edge cases. To change an
 * expectation, regenerate the JSON from a known-good parser build, then review
 * the diff by hand.
 */

async function parseFixture(name: string) {
  return new PostalMime().parse(fixtureBytes(FIXTURES[name] as string).buffer as ArrayBuffer);
}

describe('postal-mime fixture corpus', () => {
  it('has an expectation for every fixture and none left over', () => {
    expect(Object.keys(expected).sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  for (const name of Object.keys(FIXTURES)) {
    it(`parses ${name} exactly as pinned`, async () => {
      expect(projectParsed(await parseFixture(name))).toEqual((expected as Record<string, unknown>)[name]);
    });
  }
});

describe('postal-mime worker-facing results', () => {
  it('keeps RFC 2047 names, groups and Reply-To intact through the worker helpers', async () => {
    const encoded = await parseFixture('rfc2047Headers');
    expect(inboundFromParticipant(encoded.from, 'env@example.test')).toEqual({
      address: 'jose@example.test',
      name: 'José García',
    });
    expect(flattenParsedParticipants(encoded.to)).toEqual([
      { address: 'zoe@example.test', name: 'Zoë Smith' },
      { address: 'pq@example.test', name: 'Plain, Quoted' },
    ]);
    expect(encoded.subject).toBe('Àn encoded subject ✓');

    const grouped = await parseFixture('addressGroups');
    expect(flattenParsedParticipants(grouped.to).map((p) => p.address)).toEqual([
      'a@example.test',
      'b@example.test',
      'solo@example.test',
    ]);
    expect(flattenParsedParticipants(grouped.cc)).toEqual([]);
    expect(flattenParsedParticipants(grouped.replyTo)).toEqual([
      { address: 'replies@example.test', name: 'Replies' },
    ]);
  });

  it('keeps threading and importance headers and first-wins single-value headers', async () => {
    const parsed = await parseFixture('duplicateAndFoldedHeaders');
    const header = (key: string) => parsed.headers.find((h) => h.key.toLowerCase() === key)?.value;
    expect(parsed.from?.address).toBe('first@example.test');
    expect(parsed.subject).toBe('first subject that is long enough to be folded over two lines');
    expect(header('in-reply-to')).toBe('<parent@example.test>');
    expect(header('references')).toBe('<root@example.test> <parent@example.test>');
    expect(header('importance')).toBe('high');
    expect(header('x-priority')).toBe('1');
  });

  it('keeps attachment filenames, types, content ids, dispositions and binary bytes', async () => {
    const files = await parseFixture('attachmentsBinaryAndEncodedNames');
    expect(files.attachments.map((a) => [a.filename, a.mimeType, a.disposition])).toEqual([
      ['plain.bin', 'application/octet-stream', 'attachment'],
      ['résumé.pdf', 'application/pdf', 'attachment'],
      ['data ✓.csv', 'text/csv', 'attachment'],
      [null, 'application/zip', 'attachment'],
    ]);
    expect(Array.from(new Uint8Array(files.attachments[0]?.content as ArrayBuffer))).toEqual([0, 1, 2, 3, 255]);

    const inline = await parseFixture('inlineRelatedImage');
    expect(inline.attachments).toHaveLength(1);
    expect(inline.attachments[0]).toMatchObject({
      filename: 'logo.png',
      mimeType: 'image/png',
      contentId: '<logo@example.test>',
      disposition: 'inline',
      related: true,
    });

    const invite = await parseFixture('calendarInvite');
    expect(invite.attachments.map((a) => a.mimeType)).toEqual(['text/calendar', 'application/ics']);
    expect(invite.attachments[0]?.method).toBe('REQUEST');
  });

  it('decodes legacy charsets, quoted-printable and base64 bodies', async () => {
    const legacy = await parseFixture('latin1Windows1252');
    expect(legacy.text).toBe('café naïve');
    expect(legacy.html).toBe('<p>smart “quotes” and €</p>');
    expect((await parseFixture('base64Utf8Body')).text).toBe('Grüße, 世界 🌏');
    expect((await parseFixture('alternativeQuotedPrintable')).text).toContain(
      'Café au lait — long line that is soft wrapped by the encoder so it joins back up',
    );
  });

  it('does not throw on truncated, header-less or malformed input', async () => {
    for (const name of ['unterminatedMultipart', 'noHeadersBodyOnly', 'malformedAddresses', 'bareLfLineEndings']) {
      await expect(parseFixture(name)).resolves.toBeDefined();
    }
  });
});

describe('postal-mime intentional 4.x differences from 3.0.1', () => {
  it('no longer keeps the line break in front of a multipart boundary as part content', async () => {
    // 3.0.1 returned 'See attached.\n' here.
    expect((await parseFixture('attachmentsBinaryAndEncodedNames')).text).toBe('See attached.');
    expect((await parseFixture('calendarInvite')).text).toBe('You are invited.');
  });

  it('hands quoted-printable attachment bytes and message/rfc822 parts through exactly as sent', async () => {
    const csv = (await parseFixture('attachmentsBinaryAndEncodedNames')).attachments[2];
    // 3.0.1 appended a stray LF: 'a,b\r\n1,2\r\n\n'.
    expect(new TextDecoder().decode(csv?.content as ArrayBuffer)).toBe('a,b\r\n1,2\r\n');
    const inner = (await parseFixture('nestedRfc822')).attachments[0];
    // 3.0.1 rewrote the line endings to bare LF and added a trailing one.
    expect(new TextDecoder().decode(inner?.content as ArrayBuffer)).toContain('\r\nSubject: inner message\r\n');
  });
});

describe('postal-mime 4 parser compatibility', () => {
  it('keeps first-wins single-value headers and document-order recipients', async () => {
    const parsed = await new PostalMime().parse(
      [
        'From: First Sender <first@example.test>',
        'From: Duplicate Sender <duplicate@example.test>',
        'Subject: first subject',
        'Subject: duplicate subject',
        'To: Alpha <alpha@example.test>,',
        '  Beta <beta@example.test>',
        'Cc: Gamma <gamma@example.test>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Hello',
      ].join('\r\n'),
    );

    expect(parsed.from?.address).toBe('first@example.test');
    expect(parsed.from?.name).toBe('First Sender');
    expect(parsed.subject).toBe('first subject');
    expect(parsed.to?.map(({ address }) => address)).toEqual([
      'alpha@example.test',
      'beta@example.test',
    ]);
    expect(parsed.cc?.map(({ address }) => address)).toEqual(['gamma@example.test']);
    expect(parsed.to?.map(({ name }) => name)).toEqual(['Alpha', 'Beta']);
  });

  it('continues returning binary attachment content usable by R2 storage', async () => {
    const parsed = await new PostalMime().parse(
      [
        'From: sender@example.test',
        'To: recipient@example.test',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="boundary"',
        '',
        '--boundary',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Body',
        '--boundary',
        'Content-Type: application/octet-stream; name="sample.bin"',
        'Content-Disposition: attachment; filename="sample.bin"',
        'Content-Transfer-Encoding: base64',
        '',
        'SGVsbG8=',
        '--boundary--',
        '',
      ].join('\r\n'),
    );

    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.filename).toBe('sample.bin');
    expect(parsed.attachments[0]?.mimeType).toBe('application/octet-stream');
    expect(parsed.attachments[0]?.content).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(parsed.attachments[0]?.content as ArrayBuffer))).toEqual([72, 101, 108, 108, 111]);
  });
});
