import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from '../utils/noise';

export type Outfit =
  | 'fidai'
  | 'french'
  | 'lieutenant'
  | 'mokhazni'
  | 'khalifa'
  | 'zahra'
  | 'lahcen'
  | 'villager'
  | 'villagerF'
  | 'prisoner';

// Bone indices
const ROOT = 0, HIPS = 1, SPINE = 2, CHEST = 3, NECK = 4, HEAD = 5;
const UARM_L = 6, FARM_L = 7, HAND_L = 8, UARM_R = 9, FARM_R = 10, HAND_R = 11;
const THIGH_L = 12, SHIN_L = 13, FOOT_L = 14, THIGH_R = 15, SHIN_R = 16, FOOT_R = 17;

const BONE_DEFS: [number, number, number, number][] = [
  // parent, x, y, z (offset from parent)
  [-1, 0, 0, 0],
  [ROOT, 0, 0.98, 0],
  [HIPS, 0, 0.16, 0],
  [SPINE, 0, 0.24, 0],
  [CHEST, 0, 0.2, 0],
  [NECK, 0, 0.1, 0],
  [CHEST, 0.21, 0.15, 0],
  [UARM_L, 0, -0.29, 0],
  [FARM_L, 0, -0.26, 0],
  [CHEST, -0.21, 0.15, 0],
  [UARM_R, 0, -0.29, 0],
  [FARM_R, 0, -0.26, 0],
  [HIPS, 0.1, -0.04, 0],
  [THIGH_L, 0, -0.44, 0],
  [SHIN_L, 0, -0.44, 0],
  [HIPS, -0.1, -0.04, 0],
  [THIGH_R, 0, -0.44, 0],
  [SHIN_R, 0, -0.44, 0],
];

type Palette = {
  skin: string;
  torso: string;
  sleeve: string;
  skirt?: { color: string; length: number; top: number; bottom: number };
  legs: string;
  shin?: string;
  feet: string;
  belt?: string;
  head: 'hood' | 'kepi' | 'kepiOfficer' | 'turban' | 'fez' | 'scarf' | 'haik' | 'bare' | 'hoodDown';
  headColor?: string;
  beard?: string;
  extra?: ('bandolier' | 'pouches' | 'cloak' | 'satchel' | 'samBrowne' | 'dagger')[];
  cloak?: string;
};

const PALETTES: Record<Outfit, Palette> = {
  fidai: {
    skin: '#a8714c', torso: '#6a4c33', sleeve: '#6a4c33',
    skirt: { color: '#644731', length: 0.78, top: 0.2, bottom: 0.31 },
    legs: '#d8d0bd', feet: '#d1a64a', belt: '#8c2a22', head: 'hood', headColor: '#5f432c', beard: '#24170f',
    extra: ['bandolier', 'satchel', 'dagger'],
  },
  french: {
    skin: '#d8a888', torso: '#8b7f55', sleeve: '#857a50', legs: '#7f744d', shin: '#6b6346', feet: '#2b2018', belt: '#4a3523',
    head: 'kepi', headColor: '#a19366', extra: ['pouches'],
    skirt: { color: '#877b52', length: 0.22, top: 0.19, bottom: 0.22 },
  },
  lieutenant: {
    skin: '#e0b090', torso: '#6c6443', sleeve: '#6c6443', legs: '#6b6346', shin: '#3a2a1c', feet: '#20160f', belt: '#3a2618',
    head: 'kepiOfficer', headColor: '#1f2a4a', extra: ['samBrowne'], beard: '#5a4030',
    skirt: { color: '#665e40', length: 0.34, top: 0.19, bottom: 0.25 },
  },
  mokhazni: {
    skin: '#9c6845', torso: '#1f2a44', sleeve: '#d9d3c4', legs: '#d9d3c4', feet: '#5a3a22', belt: '#9a2a1f',
    skirt: { color: '#1d2740', length: 0.86, top: 0.21, bottom: 0.36 },
    head: 'turban', headColor: '#ebe6da', beard: '#1d140e', extra: ['cloak', 'pouches'], cloak: '#1b2440',
  },
  khalifa: {
    skin: '#a57250', torso: '#efeadf', sleeve: '#efeadf', legs: '#efeadf', feet: '#e0c25a', belt: '#b08a3a',
    skirt: { color: '#ede7da', length: 0.9, top: 0.21, bottom: 0.36 },
    head: 'fez', headColor: '#a51d1d', beard: '#2a1d14', extra: ['cloak', 'dagger'], cloak: '#2f5a3e',
  },
  zahra: {
    skin: '#b07a55', torso: '#3b3f7a', sleeve: '#3b3f7a', legs: '#3b3f7a', feet: '#b0302a', belt: '#d1a64a',
    skirt: { color: '#363a72', length: 0.94, top: 0.2, bottom: 0.36 },
    head: 'scarf', headColor: '#a0384a',
  },
  lahcen: {
    skin: '#9c6a48', torso: '#77746a', sleeve: '#77746a', legs: '#d8d0bd', feet: '#d1a64a',
    skirt: { color: '#716e64', length: 0.82, top: 0.2, bottom: 0.32 },
    head: 'hoodDown', headColor: '#ebe6da', beard: '#c9c2b5', belt: '#4a3523',
  },
  villager: {
    skin: '#9a6644', torso: '#8a7a62', sleeve: '#8a7a62', legs: '#d8d0bd', feet: '#c49a45',
    skirt: { color: '#857560', length: 0.8, top: 0.2, bottom: 0.32 },
    head: 'turban', headColor: '#d9d2c2', beard: '#2a1d14',
  },
  villagerF: {
    skin: '#a87452', torso: '#efe9de', sleeve: '#efe9de', legs: '#efe9de', feet: '#8a2a22',
    skirt: { color: '#ebe5da', length: 0.94, top: 0.24, bottom: 0.38 },
    head: 'haik', headColor: '#f1ece2',
  },
  prisoner: {
    skin: '#9a6644', torso: '#6e6a62', sleeve: '#6e6a62', legs: '#7a756a', feet: '#3a2a1c',
    skirt: { color: '#66625a', length: 0.5, top: 0.2, bottom: 0.27 },
    head: 'bare', headColor: '#1d140e', beard: '#2a1d14',
  },
};

