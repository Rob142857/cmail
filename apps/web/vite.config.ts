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
  plugins: [sveltekit()],
  build: {
    rollupOptions: {
      external: ['cloudflare:email'],
    },
  },
});
