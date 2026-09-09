import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Exercise the exact Sharp instance used by Wrangler's Miniflare, with only
// generated pixels and a local Images binding. No remote services or fixtures.
const require = createRequire(import.meta.url);
const fromWrangler = createRequire(require.resolve('wrangler'));
const miniflarePath = fromWrangler.resolve('miniflare');
const { Miniflare } = fromWrangler('miniflare');
const sharp = createRequire(miniflarePath)('sharp');
assert.equal(sharp.versions.sharp, '0.35.4');

const pixels = { create: { width: 8, height: 6, channels: 4, background: '#336699' } };
const png = await sharp(pixels).png().toBuffer();
const avif = await sharp(png).avif().toBuffer();
for (const input of [png, avif]) {
  const metadata = await sharp(input).metadata();
  assert.equal(metadata.width, 8);
  assert.equal(metadata.height, 6);
  const resized = await sharp(input).resize(4, 3).png().toBuffer({ resolveWithObject: true });
  assert.equal(resized.info.width, 4);
  assert.equal(resized.info.height, 3);
}

const mf = new Miniflare({
  modules: true,
  compatibilityDate: '2026-08-01',
  images: { binding: 'IMAGES' },
  script: `export default { async fetch(request, env) {
    const output = await env.IMAGES.input(request.body)
      .transform({ width: 4, height: 3 }).output({ format: 'image/png' });
    return output.response();
  } };`,
});
try {
  for (const input of [png, avif]) {
    const response = await mf.dispatchFetch('http://localhost/image', { method: 'POST', body: input });
    assert.equal(response.status, 200);
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(metadata.width, 4);
    assert.equal(metadata.height, 3);
  }
} finally {
  await mf.dispose();
}
console.log('Sharp 0.35.4 PNG/AVIF and local Miniflare Images transforms passed.');
