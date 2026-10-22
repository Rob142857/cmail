/**
 * Inbound parsing fixtures for the postal-mime compatibility suite.
 *
 * Each fixture is a raw RFC 5322 message held as a "binary" string (one char per
 * byte) so non-UTF-8 charsets and stray bytes survive exactly. The expected
 * results in `postal-mime-fixtures.expected.json` were generated with
 * postal-mime 4.0.11 and are the contract the parser must keep honouring:
 * inbound mail is stored from these fields, so a parser upgrade must not change
 * them without review. Where 4.0.11 differs from 3.0.1 (the version in
 * production before the upgrade), postal-mime-upgrade.test.ts says how.
 *
 * To add a case: add it here, regenerate the expected file with a known-good
 * parser (see the header of postal-mime-upgrade.test.ts), and review the diff.
 */

const CRLF = '\r\n';

/** Encode a JS string as UTF-8 and return it as a one-char-per-byte string. */
function utf8(text: string): string {
  let out = '';
  for (const byte of new TextEncoder().encode(text)) out += String.fromCharCode(byte);
  return out;
}

function lines(...parts: string[]): string {
  return parts.join(CRLF);
}

/** Convert a fixture's binary string to the bytes the parser is handed. */
export function fixtureBytes(raw: string): Uint8Array {
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i) & 0xff;
  return bytes;
}

