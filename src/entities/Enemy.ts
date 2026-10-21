import * as THREE from 'three';
import { L, type Text } from '../i18n';
import type { EnemySpawn } from '../game/types';
import { angleDiff, clamp, dampAngle } from '../utils/noise';
import type { CollisionWorld } from '../world/Collision';
import type { NavGrid } from '../world/NavGrid';
import type { Terrain } from '../world/Terrain';
import { CharacterRig, type Outfit } from './CharacterRig';

export type AiState = 'patrol' | 'guard' | 'suspicious' | 'alert' | 'search' | 'return' | 'dead';

export type EnemyContext = {
  terrain: Terrain;
  collision: CollisionWorld;
  nav: NavGrid;
  night: number;
  now: number;
  rng: () => number;
  /** Player's visible points & state */
  playerPos: THREE.Vector3;
  playerChest: THREE.Vector3;
  playerHead: THREE.Vector3;
  playerStealth: number; // posture*skill multiplier
  playerConcealed: boolean;
  playerDead: boolean;
  pathBudget: { left: number };
};

export type ShotRequest = { enemy: Enemy; from: THREE.Vector3; hitChance: number; damage: number };

const STATS = {
  french: { hp: 95, acc: 0.5, dmg: 22, walk: 1.5, run: 4.3, sight: 44, cooldown: [1.7, 2.6] },
  makhzen: { hp: 80, acc: 0.4, dmg: 20, walk: 1.4, run: 4.4, sight: 40, cooldown: [1.9, 3.0] },
};

let NEXT_ID = 0;

export class Enemy {
  readonly rig: CharacterRig;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  state: AiState;
  health: number;
  readonly maxHealth: number;
  awareness = 0;
  readonly lastKnown = new THREE.Vector3();
  timeSinceSeen = 99;
  seesPlayer = false;
  deadT = 0;
  respawnAt = Infinity;
  looted = false;
  readonly uid = NEXT_ID++;
  /** Fired when this guard turns hostile; Game propagates the shout. */
  onAlert: ((e: Enemy) => void) | null = null;
  onShoot: ((req: ShotRequest) => void) | null = null;
  onMelee: ((e: Enemy) => void) | null = null;

  private patrolIdx = 0;
  private waitT = 0;
  private path: number[][] = [];
  private pathIdx = 0;
  private pathTarget = new THREE.Vector3(Infinity, 0, 0);
  private repathT = 0;
  private perceiveT: number;
  private fireT = 1;
  private aimT = 0;
  private meleeCd = 0;
  private meleeT = -1;
  private searchT = 0;
  private searchPoint = new THREE.Vector3();
  private stuckT = 0;
  private lastPos = new THREE.Vector3();
  private flinch = 0;
  private flash = 0;
  private speed = 0;
  private lookAround = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly stats: (typeof STATS)['french'];

