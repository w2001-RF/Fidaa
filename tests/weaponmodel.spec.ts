import { expect, test } from '@playwright/test';
import { press, wait } from './helpers';

// Generated weapon models: assets/models/manifest.json swaps a procedural weapon for a GLB,
// fitted to the hand whatever axes the file uses. A stand-in GLB is served by the test.

/** A closed box as a binary glTF: sx along x, sy along y, sz along z. */
function boxGlb(sx: number, sy: number, sz: number): Buffer {
  const [hx, hy, hz] = [sx / 2, sy / 2, sz / 2];
  const pos = new Float32Array([-hx, -hy, -hz, hx, -hy, -hz, hx, hy, -hz, -hx, hy, -hz, -hx, -hy, hz, hx, -hy, hz, hx, hy, hz, -hx, hy, hz]);
  const idx = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  const doc = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-hx, -hy, -hz], max: [hx, hy, hz] },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
  };
  let json = Buffer.from(JSON.stringify(doc));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const chunk = (type: number, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([head, chunk(0x4e4f534a, json), chunk(0x004e4942, bin)]);
}

async function boot(page: import('@playwright/test').Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?test');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, null, { timeout: 90_000 });
  await page.click('#btn-start');
  await wait(page, 100);
}

test('a generated bow model replaces the procedural one, fitted to the hand', async ({ page }) => {
  test.setTimeout(process.env.CI ? 200_000 : 90_000);
  const errors: string[] = [];
  // the file's own axes are all wrong for the game: long along y, middle along x, thin along z
  await page.route('**/assets/models/manifest.json', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ weapons: { bow: { file: 'bow/test-bow.glb', length: 1.15 }, ghost: { file: 'nothing.glb' } } }) }),
  );
  await page.route('**/assets/models/bow/test-bow.glb', (r) => r.fulfill({ contentType: 'model/gltf-binary', body: boxGlb(0.6, 2.3, 0.1) }));
  await boot(page, errors);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__?.weaponModel?.('bow') != null, null, { timeout: 15_000 });
  const fit = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.weaponModel!('bow')!);
  // longest side → z at the requested length, middle → y, thin → x; back edge 3 cm behind the hand
  expect(fit.size[2]).toBeCloseTo(1.15, 2);
  expect(fit.size[1]).toBeCloseTo(0.3, 2);
  expect(fit.size[0]).toBeCloseTo(0.05, 2);
  expect(fit.min[1]).toBeCloseTo(-0.03, 2);
  expect(fit.min[2]).toBeCloseTo(-fit.max[2], 2);
  // a weapon the manifest lists but whose file is missing stays procedural
  expect(await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.weaponModel!('crossbow'))).toBeNull();

  // equip it and shoot: the game runs with the model in hand
  await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h?.ceasefire?.(true);
    h?.teleport?.(-70, 118);
    h?.grantWeapon?.('bow');
    h?.give?.({ arrow: 3 });
  });
  await press(page, 'Digit9');
  await wait(page, 300);
  await page.evaluate(([x, y, z]) => window.__THREE_GAME_TEST_HOOKS__?.aimAt?.(x, y, z), [-62, 3, 119]);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.input?.('attack', true));
  await wait(page, 100);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.input?.('attack', false));
  await wait(page, 500);
  expect((await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.arrows?.() ?? [])).length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('without a manifest the procedural weapons stay', async ({ page }) => {
  test.setTimeout(process.env.CI ? 200_000 : 90_000);
  const errors: string[] = [];
  await boot(page, errors);
  await wait(page, 1000);
  expect(await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.weaponModel!('bow'))).toBeNull();
  expect(errors).toEqual([]);
});
