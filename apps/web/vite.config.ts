import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';

let revision = 'unknown';
let modified = true;
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  modified = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim();
} catch { /* Archive builds cannot reliably identify their source revision. */ }

export default defineConfig({
  define: {
    __CMAIL_BUILD__: JSON.stringify({ revision, modified }),
  },
  plugins: [sveltekit()],
  build: {
    rollupOptions: {
      external: ['cloudflare:email'],
    },
  },
});
