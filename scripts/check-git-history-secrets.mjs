import { execFileSync, spawnSync } from 'node:child_process';

const objectLines = execFileSync('git', ['rev-list', '--objects', '--all'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

const entries = objectLines.map((line) => {
  const separator = line.indexOf(' ');
  return separator === -1
    ? { objectId: line, path: '' }
    : { objectId: line.slice(0, separator), path: line.slice(separator + 1).replaceAll('\\', '/') };
});

const uniqueObjectIds = [...new Set(entries.map((entry) => entry.objectId))];
const typeCheck = spawnSync(
  'git',
  ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
  { input: `${uniqueObjectIds.join('\n')}\n`, encoding: 'utf8' },
);
if (typeCheck.status !== 0) {
  console.error('Git history scan could not inspect repository objects.');
  process.exit(2);
}

const objectMetadata = new Map(
  typeCheck.stdout.trim().split(/\r?\n/).map((line) => {
    const [objectId, type, size] = line.split(' ');
    return [objectId, { type, size: Number(size) }];
  }),
);

const forbiddenPath = /(^|\/)(?:\.dev\.vars(?:\..+)?|\.env(?:\..+)?|wrangler\.toml)$/i;
const allowedTemplate = /(?:\.example|\.sample|\.template)$/i;
const skipContent = /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/i;
const tokenPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
  ['Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/],
  ['Resend API key', /\bre_[A-Za-z0-9]{20,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['credential-bearing URL', /\bhttps?:\/\/[^\s/:]+:[^\s/@]+@[^\s]+/],
];
const assignment = /^[ \t]*(SESSION_SECRET|BOOTSTRAP_ADMIN_TOKEN|GOOGLE_CLIENT_SECRET|MICROSOFT_CLIENT_SECRET|RESEND_API_KEY|POSTMARK_API_KEY|CLOUDFLARE_API_TOKEN|VAPID_PRIVATE_KEY|INBOUND_SENDER_HASH_KEY)[ \t]*=[ \t]*(.*?)[ \t]*\r?$/gmi;
const placeholder = /^(?:$|<[^>]+>|YOUR[_ -]|REPLACE[_ -]|CHANGE[_ -]|EXAMPLE[_ -]|\$\{|\$\()/i;
const findings = new Set();

for (const entry of entries) {
  if (!entry.path) continue;
  const metadata = objectMetadata.get(entry.objectId);
  if (!metadata || metadata.type !== 'blob') continue;

  if (forbiddenPath.test(entry.path) && !allowedTemplate.test(entry.path)) {
    findings.add(`${entry.path}: sensitive configuration file exists in reachable Git history`);
  }
  if (skipContent.test(entry.path) || metadata.size > 2_000_000) continue;

  let content;
  try {
    content = execFileSync('git', ['cat-file', 'blob', entry.objectId], {
      encoding: 'utf8',
      maxBuffer: 2_100_000,
    });
  } catch {
    continue;
  }
  if (content.includes('\0')) continue;

  for (const [label, pattern] of tokenPatterns) {
    if (pattern.test(content)) findings.add(`${entry.path}: possible ${label} in reachable Git history`);
  }
  for (const match of content.matchAll(assignment)) {
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (!placeholder.test(value)) {
      findings.add(`${entry.path}: non-placeholder ${match[1]} assignment in reachable Git history`);
    }
  }
}

if (findings.size > 0) {
  console.error('Git history secret scan failed (values are intentionally not printed):');
  for (const finding of findings) console.error(`- ${finding}`);
  console.error('Rotate exposed credentials before rewriting history, then rerun this check before publishing.');
  process.exit(1);
}

console.log(`Git history secret scan passed (${entries.length} reachable objects inspected).`);
