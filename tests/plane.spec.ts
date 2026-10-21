import { expect, test, type Page } from '@playwright/test';
import { press, wait } from './helpers';

// The Criquet's cockpit, one control at a time, with real keys:
// N engine, W/S throttle, A/D rudder, numpad 4/6 (or ←/→) ailerons,
// numpad 8/5 (or ↑/↓) elevator, Space brakes, F/R flaps, T/G trim.
// Hooks only seat the pilot, place the plane in the sky and read the instruments.

type R = { kind: string; x: number; z: number; speed: number; flying: boolean; crashed: boolean; reason?: string; pitch: number; roll: number; beta: number; stalled: boolean };
type Gauges = NonNullable<ReturnType<NonNullable<NonNullable<Window['__THREE_GAME_TEST_HOOKS__']>['gauges']>>>;
const plane = (p: Page) => p.evaluate(() => (window.__THREE_GAME_TEST_HOOKS__?.rides?.() ?? []).find((r) => r.kind === 'plane') as R);
const gauges = (p: Page) => p.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.gauges!() as Gauges);
const riding = (p: Page) => p.evaluate(() => (window.__THREE_GAME_DIAGNOSTICS__?.game as { riding: string | null }).riding);
/** signed change of compass heading in degrees, right turns positive */
const turned = (a: number, b: number) => ((b - a + 540) % 360) - 180;

async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await wait(page, ms);
  await page.keyboard.up(key);
  await wait(page, 60);
}

async function boardPlane(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?test');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90_000 });
  await page.click('#btn-start');
  await wait(page, 100);
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__?.setHour?.(12);
    // the airfield sits under a French post: keep the soldiers from shooting the pilot mid-test
    window.__THREE_GAME_TEST_HOOKS__?.ceasefire?.(true);
  });
  const r = await plane(page);
  await page.evaluate(([x, z]) => window.__THREE_GAME_TEST_HOOKS__?.teleport?.(x, z), [r.x + 1.6, r.z + 0.4]);
  await wait(page, 300);
  await hold(page, 'KeyE', 1000);
  expect(await riding(page), 'in the cockpit').toBe('plane');
  await expect(page.locator('#ride-gauges')).toBeVisible();
}

/** Trimmed level flight high over the open valley east of the douar, heading east. */
async function inFlight(page: Page, speed = 30): Promise<void> {
  await page.evaluate((v) => window.__THREE_GAME_TEST_HOOKS__?.pilot?.(-46, 90, 118, Math.PI / 2, v), speed);
  await wait(page, 300);
}

test('plane on the ground: engine, throttle, flaps, trim, brakes and taxi steering', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 120_000);
  const errors: string[] = [];
  await boardPlane(page, errors);

  // cold engine: the throttle lever moves but nothing turns and she stays put
  let g = await gauges(page);
  expect(g.engine).toBe('off');
  expect(g.rpm).toBe(0);
  await hold(page, 'KeyW', 600);
  g = await gauges(page);
  expect(g.throttle, 'W opens the throttle').toBeGreaterThan(0.3);
  expect(g.rpm, 'no rpm without the engine').toBe(0);
  expect((await plane(page)).speed).toBeLessThan(0.1);
  await hold(page, 'KeyS', 1500);
  expect((await gauges(page)).throttle, 'S closes it').toBe(0);

  // N: the starter turns her over, then she idles
  await press(page, 'KeyN');
  expect((await gauges(page)).engine).toBe('starting');
  await wait(page, 2200);
  g = await gauges(page);
  expect(g.engine).toBe('on');
  expect(g.rpm, 'idling').toBeGreaterThan(450);
  expect(g.rpm).toBeLessThan(900);

  // flaps go down a notch per F (15°, 30°, 40°, no further) and up a notch per R; the crank takes time
  const notches: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    await press(page, 'KeyF');
    notches.push((await gauges(page)).flaps);
  }
  expect(notches).toEqual([15, 30, 40, 40]);
  await wait(page, 1000);
  const travel = (await gauges(page)).flapPos;
  expect(travel, 'flaps travelling').toBeGreaterThan(0.2);
  expect(travel, 'flaps not there yet').toBeLessThan(1);
  await press(page, 'KeyR');
  await press(page, 'KeyR');
  expect((await gauges(page)).flaps).toBe(15);

  // trim wheel: T winds it nose-up, G back nose-down
  const t0 = (await gauges(page)).trim;
  await hold(page, 'KeyT', 1200);
  const t1 = (await gauges(page)).trim;
  expect(t1, 'T trims nose-up').toBeGreaterThan(t0 + 0.25);
  await hold(page, 'KeyG', 2400);
  expect((await gauges(page)).trim, 'G trims nose-down').toBeLessThan(t1 - 0.5);

  // brakes on, full throttle: the engine roars but the wheels hold her
  await page.keyboard.down('Space');
  await hold(page, 'KeyW', 1500);
  await wait(page, 1000);
  g = await gauges(page);
  expect(g.rpm, 'full power').toBeGreaterThan(1800);
  expect(g.brake, 'brake light').toBe(true);
  expect((await plane(page)).speed, 'held on the brakes').toBeLessThan(0.5);

  // brakes off: she rolls; close the throttle and steer right with the rudder (tailwheel)
  const h0 = g.heading;
  await page.keyboard.up('Space');
  await wait(page, 1200);
  expect((await plane(page)).speed, 'rolling').toBeGreaterThan(2);
  await page.keyboard.down('KeyS');
  await hold(page, 'KeyD', 1500);
  await page.keyboard.up('KeyS');
  expect(turned(h0, (await gauges(page)).heading), 'D taxis her right').toBeGreaterThan(8);

  // brake to a stop and shut the engine down
  await hold(page, 'Space', 3000);
  expect((await plane(page)).speed, 'stopped').toBeLessThan(0.3);
  await press(page, 'KeyN');
  await wait(page, 2500);
  g = await gauges(page);
  expect(g.engine).toBe('off');
  expect(g.rpm, 'propeller winding down').toBeLessThan(300);
  const p = await plane(page);
  expect(p.crashed, p.reason).toBe(false);
  expect(p.flying).toBe(false);
  expect(errors).toEqual([]);
});

