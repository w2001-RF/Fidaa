import { expect, test, type Page } from '@playwright/test';
import { click, press, wait } from './helpers';

// Feature checks for the systems added after the first release: language,
// crafting, weapons, exploration, skills, loading screen and settings.
// Real key presses and clicks drive the UI; bot hooks only set up state.

type G = {
  state: string;
  inventory: Record<string, number>;
  weapon: string;
  weapons: string[];
  upgrades: string[];
  discovered: string[];
  fogRevealed: number;
  clip: number;
  lang: string;
  interact: string | null;
};
type T = { x: number; z: number };

const game = (p: Page) => p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.game as unknown as G);
const target = (p: Page, id: string) => p.evaluate((i) => window.__THREE_GAME_TEST_HOOKS__?.targets?.()[i] as T | undefined, id);
const tp = (p: Page, x: number, z: number) => p.evaluate(([a, b]) => window.__THREE_GAME_TEST_HOOKS__?.teleport?.(a, b), [x, z]);

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?test');
  // the loading screen is shown while the world builds, then hands over to the title
  await expect(page.locator('#loading-screen')).toBeVisible();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90_000 });
  await expect(page.locator('#title-screen')).toBeVisible();
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 5_000 });
}

test('language: Darija and English switch the whole interface', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.click('#title-screen .lang-btn[data-lang="ar"]');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar-MA');
  await expect(page.locator('#btn-start')).toHaveText('بدا النضال');
  expect(await page.locator('.title-intro').evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  // in-game text follows: objective and HUD are in Darija
  await page.click('#btn-start');
  await wait(page, 100);
  await wait(page, 300);
  await expect(page.locator('#obj-title')).toHaveText('الخبز والما');
  await expect(page.locator('#weapon-name')).toHaveText('الخنجر');
  expect((await game(page)).lang).toBe('ar');
  // the choice persists across reloads
  await page.reload();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar-MA');
  await page.click('#title-screen .lang-btn[data-lang="en"]');
  await expect(page.locator('#btn-start')).toHaveText('Begin the struggle');
  expect(errors).toEqual([]);
});

test('crafting: bandages anywhere, the musket only at the workbench', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.click('#btn-start');
  await wait(page, 100);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.give?.({ cloth: 3, herbs: 2, wood: 3, scrap: 4, powder: 1 }));
  await wait(page, 60);
  const before = await game(page);

  // K opens the crafting tab
  await press(page, 'KeyK');
  await expect(page.locator('#tab-craft')).toBeVisible();
  const bandage = page.locator('.recipe', { hasText: 'Bandage' });
  await click(page, bandage.locator('button'));
  let g = await game(page);
  expect(g.inventory.bandage).toBe(before.inventory.bandage + 1);
  expect(g.inventory.cloth).toBe(before.inventory.cloth - 1);

  // the moukahla needs the bench: refused in the field
  const musket = page.locator('.recipe', { hasText: 'Restore the moukahla' });
  await expect(musket.locator('button')).toBeDisabled();
  await expect(musket.locator('button')).toHaveText('Needs the workbench');
  await press(page, 'KeyK');

  // walk up to the bench, E opens crafting there
  const bench = await target(page, 'douar-bench');
  if (!bench) throw new Error('no bench');
  await tp(page, bench.x, bench.z);
  await wait(page, 300);
  expect((await game(page)).interact).toBe('douar-bench');
  await press(page, 'KeyE');
  await expect(page.locator('#tab-craft')).toBeVisible();
  await click(page, page.locator('.recipe', { hasText: 'Restore the moukahla' }).locator('button'));
  g = await game(page);
  expect(g.weapons).toContain('musket');
  expect(g.inventory.shot).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
});

test('weapons: slots switch guns, each with its own magazine and ammunition', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.click('#btn-start');
  await wait(page, 100);
  // a slot you do not own yet stays on the current weapon
  await press(page, 'Digit5');
  expect((await game(page)).weapon).toBe('blade');
  await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h?.grantWeapon?.('pistol');
    h?.grantWeapon?.('smg');
    h?.give?.({ pistolAmmo: 40 });
  });
  await press(page, 'Digit3');
  await wait(page, 100);
  let g = await game(page);
  expect(g.weapon).toBe('pistol');
  expect(g.clip).toBe(9);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.input?.('attack', true));
  await wait(page, 80);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.input?.('attack', false));
  await wait(page, 100);
  expect((await game(page)).clip).toBe(8);

  // the MAS-38 fires continuously while the trigger is held
  await press(page, 'Digit5');
  await wait(page, 100);
  expect((await game(page)).clip).toBe(32);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.input?.('attack', true));
  await wait(page, 700);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.input?.('attack', false));
  g = await game(page);
  expect(g.clip).toBeLessThan(30);

  // reload pulls from the shared 7.65 mm reserve
  const reserve = g.inventory.pistolAmmo;
  await press(page, 'KeyR');
  await wait(page, 3200);
  g = await game(page);
  expect(g.clip).toBe(32);
  expect(g.inventory.pistolAmmo).toBeLessThan(reserve);
  // the pistol kept its own magazine
  await press(page, 'Digit3');
  await wait(page, 100);
  expect((await game(page)).clip).toBe(8);
  expect(errors).toEqual([]);
});

test('exploration: landmarks are discovered and lift the fog of war', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.click('#btn-start');
  await wait(page, 100);
  await wait(page, 700);
  const start = await game(page);
  expect(start.discovered).toEqual([]);
  const lms = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.landmarks?.() ?? []);
  expect(lms.length).toBeGreaterThanOrEqual(9);
  for (const l of lms.slice(0, 3)) {
    await tp(page, l.x + 4, l.z + 4);
    await wait(page, 800);
  }
  const g = await game(page);
  expect(g.discovered).toEqual(expect.arrayContaining(lms.slice(0, 3).map((l) => l.id)));
  expect(g.fogRevealed).toBeGreaterThan(start.fogRevealed);
  // the journal lists the places found
  await press(page, 'KeyJ');
  await expect(page.locator('.journal-places li.found')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('skills and settings: six skills at five ranks, quality and fullscreen controls', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.click('#btn-start');
  await wait(page, 100);
  await press(page, 'Tab');
  await click(page, '.tab[data-tab="skills"]');
  await expect(page.locator('#tab-skills .skill')).toHaveCount(6);
  await expect(page.locator('#tab-skills .skill').first().locator('.pips i')).toHaveCount(5);
  await press(page, 'Tab');

  await press(page, 'Escape');
  await expect(page.locator('#pause-screen')).toBeVisible();
  const q0 = await page.locator('#btn-quality').textContent();
  await click(page, '#btn-quality');
  await expect(page.locator('#btn-quality')).not.toHaveText(q0 ?? '');
  await expect(page.locator('#pause-screen .btn-fullscreen')).toBeVisible();
  await expect(page.locator('#voices')).toBeChecked();
  expect(errors).toEqual([]);
});
