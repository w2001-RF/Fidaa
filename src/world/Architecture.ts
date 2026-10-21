import * as THREE from 'three';
import {
  MergeBuilder,
  addMerlon,
  archFrameShape,
  boxGeo,
  cylGeo,
  extrudeGeo,
  horseshoeArchShape,
  latheGeo,
} from '../assets/GeometryKit';
import type { MaterialRole } from '../assets/Materials';
import type { CollisionWorld, BoxCollider } from './Collision';
import type { Terrain } from './Terrain';

export type BuildCtx = {
  b: MergeBuilder;
  col: CollisionWorld;
  terrain: Terrain;
  rng: () => number;
};

/** Converts building-local (lx, lz) to world using the same convention as Object3D.rotation.y */
export function toWorld(x: number, z: number, angle: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

function minGround(t: Terrain, x: number, z: number, angle: number, hw: number, hd: number): number {
  let m = Infinity;
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0]]) {
    const [wx, wz] = toWorld(x, z, angle, lx, lz);
    m = Math.min(m, t.getHeight(wx, wz));
  }
  return m;
}

const ARCH_CACHE = new Map<string, THREE.BufferGeometry>();
function archGeo(w: number, h: number, depth: number): THREE.BufferGeometry {
  const key = `${w}:${h}:${depth}`;
  let g = ARCH_CACHE.get(key);
  if (!g) {
    g = extrudeGeo(horseshoeArchShape(w, h), depth);
    ARCH_CACHE.set(key, g);
  }
  return g;
}
function archFrameGeo(w: number, h: number, border: number, depth: number): THREE.BufferGeometry {
  const key = `f${w}:${h}:${border}:${depth}`;
  let g = ARCH_CACHE.get(key);
  if (!g) {
    g = extrudeGeo(archFrameShape(w, h, border), depth);
    ARCH_CACHE.set(key, g);
  }
  return g;
}

const LAUNDRY = ['#e9e2d0', '#2f5f8a', '#b3201f', '#d7a24a', '#3d6b3a', '#efe6cf', '#7b3b22'];

export const DOOR_COLORS = ['#2f5f8a', '#2b6e63', '#7b3b22', '#3d6b3a', '#5a3a26', '#2d4f7c'];
export const PLASTER_TINTS = ['#d79a6b', '#e2ad7d', '#cf8a5c', '#e8c39c', '#d9a07a', '#c97d55', '#ecd2b0'];

export type HouseOpts = {
  tint?: string;
  door?: string;
  upper?: boolean;
  merlons?: boolean;
  role?: MaterialRole;
  /** faces (local) with door: default front (+z) */
  windows?: number;
};

/** Flat-roofed tadelakt house with horseshoe door, mashrabiya windows, parapet and spouts. */
export function house(ctx: BuildCtx, x: number, z: number, w: number, d: number, h: number, angle: number, opts: HouseOpts = {}): number {
  const { b, col, terrain, rng } = ctx;
  const role = opts.role ?? 'plaster';
  const tint = opts.tint ?? PLASTER_TINTS[Math.floor(rng() * PLASTER_TINTS.length)];
  const g = minGround(terrain, x, z, angle, w / 2, d / 2);
  const base = g - 0.8;
  const top = g + h;
  const ao = { groundY: g, aoHeight: 1.8 };
  b.put(role, boxGeo(w, top - base, d), x, (top + base) / 2, z, angle, tint, { ...ao, uvScale: 3 });
  // plinth band
  b.put(role, boxGeo(w + 0.08, 0.55, d + 0.08), x, g + 0.2, z, angle, shade(tint, 0.82), { uvScale: 3 });

  // parapet
  const p = 0.16;
  const ph = 0.55;
  const parapets: [number, number, number, number][] = [
    [0, d / 2 - p / 2, w, p],
    [0, -d / 2 + p / 2, w, p],
    [w / 2 - p / 2, 0, p, d],
    [-w / 2 + p / 2, 0, p, d],
  ];
  for (const [lx, lz, pw, pd] of parapets) {
    const [wx, wz] = toWorld(x, z, angle, lx, lz);
    b.put(role, boxGeo(pw, ph, pd), wx, top + ph / 2, wz, angle, shade(tint, 1.04), { uvScale: 3 });
  }
  if (opts.merlons) {
    for (const [lx, lz] of [[-w / 2 + 0.3, -d / 2 + 0.3], [w / 2 - 0.3, -d / 2 + 0.3], [-w / 2 + 0.3, d / 2 - 0.3], [w / 2 - 0.3, d / 2 - 0.3]]) {
      const [wx, wz] = toWorld(x, z, angle, lx, lz);
      addMerlon(b, role, wx, top + ph, wz, angle, 0.55, tint);
    }
  }

  // door on front face (+z)
  const doorW = 1.25 + rng() * 0.25;
  const doorH = 2.3 + rng() * 0.3;
  const dlx = (rng() - 0.5) * Math.max(0, w - 3);
  {
    const [wx, wz] = toWorld(x, z, angle, dlx, d / 2 + 0.05);
    b.put(role, archFrameGeo(doorW, doorH, 0.28, 0.14), wx, g, wz, angle, shade(tint, 1.18), { uvScale: 2 });
    const [ix, iz] = toWorld(x, z, angle, dlx, d / 2 + 0.01);
    b.put('wood', archGeo(doorW, doorH, 0.06), ix, g, iz, angle, opts.door ?? DOOR_COLORS[Math.floor(rng() * DOOR_COLORS.length)], { uvScale: 1.2 });
    // studs band and knocker
    const [kx, kz] = toWorld(x, z, angle, dlx + doorW * 0.25, d / 2 + 0.06);
    b.put('iron', cylGeo(0.06, 0.06, 0.03, 8), kx, g + 1.1, kz, angle, '#b08d57', { uvScale: 0 }, Math.PI / 2);
  }

  // windows: small barred openings on the upper part of each face
  const count = opts.windows ?? (1 + Math.floor(rng() * 3));
  const faces: [number, number, number][] = [
    [0, d / 2, 0],
    [w / 2, 0, Math.PI / 2],
    [-w / 2, 0, -Math.PI / 2],
    [0, -d / 2, Math.PI],
  ];
  for (let i = 0; i < count; i += 1) {
    const face = faces[(i + 1) % faces.length];
    const along = face[2] === 0 || face[2] === Math.PI ? w : d;
    const off = (rng() - 0.5) * Math.max(0, along - 1.6);
    const wy = g + Math.min(h - 1.1, 2.6 + rng() * 0.6);
    const fa = angle + face[2];
    const [cx, cz] = toWorld(x, z, angle, face[0], face[1]);
    const [wx, wz] = toWorld(cx, cz, fa, off, 0.03);
    b.put('dark', boxGeo(0.62, 0.8, 0.08), wx, wy, wz, fa, '#1b120c', { uvScale: 0 });
    const [gx2, gz2] = toWorld(cx, cz, fa, off, 0.09);
    b.put('wood', boxGeo(0.74, 0.07, 0.06), gx2, wy + 0.4, gz2, fa, '#5b3a22');
    b.put('wood', boxGeo(0.74, 0.07, 0.06), gx2, wy - 0.4, gz2, fa, '#5b3a22');
    for (let k = -1; k <= 1; k += 1) {
      const [bx, bz] = toWorld(cx, cz, fa, off + k * 0.18, 0.1);
      b.put('wood', boxGeo(0.045, 0.78, 0.045), bx, wy, bz, fa, '#4a2f1b');
    }
    b.put('wood', boxGeo(0.62, 0.04, 0.05), gx2, wy, gz2, fa, '#4a2f1b');
  }

  // water spouts at roofline
  for (let i = 0; i < 2; i += 1) {
    const [sx, sz] = toWorld(x, z, angle, (i === 0 ? -1 : 1) * (w / 2 - 0.6), d / 2 + 0.25);
    b.put('wood', cylGeo(0.07, 0.07, 0.6, 6), sx, top - 0.15, sz, angle, '#4b3020', undefined, Math.PI / 2);
  }

  let roofTop = top + ph;
  if (opts.upper) {
    const uw = w * 0.5;
    const ud = d * 0.5;
    const uh = 2.6;
    const [ux, uz] = toWorld(x, z, angle, -w / 4 + 0.1, -d / 4 + 0.1);
    b.put(role, boxGeo(uw, uh, ud), ux, top + uh / 2, uz, angle, shade(tint, 1.05), { uvScale: 3 });
    const [dx, dz] = toWorld(ux, uz, angle, 0, ud / 2 + 0.02);
    b.put('dark', archGeo(0.9, 1.9, 0.05), dx, top, dz, angle, '#20160f', { uvScale: 0 });
    for (const [lx, lz] of [[-uw / 2 + 0.25, -ud / 2 + 0.25], [uw / 2 - 0.25, -ud / 2 + 0.25], [-uw / 2 + 0.25, ud / 2 - 0.25], [uw / 2 - 0.25, ud / 2 - 0.25]]) {
      const [mx, mz] = toWorld(ux, uz, angle, lx, lz);
      addMerlon(b, role, mx, top + uh, mz, angle, 0.45, tint);
    }
    roofTop = top + uh + 0.6;
  } else if (rng() < 0.35) {
    // roof clutter: water jar + drying cloth line
    const [jx, jz] = toWorld(x, z, angle, w * 0.25, -d * 0.2);
    jar(ctx, jx, top, jz, 0.7);
  }

  col.addBox(x, z, w / 2, d / 2, angle, base - 2, roofTop, true, 'house');
  return top;
}

