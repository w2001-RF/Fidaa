import * as THREE from 'three';
import { MergeBuilder, boxGeo, cylGeo, latheGeo } from '../assets/GeometryKit';
import type { MaterialLibrary } from '../assets/Materials';
import type { Interactable, LootBundle, NpcSpawn } from '../game/types';
import { L } from '../i18n';
import { createSeededRandom } from '../utils/random';
import { type BuildCtx, PLASTER_TINTS, house, jar, crate, oven, stall, tent, toWorld, tower, wall, well } from './Architecture';
import { CollisionWorld } from './Collision';
import { CHUNK, CHUNK_SEG, LIMIT, RING_OUT, chunkKey, inCore, trackDist, type Biome, type Site } from './Lands';
import type { Terrain } from './Terrain';
import type { Harvestable, Species, Vegetation } from './Vegetation';

const CN = CHUNK_SEG + 1;
const CELL = CHUNK / CHUNK_SEG;
/** sample grid with a one-cell border, for seamless normals */
const BN = CN + 2;
/** Chunks whose centre is this close get full terrain and everything on it. */
const NEAR = 210;
/** ...and are dropped again past this (hysteresis). */
const DROP = NEAR + 80;
/** The coarse horizon reaches this far: just past the daytime fog (gone by ~560 m). */
const FAR = 580;
const LOW_SEG = 8;
const LN = LOW_SEG + 1;
const LBN = LN + 2;
const LCELL = CHUNK / LOW_SEG;
/** Trees and rocks closer than this use full-detail geometry and cast shadows. */
const DETAIL = 100;
/** Milliseconds per frame spent generating terrain. */
const BUDGET_NEAR = 4;
const BUDGET_LOW = 2;

type Plant = { sp: Species; m: THREE.Matrix4; h?: Harvestable };
type Prop = { kind: 'wood' | 'herb' | 'scrap'; x: number; y: number; z: number; a: number };
type Chunk = {
  ci: number;
  cj: number;
  key: number;
  heights: Float32Array;
  colors: Float32Array;
  normals: Float32Array;
  plants: Plant[];
  props: Prop[];
  /** a site whose centre lies in this chunk: built with it */
  site: Site | null;
  interactables: Interactable[];
  npcs: NpcSpawn[];
  /** colliders this chunk added (index range), so a new world can switch them off */
  colliders: [number, number];
  /** the first build's merged meshes, kept for the first time it is shown */
  firstGroup: THREE.Group | null;
};
type Live = { chunk: Chunk; mesh: THREE.Mesh; group: THREE.Group | null };
type Low = { h: Float32Array; n: Float32Array; c: Float32Array };
type Job = { ci: number; cj: number; key: number; hb: Float32Array; k: number; colors: Float32Array | null; ck: number };

/** Per-biome density of what grows and lies about in an 80 m chunk. */
const DENSITY: Record<Biome, { trees: number; species: Species[]; rocks: number; cactus: number; scrub: number; wood: number; herbs: number; scrap: number; ore: number }> = {
  steppe: { trees: 9, species: ['argan', 'argan', 'olive'], rocks: 10, cactus: 5, scrub: 55, wood: 1, herbs: 2, scrap: 0.06, ore: 0.3 },
  forest: { trees: 34, species: ['olive', 'argan', 'argan'], rocks: 8, cactus: 0, scrub: 40, wood: 2, herbs: 2, scrap: 0.04, ore: 0.25 },
  erg: { trees: 1, species: ['palm'], rocks: 3, cactus: 0, scrub: 10, wood: 0, herbs: 0, scrap: 0.08, ore: 0.15 },
  badlands: { trees: 3, species: ['argan'], rocks: 30, cactus: 3, scrub: 18, wood: 1, herbs: 1, scrap: 0.1, ore: 0.7 },
};
/** Capacity of the shared frontier instance pools, per species. */
const CAP: Record<Species, number> = { palm: 500, olive: 1400, argan: 1400, cactus: 600, rock: 2600, scrub: 5000 };

function hash(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a, 0x2545f491) ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Streams the lands beyond the valley around the player: terrain chunks with
 * their trees, rocks, resources and sites are generated a few milliseconds per
 * frame as they come into range and dropped when left behind; a coarse
 * horizon mesh fills the view out to the fog. Generated data stays in memory
 * (heights, felled trees, searched jars), so coming back finds things as left.
 */
export class Frontier {
  readonly group = new THREE.Group();
  /** a chunk's coarse heights and colours are ready (the region map paints it) */
  onLow: ((ci: number, cj: number, h: Float32Array, c: Float32Array) => void) | null = null;
  onNpcIn: ((s: NpcSpawn) => void) | null = null;
  onNpcOut: ((id: string) => void) | null = null;
  /** frontier trees and rocks felled or quarried, by key */
  readonly harvested = new Set<string>();
  /** searched jars and chests in chunks not generated yet (from a save) */
  private readonly pendingSearched = new Set<string>();

  private readonly data = new Map<number, Chunk>();
  private readonly live = new Map<number, Live>();
  private readonly lows = new Map<number, Low>();
  private jobs: Job[] = [];
  private lowQueue: { ci: number; cj: number; key: number }[] = [];
  private readonly lowQueued = new Set<number>();
  private pci = Number.NaN;
  private pcj = Number.NaN;
  private readonly player = new THREE.Vector3();
  private farDirty = true;
  private floraDirty = true;
  private farAt = -1;
  private elapsed = 0;
  private readonly far: THREE.Mesh;
  private readonly pools = new Map<string, THREE.InstancedMesh[]>();
  private readonly tmpC = new THREE.Color();
  private readonly lightPoints: THREE.Vector3[];
  private lightStart: number;

