import type { Page } from '@playwright/test';

/**
 * CI runners have no GPU: WebGL falls back to a CPU rasteriser at a few frames
 * per second, and with the 50 ms frame clamp game time would crawl. There the
 * tests advance game time with the fixed-step `step()` hook instead of waiting
 * on the wall clock. Input is still real key presses either way.
 */
export const SIM = Boolean(process.env.CI || process.env.SOFTWARE_GL);

/** Let `ms` of game time pass. */
export async function wait(page: Page, ms: number): Promise<void> {
  if (SIM) await page.evaluate((s) => window.__THREE_GAME_TEST_HOOKS__?.step?.(s), ms / 1000);
  else await page.waitForTimeout(ms);
}

/** Wait (in game time) until the diagnostics predicate holds. */
export async function waitForGame(page: Page, predicate: string, timeoutMs: number): Promise<void> {
  if (!SIM) {
    await page.waitForFunction(predicate, null, { timeout: timeoutMs });
    return;
  }
  for (let t = 0; t < timeoutMs; t += 500) {
    if (await page.evaluate(predicate)) return;
    await wait(page, 500);
  }
  throw new Error(`timed out waiting for ${predicate}`);
}

/** A key press followed by enough game time for the frame loop to act on it. */
export async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await wait(page, 100);
}

/** A DOM click, then one simulated frame so diagnostics reflect it. */
export async function click(page: Page, selector: string | import('@playwright/test').Locator): Promise<void> {
  if (typeof selector === 'string') await page.click(selector);
  else await selector.click();
  await wait(page, 60);
}