export type PoseInput = {
  dt: number;
  speed: number;
  crouch: number;
  aim: number;
  melee: number; // -1 none, 0..1 progress
  flinch: number;
  dead: number; // 0..1 fall progress
  sitting: boolean;
  lookPitch: number;
  talk: number;
  reload: number; // -1 none, 0..1
  interact: number; // 0..1 working with hands
};

/**
 * Rigid-skinned humanoid: every part is welded to one bone, the whole body is
 * a single SkinnedMesh (one draw call) animated procedurally.
 */
export class CharacterRig {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[] = [];
  readonly material: THREE.MeshStandardMaterial;
  /** Current long gun / sidearm mesh (one shown at a time). */
  rifle: THREE.Mesh | null;
  private readonly guns = new Map<string, THREE.Mesh>();
  readonly blade: THREE.Mesh | null;
  private phase = 0;
  private readonly restHipsY: number;
  private rifleInHands = false;
  private bladeInHand = false;

  constructor(readonly outfit: Outfit, opts: { rifle?: boolean; pistol?: boolean } = {}) {
    const pal = PALETTES[outfit];
    // build bones and rest world positions
    const rest: THREE.Vector3[] = [];
    BONE_DEFS.forEach(([parent, x, y, z], i) => {
      const bone = new THREE.Bone();
      bone.name = `b${i}`;
      bone.position.set(x, y, z);
      this.bones.push(bone);
      if (parent >= 0) this.bones[parent].add(bone);
      rest.push(new THREE.Vector3(x, y, z).add(parent >= 0 ? rest[parent] : new THREE.Vector3()));
    });
    this.restHipsY = BONE_DEFS[HIPS][2];

    const parts: THREE.BufferGeometry[] = [];
    // `blend` lets robe hems follow the thighs: weight shifts from `bone` to the same-side thigh
    // as vertices go below `topY`, so legs stay under the cloth when walking or crouching.
    const add = (bone: number, geo: THREE.BufferGeometry, color: string, lx = 0, ly = 0, lz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, blend?: { topY: number; span: number; amount: number }) => {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(lx, ly, lz).add(rest[bone]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
        new THREE.Vector3(sx, sy, sz),
      );
      g.applyMatrix4(m);
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      const n = g.getAttribute('position').count;
      const c = new THREE.Color(color);
      const col = new Float32Array(n * 3);
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      const pos = g.getAttribute('position');
      for (let i = 0; i < n; i += 1) {
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
        si[i * 4] = bone;
        sw[i * 4] = 1;
        if (blend) {
          const x = pos.getX(i);
          const t = clamp((blend.topY - pos.getY(i)) / blend.span, 0, 1);
          const side = Math.min(1, Math.abs(x) / 0.12);
          const w = blend.amount * t * side;
          si[i * 4 + 1] = x >= 0 ? THIGH_L : THIGH_R;
          sw[i * 4] = 1 - w;
          sw[i * 4 + 1] = w;
        }
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      parts.push(g);
    };

    const cyl = (rt: number, rb: number, h: number, seg = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    const sph = (r: number, ws = 12, hs = 9) => new THREE.SphereGeometry(r, ws, hs);
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

    // --- torso
    add(HIPS, cyl(0.17, 0.16, 0.22), pal.torso, 0, 0.06, 0);
    add(SPINE, cyl(0.19, 0.17, 0.26), pal.torso, 0, 0.12, 0, 0, 0, 0, 1, 1, 0.82);
    add(CHEST, cyl(0.22, 0.19, 0.24), pal.torso, 0, 0.08, 0, 0, 0, 0, 1, 1, 0.78);
    add(CHEST, sph(0.1), pal.torso, 0.165, 0.15, 0, 0, 0, 0, 1, 0.75, 0.95); // shoulders
    add(CHEST, sph(0.1), pal.torso, -0.165, 0.15, 0, 0, 0, 0, 1, 0.75, 0.95);
    if (pal.belt) add(HIPS, cyl(0.18, 0.18, 0.09), pal.belt, 0, 0.13, 0, 0, 0, 0, 1, 1, 0.86);
    // --- neck & head
    add(NECK, cyl(0.055, 0.065, 0.12), pal.skin, 0, 0.03, 0);
    add(HEAD, sph(0.115, 14, 10), pal.skin, 0, 0.1, 0.005, 0, 0, 0, 0.92, 1.08, 1);
    add(HEAD, box(0.03, 0.05, 0.04), pal.skin, 0, 0.09, 0.115); // nose
    add(HEAD, box(0.16, 0.022, 0.02), '#1a120c', 0, 0.135, 0.1); // brows
    add(HEAD, box(0.025, 0.018, 0.01), '#0e0a08', 0.04, 0.115, 0.108);
    add(HEAD, box(0.025, 0.018, 0.01), '#0e0a08', -0.04, 0.115, 0.108);
    if (pal.beard) {
      add(HEAD, box(0.15, 0.08, 0.06), pal.beard, 0, 0.02, 0.085);
      add(HEAD, box(0.09, 0.02, 0.02), pal.beard, 0, 0.058, 0.116);
    }
    this.addHeadwear(add, pal, sph, cyl, box);

    // --- arms
    for (const [ua, fa, hand, side] of [[UARM_L, FARM_L, HAND_L, 1], [UARM_R, FARM_R, HAND_R, -1]] as const) {
      add(ua, cyl(0.065, 0.058, 0.3), pal.sleeve, 0, -0.14, 0);
      add(fa, cyl(0.06, 0.07, 0.26), pal.sleeve, 0, -0.12, 0); // flared sleeve
      add(fa, cyl(0.07, 0.075, 0.04, 10, true), shade(pal.sleeve, 0.85), 0, -0.24, 0);
      add(hand, box(0.075, 0.1, 0.04), pal.skin, 0, -0.05, 0.005);
      add(hand, box(0.03, 0.05, 0.03), pal.skin, side * 0.03, -0.03, 0.03, 0.4);
    }
    // --- legs
    for (const [th, sh, ft] of [[THIGH_L, SHIN_L, FOOT_L], [THIGH_R, SHIN_R, FOOT_R]] as const) {
      add(th, cyl(0.095, 0.075, 0.44), pal.legs, 0, -0.21, 0);
      add(sh, cyl(0.072, 0.055, 0.42), pal.shin ?? pal.legs, 0, -0.2, 0);
      add(ft, box(0.1, 0.07, 0.25), pal.feet, 0, -0.025, 0.06);
      if (pal.feet === '#d1a64a' || pal.feet === '#c49a45' || pal.feet === '#e0c25a') {
        add(ft, new THREE.ConeGeometry(0.05, 0.08, 6), pal.feet, 0, -0.03, 0.21, Math.PI / 2); // pointed babouche
      }
    }
    // --- skirt / robe
    if (pal.skirt) {
      const s = pal.skirt;
      const hipTop = rest[HIPS].y + 0.12;
      const robe = { topY: hipTop - 0.04, span: Math.max(0.25, s.length * 0.9), amount: 0.82 };
      add(HIPS, new THREE.CylinderGeometry(s.top, s.bottom, s.length, 14, 5, true), s.color, 0, 0.12 - s.length / 2, 0, 0, 0, 0, 1, 1, 0.9, robe);
      add(HIPS, cyl(s.bottom + 0.005, s.bottom + 0.012, 0.05, 14, true), shade(s.color, 0.78), 0, 0.12 - s.length + 0.02, 0, 0, 0, 0, 1, 1, 0.9, robe);
    }

    // --- extras
    for (const e of pal.extra ?? []) {
      if (e === 'bandolier') {
        add(CHEST, box(0.06, 0.62, 0.03), '#4a3020', 0.0, 0.05, 0.16, 0, 0, 0.7);
        add(CHEST, box(0.06, 0.62, 0.03), '#4a3020', 0.0, 0.05, -0.16, 0, 0, 0.7);
        for (let k = 0; k < 6; k += 1) add(CHEST, box(0.025, 0.05, 0.03), '#b89a4a', -0.16 + k * 0.065, 0.2 - k * 0.055, 0.175, 0, 0, 0.7);
      } else if (e === 'pouches') {
        for (const x of [-0.11, 0.11]) add(HIPS, box(0.09, 0.08, 0.06), '#4a3523', x, 0.12, 0.16);
        add(CHEST, box(0.05, 0.55, 0.02), '#4a3523', 0.02, 0.0, 0.165, 0, 0, -0.6);
      } else if (e === 'samBrowne') {
        add(CHEST, box(0.04, 0.6, 0.02), '#3a2618', 0, 0.02, 0.165, 0, 0, -0.62);
        add(HIPS, box(0.1, 0.12, 0.07), '#2a1a10', -0.17, 0.08, 0.06); // holster
      } else if (e === 'satchel') {
        add(HIPS, box(0.16, 0.18, 0.07), '#5a3d22', 0.18, 0.02, 0.06, 0, 0, 0.1);
      } else if (e === 'cloak') {
        add(CHEST, new THREE.CylinderGeometry(0.25, 0.4, 1.1, 14, 5, true), pal.cloak ?? pal.torso, 0, -0.28, -0.03, 0.05, 0, 0, 1, 1, 0.82, { topY: rest[HIPS].y + 0.05, span: 0.6, amount: 0.6 });
      } else if (e === 'dagger') {
        add(HIPS, box(0.05, 0.22, 0.03), '#b08a3a', 0.06, 0.12, 0.17, 0, 0, 0.5);
        add(HIPS, new THREE.TorusGeometry(0.06, 0.012, 5, 10, Math.PI), '#b08a3a', 0.12, 0.02, 0.17, 0, 0, 2.2);
      }
    }

    const geo = mergeGeometries(parts, false);
    if (!geo) throw new Error('character merge failed');
    for (const p of parts) p.dispose();
    geo.computeVertexNormals();

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
      emissive: '#ff2a1a',
      emissiveIntensity: 0,
    });
    this.mesh = new THREE.SkinnedMesh(geo, this.material);
    this.mesh.add(this.bones[ROOT]);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
    this.root.add(this.mesh);

    this.rifle = opts.rifle ? buildRifle() : opts.pistol ? buildPistol() : null;
    if (this.rifle) this.guns.set(this.rifle.name, this.rifle);
    this.blade = outfit === 'fidai' ? buildKhanjar() : null;
    if (this.rifle) this.holsterRifle();
    if (this.blade) this.sheathBlade();
  }

