import { expect, test, type Page } from '@playwright/test';
import { wait } from './helpers';

// Collision and vehicle handling, driven with real keys. Hooks only place the
// player and read state back.

type R = { kind: string; x: number; y: number; z: number; speed: number; flying: boolean; crashed: boolean };
const rides = (p: Page) => p.evaluate(() => (window.__THREE_GAME_TEST_HOOKS__?.rides?.() ?? []) as R[]);
const ride = async (p: Page, kind: string) => (await rides(p)).find((r) => r.kind === kind) as R;
const riding = (p: Page) => p.evaluate(() => (window.__THREE_GAME_DIAGNOSTICS__?.game as { riding: string | null }).riding);
const tp = (p: Page, x: number, z: number) => p.evaluate(([a, b]) => window.__THREE_GAME_TEST_HOOKS__?.teleport?.(a, b), [x, z]);
const pos = (p: Page) => p.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.player.position);

async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await wait(page, ms);
  await page.keyboard.up(key);
  await wait(page, 100);
}

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

/** Walk straight at a point for `ms` and return how close the player got to it. */
async function walkInto(page: Page, x: number, z: number, from: number, ms: number): Promise<{ closest: number; walked: number }> {
  await tp(page, x - from, z);
  await wait(page, 200);
  await page.evaluate(([a, b]) => window.__THREE_GAME_TEST_HOOKS__?.lookAt?.(a, b), [x, z]);
  const p0 = await pos(page);
  await hold(page, 'KeyW', ms);
  const p1 = await pos(page);
  return { closest: Math.hypot(p1.x - x, p1.z - z), walked: Math.hypot(p1.x - p0.x, p1.z - p0.z) };
}

test('solid world: tree trunks and a parked jeep stop the fidāʾī', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 120_000);
  const errors: string[] = [];
  await boot(page, errors);

  // an olive trunk in the groves: walk into it, end up against the bark, not inside it
  const trees = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.harvestables?.('tree') ?? []);
  const tree = trees.find((t) => t.scale > 0.9) ?? trees[0];
  const trunk = (await page.evaluate(([a, b]) => window.__THREE_GAME_TEST_HOOKS__?.colliders?.(a, b, 0.2) ?? [], [tree.x, tree.z])).find((c) => c.tag === 'tree');
  expect(trunk, 'every tree has a trunk collider').toBeTruthy();
  const t = await walkInto(page, tree.x, tree.z, 3, 1800);
  expect(t.walked, 'walked up to the tree').toBeGreaterThan(1);
  expect(t.closest, 'stopped at the trunk').toBeGreaterThan(trunk!.r + 0.25);

  // the parked jeep is a body, not a ghost
  const jeep = await ride(page, 'jeep');
  const j = await walkInto(page, jeep.x, jeep.z, 4, 2000);
  expect(j.walked).toBeGreaterThan(1.5);
  expect(j.closest, 'stopped against the jeep').toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('driving: the jeep accelerates, shows its speed and brakes to a stop', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 120_000);
  const errors: string[] = [];
  await boot(page, errors);
  const jeep = await ride(page, 'jeep');
  await tp(page, jeep.x + 1.6, jeep.z + 0.4);
  await wait(page, 300);
  await hold(page, 'KeyE', 1000);
  expect(await riding(page)).toBe('jeep');
  await expect(page.locator('#ride-gauges')).toBeVisible();

  await page.keyboard.down('KeyW');
  await wait(page, 3000);
  const fast = await ride(page, 'jeep');
  await page.keyboard.up('KeyW');
  expect(fast.speed, 'the engine pulls').toBeGreaterThan(6);
  await expect(page.locator('#ride-gauges')).toContainText('km/h');

  // brakes: a few seconds to stop, not an instant halt
  await page.keyboard.down('KeyS');
  await wait(page, 250);
  const mid = await ride(page, 'jeep');
  await wait(page, 2500);
  await page.keyboard.up('KeyS');
  const stopped = await ride(page, 'jeep');
  expect(mid.speed, 'still rolling a moment after braking').toBeGreaterThan(1);
  expect(Math.abs(stopped.speed), 'braked to a stop').toBeLessThan(1);
  await page.keyboard.press('KeyE');
  await wait(page, 200);
  await expect(page.locator('#ride-gauges')).toBeHidden();
  expect(errors).toEqual([]);
});

test('flying: instruments, and the stall warning when the nose is held up too slow', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 120_000);
  const errors: string[] = [];
  await boot(page, errors);
  const plane = await ride(page, 'plane');
  await tp(page, plane.x + 1.6, plane.z + 0.4);
  await wait(page, 300);
  await hold(page, 'KeyE', 1000);
  expect(await riding(page)).toBe('plane');
  // trimmed level flight high over the plain: she holds her height hands-off
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.pilot?.(0, 90, -40, 0, 30));
  await wait(page, 1500);
  const cruise = await ride(page, 'plane');
  expect(cruise.flying).toBe(true);
  await expect(page.locator('#ride-gauges')).toContainText('Airspeed');
  await expect(page.locator('#ride-gauges')).toContainText('Altitude');
  await expect(page.locator('#ride-gauges')).toContainText('RPM');
  // power off (S) and the stick held back (numpad 5): airspeed bleeds away into a stall
  await page.keyboard.down('KeyS');
  await page.keyboard.down('Numpad5');
  await expect(page.locator('#ride-gauges')).toContainText('STALL', { timeout: 15_000 });
  await page.keyboard.up('Numpad5');
  await page.keyboard.up('KeyS');
  expect((await ride(page, 'plane')).crashed).toBe(false);
  expect(errors).toEqual([]);
});
