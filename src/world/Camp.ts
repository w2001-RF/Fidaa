import * as THREE from 'three';
import { buildPart as part, mergeParts as merge } from '../entities/Wildlife';
import { L } from '../i18n';
import type { CampKind } from '../game/Items';
import type { Interactable } from '../game/types';
import type { Collider, CollisionWorld } from './Collision';
import { LAKE, PLAY_RADIUS } from './layout';
import type { Terrain } from './Terrain';

export type CampPiece = { kind: CampKind; x: number; z: number; yaw: number; root: THREE.Object3D; it: Interactable; collider: Collider };

/** Footprint radius of each piece, for placement. */
const SIZE: Record<CampKind, number> = { bench: 1.2, oven: 1, fire: 0.8, tent: 2.2 };

/**
 * The fidāʾī's own camps: a plank workbench, a clay tannour oven, a ring-of-
 * stones campfire and a black goat-hair khaima. Each piece is one merged mesh
 * (a single draw call), a collider, and an interactable that the game handles
 * like its fixed counterparts (bench, cooking, rest).
 */
export class Camp {
  readonly group = new THREE.Group();
  readonly pieces: CampPiece[] = [];
  static readonly MAX = 16;
  private readonly mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02 });
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0.9, toneMapped: false });
  private readonly flames: THREE.Mesh[] = [];

  constructor(
    private readonly terrain: Terrain,
    private readonly collision: CollisionWorld,
  ) {
    this.group.name = 'camp';
  }

  /** Room to set a piece down here: flat enough, dry, nothing in the way. */
  canPlace(kind: CampKind, x: number, z: number): boolean {
    if (this.pieces.length >= Camp.MAX) return false;
    if (Math.hypot(x, z) > PLAY_RADIUS - 6) return false;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.water + 1) return false;
    if (this.terrain.getSlope(x, z) > 0.45) return false;
    return !this.collision.blockedAt(x, z, SIZE[kind], this.terrain.getHeight(x, z));
  }

  place(kind: CampKind, x: number, z: number, yaw: number): CampPiece {
    const g = this.terrain.getHeight(x, z);
    const root = new THREE.Group();
    root.position.set(x, g, z);
    root.rotation.y = yaw;
    root.name = `camp-${kind}`;
    const mesh = new THREE.Mesh(this.geometry(kind), this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    if (kind === 'fire') {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 7), this.glowMat);
      flame.position.y = 0.42;
      root.add(flame);
      this.flames.push(flame);
    }
    if (kind === 'oven') {
      const ember = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.05), this.glowMat);
      ember.position.set(0, 0.32, 0.73);
      root.add(ember);
    }
    this.group.add(root);
    const n = this.pieces.length;
    const collider =
      kind === 'tent'
        ? this.collision.addBox(x, z, 1.5, 1.8, yaw, g - 1, g + 2.1, true, 'tent')
        : kind === 'bench'
          ? this.collision.addBox(x, z, 1, 0.42, yaw, g - 1, g + 0.95, false, 'bench')
          : this.collision.addCircle(x, z, kind === 'oven' ? 0.8 : 0.55, g - 1, g + (kind === 'oven' ? 1.4 : 0.5), false, kind);
    // interact from the front (the tent's door, the oven's mouth)
    const front = kind === 'tent' ? 2.3 : kind === 'bench' ? 0.9 : 1.1;
    const at = new THREE.Vector3(x + Math.sin(yaw) * front, g, z + Math.cos(yaw) * front);
    const it: Interactable =
      kind === 'bench'
        ? { id: `camp-bench-${n}`, kind: 'bench', pos: at, radius: 2, prompt: L('Use your camp workbench', 'خدم فالبنكة ديالك'), hold: 0, enabled: true }
        : kind === 'tent'
          ? { id: `camp-tent-${n}`, kind: 'rest', pos: at, radius: 2, prompt: L('Sleep in the khaima', 'نعس فالخيمة'), hold: 1.2, enabled: true }
          : {
              id: `camp-${kind}-${n}`,
              kind: 'cook',
              pos: at,
              radius: 2,
              prompt: kind === 'oven' ? L('Cook at the oven', 'طيّب فالفرّان') : L('Cook over the fire', 'طيّب على العافية'),
              hold: 0,
              enabled: true,
              ref: kind,
            };
    const piece: CampPiece = { kind, x, z, yaw, root, it, collider };
    this.pieces.push(piece);
    return piece;
  }

  /** A cooking station of this kind within reach (an oven also does what a fire does). */
  near(kind: CampKind, x: number, z: number, reach = 4): boolean {
    return this.pieces.some((p) => (p.kind === kind || (kind === 'fire' && p.kind === 'oven')) && Math.hypot(p.x - x, p.z - z) < reach);
  }

  update(elapsed: number): void {
    this.flames.forEach((f, i) => {
      const k = 1 + Math.sin(elapsed * 13 + i * 2.1) * 0.12 + Math.sin(elapsed * 7.3 + i) * 0.08;
      f.scale.set(1, k, 1);
    });
  }

  private geometry(kind: CampKind): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    if (kind === 'bench') {
      parts.push(part(new THREE.BoxGeometry(2, 0.08, 0.8), '#7a5232', 0, 0.9, 0));
      for (const [x, z] of [[-0.9, -0.32], [0.9, -0.32], [-0.9, 0.32], [0.9, 0.32]]) parts.push(part(new THREE.BoxGeometry(0.09, 0.88, 0.09), '#5a3a24', x, 0.44, z));
      parts.push(part(new THREE.BoxGeometry(1.8, 0.05, 0.6), '#6a4528', 0, 0.3, 0)); // shelf
      parts.push(part(new THREE.BoxGeometry(0.22, 0.16, 0.14), '#3a3a3c', -0.7, 1.02, 0.1)); // vise
      parts.push(part(new THREE.BoxGeometry(0.5, 0.05, 0.06), '#6b4223', 0.2, 0.96, -0.2, 0, 0.5)); // hammer handle
      parts.push(part(new THREE.BoxGeometry(0.14, 0.07, 0.1), '#4a4a4c', 0.42, 0.97, -0.08, 0, 0.5)); // hammer head
      parts.push(part(new THREE.BoxGeometry(0.6, 0.12, 0.3), '#8a6a3a', 0.4, 0.37, 0.05)); // planks on the shelf
    } else if (kind === 'oven') {
      parts.push(part(new THREE.CylinderGeometry(0.72, 0.82, 0.6, 14), '#b27a4e', 0, 0.3, 0));
      parts.push(part(new THREE.SphereGeometry(0.72, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#c08a5a', 0, 0.6, 0));
      parts.push(part(new THREE.BoxGeometry(0.46, 0.4, 0.1), '#1a1210', 0, 0.38, 0.72)); // mouth
      parts.push(part(new THREE.CylinderGeometry(0.1, 0.12, 0.35, 8), '#9a6a44', 0.2, 1.3, -0.1)); // flue
      for (let i = 0; i < 4; i += 1) parts.push(part(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 5), '#6b5038', -0.6 + i * 0.12, 0.08, 1.05, 0, 0, Math.PI / 2)); // woodpile
    } else if (kind === 'fire') {
      for (let i = 0; i < 9; i += 1) {
        const a = (i / 9) * Math.PI * 2;
        parts.push(part(new THREE.DodecahedronGeometry(0.16, 0), '#6e655c', Math.cos(a) * 0.5, 0.1, Math.sin(a) * 0.5, i, i * 2));
      }
      parts.push(part(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 6), '#3b2a1c', 0, 0.12, 0, 0, 0.4, Math.PI / 2));
      parts.push(part(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 6), '#4a3222', 0, 0.16, 0, 0, -0.6, Math.PI / 2));
      parts.push(part(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), '#2a2420', -0.55, 0.55, 0, 0, 0, 0.1)); // spit post
      parts.push(part(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), '#2a2420', 0.55, 0.55, 0, 0, 0, -0.1));
      parts.push(part(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 5), '#5a5048', 0, 1.05, 0, 0, 0, Math.PI / 2)); // spit
      parts.push(part(new THREE.CylinderGeometry(0.16, 0.2, 0.22, 10), '#2a2a2c', 0.85, 0.11, 0.2)); // teapot on a stone
    } else {
      // khaima: black goat-hair cloth over poles, a rug at the door
      parts.push(part(new THREE.ConeGeometry(2, 1.9, 4, 1, true), '#2a211c', 0, 0.95, 0, 0, Math.PI / 4, 0, 1, 1, 1.3));
      parts.push(part(new THREE.BoxGeometry(2.4, 0.04, 1.6), '#8a2b22', 0, 0.02, 1.7));
      parts.push(part(new THREE.BoxGeometry(1.6, 0.05, 1), '#c48a2a', 0, 0.03, 1.7));
      parts.push(part(new THREE.CylinderGeometry(0.04, 0.04, 2.1, 5), '#5a3a24', 0, 1.05, 1.15));
      parts.push(part(new THREE.BoxGeometry(0.9, 1.3, 0.04), '#14100c', 0, 0.6, 1.2)); // the dark doorway
    }
    return merge(parts);
  }
}