  get headBone(): THREE.Bone {
    return this.bones[HEAD];
  }

  get handBone(): THREE.Bone {
    return this.bones[HAND_R];
  }

  get chestBone(): THREE.Bone {
    return this.bones[CHEST];
  }

  /** Swap the carried gun model (player weapon switching). */
  equipGun(kind: 'rifle' | 'pistol' | 'musket' | 'smg'): void {
    if (this.rifle?.name === kind) return;
    this.rifle?.removeFromParent();
    this.rifleInHands = false;
    let g = this.guns.get(kind);
    if (!g) {
      g = kind === 'rifle' ? buildRifle() : kind === 'pistol' ? buildPistol() : kind === 'musket' ? buildMusket() : buildSmg();
      this.guns.set(kind, g);
    }
    this.rifle = g;
    this.holsterRifle();
  }

  /** Rifle into the hands (aim / combat) */
  drawRifle(): void {
    if (!this.rifle || this.rifleInHands) return;
    this.rifleInHands = true;
    this.bones[HAND_R].add(this.rifle);
    this.rifle.position.set(0, -0.05, 0.03);
    this.rifle.rotation.set(0.04, 0, 0);
  }

  holsterRifle(): void {
    if (!this.rifle) return;
    this.rifleInHands = false;
    if (this.rifle.userData.pistol) {
      this.bones[HIPS].add(this.rifle);
      this.rifle.position.set(-0.19, 0.05, 0.05);
      this.rifle.rotation.set(Math.PI, 0, 0);
      return;
    }
    this.bones[CHEST].add(this.rifle);
    this.rifle.position.set(0.02, 0.05, -0.2);
    this.rifle.rotation.set(0, 0, 0.75);
  }

