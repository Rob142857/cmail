#!/usr/bin/env node
// Bootstraps wrangler.toml files from .example templates if they don't exist.
// Run after `pnpm install` so local dev works without leaking tenant IDs.
import { existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const targets = [
  ['apps/web/wrangler.toml.example', 'apps/web/wrangler.toml'],
  ['apps/email-worker/wrangler.toml.example', 'apps/email-worker/wrangler.toml'],
];

let created = 0;
for (const [src, dst] of targets) {
  const srcPath = resolve(root, src);
  const dstPath = resolve(root, dst);
  if (!existsSync(srcPath)) {
    console.warn(`! missing template: ${src}`);
    continue;
  }
  if (existsSync(dstPath)) {
    console.log(`  exists:  ${dst}`);
    continue;
  }
  copyFileSync(srcPath, dstPath);
  console.log(`  created: ${dst}`);
  created++;
}

if (created > 0) {
  console.log('\nNext steps:');
  console.log('  1. pnpm d1:create     (then paste database_id into both wrangler.toml files)');
  console.log('  2. pnpm r2:create');
  console.log('  3. Edit [vars] in apps/web/wrangler.toml (APP_NAME, MAIL_DOMAIN, APP_URL)');
  console.log('  4. Set secrets via: wrangler pages secret put <NAME> --project-name cmail-web');
  console.log('     Required: SESSION_SECRET, plus one OAuth provider, plus optional BOOTSTRAP_ADMIN_EMAIL');
}
