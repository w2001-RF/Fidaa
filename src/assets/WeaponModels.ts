import * as THREE from 'three';

/**
 * Optional generated weapon models. `assets/models/manifest.json` lists them:
 *
 *   { "weapons": { "bow": { "file": "bow/model.glb", "length": 1.15 } } }
 *
 * A weapon with an entry is held as the GLB; the rest keep their procedural
 * model, and a missing manifest or file changes nothing (same idea as the audio
 * manifest). Files are relative to `assets/models/`.
 */
export type WeaponModelEntry = {
  file: string;
  /** longest dimension in metres once fitted (default 1.15) */
  length?: number;
  /** how far ahead of the hand shots leave, in gun space (-y is forward) */
  muzzle?: number;
  /** turn the model round if the limbs curve away from the archer */
  flip?: boolean;
  /** Euler degrees [x, y, z] when the automatic orientation guesses wrong */
  orient?: [number, number, number];
};

type Manifest = { weapons?: Record<string, WeaponModelEntry> };

/** What the fit did, kept on the model for the rig and the tests. */
export type WeaponFit = { size: [number, number, number]; min: [number, number, number]; max: [number, number, number] };

const BASE = 'assets/models/';

/** Load every weapon model the manifest lists, fitted for the hand. Failures are silent: procedural stays. */
export async function loadWeaponModels(): Promise<Map<string, THREE.Object3D>> {
  const out = new Map<string, THREE.Object3D>();
  let manifest: Manifest;
  try {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return out;
    manifest = (await res.json()) as Manifest;
  } catch {
    return out;
  }
  const entries = Object.entries(manifest.weapons ?? {});
  if (!entries.length) return out;
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  await Promise.all(
    entries.map(async ([kind, entry]) => {
      try {
        const gltf = await loader.loadAsync(BASE + entry.file);
        out.set(kind, fitWeapon(gltf.scene, kind, entry));
      } catch {
        // unreadable file: keep the procedural weapon
      }
    }),
  );
  return out;
}

/**
 * Stand a model up in gun space: limbs/barrel along z, the next-longest side along y,
 * scaled to `length`, centred on x and z, its back edge 3 cm behind the hand (y).
 * By default the longest axis becomes z and the middle one y, whatever the file's own axes.
 */
export function fitWeapon(model: THREE.Object3D, kind: string, entry: Pick<WeaponModelEntry, 'length' | 'muzzle' | 'flip' | 'orient'>): THREE.Object3D {
  const holder = new THREE.Group();
  holder.name = kind;
  holder.add(model);
  if (entry.orient) {
    model.rotation.set(...(entry.orient.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number]));
  } else {
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    const order = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a));
    const z = new THREE.Vector3().setComponent(order[0], 1);
    const y = new THREE.Vector3().setComponent(order[1], 1);
    const x = new THREE.Vector3().crossVectors(y, z);
    model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z).invert());
  }
  if (entry.flip) holder.rotation.z = Math.PI;
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(holder);
  const scale = (entry.length ?? 1.15) / Math.max(1e-6, box.getSize(new THREE.Vector3()).z);
  model.scale.multiplyScalar(scale);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -0.03 - box.min.y, -c.z);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  holder.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  const fit: WeaponFit = { size: [size.x, size.y, size.z], min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
  holder.userData = { muzzle: entry.muzzle ?? -0.62, pistol: false, fit, custom: true };
  return holder;
}
