import * as THREE from 'three';
import { L, type Text } from '../i18n';
import { clamp } from '../utils/noise';
import type { CollisionWorld } from '../world/Collision';
import { AIRSTRIP, LAKE, RAIL_LENGTH, distToRoads, railAt, stripAt, zone } from '../world/layout';
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
  boat: { name: L('Fishing boat', 'الفلوكة'), max: 4.2, boost: 5, reverse: 1.5, accel: 2.2, turn: 1.1, radius: 1.2, seat: [0, 0.3, -0.4], cam: 2.5, camH: 0.6, stealth: 1, reach: 3.2 },
  train: { name: L('The train', 'الماشينا'), max: 11, boost: 14, reverse: 6, accel: 2, turn: 0, radius: 2, seat: [0, 1.55, -2.1], cam: 7, camH: 1.8, stealth: 1, reach: 4.5 },
  plane: { name: L('MS.500 Criquet', 'طيارة الكريكي'), max: 0, boost: 0, reverse: 0, accel: 0, turn: 0.75, radius: 4, seat: [0, 1.25, 0.35], cam: 9, camH: 1.6, stealth: 2, reach: 4 },
};

/** A solid circle in the XZ plane (rides, characters, animals). */
export type Body = { x: number; z: number; r: number; y0: number; y1: number };

/** Ride footprints as circles in ride space (x right, z forward): [x, z, r, top above the ground]. */
const FOOTPRINT: Record<RideKind, [number, number, number, number][]> = {
  donkey: [[0, -0.45, 0.36, 1.3], [0, 0, 0.36, 1.3], [0, 0.5, 0.33, 1.5]],
  mule: [[0, -0.5, 0.38, 1.4], [0, 0, 0.38, 1.4], [0, 0.55, 0.35, 1.6]],
  horse: [[0, -0.62, 0.42, 1.7], [0, 0, 0.42, 1.7], [0, 0.66, 0.38, 2]],
  camel: [[0, -0.66, 0.46, 2.2], [0, 0, 0.46, 2.4], [0, 0.7, 0.42, 2.2], [0, 1.3, 0.3, 2.6]],
  jeep: [[0, -1.05, 0.8, 1.6], [0, 0, 0.8, 1.6], [0, 1.05, 0.8, 1.6]],
  boat: [],
  train: [],
  plane: [[0, 2.3, 0.55, 2.2], [0, 1.2, 0.5, 2.4], [0.95, 1.2, 0.3, 1], [-0.95, 1.2, 0.3, 1], [0, 0, 0.45, 2.4], [0, -1.4, 0.38, 2], [0, -2.7, 0.3, 2], [1.2, -3.4, 0.5, 2], [-1.2, -3.4, 0.5, 2]],
};

/**
 * Cockpit inputs, GTA-style on the keyboard: W/S throttle, A/D rudder,
 * numpad 4/6 (or ←/→) ailerons, numpad 8/5 (or ↑/↓) elevator: 8 pushes the
 * nose down, 5 pulls it up.
 */
export type PlaneControls = {
  /** throttle lever: +1 opening, -1 closing */
  throttle: number;
  /** stick back (+1, nose up) / forward (-1) */
  elevator: number;
  /** stick right (+1, right wing down) / left (-1) */
  aileron: number;
  /** right pedal (+1) / left pedal (-1) */
  rudder: number;
  brake: boolean;
  /** flap lever this frame: +1 one notch down, -1 one notch up */
  flaps: number;
  /** trim wheel: +1 nose-up, -1 nose-down (held) */
  trim: number;
  /** engine switch pressed this frame */
  engine: boolean;
};

export type Controls = { f: boolean; b: boolean; l: boolean; r: boolean; boost: boolean; up: boolean; down: boolean; plane?: PlaneControls };

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
  /** front-wheel angle (jeep) */
  steer: number;
  /** sideways velocity: tyres or hooves sliding (m/s, + = to the right) */
  slip: number;
  /** flight-path angle: climb (+) or descent (-) of the velocity (rad) */
  gamma: number;
  /** a mount's wind for galloping, 0..1 */
  stamina: number;
  /** visual body pitch / roll from braking, accelerating and cornering */
  lean: { pitch: number; roll: number };
  /** last frame's longitudinal acceleration, for the lean */
  accel: number;
  stalled: boolean;
  braking: boolean;
  // ---- Criquet cockpit
  engineOn: boolean;
  /** seconds left on the starter */
  starting: number;
  /** engine speed, 0..1 of 2050 rpm */
  rpm: number;
  /** flap lever notch 0..3 (0°, 15°, 30°, 40°) and the flaps' actual travel 0..1 */
  flapNotch: number;
  flapPos: number;
  /** elevator trim -1..1 */
  trim: number;
  /** sideslip: nose heading minus flight track (rad) */
  beta: number;
  /** which wing drops in a stall */
  wingDrop: number;
  /** S brought it to a stop: it stays stopped until S is pressed again, which then reverses */
  brakeHold: boolean;
};

