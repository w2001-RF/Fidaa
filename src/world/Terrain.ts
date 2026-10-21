import * as THREE from 'three';
import { Noise2D, PeriodicNoise, clamp, lerp, smoothstep } from '../utils/noise';
import { AIRSTRIP, LAKE, OUED, PLAY_RADIUS, RAIL, WORLD_HALF, ZONES, distToPolyline, distToRoads, zone } from './layout';

const SEGMENTS = 256;
const CELL = (WORLD_HALF * 2) / SEGMENTS;

/**
 * Heightfield terrain. The mesh and getHeight() share one grid with the same
 * triangle split, so characters stand exactly on the rendered surface.
 */
export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly water: THREE.Mesh;
  readonly lakeWater: THREE.Mesh;
  /** natural ground height at each rail vertex: the track is graded linearly between them */
  private railGrade: number[] = [];
  private readonly heights: Float32Array;
  private readonly noise = new Noise2D(1945);
  private readonly detail = new Noise2D(56);

  constructor() {
    const n = SEGMENTS + 1;
    this.heights = new Float32Array(n * n);
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const x = -WORLD_HALF + i * CELL;
        const z = -WORLD_HALF + j * CELL;
        this.heights[j * n + i] = this.computeHeight(x, z);
      }
    }
    this.mesh = this.buildMesh();
    this.water = this.buildWater();
    this.lakeWater = this.buildLake();
  }

  /** Exact height on the rendered triangle surface. */
  getHeight(x: number, z: number): number {
    const n = SEGMENTS + 1;
    const gx = clamp((x + WORLD_HALF) / CELL, 0, SEGMENTS - 0.0001);
    const gz = clamp((z + WORLD_HALF) / CELL, 0, SEGMENTS - 0.0001);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const h00 = this.heights[j * n + i];
    const h10 = this.heights[j * n + i + 1];
    const h01 = this.heights[(j + 1) * n + i];
    const h11 = this.heights[(j + 1) * n + i + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** Approximate slope (0 flat … 1 = 45°). */
  getSlope(x: number, z: number): number {
    const d = 1.5;
    const dx = this.getHeight(x + d, z) - this.getHeight(x - d, z);
    const dz = this.getHeight(x, z + d) - this.getHeight(x, z - d);
    return Math.hypot(dx, dz) / (2 * d);
  }

  normalAt(x: number, z: number, target: THREE.Vector3): THREE.Vector3 {
    const d = 1;
    const dx = this.getHeight(x + d, z) - this.getHeight(x - d, z);
    const dz = this.getHeight(x, z + d) - this.getHeight(x, z - d);
    return target.set(-dx, 2 * d, -dz).normalize();
  }

  /** March a segment against the terrain; returns hit fraction or -1. */
  raycastSegment(from: THREE.Vector3, to: THREE.Vector3, step = 1.2): number {
    const len = from.distanceTo(to);
    const steps = Math.max(2, Math.ceil(len / step));
    let prevT = 0;
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const x = lerp(from.x, to.x, t);
      const y = lerp(from.y, to.y, t);
      const z = lerp(from.z, to.z, t);
      if (y < this.getHeight(x, z)) {
        // refine
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 6; k += 1) {
          const mid = (lo + hi) / 2;
          const my = lerp(from.y, to.y, mid);
          if (my < this.getHeight(lerp(from.x, to.x, mid), lerp(from.z, to.z, mid))) hi = mid;
          else lo = mid;
        }
        return hi;
      }
      prevT = t;
    }
    return -1;
  }

  /** Natural height before plateaus — used to colour slopes/roads. */
  private computeHeight(x: number, z: number, rail = true): number {
    const nz = this.noise;
    let h = nz.fbm(x * 0.0065, z * 0.0065, 5) * 10 + nz.ridged(x * 0.011 + 40, z * 0.011 - 12, 3) * 9 - 3;
    // gentle hills band
    h += Math.max(0, nz.fbm(x * 0.0025 + 7, z * 0.0025 + 3, 2)) * 14;

    // Atlas ring
    const r = Math.hypot(x, z);
    const m = smoothstep(PLAY_RADIUS - 18, PLAY_RADIUS + 70, r);
    if (m > 0) {
      const ridge = nz.ridged(x * 0.008, z * 0.008, 5);
      h += m * (16 + ridge * 38 + m * 46);
    }

    // Oued carved bed
    const dOued = distToPolyline(x, z, OUED);
    h -= (1 - smoothstep(2, 10, dOued)) * 3.2;

    // Zone plateaus
    for (const zn of ZONES) {
      const d = Math.hypot(x - zn.x, z - zn.z);
      const w = 1 - smoothstep(zn.radius, zn.radius + zn.blend, d);
      if (w > 0) h = lerp(h, zn.height, w);
    }

    // Oasis pond bowl
    const oasis = zone('oasis');
    const dp = Math.hypot(x - oasis.x, z - oasis.z);
    h -= (1 - smoothstep(4, 11, dp)) * 2.2;

    // Roads: soften bumps along them
    const dr = distToRoads(x, z);
    const wr = 1 - smoothstep(2.5, 9, dr);
    if (wr > 0) {
      const smooth = nz.fbm(x * 0.0025 + 7, z * 0.0025 + 3, 1) * 4;
      h = lerp(h, Math.min(h, smooth + h * 0.6), wr * 0.35);
    }

    // Airstrip: flat dirt runway with soft shoulders
    const ax = Math.max(0, Math.abs(x - AIRSTRIP.x) - AIRSTRIP.halfW);
    const az = Math.max(0, Math.abs(z - AIRSTRIP.z) - AIRSTRIP.halfL);
    const wa = 1 - smoothstep(0, 18, Math.hypot(ax, az));
    if (wa > 0) h = lerp(h, AIRSTRIP.height, wa);

    // Lake: flattened shore, then a bowl below the water line
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    const wl = 1 - smoothstep(LAKE.r, LAKE.r + 28, dl);
    if (wl > 0) h = lerp(h, 0.6, wl);
    h -= (1 - smoothstep(LAKE.r * 0.3, LAKE.r + 4, dl)) * 5.5;

    // Railway: graded bed between the natural heights at the track vertices
    if (rail) {
      if (this.railGrade.length === 0) this.railGrade = RAIL.map(([rx, rz]) => this.computeHeight(rx, rz, false));
      let best = Infinity;
      let grade = 0;
      for (let i = 0; i < RAIL.length - 1; i += 1) {
        const [x0, z0] = RAIL[i];
        const [x1, z1] = RAIL[i + 1];
        const dx = x1 - x0;
        const dz = z1 - z0;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz)));
        const d = Math.hypot(x0 + dx * t - x, z0 + dz * t - z);
        if (d < best) {
          best = d;
          grade = lerp(this.railGrade[i], this.railGrade[i + 1], t);
        }
      }
      const wrl = 1 - smoothstep(3, 14, best);
      if (wrl > 0) h = lerp(h, grade, wrl);
    }
    return h;
  }

  private buildMesh(): THREE.Mesh {
    const n = SEGMENTS + 1;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const uvs = new Float32Array(n * n * 2);
    const c = new THREE.Color();
    const earth = new THREE.Color('#b8693d');
    const ochre = new THREE.Color('#cf8f55');
    const dust = new THREE.Color('#dcb07c');
    const scrub = new THREE.Color('#7f7f46');
    const green = new THREE.Color('#5f7037');
    const rock = new THREE.Color('#7a6656');
    const darkRock = new THREE.Color('#5a4a40');
    const snow = new THREE.Color('#f1efe9');
    const road = new THREE.Color('#e0c08f');
    const packed = new THREE.Color('#c99f72');
    const ballast = new THREE.Color('#8a8078');

    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const idx = j * n + i;
        const x = -WORLD_HALF + i * CELL;
        const z = -WORLD_HALF + j * CELL;
        const h = this.heights[idx];
        positions[idx * 3] = x;
        positions[idx * 3 + 1] = h;
        positions[idx * 3 + 2] = z;
        uvs[idx * 2] = x / 6;
        uvs[idx * 2 + 1] = z / 6;

        // slope from neighbours
        const hl = this.heights[j * n + Math.max(0, i - 1)];
        const hr = this.heights[j * n + Math.min(n - 1, i + 1)];
        const hd = this.heights[Math.max(0, j - 1) * n + i];
        const hu = this.heights[Math.min(n - 1, j + 1) * n + i];
        const slope = Math.hypot(hr - hl, hu - hd) / (2 * CELL);

        const v = this.detail.fbm(x * 0.03, z * 0.03, 3);
        const v2 = this.detail.fbm(x * 0.12 + 9, z * 0.12, 2);
        c.copy(earth).lerp(ochre, clamp(0.5 + v * 0.8, 0, 1));
        c.lerp(dust, clamp(0.35 + v2 * 0.5, 0, 0.6));

        // scrub & green near water / patches
        const dOued = distToPolyline(x, z, OUED);
        const wet = 1 - smoothstep(4, 26, dOued);
        const patch = smoothstep(0.25, 0.6, this.noise.fbm(x * 0.02 + 30, z * 0.02 - 8, 3));
        c.lerp(scrub, clamp(patch * 0.55 + wet * 0.5, 0, 0.8));
        const oasis = zone('oasis');
        const dOasis = Math.hypot(x - oasis.x, z - oasis.z);
        c.lerp(green, (1 - smoothstep(8, 34, dOasis)) * 0.85);

        // settlements: packed earth
        for (const zn of ZONES) {
          if (zn.id === 'oasis') continue;
          const d = Math.hypot(x - zn.x, z - zn.z);
          const w = 1 - smoothstep(zn.radius * 0.7, zn.radius + 6, d);
          if (w > 0) c.lerp(packed, w * 0.55);
        }

        // roads with wheel ruts
        const dr = distToRoads(x, z);
        const wr = 1 - smoothstep(1.6, 4.2, dr);
        if (wr > 0) {
          const rut = Math.abs(dr - 1.1) < 0.35 ? 0.85 : 1;
          c.lerp(road, wr * 0.85).multiplyScalar(lerp(1, rut, wr));
        }

        // runway packed dirt, rail ballast, lake shore mud
        const ax2 = Math.max(0, Math.abs(x - AIRSTRIP.x) - AIRSTRIP.halfW);
        const az2 = Math.max(0, Math.abs(z - AIRSTRIP.z) - AIRSTRIP.halfL);
        c.lerp(road, (1 - smoothstep(0, 3, Math.hypot(ax2, az2))) * 0.7);
        c.lerp(ballast, (1 - smoothstep(1.5, 3.2, distToPolyline(x, z, RAIL))) * 0.9);
        const dLake = Math.hypot(x - LAKE.x, z - LAKE.z);
        c.lerp(green, (1 - smoothstep(LAKE.water, LAKE.r + 14, dLake)) * 0.7);

        // rock on slopes, snow on peaks
        c.lerp(rock, smoothstep(0.35, 0.8, slope));
        c.lerp(darkRock, smoothstep(0.9, 1.4, slope) * 0.6);
        c.lerp(snow, smoothstep(88, 120, h + v * 12) * (1 - smoothstep(1.1, 1.8, slope) * 0.5));

        colors[idx * 3] = c.r;
        colors[idx * 3 + 1] = c.g;
        colors[idx * 3 + 2] = c.b;
      }
    }

    const indices = new Uint32Array(SEGMENTS * SEGMENTS * 6);
    let k = 0;
    for (let j = 0; j < SEGMENTS; j += 1) {
      for (let i = 0; i < SEGMENTS; i += 1) {
        const a = j * n + i;
        const b = (j + 1) * n + i;
        const d = j * n + i + 1;
        const e = (j + 1) * n + i + 1;
        indices[k++] = a;
        indices[k++] = b;
        indices[k++] = d;
        indices[k++] = b;
        indices[k++] = e;
        indices[k++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: createGroundDetailTexture(),
      roughness: 0.96,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  private buildLake(): THREE.Mesh {
    const geo = new THREE.CircleGeometry(LAKE.r + 4, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhysicalMaterial({ color: '#2a5f6e', roughness: 0.1, metalness: 0, transparent: true, opacity: 0.86, clearcoat: 1, clearcoatRoughness: 0.08 });
    const water = new THREE.Mesh(geo, mat);
    water.position.set(LAKE.x, LAKE.level, LAKE.z);
    water.name = 'lakeWater';
    return water;
  }

  private buildWater(): THREE.Mesh {
    const oasis = zone('oasis');
    const geo = new THREE.CircleGeometry(10.5, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhysicalMaterial({
      color: '#2f6f6a',
      roughness: 0.08,
      metalness: 0,
      transparent: true,
      opacity: 0.82,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    });
    const water = new THREE.Mesh(geo, mat);
    water.position.set(oasis.x, oasis.height - 2.1, oasis.z);
    water.name = 'oasisWater';
    return water;
  }
}

/** Grain / pebble detail multiplied over vertex colours (averages ~0.9 luminance). */
function createGroundDetailTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const noise = new PeriodicNoise(7);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const n1 = noise.fbm(u, v, 4, 3);
      const n2 = noise.sample(u, v, 48, 5);
      let val = 0.9 + n1 * 0.16 + (noise.sample(u, v, 96, 6) - 0.5) * 0.08;
      if (n2 > 0.86) val -= 0.07; // pebbles
      if (n2 < 0.12) val += 0.05; // pale grit
      const g = Math.round(clamp(val, 0, 1) * 255);
      const o = (y * size + x) * 4;
      img.data[o] = g;
      img.data[o + 1] = Math.round(g * 0.98);
      img.data[o + 2] = Math.round(g * 0.95);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
