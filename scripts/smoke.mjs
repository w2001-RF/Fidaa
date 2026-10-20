// Smoke check: load the game, record errors, capture named states.
// Usage: node scripts/smoke.mjs [url] [outDir] [state1,state2,...]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5188';
const out = process.argv[3] ?? 'artifacts/smoke';
const states = (process.argv[4] ?? 'title,active-play,medina-day,kasbah-night,combat').split(',');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=default', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90000 });
console.log(`boot ${(Date.now() - t0) / 1000}s`);
for (const s of states) {
  await page.evaluate((name) => window.__THREE_GAME_TEST_HOOKS__.setState(name), s);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${s}.png` });
  const d = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  console.log(s, JSON.stringify({ r: d.renderer, g: d.game && { state: d.game.state, hour: Number(d.game.hour).toFixed(1), alert: d.game.alert, hp: d.game.health } }));
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false));
}
// fps sample in active play
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('active-play'));
const f0 = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.frame);
await page.waitForTimeout(3000);
const f1 = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.frame);
console.log(`fps≈${((f1 - f0) / 3).toFixed(1)}`);
console.log(errors.length ? errors.slice(0, 20).join('\n') : 'no console errors');
await browser.close();
