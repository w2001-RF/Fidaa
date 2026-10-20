import { createSeededRandom } from './random';

/**
 * Seeded 2D simplex noise plus fBm helpers. Used for terrain, scatter density
 * and material variation; deterministic so the world is identical every run.
 */
export class Noise2D {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const rng = createSeededRandom(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) p[i] = i;
    for (let i = 255; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i += 1) this.perm[i] = p[i & 255];
  }

  noise(xin: number, yin: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      n0 = t0 * t0 * this.grad(this.perm[ii + this.perm[jj]], x0, y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      n1 = t1 * t1 * this.grad(this.perm[ii + i1 + this.perm[jj + j1]], x1, y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      n2 = t2 * t2 * this.grad(this.perm[ii + 1 + this.perm[jj + 1]], x2, y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o += 1) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  ridged(x: number, y: number, octaves = 4): number {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    for (let o = 0; o < octaves; o += 1) {
      const n = 1 - Math.abs(this.noise(x * freq, y * freq));
      sum += n * n * amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum;
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  }
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Shortest signed angle difference a→b in radians. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return current + angleDiff(current, target) * (1 - Math.exp(-rate * dt));
}

/**
 * Tileable value noise on a periodic lattice: seamless canvas textures
 * without the swirl artefacts of sampling 2D noise on a torus.
 */
export class PeriodicNoise {
  private readonly table = new Float32Array(1 << 16);

  constructor(seed: number) {
    let s = seed >>> 0 || 1;
    for (let i = 0; i < this.table.length; i += 1) {
      s = (s * 1664525 + 1013904223) >>> 0;
      this.table[i] = s / 4294967296;
    }
  }

  private lattice(i: number, j: number, p: number, octave: number): number {
    const ii = ((i % p) + p) % p;
    const jj = ((j % p) + p) % p;
    return this.table[((ii * 251 + jj * 4093 + octave * 7919) & 0xffff)];
  }

  /** u,v in [0,1); period = lattice cells across the tile. Returns 0..1. */
  sample(u: number, v: number, period: number, octave = 0): number {
    const x = u * period;
    const y = v * period;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = this.lattice(i, j, period, octave);
    const b = this.lattice(i + 1, j, period, octave);
    const c = this.lattice(i, j + 1, period, octave);
    const d = this.lattice(i + 1, j + 1, period, octave);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  /** Fractal sum, centred on 0 (≈ -0.5..0.5). */
  fbm(u: number, v: number, basePeriod: number, octaves: number): number {
    let amp = 0.5;
    let sum = 0;
    let norm = 0;
    let p = basePeriod;
    for (let o = 0; o < octaves; o += 1) {
      sum += (this.sample(u, v, p, o) - 0.5) * amp;
      norm += amp;
      amp *= 0.5;
      p *= 2;
    }
    return sum / norm;
  }
}
