import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      routes: {
        include: ['/*'],
        exclude: ['<all>'],
      },
    }),
    // CSP — SvelteKit auto-injects sha256 hashes for its own hydration scripts
    // and inline styles when mode is 'hash'. We can therefore stay on a strict
    // policy WITHOUT 'unsafe-inline' for scripts.
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        // 'self' covers /_app/* bundles. Cloudflare Web Analytics beacon is
        // injected by the Pages edge — allow its host explicitly.
        'script-src': ['self', 'https://static.cloudflareinsights.com'],
        'script-src-elem': ['self', 'https://static.cloudflareinsights.com'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'data:', 'https:'],
        'font-src': ['self', 'data:'],
        // Cloudflare Insights beacon posts to cloudflareinsights.com.
        'connect-src': ['self', 'https://cloudflareinsights.com', 'https://static.cloudflareinsights.com'],
        'frame-src': ['self'],
        'frame-ancestors': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        'object-src': ['none'],
        'upgrade-insecure-requests': true,
      },
    },
  },
};

export default config;
