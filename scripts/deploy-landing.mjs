#!/usr/bin/env node
// Deploy the static product page in landing/ to a Cloudflare Pages project.
// The project name is required, so a stray wrangler.toml in the checkout can never
// redirect the deploy to another project (for example a live cmail web app).
//
//   pnpm deploy:landing --project-name <PAGES_PROJECT> [--branch <PRODUCTION_BRANCH>]
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2).filter((a) => a !== '--');
const value = (flag) => {
  const i = args.indexOf(flag);
  if (i !== -1) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
};

const project = value('--project-name');
const branch = value('--branch');
if (!project || project.startsWith('--')) {
  console.error('deploy:landing: --project-name <PAGES_PROJECT> is required (refusing to guess from wrangler.toml).');
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9-]{0,57}$/.test(project)) {
  console.error(`deploy:landing: "${project}" is not a valid Pages project name.`);
  process.exit(2);
}

const run = (cmd, cmdArgs) => {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('node', ['scripts/verify-landing-assets.mjs']);
const deployArgs = ['wrangler', 'pages', 'deploy', 'landing', '--project-name', project];
if (branch) deployArgs.push('--branch', branch);
console.log(`deploy:landing: deploying landing/ to Pages project "${project}"${branch ? ` (branch ${branch})` : ''}`);
run('pnpm', ['exec', ...deployArgs]);
