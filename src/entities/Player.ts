import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { ItemId } from '../game/types';
import { clamp, dampAngle } from '../utils/noise';
import type { CollisionWorld } from '../world/Collision';
import type { Terrain } from '../world/Terrain';
import { CharacterRig } from './CharacterRig';

export type Weapon = 'blade' | 'rifle';
export type Skill = 'stealth' | 'marksman' | 'endurance';

export const TUNING = {
  runSpeed: 3.5,
  crouchSpeed: 1.7,
  sprintSpeed: 6.3,
  aimSpeed: 2.0,
  accel: 14,
  jumpSpeed: 5.2,
  gravity: 16,
  radius: 0.36,
  height: 1.78,
  hungerPerSec: 100 / 720,
  thirstPerSec: 100 / 480,
  sprintStaminaPerSec: 16,
  staminaRegen: 22,
  clipSize: 5,
  reloadTime: 2.3,
  fireInterval: 1.05,
  waterCharges: 4,
};

export const XP_LEVELS = [0, 60, 150, 280, 450, 680, 960, 1300, 1700];

/**
 * The fidāʾī: movement, survival meters, inventory, weapons and progression.
 * Combat resolution lives in Combat; Player only owns its own state.
 */
export class Player {
  readonly rig = new CharacterRig('fidai', { rifle: true });
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  vy = 0;
  grounded = true;
  crouched = false;
  crouchAmt = 0;
  sprinting = false;
  aiming = false;
  aimAmt = 0;
  moveSpeed = 0;

  health = 100;
  stamina = 100;
  hunger = 85;
  thirst = 70;
  dead = false;
  deathT = 0;
  causeOfDeath = '';
  lastDamageAt = -99;
  healPool = 0;
  flinch = 0;
  flash = 0;

  weapon: Weapon = 'blade';
  clip = 3;
  meleeT = -1;
  meleeHitDone = false;
  fireCooldown = 0;
  reloadT = -1;
  interactT = 0;

  inventory: Record<ItemId, number> = { bread: 1, dates: 2, herbs: 0, ammo: 7, leaflet: 0, key: 0, water: 1 };
  xp = 0;
  level = 1;
  skillPoints = 0;
  skills: Record<Skill, number> = { stealth: 0, marksman: 0, endurance: 0 };

  /** Footstep event fired by the animation phase */
  onFootstep: ((surfaceLoud: number) => void) | null = null;
  private stepPhase = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly move = new THREE.Vector2();

  get maxHealth(): number {
    return 100 + this.skills.endurance * 15;
  }

  get maxStamina(): number {
    return 100 + this.skills.endurance * 20;
  }

  get group(): THREE.Group {
    return this.rig.root;
  }

  spawn(at: THREE.Vector3, yaw: number): void {
    this.pos.copy(at);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.vy = 0;
    this.dead = false;
    this.deathT = 0;
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.meleeT = -1;
    this.reloadT = -1;
    this.flinch = 0;
    this.crouched = false;
    this.aiming = false;
    this.setWeapon('blade');
    this.syncTransform();
  }

  setWeapon(w: Weapon): void {
    this.weapon = w;
    if (w === 'rifle') {
      this.rig.sheathBlade();
      this.rig.drawRifle();
    } else {
      this.rig.holsterRifle();
      this.rig.drawBlade();
    }
  }

  /** Movement + survival tick. `blocked` = menus/dialogue, no gameplay input. */
  update(dt: number, input: Input, cameraYaw: number, terrain: Terrain, collision: CollisionWorld, blocked: boolean, now: number): void {
    if (this.dead) {
      this.deathT += dt;
      this.rig.pose({ dt, speed: 0, crouch: 0, aim: 0, melee: -1, flinch: 0, dead: Math.min(1, this.deathT * 1.6), sitting: false, lookPitch: 0, talk: 0, reload: -1, interact: 0 });
      this.syncTransform();
      return;
    }

    // ---- intents
    this.move.set(0, 0);
    if (!blocked) {
      if (input.isHeld('forward')) this.move.y += 1;
      if (input.isHeld('back')) this.move.y -= 1;
      if (input.isHeld('left')) this.move.x -= 1;
      if (input.isHeld('right')) this.move.x += 1;
      if (input.wasPressed('crouch')) this.crouched = !this.crouched;
    }
    if (this.move.lengthSq() > 1) this.move.normalize();
    const moving = this.move.lengthSq() > 0.01;
    this.aiming = !blocked && input.isHeld('aim') && this.reloadT < 0;
    const wantSprint = !blocked && input.isHeld('sprint') && moving && !this.aiming && this.stamina > 2 && this.move.y > -0.2;
    this.sprinting = wantSprint;
    if (this.sprinting && this.crouched) this.crouched = false;

    // ---- speed
    let target = TUNING.runSpeed;
    if (this.crouched) target = TUNING.crouchSpeed;
    if (this.aiming) target = Math.min(target, TUNING.aimSpeed);
    if (this.sprinting) target = TUNING.sprintSpeed;
    if (this.hunger <= 0 || this.thirst <= 0) target *= 0.8;
    if (this.meleeT >= 0) target *= 0.5;

    // camera-relative direction: forward = -Z rotated by cameraYaw
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const fx = -sin;
    const fz = -cos;
    const rx = cos;
    const rz = -sin;
    const dx = fx * this.move.y + rx * this.move.x;
    const dz = fz * this.move.y + rz * this.move.x;
    const k = 1 - Math.exp(-TUNING.accel * dt);
    this.vel.x += (dx * target - this.vel.x) * k;
    this.vel.z += (dz * target - this.vel.z) * k;

    // ---- facing
    if (this.aiming || this.weapon === 'rifle' && input.isHeld('attack')) {
      this.yaw = dampAngle(this.yaw, cameraYaw + Math.PI, 20, dt);
    } else if (moving) {
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 11, dt);
    }