  drawBlade(): void {
    if (!this.blade || this.bladeInHand) return;
    this.bladeInHand = true;
    this.bones[HAND_R].add(this.blade);
    this.blade.position.set(0, -0.08, 0.02);
    this.blade.rotation.set(-Math.PI / 2, 0, 0);
  }

  sheathBlade(): void {
    if (!this.blade) return;
    this.bladeInHand = false;
    this.bones[HIPS].add(this.blade);
    this.blade.position.set(0.06, 0.13, 0.19);
    this.blade.rotation.set(0, 0, 0.5);
  }

  get hasRifleInHands(): boolean {
    return this.rifleInHands;
  }

  /** World position of the muzzle (or hand) */
  muzzleWorld(target: THREE.Vector3): THREE.Vector3 {
    if (this.rifle && this.rifleInHands) {
      return target.set(0, this.rifle.userData.muzzle as number, 0).applyMatrix4(this.rifle.matrixWorld);
    }
    return this.bones[HAND_R].getWorldPosition(target);
  }

  pose(p: PoseInput): void {
    const b = this.bones;
    const walk = clamp(p.speed / 1.5, 0, 1);
    const run = clamp((p.speed - 2.6) / 2.6, 0, 1);
    const stride = 2.2 + run * 1.2;
    this.phase += p.dt * p.speed * (Math.PI * 2) / stride;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);

    for (const bone of b) bone.rotation.set(0, 0, 0);
    b[ROOT].position.set(0, 0, 0);

    if (p.dead > 0) {
      const t = Math.min(1, p.dead);
      const e = t * t;
      b[ROOT].rotation.x = -e * Math.PI * 0.5;
      b[ROOT].position.y = 0.12 * e;
      b[ROOT].position.z = -0.35 * e;
      b[HIPS].position.y = this.restHipsY;
      b[THIGH_L].rotation.x = -0.4 * e;
      b[SHIN_L].rotation.x = 0.6 * e;
      b[THIGH_R].rotation.x = -0.1 * e;
      b[UARM_L].rotation.z = 1.1 * e;
      b[UARM_R].rotation.z = -1.3 * e;
      b[UARM_R].rotation.x = -0.4 * e;
      b[HEAD].rotation.y = 0.6 * e;
      b[NECK].rotation.x = -0.3 * e;
      return;
    }