test('plane in flight: ailerons, elevator, rudder, throttle and the stall', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 150_000);
  const errors: string[] = [];
  await boardPlane(page, errors);

  // ailerons: numpad 6 / → roll right, numpad 4 / ← roll left
  for (const [key, sign] of [['Numpad6', 1], ['ArrowRight', 1], ['Numpad4', -1], ['ArrowLeft', -1]] as const) {
    await inFlight(page);
    await hold(page, key, 700);
    expect((await plane(page)).roll * sign, `${key} rolls ${sign > 0 ? 'right' : 'left'}`).toBeGreaterThan(0.25);
  }

  // a banked wing turns her: bank right, let go, she comes round to the right
  await inFlight(page);
  let h0 = (await gauges(page)).heading;
  await hold(page, 'Numpad6', 600);
  await wait(page, 2500);
  expect(turned(h0, (await gauges(page)).heading), 'banked turn to the right').toBeGreaterThan(10);
  await inFlight(page);
  h0 = (await gauges(page)).heading;
  await hold(page, 'Numpad4', 600);
  await wait(page, 2500);
  expect(turned(h0, (await gauges(page)).heading), 'banked turn to the left').toBeLessThan(-10);

  // elevator: numpad 5 / ↓ pulls the nose up, numpad 8 / ↑ pushes it down
  for (const [key, sign] of [['Numpad5', 1], ['ArrowDown', 1], ['Numpad8', -1], ['ArrowUp', -1]] as const) {
    await inFlight(page);
    const p0 = (await plane(page)).pitch;
    await hold(page, key, 600);
    expect(((await plane(page)).pitch - p0) * sign, `${key} pitches the nose ${sign > 0 ? 'up' : 'down'}`).toBeGreaterThan(0.08);
  }
  // nose up climbs, nose down dives
  await inFlight(page);
  await hold(page, 'Numpad5', 500);
  await wait(page, 800);
  expect((await gauges(page)).vs, 'climbing').toBeGreaterThan(1);
  await inFlight(page);
  await hold(page, 'Numpad8', 500);
  await wait(page, 800);
  expect((await gauges(page)).vs, 'diving').toBeLessThan(-1);

  // rudder: D yaws the nose right (sideslip), A left
  for (const [key, sign] of [['KeyD', 1], ['KeyA', -1]] as const) {
    await inFlight(page);
    h0 = (await gauges(page)).heading;
    await page.keyboard.down(key);
    await wait(page, 600);
    const slip = (await plane(page)).beta;
    await wait(page, 600);
    await page.keyboard.up(key);
    expect(-slip * sign, `${key} skids the nose round`).toBeGreaterThan(0.03);
    expect(turned(h0, (await gauges(page)).heading) * sign, `${key} yaws ${sign > 0 ? 'right' : 'left'}`).toBeGreaterThan(3);
  }

  // throttle: chopped, she sinks; full, she climbs
  await inFlight(page);
  await hold(page, 'KeyS', 1500);
  await wait(page, 2500);
  let g = await gauges(page);
  expect(g.throttle).toBe(0);
  expect(g.rpm, 'idling in the air').toBeLessThan(900);
  expect(g.vs, 'gliding down without power').toBeLessThan(-0.5);
  await inFlight(page);
  await hold(page, 'KeyW', 1500);
  await wait(page, 3000);
  g = await gauges(page);
  expect(g.throttle).toBe(1);
  expect(g.vs, 'climbing on full power').toBeGreaterThan(0.5);

  // flaps in the air slow her down
  await inFlight(page);
  const s0 = (await plane(page)).speed;
  await press(page, 'KeyF');
  await press(page, 'KeyF');
  await press(page, 'KeyF');
  await wait(page, 3500);
  expect((await gauges(page)).flapPos).toBeGreaterThan(0.9);
  expect((await plane(page)).speed, 'flaps add drag').toBeLessThan(s0 - 1);

  // the stall: slow, close the throttle and keep pulling; the warning comes on, the wing goes;
  // stick forward and power recover her
  await inFlight(page, 19);
  await page.keyboard.down('KeyS');
  await page.keyboard.down('Numpad5');
  let stalled = false;
  for (let i = 0; i < 30 && !stalled; i += 1) {
    await wait(page, 200);
    stalled = (await plane(page)).stalled;
  }
  expect((await gauges(page)).stall, 'stall warning').toBe(true);
  await page.keyboard.up('Numpad5');
  await page.keyboard.up('KeyS');
  expect(stalled, 'she stalls').toBe(true);
  await page.keyboard.down('Numpad8');
  await hold(page, 'KeyW', 1500);
  await page.keyboard.up('Numpad8');
  await wait(page, 1500);
  const p = await plane(page);
  expect(p.stalled, 'recovered').toBe(false);
  expect(p.crashed, p.reason).toBe(false);
  expect(p.flying).toBe(true);
  expect(errors).toEqual([]);
});