    // ---- jump & gravity
    if (!blocked && input.wasPressed('jump') && this.grounded && !this.crouched && this.stamina > 10) {
      this.vy = TUNING.jumpSpeed;
      this.grounded = false;
      this.stamina -= 8;
    }
    this.vy -= TUNING.gravity * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vy * dt;
    collision.resolveCircle(this.pos, TUNING.radius, this.crouched ? 1.1 : TUNING.height);
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 236) {
      this.pos.x *= 236 / r;
      this.pos.z *= 236 / r;
    }
    // steep slopes push back
    const ground = terrain.getHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      if (!this.grounded && this.vy < -7) this.onFootstep?.(1.4);
      this.pos.y = ground;
      this.vy = 0;
      this.grounded = true;
    } else if (this.pos.y > ground + 0.05) {
      this.grounded = false;
    }
    if (terrain.getSlope(this.pos.x, this.pos.z) > 1.15) {
      terrain.normalAt(this.pos.x, this.pos.z, this.tmp);
      this.pos.x += this.tmp.x * dt * 4;
      this.pos.z += this.tmp.z * dt * 4;
    }

    this.moveSpeed = Math.hypot(this.vel.x, this.vel.z);

    // ---- stamina & survival
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - TUNING.sprintStaminaPerSec * dt);
    else if (this.meleeT < 0) this.stamina = Math.min(this.maxStamina, this.stamina + TUNING.staminaRegen * dt * (this.hunger > 20 ? 1 : 0.4));
    this.hunger = Math.max(0, this.hunger - TUNING.hungerPerSec * dt * (this.sprinting ? 1.4 : 1));
    this.thirst = Math.max(0, this.thirst - TUNING.thirstPerSec * dt * (this.sprinting ? 1.7 : 1));
    if (this.hunger <= 0 || this.thirst <= 0) {
      this.damage(1.25 * dt, this.thirst <= 0 ? 'Thirst' : 'Hunger', now, false);
    } else if (this.hunger > 40 && this.thirst > 40 && now - this.lastDamageAt > 8) {
      this.health = Math.min(this.maxHealth, this.health + 0.9 * dt);
    }
    if (this.healPool > 0) {
      const h = Math.min(this.healPool, 7 * dt);
      this.healPool -= h;
      this.health = Math.min(this.maxHealth, this.health + h);
    }

    // ---- timers
    this.crouchAmt += ((this.crouched ? 1 : 0) - this.crouchAmt) * (1 - Math.exp(-10 * dt));
    this.aimAmt += ((this.aiming && this.weapon === 'rifle' ? 1 : 0) - this.aimAmt) * (1 - Math.exp(-14 * dt));
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.flash = Math.max(0, this.flash - dt * 5);
    if (this.meleeT >= 0) {
      this.meleeT += dt / 0.55;
      if (this.meleeT >= 1) this.meleeT = -1;
    }
    if (this.reloadT >= 0) {
      this.reloadT += dt / TUNING.reloadTime;
      if (this.reloadT >= 1) {
        this.reloadT = -1;
        const need = TUNING.clipSize - this.clip;
        const take = Math.min(need, this.inventory.ammo);
        this.clip += take;
        this.inventory.ammo -= take;
      }
    }

    // ---- footsteps
    const prev = this.stepPhase;
    this.stepPhase += dt * this.moveSpeed / 1.1;
    if (this.grounded && Math.floor(prev) !== Math.floor(this.stepPhase) && this.moveSpeed > 0.6) {
      this.onFootstep?.(this.sprinting ? 1 : this.crouched ? 0.25 : 0.6);
    }

    this.rig.setFlash(this.flash);
    this.rig.pose({
      dt,
      speed: this.moveSpeed,
      crouch: this.crouchAmt,
      aim: this.aimAmt,
      melee: this.meleeT,
      flinch: this.flinch,
      dead: 0,
      sitting: false,
      lookPitch: 0,
      talk: 0,
      reload: this.reloadT,
      interact: this.interactT,
    });
    this.syncTransform();
  }

  syncTransform(): void {
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
  }

  damage(amount: number, cause: string, now: number, flinch = true): void {
    if (this.dead) return;
    this.health -= amount;
    this.lastDamageAt = now;
    if (flinch) {
      this.flinch = 1;
      this.flash = 1;
    }
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathT = 0;
      this.causeOfDeath = cause;
    }
  }

  /** Head-ish point other characters aim at / look for. */
  chestPoint(target: THREE.Vector3): THREE.Vector3 {
    return target.set(this.pos.x, this.pos.y + (this.crouched ? 0.85 : 1.3), this.pos.z);
  }

  headPoint(target: THREE.Vector3): THREE.Vector3 {
    return target.set(this.pos.x, this.pos.y + (this.crouched ? 1.15 : 1.65), this.pos.z);
  }

  gainXp(amount: number): boolean {
    this.xp += amount;
    let leveled = false;
    while (this.level < XP_LEVELS.length && this.xp >= XP_LEVELS[this.level]) {
      this.level += 1;
      this.skillPoints += 1;
      leveled = true;
    }
    return leveled;
  }

  xpProgress(): number {
    if (this.level >= XP_LEVELS.length) return 1;
    const a = XP_LEVELS[this.level - 1];
    const b = XP_LEVELS[this.level];
    return clamp((this.xp - a) / (b - a), 0, 1);
  }

  /** Detection multiplier from posture and skill (environment applied by AI). */
  stealthFactor(): number {
    let f = 1;
    if (this.crouched) f *= 0.55;
    if (this.sprinting) f *= 1.35;
    f *= 1 - this.skills.stealth * 0.12;
    return f;
  }
}
