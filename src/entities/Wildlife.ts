import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { L, type Text } from '../i18n';
import type { LootBundle } from '../game/types';
import { angleDiff, clamp } from '../utils/noise';
import { createSeededRandom } from '../utils/random';
import type { CollisionWorld } from '../world/Collision';
import { LIMIT, RING_OUT } from '../world/Lands';
import { ZONES, reserved } from '../world/layout';
import type { Terrain } from '../world/Terrain';

export type Species = 'gazelle' | 'boar' | 'hare';
type AnimalState = 'graze' | 'walk' | 'flee' | 'charge' | 'dead';

type SpeciesDef = {
  name: Text;
  hp: number;
  /** body hit sphere: centre height and radius */
  bodyY: number;
  radius: number;
  walk: number;
  run: number;
  /** distance at which a standing player is noticed in daylight */
  sense: number;
  legs: [number, number, number][];
  legLen: number;
  /** what a careful skinning yields */
  yield: LootBundle;
  xp: number;
  color: string;
};

export const SPECIES: Record<Species, SpeciesDef> = {
  gazelle: {
    name: L('Dorcas gazelle', 'الغزال'),
    hp: 60,
    bodyY: 0.68,
    radius: 0.42,
    walk: 1.3,
    run: 11,
    sense: 40,
    legs: [[0.09, 0.56, 0.28], [-0.09, 0.56, 0.28], [0.09, 0.56, -0.3], [-0.09, 0.56, -0.3]],
    legLen: 0.56,
    yield: { rawMeat: 2, hide: 1, bone: 1, sinew: 1 },
    xp: 12,
    color: '#c79a62',
  },
  boar: {
    name: L('Wild boar', 'الحلوف'),
    hp: 170,
    bodyY: 0.55,
    radius: 0.5,
    walk: 1.1,
    run: 7.4,
    sense: 18,
    legs: [[0.15, 0.36, 0.33], [-0.15, 0.36, 0.33], [0.15, 0.36, -0.33], [-0.15, 0.36, -0.33]],
    legLen: 0.36,
    yield: { rawMeat: 4, hide: 2, bone: 2, sinew: 1 },
    xp: 25,
    color: '#4a3a30',
  },
  hare: {
    name: L('Hare', 'الأرنب'),
    hp: 15,
    bodyY: 0.2,
    radius: 0.2,
    walk: 0.6,
    run: 8.5,
    sense: 13,
    legs: [[0.06, 0.13, 0.1], [-0.06, 0.13, 0.1], [0.07, 0.15, -0.12], [-0.07, 0.15, -0.12]],
    legLen: 0.14,
    yield: { rawMeat: 1, hide: 1, sinew: 1 },
    xp: 6,
    color: '#9a7a58',
  },
};

export type Animal = {
  id: string;
  species: Species;
  pos: THREE.Vector3;
  home: THREE.Vector3;
  yaw: number;
  speed: number;
  heading: number;
  state: AnimalState;
  timer: number;
  hp: number;
  phase: number;
  deadT: number;
  respawnAt: number;
  skinned: boolean;
  attackCd: number;
  /** set by Game when the kill has been handled */
  counted: boolean;
};

export type WildlifeContext = {
  playerPos: THREE.Vector3;
  /** posture/skill multiplier from Player.stealthFactor (lower = harder to notice) */
  stealth: number;
  hunterRank: number;
  night: number;
  now: number;
  cameraPos: THREE.Vector3;
  playerDead: boolean;
};

const MAX_DRAW = 140;

/**
 * Animals of the wilds. Every species is two InstancedMeshes (body and legs),
 * so all wildlife costs six draw calls. Simple steering: graze and wander,
 * flee from the player and from noise, boars charge when hurt or cornered.
 */