    if (p.sitting) {
      b[HIPS].position.y = 0.42;
      for (const [th, sh] of [[THIGH_L, SHIN_L], [THIGH_R, SHIN_R]]) {
        b[th].rotation.x = -1.5;
        b[sh].rotation.x = 1.45;
      }
      b[THIGH_L].rotation.z = 0.35;
      b[THIGH_R].rotation.z = -0.35;
      b[SPINE].rotation.x = 0.15 + Math.sin(this.phase * 0.2) * 0.02;
      b[UARM_L].rotation.x = -0.6;
      b[FARM_L].rotation.x = -0.9;
      b[UARM_R].rotation.x = -0.6;
      b[FARM_R].rotation.x = -0.9;
      this.phase += p.dt * 2;
      b[HEAD].rotation.x = 0.1 + Math.sin(this.phase * 0.3) * 0.05;
      return;
    }

    const crouch = p.crouch;
    const bob = Math.abs(c) * 0.045 * walk * (1 + run * 0.6);
    b[HIPS].position.y = this.restHipsY - crouch * 0.36 + bob - run * 0.03;
    b[HIPS].rotation.y = s * 0.12 * walk;
    b[SPINE].rotation.x = crouch * 0.4 + run * 0.22 + walk * 0.04;
    b[SPINE].rotation.y = -s * 0.1 * walk * (1 - p.aim);
    b[CHEST].rotation.x = -crouch * 0.12;

    // legs
    const swing = (0.45 + run * 0.35) * walk;
    const crouchThigh = -1.05 * crouch;
    const crouchShin = 1.75 * crouch;
    b[THIGH_L].rotation.x = crouchThigh - s * swing * (1 - crouch * 0.5);
    b[THIGH_R].rotation.x = crouchThigh + s * swing * (1 - crouch * 0.5);
    b[SHIN_L].rotation.x = crouchShin + Math.max(0, c) * (0.7 + run * 0.6) * walk;
    b[SHIN_R].rotation.x = crouchShin + Math.max(0, -c) * (0.7 + run * 0.6) * walk;
    b[FOOT_L].rotation.x = -crouch * 0.6 - Math.max(0, -s) * 0.3 * walk;
    b[FOOT_R].rotation.x = -crouch * 0.6 - Math.max(0, s) * 0.3 * walk;

    // arms: natural swing
    const armSwing = (0.38 + run * 0.4) * walk;
    b[UARM_L].rotation.x = s * armSwing;
    b[UARM_R].rotation.x = -s * armSwing;
    b[UARM_L].rotation.z = 0.08 + crouch * 0.15;
    b[UARM_R].rotation.z = -0.08 - crouch * 0.15;
    b[FARM_L].rotation.x = -0.25 - run * 0.9 - Math.max(0, s) * 0.3 * walk;
    b[FARM_R].rotation.x = -0.25 - run * 0.9 - Math.max(0, -s) * 0.3 * walk;

    // talk gesture
    if (p.talk > 0) {
      const g = Math.sin(this.phase * 0.6 + p.talk * 9) * 0.5 + 0.5;
      b[UARM_R].rotation.x = -0.5 - g * 0.4;
      b[FARM_R].rotation.x = -0.9;
      b[HAND_R].rotation.z = g * 0.6;
      b[HEAD].rotation.x = Math.sin(this.phase * 0.9) * 0.06;
    }

    // hands busy (interacting)
    if (p.interact > 0) {
      const w = Math.sin(this.phase * 0.5 + p.interact * 30) * 0.25;
      b[UARM_L].rotation.x = -0.9 + w;
      b[UARM_R].rotation.x = -0.9 - w;
      b[FARM_L].rotation.x = -0.8;
      b[FARM_R].rotation.x = -0.8;
      b[UARM_L].rotation.z = -0.25;
      b[UARM_R].rotation.z = 0.25;
      b[SPINE].rotation.x += 0.25;
    }

    // aim: shoulder the rifle
    if (p.aim > 0) {
      const a = p.aim;
      const pitch = clamp(p.lookPitch, -0.9, 0.9);
      const pistol = Boolean(this.rifle?.userData.pistol);
      b[UARM_R].rotation.x = lerpA(b[UARM_R].rotation.x, -1.35 - pitch, a);
      b[UARM_R].rotation.z = lerpA(b[UARM_R].rotation.z, pistol ? 0.1 : -0.25, a);
      b[FARM_R].rotation.x = lerpA(b[FARM_R].rotation.x, pistol ? -0.15 : -0.35, a);
      b[UARM_L].rotation.x = lerpA(b[UARM_L].rotation.x, pistol ? 0.1 : -1.45 - pitch, a);
      b[UARM_L].rotation.z = lerpA(b[UARM_L].rotation.z, pistol ? 0.1 : 0.62, a);
      b[FARM_L].rotation.x = lerpA(b[FARM_L].rotation.x, pistol ? -0.2 : -0.45, a);
      b[FARM_L].rotation.y = lerpA(0, pistol ? 0 : 0.4, a);
      b[CHEST].rotation.y = lerpA(0, pistol ? 0 : 0.35, a);
      b[NECK].rotation.y = lerpA(0, pistol ? 0 : -0.3, a);
      b[HEAD].rotation.x = lerpA(0, pitch * 0.6, a);
    }

