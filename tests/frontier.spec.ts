import { expect, test, type Page } from '@playwright/test';
import { press, wait } from './helpers';

// The lands beyond the valley: generated from the world seed and streamed in
// chunks around the player, with resources, villages and places to find.
// Real keys drive walking and using things; hooks place the player and read state.

type G = { inventory: Record<string, number>; discovered: string[]; interact: string | null; thirst: number };
const pos = (p: Page) => p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.player.position);
const game = (p: Page) => p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.game as unknown as G);
const tp = (p: Page, x: number, z: number) => p.evaluate(([a, b]) => window.__THREE_GAME_TEST_HOOKS__?.teleport?.(a, b), [x, z]);
const look = (p: Page, x: number, z: number) => p.evaluate(([a, b]) => window.__THREE_GAME_TEST_HOOKS__?.lookAt?.(a, b), [x, z]);
const lands = (p: Page) => p.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.frontier!());
const ground = (p: Page, x: number, z: number) => p.evaluate(([a, b]) => window.__THREE_GAME_TEST_HOOKS__!.ground!(a, b), [x, z]);
const targets = (p: Page) => p.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.targets?.() ?? {});
/** the three passes, as in Lands.ts */
const PASSES = [
  [0.08, 1],
  [0.966, 0.259],
  [-0.8, -0.6],
].map(([x, z]) => [x / Math.hypot(x, z), z / Math.hypot(x, z)]);

async function boot(page: Page, errors: string[], url = '/?test'): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90_000 });
}

async function start(page: Page): Promise<void> {
  await page.click('#btn-start');
  await wait(page, 100);
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__?.setHour?.(11);
    window.__THREE_GAME_TEST_HOOKS__?.ceasefire?.(true);
  });
}

/** Go somewhere and wait until every chunk around it has streamed in. */
async function goTo(page: Page, x: number, z: number): Promise<void> {
  await tp(page, x, z);
  for (let i = 0; i < 120; i += 1) {
    await wait(page, 200);
    if ((await lands(page)).pending === 0) return;
  }
  throw new Error('lands never settled');
}

/** Walk up to an interactable (by id) and use it with E. */
async function use(page: Page, id: string, hold = 1200): Promise<void> {
  const t = (await targets(page))[id];
  expect(t, `${id} is there`).toBeTruthy();
  await tp(page, t.x + 0.9, t.z + 0.6);
  await wait(page, 300);
  expect((await game(page)).interact, `facing ${id}`).toBe(id);
  await page.keyboard.down('KeyE');
  await wait(page, hold);
  await page.keyboard.up('KeyE');
  await wait(page, 150);
}

test('the mountain ring opens at three passes onto lands generated as you go', async ({ page }) => {
  test.setTimeout(process.env.CI ? 400_000 : 180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page);
  expect((await lands(page)).seed, 'the test world').toBe(1945);

  // each pass is a walkable col; between them the ring stands high
  for (const [dx, dz] of PASSES) {
    let worst = 0;
    let prev = await ground(page, dx * 150, dz * 150);
    for (let s = 155; s <= 560; s += 5) {
      const h = await ground(page, dx * s, dz * s);
      worst = Math.max(worst, Math.abs(h - prev) / 5);
      prev = h;
    }
    expect(worst, `pass towards ${dx.toFixed(2)},${dz.toFixed(2)}: no climb steeper than ~42°`).toBeLessThan(0.9);
    const a = Math.atan2(dz, dx) + 0.5;
    expect(await ground(page, Math.cos(a) * 300, Math.sin(a) * 300), 'the ring beside it').toBeGreaterThan(40);
  }
  // valley and streamed ground meet without a step
  for (const z of [-300, -12.3, 0, 47.9, 300]) {
    expect(Math.abs((await ground(page, 319.99, z)) - (await ground(page, 320.01, z))), `seam at x=320, z=${z}`).toBeLessThan(0.05);
  }

  // walk out of the north pass on foot
  const [nx, nz] = PASSES[0];
  await goTo(page, nx * 240, nz * 240);
  await look(page, nx * 600, nz * 600);
  await wait(page, 200);
  const a = await pos(page);
  await page.keyboard.down('KeyW');
  await wait(page, 3500);
  await page.keyboard.up('KeyW');
  const b = await pos(page);
  expect((b.x - a.x) * nx + (b.z - a.z) * nz, 'walked on through the pass').toBeGreaterThan(8);

  // out in the lands: chunks with their trees, rocks, deadwood and herbs
  await goTo(page, nx * 560, nz * 560);
  const s = await lands(page);
  expect(s.live, 'chunks around the player').toBeGreaterThan(10);
  expect(s.horizon, 'coarse horizon beyond them').toBeGreaterThan(s.live);
  expect(s.trees + s.rocks, 'trees and rocks to fell and quarry').toBeGreaterThan(20);
  expect((s.resources.wood ?? 0) + (s.resources.herb ?? 0), 'deadwood and herbs to gather').toBeGreaterThan(3);
  const p = await pos(page);
  expect(Math.abs(p.y - (await ground(page, p.x, p.z))), 'standing on the streamed ground').toBeLessThan(0.3);

  // gather deadwood
  const wood = Object.keys(await targets(page)).find((id) => id.startsWith('f:wood:'));
  expect(wood, 'a pile of deadwood nearby').toBeTruthy();
  const w0 = (await game(page)).inventory.wood;
  await use(page, wood as string);
  expect((await game(page)).inventory.wood, 'gathered wood').toBeGreaterThan(w0);

  // the region map shows the lands found so far
  await press(page, 'KeyM');
  await expect(page.locator('#map-screen')).toBeVisible();
  await expect(page.locator('#map-mode')).toHaveText(/valley/i);
  await press(page, 'KeyM');
  expect(errors).toEqual([]);
});

