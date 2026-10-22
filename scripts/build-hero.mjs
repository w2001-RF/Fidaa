// Turn Tripo's rigged fidāʾī + retargeted FBX clips into the game's hero model.
//
// Usage (with the dev server running on 5188):
//   npx @gltf-transform/cli optimize <rig.glb> public/assets/characters/src/fidai-simple.glb \
//     --compress false --texture-compress false --simplify-ratio 0.0085 --simplify-error 0.02
//   node scripts/build-hero.mjs <simplified.glb under public/> <name=fbx under public/>...
//
// Writes public/assets/characters/fidai/fidai.glb (mesh, skin, 1024 px textures,
// the clips) and prints what it found: triangles, bones, clip tracks that did not
// bind (should be none).
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const [model, ...anims] = process.argv.slice(2);
if (!model || anims.length === 0) {
  console.error('usage: node scripts/build-hero.mjs <model.glb> idle=<idle.fbx> walk=<walk.fbx>');
  process.exit(1);
}
const base = process.env.BASE ?? 'http://127.0.0.1:5188';
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error(e.message));
await page.goto(`${base}/scripts/hero-build.html?model=/${model}&anims=${anims.map((a) => a.replace(/=(.*)$/, '=/$1')).join(',')}`);
await page.waitForFunction(() => window.heroResult, null, { timeout: 600_000 });
const res = await page.evaluate(() => window.heroResult);
await browser.close();
if (res.error) {
  console.error(res.error);
  process.exit(1);
}
mkdirSync('public/assets/characters/fidai', { recursive: true });
const buf = Buffer.from(res.glb, 'base64');
writeFileSync('public/assets/characters/fidai/fidai.glb', buf);
const r = res.report;
console.log(`fidai.glb ${(buf.length / 1048576).toFixed(2)} MB, ${r.triangles} triangles, ${r.bones.length} nodes, height ${r.height.toFixed(3)}, size ${r.size.map((v) => v.toFixed(2)).join(' x ')}`);
for (const c of r.clips) console.log(`clip ${c.name}: ${c.duration.toFixed(2)} s, ${c.tracks} tracks (${c.dropped} dropped), root ${c.root ?? '-'}, unbound ${c.missing.length ? c.missing.join(' ') : 'none'}`);
console.log(`bones: ${r.bones.join(' ')}`);
