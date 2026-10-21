import { expect, test, type Page } from '@playwright/test';
import { wait } from './helpers';

// Mounts and vehicles, driven with real keys: E to get on and off, WASD to move,
// Space to pull the plane into the sky. Hooks only place the player.

type R = { kind: string; x: number; y: number; z: number; speed: number; flying: boolean; crashed: boolean };
const rides = (p: Page) => p.evaluate(() => (window.__THREE_GAME_TEST_HOOKS__?.rides?.() ?? []) as R[]);
const ride = async (p: Page, kind: string) => (await rides(p)).find((r) => r.kind === kind) as R;
const riding = (p: Page) => p.evaluate(() => (window.__THREE_GAME_DIAGNOSTICS__?.game as { riding: string | null }).riding);
const tp = (p: Page, x: number, z: number) => p.evaluate(([a, b]) => window.__THREE_GAME_TEST_HOOKS__?.teleport?.(a, b), [x, z]);

async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await wait(page, ms);
  await page.keyboard.up(key);
  await wait(page, 100);
}

async function getOn(page: Page, kind: string): Promise<void> {
  const r = await ride(page, kind);
  await tp(page, r.x + 1.6, r.z + 0.4);
  await wait(page, 300);
  await hold(page, 'KeyE', 1000);
  expect(await riding(page), `on the ${kind}`).toBe(kind);
}

test('mounts and vehicles: donkey, jeep, boat, train and plane', async ({ page }) => {
  test.setTimeout(process.env.CI ? 400_000 : 150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?test');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90_000 });
  await page.click('#btn-start');
  await wait(page, 100);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setHour?.(12));

  for (const kind of ['donkey', 'jeep', 'boat']) {
    await getOn(page, kind);
    const a = await ride(page, kind);
    await hold(page, 'KeyW', 1800);
    const b = await ride(page, kind);
    expect(Math.hypot(b.x - a.x, b.z - a.z), `${kind} moved`).toBeGreaterThan(kind === 'boat' ? 2 : 3);
    // stop, then step off
    await hold(page, 'KeyS', 1200);
    await wait(page, 1500);
    await page.keyboard.press('KeyE');
    await wait(page, 200);
    expect(await riding(page), `off the ${kind}`).toBeNull();
  }

  // the train shuttles on its own: board it at a halt and ride along
  await getOn(page, 'train');
  const t0 = await ride(page, 'train');
  await wait(page, 20_000);
  const t1 = await ride(page, 'train');
  expect(Math.hypot(t1.x - t0.x, t1.z - t0.z), 'the train carried us').toBeGreaterThan(10);

  // you step off only when it stands at a halt
  for (let i = 0; i < 80 && Math.abs((await ride(page, 'train')).speed) > 1; i += 1) await wait(page, 500);
  await page.keyboard.press('KeyE');
  await wait(page, 200);
  expect(await riding(page), 'off the train').toBeNull();

  // the plane: full throttle down the strip with Space held; she lifts off past 22 m/s
  await getOn(page, 'plane');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await wait(page, 6000);
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyW');
  const p = await ride(page, 'plane');
  expect(p.crashed, (p as R & { reason?: string }).reason).toBe(false);
  expect(p.flying, 'airborne').toBe(true);
  expect(errors).toEqual([]);
});
