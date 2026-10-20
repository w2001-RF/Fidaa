import * as THREE from 'three';
import { MergeBuilder, archGeo2, boxGeo, cylGeo, latheGeo } from '../assets/GeometryKit';
import type { MaterialLibrary } from '../assets/Materials';
import type { EnemySpawn, Interactable, LootBundle, NpcSpawn } from '../game/types';
import { createSeededRandom } from '../utils/random';
import {
  type BuildCtx,
  PLASTER_TINTS,
  barbedFence,
  barracks,
  barrel,
  crate,
  fountain,
  gate,
  house,
  jar,
  minaret,
  oven,
  sandbags,
  shade,
  stall,
  tent,
  toWorld,
  tower,
  truck,
  wall,
  watchtower,
  well,
} from './Architecture';
import { CollisionWorld } from './Collision';
import { ROADS, distToRoads, samplePolyline, zone } from './layout';
import { Terrain } from './Terrain';

export type TelegraphPole = { index: number; pos: THREE.Vector3; top: THREE.Vector3; cut: boolean; mission: boolean };

/**
 * Builds the whole open world and exposes the gameplay points (interactables,
 * spawns, quest targets) the systems need.
 */
export class World {
  readonly group = new THREE.Group();
  readonly terrain: Terrain;
  readonly collision = new CollisionWorld();
  readonly interactables: Interactable[] = [];
  readonly enemySpawns: EnemySpawn[] = [];
  readonly npcSpawns: NpcSpawn[] = [];
  readonly lightPoints: THREE.Vector3[] = [];
  readonly poles: TelegraphPole[] = [];
  readonly playerSpawn = new THREE.Vector3();
  readonly playerSpawnYaw = 0;
  readonly prisonInside = new THREE.Vector3();
  readonly kasbahGate = new THREE.Vector3();
  readonly hideout = new THREE.Vector3();
  /** Gameplay-state meshes */
  readonly leafletMeshes = new Map<string, THREE.Mesh>();
  prisonDoor!: THREE.Object3D;
  prisonDoorCollider!: ReturnType<CollisionWorld['addBox']>;
  armsCache!: THREE.Object3D;
  private wires!: THREE.LineSegments;
  private wireSpans: { a: number; b: number; offset: number }[] = [];
  private readonly flagMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(private readonly lib: MaterialLibrary) {
    this.group.name = 'world';
    this.terrain = new Terrain();
    this.group.add(this.terrain.mesh, this.terrain.water);
    const rng = createSeededRandom(1945);

    this.buildDouar(rng);
    this.buildMedina(rng);
    this.buildKasbah(rng);
    this.buildPost(rng);
    this.buildOasisAndWilds(rng);
    this.buildTelegraph();
  }

  update(elapsed: number): void {
    for (const m of this.flagMaterials) {
      const s = m.userData.shader as { uniforms: { uTime: { value: number } } } | undefined;
      if (s) s.uniforms.uTime.value = elapsed;
    }
  }

  cutPole(index: number): void {
    const pole = this.poles[index];
    if (!pole || pole.cut) return;
    pole.cut = true;
    const pos = this.wires.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ground = this.terrain.getHeight(pole.pos.x, pole.pos.z) + 0.05;
    for (const span of this.wireSpans) {
      if (span.a !== index && span.b !== index) continue;
      // the wires now hang from the far pole and coil on the ground at the cut pole
      const far = span.a === index ? this.poles[span.b] : this.poles[span.a];
      for (let k = 0; k < 3; k += 1) {
        const start = span.offset + k * SAG_SEGMENTS * 2;
        for (let s = 0; s < SAG_SEGMENTS * 2; s += 1) {
          const tAlong = (Math.floor(s / 2) + (s % 2)) / SAG_SEGMENTS; // 0 at pole a, 1 at pole b
          const u = span.a === index ? 1 - tAlong : tAlong; // 0 at far pole, 1 at cut pole
          const topY = far.top.y - 0.1 - k * 0.2;
          const x = far.top.x + (pole.pos.x - far.top.x) * u * 0.45 + (k - 1) * 0.3;
          const z = far.top.z + (pole.pos.z - far.top.z) * u * 0.45;
          const y = Math.max(ground, topY + (ground - topY) * Math.min(1, u * 1.4));
          pos.setXYZ(start + s, x, y, z);
        }
      }
    }
    pos.needsUpdate = true;
  }

  openPrison(): void {
    this.prisonDoor.rotation.y = -1.9;
    this.prisonDoorCollider.enabled = false;
  }

  takeArmsCache(): void {
    this.armsCache.visible = false;
  }

  postLeaflet(id: string): void {
    const m = this.leafletMeshes.get(id);
    if (m) m.visible = true;
  }

  // ------------------------------------------------------------------ zones

  private ctx(b: MergeBuilder, rng: () => number): BuildCtx {
    return { b, col: this.collision, terrain: this.terrain, rng };
  }

  private addInteract(i: Omit<Interactable, 'enabled'> & { enabled?: boolean }): Interactable {
    const it: Interactable = { enabled: true, ...i };
    this.interactables.push(it);
    return it;
  }

  private addLoot(id: string, pos: THREE.Vector3, loot: LootBundle, label = 'Search'): void {
    this.addInteract({ id, kind: 'loot', pos, radius: 1.8, prompt: label, hold: 0.6, loot });
  }

