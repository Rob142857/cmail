import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const landingDir = join(root, 'landing');
const indexPath = join(landingDir, 'index.html');
const expectedAssets = [
  'shared-inbox.png',
  'admin-overview.png',
  'mailbox-delegation.png',
  'personal-signature.png',
  'policy-management.png'
];
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function inspectPng(bytes, label) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error(`${label} is not a PNG file`);
  }

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== 1280 || height !== 720) {
    throw new Error(`${label} is ${width} × ${height}; expected 1280 × 720`);
  }
}

function getLiveBaseUrl() {
  const inline = process.argv.find((argument) => argument.startsWith('--url='));
  if (inline) return inline.slice('--url='.length);

  const index = process.argv.indexOf('--url');
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const html = await readFile(indexPath, 'utf8');
const sources = new Map();

for (const asset of expectedAssets) {
  const match = html.match(new RegExp(`src=["'](screenshots/${asset.replace('.', '\\.')}(?:\\?[^"']*)?)["']`));
  if (!match) throw new Error(`landing/index.html does not reference screenshots/${asset}`);

  const bytes = await readFile(join(landingDir, 'screenshots', asset));
  inspectPng(bytes, asset);
  sources.set(asset, match[1]);
}

const liveBaseUrl = getLiveBaseUrl();
if (liveBaseUrl) {
  const base = new URL(liveBaseUrl.endsWith('/') ? liveBaseUrl : `${liveBaseUrl}/`);
  for (const [asset, source] of sources) {
    const url = new URL(source, base);
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);

    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'image/png') {
      throw new Error(`${url} returned ${contentType || 'no content type'}; expected image/png`);
    }

    inspectPng(Buffer.from(await response.arrayBuffer()), `${asset} at ${url}`);
  }
}

console.log(`Verified ${expectedAssets.length} landing screenshots${liveBaseUrl ? ` at ${liveBaseUrl}` : ''}.`);