export function jar(ctx: BuildCtx, x: number, y: number, z: number, scale = 1, color = '#b5653a'): void {
  const g = latheGeo(
    [
      [0, 0],
      [0.18, 0.02],
      [0.3, 0.2],
      [0.34, 0.42],
      [0.26, 0.66],
      [0.14, 0.78],
      [0.15, 0.86],
      [0.17, 0.9],
      [0.0, 0.9],
    ].map(([r, yy]) => [r * scale, yy * scale]),
    12,
  );
  ctx.b.put('stone', g, x, y, z, ctx.rng() * 6, color, { uvScale: 0.8 });
  ctx.col.addCircle(x, z, 0.32 * scale, y - 0.5, y + 0.9 * scale, false, 'jar');
}

/** Crenellated wall from A to B, split into terrain-following segments. */
export function wall(
  ctx: BuildCtx,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  height: number,
  thick: number,
  role: MaterialRole,
  tint: string,
  merlon = 0.9,
): void {
  const { b, col, terrain } = ctx;
  const len = Math.hypot(bx - ax, bz - az);
  const segs = Math.max(1, Math.round(len / 6));
  const angle = Math.atan2(bx - ax, bz - az) - Math.PI / 2; // local x along wall
  const segLen = len / segs;
  for (let s = 0; s < segs; s += 1) {
    const t = (s + 0.5) / segs;
    const cx = ax + (bx - ax) * t;
    const cz = az + (bz - az) * t;
    const g = minGround(terrain, cx, cz, angle, segLen / 2, thick / 2);
    const base = g - 1.2;
    const top = g + height;
    b.put(role, boxGeo(segLen + 0.02, top - base, thick), cx, (top + base) / 2, cz, angle, tint, { groundY: g, aoHeight: 2.5, uvScale: 3.2 });
    // walkway lip + merlons
    b.put(role, boxGeo(segLen + 0.02, 0.3, thick + 0.2), cx, top - 0.15, cz, angle, shade(tint, 1.06), { uvScale: 3 });
    if (merlon > 0) {
      const count = Math.max(1, Math.floor(segLen / (merlon * 1.9)));
      for (let m = 0; m < count; m += 1) {
        const lt = -segLen / 2 + (m + 0.5) * (segLen / count);
        const [mx, mz] = toWorld(cx, cz, angle, lt, 0);
        addMerlon(b, role, mx, top, mz, angle, merlon, tint);
      }
    }
    col.addBox(cx, cz, segLen / 2, thick / 2, angle, base - 2, top + merlon * 1.6, true, 'wall');
  }
}

