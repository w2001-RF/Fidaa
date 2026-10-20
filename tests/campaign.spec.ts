import { expect, test, type Page } from '@playwright/test';

// Completability: the whole mission chain can be finished. Teleport skips the
// long walks; every objective is still performed with real key presses.

type G = { state: string; mission: string; step: number; inventory: Record<string, number>; dead: boolean };
type T = { x: number; z: number; yaw?: number; alive?: number };
const game = (p: Page) => p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.game as unknown as G);
const target = (p: Page, id: string) => p.evaluate((i) => window.__THREE_GAME_TEST_HOOKS__?.targets?.()[i] as T | undefined, id);
const tp = (p: Page, x: number, z: number) => p.evaluate(([a, b]) => window.__THREE_GAME_TEST_HOOKS__?.teleport?.(a, b), [x, z]);

async function holdE(p: Page, ms: number) {
  await p.keyboard.down('KeyE');
  await p.waitForTimeout(ms);
  await p.keyboard.up('KeyE');
  await p.waitForTimeout(200);
}
async function talk(p: Page, npc: string) {
  const t = await target(p, `npc:${npc}`);
  if (!t) throw new Error(npc);
  await tp(p, t.x + 1.2, t.z + 0.6);
  await p.waitForTimeout(250);
  await p.keyboard.press('KeyE');
  for (let i = 0; i < 6; i += 1) {
    await p.waitForTimeout(220);
    if ((await game(p)).state !== 'dialogue') break;
    await p.keyboard.press('KeyE');
  }
}
async function doAt(p: Page, id: string, ms: number) {
  const t = await target(p, id);
  if (!t) throw new Error(id);
  await tp(p, t.x, t.z);
  await p.waitForTimeout(250);
  await holdE(p, ms);
}

test('campaign: all five missions can be completed to victory', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10, null, { timeout: 60_000 });
  await page.click('#btn-start');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setHour?.(23));
  await page.keyboard.press('KeyC'); // sneak

  // 1 Bread and Water
  await talk(page, 'zahra');
  await doAt(page, 'douar-well', 1100);
  await doAt(page, 'douar-oven', 900);
  await talk(page, 'zahra');
  expect((await game(page)).mission).toBe('leaflets');
  // 2 Words of Freedom
  await talk(page, 'lahcen');
  for (const id of ['leaflet-plaza', 'leaflet-souk', 'leaflet-north']) await doAt(page, id, 1900);
  expect((await game(page)).step).toBe(2);
  await talk(page, 'lahcen');
  expect((await game(page)).mission).toBe('wires');
  // 3 Cut the Wires
  await talk(page, 'lahcen');
  for (const id of ['pole-1', 'pole-2', 'pole-3', 'pole-4']) await doAt(page, id, 2500);
  expect((await game(page)).step).toBe(2);
  await talk(page, 'lahcen');
  expect((await game(page)).mission).toBe('prison');
  // 4 The Caïd's Prison: silent takedown on the Khalifa, search him, open the cell
  await talk(page, 'zahra');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setHour?.(23));
  const k = await target(page, 'enemy:k-khalifa');
  if (!k || k.yaw === undefined) throw new Error('khalifa');
  await tp(page, k.x - Math.sin(k.yaw) * 1.3, k.z - Math.cos(k.yaw) * 1.3);
  await page.waitForTimeout(120);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(500);
  expect((await target(page, 'enemy:k-khalifa'))?.alive).toBe(0);
  await doAt(page, 'body-k-khalifa', 1100);
  expect((await game(page)).inventory.key).toBe(1);
  await doAt(page, 'prison-door', 1500);
  expect((await game(page)).step).toBe(3);
  await talk(page, 'zahra');
  expect((await game(page)).mission).toBe('cache');
  // 5 Guns for the Mountains
  await talk(page, 'lahcen');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setHour?.(23));
  await doAt(page, 'arms-cache', 2800);
  expect((await game(page)).step).toBe(2);
  const h = await target(page, 'hideout');
  if (!h) throw new Error('hideout');
  await tp(page, h.x + 12, h.z + 4);
  await expect(page.locator('#victory-screen')).toBeVisible({ timeout: 8000 });
  expect((await game(page)).mission).toBe('done');
  expect(errors).toEqual([]);
});
