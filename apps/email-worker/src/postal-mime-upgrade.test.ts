import { describe, expect, it } from 'vitest';
import PostalMime from 'postal-mime';

describe('postal-mime 3 parser compatibility', () => {
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