test('villages and places out in the lands: found, used, and remembered in the save', async ({ page }) => {
  test.setTimeout(process.env.CI ? 400_000 : 180_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page);
  const sites = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.sites?.(0, 0, 1500) ?? []);
  expect(new Set(sites.map((s) => s.kind)).size, 'several kinds of place').toBeGreaterThanOrEqual(4);
  const village = sites.filter((s) => s.kind === 'village').sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
  expect(village, 'a village somewhere').toBeTruthy();

  // arriving discovers it
  await goTo(page, village.x + 22, village.z + 22);
  await wait(page, 700);
  expect((await game(page)).discovered, 'found the village').toContain(village.id);
  await expect(page.locator('#banner')).toContainText(village.name);
  expect((await lands(page)).sites.map((s) => s.id), 'built when near').toContain(village.id);

  // the well, the storage jars, the grocer
  const water0 = (await game(page)).inventory.water;
  await use(page, `${village.id}:well`);
  expect((await game(page)).inventory.water, 'filled the water skin').toBeGreaterThanOrEqual(water0);
  expect((await game(page)).thirst).toBeGreaterThan(99);
  const inv0 = await game(page);
  await use(page, `${village.id}:jar0`, 900);
  const inv1 = await game(page);
  expect(Object.keys(inv1.inventory).some((k) => inv1.inventory[k] > inv0.inventory[k]), 'found something in the jars').toBe(true);
  const grocer = Object.keys(await targets(page)).find((id) => id.startsWith('trade-frontier-trader-'));
  expect(grocer, 'a grocer keeps a stall').toBeTruthy();
  await use(page, grocer as string, 200);
  await expect(page.locator('#tab-trade')).toBeVisible();
  await press(page, 'Escape');

  const before = await lands(page);
  expect(await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.save?.())).toBe('indexeddb');

  // after a reload Continue brings back the same world, the village found, the jar searched
  await page.reload();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90_000 });
  await page.click('#btn-continue-save');
  await wait(page, 200);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.ceasefire?.(true));
  for (let i = 0; i < 120 && (await lands(page)).pending > 0; i += 1) await wait(page, 200);
  await wait(page, 400);
  const after = await lands(page);
  expect(after.seed).toBe(before.seed);
  expect((await game(page)).discovered).toContain(village.id);
  const t = await targets(page);
  expect(t[`${village.id}:well`], 'the village is back').toBeTruthy();
  const jar = t[`${village.id}:jar0`];
  await tp(page, jar.x + 0.9, jar.z + 0.6);
  await wait(page, 300);
  expect((await game(page)).interact, 'the searched jar stays searched').not.toBe(`${village.id}:jar0`);
  expect(errors).toEqual([]);
});

test('every new game draws new lands; the valley never changes', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await start(page);
  const probe = async () =>
    page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__!;
      return {
        sites: (h.sites?.(0, 0, 1400) ?? []).map((s) => `${s.kind}@${Math.round(s.x)},${Math.round(s.z)}`).sort(),
        outland: [h.ground!(0, 700), h.ground!(900, -300), h.ground!(-640, -640)],
        valley: [h.ground!(0, 0), h.ground!(-140, 110), h.ground!(128, 112), h.ground!(200, -60)],
      };
    });
  const a = await probe();
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.newWorld?.(777));
  const b = await probe();
  expect(b.valley, 'the valley is the same in every world').toEqual(a.valley);
  expect(b.sites, 'other places').not.toEqual(a.sites);
  expect(b.outland, 'other ground').not.toEqual(a.outland);
  // the same seed makes the same lands
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.newWorld?.(1945));
  expect(await probe()).toEqual(a);
  // and they stream in around the player like the first
  await goTo(page, 900, -300);
  expect((await lands(page)).live).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
