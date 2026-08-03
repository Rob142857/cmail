import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const forbiddenPath = /(^|\/)(?:\.dev\.vars(?:\..+)?|\.env(?:\..+)?|wrangler\.toml)$/i;
const allowedTemplate = /(?:\.example|\.sample|\.template)$/i;
const skipContent = /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/i;
const findings = [];

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

for (const file of tracked) {
  const normalized = file.replaceAll('\\', '/');
  if (!existsSync(path.resolve(file))) continue;
  if (forbiddenPath.test(normalized) && !allowedTemplate.test(normalized)) {
    findings.push(`${file}: sensitive configuration filename must not be tracked`);
  }
  if (skipContent.test(normalized)) continue;

  let content;
  try {
    content = readFileSync(path.resolve(file), 'utf8');
  } catch {
    continue;
  }
  if (content.includes('\0')) continue;

  for (const [label, pattern] of tokenPatterns) {
    if (pattern.test(content)) findings.push(`${file}: possible ${label}`);
  }

  for (const match of content.matchAll(assignment)) {
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (!placeholder.test(value)) findings.push(`${file}: non-placeholder ${match[1]} assignment`);
  }
}

if (findings.length > 0) {
  console.error('Secret scan failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Secret scan passed (${tracked.length} tracked or untracked source files checked).`);