  constructor(
    private readonly terrain: Terrain,
    private readonly collision: CollisionWorld,
    private readonly veg: Vegetation,
    private readonly lib: MaterialLibrary,
    private readonly interactables: Interactable[],
    lightPoints: THREE.Vector3[],
  ) {
    this.group.name = 'frontier';
    this.lightPoints = lightPoints;
    this.lightStart = lightPoints.length;
    this.far = new THREE.Mesh(new THREE.BufferGeometry(), terrain.mesh.material);
    this.far.name = 'frontier-horizon';
    this.far.receiveShadow = false;
    this.far.frustumCulled = false;
    this.group.add(this.far);
    for (const sp of Object.keys(CAP) as Species[]) {
      for (const lod of ['hi', 'lo'] as const) {
        if (sp === 'scrub' && lod === 'lo') continue;
        const meshes = veg.parts[sp].map((part) => {
          const geo = lod === 'lo' && part.lo ? part.lo : part.geometry;
          const m = new THREE.InstancedMesh(geo, part.material, CAP[sp]);
          m.count = 0;
          m.visible = false;
          m.name = `frontier-${sp}-${lod}`;
          m.castShadow = lod === 'hi' && part.shadow;
          m.receiveShadow = true;
          m.frustumCulled = false;
          m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.group.add(m);
          return m;
        });
        this.pools.set(`${sp}:${lod}`, meshes);
      }
    }
  }

  get seed(): number {
    return this.terrain.lands.seed;
  }

  /**
   * A new world (new game or a save from another world): forget every chunk,
   * switch their colliders off, and regenerate from the new seed.
   */
  reset(seed: number, harvested: string[] = [], searched: string[] = []): void {
    const same = seed === this.seed;
    if (!same) {
      for (const id of [...this.live.keys()]) this.unload(id);
      for (const c of this.data.values()) {
        for (let i = c.colliders[0]; i < c.colliders[1]; i += 1) this.collision.colliders[i].enabled = false;
        if (c.firstGroup) disposeGroup(c.firstGroup);
      }
      this.data.clear();
      this.lows.clear();
      this.jobs = [];
      this.lowQueue = [];
      this.lowQueued.clear();
      this.lightPoints.length = this.lightStart;
      this.veg.dropKeyed();
      this.terrain.reseed(seed);
    }
    this.harvested.clear();
    for (const k of harvested) this.harvested.add(k);
    this.pendingSearched.clear();
    for (const id of searched) this.pendingSearched.add(id);
    // a save from the same world: apply its state to what is already generated
    for (const c of this.data.values()) {
      for (const p of c.plants) if (p.h && this.harvested.has(p.h.key ?? '') && !p.h.done) this.veg.harvest(p.h);
      for (const it of c.interactables) if (it.kind === 'loot' && this.pendingSearched.has(it.id)) it.enabled = false;
    }
    this.pci = Number.NaN;
    this.farDirty = true;
    this.floraDirty = true;
  }

  /** What a save keeps of the frontier. */
  serialize(): { seed: number; harvested: string[]; searched: string[] } {
    const searched = new Set(this.pendingSearched);
    for (const c of this.data.values()) for (const it of c.interactables) if (it.kind === 'loot' && !it.enabled) searched.add(it.id);
    return { seed: this.seed, harvested: [...this.harvested], searched: [...searched] };
  }

  /** A frontier tree or rock was felled. */
  markHarvested(h: Harvestable): void {
    if (h.key) this.harvested.add(h.key);
  }

  update(dt: number, at: THREE.Vector3): void {
    this.elapsed += dt;
    this.player.copy(at);
    const ci = Math.floor(at.x / CHUNK);
    const cj = Math.floor(at.z / CHUNK);
    if (ci !== this.pci || cj !== this.pcj) {
      this.pci = ci;
      this.pcj = cj;
      this.plan();
    }
    this.runJobs();
    this.runLows();
    if (this.farDirty && this.elapsed - this.farAt > 0.35) this.rebuildFar();
    if (this.floraDirty) this.refillFlora();
  }

  /** Queue what has come into range, drop what has been left behind. */
  private plan(): void {
    const p = this.player;
    const r = Math.ceil(FAR / CHUNK) + 1;
    const near: { ci: number; cj: number; d: number }[] = [];
    for (let i = this.pci - r; i <= this.pci + r; i += 1) {
      for (let j = this.pcj - r; j <= this.pcj + r; j += 1) {
        if (inCore(i, j) || !this.inWorld(i, j)) continue;
        const d = Math.hypot((i + 0.5) * CHUNK - p.x, (j + 0.5) * CHUNK - p.z);
        const key = chunkKey(i, j);
        if (d < FAR && !this.lows.has(key) && !this.lowQueued.has(key)) {
          this.lowQueue.push({ ci: i, cj: j, key });
          this.lowQueued.add(key);
        }
        if (d < NEAR && !this.live.has(key)) near.push({ ci: i, cj: j, d });
      }
    }
    for (const [key, l] of [...this.live]) {
      const d = Math.hypot((l.chunk.ci + 0.5) * CHUNK - p.x, (l.chunk.cj + 0.5) * CHUNK - p.z);
      if (d > DROP) this.unload(key);
    }
    // nearest first; keep a job already under way
    near.sort((a, b) => a.d - b.d);
    const running = this.jobs[0];
    this.jobs = this.jobs.filter((j) => j === running || near.some((n) => chunkKey(n.ci, n.cj) === j.key));
    for (const n of near) {
      const key = chunkKey(n.ci, n.cj);
      if (this.jobs.some((j) => j.key === key)) continue;
      const known = this.data.get(key);
      if (known) this.show(known);
      else this.jobs.push({ ci: n.ci, cj: n.cj, key, hb: new Float32Array(BN * BN), k: 0, colors: null, ck: 0 });
    }
    this.lowQueue.sort((a, b) => this.dist(a) - this.dist(b));
    this.farDirty = true;
    this.floraDirty = true;
  }

  private inWorld(ci: number, cj: number): boolean {
    const edge = LIMIT + 160;
    return ci * CHUNK > -edge - CHUNK && (ci + 1) * CHUNK < edge + CHUNK && cj * CHUNK > -edge - CHUNK && (cj + 1) * CHUNK < edge + CHUNK;
  }

  private dist(c: { ci: number; cj: number }): number {
    return Math.hypot((c.ci + 0.5) * CHUNK - this.player.x, (c.cj + 0.5) * CHUNK - this.player.z);
  }