/** Flight model constants (3-DOF point mass: lift, drag, thrust, gravity). */
/**
 * Morane-Saulnier MS.500 Criquet, the French-built Fieseler Storch the French
 * army flew in 1945 (Argus As 10, 240 hp, 2,050 rpm). Tuned to its real
 * figures: top speed 175 km/h, cruise 150 km/h at about 65% power, stall
 * 70 km/h clean and 51 km/h with the slotted flaps at 40°, climb 4.8 m/s, a
 * take-off run under 100 m, a landing roll of a few dozen metres.
 */
const AIR = {
  /** lift and drag per (m/s)², per unit coefficient: wing area × air density / 2 / mass */
  k: 0.01737,
  cl0: 0.25,
  /** lift slope per radian of angle of attack */
  cla: 4.6,
  /** stall angle of attack, about 17° thanks to the fixed leading-edge slats */
  stall: 0.3,
  /** extra lift and drag at each flap notch: 0°, 15°, 30°, 40° */
  flapCl: [0, 0.45, 0.9, 1.3],
  flapCd: [0, 0.012, 0.03, 0.06],
  cd0: 0.036,
  induced: 0.055,
  /** static thrust (m/s²) at full power; the propeller's thrust fades toward `propV` */
  thrust: 4.1,
  propV: 80,
  /** angle of attack the aircraft settles to with neutral trim and the stick let go */
  trim: 0.05,
  /** the tail-down attitude standing on its three wheels */
  groundAttitude: 0.21,
  /** rolling resistance on packed earth / rough ground, and full braking, as fractions of g */
  rollStrip: 0.05,
  rollRough: 0.1,
  brake: 0.45,
  /** the undercarriage takes this sink rate (m/s) and no more */
  maxSink: 3.5,
  rpmMax: 2050,
  g: 9.81,
};

/** Grip and resistance of the ground under wheels and hooves. */
const GROUND = {
  /** cornering grip (m/s²) on a road and off it */
  gripRoad: 7.5,
  gripDirt: 5,
  /** rolling resistance (m/s²) on a road and in sand / scrub */
  rollRoad: 0.35,
  rollDirt: 1.2,
  /** air drag per (m/s)² */
  drag: 0.0012,
};

const FWD = new THREE.Vector3();
const TMP = new THREE.Vector3();

