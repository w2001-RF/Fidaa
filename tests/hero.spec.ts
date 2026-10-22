import { expect, test, type Page } from '@playwright/test';
import { press, wait } from './helpers';

// The Tripo-generated fidāʾī (assets/characters): it stands and walks in place of
// the procedural rig, which takes over for aiming, crouching and first person.

const hero = (p: Page) => p.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.hero?.() ?? null);

test('the generated fidāʾī stands and walks; the rig takes over to aim, crouch and see through his eyes', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?test');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90_000 });
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__?.hero?.() != null, null, { timeout: 30_000 });
  await page.click('#btn-start');
  await wait(page, 100);
  await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h?.setHour?.(10);
    h?.ceasefire?.(true);
    h?.teleport?.(-70, 118);
    h?.lookAt?.(-60, 118);
  });
  await wait(page, 600);
  let s = await hero(page);
  expect(s?.clips, 'idle and walk from the generator').toEqual(['idle', 'walk']);
  expect(s?.shown, 'standing: the generated character').toBe(true);
  expect(s?.state).toBe('idle');

  await page.keyboard.down('KeyW');
  await wait(page, 700);
  s = await hero(page);
  expect(s?.shown).toBe(true);
  expect(s?.state, 'walking').toBe('walk');
  await page.keyboard.up('KeyW');
  await wait(page, 600);
  expect((await hero(page))?.state, 'stopped').toBe('idle');

  // aiming the rifle: the procedural rig (it has the aiming poses)
  await press(page, 'Digit2');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.input?.('aim', true));
  await wait(page, 400);
  expect((await hero(page))?.shown, 'aiming: the rig').toBe(false);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.input?.('aim', false));
  await wait(page, 1200);
  expect((await hero(page))?.shown, 'back at ease').toBe(true);

  // crouching and first person: the rig too
  await press(page, 'KeyC');
  await wait(page, 400);
  expect((await hero(page))?.shown, 'crouched: the rig').toBe(false);
  await press(page, 'KeyC');
  await wait(page, 1000);
  expect((await hero(page))?.shown).toBe(true);
  await press(page, 'KeyV');
  await wait(page, 300);
  expect((await hero(page))?.shown, 'first person: no body in the way').toBe(false);
  await press(page, 'KeyV');
  await wait(page, 800);
  expect((await hero(page))?.shown).toBe(true);
  expect(errors).toEqual([]);
});
