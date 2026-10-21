import { expect, test, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { wait, waitForGame } from './helpers';

// Bot playtest: drives the game with real keyboard / click input. The only
// helpers are lookAt() (stands in for mouse-look, which needs pointer lock)
// and teleport() for setting up the late-game scenarios.

type Game = { state: string; mission: string; step: number; dead: boolean; kills: number; inventory: Record<string, number>; interact: string | null; alert: string; health: number };

const game = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.game as unknown as Game);
const ppos = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position ?? { x: 0, y: 0, z: 0 });

async function walkTo(page: Page, target: string, within = 1.8, timeoutMs = process.env.CI ? 70_000 : 25_000): Promise<{ ok: boolean; travelled: number; softlocks: number }> {
  const start = Date.now();
  let travelled = 0;
  let softlocks = 0;
  let last = await ppos(page);
  await page.keyboard.down('KeyW');
  try {
    while (Date.now() - start < timeoutMs) {
      const t = await page.evaluate((id) => window.__THREE_GAME_TEST_HOOKS__?.targets?.()[id], target);
      if (!t) throw new Error(`unknown target ${target}`);
      const p = await ppos(page);
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d < within) return { ok: true, travelled, softlocks };
      await page.evaluate(([x, z]) => window.__THREE_GAME_TEST_HOOKS__?.lookAt?.(x, z), [t.x, t.z]);
      await wait(page, 150);
      const now = await ppos(page);
      const step = Math.hypot(now.x - last.x, now.z - last.z);
      travelled += step;
      if (step < 0.05) {
        // stuck on geometry: side-step
        softlocks += 1;
        await page.keyboard.down('KeyD');
        await wait(page, 450);
        await page.keyboard.up('KeyD');
      }
      last = now;
    }
    return { ok: false, travelled, softlocks };
  } finally {
    await page.keyboard.up('KeyW');
  }
}

async function talkThrough(page: Page): Promise<void> {
  await page.keyboard.press('KeyE');
  for (let i = 0; i < 6; i += 1) {
    await wait(page, 250);
    if ((await game(page)).state !== 'dialogue') return;
    await page.keyboard.press('KeyE');
  }
}

async function holdE(page: Page, ms: number): Promise<void> {
  await page.keyboard.down('KeyE');
  await wait(page, ms);
  await page.keyboard.up('KeyE');
  await wait(page, 150);
}

test('bot playtest: missions progress, takedown, death and retry', async ({ page }) => {
  test.setTimeout(process.env.CI ? 600_000 : 240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const metrics: Record<string, unknown> = { seed: 12345 };

  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10, null, { timeout: 60_000 });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.seed(12345));
  await page.click('#btn-start');
  await wait(page, 100);
  expect((await game(page)).state).toBe('playing');

  // ---- Mission 1: Bread and Water (all real input)
  let travelled = 0;
  let softlocks = 0;
  const go = async (t: string, within = 1.8) => {
    const r = await walkTo(page, t, within);
    travelled += r.travelled;
    softlocks += r.softlocks;
    expect(r.ok, `reached ${t}`).toBe(true);
  };
  await go('npc:zahra', 2.0);
  await talkThrough(page);
  expect((await game(page)).step).toBe(1);
  await go('douar-well', 2.0);
  await holdE(page, 1100);
  await go('douar-oven', 1.8);
  await holdE(page, 900);
  const afterSupplies = await game(page);
  expect(afterSupplies.step).toBe(2);
  expect(afterSupplies.inventory.bread).toBeGreaterThanOrEqual(2);
  await go('npc:zahra', 2.0);
  await talkThrough(page);
  const m2 = await game(page);
  expect(m2.mission).toBe('leaflets');

  // ---- Mission 2 starts: Si Lahcen hands over the leaflets
  await go('npc:lahcen', 2.0);
  await talkThrough(page);
  const withLeaflets = await game(page);
  expect(withLeaflets.inventory.leaflet).toBe(3);
  expect(withLeaflets.step).toBe(1);

  // ---- Survival verbs: eat & drink keys change meters
  const hungerBefore = await page.evaluate(() => (window.__THREE_GAME_DIAGNOSTICS__?.game as { hunger: number }).hunger);
  await page.keyboard.press('KeyF');
  await wait(page, 200);
  const hungerAfter = await page.evaluate(() => (window.__THREE_GAME_DIAGNOSTICS__?.game as { hunger: number }).hunger);
  expect(hungerAfter).toBeGreaterThan(hungerBefore);

  // ---- Silent takedown: sneak up behind the kasbah gate guard at night
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('kasbah-night'));
  const guard = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.targets?.()['enemy:k-gate1']);
  if (!guard) throw new Error('guard missing');
  await page.evaluate(([x, z]) => window.__THREE_GAME_TEST_HOOKS__?.teleport?.(x, z), [guard.x + 2.6, guard.z]);
  await wait(page, 300);
  const killsBefore = (await game(page)).kills;
  await go('enemy:k-gate1', 1.5);
  await page.keyboard.press('KeyE');
  await wait(page, 400);
  const afterTakedown = await game(page);
  expect(afterTakedown.kills).toBe(killsBefore + 1);
  metrics.takedownAlert = afterTakedown.alert;

  // ---- Fail state: stand in the open before the garrison in daylight
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('combat'));
  const t0 = Date.now();
  await waitForGame(page, 'window.__THREE_GAME_DIAGNOSTICS__?.game?.dead === true', 60_000);
  metrics.secondsToDeathUnderFire = (Date.now() - t0) / 1000;
  await wait(page, 2000);
  await expect(page.locator('#death-screen')).toBeVisible({ timeout: 5000 });
  await page.click('#btn-retry');
  await wait(page, 400);
  const revived = await game(page);
  expect(revived.dead).toBe(false);
  expect(revived.state).toBe('playing');
  expect(revived.health).toBeGreaterThan(90);

  metrics.travelled = Math.round(travelled);
  metrics.softlockWindows = softlocks;
  metrics.missionReached = withLeaflets.mission;
  metrics.errors = errors;
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/bot-metrics.json', JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics));
  expect(errors).toEqual([]);
});