export class Wildlife {
  readonly group = new THREE.Group();
  readonly animals: Animal[] = [];
  /** boar contact attack */
  onAttack: ((a: Animal) => void) | null = null;
  /** first time a boar commits to a charge */
  onCharge: ((a: Animal) => void) | null = null;
  private readonly bodies = {} as Record<Species, THREE.InstancedMesh>;
  private readonly legMeshes = {} as Record<Species, THREE.InstancedMesh>;
  private readonly rng = createSeededRandom(1912);
  private readonly m = new THREE.Matrix4();
  private readonly m2 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  constructor(
    private readonly terrain: Terrain,
    private readonly collision: CollisionWorld,
  ) {
    this.group.name = 'wildlife';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
    const counts: Record<Species, number> = { gazelle: 0, boar: 0, hare: 0 };
    // gazelle herds on the open plains, boars in the hills, hares everywhere in the wilds
    const herds: [Species, number, number, number][] = [
      ['gazelle', -40, -170, 5],
      ['gazelle', 170, -150, 4],
      ['gazelle', -190, -110, 4],
      ['boar', -200, 150, 2],
      ['boar', 190, 60, 2],
      ['boar', 60, 200, 2],
      ['boar', -175, -20, 1],
    ];
    for (const [sp, hx, hz, n] of herds) for (let i = 0; i < n; i += 1) this.spawnNear(sp, hx, hz, 10);
    for (let i = 0, made = 0; i < 300 && made < 12; i += 1) {
      const a = this.rng() * Math.PI * 2;
      const r = 60 + this.rng() * 150;
      if (this.spawnNear('hare', Math.cos(a) * r, Math.sin(a) * r, 0)) made += 1;
    }
    for (const a of this.animals) counts[a.species] += 1;
    for (const sp of Object.keys(SPECIES) as Species[]) {
      const [body, leg] = buildSpecies(sp);
      const b = new THREE.InstancedMesh(body, mat, Math.max(1, counts[sp]));
      const l = new THREE.InstancedMesh(leg, mat, Math.max(1, counts[sp] * 4));
      for (const im of [b, l]) {
        // thin legs and the little hares add a shadow pass for no visible gain
        im.castShadow = im === b && sp !== 'hare';
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.count = 0;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(im);
      }
      b.name = `wildlife-${sp}`;
      this.bodies[sp] = b;
      this.legMeshes[sp] = l;
    }
  }

  private spawnNear(sp: Species, hx: number, hz: number, spread: number): boolean {
    for (let tries = 0; tries < 20; tries += 1) {
      const x = hx + (this.rng() - 0.5) * spread * 2;
      const z = hz + (this.rng() - 0.5) * spread * 2;
      if (!this.walkable(x, z)) continue;
      const pos = new THREE.Vector3(x, this.terrain.getHeight(x, z), z);
      const def = SPECIES[sp];
      this.animals.push({
        id: `${sp}-${this.animals.length}`,
        species: sp,
        pos,
        home: pos.clone(),
        yaw: this.rng() * Math.PI * 2,
        speed: 0,
        heading: this.rng() * Math.PI * 2,
        state: 'graze',
        timer: this.rng() * 4,
        hp: def.hp,
        phase: this.rng() * 10,
        deadT: 0,
        respawnAt: Infinity,
        skinned: false,
        attackCd: 0,
        counted: false,
      });
      return true;
    }
    return false;
  }

  /** Open ground away from towns, inside the play area, not too steep. */
  private walkable(x: number, z: number): boolean {
    // the valley and the open lands beyond the ring; not the mountain ring itself, not past the edge
    const r = Math.hypot(x, z);
    if ((r > 222 && r < RING_OUT + 20) || Math.max(Math.abs(x), Math.abs(z)) > LIMIT - 30) return false;
    for (const zn of ZONES) if (Math.hypot(x - zn.x, z - zn.z) < zn.radius + 12) return false;
    if (this.terrain.getSlope(x, z) > 0.75 || reserved(x, z, -3)) return false;
    return !this.collision.blockedAt(x, z, 0.5, this.terrain.getHeight(x, z));
  }

  get alive(): number {
    return this.animals.filter((a) => a.state !== 'dead').length;
  }

  /** Noise scatters animals: gunshots, sprinting, sabotage. */
  hearNoise(at: THREE.Vector3, radius: number): void {
    for (const a of this.animals) {
      if (a.state === 'dead' || a.state === 'charge') continue;
      if (a.pos.distanceTo(at) > radius * 1.4) continue;
      this.flee(a, at, 7 + this.rng() * 4);
    }
  }

  private flee(a: Animal, from: THREE.Vector3, seconds: number): void {
    a.state = 'flee';
    a.timer = seconds;
    a.heading = Math.atan2(a.pos.x - from.x, a.pos.z - from.z) + (this.rng() - 0.5) * 0.6;
  }

  /** Returns true when the hit killed it. */
  takeHit(a: Animal, dmg: number, from: THREE.Vector3): boolean {
    if (a.state === 'dead') return false;
    a.hp -= dmg;
    if (a.hp <= 0) {
      a.state = 'dead';
      a.deadT = 0;
      a.speed = 0;
      return true;
    }
    if (a.species === 'boar') {
      if (a.state !== 'charge') this.onCharge?.(a);
      a.state = 'charge';
      a.timer = 9;
    } else this.flee(a, from, 9);
    return false;
  }

