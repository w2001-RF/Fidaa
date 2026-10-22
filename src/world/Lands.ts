import * as THREE from 'three';
import { L, type Text } from '../i18n';
import { Noise2D, clamp, lerp, smoothstep } from '../utils/noise';
import { createSeededRandom } from '../utils/random';

/**
 * The lands beyond the valley: a seeded, endless-feeling Morocco generated as
 * the player explores. The authored valley (±320 m) keeps its own heightfield;
 * everything here is a pure function of the world seed, so a chunk is the same
 * every time it is generated and a save only needs the seed.
 */

/** Streaming chunk size; the valley's 2.5 m grid divides it exactly, so chunk edges meet the valley seamlessly. */
export const CHUNK = 80;
/** Vertices per chunk side minus one: 2.5 m cells, like the valley. */
export const CHUNK_SEG = 32;
/** Half size of the authored valley heightfield. */
export const CORE_HALF = 320;
/** The lands end here (half size of the square); a sand sea rises beyond. */
export const LIMIT = 1600;
/** The valley's mountain ring keeps its plateau out to here... */
export const RING_IN = 360;
/** ...and has given way to the outlands by here. */
export const RING_OUT = 430;
/** One site (village, ruin, shrine...) at most per square of this size. */
const SITE_CELL = 320;
/** Sites stay this far inside their cell, so a site only ever touches its own cell. */
const SITE_MARGIN = 72;

export type Biome = 'steppe' | 'erg' | 'forest' | 'badlands';
export type SiteKind = 'village' | 'ksar' | 'shrine' | 'nomads' | 'spring' | 'cave';
export type Site = {
  id: string;
  kind: SiteKind;
  x: number;
  z: number;
  /** flattened plateau radius and blend back to natural ground */
  r: number;
  blend: number;
  height: number;
  angle: number;
  name: Text;
  biome: Biome;
  /** seed for everything built there */
  seed: number;
};

/** Passes through the mountain ring: unit direction from the valley centre. Clear of every authored place. */
export const PASSES: { id: string; dx: number; dz: number }[] = [
  { id: 'north', ...unit(0.08, 1) },
  { id: 'east', ...unit(0.966, 0.259) },
  { id: 'west', ...unit(-0.8, -0.6) },
];
/** The mule track along each pass, from the valley floor out into the lands. */
const TRACK_FROM = 190;
const TRACK_TO = 640;

function unit(x: number, z: number): { dx: number; dz: number } {
  const l = Math.hypot(x, z);
  return { dx: x / l, dz: z / l };
}

/** 1 on a pass floor, 0 away from it: the mountain ring is cut down there. */
export function passWeight(x: number, z: number): number {
  let w = 0;
  for (const p of PASSES) {
    const along = x * p.dx + z * p.dz;
    if (along < 150) continue;
    const d = Math.abs(x * p.dz - z * p.dx);
    w = Math.max(w, (1 - smoothstep(14, 40, d)) * smoothstep(150, 200, along));
  }
  return w;
}

/** Distance to the nearest pass track (Infinity off them). */
export function trackDist(x: number, z: number): number {
  let best = Infinity;
  for (const p of PASSES) {
    const along = x * p.dx + z * p.dz;
    const d = Math.abs(x * p.dz - z * p.dx);
    const past = along < TRACK_FROM ? TRACK_FROM - along : along > TRACK_TO ? along - TRACK_TO : 0;
    best = Math.min(best, Math.hypot(d, past));
  }
  return best;
}

/** Numeric key of a chunk (fast Map key, no strings). */
export function chunkKey(ci: number, cj: number): number {
  return (ci + 512) * 1024 + (cj + 512);
}

/** True for chunks that lie inside the authored valley heightfield. */
export function inCore(ci: number, cj: number): boolean {
  const n = CORE_HALF / CHUNK;
  return ci >= -n && ci < n && cj >= -n && cj < n;
}