    // reload: rifle tipped, left hand working the bolt
    if (p.reload >= 0) {
      const w = Math.sin(p.reload * Math.PI * 6) * 0.2;
      b[UARM_R].rotation.x = -0.9;
      b[FARM_R].rotation.x = -0.9;
      b[UARM_L].rotation.x = -1.1 + w;
      b[UARM_L].rotation.z = 0.5;
      b[FARM_L].rotation.x = -1.0;
      b[HEAD].rotation.x = 0.35;
    }

    // melee slash: wind up over the shoulder, cut across
    if (p.melee >= 0) {
      const m = p.melee;
      if (m < 0.35) {
        const t = m / 0.35;
        b[UARM_R].rotation.x = -2.4 * t;
        b[UARM_R].rotation.z = -0.6 * t;
        b[FARM_R].rotation.x = -1.2 * t;
        b[CHEST].rotation.y = -0.4 * t;
      } else {
        const t = Math.min(1, (m - 0.35) / 0.3);
        b[UARM_R].rotation.x = -2.4 + t * 1.6;
        b[UARM_R].rotation.z = -0.6 + t * 1.3;
        b[FARM_R].rotation.x = -1.2 + t * 0.9;
        b[CHEST].rotation.y = -0.4 + t * 0.9;
      }
      b[SPINE].rotation.x += 0.15;
    }

    if (p.flinch > 0) {
      b[CHEST].rotation.x -= p.flinch * 0.35;
      b[HEAD].rotation.x -= p.flinch * 0.3;
    }
  }

  /** Hit-flash pulse (0..1). */
  setFlash(v: number): void {
    this.material.emissiveIntensity = v * 1.6;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  private addHeadwear(
    add: (bone: number, geo: THREE.BufferGeometry, color: string, lx?: number, ly?: number, lz?: number, rx?: number, ry?: number, rz?: number, sx?: number, sy?: number, sz?: number) => void,
    pal: Palette,
    sph: (r: number, ws?: number, hs?: number) => THREE.BufferGeometry,
    cyl: (rt: number, rb: number, h: number, seg?: number, open?: boolean) => THREE.BufferGeometry,
    box: (w: number, h: number, d: number) => THREE.BufferGeometry,
  ): void {
    const hc = pal.headColor ?? '#ffffff';
    switch (pal.head) {
      case 'hood': {
        // pointed djellaba hood (qob): shell over the head, open at the face, tip falling back
        // shell sits back so the face stays clear
        add(HEAD, sph(0.15, 14, 10), hc, 0, 0.12, -0.062, 0, 0, 0, 1, 1.05, 1.05);
        add(HEAD, new THREE.ConeGeometry(0.1, 0.3, 10), hc, 0, 0.1, -0.24, -1.95);
        add(HEAD, new THREE.TorusGeometry(0.112, 0.022, 6, 14), shade(hc, 0.8), 0, 0.105, 0.075, 0, 0, 0, 0.95, 1.15, 1);
        break;
      }
      case 'hoodDown':
        add(CHEST, new THREE.ConeGeometry(0.13, 0.34, 10), pal.torso, 0, 0.12, -0.17, 1.1 + Math.PI);
        add(HEAD, cyl(0.125, 0.13, 0.08, 14), hc, 0, 0.17, -0.005);
        add(HEAD, sph(0.12, 12, 8), hc, 0, 0.2, -0.005, 0, 0, 0, 1, 0.55, 1);
        break;
      case 'kepi':
      case 'kepiOfficer': {
        add(HEAD, cyl(0.105, 0.12, 0.13, 14), hc, 0, 0.21, -0.01, -0.12);
        add(HEAD, cyl(0.11, 0.11, 0.015, 14), shade(hc, 0.75), 0, 0.28, -0.02, -0.12);
        add(HEAD, box(0.2, 0.012, 0.08), '#111111', 0, 0.16, 0.1, 0.25);
        if (pal.head === 'kepiOfficer') {
          add(HEAD, cyl(0.122, 0.122, 0.03, 14), '#c9a24a', 0, 0.165, -0.005, -0.12);
          add(HEAD, cyl(0.104, 0.104, 0.02, 14), '#b8202a', 0, 0.27, -0.02, -0.12);
        } else {
          // havelock neck cloth
          add(HEAD, box(0.2, 0.12, 0.02), shade(hc, 0.95), 0, 0.1, -0.12, 0.15);
        }
        break;
      }
      case 'turban':
        add(HEAD, new THREE.TorusGeometry(0.1, 0.045, 8, 16), hc, 0, 0.19, 0, Math.PI / 2, 0, 0, 1.05, 1.05, 1);
        add(HEAD, new THREE.TorusGeometry(0.085, 0.04, 8, 16), shade(hc, 0.96), 0, 0.24, 0, Math.PI / 2 + 0.15);
        add(HEAD, sph(0.09, 10, 8), shade(hc, 0.98), 0, 0.26, 0, 0, 0, 0, 1, 0.6, 1);
        break;
      case 'fez':
        add(HEAD, cyl(0.085, 0.105, 0.16, 14), hc, 0, 0.23, 0);
        add(HEAD, box(0.015, 0.11, 0.015), '#111111', -0.04, 0.24, -0.08, 0.2);
        add(HEAD, new THREE.TorusGeometry(0.1, 0.03, 6, 14), '#efeadf', 0, 0.16, 0, Math.PI / 2);
        break;
      case 'scarf':
        add(HEAD, sph(0.135, 14, 10), hc, 0, 0.12, -0.055, 0, 0, 0, 1, 1.05, 1.0);
        add(NECK, cyl(0.1, 0.16, 0.18, 12), hc, 0, 0.0, -0.01);
        break;
      case 'haik':
        add(HEAD, sph(0.14, 14, 10), hc, 0, 0.12, -0.02, 0, 0, 0, 1, 1.08, 1.05);
        add(CHEST, cyl(0.16, 0.3, 0.5, 14, true), hc, 0, 0.1, 0, 0, 0, 0, 1, 1, 0.85);
        add(HEAD, box(0.12, 0.035, 0.02), pal.skin, 0, 0.115, 0.13);
        add(HEAD, box(0.025, 0.016, 0.01), '#0e0a08', 0.03, 0.116, 0.142);
        add(HEAD, box(0.025, 0.016, 0.01), '#0e0a08', -0.03, 0.116, 0.142);
        break;
      case 'bare':
        add(HEAD, sph(0.118, 12, 8), hc, 0, 0.13, -0.015, 0, 0, 0, 0.95, 0.75, 1);
        break;
    }
  }
}

