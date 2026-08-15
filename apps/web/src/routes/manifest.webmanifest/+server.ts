import type { RequestHandler } from './$types';
import { publicRuntimeConfig } from '$lib/server/config';
import { loadOrgSettings } from '$lib/server/org-settings';

export const GET: RequestHandler = async ({ platform }) => {
  const env = platform?.env;
  const runtime = env
    ? publicRuntimeConfig(env as unknown as Record<string, unknown>)
    : publicRuntimeConfig({});
  const settings = env
    ? await loadOrgSettings(env as unknown as Record<string, unknown>)
    : null;
  const name = settings?.appName || runtime.appName;
  const organisation = settings?.orgName || 'your organisation';

  return Response.json({
    id: '/mail',
    name,
    short_name: name.slice(0, 30),
    lang: runtime.locale,
    description: `Secure organisational email for ${organisation}`,
    start_url: '/mail',
    scope: '/',
    display: 'standalone',
    background_color: '#0b0d10',
    theme_color: runtime.brandPrimaryColor,
    categories: ['business', 'productivity'],
    prefer_related_applications: false,
    icons: [
      {
        src: runtime.brandIconUrl,
        sizes: 'any',
        purpose: 'any',
      },
      {
        src: runtime.brandIcon192Url,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: runtime.brandIcon512Url,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    shortcuts: [
      {
        name: 'Inbox',
        short_name: 'Inbox',
        description: 'Open assigned mailboxes',
        url: '/mail',
        icons: [{ src: runtime.brandIcon192Url, sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'New message',
        short_name: 'Compose',
        description: 'Compose a new message',
        url: '/mail/compose',
        icons: [{ src: runtime.brandIcon192Url, sizes: '192x192', type: 'image/png' }],
      },
    ],
  }, {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
};
