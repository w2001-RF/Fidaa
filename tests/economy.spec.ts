import { expect, test, type Page } from '@playwright/test';
import { click, press, wait } from './helpers';

// Bolts you can fetch back, the souk's traders, and a camp of your own. Real
// keys and clicks drive everything; hooks only place the player and read state.

type G = { inventory: Record<string, number>; weapons: string[]; upgrades: string[]; interact: string | null };
const game = (p: Page) => p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.game as unknown as G);
const tp = (p: Page, x: number, z: number) => p.evaluate(([a, b]) => window.__THREE_GAME_TEST_HOOKS__?.teleport?.(a, b), [x, z]);
const look = (p: Page, x: number, z: number) => p.evaluate(([a, b]) => window.__THREE_GAME_TEST_HOOKS__?.lookAt?.(a, b), [x, z]);
/** a recipe's button, found by its title (other cards mention ovens and benches in their hints) */
const recipe = (p: Page, title: string) => p.locator('.recipe').filter({ has: p.locator('h5', { hasText: title }) }).locator('button');

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?test');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90_000 });
  await page.click('#btn-start');
  await wait(page, 100);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setHour?.(12));
}

const shooters = [
  { weapon: 'crossbow', key: 'Digit8', ammo: 'bolt', hook: 'bolts' },
  { weapon: 'bow', key: 'Digit9', ammo: 'arrow', hook: 'arrows' },
] as const;

for (const s of shooters) {
  test(`${s.weapon}: the ${s.ammo}s can be picked up again after the shot`, async ({ page }) => {
    test.setTimeout(process.env.CI ? 300_000 : 120_000);
    const errors: string[] = [];
    await boot(page, errors);
    // open ground on the douar strip; shoot into the dirt a few metres ahead
    await tp(page, -70, 118);
    await page.evaluate(([w, a]) => {
      const h = window.__THREE_GAME_TEST_HOOKS__;
      h?.ceasefire?.(true);
      h?.grantWeapon?.(w);
      h?.give?.({ [a]: 4 });
    }, [s.weapon, s.ammo]);
    await press(page, s.key);
    await wait(page, 200);
    expect((await game(page) as G & { weapon: string }).weapon).toBe(s.weapon);
    const pos = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.player.position);
    const lyingNow = () => page.evaluate((hook) => window.__THREE_GAME_TEST_HOOKS__?.[hook]?.() ?? [], s.hook);
    for (let shot = 0; shot < 3; shot += 1) {
      await page.evaluate(([x, y, z]) => window.__THREE_GAME_TEST_HOOKS__?.aimAt?.(x, y, z), [pos.x + 7 + shot, pos.y, pos.z + 1]);
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.input?.('attack', true));
      await wait(page, 80);
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.input?.('attack', false));
      await press(page, 'KeyR');
      await wait(page, 2300);
    }
    const lying = await lyingNow();
    expect(lying.length, `${s.ammo}s lie where they struck (one in six may snap)`).toBeGreaterThan(0);
    const before = (await game(page)).inventory[s.ammo];
    for (const b of lying) {
      await tp(page, b.x, b.z);
      await wait(page, 250);
    }
    const after = (await game(page)).inventory[s.ammo];
    expect(after - before, 'walked over them and picked them up').toBe(lying.length);
    expect((await lyingNow()).length).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('trade: sell skins and ore in the souk, buy bread, a tool and a gun', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 120_000);
  const errors: string[] = [];
  await boot(page, errors);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.give?.({ hide: 6, ore: 4, francs: 700 }));
  const targets = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.targets?.() ?? {});
  // merchant-0 deals under the counter too
  const m = targets['trade-merchant-0'];
  expect(m, 'a smuggler keeps a stall in the souk').toBeTruthy();
  const street = 10; // the souk street runs east-west through the medina centre
  await tp(page, m.x, m.z + Math.sign(street - m.z) * 1.9);
  await wait(page, 300);
  expect((await game(page)).interact).toBe('trade-merchant-0');
  await press(page, 'KeyE');
  await expect(page.locator('#tab-trade')).toBeVisible();
  await expect(page.locator('.tab[data-tab="trade"]')).toBeVisible();

  const g0 = await game(page);
  // sell all the hides, one ore
  await click(page, page.locator('#tab-trade .ware[data-ware="hide"] .sell-all'));
  await click(page, page.locator('#tab-trade .ware[data-ware="ore"] .sell'));
  let g = await game(page);
  expect(g.inventory.hide).toBe(0);
  expect(g.inventory.ore).toBe(g0.inventory.ore - 1);
  expect(g.inventory.francs, 'paid for the goods').toBeGreaterThan(g0.inventory.francs + 6 * 14);
  // buy bread, the woodcutter's axe, the crossbow
  const f1 = g.inventory.francs;
  await click(page, page.locator('#tab-trade .ware[data-ware="bread"] .buy'));
  await click(page, page.locator('#tab-trade .ware[data-ware="axe"] .buy'));
  await click(page, page.locator('#tab-trade .ware[data-ware="crossbow"] .buy'));
  g = await game(page);
  expect(g.inventory.bread).toBe(g0.inventory.bread + 1);
  expect(g.upgrades).toContain('axe');
  expect(g.weapons).toContain('crossbow');
  expect(g.inventory.francs).toBeLessThan(f1 - 700);
  // can't afford a pistol now
  await expect(page.locator('#tab-trade .ware[data-ware="pistol"] .buy')).toBeDisabled();
  await press(page, 'Escape');
  await expect(page.locator('#panel')).toBeHidden();
  expect(errors).toEqual([]);
});

