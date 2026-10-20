import * as THREE from 'three';
import type { NpcSpawn } from '../game/types';
import { dampAngle } from '../utils/noise';
import type { CollisionWorld } from '../world/Collision';
import type { NavGrid } from '../world/NavGrid';
import type { Terrain } from '../world/Terrain';
import { CharacterRig } from './CharacterRig';

/** Friendly characters: contacts that talk, villagers, prisoners that flee once freed. */
export class Npc {
  readonly rig: CharacterRig;
  readonly pos = new THREE.Vector3();
  yaw: number;
  talking = 0;
  sitting: boolean;
  private flee: number[][] | null = null;
  private fleeIdx = 0;
  private speed = 0;
  private walkIdx = 0;
  private pauseT = 0;
  fled = false;

  constructor(readonly spawn: NpcSpawn) {
    this.rig = new CharacterRig(spawn.outfit);
    this.yaw = spawn.facing;
    this.sitting = Boolean(spawn.sitting);
    this.pos.set(spawn.x, 0, spawn.z);
  }

  reset(): void {
    this.pos.set(this.spawn.x, 0, this.spawn.z);
    this.yaw = this.spawn.facing;
    this.sitting = Boolean(this.spawn.sitting);
    this.flee = null;
    this.fled = false;
    this.walkIdx = 0;
    this.rig.root.visible = true;
  }

  /** Walk away along a nav path, then vanish (prisoners escaping to the mountains). */
  fleeTo(nav: NavGrid, x: number, z: number): void {
    this.sitting = false;
    this.flee = nav.findPath(this.pos.x, this.pos.z, x, z, 8000) ?? [[x, z]];
    this.fleeIdx = 0;
  }

  update(dt: number, terrain: Terrain, collision: CollisionWorld, playerPos: THREE.Vector3): void {
    if (this.fled) return;
    this.speed = 0;
    if (this.flee) {
      const wp = this.flee[Math.min(this.fleeIdx, this.flee.length - 1)];
      const dx = wp[0] - this.pos.x;
      const dz = wp[1] - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.9) {
        this.fleeIdx += 1;
        if (this.fleeIdx >= this.flee.length) {
          this.fled = true;
          this.rig.root.visible = false;
        }
      } else {
        const sp = 3.8;
        this.pos.x += (dx / d) * sp * dt;
        this.pos.z += (dz / d) * sp * dt;
        this.speed = sp;
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 8, dt);
        collision.resolveCircle(this.pos, 0.32, 1.7);
      }
    } else if (this.spawn.walk && this.spawn.walk.length > 1) {
      const wp = this.spawn.walk[this.walkIdx];
      const dx = wp[0] - this.pos.x;
      const dz = wp[1] - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (this.pauseT > 0) this.pauseT -= dt;
      else if (d < 0.8) {
        this.walkIdx = (this.walkIdx + 1) % this.spawn.walk.length;
        this.pauseT = 1.5 + (this.walkIdx % 3);
      } else {
        const sp = 1.15;
        this.pos.x += (dx / d) * sp * dt;
        this.pos.z += (dz / d) * sp * dt;
        this.speed = sp;
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 5, dt);
        collision.resolveCircle(this.pos, 0.3, 1.7);
      }
    } else if (!this.sitting) {
      // face the player when close
      const dx = playerPos.x - this.pos.x;
      const dz = playerPos.z - this.pos.z;
      if (dx * dx + dz * dz < 36) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 3, dt);
      else this.yaw = dampAngle(this.yaw, this.spawn.facing, 1, dt);
    }
    this.talking = Math.max(0, this.talking - dt);
    this.pos.y = terrain.getHeight(this.pos.x, this.pos.z);
    this.rig.pose({ dt, speed: this.speed, crouch: 0, aim: 0, melee: -1, flinch: 0, dead: 0, sitting: this.sitting, lookPitch: 0, talk: this.talking > 0 ? this.talking : 0, reload: -1, interact: 0 });
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
  }
}