function hash(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

// Names: Amazigh place words with their Arabic spelling, a prefix by kind
const ROOTS: [string, string][] = [
  ['Asif', 'أسيف'], ['Tala', 'تالا'], ['Ighil', 'إغيل'], ['Adrar', 'أدرار'], ['Tizi', 'تيزي'], ['Agadir', 'أكادير'],
  ['Taourirt', 'تاوريرت'], ['Anzar', 'أنزار'], ['Azrou', 'أزرو'], ['Tamda', 'تامدا'], ['Aguelmous', 'أكلموس'], ['Imouzzer', 'إيموزار'],
  ['Tagounit', 'تاكونيت'], ['Iferd', 'إفرض'], ['Amassine', 'أماسين'], ['Tilmi', 'تلمي'], ['Bouzmou', 'بوزمو'], ['Ouzoud', 'أوزود'],
  ['Tazrout', 'تازروت'], ['Imlil', 'إمليل'], ['Tifnout', 'تيفنوت'], ['Assaka', 'أساكا'], ['Ourika', 'أوريكا'], ['Tidili', 'تيديلي'],
];
const PREFIX: Record<SiteKind, [string, string][]> = {
  village: [['Douar ', 'دوار '], ['Aït ', 'آيت ']],
  ksar: [['Ksar ', 'قصر ']],
  shrine: [['Sidi ', 'سيدي '], ['Lalla ', 'لالة ']],
  nomads: [['Nomads of ', 'رحّالة ']],
  spring: [['Aïn ', 'عين ']],
  cave: [["Ifri n'", 'إفري ن']],
};
const SITE_SIZE: Record<SiteKind, [number, number]> = {
  village: [27, 22],
  ksar: [24, 20],
  shrine: [12, 14],
  nomads: [15, 16],
  spring: [12, 12],
  cave: [7, 8],
};

export class Lands {
  private readonly n: Noise2D;
  private readonly n2: Noise2D;
  private readonly detail: Noise2D;
  private readonly sites = new Map<number, Site | null>();

  constructor(readonly seed: number) {
    this.n = new Noise2D(seed);
    this.n2 = new Noise2D(seed ^ 0x5bd1e995);
    this.detail = new Noise2D(seed ^ 0x1b873593);
  }

  /** Ground height in the outlands (sites flattened in). */
  height(x: number, z: number): number {
    let h = this.raw(x, z);
    const s = this.siteNear(x, z);
    if (s) {
      const w = 1 - smoothstep(s.r, s.r + s.blend, Math.hypot(x - s.x, z - s.z));
      if (w > 0) h = lerp(h, s.height, w);
    }
    return h;
  }

  /** Natural ground before any site is levelled. */
  private raw(x: number, z: number): number {
    const n = this.n;
    const r = Math.hypot(x, z);
    const relief = n.fbm(x * 0.0011 + 31, z * 0.0011 - 17, 2);
    const arid = this.n2.fbm(x * 0.0009 - 5, z * 0.0009 + 11, 2);
    let h = n.fbm(x * 0.005, z * 0.005, 4) * 9 + 6;
    h += Math.max(0, n.fbm(x * 0.002 + 7, z * 0.002 + 3, 2)) * 16;
    // mountain ranges, kept back from the valley so each pass opens onto lowland
    const mtn = smoothstep(0.12, 0.5, relief) * smoothstep(470, 720, r);
    if (mtn > 0) h += mtn * (14 + n.ridged(x * 0.006, z * 0.006, 3) * 80);
    // the erg: long dune crests
    const erg = smoothstep(0.25, 0.55, arid) * (1 - mtn);
    if (erg > 0) {
      const warp = n.noise(x * 0.004 + 9, z * 0.004);
      const crest = 1 - Math.abs(Math.sin(x * 0.045 + z * 0.02 + warp * 2.5));
      h = lerp(h, 4 + crest * crest * 9, erg * 0.85);
    }
    // the edge of the world: the great erg rises past the limit
    h += smoothstep(LIMIT - 170, LIMIT + 10, Math.max(Math.abs(x), Math.abs(z))) * 70;
    return h;
  }

  biome(x: number, z: number): Biome {
    const relief = this.n.fbm(x * 0.0011 + 31, z * 0.0011 - 17, 2);
    const arid = this.n2.fbm(x * 0.0009 - 5, z * 0.0009 + 11, 2);
    if (arid > 0.3) return relief > 0.28 ? 'badlands' : 'erg';
    if (relief > 0.12 && arid < -0.02) return 'forest';
    if (relief > 0.3) return 'badlands';
    return 'steppe';
  }

  /** Vertex colour of the outland ground: steppe ochre, pale erg sand, green highland, red badlands, rock on slopes. */
  groundColor(x: number, z: number, h: number, slope: number, out: THREE.Color): THREE.Color {
    const relief = this.n.fbm(x * 0.0011 + 31, z * 0.0011 - 17, 2);
    const arid = this.n2.fbm(x * 0.0009 - 5, z * 0.0009 + 11, 2);
    const v = this.detail.fbm(x * 0.03, z * 0.03, 2);
    out.copy(C.steppe).lerp(C.dust, clamp(0.4 + v * 0.8, 0, 1));
    out.lerp(C.scrub, clamp(smoothstep(0.1, 0.5, this.detail.noise(x * 0.02 + 30, z * 0.02 - 8)) * 0.5, 0, 0.5));
    const wErg = smoothstep(0.25, 0.5, arid);
    out.lerp(C.sand, wErg * 0.9);
    if (wErg > 0) out.lerp(C.sandShade, wErg * clamp(0.5 - v, 0, 0.5));
    const wForest = smoothstep(0.08, 0.3, relief) * (1 - smoothstep(-0.12, 0.05, arid));
    out.lerp(C.forest, wForest * 0.8);
    const wBad = smoothstep(0.22, 0.45, relief) * smoothstep(-0.1, 0.2, arid);
    out.lerp(C.red, wBad * 0.85);
    const s = this.siteNear(x, z);
    if (s) out.lerp(s.kind === 'spring' ? C.oasis : C.packed, (1 - smoothstep(s.r * 0.6, s.r + 6, Math.hypot(x - s.x, z - s.z))) * 0.6);
    const tr = trackDist(x, z);
    if (tr < 4.2) out.lerp(C.road, (1 - smoothstep(1.6, 4.2, tr)) * 0.8);
    out.lerp(C.rock, smoothstep(0.4, 0.85, slope));
    out.lerp(C.darkRock, smoothstep(0.95, 1.4, slope) * 0.6);
    out.lerp(C.snow, smoothstep(92, 125, h + v * 12) * (1 - smoothstep(1.1, 1.8, slope) * 0.5));
    return out;
  }

  /** The site whose cell contains (x, z), if it reaches that far. */
  private siteNear(x: number, z: number): Site | null {
    const s = this.siteAt(Math.floor(x / SITE_CELL), Math.floor(z / SITE_CELL));
    if (!s) return null;
    return Math.abs(x - s.x) < s.r + s.blend && Math.abs(z - s.z) < s.r + s.blend ? s : null;
  }

  /** The one site in a site cell (or none). Deterministic from the seed. */
  siteAt(ci: number, cj: number): Site | null {
    const key = chunkKey(ci, cj);
    const hit = this.sites.get(key);
    if (hit !== undefined) return hit;
    const s = this.makeSite(ci, cj);
    this.sites.set(key, s);
    return s;
  }

  /** Sites whose centre lies within `r` of (x, z). */
  sitesNear(x: number, z: number, r: number): Site[] {
    const out: Site[] = [];
    const c0 = Math.floor((x - r) / SITE_CELL);
    const c1 = Math.floor((x + r) / SITE_CELL);
    const d0 = Math.floor((z - r) / SITE_CELL);
    const d1 = Math.floor((z + r) / SITE_CELL);
    for (let i = c0; i <= c1; i += 1) {
      for (let j = d0; j <= d1; j += 1) {
        const s = this.siteAt(i, j);
        if (s && Math.hypot(s.x - x, s.z - z) <= r) out.push(s);
      }
    }
    return out;
  }

  /** Look a site up by its id (`s:ci:cj`), as saves store them. */
  siteById(id: string): Site | null {
    const m = /^s:(-?\d+):(-?\d+)$/.exec(id);
    return m ? this.siteAt(Number(m[1]), Number(m[2])) : null;
  }

  private makeSite(ci: number, cj: number): Site | null {
    const rng = createSeededRandom(hash(this.seed, ci, cj));
    if (rng() > 0.82) return null;
    const x = (ci + 0.5) * SITE_CELL + (rng() - 0.5) * (SITE_CELL - SITE_MARGIN * 2);
    const z = (cj + 0.5) * SITE_CELL + (rng() - 0.5) * (SITE_CELL - SITE_MARGIN * 2);
    // out in the lands only: past the ring and the passes, inside the edge
    if (Math.hypot(x, z) < RING_OUT + 110 || Math.max(Math.abs(x), Math.abs(z)) > LIMIT - 150) return null;
    const biome = this.biome(x, z);
    const roll = rng();
    const kind: SiteKind =
      biome === 'erg'
        ? roll < 0.35 ? 'spring' : roll < 0.7 ? 'nomads' : roll < 0.88 ? 'ksar' : 'shrine'
        : biome === 'badlands'
          ? roll < 0.35 ? 'ksar' : roll < 0.65 ? 'cave' : roll < 0.85 ? 'village' : 'shrine'
          : biome === 'forest'
            ? roll < 0.45 ? 'village' : roll < 0.65 ? 'cave' : roll < 0.85 ? 'shrine' : 'spring'
            : roll < 0.5 ? 'village' : roll < 0.68 ? 'nomads' : roll < 0.84 ? 'shrine' : roll < 0.94 ? 'ksar' : 'spring';
    const [r, blend] = SITE_SIZE[kind];
    // people build on level ground (a cave may sit in a steep hillside)
    const around = [this.raw(x + r + blend, z), this.raw(x - r - blend, z), this.raw(x, z + r + blend), this.raw(x, z - r - blend)];
    if (Math.max(...around) - Math.min(...around) > (r + blend) * (kind === 'cave' ? 1.2 : 0.45)) return null;
    const root = ROOTS[Math.floor(rng() * ROOTS.length)];
    const second = rng() < 0.35 ? ROOTS[Math.floor(rng() * ROOTS.length)] : null;
    const pre = PREFIX[kind][Math.floor(rng() * PREFIX[kind].length)];
    const en = pre[0] + root[0] + (second && second !== root ? ` n'${second[0]}` : '');
    const ar = pre[1] + root[1] + (second && second !== root ? ` ن${second[1]}` : '');
    return {
      id: `s:${ci}:${cj}`,
      kind,
      x,
      z,
      r,
      blend,
      height: Math.max(-1, this.raw(x, z)),
      angle: rng() * Math.PI * 2,
      name: L(en, ar),
      biome,
      seed: hash(this.seed ^ 0x9e3779b9, ci, cj),
    };
  }
}

const C = {
  steppe: new THREE.Color('#c48c55'),
  dust: new THREE.Color('#d8ae7a'),
  scrub: new THREE.Color('#857f48'),
  sand: new THREE.Color('#e6c38c'),
  sandShade: new THREE.Color('#d39f63'),
  forest: new THREE.Color('#66713b'),
  red: new THREE.Color('#a8572f'),
  packed: new THREE.Color('#c99f72'),
  oasis: new THREE.Color('#5f7037'),
  road: new THREE.Color('#e0c08f'),
  rock: new THREE.Color('#7a6656'),
  darkRock: new THREE.Color('#5a4a40'),
  snow: new THREE.Color('#f1efe9'),
};
