// Quick visual check of UI states in both languages.
// Usage: node scripts/shots.mjs [url] [outDir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:5188/?test';
const out = process.argv[3] ?? 'artifacts/shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/loading.png` });
await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90000 });
await page.waitForTimeout(800);
const H = (fn, arg) => page.evaluate(fn, arg);
for (const lang of ['en', 'ar']) {
  await H((l) => window.__THREE_GAME_TEST_HOOKS__.setLang(l), lang);
  await H(() => window.__THREE_GAME_TEST_HOOKS__.setState('title'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${lang}-title.png` });
  await H(() => window.__THREE_GAME_TEST_HOOKS__.setState('dialogue'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${lang}-dialogue.png` });
  await H(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.setState('inventory');
    h.give({ cloth: 4, wood: 3, scrap: 4, powder: 2, herbs: 2 });
    h.grantWeapon('pistol');
  });
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(100);
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${lang}-craft.png` });
  await page.click('.tab[data-tab="inv"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${lang}-inventory.png` });
  await page.click('.tab[data-tab="skills"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${lang}-skills.png` });
  await page.click('.tab[data-tab="journal"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${lang}-journal.png` });
  await H(() => window.__THREE_GAME_TEST_HOOKS__.setState('map'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${lang}-map.png` });
  await H(() => window.__THREE_GAME_TEST_HOOKS__.setState('death'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${lang}-death.png` });
}
// weapons in hand
await H(() => window.__THREE_GAME_TEST_HOOKS__.setLang('en'));
await H(() => window.__THREE_GAME_TEST_HOOKS__.setState('active-play'));
for (const [w, key] of [['rifle', 'Digit2'], ['musket', 'Digit4'], ['smg', 'Digit5'], ['pistol', 'Digit3']]) {
  await H((x) => window.__THREE_GAME_TEST_HOOKS__.grantWeapon(x), w);
  await page.keyboard.press(key);
  await H(() => window.__THREE_GAME_TEST_HOOKS__.input('aim', true));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/weapon-${w}.png` });
  await H(() => window.__THREE_GAME_TEST_HOOKS__.input('aim', false));
}
// landmarks
const only = process.argv[4];
const lms = (await H(() => window.__THREE_GAME_TEST_HOOKS__.landmarks())).filter((l) => !only || only.split(',').includes(l.id));
if (only) await H(() => window.__THREE_GAME_TEST_HOOKS__.setState('active-play'));
for (const l of lms) {
  await H(([x, z]) => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.setHour(17);
    // stand back from the landmark on the side facing the map centre, look at it
    const d = Math.hypot(x, z) || 1;
    h.teleport(x - (x / d) * 20, z - (z / d) * 20);
    h.lookAt(x, z);
  }, [l.x, l.z]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/landmark-${l.id}.png` });
}
console.log(JSON.stringify({ errors, landmarks: lms.length }));
await browser.close();