/** Tapered square tower with lozenge decoration band and corner merlons. */
export function tower(ctx: BuildCtx, x: number, z: number, half: number, height: number, role: MaterialRole, tint: string, angle = 0): void {
  const { b, col, terrain } = ctx;
  const g = minGround(terrain, x, z, angle, half, half) - 1;
  const rBottom = half * Math.SQRT2;
  const rTop = half * 0.84 * Math.SQRT2;
  const geo = cylGeo(rTop, rBottom, height + 1, 4);
  b.put(role, geo, x, g + (height + 1) / 2, z, angle + Math.PI / 4, tint, { groundY: g + 1, aoHeight: 3, uvScale: 3.2 });
  const top = g + 1 + height;
  const topHalf = half * 0.84;
  // decorative lozenges near top on each face
  for (let f = 0; f < 4; f += 1) {
    const fa = angle + (f * Math.PI) / 2;
    const [fx, fz] = toWorld(x, z, fa, 0, topHalf * 1.02 + 0.03);
    for (let k = -1; k <= 1; k += 1) {
      const [lx, lz] = toWorld(fx, fz, fa, k * topHalf * 0.55, 0);
      b.put('dark', boxGeo(0.5, 0.5, 0.06), lx, top - 2.2, lz, fa, '#3a1f12', { uvScale: 0 }, 0, Math.PI / 4);
      b.put('dark', boxGeo(0.22, 0.6, 0.06), lx, top - 3.4, lz, fa, '#2c170d', { uvScale: 0 });
    }
    // band
    b.put(role, boxGeo(topHalf * 2 + 0.2, 0.25, 0.12), ...toWorldY(x, z, fa, 0, topHalf + 0.06, top - 1.2), fa, shade(tint, 0.9), { uvScale: 2 });
  }
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const [mx, mz] = toWorld(x, z, angle, lx * (topHalf - 0.35), lz * (topHalf - 0.35));
    addMerlon(b, role, mx, top, mz, angle, 0.7, tint);
  }
  col.addBox(x, z, half, half, angle, g - 2, top + 1.2, true, 'tower');
}

function toWorldY(x: number, z: number, angle: number, lx: number, lz: number, y: number): [number, number, number] {
  const [wx, wz] = toWorld(x, z, angle, lx, lz);
  return [wx, y, wz];
}

/** Monumental gate ("bab") with a horseshoe passage, tiled arch frame and merlons. */
export function gate(ctx: BuildCtx, x: number, z: number, angle: number, wallThick: number, tint: string, role: MaterialRole = 'pise'): void {
  const { b, col, terrain } = ctx;
  const ow = 4.2;
  const oh = 5.4;
  const W = ow + 5;
  const H = 8.5;
  const g = terrain.getHeight(x, z);
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, -1.2);
  shape.lineTo(W / 2, -1.2);
  shape.lineTo(W / 2, H);
  shape.lineTo(-W / 2, H);
  shape.closePath();
  const hole = horseshoeArchShape(ow, oh);
  const pts = hole.getPoints(28).map((p) => new THREE.Vector2(p.x, Math.max(p.y, -1.19)));
  shape.holes.push(new THREE.Path(pts));
  const depth = wallThick + 1;
  b.put(role, extrudeGeo(shape, depth), x, g, z, angle, tint, { groundY: g, aoHeight: 2.5, uvScale: 3 });
  // ornamental frames on both faces
  for (const side of [1, -1]) {
    const [fx, fz] = toWorld(x, z, angle, 0, side * (depth / 2 + 0.06));
    b.put('tile', archFrameGeo(ow, oh, 0.5, 0.12), fx, g, fz, angle, '#ffffff', { uvScale: 1.6 });
    const [bx2, bz2] = toWorld(x, z, angle, 0, side * (depth / 2 + 0.08));
    b.put(role, boxGeo(ow + 2.2, 0.3, 0.2), bx2, g + oh + 0.9, bz2, angle, shade(tint, 0.85), { uvScale: 2 });
    b.put('tile', boxGeo(ow + 1.6, 0.7, 0.1), bx2, g + oh + 1.6, bz2, angle, '#ffffff', { uvScale: 1.4 });
    // lantern sockets each side of the passage
    for (const lx of [-ow / 2 - 0.9, ow / 2 + 0.9]) {
      const [lxw, lzw] = toWorld(x, z, angle, lx, side * (depth / 2 + 0.35));
      b.put('iron', boxGeo(0.08, 0.5, 0.5), lxw, g + 3.4, lzw, angle, '#3b3029');
      b.put('glow', boxGeo(0.28, 0.42, 0.28), lxw, g + 3.1, lzw, angle, '#ffffff', { uvScale: 0 });
    }
  }
  for (let m = 0; m < 5; m += 1) {
    const [mx, mz] = toWorld(x, z, angle, -W / 2 + 0.9 + m * ((W - 1.8) / 4), 0);
    addMerlon(b, role, mx, g + H, mz, angle, 0.95, tint);
  }
  // colliders: two piers either side of the passage
  const pierW = (W - ow) / 2;
  for (const side of [-1, 1]) {
    const [px, pz] = toWorld(x, z, angle, side * (ow / 2 + pierW / 2), 0);
    col.addBox(px, pz, pierW / 2, depth / 2, angle, g - 2, g + H + 2, true, 'gate');
  }
  col.addBox(x, z, ow / 2, depth / 2, angle, g + oh - 0.3, g + H + 2, true, 'gate-top');
}

/** Minaret with blind arches, zellige band, lantern and triple-ball finial (jamour). */
export function minaret(ctx: BuildCtx, x: number, z: number, angle: number): void {
  const { b, col, terrain } = ctx;
  const g = terrain.getHeight(x, z) - 0.5;
  const s = 3.6;
  const H = 21;
  const tint = '#d9b48a';
  b.put('plaster', boxGeo(s, H, s), x, g + H / 2, z, angle, tint, { groundY: g + 0.5, aoHeight: 3, uvScale: 3 });
  for (let f = 0; f < 4; f += 1) {
    const fa = angle + (f * Math.PI) / 2;
    for (const [yy, ww, hh] of [[6, 1.1, 2.4], [11, 1.5, 3.2], [15.6, 2.4, 1.6]] as [number, number, number][]) {
      const [ax2, az2] = toWorld(x, z, fa, 0, s / 2 + 0.02);
      b.put('dark', archGeo(ww, hh, 0.05), ax2, g + yy, az2, fa, '#3d2616', { uvScale: 0 });
      const [fx, fz] = toWorld(x, z, fa, 0, s / 2 + 0.05);
      b.put('plaster', archFrameGeo(ww, hh, 0.16, 0.08), fx, g + yy, fz, fa, shade(tint, 1.12), { uvScale: 2 });
    }
    // zellige band
    const [tx, tz] = toWorld(x, z, fa, 0, s / 2 + 0.04);
    b.put('tile', boxGeo(s, 1.4, 0.08), tx, g + 18.4, tz, fa, '#ffffff', { uvScale: 1.4 });
  }
  b.put('plaster', boxGeo(s + 0.5, 0.35, s + 0.5), x, g + H + 0.15, z, angle, shade(tint, 1.08));
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const [mx, mz] = toWorld(x, z, angle, lx * (s / 2 - 0.15), lz * (s / 2 - 0.15));
    addMerlon(b, 'plaster', mx, g + H + 0.3, mz, angle, 0.5, tint);
  }
  b.put('plaster', boxGeo(1.6, 3.2, 1.6), x, g + H + 1.9, z, angle, tint);
  b.put('tile', boxGeo(1.66, 0.8, 1.66), x, g + H + 2.9, z, angle, '#ffffff', { uvScale: 1.2 });
  b.put('stone', new THREE.SphereGeometry(0.85, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), x, g + H + 3.5, z, angle, '#2d7a55', { uvScale: 1 });
  b.put('iron', cylGeo(0.04, 0.04, 2.2, 6), x, g + H + 5, z, 0, '#d1a54b');
  for (const [yy, r] of [[4.6, 0.26], [5.2, 0.2], [5.7, 0.14]]) {
    b.put('iron', new THREE.SphereGeometry(r, 10, 8), x, g + H + yy, z, 0, '#e2b85a', { uvScale: 0 });
  }
  col.addBox(x, z, s / 2, s / 2, angle, g - 1, g + H + 6, true, 'minaret');
}