  private buildDouar(rng: () => number): void {
    const b = new MergeBuilder();
    const ctx = this.ctx(b, rng);
    const z0 = zone('douar');
    const cx = z0.x;
    const cz = z0.z;
    const earth = ['#a7663f', '#b8754a', '#9d5c39', '#b06b42'];
    const layout: [number, number, number, number, number, number][] = [
      // lx, lz, w, d, h, angle
      [-14, -10, 8, 7, 3.6, 0.1],
      [-3, -16, 7, 6, 3.4, 0.0],
      [9, -12, 9, 7, 4.2, -0.15],
      [16, 2, 7, 8, 3.6, -Math.PI / 2],
      [-17, 5, 7, 7, 3.5, Math.PI / 2],
      [-8, 16, 8, 6, 3.8, Math.PI],
      [7, 15, 7, 7, 3.4, Math.PI + 0.12],
    ];
    layout.forEach(([lx, lz, w, d, h, a], i) => {
      house(ctx, cx + lx, cz + lz, w, d, h, a, { role: 'pise', tint: earth[i % earth.length], merlons: i % 3 === 0, door: i === 2 ? '#2f5f8a' : undefined });
    });
    // courtyard walls
    wall(ctx, cx - 24, cz - 22, cx - 24, cz + 4, 2.4, 0.6, 'pise', '#a7663f', 0);
    wall(ctx, cx + 22, cz - 20, cx + 22, cz - 6, 2.4, 0.6, 'pise', '#a7663f', 0);

    const w = well(ctx, cx + 2, cz + 1);
    this.addInteract({ id: 'douar-well', kind: 'water', pos: w, radius: 2.4, prompt: 'Draw water from the well', hold: 0.8 });
    const o = oven(ctx, cx - 9, cz - 3, 0.5);
    this.addInteract({ id: 'douar-oven', kind: 'oven', pos: o, radius: 2.2, prompt: 'Take bread from the oven', hold: 0.6 });
    this.lightPoints.push(new THREE.Vector3(o.x, o.y + 1, o.z));

    // sleeping mat + rest point in the safe house
    const [mx, mz] = toWorld(cx + 9, cz - 12, -0.15, 0, 5);
    const mg = this.terrain.getHeight(mx, mz);
    b.put('fabric', boxGeo(1.4, 0.08, 2.1), mx + 2.6, mg + 0.04, mz, -0.15, '#8a2b22', { uvScale: 0.6 });
    b.put('fabric', boxGeo(0.9, 0.09, 1.5), mx + 2.6, mg + 0.05, mz, -0.15, '#d7a24a', { uvScale: 0.6 });
    this.addInteract({ id: 'douar-rest', kind: 'rest', pos: new THREE.Vector3(mx + 2.6, mg, mz), radius: 2, prompt: 'Rest until the next dusk/dawn', hold: 0.5 });
    this.hideout.set(cx, this.terrain.getHeight(cx, cz), cz);

    // jars, baskets, hay
    for (let i = 0; i < 9; i += 1) {
      const a = rng() * Math.PI * 2;
      const r = 6 + rng() * 14;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (this.collision.blockedAt(x, z, 0.6, this.terrain.getHeight(x, z))) continue;
      jar(ctx, x, this.terrain.getHeight(x, z), z, 0.8 + rng() * 0.6);
    }
    for (let i = 0; i < 3; i += 1) {
      const x = cx - 20 + i * 1.1;
      const z = cz + 12;
      b.put('fabric', new THREE.CylinderGeometry(0.6, 0.7, 0.9, 10), x, this.terrain.getHeight(x, z) + 0.45, z, 0, '#c8a960', { uvScale: 0.8 });
    }
    this.addLoot('douar-jar', new THREE.Vector3(cx - 13, this.terrain.getHeight(cx - 13, cz - 4), cz - 4), { dates: 2, herbs: 1 }, 'Search the storage jars');

    // Moroccan flag hidden on the safe-house wall
    this.addFlag(cx + 9.6, this.terrain.getHeight(cx + 9, cz - 8) + 2.5, cz - 8.4, -0.15, 'morocco', 1.6, 1.1, false);

    this.group.add(b.build(this.lib, 'douar'));

    this.playerSpawn.set(cx + 4, this.terrain.getHeight(cx + 4, cz + 6), cz + 6);

    this.npcSpawns.push(
      { id: 'zahra', name: 'Lalla Zahra', outfit: 'zahra', x: cx - 3, z: cz - 3, facing: 0.6 },
      { id: 'lahcen', name: 'Si Lahcen', outfit: 'lahcen', x: cx + 8, z: cz - 6, facing: 2.6 },
      { id: 'v1', name: 'Villager', outfit: 'villager', x: cx - 10, z: cz + 9, facing: -1, sitting: true },
      { id: 'v2', name: 'Villager', outfit: 'villagerF', x: cx + 12, z: cz + 6, facing: 2 },
      { id: 'v3', name: 'Shepherd', outfit: 'villager', x: cx - 4, z: cz + 11, facing: 3, sitting: true },
    );
    for (const n of this.npcSpawns) {
      if (n.id === 'zahra' || n.id === 'lahcen') {
        this.addInteract({
          id: `talk-${n.id}`,
          kind: 'talk',
          pos: new THREE.Vector3(n.x, this.terrain.getHeight(n.x, n.z), n.z),
          radius: 2.6,
          prompt: `Talk to ${n.name}`,
          hold: 0,
          ref: n.id,
        });
      }
    }
  }