/** Push a circle at `p` out of a solid body. */
function pushCircle(p: THREE.Vector3, r: number, o: Body): void {
  const dx = p.x - o.x;
  const dz = p.z - o.z;
  const min = r + o.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2) || 1e-4;
  p.x = o.x + (dx / d) * min;
  p.z = o.z + (dz / d) * min;
}
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
  /** a driven ride hit something solid at `speed` m/s */
  onImpact: ((r: Ride, speed: number) => void) | null = null;
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
    this.add('donkey', d.x - 22, d.z + 14, 0.8); // tethered in the open by the douar, clear of walls and jars
    this.add('mule', o.x + 16, o.z - 10, -2.2);
    this.add('horse', k.x - 12, k.z - 11, 0); // the Caïd's stables
    this.add('camel', 46, 170, 2.6); // nomad camp
    this.add('jeep', p.x - 14, p.z - 40, Math.PI * 0.9); // outside the post gate
    this.add('boat', LAKE.x + LAKE.water - 3, LAKE.z + 2.6, -Math.PI / 2);
    this.add('train', 0, 0, 0);
    this.add('plane', AIRSTRIP.x, AIRSTRIP.z - AIRSTRIP.halfL + 8, 0); // by the hangar at the south end, facing up the open valley
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
      steer: 0,
      slip: 0,
      gamma: 0,
      stamina: 1,
      lean: { pitch: 0, roll: 0 },
      accel: 0,
      stalled: false,
      braking: false,
      brakeHold: false,
      engineOn: false,
      starting: 0,
      rpm: 0,
      flapNotch: 0,
      flapPos: 0,
      trim: 0,
      beta: 0,
      wingDrop: 1,
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
    r.steer = 0;
    r.slip = 0;
    r.gamma = 0;
    r.stamina = 1;
    r.stalled = false;
    r.engineOn = false;
    r.starting = 0;
    r.rpm = 0;
    r.flapNotch = 0;
    r.flapPos = 0;
    r.trim = 0;
    r.beta = 0;
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

  /**
   * Solid footprints of every ride except `skip` (the one being driven), so
   * people walk round a parked jeep or the train instead of through it.
   */
  bodies(skip: Ride | null, out: Body[]): Body[] {
    for (const r of this.rides) {
      if (r === skip || (r.kind === 'plane' && r.flying)) continue;
      if (r.kind === 'train') {
        // each car: 2.1-2.3 m wide, 7 m long, on its own bit of curve
        for (const car of r.cars) {
          const a = car.rotation.y;
          for (const lz of [-2.6, -0.9, 0.9, 2.6]) {
            out.push({ x: car.position.x + Math.sin(a) * lz, z: car.position.z + Math.cos(a) * lz, r: 1.15, y0: car.position.y, y1: car.position.y + 3 });
          }
        }
        continue;
      }
      const c = Math.cos(r.yaw);
      const s = Math.sin(r.yaw);
      for (const [lx, lz, rad, top] of FOOTPRINT[r.kind]) {
        out.push({ x: r.pos.x + lx * c + lz * s, z: r.pos.z - lx * s + lz * c, r: rad, y0: r.pos.y, y1: r.pos.y + top });
      }
    }
    return out;
  }

  /** Characters and animals the driven ride bumps into this frame (set by Game). */
  obstacles: Body[] = [];

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
    const car = r.kind === 'jeep';
    const fx = Math.sin(r.yaw);
    const fz = Math.cos(r.yaw);
    const onRoad = distToRoads(r.pos.x, r.pos.z) < 3;
    const v0 = r.speed;

    // ---- longitudinal: engine or legs, brakes, rolling resistance, drag, the slope
    let a = 0;
    r.braking = false;
    // a mount gallops only while it has the wind for it
    const canBoost = Boolean(c?.boost) && (car || r.stamina > 0.05);
    const top = canBoost ? def.boost : def.max;
    if (c?.f) {
      if (r.speed < -0.3) {
        a += def.accel * 1.6; // brake out of reverse
        r.braking = true;
      } else a += def.accel * Math.max(0, 1 - (r.speed / top) ** 2) - (r.speed > top ? (r.speed - top) * 0.8 : 0);
    } else if (c?.b) {
      if (r.speed > 0.4) {
        a -= car ? 8.5 : def.accel * 1.8; // brakes / pull up
        r.braking = true;
        r.brakeHold = true;
      } else if (r.brakeHold) {
        // stopped on the brake; let go of S and press it again to back up
        r.speed = 0;
        r.braking = true;
      } else a -= def.accel * 0.7 * Math.max(0, 1 - (r.speed / -def.reverse) ** 2);
    } else if (!car || !c) {
      // the animal slows by itself; nobody at the wheel means the parking brake is on
      a -= Math.sign(r.speed) * Math.min(Math.abs(r.speed) / dt, car ? 8.5 : def.accel * 1.2);
    }
    if (!c?.b) r.brakeHold = false;
    if (c?.up && car) {
      // handbrake (Space): rear wheels locked
      a -= Math.sign(r.speed) * 4;
      r.braking = true;
    }
    const roll = car ? (onRoad ? GROUND.rollRoad : GROUND.rollDirt) : 0.25;
    a -= Math.sign(r.speed) * roll + GROUND.drag * r.speed * Math.abs(r.speed);
    // gravity along the slope: climbing costs speed, descending adds it
    const ahead = this.terrain.getHeight(r.pos.x + fx, r.pos.z + fz);
    const behind = this.terrain.getHeight(r.pos.x - fx, r.pos.z - fz);
    const grade = (ahead - behind) / 2;
    if (c) a -= AIR.g * grade * (car ? 0.85 : 0.45);
    let v = r.speed + a * dt;
    if (r.brakeHold && c?.b && r.speed === 0) v = 0; // the brake holds on a slope
    // friction can stop, never reverse
    if (!c?.f && !c?.b && Math.sign(v) !== Math.sign(r.speed) && r.speed !== 0) v = 0;
    if (Math.abs(v) < 0.02 && !c?.f && !c?.b) v = 0;
    r.speed = v;
    r.accel = (r.speed - v0) / Math.max(dt, 1e-4);
    if (!car) {
      if (canBoost && c?.f && r.speed > def.max * 0.9) r.stamina = Math.max(0, r.stamina - dt / 12);
      else r.stamina = Math.min(1, r.stamina + dt / (Math.abs(r.speed) < 0.5 ? 6 : 18));
    }

    // ---- steering
    const input = c ? (c.l ? 1 : 0) - (c.r ? 1 : 0) : 0;
    const sp = Math.abs(r.speed);
    let yawRate: number;
    if (car) {
      // front wheels turn at a finite rate; less lock at speed. Bicycle model on a 2.1 m wheelbase
      const lock = 0.6 / (1 + (sp * sp) / 260);
      const want = input * lock;
      r.steer += clamp(want - r.steer, -2.2 * dt, 2.2 * dt);
      yawRate = (r.speed * Math.tan(r.steer)) / 2.1;
      // the tyres hold only so much: past the grip, the jeep runs wide and slides
      const grip = (onRoad ? GROUND.gripRoad : GROUND.gripDirt) * (c?.up ? 0.45 : 1);
      const lat = Math.abs(yawRate * r.speed);
      if (lat > grip) {
        const keep = grip / lat;
        r.slip += Math.sign(yawRate) * Math.sign(r.speed) * (lat - grip) * dt * (c?.up ? 1.4 : 0.6);
        yawRate *= c?.up ? 1.25 : keep; // handbrake swings the tail, otherwise understeer
      }
    } else {
      // a mount pivots freely at a walk and needs room to turn at a gallop
      yawRate = input * def.turn * (1 / (1 + sp / (def.max * 1.6))) * (r.speed < -0.1 ? -0.6 : 1);
    }
    r.yaw += yawRate * dt;
    // sideways slide bleeds off through the tyres or hooves
    const bleed = (car ? (onRoad ? GROUND.gripRoad : GROUND.gripDirt) : 8) * dt;
    r.slip = Math.abs(r.slip) <= bleed ? 0 : r.slip - Math.sign(r.slip) * bleed;
    const latAcc = yawRate * r.speed;
    r.lean.roll += (clamp(latAcc * (car ? 0.018 : 0.03), -0.12, 0.12) - r.lean.roll) * Math.min(1, dt * 6);
    r.lean.pitch += (clamp(-r.accel * 0.012, -0.08, 0.08) - r.lean.pitch) * Math.min(1, dt * 6);

    if (Math.abs(r.speed) < 0.01 && Math.abs(r.slip) < 0.01) return;
    const ox = r.pos.x;
    const oz = r.pos.z;
    const nfx = Math.sin(r.yaw);
    const nfz = Math.cos(r.yaw);
    r.pos.x += (nfx * r.speed + nfz * r.slip) * dt;
    r.pos.z += (nfz * r.speed - nfx * r.slip) * dt;

    // ---- collisions: the body is a row of circles, front, middle and back
    const want = { x: r.pos.x, z: r.pos.z };
    const len = car ? 1.05 : 0.45;
    const rad = car ? 0.85 : def.radius * 0.7;
    for (const off of [len, 0, -len]) {
      TMP.set(r.pos.x + nfx * off, r.pos.y, r.pos.z + nfz * off);
      const bx = TMP.x;
      const bz = TMP.z;
      this.collision.resolveCircle(TMP, rad, 1.8);
      for (const o of this.obstacles) {
        if (o.y1 < r.pos.y + 0.3 || o.y0 > r.pos.y + 2) continue;
        pushCircle(TMP, rad, o);
      }
      r.pos.x += TMP.x - bx;
      r.pos.z += TMP.z - bz;
    }
    const pushed = Math.hypot(r.pos.x - want.x, r.pos.z - want.z);
    if (pushed > 1e-3) {
      // how much of our velocity went into the obstacle
      const nx = (r.pos.x - want.x) / pushed;
      const nz = (r.pos.z - want.z) / pushed;
      const vx = nfx * r.speed + nfz * r.slip;
      const vz = nfz * r.speed - nfx * r.slip;
      const vn = vx * nx + vz * nz;
      if (vn < -2) {
        // an impact: keep the motion along the obstacle, lose the part into it (a little bounce when hard).
        // Gentle contact needs nothing: the push above already turns it into a slide along the wall.
        const into = -vn;
        if (into > 4) this.onImpact?.(r, into);
        const k = 1 + (into > 4 ? 0.2 : 0);
        const wx = vx - k * vn * nx;
        const wz = vz - k * vn * nz;
        r.speed = wx * nfx + wz * nfz;
        r.slip = wx * nfz - wz * nfx;
      }
    }
    // no wading into the lake, no climbing cliffs, stay inside the mountains
    const tooSteep = this.terrain.getSlope(r.pos.x, r.pos.z) > (car ? 0.9 : 1.15);
    const wet = Math.hypot(r.pos.x - LAKE.x, r.pos.z - LAKE.z) < LAKE.water - 0.5;
    if (tooSteep || wet || Math.hypot(r.pos.x, r.pos.z) > 228) {
      r.pos.x = ox;
      r.pos.z = oz;
      if (Math.abs(r.speed) > 4) this.onImpact?.(r, Math.abs(r.speed) * 0.6);
      r.speed *= -0.1;
      r.slip = 0;
    }
    r.pos.y = this.terrain.getHeight(r.pos.x, r.pos.z);
  }