  constructor(readonly spawn: EnemySpawn) {
    const outfit: Outfit =
      spawn.faction === 'french' ? (spawn.rank === 'officer' ? 'lieutenant' : 'french') : spawn.rank === 'officer' ? 'khalifa' : 'mokhazni';
    const pistol = spawn.rank === 'officer';
    this.rig = new CharacterRig(outfit, { rifle: !pistol, pistol });
    this.stats = STATS[spawn.faction];
    this.maxHealth = this.stats.hp + (spawn.rank === 'officer' ? 25 : 0);
    this.health = this.maxHealth;
    this.state = spawn.patrol.length > 1 ? 'patrol' : 'guard';
    this.perceiveT = (this.uid % 7) * 0.03;
    this.reset();
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get isOfficer(): boolean {
    return this.spawn.rank === 'officer';
  }

  get label(): Text {
    if (this.spawn.faction === 'french') return this.spawn.rank === 'officer' ? L('French lieutenant', 'ليوطنان فرنساوي') : L('French soldier', 'عسكري فرنساوي');
    return this.spawn.rank === 'officer' ? L("Caïd's Khalifa", 'خليفة القايد') : L('Mokhazni', 'مخزني');
  }

  reset(): void {
    this.pos.set(this.spawn.x, this.spawn.fixedY ?? 0, this.spawn.z);
    this.yaw = this.spawn.facing ?? 0;
    this.state = this.spawn.patrol.length > 1 ? 'patrol' : 'guard';
    this.health = this.maxHealth;
    this.awareness = 0;
    this.timeSinceSeen = 99;
    this.patrolIdx = 0;
    this.path = [];
    this.deadT = 0;
    this.looted = false;
    this.respawnAt = Infinity;
    this.meleeT = -1;
    this.rig.holsterRifle();
    this.rig.root.visible = true;
  }

  /** Calm down without resetting position (after player death). */
  pacify(): void {
    if (!this.alive) return;
    this.awareness = 0;
    this.timeSinceSeen = 99;
    this.state = 'return';
    this.path = [];
    this.rig.holsterRifle();
  }

  hearNoise(at: THREE.Vector3, radius: number, isGunshot: boolean): void {
    if (!this.alive) return;
    const d = at.distanceTo(this.pos);
    if (d > radius) return;
    this.lastKnown.copy(at);
    if (isGunshot && d < radius * 0.6) {
      this.becomeAlert();
      this.timeSinceSeen = 3;
    } else if (this.state !== 'alert') {
      this.state = 'suspicious';
      this.awareness = Math.max(this.awareness, 0.45);
      this.searchT = 6;
    }
  }

  /** Called by a shouting ally. */
  alertFrom(at: THREE.Vector3): void {
    if (!this.alive || this.state === 'alert') return;
    this.lastKnown.copy(at);
    this.timeSinceSeen = 2;
    this.becomeAlert(false);
  }

  takeHit(dmg: number, from: THREE.Vector3): boolean {
    if (!this.alive) return false;
    this.health -= dmg;
    this.flinch = 1;
    this.flash = 1;
    this.lastKnown.copy(from);
    if (this.health <= 0) {
      this.health = 0;
      this.state = 'dead';
      this.deadT = 0;
      this.rig.setFlash(0);
      return true;
    }
    this.becomeAlert();
    this.timeSinceSeen = 0.5;
    return false;
  }

  /** Is the player standing behind this guard, unseen? (for takedowns) */
  canBeTakenDown(playerPos: THREE.Vector3): boolean {
    if (!this.alive || this.state === 'alert') return false;
    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.9) return false;
    const toPlayer = Math.atan2(dx, dz);
    return Math.abs(angleDiff(this.yaw, toPlayer)) > 1.9 || this.awareness < 0.25;
  }