  /** Sample terrain for the nearest pending chunk, a few ms per frame. */
  private runJobs(): void {
    const t0 = performance.now();
    while (this.jobs.length && performance.now() - t0 < BUDGET_NEAR) {
      const job = this.jobs[0];
      const x0 = job.ci * CHUNK - CELL;
      const z0 = job.cj * CHUNK - CELL;
      while (job.k < BN * BN && performance.now() - t0 < BUDGET_NEAR) {
        const i = job.k % BN;
        const j = Math.floor(job.k / BN);
        job.hb[job.k] = this.terrain.sample(x0 + i * CELL, z0 + j * CELL);
        job.k += 1;
      }
      if (job.k < BN * BN) return;
      if (!job.colors) job.colors = new Float32Array(CN * CN * 3);
      while (job.ck < CN * CN && performance.now() - t0 < BUDGET_NEAR) {
        const i = job.ck % CN;
        const j = Math.floor(job.ck / CN);
        const b = (j + 1) * BN + (i + 1);
        const slope = Math.hypot(job.hb[b + 1] - job.hb[b - 1], job.hb[b + BN] - job.hb[b - BN]) / (2 * CELL);
        this.terrain.colorAt(job.ci * CHUNK + i * CELL, job.cj * CHUNK + j * CELL, job.hb[b], slope, this.tmpC);
        job.colors[job.ck * 3] = this.tmpC.r;
        job.colors[job.ck * 3 + 1] = this.tmpC.g;
        job.colors[job.ck * 3 + 2] = this.tmpC.b;
        job.ck += 1;
      }
      if (job.ck < CN * CN) return;
      this.jobs.shift();
      this.show(this.finish(job));
    }
  }

  /** Heights, normals and everything on a freshly sampled chunk. */
  private finish(job: Job): Chunk {
    const heights = new Float32Array(CN * CN);
    const normals = new Float32Array(CN * CN * 3);
    const n = new THREE.Vector3();
    for (let j = 0; j < CN; j += 1) {
      for (let i = 0; i < CN; i += 1) {
        const b = (j + 1) * BN + (i + 1);
        heights[j * CN + i] = job.hb[b];
        n.set(job.hb[b - 1] - job.hb[b + 1], 2 * CELL, job.hb[b - BN] - job.hb[b + BN]).normalize();
        normals.set([n.x, n.y, n.z], (j * CN + i) * 3);
      }
    }
    this.terrain.setChunkHeights(job.ci, job.cj, heights);
    const c: Chunk = {
      ci: job.ci,
      cj: job.cj,
      key: job.key,
      heights,
      colors: job.colors as Float32Array,
      normals,
      plants: [],
      props: [],
      site: null,
      interactables: [],
      npcs: [],
      colliders: [this.collision.colliders.length, this.collision.colliders.length],
      firstGroup: null,
    };
    this.populate(c);
    c.colliders[1] = this.collision.colliders.length;
    this.data.set(c.key, c);
    return c;
  }

  // ---------------------------------------------------------------- content