function lerpA(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex).multiplyScalar(f);
  return `#${c.getHexString()}`;
}

function vc(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const weaponMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });

/** Bolt-action rifle along -Y (barrel) / +Y (stock) in hand space. */
function buildRifle(): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const p = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number, rx = 0) => {
    g.rotateX(rx);
    g.translate(x, y, z);
    parts.push(vc(g, color));
  };
  // stock (wood): from grip back toward shoulder
  const stock = new THREE.Shape();
  stock.moveTo(-0.025, 0);
  stock.lineTo(0.03, 0);
  stock.lineTo(0.045, 0.32);
  stock.lineTo(0.07, 0.36);
  stock.lineTo(-0.025, 0.36);
  stock.closePath();
  const sg = new THREE.ExtrudeGeometry(stock, { depth: 0.04, bevelEnabled: false });
  sg.translate(0, 0, -0.02);
  sg.rotateY(Math.PI / 2);
  p(sg, '#6b4223', 0, 0.02, 0.01);
  p(new THREE.BoxGeometry(0.045, 0.62, 0.05), '#6e4526', 0, -0.3, 0.0);
  p(new THREE.CylinderGeometry(0.012, 0.012, 0.95, 8), '#2a2a2c', 0, -0.48, -0.02);
  p(new THREE.BoxGeometry(0.035, 0.16, 0.045), '#38383a', 0, -0.02, -0.025);
  p(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6), '#38383a', 0.04, 0.0, -0.035, Math.PI / 2);
  p(new THREE.BoxGeometry(0.02, 0.025, 0.03), '#38383a', 0, -0.93, -0.035);
  const geo = mergeGeometries(parts, false);
  if (!geo) throw new Error('rifle merge failed');
  const mesh = new THREE.Mesh(geo, weaponMat);
  mesh.castShadow = true;
  mesh.userData.muzzle = -0.96;
  mesh.name = 'rifle';
  return mesh;
}

/** Small parts list in hand space: barrel along -Y, stock/grip toward +Y. */
function gunParts(): { parts: THREE.BufferGeometry[]; p: (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number, rx?: number, rz?: number) => void } {
  const parts: THREE.BufferGeometry[] = [];
  const p = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number, rx = 0, rz = 0) => {
    g.rotateX(rx);
    g.rotateZ(rz);
    g.translate(x, y, z);
    parts.push(vc(g, color));
  };
  return { parts, p };
}

function finishGun(parts: THREE.BufferGeometry[], name: string, muzzle: number, pistol = false): THREE.Mesh {
  const geo = mergeGeometries(parts, false);
  if (!geo) throw new Error(`${name} merge failed`);
  const mesh = new THREE.Mesh(geo, weaponMat);
  mesh.castShadow = true;
  mesh.userData.muzzle = muzzle;
  mesh.userData.pistol = pistol;
  mesh.name = name;
  return mesh;
}