  private buildMedina(rng: () => number): void {
    const b = new MergeBuilder();
    const ctx = this.ctx(b, rng);
    const { x: cx, z: cz } = zone('medina');
    const H = 56;
    const wallTint = '#c47a4c';
    const wallH = 7;
    const th = 1.6;
    // four walls with gate gaps in the middle (gap = gate width)
    const gapHalf = 4.6;
    const corners: [number, number][] = [[cx - H, cz - H], [cx + H, cz - H], [cx + H, cz + H], [cx - H, cz + H]];
    for (let i = 0; i < 4; i += 1) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const len = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      wall(ctx, ax, az, mx - ux * gapHalf, mz - uz * gapHalf, wallH, th, 'pise', wallTint);
      wall(ctx, mx + ux * gapHalf, mz + uz * gapHalf, bx, bz, wallH, th, 'pise', wallTint);
      const angle = Math.atan2(bx - ax, bz - az) - Math.PI / 2;
      gate(ctx, mx, mz, angle, th, shade(wallTint, 1.05));
      // lanterns
      this.lightPoints.push(new THREE.Vector3(mx, this.terrain.getHeight(mx, mz) + 3.1, mz));
      // towers flanking the gate
      for (const s of [-1, 1]) {
        tower(ctx, mx + ux * s * 8.5, mz + uz * s * 8.5, 2.6, wallH + 3, 'pise', wallTint, angle);
      }
    }
    for (const [tx, tz] of corners) tower(ctx, tx, tz, 3.4, wallH + 4, 'pise', wallTint);
    // mid-wall towers
    for (let i = 0; i < 4; i += 1) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      for (const t of [0.22, 0.78]) tower(ctx, ax + (bx - ax) * t, az + (bz - az) * t, 2.2, wallH + 2, 'pise', wallTint);
    }

    // Mosque + minaret in NE quadrant
    const mqx = cx + 24;
    const mqz = cz - 22;
    house(ctx, mqx, mqz, 18, 14, 6.5, 0, { tint: '#e3c8a2', windows: 4, door: '#2b6e63' });
    const roofY = this.terrain.getHeight(mqx, mqz) + 6.5;
    b.put('stone', new THREE.ConeGeometry(8.4, 2.6, 4), mqx - 1, roofY + 1.3, mqz, Math.PI / 4, '#2f7a52', { uvScale: 2 });
    minaret(ctx, mqx + 11.5, mqz - 5, 0);

    // Plaza fountain (south-west corner of the plaza)
    const fp = fountain(ctx, cx - 12, cz + 14.5, Math.PI);
    this.addInteract({ id: 'medina-fountain', kind: 'water', pos: fp, radius: 2.4, prompt: 'Drink at the fountain', hold: 0.8 });

    // Proclamation walls for the leaflet mission
    const notice: [string, number, number, number][] = [
      ['leaflet-plaza', cx + 2, cz - 9, 0],
      ['leaflet-souk', cx + 38, cz - 7, 0],
      ['leaflet-north', cx - 5.5, cz - 34, Math.PI / 2],
    ];
    for (const [id, x, z, a] of notice) {
      const g = this.terrain.getHeight(x, z);
      b.put('plaster', boxGeo(4.2, 3.2, 0.5), x, g + 1.4, z, a, '#e9d6b8', { groundY: g });
      b.put('wood', boxGeo(4.4, 0.18, 0.6), x, g + 3.05, z, a, '#5a3a24');
      this.collision.addBox(x, z, 2.1, 0.25, a, g - 1, g + 3.1, true, 'notice');
      const [px, pz] = toWorld(x, z, a, 0, 0.27);
      // French proclamation
      const avis = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.5), new THREE.MeshStandardMaterial({ map: avisTexture(), roughness: 0.9 }));
      avis.position.set(px, g + 1.75, pz);
      avis.rotation.y = a;
      this.group.add(avis);
      const [lx, lz] = toWorld(x, z, a, 0, 0.29);
      const leaflet = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.4), this.lib.materials.paper);
      leaflet.position.set(lx, g + 1.75, lz);
      leaflet.rotation.set(0, a, 0.04);
      leaflet.visible = false;
      this.group.add(leaflet);
      this.leafletMeshes.set(id, leaflet);
      const [ix, iz] = toWorld(x, z, a, 0, 1.3);
      this.addInteract({ id, kind: 'leaflet', pos: new THREE.Vector3(ix, g, iz), radius: 2.2, prompt: 'Paste the independence leaflet', hold: 1.6, enabled: false, questGate: 'leaflets' });
    }

    // Souk: stalls line both sides of the east-west street, counters facing the passers-by
    const merchants: [number, number, number][] = [];
    for (const [x0, x1] of [[cx + 12, cx + 50], [cx - 44, cx - 15]]) {
      for (let sx = x0; sx <= x1; sx += 3.6) {
        stall(ctx, sx, cz + 5.6, Math.PI);
        if (rng() < 0.3) merchants.push([sx, cz + 6.1, Math.PI]);
        if (Math.abs(sx - (cx + 38)) > 4.5 && rng() < 0.75) {
          stall(ctx, sx + 1.2, cz - 5.6, 0);
          if (rng() < 0.3) merchants.push([sx + 1.2, cz - 6.1, 0]);
        }
      }
    }

    // Houses: fill blocks on a grid, skipping streets, plaza, mosque
    const blocked = (x: number, z: number, r: number) => {
      if (Math.abs(z - cz) < 7.4 + r && Math.abs(x - cx) < H) return true; // E-W main street + stalls
      if (Math.abs(x - cx) < 3.8 + r && Math.abs(z - cz) < H) return true; // N-S street
      if (Math.hypot(x - cx, z - cz) < 13 + r) return true; // plaza
      if (Math.abs(x - mqx - 3) < 14 + r && Math.abs(z - mqz) < 10 + r) return true; // mosque block
      for (const [, nx, nz] of notice) if (Math.hypot(x - nx, z - nz) < 3.5 + r) return true;
      if (Math.hypot(x - (cx - 12), z - (cz + 15)) < 4.5 + r) return true;
      return false;
    };
    const cell = 9.6;
    for (let gx = cx - H + 4; gx < cx + H - 4; gx += cell) {
      for (let gz = cz - H + 4; gz < cz + H - 4; gz += cell) {
        const x = gx + cell / 2 + (rng() - 0.5) * 0.8;
        const z = gz + cell / 2 + (rng() - 0.5) * 0.8;
        const w = 6.2 + rng() * 1.6;
        const d = 6.2 + rng() * 1.6;
        if (blocked(x, z, Math.max(w, d) / 2)) continue;
        if (Math.abs(x - cx) > H - 5.5 || Math.abs(z - cz) > H - 5.5) continue;
        // door faces the nearest main street
        const toStreetX = Math.abs(x - cx);
        const toStreetZ = Math.abs(z - cz);
        let angle: number;
        if (toStreetZ < toStreetX) angle = z > cz ? Math.PI : 0;
        else angle = x > cx ? -Math.PI / 2 : Math.PI / 2;
        if (rng() < 0.25) angle += Math.PI / 2 * (rng() < 0.5 ? 1 : -1);
        house(ctx, x, z, w, d, 4.2 + rng() * 3.4, angle, {
          tint: PLASTER_TINTS[Math.floor(rng() * PLASTER_TINTS.length)],
          upper: rng() < 0.3,
          merlons: rng() < 0.4,
        });
      }
    }
    // Townsfolk: merchants behind their counters, people walking the streets
    merchants.forEach(([x, z, f], i) => {
      this.npcSpawns.push({ id: `merchant-${i}`, name: 'Merchant', outfit: i % 3 === 2 ? 'villagerF' : 'villager', x, z, facing: f, sitting: true });
    });
    const walkers: number[][][] = [
      [[cx - 40, cz + 1.5], [cx + 46, cz + 1.5]],
      [[cx + 44, cz - 1.8], [cx - 36, cz - 1.8]],
      [[cx + 1.6, cz - 44], [cx + 1.6, cz + 44]],
      [[cx - 1.6, cz + 40], [cx - 1.6, cz - 40]],
      [[cx - 8, cz + 9], [cx + 9, cz - 9], [cx + 10, cz + 10]],
      [[cx + 20, cz + 2.5], [cx + 50, cz + 2.5]],
    ];
    walkers.forEach((w, i) => {
      this.npcSpawns.push({ id: `walker-${i}`, name: i % 2 ? 'Woman of the medina' : 'Townsman', outfit: i % 2 ? 'villagerF' : 'villager', x: w[0][0], z: w[0][1], facing: 0, walk: w });
    });

    // Street clutter & loot
    const lootSpots: [number, number, LootBundle][] = [
      [cx + 30, cz + 2, { bread: 1, ammo: 3 }],
      [cx - 25, cz + 2.5, { dates: 2 }],
      [cx + 3, cz - 42, { herbs: 1, ammo: 2 }],
      [cx - 3, cz + 45, { bread: 1 }],
      [cx + 48, cz - 4, { ammo: 4 }],
    ];
    lootSpots.forEach(([x, z, loot], i) => {
      const g = this.terrain.getHeight(x, z);
      if (i % 2) crate(ctx, x, g, z, rng() * 3, 0.9);
      else {
        jar(ctx, x, g, z, 1.1);
        jar(ctx, x + 0.8, g, z + 0.3, 0.8, '#9a5232');
      }
      this.addLoot(`medina-loot-${i}`, new THREE.Vector3(x, g, z), loot);
    });

    this.group.add(b.build(this.lib, 'medina'));

    const g = (x: number, z: number) => [cx + x, cz + z];
    this.enemySpawns.push(
      { id: 'm-wgate', faction: 'french', rank: 'soldier', zone: 'medina', x: cx - H - 4, z: cz + 3, patrol: [], facing: -Math.PI / 2 },
      { id: 'm-wgate2', faction: 'makhzen', rank: 'soldier', zone: 'medina', x: cx - H - 4, z: cz - 3.5, patrol: [], facing: -Math.PI / 2 - 0.4 },
      { id: 'm-egate', faction: 'makhzen', rank: 'soldier', zone: 'medina', x: cx + H + 4, z: cz + 3, patrol: [], facing: Math.PI / 2 },
      { id: 'm-patrol-ew', faction: 'makhzen', rank: 'soldier', zone: 'medina', x: cx - 40, z: cz, patrol: [g(-40, 0), g(-14, -1), g(14, 1), g(44, 0), g(14, 1), g(-14, -1)] },
      { id: 'm-patrol-ns', faction: 'makhzen', rank: 'soldier', zone: 'medina', x: cx, z: cz - 40, patrol: [g(1, -45), g(1, -18), g(-1, 18), g(-1, 46), g(-1, 18), g(1, -18)] },
      { id: 'm-plaza1', faction: 'french', rank: 'soldier', zone: 'medina', x: cx + 6, z: cz + 4, patrol: [], facing: Math.PI },
      { id: 'm-plaza2', faction: 'french', rank: 'soldier', zone: 'medina', x: cx - 5, z: cz - 6, patrol: [g(-5, -6), g(8, -12), g(12, 6), g(-8, 8)] },
      { id: 'm-lieutenant', faction: 'french', rank: 'officer', zone: 'medina', x: cx + 30, z: cz + 9, patrol: [g(30, 9), g(50, 9.5), g(30, 9), g(18, 10)] },
    );
  }

  private buildKasbah(rng: () => number): void {
    const b = new MergeBuilder();
    const ctx = this.ctx(b, rng);
    const { x: cx, z: cz } = zone('kasbah');
    const H = 24;
    const tint = '#b4603a';
    const wallH = 9;
    const th = 1.8;
    // west wall has the gate
    wall(ctx, cx - H, cz - H, cx - H, cz - 4.6, wallH, th, 'pise', tint, 1);
    wall(ctx, cx - H, cz + 4.6, cx - H, cz + H, wallH, th, 'pise', tint, 1);
    gate(ctx, cx - H, cz, Math.atan2(0, 1) - Math.PI / 2, th, shade(tint, 1.05));
    wall(ctx, cx - H, cz + H, cx + H, cz + H, wallH, th, 'pise', tint, 1);
    wall(ctx, cx + H, cz + H, cx + H, cz - H, wallH, th, 'pise', tint, 1);
    wall(ctx, cx + H, cz - H, cx - H, cz - H, wallH, th, 'pise', tint, 1);
    for (const [tx, tz] of [[cx - H, cz - H], [cx + H, cz - H], [cx + H, cz + H], [cx - H, cz + H]]) tower(ctx, tx, tz, 3.6, wallH + 5, 'pise', tint);
    for (const s of [-1, 1]) tower(ctx, cx - H, cz + s * 8.5, 2.8, wallH + 3, 'pise', tint);
    const gy = this.terrain.getHeight(cx - H - 2, cz);
    this.kasbahGate.set(cx - H - 3, gy, cz);
    this.lightPoints.push(new THREE.Vector3(cx - H, gy + 3.1, cz));

    // Caïd's residence (east), tall with upper floor
    house(ctx, cx + 11, cz, 14, 20, 7.5, -Math.PI / 2, { role: 'pise', tint: '#c06d43', upper: true, merlons: true, door: '#7b3b22', windows: 4 });
    // storerooms south
    house(ctx, cx - 6, cz + 16, 12, 6, 4.5, Math.PI, { role: 'pise', tint: '#a85a36' });
    // stables north-west
    house(ctx, cx - 12, cz - 16, 10, 6, 4, 0, { role: 'pise', tint: '#a85a36' });

    // Prison (north-east corner): three walls + roof, barred door facing south (+z local)
    const px = cx + 6;
    const pz = cz - 15;
    const pg = this.terrain.getHeight(px, pz);
    const pw = 7;
    const pd = 5;
    const ph = 3.6;
    b.put('pise', boxGeo(pw, ph + 1, 0.6), px, pg + (ph - 1) / 2, pz - pd / 2, 0, '#9a5333', { groundY: pg });
    b.put('pise', boxGeo(0.6, ph + 1, pd), px - pw / 2, pg + (ph - 1) / 2, pz, 0, '#9a5333', { groundY: pg });
    b.put('pise', boxGeo(0.6, ph + 1, pd), px + pw / 2, pg + (ph - 1) / 2, pz, 0, '#9a5333', { groundY: pg });
    b.put('pise', boxGeo(pw + 0.6, 0.5, pd + 0.6), px, pg + ph + 0.25, pz, 0, '#a85a36');
    b.put('pise', boxGeo(pw - 3, ph, 0.6), px - 2.5, pg + ph / 2, pz + pd / 2, 0, '#9a5333');
    b.put('pise', boxGeo(2.2, ph, 0.6), px + 2.4, pg + ph / 2, pz + pd / 2, 0, '#9a5333');
    b.put('fabric', boxGeo(4, 0.05, 2), px, pg + 0.03, pz - 0.8, 0, '#6b5a40', { uvScale: 0.8 });
    this.collision.addBox(px, pz - pd / 2, pw / 2, 0.3, 0, pg - 1, pg + ph, true, 'prison');
    this.collision.addBox(px - pw / 2, pz, 0.3, pd / 2, 0, pg - 1, pg + ph, true, 'prison');
    this.collision.addBox(px + pw / 2, pz, 0.3, pd / 2, 0, pg - 1, pg + ph, true, 'prison');
    this.collision.addBox(px - 2.5, pz + pd / 2, (pw - 3) / 2, 0.3, 0, pg - 1, pg + ph, true, 'prison');
    this.collision.addBox(px + 2.4, pz + pd / 2, 1.1, 0.3, 0, pg - 1, pg + ph, true, 'prison');
    // barred iron door, hinged at its left edge
    const door = new THREE.Group();
    const bars = new MergeBuilder();
    for (let i = 0; i < 6; i += 1) bars.put('iron', cylGeo(0.035, 0.035, 2.6, 6), 0.15 + i * 0.3, 1.3, 0, 0, '#2c2a28');
    for (const y of [0.3, 1.3, 2.4]) bars.put('iron', boxGeo(1.8, 0.07, 0.07), 0.9, y, 0, 0, '#2c2a28');
    bars.put('iron', boxGeo(0.12, 0.2, 0.12), 1.6, 1.25, 0.05, 0, '#6a5a3a');
    door.add(bars.build(this.lib, 'prison-door'));
    door.position.set(px - 0.5, pg, pz + pd / 2);
    this.group.add(door);
    this.prisonDoor = door;
    this.prisonDoorCollider = this.collision.addBox(px + 0.4, pz + pd / 2, 0.9, 0.2, 0, pg - 1, pg + ph, false, 'prison-door');
    this.prisonInside.set(px, pg, pz - 0.6);
    this.addInteract({ id: 'prison-door', kind: 'prison', pos: new THREE.Vector3(px + 0.4, pg, pz + pd / 2 + 1.2), radius: 2.2, prompt: 'Unlock the prison', hold: 1.2, enabled: false, questGate: 'prison' });
    this.npcSpawns.push(
      { id: 'p1', name: 'Prisoner', outfit: 'prisoner', x: px - 2, z: pz - 1, facing: 0.2, sitting: true },
      { id: 'p2', name: 'Prisoner', outfit: 'prisoner', x: px + 0.5, z: pz - 1.3, facing: -0.2, sitting: true },
      { id: 'p3', name: 'Prisoner', outfit: 'prisoner', x: px + 2.2, z: pz - 0.6, facing: -0.6, sitting: true },
    );

    const w = well(ctx, cx - 6, cz + 3);
    this.addInteract({ id: 'kasbah-well', kind: 'water', pos: w, radius: 2.4, prompt: 'Draw water from the well', hold: 0.8 });
    for (let i = 0; i < 4; i += 1) jar(ctx, cx - 10 + i * 0.9, this.terrain.getHeight(cx - 10, cz + 12), cz + 12.4, 1 + rng() * 0.3);
    this.addLoot('kasbah-store', new THREE.Vector3(cx - 8.5, this.terrain.getHeight(cx - 8.5, cz + 11.5), cz + 11.5), { bread: 2, dates: 2, ammo: 4 }, "Search the Caïd's stores");
    this.addFlag(cx + 11, this.terrain.getHeight(cx + 11, cz) + 12, cz, -Math.PI / 2, 'caid', 1.6, 1.0, true);

    this.group.add(b.build(this.lib, 'kasbah'));

    const k = (x: number, z: number) => [cx + x, cz + z];
    this.enemySpawns.push(
      { id: 'k-gate1', faction: 'makhzen', rank: 'soldier', zone: 'kasbah', x: cx - H - 4, z: cz - 4, patrol: [], facing: -Math.PI / 2 },
      { id: 'k-gate2', faction: 'makhzen', rank: 'soldier', zone: 'kasbah', x: cx - H - 4, z: cz + 4, patrol: [], facing: -Math.PI / 2 },
      { id: 'k-yard1', faction: 'makhzen', rank: 'soldier', zone: 'kasbah', x: cx - 14, z: cz - 6, patrol: [k(-15, -6), k(-15, 8), k(0, 9), k(0, -8)] },
      { id: 'k-yard2', faction: 'makhzen', rank: 'soldier', zone: 'kasbah', x: cx + 2, z: cz - 9, patrol: [], facing: Math.PI },
      { id: 'k-prison', faction: 'makhzen', rank: 'soldier', zone: 'kasbah', x: cx + 1, z: cz - 10, patrol: [k(1, -10), k(12, -10)], facing: 0 },
      { id: 'k-khalifa', faction: 'makhzen', rank: 'officer', zone: 'kasbah', x: cx + 2, z: cz + 4, patrol: [k(2, 4), k(-8, 7), k(-12, -4), k(2, -4)], carries: 'key' },
      { id: 'k-outside', faction: 'makhzen', rank: 'soldier', zone: 'kasbah', x: cx - 10, z: cz + H + 6, patrol: [k(-28, 30), k(10, 30), k(30, 28), k(10, 30)] },
    );
  }

  private buildPost(rng: () => number): void {
    const b = new MergeBuilder();
    const ctx = this.ctx(b, rng);
    const { x: cx, z: cz } = zone('post');
    const H = 34;
    // fence with a 6 m gate gap on the north side (toward the road)
    barbedFence(ctx, [[cx - 4, cz - H], [cx - H, cz - H], [cx - H, cz + H], [cx + H, cz + H], [cx + H, cz - H], [cx + 4, cz - H]]);
    // gate barrier + guard hut
    const gz = cz - H;
    const gg = this.terrain.getHeight(cx, gz);
    b.put('wood', boxGeo(7.5, 0.14, 0.14), cx + 0.2, gg + 1.05, gz - 0.5, 0, '#c9c3b5', undefined, 0, 0.0);
    for (let i = 0; i < 5; i += 1) b.put('wood', boxGeo(0.6, 0.15, 0.16), cx - 3 + i * 1.5, gg + 1.05, gz - 0.5, 0, '#a82a22');
    b.put('wood', boxGeo(0.3, 1.2, 0.3), cx - 3.8, gg + 0.6, gz - 0.5, 0, '#4a3020');
    house(ctx, cx + 7, gz + 3.5, 2.6, 2.6, 2.6, Math.PI, { tint: '#e5ddcc', windows: 2, door: '#3d5a3f' });
    sandbags(ctx, cx - 7, gz - 2, 0, 4.5);
    sandbags(ctx, cx + 7, gz - 2.5, 0, 3.5);
    this.lightPoints.push(new THREE.Vector3(cx, gg + 3, gz + 1));

    // buildings
    barracks(ctx, cx - 20, cz - 8, 18, 8, Math.PI / 2);
    barracks(ctx, cx + 20, cz - 6, 18, 8, -Math.PI / 2);
    barracks(ctx, cx, cz - 14, 14, 8, 0, 'HQ'); // HQ facing north… door faces +z (south) into the yard
    const depotFront = barracks(ctx, cx + 4, cz + 22, 16, 8, Math.PI, 'DEPOT');
    // arms cache in front of the depot, under a canvas lean-to
    const cache = new MergeBuilder();
    const cctx = this.ctx(cache, rng);
    const cg = this.terrain.getHeight(depotFront.x, depotFront.z);
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 2; j += 1) crate(cctx, depotFront.x - 1.4 + i * 1.1, cg + j * 0.72, depotFront.z + 0.4, Math.PI / 2, 0.9, '#4f5a35');
    crate(cctx, depotFront.x - 0.3, cg + 1.44, depotFront.z + 0.4, Math.PI / 2 + 0.2, 0.9, '#4f5a35');
    for (let i = 0; i < 4; i += 1) cache.put('wood', boxGeo(0.1, 0.1, 1.3), depotFront.x - 1.2 + i * 0.25, cg + 2.0, depotFront.z + 0.4, 0, '#3b2a1c', undefined, 0, 0.3);
    this.armsCache = cache.build(this.lib, 'arms-cache');
    this.group.add(this.armsCache);
    b.put('fabric', boxGeo(4.6, 0.05, 2.6), depotFront.x - 0.3, cg + 2.6, depotFront.z + 0.2, Math.PI, '#77724e', { uvScale: 1.2 }, 0.25);
    for (const s of [-1, 1]) b.put('wood', boxGeo(0.12, 2.4, 0.12), depotFront.x - 0.3 + s * 2.2, cg + 1.2, depotFront.z + 1.4, 0, '#4a3020');
    this.addInteract({ id: 'arms-cache', kind: 'cache', pos: new THREE.Vector3(depotFront.x - 0.3, cg, depotFront.z + 1.6), radius: 2.4, prompt: 'Steal the arms cache', hold: 2.5, enabled: false, questGate: 'cache' });

    // tents rows
    for (let i = 0; i < 3; i += 1) {
      tent(ctx, cx - 14 + i * 6, cz + 10, 0);
    }
    tent(ctx, cx + 22, cz + 18, Math.PI / 2);
    // watchtower NE corner
    const wt = watchtower(ctx, cx + H - 5, cz - H + 5);
    truck(ctx, cx - 8, cz - 22, 0.25);
    // flagpole with tricolour
    const fpx = cx;
    const fpz = cz - 6;
    const fpg = this.terrain.getHeight(fpx, fpz);
    b.put('iron', cylGeo(0.06, 0.09, 10, 8), fpx, fpg + 5, fpz, 0, '#d8d4c8');
    b.put('stone', cylGeo(0.7, 0.9, 0.4, 10), fpx, fpg + 0.2, fpz, 0, '#bfb8a8');
    this.addFlag(fpx + 0.05, fpg + 9.2, fpz, 0, 'france', 2.2, 1.45, true);
    // supplies
    for (let i = 0; i < 5; i += 1) barrel(ctx, cx + 26 + (i % 3) * 0.9, this.terrain.getHeight(cx + 26, cz + 4), cz + 4 + Math.floor(i / 3) * 0.9);
    for (let i = 0; i < 4; i += 1) crate(ctx, cx - 26, this.terrain.getHeight(cx - 26, cz + 20) + (i > 2 ? 0.72 : 0), cz + 18 + (i % 3) * 1.3, 0.1, 0.9, '#5d5a3a');
    sandbags(ctx, cx - 10, cz + 2, Math.PI / 2, 4);
    sandbags(ctx, cx + 10, cz + 4, Math.PI / 2, 4);
    this.addLoot('post-crates', new THREE.Vector3(cx - 24.5, this.terrain.getHeight(cx - 24.5, cz + 19), cz + 19), { ammo: 8, bread: 1 }, 'Search the supply crates');
    this.addLoot('post-tent', new THREE.Vector3(cx - 8, this.terrain.getHeight(cx - 8, cz + 13), cz + 13), { ammo: 4, herbs: 1 }, 'Search the tent');

    this.group.add(b.build(this.lib, 'post'));

    const p = (x: number, z: number) => [cx + x, cz + z];
    this.enemySpawns.push(
      { id: 'p-gate1', faction: 'french', rank: 'soldier', zone: 'post', x: cx - 4, z: gz - 4, patrol: [], facing: Math.PI },
      { id: 'p-gate2', faction: 'french', rank: 'soldier', zone: 'post', x: cx + 4, z: gz - 4, patrol: [], facing: Math.PI },
      { id: 'p-sentry', faction: 'french', rank: 'sentry', zone: 'post', x: wt.x, z: wt.z, patrol: [], facing: Math.PI * 0.75, fixedY: wt.y },
      { id: 'p-yard1', faction: 'french', rank: 'soldier', zone: 'post', x: cx - 10, z: cz - 2, patrol: [p(-10, -2), p(-10, 20), p(14, 20), p(14, -2)] },
      { id: 'p-yard2', faction: 'french', rank: 'soldier', zone: 'post', x: cx + 26, z: cz + 26, patrol: [p(28, 28), p(-28, 28), p(-28, -28), p(28, -28)] },
      { id: 'p-depot', faction: 'french', rank: 'soldier', zone: 'post', x: cx + 8, z: cz + 15.5, patrol: [], facing: 0 },
      { id: 'p-tents', faction: 'french', rank: 'soldier', zone: 'post', x: cx - 8, z: cz + 6, patrol: [], facing: Math.PI },
      { id: 'p-lieutenant', faction: 'french', rank: 'officer', zone: 'post', x: cx, z: cz - 8, patrol: [p(0, -8), p(-6, 2), p(6, 6), p(4, -8)] },
      { id: 'p-mokh', faction: 'makhzen', rank: 'soldier', zone: 'post', x: cx + 16, z: cz + 8, patrol: [p(16, 8), p(16, -18)], facing: 0 },
    );
  }

  private buildOasisAndWilds(rng: () => number): void {
    const b = new MergeBuilder();
    const ctx = this.ctx(b, rng);
    const o = zone('oasis');
    this.addInteract({ id: 'oasis-pond', kind: 'water', pos: new THREE.Vector3(o.x + 9, this.terrain.getHeight(o.x + 9, o.z), o.z), radius: 3.2, prompt: 'Drink from the pond', hold: 0.8 });
    // ruined hut
    house(ctx, o.x - 14, o.z + 9, 5, 5, 2.6, 0.6, { role: 'pise', tint: '#a0603e', windows: 1 });
    this.addLoot('oasis-hut', new THREE.Vector3(o.x - 12, this.terrain.getHeight(o.x - 12, o.z + 12), o.z + 12), { dates: 3, herbs: 1 }, 'Search the abandoned hut');

    // Koubbas (white domed shrines) as landmarks with offerings
    const koubbas: [number, number][] = [[-40, 140], [-180, -10], [60, -60], [170, 20], [-60, -170]];
    koubbas.forEach(([x, z], i) => {
      const g = this.terrain.getHeight(x, z);
      b.put('plaster', boxGeo(4.4, 3.6, 4.4), x, g + 1.4, z, 0.2 * i, '#f1ece2', { groundY: g });
      b.put('plaster', new THREE.SphereGeometry(2.2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), x, g + 3.2, z, 0, '#f6f2ea');
      b.put('plaster', boxGeo(4.7, 0.3, 4.7), x, g + 3.25, z, 0.2 * i, '#e8e0d0');
      b.put('iron', cylGeo(0.03, 0.03, 1, 6), x, g + 5.8, z, 0, '#c9a24a');
      b.put('iron', new THREE.SphereGeometry(0.14, 8, 6), x, g + 6.0, z, 0, '#d8b45a');
      const [dx, dz] = toWorld(x, z, 0.2 * i, 0, 2.22);
      b.put('wood', archGeo2(1.1, 2.0, 0.06), dx, g, dz, 0.2 * i, '#2d6a55');
      this.collision.addBox(x, z, 2.2, 2.2, 0.2 * i, g - 1, g + 5.4, true, 'koubba');
      const [lx, lz] = toWorld(x, z, 0.2 * i, 1.2, 3.1);
      jar(ctx, lx, this.terrain.getHeight(lx, lz), lz, 0.7, '#8a4d2e');
      this.addLoot(`koubba-${i}`, new THREE.Vector3(lx, this.terrain.getHeight(lx, lz), lz), i % 2 ? { dates: 2, herbs: 1 } : { bread: 1, ammo: 3 }, 'Take the offerings');
    });

    // Wild herb patches (thyme / zaatar) — heal over time
    const herb = latheGeo([[0, 0], [0.32, 0.05], [0.4, 0.22], [0.2, 0.36], [0, 0.38]], 8);
    let placed = 0;
    for (let i = 0; i < 400 && placed < 26; i += 1) {
      const x = (rng() - 0.5) * 420;
      const z = (rng() - 0.5) * 420;
      if (Math.hypot(x, z) > 220 || distToRoads(x, z) < 4) continue;
      if (this.collision.blockedAt(x, z, 1, this.terrain.getHeight(x, z))) continue;
      let far = true;
      for (const id of ['medina', 'kasbah', 'post'] as const) {
        const zz = zone(id);
        if (Math.hypot(x - zz.x, z - zz.z) < (id === 'medina' ? 70 : 42)) far = false;
      }
      if (!far) continue;
      const g = this.terrain.getHeight(x, z);
      for (let k = 0; k < 4; k += 1) {
        b.put('foliage', herb, x + (rng() - 0.5) * 0.8, g, z + (rng() - 0.5) * 0.8, 0, k % 2 ? '#6c7f4a' : '#8a6aa8', { uvScale: 0 });
      }
      this.addInteract({ id: `herb-${placed}`, kind: 'herb', pos: new THREE.Vector3(x, g, z), radius: 1.8, prompt: 'Gather wild thyme (herbs)', hold: 0.6 });
      placed += 1;
    }

    // Distant mountain silhouette ring beyond the terrain edge
    const far = new THREE.Group();
    const mtnMat = new THREE.MeshStandardMaterial({ color: '#8a6b5c', roughness: 1, flatShading: true });
    const snowMat = new THREE.MeshStandardMaterial({ color: '#f2efe8', roughness: 0.9, flatShading: true });
    for (let i = 0; i < 26; i += 1) {
      const a = (i / 26) * Math.PI * 2 + rng() * 0.1;
      const r = 470 + rng() * 120;
      const h = 120 + rng() * 140;
      const rad = 90 + rng() * 70;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 7, 1), mtnMat);
      cone.position.set(Math.cos(a) * r, h / 2 - 20, Math.sin(a) * r);
      cone.rotation.y = rng() * 3;
      far.add(cone);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.3, h * 0.3, 7, 1), snowMat);
      cap.position.set(cone.position.x, h - 20 - h * 0.15 + 0.5, cone.position.z);
      cap.rotation.y = cone.rotation.y;
      far.add(cap);
    }
    far.name = 'far-mountains';
    this.group.add(far);

    this.group.add(b.build(this.lib, 'wilds'));

    // Road patrol between the medina and the post (telegraph road)
    const road = ROADS[1];
    this.enemySpawns.push(
      { id: 'r-patrol1', faction: 'french', rank: 'soldier', zone: 'road', x: road[1][0], z: road[1][1], patrol: road.map(([x, z]) => [x + 2.5, z]) },
      { id: 'r-patrol2', faction: 'makhzen', rank: 'soldier', zone: 'road', x: road[3][0], z: road[3][1], patrol: road.map(([x, z]) => [x - 2.5, z]).reverse() },
      { id: 'o-patrol', faction: 'makhzen', rank: 'soldier', zone: 'wilds', x: -60, z: -76, patrol: ROADS[4].map(([x, z]) => [x + 2, z + 2]) },
    );
  }

  private buildTelegraph(): void {
    const b = new MergeBuilder();
    const road = ROADS[1];
    const pts = samplePolyline(road, 19).filter((_p, i) => i > 0);
    const offset = 5.2;
    pts.forEach((p, i) => {
      const nx = Math.cos(p.angle);
      const nz = -Math.sin(p.angle);
      const x = p.x + nx * offset;
      const z = p.z + nz * offset;
      const g = this.terrain.getHeight(x, z);
      b.put('wood', cylGeo(0.12, 0.17, 7.4, 7), x, g + 3.5, z, 0, '#5a4330');
      b.put('wood', boxGeo(1.8, 0.14, 0.14), x, g + 6.7, z, p.angle + Math.PI / 2, '#4d3726');
      for (const s of [-0.75, 0, 0.75]) {
        const [ix, iz] = toWorld(x, z, p.angle + Math.PI / 2, s, 0);
        b.put('stone', cylGeo(0.06, 0.08, 0.2, 6), ix, g + 6.88, iz, 0, '#e8f0f2', { uvScale: 0 });
      }
      this.collision.addCircle(x, z, 0.2, g - 1, g + 7, false, 'pole');
      const mission = i >= 1 && i <= 4;
      this.poles.push({ index: i, pos: new THREE.Vector3(x, g, z), top: new THREE.Vector3(x, g + 6.95, z), cut: false, mission });
      if (mission) {
        this.addInteract({ id: `pole-${i}`, kind: 'pole', pos: new THREE.Vector3(x, g, z), radius: 2, prompt: 'Cut the telegraph wires', hold: 2.2, enabled: false, ref: String(i), questGate: 'wires' });
      }
    });
    this.group.add(b.build(this.lib, 'telegraph'));

    // wires with catenary sag
    const verts: number[] = [];
    for (let i = 0; i < this.poles.length - 1; i += 1) {
      const a = this.poles[i];
      const c = this.poles[i + 1];
      const offsetIdx = verts.length / 3;
      for (let k = 0; k < 3; k += 1) {
        const side = (k - 1) * 0.75;
        const ang = Math.atan2(c.pos.x - a.pos.x, c.pos.z - a.pos.z);
        const ox = Math.cos(ang) * side;
        const oz = -Math.sin(ang) * side;
        for (let s = 0; s < SAG_SEGMENTS; s += 1) {
          for (const t of [s / SAG_SEGMENTS, (s + 1) / SAG_SEGMENTS]) {
            const sag = Math.sin(Math.PI * t) * 0.9;
            verts.push(a.top.x + (c.top.x - a.top.x) * t + ox, a.top.y + (c.top.y - a.top.y) * t - sag, a.top.z + (c.top.z - a.top.z) * t + oz);
          }
        }
      }
      this.wireSpans.push({ a: i, b: i + 1, offset: offsetIdx });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.wires = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#2a2622' }));
    this.wires.name = 'telegraph-wires';
    this.group.add(this.wires);
  }

  private addFlag(x: number, y: number, z: number, angle: number, kind: 'france' | 'morocco' | 'caid', w: number, h: number, wave: boolean): void {
    const geo = new THREE.PlaneGeometry(w, h, 16, 6);
    geo.translate(w / 2, -h / 2, 0);
    const mat = new THREE.MeshStandardMaterial({ map: flagTexture(kind), roughness: 0.85, side: THREE.DoubleSide });
    if (wave) {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        mat.userData.shader = shader;
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float k = position.x / ${w.toFixed(2)};
           transformed.z += sin(position.x * 2.6 - uTime * 4.0) * 0.16 * k;
           transformed.y += sin(position.x * 1.7 - uTime * 3.0) * 0.05 * k;`,
        );
      };
      mat.customProgramCacheKey = () => 'flag-wave';
      this.flagMaterials.push(mat);
    }
    const flag = new THREE.Mesh(geo, mat);
    flag.position.set(x, y, z);
    flag.rotation.y = angle;
    flag.castShadow = true;
    this.group.add(flag);
  }
}

const SAG_SEGMENTS = 8;

function flagTexture(kind: 'france' | 'morocco' | 'caid'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  if (kind === 'france') {
    ctx.fillStyle = '#1f3c8a';
    ctx.fillRect(0, 0, 64, 128);
    ctx.fillStyle = '#f2f0ea';
    ctx.fillRect(64, 0, 64, 128);
    ctx.fillStyle = '#c42b2b';
    ctx.fillRect(128, 0, 64, 128);
  } else {
    ctx.fillStyle = kind === 'morocco' ? '#b3201f' : '#7a1717';
    ctx.fillRect(0, 0, 192, 128);
    ctx.strokeStyle = '#1d6b3a';
    ctx.lineWidth = 7;
    ctx.beginPath();
    for (let i = 0; i <= 5; i += 1) {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      const x = 96 + Math.cos(a) * 34;
      const y = 66 + Math.sin(a) * 34;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function avisTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 220;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#ece8dc';
  ctx.fillRect(0, 0, 160, 220);
  ctx.fillStyle = '#1b1b1b';
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px serif';
  ctx.fillText('RÉSIDENCE GÉNÉRALE', 80, 26);
  ctx.font = 'bold 34px serif';
  ctx.fillText('AVIS', 80, 70);
  ctx.font = '12px serif';
  ['Couvre-feu à 20 h.', 'Tout rassemblement', 'est interdit.', 'Les contrevenants', 'seront arrêtés.', '', 'بلاغ — حظر التجول'].forEach((l, i) => ctx.fillText(l, 80, 100 + i * 16));
  ctx.strokeStyle = '#1b1b1b';
  ctx.strokeRect(6, 6, 148, 208);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