  /** Nearest animal hit by a ray (bullets, sling stones). */
  hitTest(origin: THREE.Vector3, dir: THREE.Vector3, range: number): { animal: Animal; t: number } | null {
    let best: { animal: Animal; t: number } | null = null;
    for (const a of this.animals) {
      if (a.skinned) continue;
      const def = SPECIES[a.species];
      const c = this.v.set(a.pos.x, a.pos.y + (a.state === 'dead' ? def.radius * 0.6 : def.bodyY), a.pos.z);
      const ox = origin.x - c.x;
      const oy = origin.y - c.y;
      const oz = origin.z - c.z;
      const b = ox * dir.x + oy * dir.y + oz * dir.z;
      const cc = ox * ox + oy * oy + oz * oz - def.radius * def.radius;
      const disc = b * b - cc;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > range) continue;
      if (!best || t < best.t) best = { animal: a, t };
    }
    return best;
  }

  /** Remove a skinned carcass until it respawns. */
  skin(a: Animal, now: number): void {
    a.skinned = true;
    a.respawnAt = now + 240;
  }

  update(dt: number, ctx: WildlifeContext): void {
    for (const a of this.animals) this.think(a, dt, ctx);
    this.draw(ctx);
  }

  private think(a: Animal, dt: number, ctx: WildlifeContext): void {
    const def = SPECIES[a.species];
    if (a.state === 'dead') {
      a.deadT += dt;
      if (a.skinned && ctx.now > a.respawnAt && a.home.distanceTo(ctx.playerPos) > 100) this.respawn(a);
      return;
    }
    a.attackCd = Math.max(0, a.attackCd - dt);
    a.timer -= dt;
    const dx = ctx.playerPos.x - a.pos.x;
    const dz = ctx.playerPos.z - a.pos.z;
    const d = Math.hypot(dx, dz);

    // senses: sight/smell scaled by the player's posture, night and Hunter rank
    if (!ctx.playerDead && a.state !== 'flee' && a.state !== 'charge') {
      const range = def.sense * ctx.stealth * (1 - ctx.night * 0.35) * (1 - ctx.hunterRank * 0.08);
      if (d < range) {
        if (a.species === 'boar' && d < 6) {
          this.onCharge?.(a);
          a.state = 'charge';
          a.timer = 8;
        } else this.flee(a, ctx.playerPos, 6 + this.rng() * 5);
      }
    }

    let want = 0;
    if (a.state === 'flee') {
      want = def.run * (a.timer > 1.5 ? 1 : 0.5);
      if (a.timer <= 0) {
        a.state = 'walk';
        a.timer = 3;
      }
    } else if (a.state === 'charge') {
      a.heading = Math.atan2(dx, dz);
      want = def.run;
      if (d < 1.7 && a.attackCd <= 0 && !ctx.playerDead) {
        a.attackCd = 1.3;
        this.onAttack?.(a);
      }
      if (a.timer <= 0 || d > 45 || ctx.playerDead) this.flee(a, ctx.playerPos, 6);
    } else {
      if (a.timer <= 0) {
        // alternate grazing and short walks around home
        if (a.state === 'graze') {
          a.state = 'walk';
          a.timer = 2 + this.rng() * 4;
          const toHome = Math.atan2(a.home.x - a.pos.x, a.home.z - a.pos.z);
          a.heading = a.pos.distanceTo(a.home) > 25 ? toHome : a.heading + (this.rng() - 0.5) * 2.4;
        } else {
          a.state = 'graze';
          a.timer = 3 + this.rng() * 6;
        }
      }
      want = a.state === 'walk' ? def.walk : 0;
    }

    a.speed += (want - a.speed) * (1 - Math.exp(-dt * (a.state === 'flee' || a.state === 'charge' ? 6 : 3)));
    if (a.speed > 0.05) {
      const nx = a.pos.x + Math.sin(a.heading) * a.speed * dt;
      const nz = a.pos.z + Math.cos(a.heading) * a.speed * dt;
      if (this.walkable(nx, nz) || a.state === 'charge') {
        a.pos.x = nx;
        a.pos.z = nz;
        this.collision.resolveCircle(a.pos, def.radius * 0.8, 1);
      } else {
        // blocked by a town, cliff or wall: turn away
        a.heading += Math.PI * (0.5 + this.rng() * 0.5);
      }
      a.yaw += angleDiff(a.yaw, a.heading) * Math.min(1, dt * 8);
    }
    a.pos.y = this.terrain.getHeight(a.pos.x, a.pos.z);
    a.phase += dt * (a.speed * (a.species === 'hare' ? 2.6 : 3.2) + (a.state === 'graze' ? 0.6 : 0));
  }

  /**
   * Move an animal (alive, or a skinned carcass) to new grazing ground: the
   * herds follow the player out into the lands instead of staying in the valley.
   */
  relocate(a: Animal, at: THREE.Vector3): void {
    a.home.copy(at);
    this.respawn(a);
  }

  private respawn(a: Animal): void {
    a.pos.copy(a.home);
    a.state = 'graze';
    a.hp = SPECIES[a.species].hp;
    a.skinned = false;
    a.counted = false;
    a.deadT = 0;
    a.respawnAt = Infinity;
    a.timer = 2;
  }

  private draw(ctx: WildlifeContext): void {
    for (const sp of Object.keys(SPECIES) as Species[]) {
      this.bodies[sp].count = 0;
      this.legMeshes[sp].count = 0;
    }
    let drawn = 0;
    for (const a of this.animals) {
      if (a.skinned || drawn >= MAX_DRAW) continue;
      if (a.pos.distanceTo(ctx.cameraPos) > 150) continue;
      drawn += 1;
      const def = SPECIES[a.species];
      const body = this.bodies[a.species];
      const legs = this.legMeshes[a.species];
      const lie = a.state === 'dead' ? clamp(a.deadT * 2.5, 0, 1) : 0;
      const hop = a.species === 'hare' ? Math.abs(Math.sin(a.phase)) * 0.12 * Math.min(1, a.speed / 2) : 0;
      // graze: dip the whole body forward a little
      const dip = a.state === 'graze' ? 0.12 : 0;
      this.e.set(dip * (1 - lie), a.yaw, (Math.PI / 2) * lie, 'YXZ');
      this.q.setFromEuler(this.e);
      this.v.set(a.pos.x, a.pos.y + hop - def.bodyY * 0.55 * lie, a.pos.z);
      this.m.compose(this.v, this.q, this.s);
      body.setMatrixAt(body.count, this.m);
      body.count += 1;
      const swing = Math.min(1, a.speed / 2) * 0.7 * (1 - lie);
      def.legs.forEach(([lx, ly, lz], k) => {
        const diag = k === 0 || k === 3 ? 1 : -1;
        const ang = (a.species === 'hare' ? Math.sin(a.phase * 2 + (k < 2 ? 0 : 1.5)) : Math.sin(a.phase * 2) * diag) * swing;
        this.m2.makeRotationX(ang);
        this.m2.setPosition(lx, ly, lz);
        this.m2.premultiply(this.m);
        legs.setMatrixAt(legs.count, this.m2);
        legs.count += 1;
      });
    }
    for (const sp of Object.keys(SPECIES) as Species[]) {
      this.bodies[sp].instanceMatrix.needsUpdate = true;
      this.legMeshes[sp].instanceMatrix.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ models

function part(g: THREE.BufferGeometry, color: string, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('wildlife merge failed');
  g.computeVertexNormals();
  return g;
};

/** Body (+z forward, origin on the ground) and one leg (pivot at the hip, hanging down). */
function buildSpecies(sp: Species): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const H = Math.PI / 2;
  if (sp === 'gazelle') {
    const tan = '#c79a62';
    const body = merge([
      part(new THREE.CapsuleGeometry(0.17, 0.62, 4, 10), tan, 0, 0.7, 0, H),
      part(new THREE.CapsuleGeometry(0.13, 0.5, 4, 8), '#f1ebe0', 0, 0.62, 0, H, 0, 0, 1, 1, 0.9), // white belly
      part(new THREE.BoxGeometry(0.02, 0.06, 0.6), '#6e4a2a', 0.165, 0.66, 0), // dark flank stripe
      part(new THREE.BoxGeometry(0.02, 0.06, 0.6), '#6e4a2a', -0.165, 0.66, 0),
      part(new THREE.CylinderGeometry(0.06, 0.09, 0.42, 8), tan, 0, 0.98, 0.36, 0.55),
      part(new THREE.CapsuleGeometry(0.075, 0.16, 4, 8), tan, 0, 1.17, 0.5, 1.3),
      part(new THREE.SphereGeometry(0.05, 6, 5), '#f1ebe0', 0, 1.12, 0.6),
      part(new THREE.ConeGeometry(0.018, 0.3, 5), '#2a2018', 0.04, 1.36, 0.42, -0.45, 0, 0.15), // lyre horns
      part(new THREE.ConeGeometry(0.018, 0.3, 5), '#2a2018', -0.04, 1.36, 0.42, -0.45, 0, -0.15),
      part(new THREE.ConeGeometry(0.035, 0.13, 5), tan, 0.08, 1.26, 0.45, -0.2, 0, 0.9),
      part(new THREE.ConeGeometry(0.035, 0.13, 5), tan, -0.08, 1.26, 0.45, -0.2, 0, -0.9),
      part(new THREE.ConeGeometry(0.03, 0.14, 5), '#2a2018', 0, 0.74, -0.47, -2.3),
    ]);
    const leg = merge([part(new THREE.CylinderGeometry(0.028, 0.018, 0.56, 6), tan, 0, -0.28, 0), part(new THREE.BoxGeometry(0.04, 0.04, 0.05), '#2a2018', 0, -0.56, 0.01)]);
    return [body, leg];
  }
  if (sp === 'boar') {
    const coat = '#4a3a30';
    const body = merge([
      part(new THREE.CapsuleGeometry(0.3, 0.6, 4, 10), coat, 0, 0.58, 0, H, 0, 0, 1, 1.05, 0.9),
      part(new THREE.BoxGeometry(0.1, 0.12, 0.8), '#2e241e', 0, 0.9, 0.05), // bristle mane
      part(new THREE.ConeGeometry(0.22, 0.48, 10), coat, 0, 0.56, 0.62, H),
      part(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8), '#6a5048', 0, 0.54, 0.86, H),
      part(new THREE.ConeGeometry(0.02, 0.12, 5), '#efe6cf', 0.08, 0.5, 0.78, -0.6),
      part(new THREE.ConeGeometry(0.02, 0.12, 5), '#efe6cf', -0.08, 0.5, 0.78, -0.6),
      part(new THREE.ConeGeometry(0.06, 0.14, 5), '#2e241e', 0.12, 0.76, 0.5, -0.3, 0, 0.5),
      part(new THREE.ConeGeometry(0.06, 0.14, 5), '#2e241e', -0.12, 0.76, 0.5, -0.3, 0, -0.5),
      part(new THREE.BoxGeometry(0.025, 0.025, 0.03), '#0e0a08', 0.1, 0.68, 0.68),
      part(new THREE.BoxGeometry(0.025, 0.025, 0.03), '#0e0a08', -0.1, 0.68, 0.68),
      part(new THREE.CylinderGeometry(0.015, 0.01, 0.2, 4), '#2e241e', 0, 0.6, -0.55, -2.4),
    ]);
    const leg = merge([part(new THREE.CylinderGeometry(0.06, 0.045, 0.36, 6), coat, 0, -0.18, 0), part(new THREE.BoxGeometry(0.07, 0.04, 0.08), '#1a1410', 0, -0.36, 0.01)]);
    return [body, leg];
  }
  const fur = '#9a7a58';
  const body = merge([
    part(new THREE.SphereGeometry(0.15, 10, 8), fur, 0, 0.22, -0.04, 0, 0, 0, 0.9, 0.85, 1.3),
    part(new THREE.SphereGeometry(0.08, 8, 6), fur, 0, 0.34, 0.15),
    part(new THREE.CapsuleGeometry(0.022, 0.16, 3, 6), '#8a6a4a', 0.03, 0.5, 0.11, -0.25, 0, 0.1),
    part(new THREE.CapsuleGeometry(0.022, 0.16, 3, 6), '#8a6a4a', -0.03, 0.5, 0.11, -0.25, 0, -0.1),
    part(new THREE.SphereGeometry(0.04, 6, 5), '#f2efe8', 0, 0.26, -0.22),
    part(new THREE.BoxGeometry(0.018, 0.018, 0.02), '#0e0a08', 0.05, 0.37, 0.2),
    part(new THREE.BoxGeometry(0.018, 0.018, 0.02), '#0e0a08', -0.05, 0.37, 0.2),
  ]);
  const leg = merge([part(new THREE.CylinderGeometry(0.025, 0.02, 0.14, 5), fur, 0, -0.07, 0.02)]);
  return [body, leg];
}

export { part as buildPart, merge as mergeParts };
