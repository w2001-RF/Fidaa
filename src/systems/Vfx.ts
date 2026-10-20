import * as THREE from 'three';
import { createSeededRandom } from '../utils/random';

type VfxKind = 'dust' | 'blood' | 'spark' | 'smoke' | 'glint';
// Cosmetic randomness stays seeded so paused screenshots and bot runs are reproducible.
const rand = createSeededRandom(4242);

type Particle = {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  grow: number;
  gravity: number;
  active: boolean;
  baseScale: number;
};

type Tracer = { line: THREE.Mesh; life: number; active: boolean };

/**
 * Pooled, event-driven VFX: muzzle flash + light, tracers, dust & blood puffs,
 * sparks for sabotage, pickup glints, objective beacon.
 */
export class Vfx {
  readonly group = new THREE.Group();
  private readonly particles: Particle[] = [];
  private readonly tracers: Tracer[] = [];
  private readonly flashLight = new THREE.PointLight('#ffb35a', 0, 14, 2);
  private flashT = 0;
  private readonly flashSprite: THREE.Mesh;
  private readonly puffGeo = new THREE.IcosahedronGeometry(0.18, 0);
  private readonly sparkGeo = new THREE.BoxGeometry(0.04, 0.04, 0.16);
  private readonly mats: Record<VfxKind, THREE.MeshBasicMaterial>;
  readonly beacon: THREE.Group;
  private readonly beaconMat: THREE.MeshBasicMaterial;

  constructor() {
    this.group.name = 'vfx';
    const m = (color: string, opacity: number, additive = false) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.mats = {
      dust: m('#c9a57a', 0.55),
      blood: m('#6e0e0e', 0.85),
      spark: m('#ffd27a', 1, true),
      smoke: m('#d9d4cc', 0.35),
      glint: m('#fff0b0', 0.9, true),
    };
    for (let i = 0; i < 120; i += 1) {
      const mesh = new THREE.Mesh(this.puffGeo, this.mats.dust);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.particles.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 1, grow: 1, gravity: 0, active: false, baseScale: 1 });
    }
    const tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true);
    tracerGeo.translate(0, 0.5, 0);
    tracerGeo.rotateX(Math.PI / 2);
    const tracerMat = new THREE.MeshBasicMaterial({ color: '#ffe2a0', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 16; i += 1) {
      const line = new THREE.Mesh(tracerGeo, tracerMat.clone());
      line.visible = false;
      line.frustumCulled = false;
      this.group.add(line);
      this.tracers.push({ line, life: 0, active: false });
    }
    this.flashSprite = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ffd090', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.group.add(this.flashLight, this.flashSprite);

    // Objective beacon: tall soft column + ring on the ground
    this.beacon = new THREE.Group();
    this.beaconMat = new THREE.MeshBasicMaterial({ color: '#f2c14e', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.45, 60, 12, 1, true), this.beaconMat);
    col.position.y = 30;
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.75, 40), this.beaconMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    this.beacon.add(col, ring);
    this.beacon.visible = false;
    this.group.add(this.beacon);
  }

  muzzle(at: THREE.Vector3, dir: THREE.Vector3): void {
    this.flashT = 0.06;
    this.flashLight.position.copy(at);
    this.flashSprite.position.copy(at);
    for (let i = 0; i < 4; i += 1) {
      this.spawn('smoke', at, new THREE.Vector3(dir.x * 1.5 + (rand() - 0.5) * 0.5, 0.5 + rand() * 0.4, dir.z * 1.5 + (rand() - 0.5) * 0.5), 1.2, 2.2, -0.3, 0.6);
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const t = this.tracers.find((x) => !x.active) ?? this.tracers[0];
    t.active = true;
    t.life = 0.09;
    t.line.visible = true;
    t.line.position.copy(from);
    t.line.lookAt(to);
    t.line.scale.set(1, 1, from.distanceTo(to));
    (t.line.material as THREE.MeshBasicMaterial).opacity = 0.85;
  }

  impact(at: THREE.Vector3, kind: 'dust' | 'blood' | 'spark', count = 6): void {
    for (let i = 0; i < count; i += 1) {
      const v = new THREE.Vector3((rand() - 0.5) * 2.4, rand() * 2.2 + 0.4, (rand() - 0.5) * 2.4);
      if (kind === 'spark') this.spawn('spark', at, v.multiplyScalar(2.2), 0.45, 0.5, 9, 1);
      else if (kind === 'blood') this.spawn('blood', at, v.multiplyScalar(0.8), 0.35, 0.3, 9, 0.16);
      else this.spawn(kind, at, v, 0.9, 1.8, 1, 0.8);
    }
  }

  footDust(at: THREE.Vector3, strength: number): void {
    for (let i = 0; i < Math.ceil(strength * 3); i += 1) {
      this.spawn('dust', at, new THREE.Vector3((rand() - 0.5) * 0.8, 0.3 + rand() * 0.3, (rand() - 0.5) * 0.8), 0.7, 1.6, 0, 0.5 * strength + 0.2);
    }
  }

  glint(at: THREE.Vector3): void {
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      this.spawn('glint', at, new THREE.Vector3(Math.cos(a) * 1.6, 1.4 + rand(), Math.sin(a) * 1.6), 0.6, 0.2, 2, 0.35);
    }
  }

  setBeacon(pos: THREE.Vector3 | null): void {
    if (!pos) {
      this.beacon.visible = false;
      return;
    }
    this.beacon.visible = true;
    this.beacon.position.copy(pos);
  }

  update(dt: number, elapsed: number, night: number): void {
    this.flashT = Math.max(0, this.flashT - dt);
    this.flashLight.intensity = this.flashT > 0 ? 40 : 0;
    (this.flashSprite.material as THREE.MeshBasicMaterial).opacity = this.flashT > 0 ? 0.9 : 0;
    this.flashSprite.scale.setScalar(1 + rand() * 0.6);
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(1 - dt * 1.5);
      p.mesh.position.addScaledVector(p.vel, dt);
      const k = 1 - p.life / p.maxLife;
      p.mesh.scale.setScalar(p.baseScale * (1 + k * p.grow));
      if (p.mesh.material !== this.mats.spark && p.mesh.material !== this.mats.glint) p.mesh.rotation.x += dt;
      else p.mesh.lookAt(p.mesh.position.x + p.vel.x, p.mesh.position.y + p.vel.y, p.mesh.position.z + p.vel.z);
    }
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.life -= dt;
      (t.line.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / 0.09) * 0.85;
      if (t.life <= 0) {
        t.active = false;
        t.line.visible = false;
      }
    }
    if (this.beacon.visible) {
      this.beaconMat.opacity = 0.09 + Math.sin(elapsed * 3) * 0.03 + night * 0.1;
      this.beacon.children[1].scale.setScalar(1 + (elapsed % 1.5) * 0.25);
    }
  }

  private spawn(kind: VfxKind, at: THREE.Vector3, vel: THREE.Vector3, life: number, grow: number, gravity: number, scale: number): void {
    const p = this.particles.find((x) => !x.active);
    if (!p) return;
    p.active = true;
    p.mesh.visible = true;
    p.mesh.material = this.mats[kind];
    p.mesh.geometry = kind === 'spark' || kind === 'glint' ? this.sparkGeo : this.puffGeo;
    p.mesh.position.copy(at);
    p.vel.copy(vel);
    p.life = life;
    p.maxLife = life;
    p.grow = grow;
    p.gravity = gravity;
    p.baseScale = scale;
    p.mesh.scale.setScalar(scale);
  }
}
