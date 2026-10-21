import * as THREE from 'three';
import { buildPart as part, mergeParts as merge } from './Wildlife';

const MAX = 40;
/** a spent bolt left lying about is gone after ten minutes */
const LIFETIME = 600;
const Y = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

type Drop = { pos: THREE.Vector3; q: THREE.Quaternion; age: number; live: boolean };

/**
 * Crossbow bolts after they are shot: stuck in the ground, a wall or a beam,
 * or lying by the game or the man they hit. Walk over one to pick it back up.
 * All of them are one instanced mesh, so a quiver's worth costs one draw call.
 */
export class BoltDrops {
  readonly mesh: THREE.InstancedMesh;
  private readonly drops: Drop[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor() {
    const geo = merge([
      part(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 5), '#9a7a4a', 0, 0, 0),
      part(new THREE.ConeGeometry(0.014, 0.06, 4), '#3a3a3e', 0, 0.24, 0),
      part(new THREE.BoxGeometry(0.003, 0.08, 0.035), '#e8e0d0', 0, -0.17, 0),
      part(new THREE.BoxGeometry(0.035, 0.08, 0.003), '#c42b2b', 0, -0.17, 0),
    ]);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), MAX);
    this.mesh.name = 'bolt-drops';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    for (let i = 0; i < MAX; i += 1) this.mesh.setMatrixAt(i, HIDDEN);
  }

  /**
   * Leave a bolt at `at`, flying along `dir`, its head driven a little way in.
   * The oldest one makes room when the quiver's worth is used up.
   */
  drop(at: THREE.Vector3, dir: THREE.Vector3): void {
    let slot = this.drops.findIndex((d) => !d.live);
    if (slot < 0 && this.drops.length < MAX) {
      this.drops.push({ pos: new THREE.Vector3(), q: new THREE.Quaternion(), age: 0, live: false });
      slot = this.drops.length - 1;
    }
    if (slot < 0) slot = this.drops.reduce((best, d, i) => (d.age > this.drops[best].age ? i : best), 0);
    const d = this.drops[slot];
    d.pos.copy(at).addScaledVector(dir, -0.12);
    d.q.setFromUnitVectors(Y, dir);
    d.age = 0;
    d.live = true;
    this.mesh.setMatrixAt(slot, this.m.compose(d.pos, d.q, this.one));
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Age the bolts and gather the ones the player walks over; returns how many were picked up. */
  update(dt: number, player: THREE.Vector3): number {
    let got = 0;
    this.drops.forEach((d, i) => {
      if (!d.live) return;
      d.age += dt;
      const reach = Math.hypot(d.pos.x - player.x, d.pos.z - player.z) < 1.3 && Math.abs(d.pos.y - player.y - 0.5) < 2;
      if (reach) got += 1;
      if (reach || d.age > LIFETIME) {
        d.live = false;
        this.mesh.setMatrixAt(i, HIDDEN);
        this.mesh.instanceMatrix.needsUpdate = true;
      }
    });
    return got;
  }

  get count(): number {
    return this.drops.filter((d) => d.live).length;
  }

  /** Where the bolts lie (tests, the map). */
  positions(): { x: number; y: number; z: number }[] {
    return this.drops.filter((d) => d.live).map((d) => ({ x: d.pos.x, y: d.pos.y, z: d.pos.z }));
  }
}
