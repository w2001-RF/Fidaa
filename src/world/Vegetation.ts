import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Noise2D, smoothstep } from '../utils/noise';
import { createSeededRandom } from '../utils/random';
import type { CollisionWorld } from './Collision';
import { OUED, PLAY_RADIUS, ZONES, distToPolyline, distToRoads, reserved, zone } from './layout';
import type { Terrain } from './Terrain';

export type Species = 'palm' | 'olive' | 'argan' | 'cactus' | 'rock' | 'scrub';

/** A tree that can be felled or a rock that can be quarried. */
export type Harvestable = {
  id: number;
  kind: 'tree' | 'rock';
  species: 'palm' | 'olive' | 'argan' | 'rock';
  x: number;
  z: number;
  y: number;
  scale: number;
  done: boolean;
  refs: { mesh: THREE.InstancedMesh; index: number }[];
  collider?: { enabled: boolean };
  cover?: { r: number };
  /** frontier trees and rocks: a stable id across sessions (the valley's use their index) */
  key?: string;
  /** chance a quarried rock gives ore (default by distance to the old mine) */
  ore?: number;
};

const HARVEST_CELL = 8;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export type Part = { geometry: THREE.BufferGeometry; lo?: THREE.BufferGeometry; material: THREE.Material; shadow: boolean };

/** Beyond this distance chunks swap to low-detail geometry and stop casting shadows. */
const LOD_DIST = 75;

const CHUNK = 80;

/**
 * Instanced, chunked vegetation and rocks. Chunks frustum-cull and hide by
 * distance; foliage sways in a vertex shader.
 */
export class Vegetation {
  readonly group = new THREE.Group();
  /** Spots that conceal a crouched player (olive/argan canopies, cactus, scrub clumps). */
  readonly cover: { x: number; z: number; r: number }[] = [];
  readonly harvestables: Harvestable[] = [];
  private readonly harvestByMatrix = new Map<THREE.Matrix4, Harvestable>();
  private readonly harvestGrid = new Map<string, Harvestable[]>();
  private readonly swayMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly chunks: { center: THREE.Vector3; meshes: THREE.InstancedMesh[]; maxDist: number }[] = [];
  /** Shared per-species geometry and materials (the frontier instances them too). */
  readonly parts: Record<Species, Part[]>;