/** Wall fountain (seqqaya) with zellige panel and basin. Returns the water point. */
export function fountain(ctx: BuildCtx, x: number, z: number, angle: number): THREE.Vector3 {
  const { b, col, terrain } = ctx;
  const g = terrain.getHeight(x, z);
  b.put('plaster', boxGeo(3.4, 4.2, 0.9), x, g + 1.9, z, angle, '#e6c9a2', { groundY: g });
  const [tx, tz] = toWorld(x, z, angle, 0, 0.47);
  b.put('tile', boxGeo(2.4, 2, 0.06), tx, g + 1.9, tz, angle, '#ffffff', { uvScale: 1.1 });
  const [fx, fz] = toWorld(x, z, angle, 0, 0.5);
  b.put('plaster', archFrameGeo(2.4, 3.1, 0.3, 0.14), fx, g + 0.6, fz, angle, '#f1dcbc');
  const [rx, rz] = toWorld(x, z, angle, 0, 0.5);
  b.put('wood', boxGeo(3.6, 0.25, 0.7), rx, g + 4.05, rz, angle, '#5b3a22');
  for (let k = -4; k <= 4; k += 1) {
    const [cx, cz] = toWorld(x, z, angle, k * 0.4, 0.7);
    b.put('tile', boxGeo(0.3, 0.12, 0.5), cx, g + 4.2, cz, angle, '#2a7a52', { uvScale: 0.6 });
  }
  const [bx, bz] = toWorld(x, z, angle, 0, 1.0);
  b.put('stone', boxGeo(2.8, 0.6, 1.1), bx, g + 0.3, bz, angle, '#8d8577', { groundY: g });
  b.put('iron', boxGeo(2.5, 0.04, 0.85), bx, g + 0.58, bz, angle, '#2f6f78', { uvScale: 0 });
  const [sx, sz] = toWorld(x, z, angle, 0, 0.6);
  b.put('iron', cylGeo(0.05, 0.05, 0.4, 6), sx, g + 1.4, sz, angle, '#b8925a', undefined, Math.PI / 2);
  col.addBox(x, z, 1.7, 0.45, angle, g - 1, g + 4.3, true, 'fountain');
  col.addBox(bx, bz, 1.4, 0.55, angle, g - 1, g + 0.6, false, 'basin');
  const [px, pz] = toWorld(x, z, angle, 0, 2.0);
  return new THREE.Vector3(px, g, pz);
}

/** Village well with pulley frame. */
export function well(ctx: BuildCtx, x: number, z: number): THREE.Vector3 {
  const { b, col, terrain } = ctx;
  const g = terrain.getHeight(x, z);
  const ring = latheGeo([[1.25, 0], [1.25, 0.95], [1.1, 1.0], [0.95, 1.0], [0.95, -0.4]], 18);
  b.put('stone', ring, x, g - 0.05, z, 0, '#a99a85', { groundY: g, uvScale: 1.2 });
  b.put('dark', cylGeo(0.94, 0.94, 0.05, 16), x, g + 0.6, z, 0, '#0b0a08', { uvScale: 0 });
  for (const s of [-1, 1]) b.put('wood', boxGeo(0.16, 2.3, 0.16), x + s * 1.05, g + 1.15, z, 0, '#5b3a22');
  b.put('wood', cylGeo(0.07, 0.07, 2.4, 8), x, g + 2.2, z, 0, '#6a4528', undefined, 0, Math.PI / 2);
  b.put('wood', cylGeo(0.18, 0.18, 0.12, 12), x, g + 2.2, z, 0, '#4a2f1b', undefined, 0, Math.PI / 2);
  b.put('iron', cylGeo(0.012, 0.012, 1.2, 4), x, g + 1.6, z, 0, '#8a7a60');
  b.put('wood', latheGeo([[0, 0], [0.16, 0], [0.2, 0.3], [0, 0.3]], 10), x, g + 0.75, z, 0, '#5a3a24');
  col.addCircle(x, z, 1.3, g - 1, g + 1.1, false, 'well');
  return new THREE.Vector3(x, g, z);
}

