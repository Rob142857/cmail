// Starts cmail for the mobile suite: a production build served by
// `wrangler pages dev`, local-only D1 and R2 under .tmp/e2e-mobile, every real
// migration applied, invented fixtures seeded, and a signed session per test
// user written to .tmp/e2e-mobile/sessions.json for the specs to use.
//
// Nothing here talks to Cloudflare: D1/R2 are Miniflare files on disk, the
// outbound provider is "none" and the email Worker binding is absent, so no
// message can leave the machine. Set E2E_SKIP_BUILD=1 to reuse the last build.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ASSIGNMENTS, INBOX_RULES, MAILBOXES, ORG, USERS, buildMessages } from './seed-data.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = resolve(ROOT, 'apps/web');
const STATE = resolve(ROOT, '.tmp/e2e-mobile');
const PERSIST = resolve(STATE, 'persist');
const PORT = Number(process.env.E2E_PORT || 4321);
// HTTPS like production: the app's CSP sends upgrade-insecure-requests,
// which WebKit applies even to 127.0.0.1, so plain http never finishes loading.
const ORIGIN = `https://127.0.0.1:${PORT}`;
const require = createRequire(import.meta.url);
const packageDir = (name, from) => dirname(require.resolve(`${name}/package.json`, { paths: [from] }));
const WRANGLER = resolve(packageDir('wrangler', ROOT), 'bin/wrangler.js');
const VITE = resolve(packageDir('vite', WEB), 'bin/vite.js');
const posix = (path) => path.replace(/\\/g, '/');

function run(args, cwd, label) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1' } });
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status})`);
}

// 1. Build (the same adapter-cloudflare output that production serves).
if (process.env.E2E_SKIP_BUILD !== '1' || !existsSync(resolve(WEB, '.svelte-kit/cloudflare/_worker.js'))) {
  run([VITE, 'build'], WEB, 'vite build');
}

// 2. Fresh local state and a config that lives only in the ignored state dir.
rmSync(STATE, { recursive: true, force: true });
mkdirSync(PERSIST, { recursive: true });
const VARS = {
  APP_NAME: `${ORG.appName}`,
  MAIL_DOMAIN: `${ORG.domain}`,
  APP_URL: `${ORIGIN}`,
  MICROSOFT_TENANT_ID: `common`,
  ORG_NAME: `${ORG.name}`,
  ORG_SHORT_NAME: `${ORG.shortName}`,
  ORG_URL: `https://www.${ORG.domain}`,
  SUPPORT_EMAIL: `help@${ORG.domain}`,
  POLICY_URL: `${ORIGIN}/policy`,
  REPO_URL: `https://github.com/Rob142857/cmail`,
  SYSTEM_EMAIL: `noreply@${ORG.domain}`,
  SYSTEM_FROM_NAME: `${ORG.shortName} Mail`,
  BRAND_PRIMARY_COLOR: `#0f6cbd`,
  LOCALE: `en-AU`,
  TIME_ZONE: `Australia/Sydney`,
  OUTBOUND_PROVIDER: `none`,
  SESSION_TTL_HOURS: `720`,
  EMAIL_OTP_ENABLED: `true`,
  MCP_SEND_RATE_PER_HOUR: `10`,
};
const D1_ID = '00000000-0000-4000-8000-0000000000e2';
const sessionSecret = randomBytes(32).toString('hex');
writeFileSync(resolve(STATE, 'wrangler.toml'), `name = "cmail-e2e-mobile"
compatibility_date = "2026-08-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "${posix(resolve(WEB, '.svelte-kit/cloudflare'))}"

[[d1_databases]]
binding = "DB"
database_name = "cmail-e2e"
database_id = "${D1_ID}"
migrations_dir = "${posix(resolve(ROOT, 'packages/shared/migrations'))}"

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "cmail-e2e-storage"

[vars]
${Object.entries(VARS).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n')}
`);
// Local-only values. The OAuth pair is a placeholder so the sign-in page shows
// both provider buttons; the suite never follows them.
writeFileSync(resolve(STATE, '.dev.vars'), [
  `SESSION_SECRET=${sessionSecret}`,
  'GOOGLE_CLIENT_ID=e2e-placeholder.apps.googleusercontent.test',
  `GOOGLE_CLIENT_SECRET=${randomBytes(12).toString('hex')}`,
  'MICROSOFT_CLIENT_ID=00000000-0000-4000-8000-00000000e2e0',
  `MICROSOFT_CLIENT_SECRET=${randomBytes(12).toString('hex')}`,
  '',
].join('\n'));

