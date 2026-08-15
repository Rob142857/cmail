import { describe, expect, it } from 'vitest';
import { GET } from './+server';

describe('PWA manifest', () => {
  it('publishes a standalone, scoped mailbox app with install icons and safe shortcuts', async () => {
    const response = await GET({ platform: undefined } as never);
    const manifest = await response.json() as {
      icons: Array<{ sizes: string; type?: string }>;
      shortcuts: Array<{ url: string }>;
      [key: string]: unknown;
    };

    expect(response.headers.get('content-type')).toContain('application/manifest+json');
    expect(manifest).toMatchObject({
      id: '/mail',
      start_url: '/mail',
      scope: '/',
      display: 'standalone',
      prefer_related_applications: false,
    });
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
      expect.objectContaining({ sizes: '512x512', type: 'image/png' }),
    ]));
    expect(manifest.shortcuts.map((shortcut: { url: string }) => shortcut.url)).toEqual([
      '/mail',
      '/mail/compose',
    ]);
    expect(manifest.shortcuts.every((shortcut: { url: string }) => shortcut.url.startsWith('/mail'))).toBe(true);
  });
});