export const FIXTURES: Record<string, string> = {
  plainText: lines(
    'From: Alice Example <alice@example.test>',
    'To: bob@example.test',
    'Subject: Plain hello',
    'Message-ID: <plain-1@example.test>',
    'Date: Wed, 21 Oct 2026 09:00:00 +1100',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hello Bob,',
    'Second line.',
    '',
  ),

  rfc2047Headers: lines(
    'From: =?UTF-8?B?Sm9zw6kgR2FyY8OtYQ==?= <jose@example.test>',
    'To: =?UTF-8?Q?Zo=C3=AB_Smith?= <zoe@example.test>, "Plain, Quoted" <pq@example.test>',
    'Cc: =?ISO-8859-1?Q?Andr=E9?= <andre@example.test>',
    'Subject: =?UTF-8?B?w4BuIGVuY29kZWQgc3ViamVjdCDinJM=?=',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'body',
    '',
  ),

  addressGroups: lines(
    'From: sender@example.test',
    'To: Team: a@example.test, "B Person" <b@example.test>;, solo@example.test',
    'Cc: Empty Group:;',
    'Reply-To: Replies <replies@example.test>',
    'Subject: groups',
    'Content-Type: text/plain',
    '',
    'group body',
    '',
  ),

  duplicateAndFoldedHeaders: lines(
    'From: First <first@example.test>',
    'From: Second <second@example.test>',
    'Subject: first subject that is long enough to be',
    ' folded over two lines',
    'Subject: second subject',
    'In-Reply-To: <parent@example.test>',
    'References: <root@example.test>',
    ' <parent@example.test>',
    'Importance: high',
    'X-Priority: 1',
    'X-Custom: one',
    'X-Custom: two',
    'To: One <one@example.test>,',
    '  Two <two@example.test>',
    'Content-Type: text/plain; charset=us-ascii',
    '',
    'body',
    '',
  ),

  alternativeQuotedPrintable: lines(
    'From: qp@example.test',
    'To: reader@example.test',
    'Subject: qp alternative',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="alt"',
    '',
    '--alt',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Caf=C3=A9 au lait =E2=80=94 long line that is soft wrapped by the encoder so=',
    ' it joins back up',
    '',
    '--alt',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<p>Caf=C3=A9 <b>au lait</b></p>',
    '',
    '--alt--',
    '',
  ),

  latin1Windows1252: lines(
    'From: legacy@example.test',
    'To: reader@example.test',
    'Subject: legacy charset',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b"',
    '',
    '--b',
    'Content-Type: text/plain; charset=iso-8859-1',
    'Content-Transfer-Encoding: 8bit',
    '',
    `caf${String.fromCharCode(0xe9)} na${String.fromCharCode(0xef)}ve`,
    '--b',
    'Content-Type: text/html; charset=windows-1252',
    'Content-Transfer-Encoding: 8bit',
    '',
    `<p>smart ${String.fromCharCode(0x93)}quotes${String.fromCharCode(0x94)} and ${String.fromCharCode(0x80)}</p>`,
    '--b--',
    '',
  ),

  base64Utf8Body: lines(
    'From: b64@example.test',
    'To: reader@example.test',
    'Subject: base64 body',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    // "Grüße, 世界 🌏" in UTF-8
    'R3LDvMOfZSwg5LiW55WMIPCfjI8=',
    '',
  ),

  attachmentsBinaryAndEncodedNames: lines(
    'From: files@example.test',
    'To: reader@example.test',
    'Subject: attachments',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="mix"',
    '',
    '--mix',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'See attached.',
    '--mix',
    'Content-Type: application/octet-stream; name="plain.bin"',
    'Content-Disposition: attachment; filename="plain.bin"',
    'Content-Transfer-Encoding: base64',
    '',
    'AAECA/8=',
    '--mix',
    "Content-Type: application/pdf; name*=UTF-8''r%C3%A9sum%C3%A9.pdf",
    "Content-Disposition: attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
    'Content-Transfer-Encoding: base64',
    '',
    'JVBERi0xLjQK',
    '--mix',
    'Content-Type: text/csv; name="=?UTF-8?B?ZGF0YSDinJMuY3N2?="',
    'Content-Disposition: attachment; filename="=?UTF-8?B?ZGF0YSDinJMuY3N2?="',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'a,b=0D=0A1,2=0D=0A',
    '--mix',
    'Content-Type: application/zip',
    'Content-Disposition: attachment',
    'Content-Transfer-Encoding: base64',
    '',
    'UEsDBBQAAAAIAA==',
    '--mix--',
    '',
  ),

  inlineRelatedImage: lines(
    'From: inline@example.test',
    'To: reader@example.test',
    'Subject: inline image',
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary="rel"',
    '',
    '--rel',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>logo: <img src="cid:logo@example.test"></p>',
    '--rel',
    'Content-Type: image/png; name="logo.png"',
    'Content-Disposition: inline; filename="logo.png"',
    'Content-ID: <logo@example.test>',
    'Content-Transfer-Encoding: base64',
    '',
    'iVBORw0KGgo=',
    '--rel--',
    '',
  ),

  calendarInvite: lines(
    'From: organiser@example.test',
    'To: guest@example.test',
    'Subject: Invitation',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="cal"',
    '',
    '--cal',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'You are invited.',
    '--cal',
    'Content-Type: text/calendar; charset=utf-8; method=REQUEST',
    'Content-Transfer-Encoding: 7bit',
    '',
    'BEGIN:VCALENDAR',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:event-1@example.test',
    'DTSTART:20261101T000000Z',
    'DTEND:20261101T010000Z',
    'SUMMARY:Planning',
    'END:VEVENT',
    'END:VCALENDAR',
    '--cal',
    'Content-Type: application/ics; name="invite.ics"',
    'Content-Disposition: attachment; filename="invite.ics"',
    'Content-Transfer-Encoding: base64',
    '',
    'QkVHSU46VkNBTEVOREFSCkVORDpWQ0FMRU5EQVIK',
    '--cal--',
    '',
  ),

  nestedRfc822: lines(
    'From: forwarder@example.test',
    'To: reader@example.test',
    'Subject: Fwd: inner',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="outer"',
    '',
    '--outer',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Forwarded below.',
    '--outer',
    'Content-Type: message/rfc822',
    'Content-Disposition: attachment; filename="inner.eml"',
    '',
    'From: inner@example.test',
    'To: someone@example.test',
    'Subject: inner message',
    'Content-Type: text/plain',
    '',
    'inner body',
    '--outer--',
    '',
  ),

  bareLfLineEndings: [
    'From: lf@example.test',
    'To: reader@example.test',
    'Subject: bare LF',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="lf"',
    '',
    '--lf',
    'Content-Type: text/plain',
    '',
    'only LF endings',
    '--lf--',
    '',
  ].join('\n'),

  unterminatedMultipart: lines(
    'From: broken@example.test',
    'To: reader@example.test',
    'Subject: no closing boundary',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="open"',
    '',
    '--open',
    'Content-Type: text/plain',
    '',
    'text before truncation',
    '--open',
    'Content-Type: application/octet-stream',
    'Content-Disposition: attachment; filename="cut.bin"',
    'Content-Transfer-Encoding: base64',
    '',
    'AQID',
  ),

  noHeadersBodyOnly: lines('', 'body without any headers', ''),

  malformedAddresses: lines(
    'From: "Unclosed <broken@example.test',
    'To: <>, not-an-address, "A" <a@example.test>, <b@example.test>',
    'Cc: a@example.test, a@example.test',
    'Subject: malformed',
    'Content-Type: text/plain',
    '',
    'x',
    '',
  ),

  unicodeBodyAndSubjectRaw: lines(
    'From: raw@example.test',
    utf8('To: Zoë <zoe@example.test>'),
    utf8('Subject: Raw 8-bit subject ✓'),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    utf8('Bonjour — café, 世界'),
    '',
  ),

  htmlOnlyWithEntities: lines(
    'From: html@example.test',
    'To: reader@example.test',
    'Subject: html only',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<html><body><p>5 &lt; 6 &amp; 7 &gt; 3</p><a href="https://example.test/x?a=1&amp;b=2">link</a></body></html>',
    '',
  ),
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary);
}

/**
 * Plain-JSON view of a parse result: binary attachment content becomes
 * `{ bytesBase64 }` so two parser versions can be compared field for field.
 */
export function projectParsed(parsed: unknown): unknown {
  return JSON.parse(
    JSON.stringify(parsed, (_key, value: unknown) => {
      if (value instanceof ArrayBuffer) return { bytesBase64: toBase64(new Uint8Array(value)) };
      if (ArrayBuffer.isView(value)) {
        return { bytesBase64: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
      }
      return value;
    }),
  );
}