  /** Ray vs head sphere & body cylinder. Returns distance and whether it was the head. */
  hitTest(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { t: number; head: boolean } | null {
    if (!this.alive) return null;
    const base = this.pos;
    // head
    this.tmp.set(base.x, base.y + 1.66, base.z);
    const th = raySphere(origin, dir, this.tmp, 0.17);
    // body (vertical cylinder)
    const tb = rayCylinder(origin, dir, base.x, base.z, 0.3, base.y + 0.15, base.y + 1.5);
    let best: { t: number; head: boolean } | null = null;
    if (th >= 0 && th <= maxDist) best = { t: th, head: true };
    if (tb >= 0 && tb <= maxDist && (!best || tb < best.t - 0.05)) best = { t: tb, head: false };
    return best;
  }

  update(dt: number, ctx: EnemyContext): void {
    if (this.state === 'dead') {
      this.deadT += dt;
      this.rig.pose(this.poseInput(dt, Math.min(1, this.deadT * 1.7)));
      this.sync(ctx);
      return;
    }

    this.fireT = Math.max(0, this.fireT - dt);
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.flash = Math.max(0, this.flash - dt * 5);
    this.timeSinceSeen += dt;

    // ---- perception (staggered)
    this.perceiveT -= dt;
    if (this.perceiveT <= 0) {
      this.perceiveT = 0.12;
      this.perceive(0.12, ctx);
    }

    // ---- behaviour
    let moveTarget: THREE.Vector3 | null = null;
    let wantSpeed = this.stats.walk;
    let faceTarget: THREE.Vector3 | null = null;
    const fixed = this.spawn.fixedY !== undefined;

    switch (this.state) {
      case 'guard': {
        this.lookAround += dt;
        const base = this.spawn.facing ?? 0;
        this.yaw = dampAngle(this.yaw, base + Math.sin(this.lookAround * 0.35 + this.uid) * 0.9, 2, dt);
        const home = this.tmp.set(this.spawn.x, 0, this.spawn.z);
        if (!fixed && Math.hypot(home.x - this.pos.x, home.z - this.pos.z) > 1.2) {
          moveTarget = home.clone();
        }
        break;
      }
      case 'patrol': {
        const wp = this.spawn.patrol[this.patrolIdx];
        this.tmp.set(wp[0], 0, wp[1]);
        if (Math.hypot(this.tmp.x - this.pos.x, this.tmp.z - this.pos.z) < 1.2) {
          this.waitT += dt;
          if (this.waitT > 1.5 + (this.uid % 3)) {
            this.waitT = 0;
            this.patrolIdx = (this.patrolIdx + 1) % this.spawn.patrol.length;
          }
        } else {
          moveTarget = this.tmp.clone();
        }
        break;
      }
      case 'suspicious': {
        this.rig.drawRifle();
        faceTarget = this.lastKnown;
        this.searchT -= dt;
        if (this.awareness > 0.55 && !fixed) {
          moveTarget = this.lastKnown;
          wantSpeed = this.stats.walk * 1.2;
        }
        if (this.awareness <= 0.02 && this.searchT <= 0) {
          this.state = 'return';
          this.rig.holsterRifle();
        }
        break;
      }
      case 'alert': {
        this.rig.drawRifle();
        const d = Math.hypot(ctx.playerPos.x - this.pos.x, ctx.playerPos.z - this.pos.z);
        if (ctx.playerDead) {
          this.pacify();
          break;
        }
        if (this.seesPlayer) {
          faceTarget = ctx.playerPos;
          this.aimT += dt;
          if (d > 30 && !fixed) {
            moveTarget = ctx.playerPos;
            wantSpeed = this.stats.run * 0.75;
          } else if (d < 2.0 && !fixed) {
            // melee range: rifle-butt strike
            if (this.meleeCd <= 0) {
              this.meleeCd = 1.6;
              this.meleeT = 0;
              this.onMelee?.(this);
            }
          } else if (this.aimT > 0.7 && this.fireT <= 0) {
            this.fire(ctx, d);
          }
        } else {
          this.aimT = 0;
          if (!fixed) {
            moveTarget = this.lastKnown;
            wantSpeed = this.stats.run;
          }
          faceTarget = this.lastKnown;
          if (this.timeSinceSeen > 9) {
            this.state = 'search';
            this.searchT = 16;
            this.searchPoint.copy(this.lastKnown);
          }
        }
        break;
      }
      case 'search': {
        this.searchT -= dt;
        if (!fixed) {
          if (Math.hypot(this.searchPoint.x - this.pos.x, this.searchPoint.z - this.pos.z) < 1.5) {
            const a = ctx.rng() * Math.PI * 2;
            const r = 4 + ctx.rng() * 9;
            this.searchPoint.set(this.lastKnown.x + Math.cos(a) * r, 0, this.lastKnown.z + Math.sin(a) * r);
            if (!ctx.nav.isWalkable(this.searchPoint.x, this.searchPoint.z)) this.searchPoint.copy(this.lastKnown);
          }
          moveTarget = this.searchPoint;
          wantSpeed = this.stats.walk * 1.4;
        } else {
          this.yaw += dt * 0.8;
        }
        if (this.searchT <= 0) {
          this.state = 'return';
          this.rig.holsterRifle();
        }
        break;
      }
      case 'return': {
        this.tmp.set(this.spawn.x, 0, this.spawn.z);
        if (fixed || Math.hypot(this.tmp.x - this.pos.x, this.tmp.z - this.pos.z) < 1.5) {
          this.state = this.spawn.patrol.length > 1 ? 'patrol' : 'guard';
          this.patrolIdx = 0;
        } else moveTarget = this.tmp.clone();
        break;
      }
    }

    // ---- locomotion
    this.speed = 0;
    if (moveTarget && !fixed && this.meleeT < 0) {
      const next = this.steer(moveTarget, ctx, dt);
      if (next) {
        const dx = next.x - this.pos.x;
        const dz = next.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.05) {
          const step = Math.min(d, wantSpeed * dt);
          this.pos.x += (dx / d) * step;
          this.pos.z += (dz / d) * step;
          this.speed = wantSpeed;
          if (!faceTarget || !this.seesPlayer) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 8, dt);
        }
      }
      ctx.collision.resolveCircle(this.pos, 0.36, 1.75);
      // stuck detection → re-path / side-step
      if (this.lastPos.distanceTo(this.pos) < wantSpeed * dt * 0.2) {
        this.stuckT += dt;
        if (this.stuckT > 1.2) {
          this.stuckT = 0;
          this.path = [];
          this.pathTarget.set(Infinity, 0, 0);
          if (this.state === 'patrol') this.patrolIdx = (this.patrolIdx + 1) % this.spawn.patrol.length;
        }
      } else this.stuckT = 0;
    }
    this.lastPos.copy(this.pos);
    if (faceTarget) this.yaw = dampAngle(this.yaw, Math.atan2(faceTarget.x - this.pos.x, faceTarget.z - this.pos.z), 7, dt);

