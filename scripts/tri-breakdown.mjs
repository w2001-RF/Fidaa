// Dev helper: triangle breakdown of visible meshes for a given state.
import { chromium } from '@playwright/test';
const state = process.argv[2] ?? 'active-play';
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:5188');
await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.evaluate((s) => window.__THREE_GAME_TEST_HOOKS__.setState(s), state);
await page.waitForTimeout(1500);
const rows = await page.evaluate(() => {
  const scene = window.__GAME_SCENE__;
  const out = {};
  scene.traverseVisible((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const g = o.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    let key = o.name || o.type;
    key = key.replace(/-\-?\d+:\-?\d+$/, '').replace(/^veg-(\w+).*/, 'veg-$1');
    if (o.isSkinnedMesh) key = 'character';
    out[key] = out[key] || { tris: 0, meshes: 0, shadow: 0 };
    out[key].tris += tris * n;
    out[key].meshes += 1;
    if (o.castShadow) out[key].shadow += tris * n;
  });
  return Object.entries(out).sort((a, b) => b[1].tris - a[1].tris).slice(0, 16);
});
for (const [k, v] of rows) console.log(k.padEnd(28), String(Math.round(v.tris)).padStart(9), 'meshes', v.meshes, 'shadowTris', Math.round(v.shadow));
await browser.close();
