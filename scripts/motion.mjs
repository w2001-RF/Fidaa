// Motion evidence: unpaused frame strips of locomotion and melee, composed into one contact sheet.
// Usage: node scripts/motion.mjs [url] [out.png]
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5188';
const outPath = process.argv[3] ?? 'artifacts/pass-1/motion-sheet.png';
mkdirSync('artifacts/pass-1', { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(url);
await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90000 });
await page.click('#btn-start');
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('active-play'));
const clip = { x: 300, y: 130, width: 330, height: 360 };
const rows = [];
async function strip(label, setup, frames = 6, gap = 90, settle = 350) {
  await setup();
  await page.waitForTimeout(settle);
  const shots = [];
  for (let i = 0; i < frames; i += 1) {
    shots.push(PNG.sync.read(await page.screenshot({ clip })));
    await page.waitForTimeout(gap);
  }
  rows.push({ label, shots });
}
// side view so the gait reads: camera looks across the walk direction
const side = () => page.evaluate(() => {
  const h = window.__THREE_GAME_TEST_HOOKS__;
  h.teleport(-104, 58);
  h.lookAt(-104, 48);
});
await strip('walk', async () => { await side(); await page.keyboard.down('KeyD'); });
await page.keyboard.up('KeyD');
await strip('sprint', async () => { await side(); await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyD'); });
await page.keyboard.up('KeyD');
await page.keyboard.up('ShiftLeft');
await strip('sneak', async () => { await side(); await page.keyboard.press('KeyC'); await page.keyboard.down('KeyD'); });
await page.keyboard.up('KeyD');
await page.keyboard.press('KeyC');
const hook = (a, d) => page.evaluate(([x, y]) => window.__THREE_GAME_TEST_HOOKS__.input(x, y), [a, d]);
await strip('slash', async () => { await side(); await page.waitForTimeout(300); await hook('attack', true); await hook('attack', false); }, 6, 60, 0);
await strip('aim-rifle', async () => { await side(); await page.keyboard.press('Digit2'); await hook('aim', true); }, 3, 120);
await hook('aim', false);
await browser.close();

const W = clip.width;
const H = clip.height;
const cols = Math.max(...rows.map((r) => r.shots.length));
const sheet = new PNG({ width: W * cols, height: H * rows.length });
rows.forEach((row, ri) => row.shots.forEach((png, ci) => PNG.bitblt(png, sheet, 0, 0, W, H, ci * W, ri * H)));
writeFileSync(outPath, PNG.sync.write(sheet));
console.log(`wrote ${outPath} rows=${rows.map((r) => r.label).join(',')}`);
