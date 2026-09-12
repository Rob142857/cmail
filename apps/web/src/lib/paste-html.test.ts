import { describe, expect, it, vi } from 'vitest';

/** Minimal DOM fixture for the browser-only clipboard helper. */
class FakeBody {
  childNodes: unknown[] = [];
  innerHTML = '<p>&lt;script&gt;literal text&lt;/script&gt;</p>';
  textContent = '<script>literal text</script>';

  querySelector(selector: string): null {
    if (selector === 'img') return null;
    return null;
  }
}

class FakeDOMParser {
  parseFromString(): { body: FakeBody } {
    return { body: new FakeBody() };
  }
}

describe('cleanPastedHtml', () => {
  it('uses parsed text content for tag-like pasted text', async () => {
    vi.stubGlobal('DOMParser', FakeDOMParser);
    try {
      const { cleanPastedHtml } = await import('./paste-html');
      expect(cleanPastedHtml('<p>&lt;script&gt;literal text&lt;/script&gt;</p>'))
        .toBe('<p>&lt;script&gt;literal text&lt;/script&gt;</p>');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