/** Ruby-pattern self-loading pistol: slide, frame, wooden grip, trigger guard. */
function buildPistol(): THREE.Mesh {
  const { parts, p } = gunParts();
  p(new THREE.BoxGeometry(0.028, 0.17, 0.036), '#26262a', 0, -0.08, -0.012); // slide
  p(new THREE.CylinderGeometry(0.007, 0.007, 0.02, 6), '#121214', 0, -0.17, -0.016); // muzzle
  p(new THREE.BoxGeometry(0.026, 0.12, 0.02), '#303034', 0, -0.07, 0.012); // frame
  p(new THREE.BoxGeometry(0.03, 0.04, 0.1), '#5a3a22', 0, 0.0, 0.035, -0.18); // grip
  p(new THREE.TorusGeometry(0.018, 0.004, 4, 10, Math.PI), '#26262a', 0, -0.03, 0.03, 0, Math.PI / 2);
  for (let i = 0; i < 5; i += 1) p(new THREE.BoxGeometry(0.03, 0.004, 0.008), '#18181a', 0, -0.03 - i * 0.012, -0.031);
  return finishGun(parts, 'pistol', -0.19, true);
}

/** Moroccan moukahla: very long slim stock with brass bands and silver inlay. */
function buildMusket(): THREE.Mesh {
  const { parts, p } = gunParts();
  p(new THREE.CylinderGeometry(0.011, 0.013, 1.3, 8), '#3a3a3e', 0, -0.62, -0.02); // barrel
  p(new THREE.BoxGeometry(0.04, 1.05, 0.045), '#7a3f1e', 0, -0.48, 0.002); // fore stock
  const stock = new THREE.Shape();
  stock.moveTo(-0.02, 0);
  stock.lineTo(0.022, 0);
  stock.lineTo(0.05, 0.42);
  stock.lineTo(-0.03, 0.42);
  stock.closePath();
  const sg = new THREE.ExtrudeGeometry(stock, { depth: 0.042, bevelEnabled: false });
  sg.translate(0, 0, -0.021);
  sg.rotateY(Math.PI / 2);
  p(sg, '#6a3519', 0, 0.02, 0.0);
  for (let i = 0; i < 6; i += 1) p(new THREE.CylinderGeometry(0.028, 0.028, 0.025, 10), '#c9a24a', 0, -0.12 - i * 0.17, -0.006); // brass bands
  for (let i = 0; i < 4; i += 1) p(new THREE.BoxGeometry(0.044, 0.035, 0.012), '#d8d8dc', 0, 0.1 + i * 0.075, 0.018); // silver inlay
  p(new THREE.BoxGeometry(0.02, 0.08, 0.035), '#2a2a2c', 0.022, -0.02, -0.022); // flintlock plate
  p(new THREE.BoxGeometry(0.01, 0.04, 0.012), '#2a2a2c', 0.03, -0.04, -0.05, 0.6); // cock
  p(new THREE.CylinderGeometry(0.004, 0.004, 1.1, 5), '#8a5a2a', 0, -0.55, 0.026); // ramrod
  return finishGun(parts, 'musket', -1.27);
}

/** MAS-38: short receiver angled to the wooden stock, slim barrel. */
function buildSmg(): THREE.Mesh {
  const { parts, p } = gunParts();
  p(new THREE.BoxGeometry(0.036, 0.3, 0.048), '#2c2c30', 0, -0.13, -0.018); // receiver
  p(new THREE.CylinderGeometry(0.01, 0.01, 0.24, 8), '#1c1c1e', 0, -0.39, -0.022); // barrel
  p(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 8), '#1c1c1e', 0, -0.5, -0.022);
  p(new THREE.BoxGeometry(0.022, 0.12, 0.03), '#232326', 0, -0.17, 0.045, 0.15); // magazine
  p(new THREE.BoxGeometry(0.03, 0.06, 0.08), '#5c3b22', 0, -0.01, 0.04, -0.3); // grip
  p(new THREE.BoxGeometry(0.038, 0.3, 0.05), '#6a4426', 0, 0.16, 0.02, 0.12); // stock
  p(new THREE.BoxGeometry(0.008, 0.03, 0.01), '#1c1c1e', 0, -0.46, -0.048); // sight
  return finishGun(parts, 'smg', -0.52);
}

/** Curved Moroccan khanjar (koummiya) with brass hilt. */
function buildKhanjar(): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const shape = new THREE.Shape();
  shape.moveTo(-0.018, 0);
  shape.quadraticCurveTo(-0.03, -0.14, 0.04, -0.26);
  shape.quadraticCurveTo(0.0, -0.13, 0.018, 0);
  shape.closePath();
  const bg = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: false });
  bg.translate(0, -0.05, -0.003);
  bg.rotateY(Math.PI / 2);
  parts.push(vc(bg, '#d6dade'));
  const h = new THREE.CylinderGeometry(0.016, 0.02, 0.1, 8);
  h.translate(0, 0.01, 0);
  parts.push(vc(h, '#c9a24a'));
  const guard = new THREE.BoxGeometry(0.02, 0.015, 0.08);
  guard.translate(0, -0.045, 0);
  parts.push(vc(guard, '#b08a3a'));
  const geo = mergeGeometries(parts, false);
  if (!geo) throw new Error('khanjar merge failed');
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.85 }));
  mesh.name = 'khanjar';
  mesh.castShadow = true;
  return mesh;
}