test('camp: build a fire, an oven, a workbench and a tent; cook and sleep there', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 150_000);
  const errors: string[] = [];
  await boot(page, errors);
  await page.evaluate(() =>
    window.__THREE_GAME_TEST_HOOKS__?.give?.({ wood: 20, stone: 12, cloth: 8, scrap: 4, hide: 3, rawMeat: 3, herbs: 3, water: 2, flour: 2 }),
  );
  // four pitches on the flat douar strip, each facing north
  const pitches: [string, number][] = [['Campfire', -80], ['Clay oven', -70], ['Camp workbench', -60], ['Khaima', -48]];
  for (const [name, x] of pitches) {
    await tp(page, x, 118);
    await look(page, x, 130);
    await wait(page, 200);
    await press(page, 'KeyK');
    await click(page, recipe(page, name));
    await press(page, 'KeyK');
  }
  const camp = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.camp?.() ?? []);
  expect(camp.map((c) => c.kind).sort()).toEqual(['bench', 'fire', 'oven', 'tent']);

  // the oven: E opens the cook book there; a tagine, then bread
  const oven = camp.find((c) => c.kind === 'oven')!;
  await tp(page, oven.ix, oven.iz);
  await wait(page, 300);
  await press(page, 'KeyE');
  await expect(page.locator('#tab-craft')).toBeVisible();
  await click(page, recipe(page, 'Meat tagine'));
  await click(page, recipe(page, 'Bake khobz'));
  const g = await game(page);
  expect(g.inventory.tagine).toBe(1);
  expect(g.inventory.bread).toBeGreaterThanOrEqual(3);
  await press(page, 'Escape');

  // the workbench works like Si Lahcen's: a bench recipe is open there
  const bench = camp.find((c) => c.kind === 'bench')!;
  await tp(page, bench.ix, bench.iz);
  await wait(page, 300);
  await press(page, 'KeyE');
  await expect(recipe(page, "Woodcutter's axe")).toBeEnabled();
  await press(page, 'Escape');

  // the tent: hold E to sleep through to the evening
  const tent = camp.find((c) => c.kind === 'tent')!;
  await tp(page, tent.ix, tent.iz);
  await wait(page, 300);
  const h0 = await page.evaluate(() => (window.__THREE_GAME_DIAGNOSTICS__?.game as unknown as { hour: number }).hour);
  await page.keyboard.down('KeyE');
  await wait(page, 1600);
  await page.keyboard.up('KeyE');
  const h1 = await page.evaluate(() => (window.__THREE_GAME_DIAGNOSTICS__?.game as unknown as { hour: number }).hour);
  expect(Math.abs(h1 - h0), 'slept the hours away').toBeGreaterThan(3);
  expect(errors).toEqual([]);
});
