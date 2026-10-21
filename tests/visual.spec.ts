import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { wait } from './helpers';

async function canvasVariety(page: import('@playwright/test').Page): Promise<{ variance: number; buckets: number }> {
  const png = PNG.sync.read(await page.locator('#game-canvas').screenshot());
  let min = 255;
  let max = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));
  for (let p = 0; p < png.width * png.height; p += stride) {
    const o = p * 4;
    const r = png.data[o];
    const g = png.data[o + 1];
    const b = png.data[o + 2];
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
  }
  return { variance: max - min, buckets: buckets.size };
}

test('title → begin → the fidāʾī walks through the douar', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10, null, { timeout: 60_000 });
  await expect(page.locator('#title-screen')).toBeVisible();
  await page.click('#btn-start');
  await wait(page, 100);
  await expect(page.locator('#hud')).toBeVisible();

  const v = await canvasVariety(page);
  expect(v.variance).toBeGreaterThan(40);
  expect(v.buckets).toBeGreaterThan(20);

  const pos = () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position ?? { x: 0, y: 0, z: 0 });
  const before = await pos();
  await page.keyboard.down('KeyW');
  await wait(page, 900);
  await page.keyboard.up('KeyW');
  const after = await pos();
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1.5);

  await testInfo.attach('douar', { body: await page.screenshot(), contentType: 'image/png' });
  expect(errors).toEqual([]);
});