  constructor(terrain: Terrain, collision: CollisionWorld) {
    this.group.name = 'vegetation';
    const bark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    const leaf = this.swayMaterial(0.12, 'sway-leaf');
    const stiffLeaf = this.swayMaterial(0.03, 'sway-stiff');
    const grass = this.swayMaterial(0.22, 'sway-grass');
    const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true });

    this.parts = {
      palm: [
        { geometry: palmTrunk(), material: bark, shadow: true },
        { geometry: palmCrown(13, 9), lo: palmCrown(8, 4), material: leaf, shadow: true },
      ],
      olive: [
        { geometry: oliveTrunk(7, 6), lo: oliveTrunk(5, 2), material: bark, shadow: true },
        { geometry: blobCanopy(7, 2.1, 1.25, '#76845a', '#9aa77b', 3, 1), lo: blobCanopy(7, 2.1, 1.25, '#76845a', '#9aa77b', 3, 0), material: stiffLeaf, shadow: true },
      ],
      argan: [
        { geometry: arganTrunk(7, 6), lo: arganTrunk(5, 2), material: bark, shadow: true },
        { geometry: blobCanopy(9, 3.0, 0.8, '#3f5428', '#5f7438', 4, 1), lo: blobCanopy(9, 3.0, 0.8, '#3f5428', '#5f7438', 4, 0), material: stiffLeaf, shadow: true },
      ],
      cactus: [{ geometry: pricklyPear(7, 5), lo: pricklyPear(4, 3), material: stiffLeaf, shadow: true }],
      rock: [{ geometry: rockGeo(1), lo: rockGeo(0), material: rock, shadow: true }],
      scrub: [{ geometry: scrubGeo(), material: grass, shadow: false }],
    };

    const placements = this.scatter(terrain, collision);
    this.buildChunks(placements);
  }

  update(elapsed: number, cameraPos: THREE.Vector3): void {
    for (const m of this.swayMaterials) {
      const shader = m.userData.shader as { uniforms: { uTime: { value: number } } } | undefined;
      if (shader) shader.uniforms.uTime.value = elapsed;
    }
    for (const chunk of this.chunks) {
      const d = chunk.center.distanceTo(cameraPos);
      const visible = d < chunk.maxDist + CHUNK * 0.71;
      const near = d < LOD_DIST + CHUNK * 0.71;
      for (const mesh of chunk.meshes) {
        mesh.visible = visible;
        const lo = mesh.userData.lo as THREE.BufferGeometry | undefined;
        if (lo) {
          mesh.geometry = near ? (mesh.userData.hi as THREE.BufferGeometry) : lo;
          mesh.castShadow = near;
        }
      }
    }
  }

  /** Nearest standing tree or rock within `maxDist` of (x, z). */
  nearestHarvestable(x: number, z: number, maxDist: number): Harvestable | null {
    let best: Harvestable | null = null;
    let bestD = maxDist;
    const cx = Math.floor(x / HARVEST_CELL);
    const cz = Math.floor(z / HARVEST_CELL);
    for (let i = cx - 1; i <= cx + 1; i += 1) {
      for (let j = cz - 1; j <= cz + 1; j += 1) {
        for (const h of this.harvestGrid.get(`${i}:${j}`) ?? []) {
          if (h.done) continue;
          // reach the trunk or the rock's surface, not its centre
          const d = Math.hypot(h.x - x, h.z - z) - (h.kind === 'rock' ? h.scale * 0.8 : 0.4);
          if (d < bestD) {
            bestD = d;
            best = h;
          }
        }
      }
    }
    return best;
  }

  /** A tree or rock that appears later (the streamed frontier): reachable by nearestHarvestable. */
  addHarvestable(h: Harvestable): void {
    const key = `${Math.floor(h.x / HARVEST_CELL)}:${Math.floor(h.z / HARVEST_CELL)}`;
    const cell = this.harvestGrid.get(key);
    if (cell) cell.push(h);
    else this.harvestGrid.set(key, [h]);
  }

  /** Forget every frontier tree and rock (a new world is being generated). */
  dropKeyed(): void {
    for (const [k, cell] of this.harvestGrid) {
      const kept = cell.filter((h) => h.key === undefined);
      if (kept.length) this.harvestGrid.set(k, kept);
      else this.harvestGrid.delete(k);
    }
  }

  /** Fell a tree / break up a rock: its instances vanish, its collider and cover go with it. */
  harvest(h: Harvestable): void {
    if (h.done) return;
    h.done = true;
    for (const { mesh, index } of h.refs) {
      mesh.setMatrixAt(index, ZERO);
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (h.collider) h.collider.enabled = false;
    if (h.cover) h.cover.r = 0;
  }

  private swayMaterial(amount: number, key: string): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      m.userData.shader = shader;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float phase = instanceMatrix[3].x * 0.3 + instanceMatrix[3].z * 0.2;
         #else
           float phase = 0.0;
         #endif
         float h = max(position.y - 0.4, 0.0);
         transformed.x += sin(uTime * 1.3 + phase) * ${amount.toFixed(3)} * h * 0.25;
         transformed.z += cos(uTime * 0.9 + phase * 1.3) * ${(amount * 0.7).toFixed(3)} * h * 0.25;`,
      );
    };
    m.customProgramCacheKey = () => key;
    this.swayMaterials.push(m);
    return m;
  }

  private scatter(terrain: Terrain, collision: CollisionWorld): Map<Species, THREE.Matrix4[]> {
    const rng = createSeededRandom(777);
    const noise = new Noise2D(31);
    const out = new Map<Species, THREE.Matrix4[]>();
    const add = (sp: Species, x: number, z: number, scale: number, yOffset = 0, tiltAmt = 0.05) => {
      const y = terrain.getHeight(x, z) + yOffset;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * tiltAmt, rng() * Math.PI * 2, (rng() - 0.5) * tiltAmt)),
        new THREE.Vector3(scale, scale * (0.85 + rng() * 0.3), scale),
      );
      let list = out.get(sp);
      if (!list) {
        list = [];
        out.set(sp, list);
      }
      list.push(m);
      return m;
    };
    const harvest = (m: THREE.Matrix4, kind: 'tree' | 'rock', sp: Harvestable['species'], x: number, z: number, scale: number) => {
      const h: Harvestable = { id: this.harvestables.length, kind, species: sp, x, z, y: terrain.getHeight(x, z), scale, done: false, refs: [] };
      this.harvestables.push(h);
      this.harvestByMatrix.set(m, h);
      const key = `${Math.floor(x / HARVEST_CELL)}:${Math.floor(z / HARVEST_CELL)}`;
      const cell = this.harvestGrid.get(key);
      if (cell) cell.push(h);
      else this.harvestGrid.set(key, [h]);
      return h;
    };

    const inSettlement = (x: number, z: number, pad: number) => {
      for (const zn of ZONES) {
        if (zn.id === 'oasis') continue;
        const half = zn.id === 'medina' ? 62 : zn.id === 'kasbah' ? 30 : zn.id === 'post' ? 40 : 26;
        if (Math.abs(x - zn.x) < half + pad && Math.abs(z - zn.z) < half + pad) return true;
      }
      return false;
    };

    const free = (x: number, z: number, r: number) => !reserved(x, z, r) && !collision.blockedAt(x, z, r, terrain.getHeight(x, z));
    // trunks stop people, rides and bullets; leaves don't block sight (cover handles that)
    const trunk = (h: Harvestable, r: number, height: number) => {
      h.collider = collision.addCircle(h.x, h.z, r, h.y - 1, h.y + height, false, 'tree');
      return h;
    };

    // Palms along the oued and around the oasis + a few in the douar
    const oasis = zone('oasis');
    for (let i = 0; i < 46; i += 1) {
      const a = rng() * Math.PI * 2;
      const r = 12 + rng() * 22;
      const x = oasis.x + Math.cos(a) * r;
      const z = oasis.z + Math.sin(a) * r;
      if (!free(x, z, 1)) continue;
      const ps = 0.8 + rng() * 0.5;
      trunk(harvest(add('palm', x, z, ps, -0.1, 0.25), 'tree', 'palm', x, z, ps), 0.3 * ps, 7 * ps);
    }
    for (let i = 0; i < 70; i += 1) {
      const seg = Math.floor(rng() * (OUED.length - 1));
      const [ax, az] = OUED[seg];
      const [bx, bz] = OUED[seg + 1];
      const t = rng();
      const side = rng() < 0.5 ? -1 : 1;
      const nx = -(bz - az);
      const nz = bx - ax;
      const nl = Math.hypot(nx, nz);
      const off = side * (5 + rng() * 10);
      const x = ax + (bx - ax) * t + (nx / nl) * off;
      const z = az + (bz - az) * t + (nz / nl) * off;
      if (Math.hypot(x, z) > PLAY_RADIUS - 4 || inSettlement(x, z, 2) || !free(x, z, 1)) continue;
      const ps = 0.7 + rng() * 0.5;
      trunk(harvest(add('palm', x, z, ps, -0.1, 0.3), 'tree', 'palm', x, z, ps), 0.3 * ps, 7 * ps);
    }

    // Olive groves: between douar and medina, and around the douar
    const douar = zone('douar');
    for (let gx = -230; gx < 230; gx += 7) {
      for (let gz = -230; gz < 230; gz += 7) {
        const x = gx + (rng() - 0.5) * 3;
        const z = gz + (rng() - 0.5) * 3;
        const r = Math.hypot(x, z);
        if (r > PLAY_RADIUS - 6) continue;
        const grove = noise.fbm(x * 0.012 + 3, z * 0.012 - 5, 3);
        const nearDouar = 1 - smoothstep(30, 95, Math.hypot(x - douar.x, z - douar.z));
        const p = smoothstep(0.18, 0.5, grove) * 0.55 + nearDouar * 0.6;
        if (rng() > p) continue;
        if (distToRoads(x, z) < 5 || inSettlement(x, z, 3) || !free(x, z, 1.2)) continue;
        if (terrain.getSlope(x, z) > 0.45) continue;
        const os = 0.85 + rng() * 0.45;
        const cov = { x, z, r: 2.4 };
        trunk(harvest(add('olive', x, z, os), 'tree', 'olive', x, z, os), 0.42 * os, 2.6 * os).cover = cov;
        this.cover.push(cov);
      }
    }

    // Argan scattered on hills, prickly pear near paths and the douar
    for (let i = 0; i < 2400; i += 1) {
      const x = (rng() - 0.5) * 2 * PLAY_RADIUS;
      const z = (rng() - 0.5) * 2 * PLAY_RADIUS;
      const r = Math.hypot(x, z);
      if (r > PLAY_RADIUS + 6) continue;
      if (distToRoads(x, z) < 4 || inSettlement(x, z, 2)) continue;
      const slope = terrain.getSlope(x, z);
      const roll = rng();
      if (roll < 0.11 && slope < 0.55) {
        if (!free(x, z, 1.2)) continue;
        const as = 0.8 + rng() * 0.5;
        const cov = { x, z, r: 2.6 };
        trunk(harvest(add('argan', x, z, as), 'tree', 'argan', x, z, as), 0.45 * as, 2.4 * as).cover = cov;
        this.cover.push(cov);
      } else if (roll < 0.17) {
        if (!free(x, z, 0.8)) continue;
        const cs = 0.8 + rng() * 0.6;
        add('cactus', x, z, cs, 0, 0.1);
        collision.addCircle(x, z, 0.7 * cs, terrain.getHeight(x, z) - 1, terrain.getHeight(x, z) + 1.4 * cs, false, 'cactus');
        this.cover.push({ x, z, r: 1.4 });
      }
    }
    // hedges of prickly pear around douar
    for (let i = 0; i < 28; i += 1) {
      const a = (i / 28) * Math.PI * 2;
      const x = douar.x + Math.cos(a) * (36 + rng() * 4);
      const z = douar.z + Math.sin(a) * (36 + rng() * 4);
      if (distToRoads(x, z) < 4 || !free(x, z, 0.8)) continue;
      const cs = 1 + rng() * 0.5;
      add('cactus', x, z, cs, 0, 0.1);
      collision.addCircle(x, z, 0.7 * cs, terrain.getHeight(x, z) - 1, terrain.getHeight(x, z) + 1.4 * cs, false, 'cactus');
      this.cover.push({ x, z, r: 1.5 });
    }

    // Rocks: more on slopes and mountains
    for (let i = 0; i < 1800; i += 1) {
      const x = (rng() - 0.5) * 2 * (PLAY_RADIUS + 50);
      const z = (rng() - 0.5) * 2 * (PLAY_RADIUS + 50);
      const r = Math.hypot(x, z);
      if (r > PLAY_RADIUS + 50) continue;
      const slope = terrain.getSlope(x, z);
      const p = 0.18 + slope * 0.6 + (r > PLAY_RADIUS - 10 ? 0.5 : 0);
      if (rng() > p) continue;
      if (distToRoads(x, z) < 3.5 || inSettlement(x, z, 1) || reserved(x, z, 1)) continue;
      const big = rng() < 0.12;
      const s = big ? 1.6 + rng() * 2.4 : 0.3 + rng() * 0.9;
      const rm = add('rock', x, z, s, -s * 0.25, 0.8);
      const h = s > 0.7 && r < PLAY_RADIUS - 4 ? harvest(rm, 'rock', 'rock', x, z, s) : null;
      if (big && r < PLAY_RADIUS) {
        const c = collision.addCircle(x, z, s * 1.05, terrain.getHeight(x, z) - 1, terrain.getHeight(x, z) + s * 1.2, true, 'rock');
        const cov = { x, z, r: s * 1.3 };
        this.cover.push(cov);
        if (h) {
          h.collider = c;
          h.cover = cov;
        }
      } else if (s > 0.85 && r < PLAY_RADIUS) {
        // knee-high and up: walk round it (smaller stones are stepped over)
        const c = collision.addCircle(x, z, s * 1.0, terrain.getHeight(x, z) - 1, terrain.getHeight(x, z) + s * 0.6, false, 'rock');
        if (h) h.collider = c;
      }
    }

    // Scrub tufts everywhere outside roads & plazas, denser near water
    for (let i = 0; i < 9000; i += 1) {
      const x = (rng() - 0.5) * 2 * PLAY_RADIUS;
      const z = (rng() - 0.5) * 2 * PLAY_RADIUS;
      if (Math.hypot(x, z) > PLAY_RADIUS) continue;
      const wet = 1 - smoothstep(4, 40, distToPolyline(x, z, OUED));
      const p = 0.35 + wet * 0.5 + noise.fbm(x * 0.03, z * 0.03, 2) * 0.4;
      if (rng() > p) continue;
      if (distToRoads(x, z) < 2.6 || inSettlement(x, z, -4) || reserved(x, z, -2)) continue;
      add('scrub', x, z, 0.6 + rng() * 0.8, -0.02, 0.15);
    }
    return out;
  }

  private buildChunks(placements: Map<Species, THREE.Matrix4[]>): void {
    const buckets = new Map<string, Map<Species, THREE.Matrix4[]>>();
    const tmp = new THREE.Vector3();
    for (const [sp, list] of placements) {
      for (const m of list) {
        tmp.setFromMatrixPosition(m);
        const key = `${Math.floor(tmp.x / CHUNK)}:${Math.floor(tmp.z / CHUNK)}`;
        let b = buckets.get(key);
        if (!b) {
          b = new Map();
          buckets.set(key, b);
        }
        let l = b.get(sp);
        if (!l) {
          l = [];
          b.set(sp, l);
        }
        l.push(m);
      }
    }
    for (const [key, b] of buckets) {
      const [cx, cz] = key.split(':').map(Number);
      const chunkMeshes: THREE.InstancedMesh[] = [];
      let maxDist = 260;
      for (const [sp, list] of b) {
        if (sp === 'scrub') maxDist = 260;
        for (const part of this.parts[sp]) {
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
          mesh.userData.hi = part.geometry;
          if (part.lo) mesh.userData.lo = part.lo;
          list.forEach((m, i) => {
            mesh.setMatrixAt(i, m);
            this.harvestByMatrix.get(m)?.refs.push({ mesh, index: i });
          });
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
          mesh.castShadow = part.shadow;
          mesh.receiveShadow = true;
          mesh.name = `veg-${sp}-${key}`;
          if (sp === 'scrub') mesh.userData.maxDist = 110;
          this.group.add(mesh);
          chunkMeshes.push(mesh);
        }
      }
      // scrub hides sooner: put it in its own pseudo-chunk entry
      const scrub = chunkMeshes.filter((m) => m.userData.maxDist === 110);
      const rest = chunkMeshes.filter((m) => m.userData.maxDist !== 110);
      const center = new THREE.Vector3((cx + 0.5) * CHUNK, 0, (cz + 0.5) * CHUNK);
      if (rest.length) this.chunks.push({ center, meshes: rest, maxDist });
      if (scrub.length) this.chunks.push({ center, meshes: scrub, maxDist: 110 });
    }
  }
}

// ---------------------------------------------------------------- geometry

function colorize(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(list, false);
  if (!merged) throw new Error('merge failed');
  return merged;
}

function palmTrunk(): THREE.BufferGeometry {
  const h = 8;
  const g = new THREE.CylinderGeometry(0.2, 0.3, h, 8, 14);
  g.translate(0, h / 2, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i);
    const t = y / h;
    const ring = 1 + Math.abs(Math.sin(y * 4.2)) * 0.12;
    pos.setX(i, pos.getX(i) * ring + t * t * 1.4);
    pos.setZ(i, pos.getZ(i) * ring);
  }
  g.computeVertexNormals();
  const c = new THREE.Color();
  return colorize(g, (_x, y) => c.set('#6e5639').multiplyScalar(0.8 + (Math.abs(Math.sin(y * 4.2)) * 0.35)));
}

function palmCrown(fronds: number, segs: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const top = new THREE.Vector3(1.4, 8, 0);
  const c = new THREE.Color();
  for (let f = 0; f < fronds; f += 1) {
    const yaw = (f / fronds) * Math.PI * 2 + (f % 2) * 0.2;
    const up = f % 3 === 0 ? 0.9 : 0.35;
    const len = 3.2 + (f % 4) * 0.3;
    const verts: number[] = [];
    const cols: number[] = [];
    for (let s = 0; s <= segs; s += 1) {
      const t = s / segs;
      const along = t * len;
      const drop = up * along - along * along * 0.28;
      const width = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.55 + 0.04;
      const cx = Math.cos(yaw) * along;
      const cz = Math.sin(yaw) * along;
      const px = -Math.sin(yaw) * width;
      const pz = Math.cos(yaw) * width;
      const zig = s % 2 ? -0.12 : 0.05;
      verts.push(top.x + cx + px, top.y + drop + zig, top.z + cz + pz);
      verts.push(top.x + cx, top.y + drop + 0.06, top.z + cz);
      verts.push(top.x + cx - px, top.y + drop + zig, top.z + cz - pz);
      c.set(t > 0.75 ? '#8a8a3a' : '#4f6b2a').multiplyScalar(0.85 + (f % 3) * 0.08);
      for (let k = 0; k < 3; k += 1) cols.push(c.r, c.g, c.b);
    }
    const idx: number[] = [];
    for (let s = 0; s < segs; s += 1) {
      const a = s * 3;
      const b2 = (s + 1) * 3;
      idx.push(a, b2, a + 1, a + 1, b2, b2 + 1, a + 1, b2 + 1, a + 2, a + 2, b2 + 1, b2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g.toNonIndexed());
  }
  // date clusters
  for (let k = 0; k < 4; k += 1) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    const g = new THREE.IcosahedronGeometry(0.28, 0);
    g.scale(1, 1.4, 1);
    g.translate(top.x + Math.cos(a) * 0.35, top.y - 0.5, top.z + Math.sin(a) * 0.35);
    parts.push(colorize(g, () => c.set('#b8641e')));
  }
  const crown = merge(parts.map((p) => {
    for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') p.deleteAttribute(name);
    return p;
  }));
  return crown;
}

function bentTrunk(height: number, r0: number, r1: number, bend: number, twist: number, color: string, radial = 7, rings = 6): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, height, radial, rings, true);
  g.translate(0, height / 2, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i);
    const t = y / height;
    const a = t * twist;
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const gnarl = 1 + Math.sin(y * 5 + x * 3) * 0.12;
    pos.setX(i, (x * Math.cos(a) - z * Math.sin(a)) * gnarl + Math.sin(t * Math.PI) * bend);
    pos.setZ(i, (x * Math.sin(a) + z * Math.cos(a)) * gnarl);
  }
  g.computeVertexNormals();
  const c = new THREE.Color();
  return colorize(g, (_x, y) => c.set(color).multiplyScalar(0.75 + Math.sin(y * 7) * 0.12));
}

function oliveTrunk(radial: number, rings: number): THREE.BufferGeometry {
  const a = bentTrunk(2.1, 0.32, 0.18, 0.35, 1.6, '#5e5142', radial, rings);
  const b = bentTrunk(1.6, 0.16, 0.08, 0.5, -1, '#5e5142', radial, rings);
  b.rotateZ(0.6);
  b.translate(0.2, 1.4, 0);
  const c = bentTrunk(1.5, 0.15, 0.07, 0.4, 1, '#5e5142', radial, rings);
  c.rotateZ(-0.55);
  c.rotateY(2);
  c.translate(-0.1, 1.5, 0.1);
  return merge([a, b, c]);
}

function arganTrunk(radial: number, rings: number): THREE.BufferGeometry {
  const a = bentTrunk(1.4, 0.3, 0.22, 0.25, 2.2, '#4d3b2c', radial, rings);
  const b = bentTrunk(1.6, 0.16, 0.08, 0.3, 1, '#4d3b2c', radial, rings);
  b.rotateZ(0.9);
  b.translate(0.1, 1.1, 0);
  const c = bentTrunk(1.6, 0.16, 0.08, 0.3, -1, '#4d3b2c', radial, rings);
  c.rotateZ(-0.9);
  c.rotateY(1.2);
  c.translate(0, 1.1, 0);
  return merge([a, b, c]);
}

function blobCanopy(blobs: number, spread: number, flat: number, dark: string, light: string, y: number, detail: number): THREE.BufferGeometry {
  const rng = createSeededRandom(blobs * 13 + y);
  const noise = new Noise2D(blobs + 3);
  const list: THREE.BufferGeometry[] = [];
  const cDark = new THREE.Color(dark);
  const cLight = new THREE.Color(light);
  const c = new THREE.Color();
  for (let i = 0; i < blobs; i += 1) {
    const a = (i / blobs) * Math.PI * 2 + rng();
    const r = i === 0 ? 0 : spread * (0.45 + rng() * 0.5);
    const size = 0.9 + rng() * 0.6;
    const g = new THREE.IcosahedronGeometry(size, detail);
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k += 1) {
      const vx = pos.getX(k);
      const vy = pos.getY(k);
      const vz = pos.getZ(k);
      const n = 1 + noise.noise(vx * 2 + i, vz * 2 + vy) * 0.25;
      pos.setXYZ(k, vx * n, vy * n * flat, vz * n);
    }
    g.translate(Math.cos(a) * r, y + (rng() - 0.3) * 0.7 - (r / spread) * 0.5, Math.sin(a) * r);
    list.push(
      colorize(g, (vx, vy, vz) => {
        const lit = THREE.MathUtils.clamp((vy - y + 1.2) / 2.4, 0, 1);
        return c.copy(cDark).lerp(cLight, lit * 0.8 + noise.noise(vx * 3, vz * 3) * 0.15);
      }),
    );
  }
  const merged = merge(list);
  merged.computeVertexNormals();
  return merged;
}

function pricklyPear(ws: number, hs: number): THREE.BufferGeometry {
  const rng = createSeededRandom(99);
  const list: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  const pad = (x: number, y: number, z: number, rot: number, tilt: number, s: number, depth: number) => {
    const g = new THREE.SphereGeometry(0.42, ws, hs);
    g.scale(s, s * 1.25, s * 0.28);
    g.rotateZ(tilt);
    g.rotateY(rot);
    g.translate(x, y, z);
    list.push(colorize(g, (_vx, vy) => c.set(depth > 1 ? '#7a9a4c' : '#5f7d3a').multiplyScalar(0.85 + vy * 0.05)));
    if (depth > 1 && rng() < 0.7) {
      const f = new THREE.IcosahedronGeometry(0.07, 0);
      f.translate(x + Math.sin(rot) * 0.05, y + s * 0.5, z);
      list.push(colorize(f, () => c.set('#c2304a')));
    }
  };
  const grow = (x: number, y: number, z: number, rot: number, depth: number) => {
    const tilt = (rng() - 0.5) * 0.9;
    pad(x, y, z, rot, tilt, 1 - depth * 0.12, depth);
    if (depth >= 2) return;
    const kids = 1 + Math.floor(rng() * 2);
    for (let k = 0; k < kids; k += 1) {
      const side = k === 0 ? -1 : 1;
      grow(x + Math.cos(rot) * side * 0.32, y + 0.55, z - Math.sin(rot) * side * 0.32, rot + (rng() - 0.5) * 1.6, depth + 1);
    }
  };
  grow(0, 0.4, 0, 0, 0);
  grow(0.5, 0.35, 0.3, 1.4, 1);
  grow(-0.4, 0.3, -0.3, 2.6, 1);
  return merge(list);
}

function rockGeo(detail: number): THREE.BufferGeometry {
  const noise = new Noise2D(5);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 1 + noise.noise(x * 1.7, z * 1.7 + y) * 0.32;
    pos.setXYZ(i, x * n * 1.15, y * n * 0.7, z * n);
  }
  g.computeVertexNormals();
  const c = new THREE.Color();
  return colorize(g, (x, y, z) => c.set('#8a7766').lerp(new THREE.Color('#6a5a4c'), THREE.MathUtils.clamp(0.5 - y * 0.6 + noise.noise(x * 4, z * 4) * 0.3, 0, 1)));
}

function scrubGeo(): THREE.BufferGeometry {
  const verts: number[] = [];
  const cols: number[] = [];
  const rng = createSeededRandom(4);
  const c = new THREE.Color();
  const blades = 9;
  for (let i = 0; i < blades; i += 1) {
    const a = (i / blades) * Math.PI * 2 + rng();
    const lean = 0.25 + rng() * 0.35;
    const h = 0.45 + rng() * 0.5;
    const w = 0.07;
    const bx = Math.cos(a) * 0.08;
    const bz = Math.sin(a) * 0.08;
    const tx = bx + Math.cos(a) * lean;
    const tz = bz + Math.sin(a) * lean;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    verts.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, h, tz);
    c.set(rng() < 0.5 ? '#a49a55' : '#7d8443');
    const top = c.clone().multiplyScalar(1.25);
    const base = c.clone().multiplyScalar(0.6);
    cols.push(base.r, base.g, base.b, base.r, base.g, base.b, top.r, top.g, top.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  // point normals up for soft lighting
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i += 1) n.setXYZ(i, 0, 1, 0);
  return g;
}