/** Clay bread oven (ferran). */
export function oven(ctx: BuildCtx, x: number, z: number, angle: number): THREE.Vector3 {
  const { b, col, terrain } = ctx;
  const g = terrain.getHeight(x, z);
  b.put('pise', new THREE.SphereGeometry(1.4, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), x, g - 0.05, z, angle, '#b9774a', { groundY: g, uvScale: 1.5 });
  const [ox, oz] = toWorld(x, z, angle, 0, 1.18);
  b.put('dark', archGeo(0.75, 0.75, 0.5), ox, g, oz, angle, '#120804', { uvScale: 0 });
  b.put('glow', boxGeo(0.5, 0.18, 0.2), ox, g + 0.12, oz, angle, '#ffffff', { uvScale: 0 });
  const [cx, cz] = toWorld(x, z, angle, 0.3, -0.4);
  b.put('pise', cylGeo(0.16, 0.22, 0.6, 8), cx, g + 1.45, cz, angle, '#8a5434');
  // bread board
  const [bx, bz] = toWorld(x, z, angle, 1.4, 1.2);
  b.put('wood', boxGeo(1.2, 0.08, 0.6), bx, g + 0.8, bz, angle, '#7a5532');
  for (const s of [-1, 1]) {
    const [lx, lz] = toWorld(bx, bz, angle, s * 0.5, 0);
    b.put('wood', boxGeo(0.08, 0.8, 0.5), lx, g + 0.4, lz, angle, '#5a3a24');
  }
  for (let k = 0; k < 3; k += 1) {
    const [rx, rz] = toWorld(bx, bz, angle, -0.35 + k * 0.35, 0);
    b.put('pise', new THREE.SphereGeometry(0.15, 10, 6), rx, g + 0.86, rz, angle, '#d49a55', { uvScale: 0 }, 0, 0);
  }
  col.addCircle(x, z, 1.4, g - 1, g + 1.4, false, 'oven');
  col.addBox(bx, bz, 0.6, 0.3, angle, g, g + 0.85, false, 'bench');
  const [px, pz] = toWorld(x, z, angle, 0.6, 2.4);
  return new THREE.Vector3(px, g, pz);
}

const AWNING = ['#9c2a2a', '#c48a2a', '#2c5a7a', '#6b3e7a', '#2f6b45', '#b5562a'];
const SPICE = ['#b0301e', '#d8a023', '#c8641c', '#6e7d2a', '#8a4b2a'];

/** Souk stall: posts, striped awning, counter, cones of spice, jars and rugs. */
export function stall(ctx: BuildCtx, x: number, z: number, angle: number): void {
  const { b, col, terrain, rng } = ctx;
  const g = terrain.getHeight(x, z);
  const W = 2.8;
  const D = 1.8;
  for (const [lx, lz, hh] of [[-W / 2, -D / 2, 2.6], [W / 2, -D / 2, 2.6], [-W / 2, D / 2, 2.1], [W / 2, D / 2, 2.1]] as [number, number, number][]) {
    const [px, pz] = toWorld(x, z, angle, lx, lz);
    b.put('wood', boxGeo(0.1, hh, 0.1), px, g + hh / 2, pz, angle, '#5b3a22');
    col.addCircle(px, pz, 0.08, g - 1, g + hh, false, 'stall-post');
  }
  const color = AWNING[Math.floor(rng() * AWNING.length)];
  for (let sIdx = 0; sIdx < 5; sIdx += 1) {
    const [ax2, az2] = toWorld(x, z, angle, -W / 2 + (sIdx + 0.5) * (W / 5), 0.1);
    b.put('fabric', boxGeo(W / 5, 0.03, D + 0.9), ax2, g + 2.4, az2, angle, sIdx % 2 ? '#e9dcc0' : color, { uvScale: 1 }, -0.26);
  }
  const [cx, cz] = toWorld(x, z, angle, 0, 0.5);
  b.put('wood', boxGeo(W - 0.2, 0.85, 0.7), cx, g + 0.42, cz, angle, '#6a4528', { groundY: g });
  for (let k = 0; k < 4; k += 1) {
    const [sx, sz] = toWorld(x, z, angle, -1 + k * 0.66, 0.5);
    b.put('stone', new THREE.ConeGeometry(0.22, 0.32, 10), sx, g + 1.0, sz, 0, SPICE[Math.floor(rng() * SPICE.length)], { uvScale: 0 });
  }
  const [jx, jz] = toWorld(x, z, angle, W / 2 + 0.3, 0.8);
  jar(ctx, jx, g, jz, 0.9 + rng() * 0.4);
  if (rng() < 0.6) {
    // hanging rug behind
    const [rx, rz] = toWorld(x, z, angle, 0, -D / 2 + 0.05);
    const rc = AWNING[Math.floor(rng() * AWNING.length)];
    b.put('fabric', boxGeo(2, 1.6, 0.03), rx, g + 1.3, rz, angle, rc, { uvScale: 0.8 });
    b.put('fabric', boxGeo(1.4, 1.0, 0.035), rx, g + 1.3, rz, angle, shade(rc, 1.5), { uvScale: 0.8 });
    b.put('fabric', boxGeo(0.5, 0.5, 0.04), rx, g + 1.3, rz, angle, '#1f2c4a', { uvScale: 0.8 }, 0, Math.PI / 4);
    col.addBox(rx, rz, 1, 0.05, angle, g + 0.5, g + 2.1, true, 'rug');
  }
  col.addBox(cx, cz, W / 2 - 0.1, 0.35, angle, g - 1, g + 0.9, false, 'stall');
}

/** Pierced-brass Moroccan lantern hanging from a wall bracket; returns the glow point. */
export function lantern(ctx: BuildCtx, x: number, y: number, z: number, angle: number): THREE.Vector3 {
  const { b } = ctx;
  const [bx, bz] = toWorld(x, z, angle, 0, 0.45);
  b.put('iron', boxGeo(0.05, 0.05, 0.6), bx, y + 0.55, bz, angle, '#2a2622');
  b.put('metal', new THREE.CylinderGeometry(0.02, 0.02, 0.35, 5), bx, y + 0.33, bz, 0, '#8a6a2a');
  b.put('metal', new THREE.ConeGeometry(0.17, 0.2, 8), bx, y + 0.12, bz, 0, '#b8902e');
  b.put('glow', new THREE.CylinderGeometry(0.14, 0.11, 0.32, 8), bx, y - 0.13, bz, 0, '#ffb35a', { uvScale: 0 });
  b.put('metal', new THREE.ConeGeometry(0.13, 0.12, 8), bx, y - 0.34, bz, 0, '#b8902e', undefined, Math.PI);
  return new THREE.Vector3(bx, y - 0.1, bz);
}

/** Laundry line between two points: rope sagging with hanging cloths. */
export function laundry(ctx: BuildCtx, ax: number, az: number, bx: number, bz: number, y: number): void {
  const { b, rng } = ctx;
  const len = Math.hypot(bx - ax, bz - az);
  const ang = Math.atan2(bx - ax, bz - az);
  const n = Math.max(2, Math.round(len / 0.9));
  for (let i = 0; i < n; i += 1) {
    const t = (i + 0.5) / n;
    const sag = Math.sin(Math.PI * t) * 0.35;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    b.put('fabric', new THREE.CylinderGeometry(0.01, 0.01, len / n, 4), x, y - sag, z, ang, '#d8cfb8', { uvScale: 0 }, Math.PI / 2);
    if (rng() < 0.75) {
      const w = 0.4 + rng() * 0.4;
      const h = 0.5 + rng() * 0.6;
      b.put('fabric', boxGeo(w, h, 0.02), x, y - sag - h / 2, z, ang + Math.PI / 2, LAUNDRY[Math.floor(rng() * LAUNDRY.length)], { uvScale: 0.5 });
    }
  }
}

