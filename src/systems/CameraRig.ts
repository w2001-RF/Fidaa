import * as THREE from 'three';
import { clamp } from '../utils/noise';
import type { CollisionWorld } from '../world/Collision';
import type { Terrain } from '../world/Terrain';

const TRAUMA_DECAY = 1.5;
const MAX_OFFSET = 0.35;
const MAX_ROLL = 0.06;

function pseudoNoise(t: number, seed: number): number {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Over-the-shoulder orbit camera with aim zoom, collision against walls and
 * terrain, trauma² shake and an additive FOV punch.
 */
export class CameraRig {
  yaw = 0;
  pitch = 0.18;
  sensitivity = 0.0024;
  private dist = 4.2;
  private trauma = 0;
  private time = 0;
  private fovPunch = 0;
  private baseFov = 58;
  reducedMotion = false;
  /** extra follow distance and height while riding or driving */
  rideDistance = 0;
  rideHeight = 0;
  private readonly pivot = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly smoothPivot = new THREE.Vector3();
  private initialized = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  look(dx: number, dy: number): void {
    this.yaw -= dx * this.sensitivity;
    this.pitch = clamp(this.pitch + dy * this.sensitivity, -0.95, 1.2);
  }

  addTrauma(a: number): void {
    if (this.reducedMotion) return;
    this.trauma = Math.min(1, this.trauma + a);
  }

  punchFov(deg: number): void {
    if (this.reducedMotion) return;
    this.fovPunch = Math.min(10, this.fovPunch + deg);
  }

  forward(target: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return target.set(-Math.sin(this.yaw) * cp, -Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  snap(): void {
    this.initialized = false;
  }

  update(dt: number, player: THREE.Vector3, crouch: number, aim: number, sprint: boolean, collision: CollisionWorld, terrain: Terrain): void {
    this.time += dt;
    this.pivot.set(player.x, player.y + 1.58 - crouch * 0.5 + this.rideHeight, player.z);
    if (!this.initialized) {
      this.smoothPivot.copy(this.pivot);
      this.initialized = true;
    } else {
      this.smoothPivot.lerp(this.pivot, 1 - Math.exp(-dt * 18));
      this.smoothPivot.y += (this.pivot.y - this.smoothPivot.y) * (1 - Math.exp(-dt * 8));
    }
    this.forward(this.fwd);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const wantDist = THREE.MathUtils.lerp(4.2, 1.75, aim) + (sprint ? 0.4 : 0) + this.rideDistance;
    const shoulder = THREE.MathUtils.lerp(0.72, 0.6, aim);
    const base = this.smoothPivot;
    const shoulderPt = this.desired.copy(base).addScaledVector(this.right, shoulder);
    const target = shoulderPt.clone().addScaledVector(this.fwd, -wantDist);

    // collision: pull in when blocked
    let t = collision.raycast(base, target, false);
    const tt = terrain.raycastSegment(base, target, 0.5);
    if (tt >= 0 && (t < 0 || tt < t)) t = tt;
    let allowed = wantDist;
    if (t >= 0) allowed = Math.max(0.35, base.distanceTo(target) * t - 0.25);
    if (allowed < this.dist) this.dist = allowed;
    else this.dist += (allowed - this.dist) * (1 - Math.exp(-dt * 4));

    const cam = this.camera;
    cam.position.copy(shoulderPt).addScaledVector(this.fwd, -this.dist);
    const groundY = terrain.getHeight(cam.position.x, cam.position.z) + 0.3;
    if (cam.position.y < groundY) cam.position.y = groundY;
    cam.lookAt(this.desired.copy(shoulderPt).addScaledVector(this.fwd, 10));

    // shake
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma;
      const f = this.time * 30;
      cam.position.x += MAX_OFFSET * s * pseudoNoise(f, 1);
      cam.position.y += MAX_OFFSET * s * pseudoNoise(f, 2);
      cam.rotation.z += MAX_ROLL * s * pseudoNoise(f, 3);
    }

    // FOV: aim zoom + punch
    this.fovPunch *= Math.exp(-dt / 0.2);
    const fov = THREE.MathUtils.lerp(this.baseFov, 40, aim) + (sprint ? 4 : 0) + this.fovPunch;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 12));
      cam.updateProjectionMatrix();
    }
  }
}
