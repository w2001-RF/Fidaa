import { expect, test, type Page } from '@playwright/test';
import { click, press, wait } from './helpers';

// Hunting, skinning, woodcutting and quarrying, driven by real key presses.
// Hooks place the player (teleport) and aim the camera (aimAt stands in for the mouse).

type G = { state: string; inventory: Record<string, number>; interact: string | null; upgrades: string[]; hunts: number; weapons: string[] };
type A = { id: string; species: string; x: number; y: number; z: number; alive: boolean; skinned: boolean };

const game = (p: Page) => p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.game as unknown as G);
const hook = window_hooks();
function window_hooks() {
  return {
    tp: (p: Page, x: number, z: number) => p.evaluate(([a, b]) => window.__THREE_GAME_TEST_HOOKS__?.teleport?.(a, b), [x, z]),
    animals: (p: Page) => p.evaluate(() => (window.__THREE_GAME_TEST_HOOKS__?.animals?.() ?? []) as A[]),
    aim: (p: Page, x: number, y: number, z: number) => p.evaluate(([a, b, c]) => window.__THREE_GAME_TEST_HOOKS__?.aimAt?.(a, b, c), [x, y, z]),
  };
}

async function start(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?test');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90_000 });
  await page.click('#btn-start');
  await wait(page, 100);
}

async function holdE(page: Page, ms: number): Promise<void> {
  await page.keyboard.down('KeyE');
  await wait(page, ms);
  await page.keyboard.up('KeyE');
  await wait(page, 100);
}

test('hunting: shoot a hare, skin it, grill the meat and craft a sling', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 120_000);
  const errors: string[] = [];
  await start(page, errors);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setHour?.(12));
  await press(page, 'Digit2'); // Lebel rifle
  await press(page, 'KeyC'); // crouch: hares notice a crouched hunter only at a few metres

  let killed: A | null = null;
  const hares = (await hook.animals(page)).filter((a) => a.species === 'hare' && a.alive);
  expect(hares.length).toBeGreaterThan(3);
  for (const hare of hares.slice(0, 6)) {
    await hook.tp(page, hare.x + 9, hare.z);
    await wait(page, 200);
    const now = (await hook.animals(page)).find((a) => a.id === hare.id);
    if (!now?.alive) continue;
    await hook.aim(page, now.x, now.y, now.z);
    await wait(page, 60);
    await hook.aim(page, now.x, now.y, now.z);
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.input?.('attack', true));
    await wait(page, 80);
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.input?.('attack', false));
    await wait(page, 300);
    const after = (await hook.animals(page)).find((a) => a.id === hare.id);
    if (after && !after.alive) {
      killed = after;
      break;
    }
    await press(page, 'KeyR');
    await wait(page, 2600);
  }
  expect(killed, 'a hare was shot').not.toBeNull();
  if (!killed) return;
  expect((await game(page)).hunts).toBeGreaterThanOrEqual(1);

  // skin the carcass: hold E
  const before = await game(page);
  await hook.tp(page, killed.x + 0.8, killed.z);
  await wait(page, 700);
  expect((await game(page)).interact).toBe(`carcass-${killed.id}`);
  await holdE(page, 1900);
  let g = await game(page);
  expect(g.inventory.hide).toBe(before.inventory.hide + 1);
  expect(g.inventory.rawMeat).toBeGreaterThan(before.inventory.rawMeat);
  expect((await hook.animals(page)).find((a) => a.id === killed?.id)?.skinned).toBe(true);

  // grill the meat and make a sling from hide and sinew
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.give?.({ wood: 1, sinew: 2 }));
  await press(page, 'KeyK');
  await click(page, page.locator('.recipe', { hasText: 'Grilled meat' }).locator('button'));
  await click(page, page.locator('.recipe', { hasText: "Shepherd's sling" }).locator('button'));
  g = await game(page);
  expect(g.inventory.cookedMeat).toBe(1);
  expect(g.weapons).toContain('sling');
  expect(errors).toEqual([]);
});

test('woodcutting and quarrying: axe and hammer from the bench, then fell and quarry', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 120_000);
  const errors: string[] = [];
  await start(page, errors);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.give?.({ wood: 3, scrap: 5, cloth: 1 }));
  const bench = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.targets?.()['douar-bench']);
  if (!bench) throw new Error('bench');
  await hook.tp(page, bench.x, bench.z);
  await wait(page, 300);
  await press(page, 'KeyE');
  await click(page, page.locator('.recipe', { hasText: "Woodcutter's axe" }).locator('button'));
  await click(page, page.locator('.recipe', { hasText: "Quarryman's hammer" }).locator('button'));
  expect((await game(page)).upgrades).toEqual(expect.arrayContaining(['axe', 'hammer']));
  await press(page, 'KeyK');

  // fell the nearest tree
  const trees = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.harvestables?.('tree') ?? []);
  expect(trees.length).toBeGreaterThan(0);
  let g = await game(page);
  const wood0 = g.inventory.wood;
  await hook.tp(page, trees[0].x + 1.2, trees[0].z);
  await wait(page, 300);
  expect((await game(page)).interact).toBe('harvest');
  await holdE(page, 2600);
  g = await game(page);
  expect(g.inventory.wood).toBeGreaterThan(wood0);
  const after = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.harvestables?.('tree') ?? []);
  expect(after.map((t) => t.id)).not.toContain(trees[0].id);

  // quarry a rock near the old lead mine
  await hook.tp(page, 190, -60);
  await wait(page, 300);
  const rocks = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.harvestables?.('rock') ?? []);
  expect(rocks.length).toBeGreaterThan(0);
  const r = rocks[0];
  await hook.tp(page, r.x + r.scale * 0.8 + 0.9, r.z);
  await wait(page, 300);
  expect((await game(page)).interact).toBe('harvest');
  await holdE(page, 2900);
  g = await game(page);
  expect(g.inventory.stone).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});