// 3. Real migrations, applied by wrangler to the local D1 file.
run([WRANGLER, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', PERSIST], STATE, 'migrations');

// 4. Seed through Miniflare bindings (fast; same storage wrangler pages dev reads).
const { getPlatformProxy } = await import('wrangler');
const proxy = await getPlatformProxy({ configPath: resolve(STATE, 'wrangler.toml'), persist: { path: resolve(PERSIST, 'v3') } });
const { DB, STORAGE } = proxy.env;

const statements = [];
const sql = (query, ...args) => statements.push(DB.prepare(query).bind(...args));
for (const user of USERS) {
  sql(`INSERT INTO users (id, email, display_name, role, status, auth_provider, last_sign_in) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    user.id, user.email, user.name, user.role, user.status || 'active', user.provider);
}
for (const mailbox of MAILBOXES) {
  sql(`INSERT INTO mailboxes (id, address, type, display_name, status, owner_user_id) VALUES (?, ?, ?, ?, 'active', ?)`,
    mailbox.id, mailbox.address, mailbox.type, mailbox.name, mailbox.owner);
}
for (const [userId, mailboxId, permissions] of ASSIGNMENTS) {
  sql(`INSERT INTO mailbox_assignments (user_id, mailbox_id, permissions, assigned_by) VALUES (?, ?, ?, 'user-mia')`, userId, mailboxId, permissions);
}
sql(`INSERT INTO org_settings (key, value) VALUES ('org_name', ?), ('app_name', ?)`, ORG.name, ORG.appName);
INBOX_RULES.forEach((rule, position) => {
  sql(`INSERT INTO inbox_rules (id, mailbox_id, name, position, is_enabled, stop_processing, definition, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'user-mia')`,
    rule.id, rule.mailboxId, rule.name, position, rule.enabled, rule.stopProcessing, JSON.stringify(rule.definition));
});

const messages = buildMessages();
for (const message of messages) {
  const key = `messages/${message.mb}/${message.id}/body.html`;
  await STORAGE.put(key, message.body, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
  const to = JSON.stringify(message.to.map((r) => r.address));
  sql(`INSERT INTO messages (id, mailbox_id, message_id_header, direction, from_address, from_name, to_addresses, to_participants,
        subject, snippet, body_r2_key, has_attachments, size_bytes, folder, is_read, is_starred, importance, thread_id, received_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    message.id, message.mb, `<${message.id}@fixtures.${ORG.domain}>`, message.direction, message.from, message.fromName,
    to, JSON.stringify(message.to), message.subject, message.snippet, key, message.attachments.length ? 1 : 0,
    message.body.length, message.folder, message.read, message.starred, message.importance, message.thread || message.id,
    message.receivedAt, message.receivedAt);
  for (const attachment of message.attachments) {
    const attachmentKey = `messages/${message.mb}/${message.id}/attachments/${attachment.id}`;
    await STORAGE.put(attachmentKey, `Invented ${attachment.filename} fixture`);
    sql(`INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key, disposition) VALUES (?, ?, ?, ?, ?, ?, 'attachment')`,
      attachment.id, message.id, attachment.filename, attachment.type, attachment.size, attachmentKey);
  }
}

// Sessions: the same token shape and hash as src/lib/server/session.ts.
const sessions = {};
for (const user of USERS.filter((u) => (u.status || 'active') === 'active')) {
  const sessionId = randomUUID();
  const payload = `${sessionId}.${user.id}.${Date.now()}`;
  const token = `${payload}.${createHmac('sha256', sessionSecret).update(payload).digest('hex')}`;
  const hash = createHash('sha256').update(token).digest('hex');
  sql(`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+30 days'))`, sessionId, user.id, hash);
  sessions[user.id] = token;
}

await DB.batch(statements);
await proxy.dispose();
writeFileSync(resolve(STATE, 'sessions.json'), JSON.stringify({ origin: ORIGIN, sessions }, null, 2));
console.log(`[e2e] seeded ${messages.length} invented messages for ${USERS.length} users`);

// 5. Serve the build. Inherit stdio so wrangler's request log shows in failures.
// `wrangler pages dev` does not pick up a config outside the project folder,
// so the bindings and vars from wrangler.toml above are passed explicitly.
const vars = Object.entries(VARS).flatMap(([key, value]) => ['--binding', `${key}=${value}`]);
const server = spawn(process.execPath, [
  WRANGLER, 'pages', 'dev', resolve(WEB, '.svelte-kit/cloudflare'),
  '--ip', '127.0.0.1', '--port', String(PORT), '--local-protocol', 'https', '--persist-to', PERSIST,
  '--compatibility-date', '2026-08-01', '--compatibility-flags', 'nodejs_compat',
  '--d1', `DB=${D1_ID}`, '--r2', 'STORAGE=cmail-e2e-storage', ...vars,
  '--show-interactive-dev-session=false',
], {
  cwd: STATE,
  stdio: 'inherit',
  env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
});
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stop);
server.on('exit', (code) => process.exit(code ?? 0));