/** Terracotta pot with a small shrub or geranium. */
export function pottedPlant(ctx: BuildCtx, x: number, z: number, flowers: boolean): void {
  const { b, terrain, rng } = ctx;
  const g = terrain.getHeight(x, z);
  b.put('pise', new THREE.CylinderGeometry(0.26, 0.18, 0.42, 10), x, g + 0.21, z, 0, '#b5653a');
  b.put('foliage', new THREE.IcosahedronGeometry(0.34, 0), x, g + 0.68, z, rng() * 3, '#5e7a3a');
  ctx.col.addCircle(x, z, 0.28, g - 0.5, g + 1, false, 'pot');
  if (flowers) {
    for (let k = 0; k < 5; k += 1) {
      b.put('fabric', new THREE.IcosahedronGeometry(0.07, 0), x + (rng() - 0.5) * 0.5, g + 0.8 + rng() * 0.2, z + (rng() - 0.5) * 0.5, 0, rng() < 0.5 ? '#d8344a' : '#f2f0ea', { uvScale: 0 });
    }
  }
}

/** Wooden handcart loaded with sacks. */
export function handcart(ctx: BuildCtx, x: number, z: number, angle: number): void {
  const { b, col, terrain, rng } = ctx;
  const g = terrain.getHeight(x, z);
  b.put('wood', boxGeo(1.1, 0.12, 1.7), x, g + 0.62, z, angle, '#6b4a2c', undefined, 0.08);
  for (const s of [-1, 1]) {
    const [wx, wz] = toWorld(x, z, angle, s * 0.62, 0.2);
    b.put('wood', new THREE.CylinderGeometry(0.42, 0.42, 0.07, 12), wx, g + 0.42, wz, angle + Math.PI / 2, '#4a3020', undefined, 0, Math.PI / 2);
    const [hx, hz] = toWorld(x, z, angle, s * 0.4, -1.4);
    b.put('wood', boxGeo(0.06, 0.06, 1.2), hx, g + 0.45, hz, angle, '#5a3a24', undefined, -0.3);
  }
  for (let k = 0; k < 3; k += 1) {
    const [sx, sz] = toWorld(x, z, angle, -0.25 + (k % 2) * 0.5, -0.4 + k * 0.4);
    b.put('fabric', new THREE.SphereGeometry(0.3, 8, 6), sx, g + 0.9, sz, rng(), '#c8b083', { uvScale: 0.6 });
  }
  col.addBox(x, z, 0.6, 0.9, angle, g - 1, g + 1.1, false, 'cart');
}

/** Laden donkey (static prop) with panniers. */
export function donkey(ctx: BuildCtx, x: number, z: number, angle: number): void {
  const { b, col, terrain } = ctx;
  const g = terrain.getHeight(x, z);
  const coat = '#7d726a';
  const P = (lx: number, ly: number, lz: number): [number, number, number] => {
    const [wx, wz] = toWorld(x, z, angle, lx, lz);
    return [wx, g + ly, wz];
  };
  let [px, py, pz] = P(0, 0.95, 0);
  b.put('fabric', new THREE.CapsuleGeometry(0.28, 0.75, 4, 10), px, py, pz, angle, coat, { uvScale: 0.6 }, Math.PI / 2);
  for (const [lx, lz] of [[-0.17, 0.42], [0.17, 0.42], [-0.17, -0.42], [0.17, -0.42]]) {
    [px, py, pz] = P(lx, 0.42, lz);
    b.put('fabric', new THREE.CylinderGeometry(0.06, 0.05, 0.84, 6), px, py, pz, angle, coat, { uvScale: 0 });
    [px, py, pz] = P(lx, 0.03, lz);
    b.put('dark', boxGeo(0.1, 0.06, 0.12), px, py, pz, angle, '#2a2420');
  }
  [px, py, pz] = P(0, 1.3, 0.62);
  b.put('fabric', new THREE.CylinderGeometry(0.11, 0.15, 0.5, 8), px, py, pz, angle, coat, { uvScale: 0 }, 0.7);
  [px, py, pz] = P(0, 1.5, 0.9);
  b.put('fabric', new THREE.CapsuleGeometry(0.12, 0.28, 4, 8), px, py, pz, angle, coat, { uvScale: 0 }, 1.2);
  [px, py, pz] = P(0, 1.45, 1.06);
  b.put('fabric', new THREE.SphereGeometry(0.1, 8, 6), px, py, pz, angle, '#d8d0c4', { uvScale: 0 });
  for (const s of [-1, 1]) {
    [px, py, pz] = P(s * 0.08, 1.74, 0.82);
    b.put('fabric', new THREE.ConeGeometry(0.045, 0.26, 5), px, py, pz, angle, coat, { uvScale: 0 }, -0.3, s * 0.3);
    [px, py, pz] = P(s * 0.36, 0.95, 0);
    b.put('fabric', boxGeo(0.22, 0.42, 0.55), px, py, pz, angle, s > 0 ? '#8a5a2a' : '#7a3a22', { uvScale: 0.5 });
  }
  [px, py, pz] = P(0, 1.25, 0);
  b.put('fabric', boxGeo(0.6, 0.06, 0.62), px, py, pz, angle, '#b3201f', { uvScale: 0.5 });
  col.addBox(x, z, 0.35, 0.8, angle, g - 1, g + 1.6, false, 'donkey');
}