  /** Trees, rocks, resources and any site centred here. Deterministic from the seed and the chunk. */
  private populate(c: Chunk): void {
    const lands = this.terrain.lands;
    const x0 = c.ci * CHUNK;
    const z0 = c.cj * CHUNK;
    const cx = x0 + CHUNK / 2;
    const cz = z0 + CHUNK / 2;
    if (Math.hypot(cx, cz) < RING_OUT + 30 || Math.max(Math.abs(cx), Math.abs(cz)) > LIMIT - 40) return;
    const rng = createSeededRandom(hash(this.seed, c.ci, c.cj));
    const biome = lands.biome(cx, cz);
    const d = DENSITY[biome];
    const sites = lands.sitesNear(cx, cz, CHUNK + 40);
    const g = (x: number, z: number) => this.terrain.getHeight(x, z);
    const clear = (x: number, z: number, pad: number) => !sites.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + pad) && trackDist(x, z) > 3.5;
    const spot = () => [x0 + rng() * CHUNK, z0 + rng() * CHUNK] as const;
    const matrix = (x: number, z: number, scale: number, yOff: number, tilt: number) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, g(x, z) + yOff, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * tilt, rng() * Math.PI * 2, (rng() - 0.5) * tilt)),
        new THREE.Vector3(scale, scale * (0.85 + rng() * 0.3), scale),
      );
    let n = 0;
    const harvestable = (kind: 'tree' | 'rock', species: Harvestable['species'], x: number, z: number, scale: number): Harvestable => {
      const h: Harvestable = { id: -1, kind, species, x, z, y: g(x, z), scale, done: false, refs: [], key: `${c.ci}:${c.cj}:${n}` };
      n += 1;
      this.veg.addHarvestable(h);
      return h;
    };

    // trees
    for (let k = 0, made = 0; k < d.trees * 3 && made < d.trees; k += 1) {
      const [x, z] = spot();
      if (!clear(x, z, 5) || this.terrain.getSlope(x, z) > 0.5 || this.collision.blockedAt(x, z, 1.2, g(x, z))) continue;
      const sp = d.species[Math.floor(rng() * d.species.length)] as 'palm' | 'olive' | 'argan';
      const s = sp === 'palm' ? 0.8 + rng() * 0.5 : 0.8 + rng() * 0.5;
      const h = harvestable('tree', sp, x, z, s);
      const [r, height] = sp === 'palm' ? [0.3 * s, 7 * s] : sp === 'olive' ? [0.42 * s, 2.6 * s] : [0.45 * s, 2.4 * s];
      h.collider = this.collision.addCircle(x, z, r, h.y - 1, h.y + height, false, 'tree');
      c.plants.push({ sp, m: matrix(x, z, s, sp === 'palm' ? -0.1 : 0, sp === 'palm' ? 0.28 : 0.05), h });
      made += 1;
    }
    // rocks: knee-high and bigger ones block and can be quarried (ore in the badlands)
    for (let k = 0; k < d.rocks; k += 1) {
      const [x, z] = spot();
      if (!clear(x, z, 2)) continue;
      const big = rng() < 0.14;
      const s = big ? 1.6 + rng() * 2.2 : 0.3 + rng() * 0.9;
      const m = matrix(x, z, s, -s * 0.25, 0.8);
      const plant: Plant = { sp: 'rock', m };
      if (s > 0.7) {
        plant.h = harvestable('rock', 'rock', x, z, s);
        plant.h.ore = d.ore;
      }
      const gy = g(x, z);
      if (big) {
        const col = this.collision.addCircle(x, z, s * 1.05, gy - 1, gy + s * 1.2, true, 'rock');
        if (plant.h) plant.h.collider = col;
      } else if (s > 0.85) {
        const col = this.collision.addCircle(x, z, s, gy - 1, gy + s * 0.6, false, 'rock');
        if (plant.h) plant.h.collider = col;
      }
      c.plants.push(plant);
    }
    for (let k = 0; k < d.cactus; k += 1) {
      const [x, z] = spot();
      if (!clear(x, z, 3)) continue;
      const s = 0.8 + rng() * 0.6;
      c.plants.push({ sp: 'cactus', m: matrix(x, z, s, 0, 0.1) });
      this.collision.addCircle(x, z, 0.7 * s, g(x, z) - 1, g(x, z) + 1.4 * s, false, 'cactus');
    }
    for (let k = 0; k < d.scrub; k += 1) {
      const [x, z] = spot();
      if (!clear(x, z, -2)) continue;
      c.plants.push({ sp: 'scrub', m: matrix(x, z, 0.6 + rng() * 0.8, -0.02, 0.15) });
    }
    // gatherable resources
    const prop = (kind: Prop['kind'], count: number) => {
      for (let k = 0, made = 0; k < count * 4 && made < count; k += 1) {
        const [x, z] = spot();
        if (!clear(x, z, 3) || this.terrain.getSlope(x, z) > 0.55 || this.collision.blockedAt(x, z, 0.8, g(x, z))) continue;
        const y = g(x, z);
        c.props.push({ kind, x, y, z, a: rng() * Math.PI * 2 });
        const id = `f:${kind}:${c.ci}:${c.cj}:${made}`;
        const prompt = kind === 'wood' ? L('Gather deadwood', 'جمع الحطب') : kind === 'herb' ? L('Gather wild thyme (herbs)', 'جمع الزعتر') : L('Pick through the scrap', 'جمع الخردة');
        c.interactables.push({ id, kind, pos: new THREE.Vector3(x, y, z), radius: 1.8, prompt, hold: kind === 'herb' ? 0.6 : 0.9, enabled: true });
        made += 1;
      }
    };
    prop('wood', d.wood + (rng() < 0.5 ? 1 : 0));
    prop('herb', d.herbs);
    if (rng() < d.scrap) prop('scrap', 1);
    // a site centred in this chunk is built with it
    const site = sites.find((s) => s.x >= x0 && s.x < x0 + CHUNK && s.z >= z0 && s.z < z0 + CHUNK) ?? null;
    if (site) {
      c.site = site;
      const b = new MergeBuilder();
      this.buildSite(site, b, this.collision, c);
      c.firstGroup = b.build(this.lib, `site-${site.id}`);
    }
    for (const it of c.interactables) if (it.kind === 'loot' && this.pendingSearched.has(it.id)) it.enabled = false;
    for (const p of c.plants) if (p.h && this.harvested.has(p.h.key ?? '')) this.veg.harvest(p.h);
  }

  /**
   * Build a site. The first build (with `c`) also collects its interactables,
   * traders and lights and adds real colliders; later rebuilds of the same seed
   * only redraw it.
   */
  private buildSite(s: Site, b: MergeBuilder, col: CollisionWorld, c: Chunk | null): void {
    const rng = createSeededRandom(s.seed);
    const ctx: BuildCtx = { b, col, terrain: this.terrain, rng };
    const g = (x: number, z: number) => this.terrain.getHeight(x, z);
    const at = (lx: number, lz: number) => toWorld(s.x, s.z, s.angle, lx, lz);
    const it = (id: string, kind: Interactable['kind'], x: number, z: number, prompt: ReturnType<typeof L>, hold: number, extra: Partial<Interactable> = {}) => {
      c?.interactables.push({ id: `${s.id}:${id}`, kind, pos: new THREE.Vector3(x, g(x, z), z), radius: kind === 'water' ? 2.6 : 2, prompt, hold, enabled: true, ...extra });
    };
    const loot = (id: string, x: number, z: number, bundle: LootBundle, label = L('Search', 'فتّش'), extra: Partial<Interactable> = {}) => it(id, 'loot', x, z, label, 0.6, { loot: bundle, radius: 1.8, ...extra });
    const light = (x: number, z: number, y = 1.4) => c && this.lightPoints.push(new THREE.Vector3(x, g(x, z) + y, z));
    const trader = (x: number, z: number, facing: number, nomad: boolean) => {
      if (!c) return;
      const id = `frontier-${nomad ? 'nomad' : 'trader'}-${s.id.slice(2).replace(':', '_')}`;
      c.npcs.push({ id, name: nomad ? L('Nomad trader', 'تاجر الرحّالة') : L('Village grocer', 'مول الحانوت'), outfit: rng() < 0.3 ? 'villagerF' : 'villager', x, z, facing, sitting: !nomad });
      c.interactables.push({ id: `trade-${id}`, kind: 'trade', pos: new THREE.Vector3(x, g(x, z), z), radius: 2.8, prompt: nomad ? L('Trade with the nomads', 'تبادل مع الرحّالة') : L('Trade with the grocer', 'بيع وشري مع مول الحانوت'), hold: 0, enabled: true, ref: id });
    };
    const francs = () => 10 + Math.floor(rng() * 30);
    const gy = g(s.x, s.z);
    switch (s.kind) {
      case 'village': {
        const n = 4 + Math.floor(rng() * 4);
        for (let k = 0; k < n; k += 1) {
          const a = s.angle + (k / n) * Math.PI * 2 + 0.35;
          const d = 14 + rng() * 5;
          house(ctx, s.x + Math.sin(a) * d, s.z + Math.cos(a) * d, 5 + rng() * 2.5, 5 + rng() * 2.5, 3 + rng() * 1.6, a + Math.PI, {
            tint: PLASTER_TINTS[Math.floor(rng() * PLASTER_TINTS.length)],
            merlons: rng() < 0.3,
          });
        }
        const [wx, wz] = at(0, -3);
        const wp = well(ctx, wx, wz);
        it('well', 'water', wp.x, wp.z, L('Draw water from the well', 'جبد الما من البير'), 0.8);
        const [ox, oz] = at(6.5, 4);
        const op = oven(ctx, ox, oz, s.angle);
        it('oven', 'oven', op.x, op.z, L('Take bread from the oven', 'خود الخبز من الفرّان'), 0.6);
        const [tx, tz] = at(-6.5, 4);
        stall(ctx, tx, tz, s.angle);
        const [nx, nz] = toWorld(tx, tz, s.angle, 0, -0.5);
        trader(nx, nz, s.angle, false);
        for (let k = 0; k < 2; k += 1) {
          const [jx, jz] = at(-3 + k * 6, -9.5);
          jar(ctx, jx, g(jx, jz), jz, 1.1, '#9a5a36');
          loot(`jar${k}`, jx, jz, k ? { cloth: 1 + Math.floor(rng() * 2), francs: francs() } : { bread: 1, dates: 2, water: rng() < 0.5 ? 1 : 0 }, L('Search the storage jars', 'فتّش الخوابي'));
        }
        light(s.x, s.z, 2);
        break;
      }
      case 'ksar': {
        const half = 13;
        const tint = rng() < 0.5 ? '#b7774c' : '#a8653e';
        const corners = [at(-half, -half), at(half, -half), at(half, half), at(-half, half)];
        for (let k = 0; k < 4; k += 1) {
          const [ax, az] = corners[k];
          const [bx, bz] = corners[(k + 1) % 4];
          const height = 3 + rng() * 2.5;
          if (k === 2) {
            // the gate side: two stretches and a gap
            wall(ctx, ax, az, ax + (bx - ax) * 0.38, az + (bz - az) * 0.38, height, 1.1, 'pise', tint, 0.8);
            wall(ctx, ax + (bx - ax) * 0.62, az + (bz - az) * 0.62, bx, bz, height, 1.1, 'pise', tint, 0.8);
          } else {
            wall(ctx, ax, az, bx, bz, height * (k === 1 ? 0.55 : 1), 1.1, 'pise', tint, 0.8);
          }
        }
        for (const [tx, tz] of [corners[0], corners[2]]) tower(ctx, tx, tz, 2.2, 7 + rng() * 2, 'pise', tint, s.angle);
        const [ax, az] = at(-5, -4);
        crate(ctx, ax, g(ax, az), az, s.angle, 0.9);
        loot('cache', ax, az + 0, { scrap: 2 + Math.floor(rng() * 2), powder: 1, francs: francs() }, L('Search the ruins', 'فتّش الخرب'));
        const [bx, bz] = at(5, 3);
        crate(ctx, bx, g(bx, bz), bz, s.angle + 0.4, 0.8);
        loot('arms', bx, bz, { ammo: 2 + Math.floor(rng() * 3), shot: 2 }, L('Search the old arms chest', 'فتّش صندوق السلاح'), rng() < 0.25 ? { weapon: 'musket' } : {});
        break;
      }
      case 'shrine': {
        // a whitewashed koubba with its green-tiled dome, a well and offerings
        b.put('plaster', boxGeo(5, 4.2, 5), s.x, gy + 1.6, s.z, s.angle, '#efeadf', { groundY: gy, uvScale: 2 });
        b.put('plaster', new THREE.SphereGeometry(2.45, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), s.x, gy + 3.7, s.z, s.angle, '#ece6d8', { uvScale: 1.5 });
        b.put('tile', cylGeo(0.12, 0.2, 0.9, 8), s.x, gy + 6.4, s.z, 0, '#3f7a4c');
        const [dx, dz] = at(0, 2.52);
        b.put('dark', boxGeo(1.1, 2.1, 0.08), dx, gy + 1.05, dz, s.angle, '#2a1d14', { uvScale: 0 });
        b.put('tile', boxGeo(1.4, 0.18, 0.2), dx, gy + 2.2, dz, s.angle, '#3f7a4c');
        col.addBox(s.x, s.z, 2.5, 2.5, s.angle, gy - 1, gy + 6.2, true, 'koubba');
        const [rx, rz] = at(0, 4.2);
        it('rest', 'rest', rx, rz, L('Rest at the shrine until the next dusk/dawn', 'رتاح فالضريح حتى للعشية ولا الفجر'), 0.5);
        const [wx, wz] = at(6, 5);
        const wp = well(ctx, wx, wz);
        it('well', 'water', wp.x, wp.z, L('Draw water from the well', 'جبد الما من البير'), 0.8);
        const [ox, oz] = at(-2.2, 3.4);
        jar(ctx, ox, g(ox, oz), oz, 0.8, '#c08a5a');
        loot('offerings', ox, oz, { dates: 2, bread: 1, herbs: 1 }, L('Take the offerings', 'خود الزيارة'));
        light(dx, dz, 2.4);
        break;
      }
      case 'nomads': {
        for (let k = 0; k < 3; k += 1) {
          const a = s.angle + k * 2.1;
          tent(ctx, s.x + Math.sin(a) * 7.5, s.z + Math.cos(a) * 7.5, a + Math.PI);
        }
        // fire pit
        for (let k = 0; k < 8; k += 1) {
          const a = (k / 8) * Math.PI * 2;
          b.put('stone', new THREE.DodecahedronGeometry(0.22, 0), s.x + Math.cos(a) * 0.8, gy + 0.12, s.z + Math.sin(a) * 0.8, rng() * 3, '#7a6a5a');
        }
        for (let k = 0; k < 3; k += 1) b.put('wood', cylGeo(0.07, 0.08, 1.1, 6), s.x, gy + 0.18, s.z, k * 1.1, '#3a2a1c', undefined, Math.PI / 2);
        b.put('glow', new THREE.ConeGeometry(0.35, 0.6, 6), s.x, gy + 0.45, s.z, 0, '#ffb35a', { uvScale: 0 });
        light(s.x, s.z, 1);
        const [tx, tz] = at(0, -4.5);
        trader(tx, tz, s.angle + Math.PI, true);
        const [lx, lz] = at(4, -2);
        crate(ctx, lx, g(lx, lz), lz, s.angle, 0.7, '#7a5a3a');
        loot('bundle', lx, lz, { hide: 1 + Math.floor(rng() * 2), cloth: 2, dates: 2 }, L("Search the nomads' bundles", 'فتّش زّكايب الرحّالة'));
        break;
      }
      case 'spring': {
        // a stone basin fed by the spring, palms around it
        const ring = latheGeo([[2.1, 0], [2.1, 0.55], [1.85, 0.6], [1.75, 0.6], [1.75, -0.2]], 20);
        b.put('stone', ring, s.x, gy - 0.05, s.z, 0, '#a99a85', { groundY: gy, uvScale: 1.2 });
        b.put('glow', cylGeo(1.74, 1.74, 0.04, 20), s.x, gy + 0.32, s.z, 0, '#4f8f94', { uvScale: 0 });
        col.addCircle(s.x, s.z, 2.1, gy - 1, gy + 0.6, false, 'basin');
        it('spring', 'water', s.x + 2.4, s.z, L('Drink at the spring', 'شرب من العين'), 0.8);
        if (c) {
          for (let k = 0; k < 7; k += 1) {
            const a = s.angle + (k / 7) * Math.PI * 2;
            const d = 5 + rng() * 5;
            const x = s.x + Math.sin(a) * d;
            const z = s.z + Math.cos(a) * d;
            const ps = 0.8 + rng() * 0.5;
            const h: Harvestable = { id: -1, kind: 'tree', species: 'palm', x, z, y: g(x, z), scale: ps, done: false, refs: [], key: `${s.id}:palm${k}` };
            this.veg.addHarvestable(h);
            h.collider = col.addCircle(x, z, 0.3 * ps, h.y - 1, h.y + 7 * ps, false, 'tree');
            c.plants.push({ sp: 'palm', m: new THREE.Matrix4().compose(new THREE.Vector3(x, h.y - 0.1, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, rng() * 6, 0.08)), new THREE.Vector3(ps, ps, ps)), h });
          }
          for (let k = 0; k < 3; k += 1) {
            const [hx, hz] = at(-7 + k * 7, 8);
            c.props.push({ kind: 'herb', x: hx, y: g(hx, hz), z: hz, a: k });
            it(`herb${k}`, 'herb', hx, hz, L('Gather wild thyme (herbs)', 'جمع الزعتر'), 0.6, { radius: 1.8 });
          }
        }
        break;
      }
      case 'cave': {
        for (let k = 0; k < 9; k += 1) {
          const a = s.angle + (k / 9) * Math.PI * 1.6 + 0.7;
          const x = s.x + Math.sin(a) * 5.5;
          const z = s.z + Math.cos(a) * 5.5;
          const r = 2.2 + rng() * 1.6;
          b.put('stone', new THREE.DodecahedronGeometry(r, 0), x, g(x, z) + r * 0.45, z, rng() * 6, '#8a7462', { uvScale: 1.4 }, rng(), rng());
          col.addCircle(x, z, r * 0.95, g(x, z) - 1, g(x, z) + r * 1.3, true, 'rock');
        }
        b.put('dark', new THREE.SphereGeometry(2.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), s.x, gy - 0.2, s.z, 0, '#140f0c');
        col.addCircle(s.x, s.z, 2.3, gy - 1, gy + 2.2, true, 'cave');
        const [lx, lz] = at(0, -3.2);
        b.put('wood', boxGeo(1.6, 0.06, 0.9), lx, g(lx, lz) + 0.04, lz, s.angle, '#7a5232');
        loot('bundle', lx, lz, { cloth: 1, shot: 2, wood: 2, francs: francs() }, L('Search the cave', 'فتّش الغار'));
        const [rx, rz] = at(2.6, -3.6);
        it('rest', 'rest', rx, rz, L('Sleep in the cave until the next dusk/dawn', 'نعس فالغار حتى للعشية ولا الفجر'), 0.5);
        light(s.x, s.z - 2, 1);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- showing

  /** Put a generated chunk on screen: its terrain, props, site, people and things to use. */
  private show(c: Chunk): void {
    if (this.live.has(c.key)) return;
    const mesh = this.chunkMesh(c);
    this.group.add(mesh);
    let group: THREE.Group | null = null;
    if (c.props.length || c.site) {
      const b = new MergeBuilder();
      this.buildProps(c, b);
      const props = b.build(this.lib, `props-${c.ci}:${c.cj}`, false);
      if (c.site) {
        // the first time the site's meshes come from populate(); after that it is rebuilt (with throwaway colliders)
        let site = c.firstGroup;
        c.firstGroup = null;
        if (!site) {
          const sb = new MergeBuilder();
          this.buildSite(c.site, sb, new CollisionWorld(), null);
          site = sb.build(this.lib, `site-${c.site.id}`);
        }
        props.add(site);
      }
      group = props;
      this.group.add(group);
    }
    for (const it of c.interactables) this.interactables.push(it);
    for (const s of c.npcs) this.onNpcIn?.(s);
    this.live.set(c.key, { chunk: c, mesh, group });
    this.farDirty = true;
    this.floraDirty = true;
    if (!this.lows.has(c.key) && !this.lowQueued.has(c.key)) {
      this.lowQueue.unshift({ ci: c.ci, cj: c.cj, key: c.key });
      this.lowQueued.add(c.key);
    }
  }

  private unload(key: number): void {
    const l = this.live.get(key);
    if (!l) return;
    this.live.delete(key);
    l.mesh.geometry.dispose();
    this.group.remove(l.mesh);
    if (l.group) {
      this.group.remove(l.group);
      disposeGroup(l.group);
    }
    const gone = new Set(l.chunk.interactables);
    for (let i = this.interactables.length - 1; i >= 0; i -= 1) if (gone.has(this.interactables[i])) this.interactables.splice(i, 1);
    for (const s of l.chunk.npcs) this.onNpcOut?.(s.id);
    this.farDirty = true;
    this.floraDirty = true;
  }

  private buildProps(c: Chunk, b: MergeBuilder): void {
    for (const p of c.props) {
      const rng = createSeededRandom(Math.floor(p.x * 31 + p.z * 17) >>> 0);
      if (p.kind === 'wood') {
        for (let k = 0; k < 5; k += 1) {
          b.put('wood', cylGeo(0.07 + rng() * 0.05, 0.09, 1.3 + rng() * 0.8, 6), p.x + (rng() - 0.5) * 0.6, p.y + 0.1 + k * 0.08, p.z + (rng() - 0.5) * 0.6, p.a + rng() * 3, k % 2 ? '#6b5038' : '#5a4330', undefined, Math.PI / 2);
        }
      } else if (p.kind === 'herb') {
        for (let k = 0; k < 4; k += 1) {
          b.put('foliage', new THREE.IcosahedronGeometry(0.22 + rng() * 0.1, 0), p.x + (rng() - 0.5) * 0.5, p.y + 0.15, p.z + (rng() - 0.5) * 0.5, rng() * 3, k % 2 ? '#7d8a52' : '#8f7aa0', { uvScale: 0 });
        }
      } else {
        b.put('metal', cylGeo(0.12, 0.12, 0.22, 8), p.x, p.y + 0.1, p.z, p.a, '#6a5a4a', undefined, Math.PI / 2);
        b.put('metal', new THREE.TorusGeometry(0.16, 0.025, 4, 10), p.x + 0.3, p.y + 0.03, p.z + 0.2, p.a, '#4a4038', undefined, Math.PI / 2);
        b.put('iron', boxGeo(0.6, 0.04, 0.3), p.x - 0.3, p.y + 0.03, p.z - 0.2, p.a * 3, '#3a3430');
      }
    }
  }

  /** The chunk's terrain on the 2.5 m grid, with a curtain round its edge against the coarse horizon. */
  private chunkMesh(c: Chunk): THREE.Mesh {
    const edge: number[] = [];
    for (let i = 0; i < CHUNK_SEG; i += 1) edge.push(i);
    for (let j = 0; j < CHUNK_SEG; j += 1) edge.push(j * CN + CHUNK_SEG);
    for (let i = CHUNK_SEG; i > 0; i -= 1) edge.push(CHUNK_SEG * CN + i);
    for (let j = CHUNK_SEG; j > 0; j -= 1) edge.push(j * CN);
    const total = CN * CN + edge.length;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const x0 = c.ci * CHUNK;
    const z0 = c.cj * CHUNK;
    const put = (v: number, src: number, drop: number) => {
      const i = src % CN;
      const j = Math.floor(src / CN);
      const x = x0 + i * CELL;
      const z = z0 + j * CELL;
      pos[v * 3] = x;
      pos[v * 3 + 1] = c.heights[src] - drop;
      pos[v * 3 + 2] = z;
      nor.set(c.normals.subarray(src * 3, src * 3 + 3), v * 3);
      col.set(c.colors.subarray(src * 3, src * 3 + 3), v * 3);
      uv[v * 2] = x / 6;
      uv[v * 2 + 1] = z / 6;
    };
    for (let k = 0; k < CN * CN; k += 1) put(k, k, 0);
    edge.forEach((src, e) => put(CN * CN + e, src, 6));
    const index: number[] = [];
    for (let j = 0; j < CHUNK_SEG; j += 1) {
      for (let i = 0; i < CHUNK_SEG; i += 1) {
        const a = j * CN + i;
        const b = (j + 1) * CN + i;
        const d = j * CN + i + 1;
        const e = (j + 1) * CN + i + 1;
        index.push(a, b, d, b, e, d);
      }
    }
    // the curtain, both faces
    for (let e = 0; e < edge.length; e += 1) {
      const a = edge[e];
      const b = edge[(e + 1) % edge.length];
      const a2 = CN * CN + e;
      const b2 = CN * CN + ((e + 1) % edge.length);
      index.push(a, b, a2, b, b2, a2, a, a2, b, b, a2, b2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.terrain.mesh.material);
    mesh.receiveShadow = true;
    mesh.name = `frontier-${c.ci}:${c.cj}`;
    return mesh;
  }

  // ---------------------------------------------------------------- horizon

  /** Coarse heights and colours for the horizon and the region map, a couple of ms per frame. */
  private runLows(): void {
    const t0 = performance.now();
    while (this.lowQueue.length && performance.now() - t0 < BUDGET_LOW) {
      const q = this.lowQueue.shift() as { ci: number; cj: number; key: number };
      this.lowQueued.delete(q.key);
      if (this.lows.has(q.key)) continue;
      const hb = new Float32Array(LBN * LBN);
      const x0 = q.ci * CHUNK - LCELL;
      const z0 = q.cj * CHUNK - LCELL;
      for (let j = 0; j < LBN; j += 1) for (let i = 0; i < LBN; i += 1) hb[j * LBN + i] = this.terrain.sample(x0 + i * LCELL, z0 + j * LCELL);
      const h = new Float32Array(LN * LN);
      const n = new Float32Array(LN * LN * 3);
      const c = new Float32Array(LN * LN * 3);
      const v = new THREE.Vector3();
      for (let j = 0; j < LN; j += 1) {
        for (let i = 0; i < LN; i += 1) {
          const b = (j + 1) * LBN + (i + 1);
          const k = j * LN + i;
          h[k] = hb[b];
          v.set(hb[b - 1] - hb[b + 1], 2 * LCELL, hb[b - LBN] - hb[b + LBN]).normalize();
          n.set([v.x, v.y, v.z], k * 3);
          const slope = Math.hypot(hb[b + 1] - hb[b - 1], hb[b + LBN] - hb[b - LBN]) / (2 * LCELL);
          this.terrain.colorAt(q.ci * CHUNK + i * LCELL, q.cj * CHUNK + j * LCELL, h[k], slope, this.tmpC);
          c.set([this.tmpC.r, this.tmpC.g, this.tmpC.b], k * 3);
        }
      }
      this.lows.set(q.key, { h, n, c });
      this.onLow?.(q.ci, q.cj, h, c);
      this.farDirty = true;
    }
  }

  /**
   * One mesh for every coarse chunk in range that has no full-detail chunk on top
   * of it. Neighbouring coarse chunks share their edge vertices exactly, so they
   * need no curtain; the detailed chunks and the valley carry their own.
   */
  private rebuildFar(): void {
    this.farAt = this.elapsed;
    this.farDirty = false;
    const p = this.player;
    const r = Math.ceil(FAR / CHUNK) + 1;
    const picks: [number, number, Low][] = [];
    for (let i = this.pci - r; i <= this.pci + r; i += 1) {
      for (let j = this.pcj - r; j <= this.pcj + r; j += 1) {
        if (inCore(i, j)) continue;
        const key = chunkKey(i, j);
        if (this.live.has(key)) continue;
        const low = this.lows.get(key);
        if (!low || Math.hypot((i + 0.5) * CHUNK - p.x, (j + 0.5) * CHUNK - p.z) > FAR) continue;
        picks.push([i, j, low]);
      }
    }
    const per = LN * LN;
    const pos = new Float32Array(picks.length * per * 3);
    const nor = new Float32Array(picks.length * per * 3);
    const col = new Float32Array(picks.length * per * 3);
    const uv = new Float32Array(picks.length * per * 2);
    const index: number[] = [];
    picks.forEach(([ci, cj, low], q) => {
      const base = q * per;
      const put = (v: number, src: number) => {
        const x = ci * CHUNK + (src % LN) * LCELL;
        const z = cj * CHUNK + Math.floor(src / LN) * LCELL;
        const o = (base + v) * 3;
        pos[o] = x;
        pos[o + 1] = low.h[src];
        pos[o + 2] = z;
        nor.set(low.n.subarray(src * 3, src * 3 + 3), o);
        col.set(low.c.subarray(src * 3, src * 3 + 3), o);
        uv[(base + v) * 2] = x / 6;
        uv[(base + v) * 2 + 1] = z / 6;
      };
      for (let k = 0; k < LN * LN; k += 1) put(k, k);
      for (let j = 0; j < LOW_SEG; j += 1) {
        for (let i = 0; i < LOW_SEG; i += 1) {
          const a = base + j * LN + i;
          index.push(a, a + LN, a + 1, a + LN, a + LN + 1, a + 1);
        }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    this.far.geometry.dispose();
    this.far.geometry = geo;
  }

  /** Refill the shared tree/rock instance pools from the chunks on screen (near ones in full detail). */
  private refillFlora(): void {
    this.floraDirty = false;
    const counts = new Map<string, number>();
    for (const l of this.live.values()) {
      const c = l.chunk;
      const near = Math.hypot((c.ci + 0.5) * CHUNK - this.player.x, (c.cj + 0.5) * CHUNK - this.player.z) < DETAIL + CHUNK * 0.7;
      for (const plant of c.plants) {
        if (plant.h) plant.h.refs = [];
        if (plant.h?.done) continue;
        const lod = near || plant.sp === 'scrub' ? 'hi' : 'lo';
        if (plant.sp === 'scrub' && !near) continue;
        const key = `${plant.sp}:${lod}`;
        const meshes = this.pools.get(key);
        const n = counts.get(key) ?? 0;
        if (!meshes || n >= CAP[plant.sp]) continue;
        for (const m of meshes) {
          m.setMatrixAt(n, plant.m);
          plant.h?.refs.push({ mesh: m, index: n });
        }
        counts.set(key, n + 1);
      }
    }
    for (const [key, meshes] of this.pools) {
      const n = counts.get(key) ?? 0;
      for (const m of meshes) {
        m.count = n;
        // an empty pool costs a draw call (and a shadow one) all the same
        m.visible = n > 0;
        m.instanceMatrix.needsUpdate = true;
      }
    }
  }

  // ---------------------------------------------------------------- queries

  /** For tests and the debug panel. */
  stats(): {
    seed: number;
    live: number;
    generated: number;
    pending: number;
    horizon: number;
    trees: number;
    rocks: number;
    resources: Record<string, number>;
    sites: { id: string; kind: string; x: number; z: number; name: string }[];
  } {
    let trees = 0;
    let rocks = 0;
    const resources: Record<string, number> = {};
    for (const l of this.live.values()) {
      for (const p of l.chunk.plants) {
        if (p.h?.kind === 'tree' && !p.h.done) trees += 1;
        if (p.h?.kind === 'rock' && !p.h.done) rocks += 1;
      }
      for (const it of l.chunk.interactables) resources[it.kind] = (resources[it.kind] ?? 0) + 1;
    }
    const sites = [...this.live.values()].flatMap((l) => (l.chunk.site ? [l.chunk.site] : [])).map((s) => ({ id: s.id, kind: s.kind, x: s.x, z: s.z, name: s.name.en }));
    return { seed: this.seed, live: this.live.size, generated: this.data.size, pending: this.jobs.length, horizon: this.lows.size, trees, rocks, resources, sites };
  }

  /** True once every chunk within NEAR of the player is on screen. */
  get settled(): boolean {
    return this.jobs.length === 0;
  }

  /** Random walkable spots in loaded chunks between `min` and `max` metres away (wildlife moves in there). */
  openGround(min: number, max: number, rng: () => number): THREE.Vector3 | null {
    const lives = [...this.live.values()];
    for (let k = 0; k < 24 && lives.length; k += 1) {
      const c = lives[Math.floor(rng() * lives.length)].chunk;
      const x = c.ci * CHUNK + rng() * CHUNK;
      const z = c.cj * CHUNK + rng() * CHUNK;
      const d = Math.hypot(x - this.player.x, z - this.player.z);
      if (d < min || d > max || Math.hypot(x, z) < RING_OUT + 20) continue;
      if (this.terrain.getSlope(x, z) > 0.6 || this.collision.blockedAt(x, z, 0.6, this.terrain.getHeight(x, z))) continue;
      return new THREE.Vector3(x, this.terrain.getHeight(x, z), z);
    }
    return null;
  }

  dispose(): void {
    for (const id of [...this.live.keys()]) this.unload(id);
    this.far.geometry.dispose();
  }
}

function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
}
