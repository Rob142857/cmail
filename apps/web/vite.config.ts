import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let revision = 'unknown';
let modified = true;
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  modified = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim();
} catch { /* Archive builds cannot reliably identify their source revision. */ }
let version: string | undefined;
try {
  version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
} catch { /* Version is display-only. */ }

export default defineConfig({
  define: {
    __CMAIL_BUILD__: JSON.stringify({ revision, modified, version }),
  },
  plugins: [
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter({ routes: { include: ['/*'], exclude: ['<all>'] } }),
      // Lifecycle-triggered updated.check() calls in the root layout perform
      // deployment detection; disable SvelteKit's background polling timer.
      version: { pollInterval: 0 },
      // The built-in CSRF origin check is re-implemented verbatim in
      // src/hooks.server.ts (isCrossSiteFormSubmission), which exempts only the
      // cookie-less OAuth token and revocation endpoints that native MCP
      // clients call without an Origin header. '*' disables the built-in copy.
      csrf: { trustedOrigins: ['*'] },
      // CSP — SvelteKit auto-injects sha256 hashes for its own hydration scripts
      // and inline styles when mode is 'hash'. We can therefore stay on a strict
      // policy WITHOUT 'unsafe-inline' for scripts.
      csp: {
        mode: 'hash',
        directives: {
          'default-src': ['self'],
          // 'self' covers /_app/* bundles. Cloudflare Web Analytics beacon is
          // injected by the Pages edge — allow its host explicitly. The
          // Turnstile host is only ever reached from /auth/email, when the
          // optional bot check is configured (see turnstile.ts) — its widget
          // script, the iframe it renders, and its own XHR all need it named
          // here, or the browser blocks them even though the deployment opted in.
          'script-src': [
            'self',
            'https://static.cloudflareinsights.com',
            'https://challenges.cloudflare.com'
          ],
          'script-src-elem': [
            'self',
            'https://static.cloudflareinsights.com',
            'https://challenges.cloudflare.com'
          ],
          'style-src': ['self', 'unsafe-inline'],
          'img-src': ['self', 'data:', 'https:'],
          'font-src': ['self', 'data:'],
          // Cloudflare Insights beacon posts to cloudflareinsights.com; Turnstile's
          // widget verifies itself against challenges.cloudflare.com.
          'connect-src': [
            'self',
            'https://cloudflareinsights.com',
            'https://static.cloudflareinsights.com',
            'https://challenges.cloudflare.com'
          ],
          'frame-src': ['self', 'https://challenges.cloudflare.com'],
          'frame-ancestors': ['none'],
          'base-uri': ['self'],
          // The invitation page POSTs to /enroll/<provider>, which 303s to
          // /auth/login/<provider> and from there to the identity provider's
          // authorisation endpoint. Chrome enforces form-action across the whole
          // redirect chain, so the final hop has to be named here or the
          // enrolment POST is blocked. Only the two configured IdP origins are
          // allowed — nothing else may receive a form submission.
          'form-action': [
            'self',
            'https://accounts.google.com',
            'https://login.microsoftonline.com'
          ],
          'object-src': ['none'],
          'upgrade-insecure-requests': true
        }
      }
    })
  ],
  build: { rollupOptions: { external: ['cloudflare:email'] } }
});