/** Military gable tent. */
export function tent(ctx: BuildCtx, x: number, z: number, angle: number): void {
  const { b, col, terrain } = ctx;
  const g = terrain.getHeight(x, z);
  const W = 3.6;
  const L = 4.6;
  const H = 2.4;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0);
  shape.lineTo(W / 2, 0);
  shape.lineTo(0, H);
  shape.closePath();
  b.put('fabric', extrudeGeo(shape, L), x, g, z, angle, '#8b8456', { groundY: g, aoHeight: 1, uvScale: 1.4 });
  const [dx, dz] = toWorld(x, z, angle, 0, L / 2 + 0.01);
  const door = new THREE.Shape();
  door.moveTo(-0.6, 0);
  door.lineTo(0.6, 0);
  door.lineTo(0, 1.7);
  door.closePath();
  b.put('dark', extrudeGeo(door, 0.04), dx, g, dz, angle, '#1e1c12', { uvScale: 0 });
  b.put('wood', boxGeo(0.07, 0.07, L + 0.6), x, g + H + 0.02, z, angle, '#4a3020');
  col.addBox(x, z, W / 2, L / 2, angle, g - 1, g + H, true, 'tent');
}

/** Whitewashed barracks with corrugated gabled roof, shuttered windows. */
export function barracks(ctx: BuildCtx, x: number, z: number, w: number, d: number, angle: number, sign?: string): THREE.Vector3 {
  const { b, col, terrain } = ctx;
  const g = minGround(terrain, x, z, angle, w / 2, d / 2);
  const h = 3.4;
  b.put('plaster', boxGeo(w, h + 1, d), x, g + (h - 1) / 2, z, angle, '#e8e1d3', { groundY: g, aoHeight: 1.4, uvScale: 3 });
  b.put('plaster', boxGeo(w + 0.06, 0.9, d + 0.06), x, g + 0.25, z, angle, '#a98a68', { uvScale: 3 });
  // gables
  const gable = new THREE.Shape();
  gable.moveTo(-d / 2, 0);
  gable.lineTo(d / 2, 0);
  gable.lineTo(0, 1.6);
  gable.closePath();
  for (const side of [-1, 1]) {
    const [gx, gz] = toWorld(x, z, angle, side * (w / 2 - 0.1), 0);
    b.put('plaster', extrudeGeo(gable, 0.2), gx, g + h, gz, angle + Math.PI / 2, '#e8e1d3', { uvScale: 3 });
  }
  const slope = Math.atan2(1.6, d / 2);
  const rl = Math.hypot(1.6, d / 2) + 0.5;
  for (const side of [-1, 1]) {
    const [rx, rz] = toWorld(x, z, angle, 0, side * (d / 4 + 0.05));
    b.put('metal', boxGeo(w + 0.8, 0.06, rl), rx, g + h + 0.8, rz, angle, '#8d918f', { uvScale: 2 }, side * slope);
  }
  // door + windows on front (+z)
  const [dx, dz] = toWorld(x, z, angle, 0, d / 2 + 0.03);
  b.put('wood', boxGeo(1.3, 2.3, 0.08), dx, g + 1.15, dz, angle, '#3d5a3f');
  b.put('plaster', boxGeo(1.7, 0.25, 0.12), dx, g + 2.45, dz, angle, '#bfb6a6');
  for (let k = -2; k <= 2; k += 1) {
    if (k === 0) continue;
    const off = (k * w) / 5.5;
    const [wx, wz] = toWorld(x, z, angle, off, d / 2 + 0.03);
    b.put('dark', boxGeo(0.9, 1.1, 0.06), wx, g + 1.9, wz, angle, '#161a1c', { uvScale: 0 });
    for (const s of [-1, 1]) {
      const [sx, sz] = toWorld(x, z, angle, off + s * 0.68, d / 2 + 0.06);
      b.put('wood', boxGeo(0.45, 1.2, 0.05), sx, g + 1.9, sz, angle, '#3d6b4a');
    }
  }
  if (sign) {
    const [sx, sz] = toWorld(x, z, angle, 0, d / 2 + 0.07);
    b.put('wood', boxGeo(2.6, 0.5, 0.05), sx, g + 2.95, sz, angle, '#2a2622');
  }
  col.addBox(x, z, w / 2, d / 2, angle, g - 2, g + h + 1.6, true, 'barracks');
  const [fx, fz] = toWorld(x, z, angle, 0, d / 2 + 1.6);
  return new THREE.Vector3(fx, g, fz);
}

/** Wooden watchtower. Returns the platform standing point. */
export function watchtower(ctx: BuildCtx, x: number, z: number): THREE.Vector3 {
  const { b, col, terrain } = ctx;
  const g = terrain.getHeight(x, z);
  const H = 6.2;
  const s = 1.5;
  for (const [lx, lz] of [[-s, -s], [s, -s], [-s, s], [s, s]]) {
    b.put('wood', boxGeo(0.22, H + 2.4, 0.22), x + lx, g + (H + 2.4) / 2 - 0.2, z + lz, 0, '#6b4a2e');
    col.addCircle(x + lx, z + lz, 0.2, g - 1, g + H, false, 'tower-leg');
  }
  for (const [ax2, az2, rot] of [[0, -s, 0], [0, s, 0], [-s, 0, Math.PI / 2], [s, 0, Math.PI / 2]] as [number, number, number][]) {
    b.put('wood', boxGeo(s * 2.4, 0.12, 0.12), x + ax2, g + H * 0.45, z + az2, rot, '#5b3a22', undefined, 0, 0.9);
    b.put('wood', boxGeo(s * 2.4, 0.12, 0.12), x + ax2, g + H * 0.45, z + az2, rot, '#5b3a22', undefined, 0, -0.9);
  }
  b.put('wood', boxGeo(s * 2 + 0.8, 0.2, s * 2 + 0.8), x, g + H, z, 0, '#7a5532');
  for (const [ax2, az2, rot] of [[0, -s - 0.35, 0], [0, s + 0.35, 0], [-s - 0.35, 0, Math.PI / 2], [s + 0.35, 0, Math.PI / 2]] as [number, number, number][]) {
    b.put('wood', boxGeo(s * 2 + 0.8, 0.9, 0.08), x + ax2, g + H + 0.55, z + az2, rot, '#6b4a2e');
  }
  b.put('metal', new THREE.ConeGeometry(s * 1.9, 1.3, 4), x, g + H + 2.75, z, Math.PI / 4, '#7b7f7c', { uvScale: 1.5 });
  // ladder
  for (const s2 of [-0.3, 0.3]) b.put('wood', boxGeo(0.08, H, 0.08), x + s2, g + H / 2, z + s + 0.6, 0, '#5b3a22', undefined, -0.12);
  for (let r = 0; r < 12; r += 1) b.put('wood', boxGeo(0.6, 0.05, 0.05), x, g + 0.4 + r * 0.5, z + s + 0.6 - r * 0.06 + 0.35, 0, '#5b3a22');
  return new THREE.Vector3(x, g + H + 0.1, z);
}