    if (this.meleeT >= 0) {
      this.meleeT += dt / 0.6;
      if (this.meleeT >= 1) this.meleeT = -1;
    }

    this.rig.setFlash(this.flash);
    this.rig.pose(this.poseInput(dt, 0));
    this.sync(ctx);
  }

  private poseInput(dt: number, dead: number) {
    const aiming = this.state === 'alert' && this.seesPlayer ? 1 : this.state === 'suspicious' ? 0.4 : 0;
    return {
      dt,
      speed: this.speed,
      crouch: 0,
      aim: this.rig.hasRifleInHands ? aiming : 0,
      melee: this.meleeT,
      flinch: this.flinch,
      dead,
      sitting: false,
      lookPitch: 0,
      talk: 0,
      reload: -1,
      interact: 0,
    };
  }

  private sync(ctx: EnemyContext): void {
    if (this.spawn.fixedY !== undefined) this.pos.y = this.spawn.fixedY;
    else this.pos.y = ctx.terrain.getHeight(this.pos.x, this.pos.z);
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
  }

  private perceive(dt: number, ctx: EnemyContext): void {
    this.seesPlayer = false;
    if (ctx.playerDead) {
      this.awareness = Math.max(0, this.awareness - dt);
      return;
    }
    this.eye.set(this.pos.x, this.pos.y + 1.62, this.pos.z);
    const dx = ctx.playerPos.x - this.pos.x;
    const dz = ctx.playerPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const nightMul = 1 - ctx.night * 0.58;
    let range = this.stats.sight * nightMul * (this.spawn.rank === 'sentry' ? 1.3 : 1);
    range *= ctx.playerStealth * (ctx.playerConcealed ? 0.45 : 1);
    if (this.state === 'alert') range = Math.max(range, 55 * nightMul + 10);
    const angle = Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz)));
    const fov = this.state === 'alert' ? Math.PI : 1.05; // half-angle
    const close = dist < 2.6 && ctx.playerStealth > 0.75; // hears/feels you next to them unless you sneak (crouch)

    let visible = false;
    if ((dist < range && angle < fov) || close) {
      // line of sight to head or chest
      if (ctx.collision.raycast(this.eye, ctx.playerHead, true) < 0 && ctx.terrain.raycastSegment(this.eye, ctx.playerHead, 2) < 0) visible = true;
      else if (ctx.collision.raycast(this.eye, ctx.playerChest, true) < 0 && ctx.terrain.raycastSegment(this.eye, ctx.playerChest, 2) < 0) visible = true;
    }

    if (visible) {
      this.seesPlayer = true;
      this.timeSinceSeen = 0;
      this.lastKnown.copy(ctx.playerPos);
      const proximity = 1 - clamp(dist / Math.max(range, 1), 0, 1);
      const rate = 0.35 + proximity * proximity * 3.2 + (close ? 4 : 0);
      this.awareness = Math.min(1, this.awareness + rate * dt * (this.state === 'suspicious' ? 1.4 : 1));
      if (this.awareness >= 1 && this.state !== 'alert') this.becomeAlert();
      else if (this.awareness > 0.3 && (this.state === 'patrol' || this.state === 'guard' || this.state === 'return' || this.state === 'search')) {
        this.state = 'suspicious';
        this.searchT = 5;
      }
    } else if (this.state !== 'alert') {
      this.awareness = Math.max(0, this.awareness - dt * 0.18);
    }
  }

  private becomeAlert(shout = true): void {
    if (this.state === 'dead') return;
    const was = this.state;
    this.state = 'alert';
    this.awareness = 1;
    this.aimT = 0;
    this.fireT = Math.max(this.fireT, 0.4);
    this.rig.drawRifle();
    if (was !== 'alert' && shout) this.onAlert?.(this);
  }

  private fire(ctx: EnemyContext, dist: number): void {
    const [a, b] = this.stats.cooldown;
    const pistol = this.spawn.rank === 'officer';
    this.fireT = pistol ? 0.9 + ctx.rng() * 0.6 : a + ctx.rng() * (b - a);
    let chance = this.stats.acc + (this.spawn.rank === 'sentry' ? 0.12 : 0);
    chance *= clamp(1.25 - dist / 50, 0.25, 1.2);
    chance *= 1 - ctx.night * 0.35;
    chance *= ctx.playerStealth < 0.7 ? 0.7 : 1; // crouched behind cover is harder to hit
    this.rig.muzzleWorld(this.tmp);
    this.onShoot?.({ enemy: this, from: this.tmp.clone(), hitChance: clamp(chance, 0.05, 0.9), damage: pistol ? 14 : this.stats.dmg });
  }

  /** Waypoint steering with budgeted nav paths. */
  private steer(target: THREE.Vector3, ctx: EnemyContext, dt: number): THREE.Vector3 | null {
    this.repathT -= dt;
    const direct = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
    if (direct < 0.4) return null;
    const moved = this.pathTarget.distanceTo(this.tmp.set(target.x, 0, target.z)) > 3;
    if ((this.path.length === 0 || moved || this.repathT <= 0) && ctx.pathBudget.left > 0) {
      ctx.pathBudget.left -= 1;
      this.repathT = this.state === 'alert' ? 0.9 : 3;
      this.pathTarget.set(target.x, 0, target.z);
      const p = ctx.nav.findPath(this.pos.x, this.pos.z, target.x, target.z, this.state === 'alert' ? 6000 : 3000);
      this.path = p ?? [[target.x, target.z]];
      this.pathIdx = 0;
    }
    if (this.path.length === 0) return target;
    while (this.pathIdx < this.path.length - 1) {
      const [px, pz] = this.path[this.pathIdx];
      if (Math.hypot(px - this.pos.x, pz - this.pos.z) < 0.9) this.pathIdx += 1;
      else break;
    }
    const [px, pz] = this.path[Math.min(this.pathIdx, this.path.length - 1)];
    return this.eye.set(px, 0, pz);
  }
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

function rayCylinder(o: THREE.Vector3, d: THREE.Vector3, cx: number, cz: number, r: number, y0: number, y1: number): number {
  const ox = o.x - cx;
  const oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return -1;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return -1;
  const y = o.y + d.y * t;
  if (y < y0 || y > y1) return -1;
  return t;
}
