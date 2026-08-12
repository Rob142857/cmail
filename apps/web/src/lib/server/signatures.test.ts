import { describe, expect, it } from 'vitest';
import {
  appendSignatureToAuthoredHtml,
  getEffectiveSignature,
  sanitizeSignature,
  savePersonalSignature,
} from './signatures';

describe('signature helpers', () => {
  it('sanitizes active content and derives a safe plain-text fallback', () => {
    const signature = sanitizeSignature(
      '<p style="color:#123456; background-image:url(https://bad.example/a)">Regards <a href="javascript:alert(1)" onclick="x()">me</a><img src="https://tracker.example/pixel.png" alt="tracker"></p><script>alert(1)</script>',
    );
    expect(signature).not.toBeNull();
    expect(signature?.html).toContain('color:#123456');
    expect(signature?.html).not.toMatch(/script|onclick|javascript:|url\s*\(|<img\b|tracker\.example/i);
    expect(signature?.plainText).toContain('Regards me');
  });

  it('decodes entities once without turning recursively encoded text into markup', () => {
    const signature = sanitizeSignature(
      '<p>&amp;lt;script&amp;gt; &lt;strong&gt;visible text&lt;/strong&gt;</p>',
    );
    expect(signature?.plainText).toBe('&lt;script&gt; <strong>visible text</strong>');
  });

  it('layers personal content above an enabled organisation notice in distinct blocks', async () => {
    const db = {
      prepare(query: string) {
        return {
          bind() { return this; },
          first: async () => query.includes('personal_signatures')
            ? {
              user_id: 'user-1', html_body: '<p>Personal</p>', plain_text_body: 'Personal',
              is_locked: 1, updated_at: '2026-08-12 00:00:00', updated_by: 'manager-1',
            }
            : {
              id: 'sig-default', html_body: '<hr><p>Organisation</p>', plain_text_body: 'Organisation',
              is_locked: 1, is_enabled: 1,
            },
        };
      },
    } as unknown as D1Database;

    await expect(getEffectiveSignature(db, 'user-1', 'user@example.test')).resolves.toMatchObject({
      personalHtml: '<p>Personal</p>',
      organisationHtml: '<hr><p>Organisation</p>',
      html: '<div data-cmail-signature="personal"><p>Personal</p></div><div data-cmail-signature="organisation"><hr><p>Organisation</p></div>',
      text: 'Personal\n\nOrganisation',
      personalLocked: true,
    });
  });

  it('separates authored HTML from the first generated signature block once', () => {
    const signature = '<div data-cmail-signature="personal">Personal</div><div data-cmail-signature="organisation">Organisation</div>';
    expect(appendSignatureToAuthoredHtml('Thanks', signature)).toBe(`Thanks<br>${signature}`);
    expect(appendSignatureToAuthoredHtml('', signature)).toBe(signature);
    expect(appendSignatureToAuthoredHtml('Thanks', '')).toBe('Thanks');
  });

  it('does not let self-service overwrite a personal signature locked concurrently', async () => {
    const db = {
      prepare(query: string) {
        expect(query).toContain('personal_signatures.is_locked = 0');
        return {
          bind() { return this; },
          run: async () => ({ meta: { changes: 0 } }),
        };
      },
    } as unknown as D1Database;

    await expect(savePersonalSignature(db, {
      userId: 'user-1',
      html: '<p>Changed by user</p>',
      isLocked: false,
      updatedBy: 'user-1',
      onlyIfUnlocked: true,
    })).resolves.toBeNull();
  });
});
