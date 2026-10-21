import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// Load test: boot time, a flythrough of every zone and landmark at day and
// night, and a worst-case firefight (every guard of the garrison alerted while
// the player empties a submachine gun). Render budgets (draw calls, triangles,
// textures) and memory growth are asserted everywhere; frame-time budgets are
// asserted only on a hardware GPU, since CI renders WebGL on the CPU.

type Sample = { frames: number; p50: number; p95: number; worst: number; calls: number; triangles: number; textures: number };

const BUDGET = { calls: 340, triangles: 900_000, textures: 110, heapGrowthMB: 120, p95MsGpu: 34 };

/** Frame times measured inside the page with requestAnimationFrame. */
function sample(page: Page, ms: number): Promise<Sample> {
  return page.evaluate(
    (duration) =>
      new Promise<Sample>((resolve) => {
        const times: number[] = [];
        let calls = 0;
        let triangles = 0;
        let textures = 0;
        let last = performance.now();
        const end = last + duration;
        const tick = (now: number) => {
          times.push(now - last);
          last = now;
          const r = window.__THREE_GAME_DIAGNOSTICS__?.renderer;
          if (r) {
            calls = Math.max(calls, r.calls);
            triangles = Math.max(triangles, r.triangles);
            textures = Math.max(textures, r.textures);
          }
          if (now < end) requestAnimationFrame(tick);
          else {
            const s = times.slice(2).sort((a, b) => a - b);
            const q = (f: number) => s[Math.min(s.length - 1, Math.floor(s.length * f))] ?? 0;
            resolve({ frames: s.length, p50: q(0.5), p95: q(0.95), worst: s[s.length - 1] ?? 0, calls, triangles, textures });
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

const heapMB = (page: Page) =>
  page.evaluate(() => {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return m ? m.usedJSHeapSize / 1048576 : 0;
  });

test('load test: flythrough and firefight stay inside render and memory budgets', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const t0 = Date.now();
  await page.goto('/?test');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 120_000 });
  const bootMs = Date.now() - t0;
  const software = await page.evaluate(() => Boolean((window.__THREE_GAME_DIAGNOSTICS__?.game as { software?: boolean } | undefined)?.software));
  // CI uses the software rasteriser at the low preset; locally force high to measure the real thing
  await page.click('#btn-start');
  const heap0 = await heapMB(page);

  const H = page.evaluate.bind(page);
  const stops: { name: string; x: number; z: number; hour: number }[] = [
    { name: 'douar', x: -132, z: 118, hour: 16.8 },
    { name: 'medina-souk', x: 18, z: 10, hour: 12 },
    { name: 'medina-gate', x: -60, z: 14, hour: 18.5 },
    { name: 'kasbah', x: 96, z: 112, hour: 22.5 },
    { name: 'post', x: 110, z: -160, hour: 23 },
    { name: 'oasis', x: -82, z: -86, hour: 9 },
  ];
  const lms = await H(() => window.__THREE_GAME_TEST_HOOKS__?.landmarks?.() ?? []);
  for (const l of lms) stops.push({ name: `lm-${l.id}`, x: l.x - 18, z: l.z - 18, hour: 17 });

  const results: Record<string, Sample> = {};
  for (const s of stops) {
    await H(([x, z, h]) => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__;
      hooks?.setHour?.(h);
      hooks?.teleport?.(x, z);
    }, [s.x, s.z, s.hour] as const);
    // turn a full circle while sampling so every direction is drawn
    const spin = page.evaluate(async () => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__;
      const p = window.__THREE_GAME_DIAGNOSTICS__?.player.position;
      if (!p) return;
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        hooks?.lookAt?.(p.x + Math.sin(a) * 30, p.z + Math.cos(a) * 30);
        await new Promise((r) => setTimeout(r, 180));
      }
    });
    results[s.name] = await sample(page, software ? 1800 : 1500);
    await spin;
  }

  // worst case: the whole garrison hunting the player through a submachine-gun burst
  const post = { x: 110, z: -122 };
  await H(([x, z]) => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    hooks?.setHour?.(14);
    hooks?.teleport?.(x - 6, z - 44);
    hooks?.lookAt?.(x, z);
    hooks?.grantWeapon?.('smg');
    hooks?.give?.({ pistolAmmo: 400, bandage: 20 });
    hooks?.stress?.(90);
    hooks?.input?.('weapon5', true);
  }, [post.x, post.z] as const);
  await page.waitForTimeout(150);
  await H(() => {
    window.__THREE_GAME_TEST_HOOKS__?.input?.('weapon5', false);
    window.__THREE_GAME_TEST_HOOKS__?.input?.('attack', true);
  });
  results.firefight = await sample(page, 4000);
  await H(() => window.__THREE_GAME_TEST_HOOKS__?.input?.('attack', false));

  const heap1 = await heapMB(page);
  const metrics = { bootMs, software, heapStartMB: Math.round(heap0), heapEndMB: Math.round(heap1), budget: BUDGET, results };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/perf-metrics.json', JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify({ bootMs, software, heap: [Math.round(heap0), Math.round(heap1)], firefight: results.firefight }));

  for (const [name, r] of Object.entries(results)) {
    expect.soft(r.calls, `${name} draw calls`).toBeLessThanOrEqual(BUDGET.calls);
    expect.soft(r.triangles, `${name} triangles`).toBeLessThanOrEqual(BUDGET.triangles);
    expect.soft(r.textures, `${name} textures`).toBeLessThanOrEqual(BUDGET.textures);
    expect.soft(r.frames, `${name} rendered frames`).toBeGreaterThanOrEqual(software ? 1 : 4);
    if (!software) expect.soft(r.p95, `${name} p95 frame ms`).toBeLessThanOrEqual(BUDGET.p95MsGpu);
  }
  if (heap0 > 0) expect(heap1 - heap0, 'JS heap growth (MB)').toBeLessThanOrEqual(BUDGET.heapGrowthMB);
  expect(bootMs, 'boot to first frames').toBeLessThan(software ? 110_000 : 25_000);
  expect(errors).toEqual([]);
});