/** Row of sandbags along a local line. */
export function sandbags(ctx: BuildCtx, x: number, z: number, angle: number, len: number): void {
  const { b, col, terrain, rng } = ctx;
  const g = terrain.getHeight(x, z);
  const per = 0.62;
  const n = Math.max(1, Math.floor(len / per));
  for (let row = 0; row < 3; row += 1) {
    const off = row % 2 ? per / 2 : 0;
    for (let i = 0; i < n - (row % 2); i += 1) {
      const lx = -len / 2 + per / 2 + i * per + off;
      const [sx, sz] = toWorld(x, z, angle, lx, 0);
      b.put('fabric', boxGeo(0.58, 0.26, 0.38), sx, g + 0.13 + row * 0.25, sz, angle + (rng() - 0.5) * 0.12, '#a99d74', { uvScale: 0.6, jitter: 0.12 });
    }
  }
  col.addBox(x, z, len / 2, 0.22, angle, g - 1, g + 0.95, false, 'sandbags');
}

/** Barbed-wire fence through points; leaves gaps where `gaps` says. Fences don't block sight. */
export function barbedFence(ctx: BuildCtx, pts: number[][]): void {
  const { b, col, terrain } = ctx;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const angle = Math.atan2(bx - ax, bz - az) - Math.PI / 2;
    const n = Math.max(1, Math.round(len / 3));
    for (let k = 0; k <= n; k += 1) {
      const t = k / n;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      const g = terrain.getHeight(px, pz);
      b.put('wood', boxGeo(0.12, 1.9, 0.12), px, g + 0.75, pz, angle, '#5b4632', undefined, 0, (k % 2 ? 0.06 : -0.05));
      if (k < n) {
        const mx = ax + (bx - ax) * (t + 0.5 / n);
        const mz = az + (bz - az) * (t + 0.5 / n);
        const gm = terrain.getHeight(mx, mz);
        for (let s = 0; s < 4; s += 1) {
          b.put('iron', boxGeo(len / n, 0.025, 0.025), mx, gm + 0.35 + s * 0.38, mz, angle, '#5a5550', { uvScale: 0 }, 0, (s % 2 ? 0.01 : -0.01));
        }
        col.addBox(mx, mz, len / n / 2, 0.15, angle, gm - 1, gm + 1.7, false, 'fence');
      }
    }
  }
}

/** Military truck (Laffly-style cab, canvas bed). */
export function truck(ctx: BuildCtx, x: number, z: number, angle: number): void {
  const { b, col, terrain } = ctx;
  const g = terrain.getHeight(x, z);
  const olive = '#55573a';
  const P = (lx: number, ly: number, lz: number): [number, number, number] => {
    const [wx, wz] = toWorld(x, z, angle, lx, lz);
    return [wx, g + ly, wz];
  };
  b.put('metal', boxGeo(2.2, 0.3, 6.2), ...P(0, 0.85, 0), angle, '#2b2b27');
  b.put('metal', boxGeo(2.1, 1.0, 1.7), ...P(0, 1.45, 2.3), angle, olive);
  b.put('metal', boxGeo(2.1, 1.3, 1.5), ...P(0, 1.95, 0.9), angle, olive);
  b.put('dark', boxGeo(1.8, 0.55, 0.05), ...P(0, 2.25, 1.67), angle, '#1a2226', { uvScale: 0 });
  for (const s of [-1, 1]) {
    b.put('glow', cylGeo(0.13, 0.13, 0.08, 10), ...P(s * 0.7, 1.55, 3.18), angle, '#ffffff', { uvScale: 0 }, Math.PI / 2);
    b.put('metal', boxGeo(0.5, 0.15, 1.3), ...P(s * 1.05, 1.1, 2.3), angle, olive);
  }
  b.put('wood', boxGeo(2.2, 0.8, 3.2), ...P(0, 1.4, -1.6), angle, '#6b5a3a');
  b.put('fabric', new THREE.CylinderGeometry(1.15, 1.15, 3.3, 14, 1, false, -Math.PI / 2, Math.PI), ...P(0, 1.8, -1.6), angle, '#77724e', { uvScale: 1.2 }, Math.PI / 2);
  for (const [lx, lz] of [[-1.05, 2.2], [1.05, 2.2], [-1.05, -1.1], [1.05, -1.1], [-1.05, -2.3], [1.05, -2.3]]) {
    b.put('dark', cylGeo(0.48, 0.48, 0.32, 14), ...P(lx, 0.48, lz), angle, '#151413', { uvScale: 0 }, 0, Math.PI / 2);
    b.put('metal', cylGeo(0.22, 0.22, 0.34, 8), ...P(lx, 0.48, lz), angle, '#4a4a40', undefined, 0, Math.PI / 2);
  }
  col.addBox(x, z, 1.15, 3.2, angle, g - 1, g + 3, true, 'truck');
}

export function crate(ctx: BuildCtx, x: number, y: number, z: number, angle: number, size = 0.9, color = '#6f5a3a'): BoxCollider {
  const { b } = ctx;
  b.put('wood', boxGeo(size, size * 0.8, size * 1.3), x, y + size * 0.4, z, angle, color, { uvScale: 1 });
  for (const s of [-1, 1]) {
    const [bx, bz] = toWorld(x, z, angle, 0, s * size * 0.5);
    b.put('wood', boxGeo(size + 0.04, size * 0.84, 0.08), bx, y + size * 0.4, bz, angle, shade(color, 0.7), { uvScale: 1 });
  }
  return ctx.col.addBox(x, z, size / 2, size * 0.68, angle, y - 0.5, y + size * 0.8, false, 'crate');
}

export function barrel(ctx: BuildCtx, x: number, y: number, z: number, color = '#4d5a3c'): void {
  const g = latheGeo([[0, 0], [0.36, 0], [0.4, 0.15], [0.43, 0.5], [0.4, 0.85], [0.36, 1.0], [0, 1.0]], 14);
  ctx.b.put('metal', g, x, y, z, ctx.rng() * 6, color, { uvScale: 0.7 });
  ctx.col.addCircle(x, z, 0.43, y - 0.5, y + 1, false, 'barrel');
}

export function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  c.r = Math.min(1, c.r);
  c.g = Math.min(1, c.g);
  c.b = Math.min(1, c.b);
  return `#${c.getHexString()}`;
}
