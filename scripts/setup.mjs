#!/usr/bin/env node
// Bootstraps wrangler.toml files from .example templates if they don't exist.
// Run after `pnpm install` so local dev works without leaking tenant IDs.
import { randomBytes } from 'node:crypto';
import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const targets = [
  ['apps/web/wrangler.toml.example', 'apps/web/wrangler.toml'],
  ['apps/email-worker/wrangler.toml.example', 'apps/email-worker/wrangler.toml'],
  ['.env.example', 'apps/web/.dev.vars'],
  ['apps/email-worker/.dev.vars.example', 'apps/email-worker/.dev.vars'],
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

// Sender limiting is enabled by default, so local inbound delivery must have
// a valid HMAC key on first run. Generate it without ever printing the secret.
const workerDevVarsPath = resolve(root, 'apps/email-worker/.dev.vars');
if (existsSync(workerDevVarsPath)) {
  const current = readFileSync(workerDevVarsPath, 'utf8');
  if (/^INBOUND_SENDER_HASH_KEY=\s*$/m.test(current)) {
    const updated = current.replace(
      /^INBOUND_SENDER_HASH_KEY=\s*$/m,
      `INBOUND_SENDER_HASH_KEY=${randomBytes(32).toString('base64url')}`,
    );
    writeFileSync(workerDevVarsPath, updated, { encoding: 'utf8', mode: 0o600 });
    console.log('  generated: apps/email-worker/.dev.vars sender-HMAC key');
  }
}

if (created > 0) {
  console.log('\nNext steps:');
  console.log('  1. Run pnpm d1:create and pnpm r2:create');
  console.log('  2. Paste the D1 database ID into both local wrangler.toml files');
  console.log('     These ignored Wrangler files are the local deployment manifests used by pnpm deploy.');
  console.log('     Keep them out of Git and in secure, environment-specific operator storage; never copy them between accounts.');
  console.log('  3. Replace all six email-Worker rate-limit namespace_id placeholders with unique positive IDs');
  console.log('     (three production and three preview IDs; do not reuse an ID across environments).');
  console.log('  4. Edit public [vars] and development-only values, then run pnpm db:migrate');
  console.log('  5. Create production Pages first: pnpm exec wrangler pages project create cmail-web --production-branch main');
  console.log('  6. Set production secrets via: pnpm exec wrangler pages secret put <NAME> --project-name cmail-web');
  console.log('     Required: SESSION_SECRET, plus one OAuth provider');
  console.log('     First run only: BOOTSTRAP_ADMIN_EMAIL and a distinct strong BOOTSTRAP_ADMIN_TOKEN');
  console.log('     Delete both bootstrap values immediately after the first manager enrols');
  console.log('  7. Set production Worker secret INBOUND_SENDER_HASH_KEY (local setup generated a development key)');
}
