import * as THREE from 'three';
import { L, type Text } from '../i18n';
import { clamp } from '../utils/noise';
import type { CollisionWorld } from '../world/Collision';
import { AIRSTRIP, LAKE, RAIL_LENGTH, railAt, zone } from '../world/layout';
import type { Terrain } from '../world/Terrain';
import { buildPart as part, mergeParts as merge } from './Wildlife';

export type RideKind = 'donkey' | 'mule' | 'horse' | 'camel' | 'jeep' | 'boat' | 'train' | 'plane';

type RideDef = {
  name: Text;
  /** top speed (m/s); the horse gallops to `boost` with Shift */
  max: number;
  boost: number;
  reverse: number;
  accel: number;
  turn: number;
  radius: number;
  seat: [number, number, number];
  cam: number;
  camH: number;
  /** guards notice a rider this much sooner */
  stealth: number;
  /** interaction reach */
  reach: number;
};

export const RIDES: Record<RideKind, RideDef> = {
  donkey: { name: L('Donkey', 'الحمار'), max: 4.6, boost: 5.6, reverse: 1, accel: 3, turn: 2.2, radius: 0.6, seat: [0, 1.12, -0.05], cam: 1.4, camH: 0.6, stealth: 1.05, reach: 2.2 },
  mule: { name: L('Mule', 'البغل'), max: 6, boost: 7.2, reverse: 1.2, accel: 3.4, turn: 2.1, radius: 0.65, seat: [0, 1.25, -0.05], cam: 1.6, camH: 0.7, stealth: 1.1, reach: 2.3 },
  horse: { name: L('Barb horse', 'العود البربري'), max: 7.5, boost: 13, reverse: 1.5, accel: 5, turn: 2.3, radius: 0.7, seat: [0, 1.5, -0.1], cam: 2.2, camH: 0.9, stealth: 1.25, reach: 2.4 },
  camel: { name: L('Camel', 'الجمل'), max: 7, boost: 9, reverse: 1, accel: 2.6, turn: 1.6, radius: 0.85, seat: [0, 2.15, -0.25], cam: 2.8, camH: 1.3, stealth: 1.3, reach: 2.6 },
  jeep: { name: L('Willys jeep', 'جيب ويليس'), max: 19, boost: 23, reverse: 6, accel: 7, turn: 1.7, radius: 1.5, seat: [-0.38, 0.75, 0.05], cam: 4, camH: 0.6, stealth: 1.6, reach: 3 },
  boat: { name: L('Fishing boat', 'الفلوكة'), max: 4.2, boost: 5, reverse: 1.5, accel: 1.6, turn: 1.1, radius: 1.2, seat: [0, 0.3, -0.4], cam: 2.5, camH: 0.6, stealth: 1, reach: 3.2 },
  train: { name: L('The train', 'الماشينا'), max: 11, boost: 14, reverse: 6, accel: 2, turn: 0, radius: 2, seat: [0, 1.55, -2.1], cam: 7, camH: 1.8, stealth: 1, reach: 4.5 },
  plane: { name: L('Liaison plane', 'الطيارة'), max: 0, boost: 0, reverse: 0, accel: 0, turn: 0.75, radius: 4, seat: [0, 1.25, 0.35], cam: 9, camH: 1.6, stealth: 2, reach: 4 },
};

export type Controls = { f: boolean; b: boolean; l: boolean; r: boolean; boost: boolean; up: boolean; down: boolean };

export type Ride = {
  id: string;
  kind: RideKind;
  root: THREE.Group;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  home: { x: number; z: number; yaw: number };
  legs: THREE.Object3D[];
  wheels: THREE.Object3D[];
  oars: THREE.Object3D[];
  prop: THREE.Object3D | null;
  phase: number;
  // train
  s: number;
  dir: number;
  dwell: number;
  manualT: number;
  cars: THREE.Group[];
  // plane
  pitch: number;
  roll: number;
  vy: number;
  throttle: number;
  flying: boolean;
  crashed: boolean;
  crashReason: string;
};

const FWD = new THREE.Vector3();
/** the loco never backs further than this: its two cars trail 8.4 m apart behind it */
const TRAIN_MIN_S = 30;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Everything the fidāʾī can ride or drive: mounts, the garrison jeep, a boat
 * on the lake, the train on its track and the liaison plane on the airstrip.
 */