private updateBoat(r: Ride, dt: number, c: Controls | null): void {
    const def = RIDES.boat;
    // oars give thrust in strokes; water drag grows with speed; the hull carries way and drifts
    const stroke = 0.55 + 0.45 * Math.max(0, Math.sin(r.phase * 2.2));
    let a = 0;
    if (c?.f) a += def.accel * stroke * (c.boost ? 1.25 : 1);
    if (c?.b) a -= def.accel * 0.8 * stroke;
    a -= 0.35 * r.speed * Math.abs(r.speed) + 0.08 * r.speed;
    const v0 = r.speed;
    r.speed = clamp(r.speed + a * dt, -def.reverse, def.boost);
    r.accel = (r.speed - v0) / Math.max(dt, 1e-4);
    // rowing one side turns her even at rest; a rudder-like bite once she has way on
    const input = c ? (c.l ? 1 : 0) - (c.r ? 1 : 0) : 0;
    const yawRate = input * def.turn * (0.45 + 0.55 * Math.min(1, Math.abs(r.speed) / 2));
    r.yaw += yawRate * dt;
    // a turn throws the hull sideways, the keel slowly kills it
    r.slip += -yawRate * r.speed * 0.25 * dt;
    r.slip -= r.slip * Math.min(1, dt * 1.2);
    const fx = Math.sin(r.yaw);
    const fz = Math.cos(r.yaw);
    r.pos.x += (fx * r.speed + fz * r.slip) * dt;
    r.pos.z += (fz * r.speed - fx * r.slip) * dt;
    const dx = r.pos.x - LAKE.x;
    const dz = r.pos.z - LAKE.z;
    const d = Math.hypot(dx, dz);
    const max = LAKE.water - 1.4;
    if (d > max) {
      r.pos.x = LAKE.x + (dx / d) * max;
      r.pos.z = LAKE.z + (dz / d) * max;
      if (Math.abs(r.speed) > 2) this.onImpact?.(r, Math.abs(r.speed));
      r.speed *= -0.2;
      r.slip = 0;
    }
    r.phase += dt * (0.8 + Math.abs(r.speed));
    r.lean.roll += (clamp(-r.slip * 0.15, -0.1, 0.1) + Math.sin(r.phase) * 0.03 - r.lean.roll) * Math.min(1, dt * 3);
    r.lean.pitch += (clamp(-r.accel * 0.03, -0.05, 0.05) - r.lean.pitch) * Math.min(1, dt * 3);
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

/**
   * Point-mass flight model: thrust, drag (parasite + induced), lift from the
   * angle of attack with a stall past 16°, ground effect near the runway,
   * coordinated banked turns (rate = g·tan(bank)/v), and pitch stability that
   * returns the nose to the trimmed angle of attack when the stick is let go.
   * W/S throttle (S also brakes on the ground), Space/C elevator, A/D ailerons.
   */
/**
   * Flight model of the Criquet. Point-mass flight path (airspeed, climb angle,
   * track) driven by lift, drag, propeller thrust and gravity, with the
   * attitude flown by the controls:
   * - elevator sets the pitch rate; the tail weathervanes the nose back to the
   *   angle of attack set by the trim wheel, so pitch sets the speed and
   *   throttle sets the climb;
   * - ailerons roll the wings; a banked wing turns the track at g·tan(bank)/v;
   * - rudder yaws the nose off the track (sideslip): it skids the track round,
   *   rolls the wings through dihedral, and costs drag;
   * - flaps add lift and drag; slats hold the stall to a high angle; ground
   *   effect within a wingspan of the ground; the wing drops in a stall;
   * - on the ground: a taildragger sitting tail-down, tailwheel steering with
   *   the rudder, wheel brakes (with the rudder they pivot her), lift taking
   *   weight off the wheels; brake hard with the tail up and she noses over.
   */
  private updatePlane(r: Ride, dt: number, c: Controls | null): void {
    if (r.crashed) return;
    const pc = c?.plane;
    // ---- engine: starter, then the rpm follows the throttle
    if (pc?.engine) {
      if (r.engineOn || r.starting > 0) {
        r.engineOn = false;
        r.starting = 0;
      } else r.starting = 1.4;
    }
    if (r.starting > 0) {
      r.starting -= dt;
      r.rpm = Math.max(r.rpm, 0.12 * (1 - r.starting / 1.4));
      if (r.starting <= 0) r.engineOn = true;
    }
    if (pc) r.throttle = clamp(r.throttle + pc.throttle * dt * 0.8, 0, 1);
    const rpmWant = r.engineOn ? 0.3 + 0.7 * r.throttle : 0;
    r.rpm += (rpmWant - r.rpm) * Math.min(1, dt * (r.engineOn ? 2.2 : 0.8));
    const power = r.engineOn ? Math.max(0, (r.rpm - 0.28) / 0.72) : 0;
    // ---- flaps: a hand crank, so they take a few seconds to travel
    if (pc?.flaps) r.flapNotch = clamp(r.flapNotch + pc.flaps, 0, 3);
    r.flapPos += clamp(r.flapNotch / 3 - r.flapPos, -dt * 0.4, dt * 0.4);
    if (pc) r.trim = clamp(r.trim + pc.trim * dt * 0.35, -1, 1);
    const elevator = pc?.elevator ?? 0;
    const aileron = pc?.aileron ?? 0;
    const rudder = pc?.rudder ?? 0;
    const brake = Boolean(pc?.brake);
    const v = Math.max(0.01, r.speed);
    const ground = this.terrain.getHeight(r.pos.x, r.pos.z);
    const h = r.pos.y - ground;
    // control authority grows with dynamic pressure
    const q = clamp((v / 30) ** 2, 0, 1.6);
    const thrust = AIR.thrust * power * Math.max(0, 1 - v / AIR.propV);

    if (!r.flying) {
      // ---- taxi, take-off run, landing roll
      r.braking = brake;
      // tail down at rest; stick forward with speed lifts the tail; hard braking tips her forward
      let attitude = AIR.groundAttitude;
      if (elevator < 0) attitude += elevator * AIR.groundAttitude * clamp(q * 1.6, 0, 1.2);
      if (brake) attitude -= 0.14 * clamp(v / 14, 0, 1);
      r.pitch += (attitude - r.pitch) * Math.min(1, dt * 3);
      const cl = this.liftCoef(r.pitch, 0, r.flapPos);
      const lift = AIR.k * v * v * cl;
      const drag = AIR.k * v * v * this.dragCoef(cl, r.flapPos, 0);
      const weight = Math.max(0, 1 - lift / AIR.g); // fraction of the weight on the wheels
      const rough = stripAt(r.pos.x, r.pos.z) || distToRoads(r.pos.x, r.pos.z) < 3 ? AIR.rollStrip : AIR.rollRough;
      const resist = (rough + (brake ? AIR.brake : 0)) * AIR.g * weight;
      const v0 = r.speed;
      let a = thrust - drag;
      if (r.speed > 0.05) a -= resist;
      else a = Math.max(0, a - resist); // standing still: the engine must beat friction and brakes
      r.speed = Math.max(0, r.speed + a * dt);
      r.accel = (r.speed - v0) / Math.max(dt, 1e-4);
      // tailwheel steering at taxi speed, the rudder in the slipstream and airflow above it;
      // a brake and full rudder pivots her round on one wheel
      const blast = clamp(power * 0.6 + v / 15, 0, 1.5);
      const yawRate = -rudder * (0.55 * clamp(v / 3, 0, 1) * (v < 12 ? 1 : 12 / v) + 0.35 * blast * (brake ? 1.2 : 0.4));
      r.yaw += yawRate * dt;
      r.roll += (0 - r.roll) * Math.min(1, dt * 4);
      r.beta = 0;
      r.gamma = 0;
      r.vy = 0;
      r.stalled = false;
      r.pos.x += Math.sin(r.yaw) * r.speed * dt;
      r.pos.z += Math.cos(r.yaw) * r.speed * dt;
      r.pos.y = this.terrain.getHeight(r.pos.x, r.pos.z);
      r.lean.pitch = 0;
      if (r.pitch < -0.1 && r.speed > 6) {
        this.crash(r, 'nosed over under braking');
        return;
      }
      if (lift > AIR.g && r.speed > 12) {
        r.flying = true;
        r.gamma = 0.02;
      }
      if (this.collision.blockedAt(r.pos.x, r.pos.z, 1.5, r.pos.y) && r.speed > 6) this.crash(r, 'taxi obstacle');
      return;
    }

    // ---- airborne
    const alpha = r.pitch - r.gamma;
    const cl = this.liftCoef(alpha, h, r.flapPos);
    const lift = AIR.k * v * v * cl;
    const drag = AIR.k * v * v * this.dragCoef(cl, r.flapPos, r.beta);
    const wasStalled = r.stalled;
    r.stalled = alpha > AIR.stall;
    if (r.stalled && !wasStalled) r.wingDrop = Math.sin(r.pos.x * 12.9898 + r.pos.z * 78.233) > 0 ? 1 : -1;
    const v0 = r.speed;
    r.speed = Math.max(5, r.speed + (thrust - drag - AIR.g * Math.sin(r.gamma)) * dt);
    r.accel = (r.speed - v0) / Math.max(dt, 1e-4);
    r.gamma = clamp(r.gamma + ((lift * Math.cos(r.roll) - AIR.g * Math.cos(r.gamma)) / v) * dt, -1.3, 1.3);
    // track: the banked lift turns it; sideslip skids it toward the nose
    const track = r.yaw - r.beta;
    const turn = (-lift * Math.sin(r.roll)) / (v * Math.max(0.2, Math.cos(r.gamma))) + r.beta * 0.7 * q;
    // rudder yaws the nose off the track; the fin weathervanes it back; a little adverse yaw from the ailerons
    r.beta += (-rudder * 0.55 * q - r.beta * 2.2 * Math.sqrt(q) + aileron * 0.04 * q) * dt;
    r.beta = clamp(r.beta, -0.35, 0.35);
    r.yaw = track + turn * dt + r.beta;
    // elevator: pitch rate; tail stability back to the trimmed angle of attack (flaps pitch the nose down a little)
    const alphaTrim = AIR.trim + r.trim * 0.12 - r.flapPos * 0.03;
    r.pitch += (elevator * 0.5 * Math.min(q, 1.2) - (alpha - alphaTrim) * 1.8 * q) * dt;
    if (r.stalled) r.pitch -= 0.4 * dt; // the nose drops
    r.pitch = clamp(r.pitch, -1.1, 0.9);
    // ailerons roll the wings; weak spiral stability levels them slowly; dihedral rolls away from sideslip
    let rollRate = aileron * 1.25 * Math.min(q, 1.1) - r.beta * 0.9 * q;
    if (aileron === 0) rollRate -= r.roll * 0.12;
    if (r.stalled) rollRate += r.wingDrop * 0.9;
    r.roll = clamp(r.roll + rollRate * dt, -1.3, 1.3);
    // keep inside the valley: turn back from the mountain wall
    if (Math.hypot(r.pos.x, r.pos.z) > 236) r.yaw += 1.2 * dt * Math.sign(Math.sin(Math.atan2(-r.pos.x, -r.pos.z) - r.yaw) || 1);
    if (h > 160 && r.gamma > 0) r.gamma *= 1 - Math.min(1, dt * 2); // the valley's ceiling
    r.vy = r.speed * Math.sin(r.gamma);
    const horiz = r.speed * Math.cos(r.gamma);
    const tr = r.yaw - r.beta;
    r.pos.x += Math.sin(tr) * horiz * dt;
    r.pos.z += Math.cos(tr) * horiz * dt;
    r.pos.y += r.vy * dt;
    r.phase += dt * 40;
    const g2 = this.terrain.getHeight(r.pos.x, r.pos.z);
    if (r.pos.y <= g2) {
      // touchdown: a gentle sink, wings level, not nose-first, not too fast
      const slope = this.terrain.getSlope(r.pos.x, r.pos.z);
      if (-r.vy > AIR.maxSink || r.speed > 45 || r.pitch < -0.1 || Math.abs(r.roll) > 0.3 || slope > 0.9) {
        this.crash(r, `touchdown vy=${r.vy.toFixed(1)} v=${r.speed.toFixed(1)} pitch=${r.pitch.toFixed(2)} roll=${r.roll.toFixed(2)} slope=${slope.toFixed(2)}`);
      } else {
        r.flying = false;
        r.pos.y = g2;
        r.vy = 0;
        r.gamma = 0;
        r.roll = 0;
        r.yaw = tr;
        r.beta = 0;
      }
    } else if (r.pos.y - g2 < 6 && this.collision.blockedAt(r.pos.x, r.pos.z, 2, r.pos.y - 1)) this.crash(r, 'obstacle');
  }

  /** Lift coefficient: linear to the stall, then it falls away; ground effect within a wingspan. */
/** Lift coefficient: linear to the stall, then it falls away; flaps add lift; ground effect within a wingspan. */
  private liftCoef(alpha: number, h: number, flaps: number): number {
    const flap = this.flapTable(AIR.flapCl, flaps);
    const max = AIR.cl0 + AIR.cla * AIR.stall;
    let cl = (alpha < AIR.stall ? AIR.cl0 + AIR.cla * alpha : max * Math.max(0.35, 1 - (alpha - AIR.stall) * 4)) + flap;
    if (h < 14) cl *= 1 + 0.35 * (1 - Math.max(0, h) / 14);
    return cl;
  }

  private dragCoef(cl: number, flaps: number, beta: number): number {
    return AIR.cd0 + AIR.induced * cl * cl + this.flapTable(AIR.flapCd, flaps) + 0.4 * beta * beta;
  }

  /** Interpolate a per-notch table at flap travel 0..1. */
  private flapTable(t: number[], pos: number): number {
    const f = clamp(pos, 0, 1) * 3;
    const i = Math.min(2, Math.floor(f));
    return t[i] + (t[i + 1] - t[i]) * (f - i);
  }

  /** Trimmed level flight at `speed`: the angle of attack and throttle that hold it. */
trimFor(r: Ride, speed: number, flaps = 0): void {
    r.flapNotch = flaps;
    r.flapPos = flaps / 3;
    const flapCl = this.flapTable(AIR.flapCl, r.flapPos);
    const cl = AIR.g / (AIR.k * speed * speed);
    const alpha = clamp((cl - flapCl - AIR.cl0) / AIR.cla, -0.05, AIR.stall - 0.02);
    const drag = AIR.k * speed * speed * this.dragCoef(cl, r.flapPos, 0);
    r.pitch = alpha;
    r.gamma = 0;
    r.beta = 0;
    r.trim = clamp((alpha - AIR.trim + r.flapPos * 0.03) / 0.12, -1, 1);
    r.engineOn = true;
    r.starting = 0;
    r.throttle = clamp(drag / (AIR.thrust * Math.max(0.05, 1 - speed / AIR.propV)), 0, 1);
    r.rpm = 0.3 + 0.7 * r.throttle;
  }

  /** Instruments for the HUD. */
  gauges(r: Ride): {
    speed: number;
    alt: number;
    vs: number;
    throttle: number;
    stall: boolean;
    brake: boolean;
    stamina: number;
    rpm: number;
    engine: 'off' | 'starting' | 'on';
    flaps: number;
    trim: number;
    heading: number;
  } {
    return {
      speed: Math.abs(r.speed),
      alt: r.pos.y - this.terrain.getHeight(r.pos.x, r.pos.z),
      vs: r.vy,
      throttle: r.throttle,
      stall: r.stalled || (r.flying && r.speed < 15.5 + (1 - r.flapPos) * 4),
      brake: r.braking,
      stamina: r.stamina,
      rpm: Math.round(r.rpm * AIR.rpmMax),
      engine: r.engineOn ? 'on' : r.starting > 0 ? 'starting' : 'off',
      flaps: [0, 15, 30, 40][r.flapNotch],
      trim: r.trim,
      // compass: 0 = north (-z), clockwise
      heading: (((Math.PI - r.yaw) * 180) / Math.PI + 360) % 360,
    };
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
      // sit on the slope; the body pitches under braking and rolls in corners
      this.terrain.normalAt(r.pos.x, r.pos.z, this.n);
      this.q.setFromUnitVectors(UP, this.n);
      // the model is drawn level: sitting on its tailwheel it rests 0.185 rad nose-up
      this.e.set(r.kind === 'plane' ? -(r.pitch - AIR.groundAttitude + 0.185) : r.lean.pitch, r.yaw, r.kind === 'plane' ? r.roll : r.lean.roll, 'YXZ');
      this.q2.setFromEuler(this.e);
      r.root.quaternion.copy(this.q).multiply(this.q2);
    } else if (r.kind === 'plane') {
      this.e.set(-r.pitch, r.yaw, r.roll, 'YXZ');
      r.root.quaternion.setFromEuler(this.e);
    } else {
      this.e.set(r.lean.pitch, r.yaw, r.lean.roll, 'YXZ');
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
    // wheels spin with the road speed; the front pair turns with the steering
    r.wheels.forEach((w, i) => {
      const tyre = w.children[0];
      if (tyre) tyre.rotation.x += (r.speed / 0.38) * dt;
      if (i < 2) w.rotation.y = r.steer;
    });
    for (const [i, o] of r.oars.entries()) o.rotation.x = Math.sin(r.phase * 2.2) * 0.6 * Math.min(1, sp) * (i ? 1 : 1);
    if (r.prop) r.prop.rotation.z += dt * r.rpm * 70;
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