export class Rides {
  readonly group = new THREE.Group();
  readonly rides: Ride[] = [];
  /** plane hit the ground or a wall too hard */
  onCrash: ((r: Ride) => void) | null = null;
  /** plane came to rest after a landing */
  onLand: ((r: Ride) => void) | null = null;
  private readonly mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 });
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly n = new THREE.Vector3();
  private readonly e = new THREE.Euler();

  constructor(
    private readonly terrain: Terrain,
    private readonly collision: CollisionWorld,
  ) {
    this.group.name = 'rides';
    const d = zone('douar');
    const o = zone('oasis');
    const k = zone('kasbah');
    const p = zone('post');
    this.add('donkey', d.x - 18, d.z + 2, 0.8);
    this.add('mule', o.x + 16, o.z - 10, -2.2);
    this.add('horse', k.x - 12, k.z - 11, 0); // the Caïd's stables
    this.add('camel', 46, 170, 2.6); // nomad camp
    this.add('jeep', p.x - 14, p.z - 40, Math.PI * 0.9); // outside the post gate
    this.add('boat', LAKE.x + LAKE.water - 3, LAKE.z + 2.6, -Math.PI / 2);
    this.add('train', 0, 0, 0);
    this.add('plane', AIRSTRIP.x, AIRSTRIP.z + AIRSTRIP.halfL - 8, Math.PI);
  }

  private add(kind: RideKind, x: number, z: number, yaw: number): void {
    const root = new THREE.Group();
    root.name = `ride-${kind}`;
    const r: Ride = {
      id: kind,
      kind,
      root,
      pos: new THREE.Vector3(x, this.terrain.getHeight(x, z), z),
      yaw,
      speed: 0,
      home: { x, z, yaw },
      legs: [],
      wheels: [],
      oars: [],
      prop: null,
      phase: 0,
      s: TRAIN_MIN_S,
      dir: 1,
      dwell: 6,
      manualT: 0,
      cars: [],
      pitch: 0,
      roll: 0,
      vy: 0,
      throttle: 0,
      flying: false,
      crashed: false,
      crashReason: '',
    };
    this.build(r);
    if (kind === 'boat') r.pos.y = LAKE.level;
    this.rides.push(r);
    this.group.add(root);
    this.place(r);
  }

  get(kind: RideKind): Ride {
    return this.rides.find((r) => r.kind === kind) as Ride;
  }

  /** Back to its parking spot (respawn, retry). */
  reset(r: Ride): void {
    r.pos.set(r.home.x, this.terrain.getHeight(r.home.x, r.home.z), r.home.z);
    if (r.kind === 'boat') r.pos.y = LAKE.level;
    r.yaw = r.home.yaw;
    r.speed = 0;
    r.pitch = 0;
    r.roll = 0;
    r.vy = 0;
    r.throttle = 0;
    r.flying = false;
    r.crashed = false;
    this.place(r);
  }

  /** World position of the rider's seat. */
  seatWorld(r: Ride, out: THREE.Vector3): THREE.Vector3 {
    const [sx, sy, sz] = RIDES[r.kind].seat;
    const host = r.kind === 'train' ? r.cars[0] : r.root;
    host.updateMatrixWorld();
    return out.set(sx, sy, sz).applyMatrix4(host.matrixWorld);
  }

  /** Can the rider step off here? */
  canLeave(r: Ride): boolean {
    if (r.kind === 'plane') return !r.flying && Math.abs(r.speed) < 2;
    if (r.kind === 'train') return Math.abs(r.speed) < 1.5;
    return Math.abs(r.speed) < 3.5;
  }

  /** A safe spot beside the ride to put the player down. */
  exitPoint(r: Ride, out: THREE.Vector3): THREE.Vector3 {
    if (r.kind === 'boat') {
      // the jetty / nearest shore
      const a = Math.atan2(r.pos.z - LAKE.z, r.pos.x - LAKE.x);
      const x = LAKE.x + Math.cos(a) * (LAKE.water + 3);
      const z = LAKE.z + Math.sin(a) * (LAKE.water + 3);
      return out.set(x, this.terrain.getHeight(x, z), z);
    }
    const base = r.kind === 'train' ? this.seatWorld(r, out).clone() : r.pos;
    const yaw = r.kind === 'train' ? r.yaw : r.yaw;
    for (const side of [1, -1, 2, -2]) {
      const off = RIDES[r.kind].radius + 1.2 * Math.abs(side);
      const x = base.x + Math.cos(yaw) * off * Math.sign(side);
      const z = base.z - Math.sin(yaw) * off * Math.sign(side);
      const g = this.terrain.getHeight(x, z);
      if (!this.collision.blockedAt(x, z, 0.4, g)) return out.set(x, g, z);
    }
    return out.set(base.x + 2, this.terrain.getHeight(base.x + 2, base.z), base.z);
  }

  update(dt: number, driven: Ride | null, c: Controls, camera?: THREE.Vector3): void {
    for (const r of this.rides) {
      if (camera && r !== driven) {
        // far rides cost nothing: skip drawing (and their shadow pass)
        if (r.kind === 'train') for (const car of r.cars) car.visible = car.position.distanceTo(camera) < 220;
        else r.root.visible = r.pos.distanceTo(camera) < (r.kind === 'plane' ? 260 : 140);
      } else r.root.visible = true;
      const me = r === driven;
      if (r.kind === 'train') this.updateTrain(r, dt, me ? c : null);
      else if (r.kind === 'plane') this.updatePlane(r, dt, me ? c : null);
      else if (r.kind === 'boat') this.updateBoat(r, dt, me ? c : null);
      else this.updateGround(r, dt, me ? c : null);
      this.place(r);
      this.animate(r, dt);
    }
  }

  // ---------------------------------------------------------------- movement

  private updateGround(r: Ride, dt: number, c: Controls | null): void {
    const def = RIDES[r.kind];
    const target = !c ? 0 : c.f ? (c.boost ? def.boost : def.max) : c.b ? -def.reverse : 0;
    const rate = (target === 0 ? def.accel * 1.6 : def.accel) * (c?.down ? 3 : 1);
    r.speed += clamp(target - r.speed, -rate * dt, rate * dt);
    if (c) {
      const steer = (c.l ? 1 : 0) - (c.r ? 1 : 0);
      const k = r.kind === 'jeep' ? clamp(r.speed / 5, -1, 1) : 1;
      r.yaw += steer * def.turn * dt * k;
    }
    if (Math.abs(r.speed) < 0.01) return;
    const ox = r.pos.x;
    const oz = r.pos.z;
    r.pos.x += Math.sin(r.yaw) * r.speed * dt;
    r.pos.z += Math.cos(r.yaw) * r.speed * dt;
    this.collision.resolveCircle(r.pos, def.radius, 1.8);
    // no wading into the lake, no climbing cliffs, stay inside the mountains
    const tooSteep = this.terrain.getSlope(r.pos.x, r.pos.z) > (r.kind === 'jeep' ? 0.9 : 1.15);
    const wet = Math.hypot(r.pos.x - LAKE.x, r.pos.z - LAKE.z) < LAKE.water - 0.5;
    if (tooSteep || wet || Math.hypot(r.pos.x, r.pos.z) > 228) {
      r.pos.x = ox;
      r.pos.z = oz;
      r.speed *= 0.3;
    }
    const moved = Math.hypot(r.pos.x - ox, r.pos.z - oz);
    if (moved < Math.abs(r.speed) * dt * 0.35) r.speed *= 0.6; // ran into something
    r.pos.y = this.terrain.getHeight(r.pos.x, r.pos.z);
  }

  private updateBoat(r: Ride, dt: number, c: Controls | null): void {
    const def = RIDES.boat;
    const target = !c ? 0 : c.f ? (c.boost ? def.boost : def.max) : c.b ? -def.reverse : 0;
    r.speed += clamp(target - r.speed, -def.accel * dt, def.accel * dt);
    if (c) r.yaw += ((c.l ? 1 : 0) - (c.r ? 1 : 0)) * def.turn * dt;
    r.pos.x += Math.sin(r.yaw) * r.speed * dt;
    r.pos.z += Math.cos(r.yaw) * r.speed * dt;
    const dx = r.pos.x - LAKE.x;
    const dz = r.pos.z - LAKE.z;
    const d = Math.hypot(dx, dz);
    const max = LAKE.water - 1.4;
    if (d > max) {
      r.pos.x = LAKE.x + (dx / d) * max;
      r.pos.z = LAKE.z + (dz / d) * max;
      r.speed *= 0.3;
    }
    r.phase += dt * (0.8 + Math.abs(r.speed));
    r.pos.y = LAKE.level + Math.sin(r.phase * 1.3) * 0.04;
  }

  private updateTrain(r: Ride, dt: number, c: Controls | null): void {
    const def = RIDES.train;
    if (c && (c.f || c.b)) r.manualT = 3;
    r.manualT = Math.max(0, r.manualT - dt);
    let target: number;
    if (c && r.manualT > 0) {
      target = c.f ? (c.boost ? def.boost : def.max) : c.b ? -def.reverse : 0;
    } else {
      // autopilot: shuttle between the halts, dwelling at each
      if (r.dwell > 0) {
        r.dwell -= dt;
        target = 0;
      } else {
        const toEnd = r.dir > 0 ? RAIL_LENGTH - 12 - r.s : r.s - TRAIN_MIN_S;
        target = r.dir * Math.min(def.max * 0.8, Math.max(1.2, toEnd * 0.35));
        if (toEnd <= 0.3) {
          r.dwell = 14;
          r.dir = -r.dir;
          target = 0;
        }
      }
    }
    r.speed += clamp(target - r.speed, -def.accel * 1.5 * dt, def.accel * dt);
    r.s = clamp(r.s + r.speed * dt, TRAIN_MIN_S, RAIL_LENGTH - 12);
    if (r.s <= TRAIN_MIN_S || r.s >= RAIL_LENGTH - 12) r.speed *= 0.5;
    const p = railAt(r.s);
    r.pos.set(p.x, this.terrain.getHeight(p.x, p.z), p.z);
    r.yaw = p.angle;
    r.phase += dt * r.speed * 0.9;
  }

  private updatePlane(r: Ride, dt: number, c: Controls | null): void {
    if (r.crashed) return;
    const ground = this.terrain.getHeight(r.pos.x, r.pos.z);
    const pitchWant = c?.up ? 0.38 : c?.down ? -0.38 : 0;
    if (!r.flying) {
      // taxi and take-off run
      const target = c?.f ? 34 : 0;
      const rate = c?.b ? 12 : c?.f ? 6 : 4;
      r.speed += clamp(target - r.speed, -rate * dt, rate * dt);
      if (c) r.yaw += ((c.l ? 1 : 0) - (c.r ? 1 : 0)) * 0.6 * dt * clamp(r.speed / 4, 0, 1);
      r.pitch += (0 - r.pitch) * Math.min(1, dt * 4);
      if (c?.up && r.speed > 22) {
        r.flying = true;
        r.vy = 3;
        r.throttle = 0.85;
      }
      r.pos.x += Math.sin(r.yaw) * r.speed * dt;
      r.pos.z += Math.cos(r.yaw) * r.speed * dt;
      r.pos.y = ground;
      if (this.collision.blockedAt(r.pos.x, r.pos.z, 1.5, ground) && r.speed > 8) this.crash(r, 'taxi obstacle');
      return;
    }
    // airborne: arcade lift — speed above ~26 m/s climbs, below it sinks
    if (c) {
      if (c.f) r.throttle = Math.min(1, r.throttle + dt * 0.5);
      if (c.b) r.throttle = Math.max(0.35, r.throttle - dt * 0.5);
    }
    r.speed += (r.throttle * 44 - r.speed) * 0.35 * dt;
    r.pitch += (pitchWant - r.pitch) * Math.min(1, dt * 2.5);
    const steer = c ? (c.l ? 1 : 0) - (c.r ? 1 : 0) : 0;
    r.roll += (-steer * 0.55 - r.roll) * Math.min(1, dt * 3);
    r.yaw += -r.roll * RIDES.plane.turn * dt * 1.8;
    // keep inside the valley: turn back from the mountain wall
    if (Math.hypot(r.pos.x, r.pos.z) > 236) r.yaw += 1.2 * dt * Math.sign(Math.sin(Math.atan2(-r.pos.x, -r.pos.z) - r.yaw) || 1);
    const climb = r.pitch * r.speed * 0.9 + (r.speed - 26) * 0.22;
    r.vy += (climb - r.vy) * Math.min(1, dt * 2);
    if (r.pos.y - ground > 160) r.vy = Math.min(r.vy, 0);
    r.pos.x += Math.sin(r.yaw) * r.speed * dt * Math.cos(r.pitch);
    r.pos.z += Math.cos(r.yaw) * r.speed * dt * Math.cos(r.pitch);
    r.pos.y += r.vy * dt;
    r.phase += dt * 40;
    const g2 = this.terrain.getHeight(r.pos.x, r.pos.z);
    if (r.pos.y <= g2) {
      // touchdown: gentle and level lands, anything else crashes
      const slope = this.terrain.getSlope(r.pos.x, r.pos.z);
      if (-r.vy > 7 || r.speed > 44 || r.pitch < -0.25 || Math.abs(r.roll) > 0.45 || slope > 0.9) this.crash(r, `touchdown vy=${r.vy.toFixed(1)} v=${r.speed.toFixed(1)} pitch=${r.pitch.toFixed(2)} roll=${r.roll.toFixed(2)} slope=${slope.toFixed(2)}`);
      else {
        r.flying = false;
        r.pos.y = g2;
        r.vy = 0;
        r.roll = 0;
        r.throttle = 0;
      }
    } else if (r.pos.y - g2 < 6 && this.collision.blockedAt(r.pos.x, r.pos.z, 2, r.pos.y - 1)) this.crash(r, 'obstacle');
  }

  private crash(r: Ride, reason: string): void {
    r.crashReason = reason;
    r.crashed = true;
    r.flying = false;
    r.speed = 0;
    r.roll = 0.6;
    r.pitch = -0.3;
    r.pos.y = this.terrain.getHeight(r.pos.x, r.pos.z);
    this.onCrash?.(r);
  }

  /** Detect the moment a landed plane rolls to a stop (Game listens). */
  checkLanded(r: Ride): boolean {
    return r.kind === 'plane' && !r.flying && !r.crashed && Math.abs(r.speed) < 2 && Math.hypot(r.pos.x - r.home.x, r.pos.z - r.home.z) > 60;
  }

  // ---------------------------------------------------------------- pose

  private place(r: Ride): void {
    if (r.kind === 'train') {
      r.cars.forEach((car, i) => {
        const p = railAt(r.s - i * 8.4);
        car.position.set(p.x, this.terrain.getHeight(p.x, p.z), p.z);
        car.rotation.set(0, p.angle, 0);
      });
      return;
    }
    r.root.position.copy(r.pos);
    if (r.kind === 'jeep' || (r.kind === 'plane' && !r.flying)) {
      // sit on the slope
      this.terrain.normalAt(r.pos.x, r.pos.z, this.n);
      this.q.setFromUnitVectors(UP, this.n);
      this.e.set(r.kind === 'plane' ? r.pitch * 0.3 : 0, r.yaw, r.kind === 'plane' ? r.roll : 0, 'YXZ');
      this.q2.setFromEuler(this.e);
      r.root.quaternion.copy(this.q).multiply(this.q2);
    } else if (r.kind === 'plane') {
      this.e.set(-r.pitch, r.yaw, r.roll, 'YXZ');
      r.root.quaternion.setFromEuler(this.e);
    } else {
      this.e.set(0, r.yaw, r.kind === 'boat' ? Math.sin(r.phase) * 0.03 : 0, 'YXZ');
      r.root.quaternion.setFromEuler(this.e);
    }
  }

  private animate(r: Ride, dt: number): void {
    const sp = Math.abs(r.speed);
    if (r.legs.length) {
      r.phase += dt * sp * (r.kind === 'camel' ? 1.6 : 2.4);
      const amp = Math.min(0.75, sp * 0.12);
      r.legs.forEach((leg, i) => {
        const diag = i === 0 || i === 3 ? 0 : Math.PI;
        leg.rotation.x = Math.sin(r.phase * 2 + diag + (r.kind === 'camel' && i % 2 ? Math.PI / 2 : 0)) * amp;
      });
    }
    for (const w of r.wheels) w.rotation.x += (r.speed / 0.4) * dt;
    for (const [i, o] of r.oars.entries()) o.rotation.x = Math.sin(r.phase * 2.2) * 0.6 * Math.min(1, sp) * (i ? 1 : 1);
    if (r.prop) r.prop.rotation.z += dt * (r.flying ? 60 : r.speed > 0.5 || r.throttle > 0 ? 30 : 0);
    FWD.set(0, 0, 0);
  }

  // ---------------------------------------------------------------- models

  private mesh(parts: THREE.BufferGeometry[]): THREE.Mesh {
    const m = new THREE.Mesh(merge(parts), this.mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  private build(r: Ride): void {
    const H = Math.PI / 2;
    const root = r.root;
    if (r.kind === 'donkey' || r.kind === 'mule' || r.kind === 'horse' || r.kind === 'camel') {
      const spec = {
        donkey: { coat: '#7d726a', mane: '#3a3430', len: 0.85, h: 0.95, r: 0.28, leg: 0.84, neck: 0.5, ears: 0.26, saddle: '#b3201f' },
        mule: { coat: '#5a4434', mane: '#2a2018', len: 0.95, h: 1.05, r: 0.3, leg: 0.95, neck: 0.55, ears: 0.22, saddle: '#2f5f8a' },
        horse: { coat: '#6e7072', mane: '#2a2622', len: 1.15, h: 1.3, r: 0.34, leg: 1.2, neck: 0.75, ears: 0.12, saddle: '#7a1717' },
        camel: { coat: '#c8a070', mane: '#a07a4e', len: 1.2, h: 1.65, r: 0.38, leg: 1.5, neck: 1.0, ears: 0.08, saddle: '#d7a24a' },
      }[r.kind];
      const body: THREE.BufferGeometry[] = [
        part(new THREE.CapsuleGeometry(spec.r, spec.len, 4, 12), spec.coat, 0, spec.h, 0, H),
        part(new THREE.CylinderGeometry(spec.r * 0.42, spec.r * 0.6, spec.neck, 8), spec.coat, 0, spec.h + spec.neck * 0.38, spec.len * 0.55, r.kind === 'camel' ? 0.35 : 0.65),
        part(new THREE.CapsuleGeometry(spec.r * 0.42, spec.r * 1.3, 4, 8), spec.coat, 0, spec.h + spec.neck * 0.78, spec.len * 0.55 + spec.neck * 0.5, r.kind === 'camel' ? 1.75 : 1.35),
        part(new THREE.BoxGeometry(0.06, spec.neck * 0.8, 0.12), spec.mane, 0, spec.h + spec.neck * 0.5, spec.len * 0.45, 0.6),
        part(new THREE.CylinderGeometry(0.02, 0.05, 0.5, 5), spec.mane, 0, spec.h - 0.05, -spec.len * 0.62, -2.5),
        part(new THREE.BoxGeometry(spec.r * 2.1, 0.08, 0.7), spec.saddle, 0, spec.h + spec.r * 0.95, -0.05),
        part(new THREE.BoxGeometry(spec.r * 2.25, 0.4, 0.5), shadeHex(spec.saddle, 0.8), 0, spec.h + spec.r * 0.45, -0.05),
      ];
      if (r.kind === 'camel') body.push(part(new THREE.SphereGeometry(0.42, 12, 8), spec.coat, 0, spec.h + 0.35, -0.05, 0, 0, 0, 1, 0.9, 1.1));
      for (const s of [-1, 1]) {
        body.push(part(new THREE.ConeGeometry(0.05, spec.ears, 5), spec.coat, s * 0.08, spec.h + spec.neck * 0.95 + 0.12, spec.len * 0.55 + spec.neck * 0.4, -0.2, 0, s * 0.3));
        if (r.kind !== 'camel') body.push(part(new THREE.BoxGeometry(0.02, 0.32, 0.02), '#2a2018', s * spec.r * 1.02, spec.h + 0.2, 0.05)); // stirrup strap
      }
      root.add(this.mesh(body));
      const legX = spec.r * 0.55;
      for (const [lx, lz] of [[legX, spec.len * 0.45], [-legX, spec.len * 0.45], [legX, -spec.len * 0.45], [-legX, -spec.len * 0.45]]) {
        const pivot = new THREE.Group();
        pivot.position.set(lx, spec.h - spec.r * 0.3, lz);
        const leg = this.mesh([
          part(new THREE.CylinderGeometry(spec.r * 0.24, spec.r * 0.16, spec.leg, 6), spec.coat, 0, -spec.leg / 2, 0),
          part(new THREE.BoxGeometry(spec.r * 0.4, 0.06, spec.r * 0.45), '#2a2420', 0, -spec.leg + 0.02, 0.02),
        ]);
        pivot.add(leg);
        root.add(pivot);
        r.legs.push(pivot);
      }
      return;
    }
    if (r.kind === 'jeep') {
      const ol = '#4f5a35';
      root.add(
        this.mesh([
          part(new THREE.BoxGeometry(1.5, 0.55, 3.1), ol, 0, 0.75, 0),
          part(new THREE.BoxGeometry(1.36, 0.35, 1.1), ol, 0, 1.12, 0.95),
          part(new THREE.BoxGeometry(1.4, 0.04, 0.02), '#2a2a2c', 0, 1.55, 0.35), // windshield frame
          part(new THREE.BoxGeometry(0.04, 0.5, 0.04), '#2a2a2c', 0.68, 1.33, 0.35),
          part(new THREE.BoxGeometry(0.04, 0.5, 0.04), '#2a2a2c', -0.68, 1.33, 0.35),
          part(new THREE.BoxGeometry(1.3, 0.42, 0.02), '#9fb4b8', 0, 1.33, 0.36),
          part(new THREE.BoxGeometry(0.5, 0.4, 0.5), '#3a3020', -0.38, 1.05, -0.2), // seats
          part(new THREE.BoxGeometry(0.5, 0.4, 0.5), '#3a3020', 0.38, 1.05, -0.2),
          part(new THREE.BoxGeometry(1.3, 0.35, 0.55), '#3a3020', 0, 1.05, -1.0),
          part(new THREE.CylinderGeometry(0.33, 0.33, 0.2, 14), '#1e1e1e', 0, 1.05, -1.62, H),
          part(new THREE.CircleGeometry(0.16, 16), '#1f3c8a', 0, 1.3, 1.51, 0, 0, 0), // roundel
          part(new THREE.CircleGeometry(0.1, 16), '#f2f0ea', 0, 1.3, 1.512),
          part(new THREE.CircleGeometry(0.05, 12), '#c42b2b', 0, 1.3, 1.514),
          part(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 10), '#e8e4c0', 0.5, 1.0, 1.56, H),
          part(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 10), '#e8e4c0', -0.5, 1.0, 1.56, H),
        ]),
      );
      for (const [wx, wz] of [[0.78, 1.05], [-0.78, 1.05], [0.78, -1.05], [-0.78, -1.05]]) {
        const pivot = new THREE.Group();
        pivot.position.set(wx, 0.38, wz);
        const w = this.mesh([part(new THREE.CylinderGeometry(0.38, 0.38, 0.26, 14), '#1e1e1e', 0, 0, 0, 0, 0, H), part(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 10), '#4f5a35', 0, 0, 0, 0, 0, H)]);
        pivot.add(w);
        root.add(pivot);
        r.wheels.push(pivot);
      }
      return;
    }
    if (r.kind === 'boat') {
      const hull = new THREE.CylinderGeometry(0.8, 0.8, 4, 16, 1, true, Math.PI / 2, Math.PI);
      root.add(
        this.mesh([
          part(hull, '#2f6f8a', 0, 0.55, 0, H, 0, 0, 1, 1, 0.55),
          part(new THREE.CylinderGeometry(0.78, 0.78, 3.9, 16, 1, true, Math.PI / 2, Math.PI), '#7a5232', 0, 0.56, 0, H, 0, 0, 0.97, 1, 0.5),
          part(new THREE.BoxGeometry(1.4, 0.06, 0.3), '#6b4a2c', 0, 0.45, -0.3),
          part(new THREE.BoxGeometry(1.2, 0.06, 0.3), '#6b4a2c', 0, 0.45, 1.0),
          part(new THREE.ConeGeometry(0.1, 0.5, 6), '#c42b2b', 0, 0.7, 1.9, H),
        ]),
      );
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.8, 0.6, -0.2);
        pivot.add(this.mesh([part(new THREE.CylinderGeometry(0.025, 0.025, 2, 5), '#8a6a3a', s * 0.8, -0.15, 0, 0, 0, s * 1.25), part(new THREE.BoxGeometry(0.04, 0.4, 0.15), '#8a6a3a', s * 1.6, -0.5, 0, 0, 0, s * 1.25)]));
        root.add(pivot);
        r.oars.push(pivot);
      }
      return;
    }
    if (r.kind === 'train') {
      const loco = new THREE.Group();
      loco.add(
        this.mesh([
          part(new THREE.CylinderGeometry(0.75, 0.75, 4.2, 14), '#1e1e22', 0, 1.65, 0.9, H),
          part(new THREE.BoxGeometry(2.0, 2.0, 2.0), '#2a2a30', 0, 1.9, -2.0),
          part(new THREE.BoxGeometry(2.2, 0.12, 2.4), '#7a1717', 0, 2.95, -2.0),
          part(new THREE.CylinderGeometry(0.22, 0.3, 1.0, 10), '#1e1e22', 0, 2.75, 2.4),
          part(new THREE.CylinderGeometry(0.3, 0.3, 0.4, 10), '#c9a24a', 0, 2.5, 1.0),
          part(new THREE.BoxGeometry(2.1, 0.3, 7.0), '#3a3a3e', 0, 0.75, 0),
          part(new THREE.ConeGeometry(0.9, 0.8, 4), '#5a5a5e', 0, 0.6, 3.5, H, Math.PI / 4),
          part(new THREE.BoxGeometry(1.2, 0.8, 0.05), '#d8b45a', 0, 2.2, -0.99), // cab windows
        ]),
      );
      loco.add(this.mesh([-2.4, -0.8, 0.8, 2.4].flatMap((z) => [-0.95, 0.95].map((x) => part(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 14), '#7a1717', x, 0.5, z, 0, 0, H)))));
      const flat = new THREE.Group();
      flat.add(
        this.mesh([
          part(new THREE.BoxGeometry(2.1, 0.25, 7.2), '#5a4a3a', 0, 0.8, 0),
          part(new THREE.BoxGeometry(1.0, 0.7, 1.2), '#6f5a3a', -0.4, 1.28, 1.5),
          part(new THREE.BoxGeometry(1.0, 0.7, 1.2), '#6f5a3a', 0.4, 1.28, -0.8),
          part(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 10), '#4d5a3c', -0.4, 1.38, -2.2),
          part(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 12), '#2a2a2c', 0.95, 0.45, 2.4, 0, 0, H),
          part(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 12), '#2a2a2c', -0.95, 0.45, 2.4, 0, 0, H),
          part(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 12), '#2a2a2c', 0.95, 0.45, -2.4, 0, 0, H),
          part(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 12), '#2a2a2c', -0.95, 0.45, -2.4, 0, 0, H),
        ]),
      );
      const coach = new THREE.Group();
      coach.add(
        this.mesh([
          part(new THREE.BoxGeometry(2.3, 2.1, 7.2), '#2f5f4a', 0, 1.9, 0),
          part(new THREE.BoxGeometry(2.45, 0.15, 7.4), '#5a5a5e', 0, 3.0, 0),
          part(new THREE.BoxGeometry(2.32, 0.5, 6.2), '#d8c9a0', 0, 2.2, 0),
          part(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 12), '#2a2a2c', 0.95, 0.45, 2.4, 0, 0, H),
          part(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 12), '#2a2a2c', -0.95, 0.45, 2.4, 0, 0, H),
          part(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 12), '#2a2a2c', 0.95, 0.45, -2.4, 0, 0, H),
          part(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 12), '#2a2a2c', -0.95, 0.45, -2.4, 0, 0, H),
        ]),
      );
      r.cars.push(loco, flat, coach);
      root.add(loco, flat, coach);
      return;
    }
    // plane: high-wing liaison aircraft in garrison khaki with French roundels
    const kh = '#7a7550';
    const body = this.mesh([
      part(new THREE.CylinderGeometry(0.42, 0.18, 6.2, 10), kh, 0, 1.5, -0.6, H),
      part(new THREE.BoxGeometry(0.85, 0.95, 1.8), kh, 0, 1.55, 1.2),
      part(new THREE.BoxGeometry(0.88, 0.5, 1.4), '#9fb4b8', 0, 2.0, 0.9),
      part(new THREE.BoxGeometry(12.5, 0.14, 1.7), kh, 0, 2.35, 0.7),
      part(new THREE.BoxGeometry(3.6, 0.08, 0.9), kh, 0, 1.7, -3.4),
      part(new THREE.BoxGeometry(0.08, 1.1, 0.9), kh, 0, 2.15, -3.45),
      part(new THREE.BoxGeometry(0.09, 0.4, 0.5), '#1f3c8a', 0, 2.3, -3.5),
      part(new THREE.CylinderGeometry(0.5, 0.42, 0.6, 12), '#3a3a3c', 0, 1.6, 2.35, H),
      part(new THREE.CylinderGeometry(0.035, 0.035, 2.6, 5), '#3a3a3c', 1.1, 1.75, 0.7, 0, 0, -1.1),
      part(new THREE.CylinderGeometry(0.035, 0.035, 2.6, 5), '#3a3a3c', -1.1, 1.75, 0.7, 0, 0, 1.1),
      part(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 5), '#3a3a3c', 0.6, 0.85, 1.2, 0, 0, 0.6),
      part(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 5), '#3a3a3c', -0.6, 0.85, 1.2, 0, 0, -0.6),
      part(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 12), '#1e1e1e', 0.95, 0.32, 1.2, 0, 0, H),
      part(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 12), '#1e1e1e', -0.95, 0.32, 1.2, 0, 0, H),
      part(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8), '#1e1e1e', 0, 1.0, -3.5, 0, 0, H),
      ...[4.4, -4.4].flatMap((x) => [
        part(new THREE.CylinderGeometry(0.5, 0.5, 0.02, 16), '#1f3c8a', x, 2.43, 0.7),
        part(new THREE.CylinderGeometry(0.32, 0.32, 0.025, 16), '#f2f0ea', x, 2.435, 0.7),
        part(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 12), '#c42b2b', x, 2.44, 0.7),
      ]),
    ]);
    root.add(body);
    const prop = new THREE.Group();
    prop.position.set(0, 1.6, 2.7);
    prop.add(this.mesh([part(new THREE.BoxGeometry(2.2, 0.16, 0.05), '#4a3626', 0, 0, 0), part(new THREE.ConeGeometry(0.16, 0.3, 8), '#c9a24a', 0, 0, 0.12, H)]));
    root.add(prop);
    r.prop = prop;
  }
}

function shadeHex(hex: string, f: number): string {
  const c = new THREE.Color(hex).multiplyScalar(f);
  return `#${c.getHexString()}`;
}
