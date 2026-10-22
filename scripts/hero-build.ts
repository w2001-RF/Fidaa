/**
 * In-browser half of scripts/build-hero.mjs: turns Tripo's rigged fidāʾī and its
 * retargeted FBX clips into one game-sized GLB.
 *
 * - textures shrunk to 1024 px JPEG (Tripo ships 4096 px: ~270 MB of VRAM);
 * - each FBX's take kept once (FBXLoader emits it twice; the shallower node path binds right);
 * - the take baked onto the GLB skeleton in world space at 30 fps: each bone turns from its
 *   rest pose as its FBX twin does, which carries over the FBX file's own units and Z-up
 *   (copying the FBX tracks across as they are lays the character on its back);
 * - in place: the hip keeps its vertical bob, never its horizontal travel.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

type Report = { triangles: number; bones: string[]; height: number; size: number[]; clips: { name: string; duration: number; tracks: number; dropped: number; missing: string[]; root: string | null }[] };

async function shrink(tex: THREE.Texture | null, size: number): Promise<void> {
  if (!tex?.image) return;
  const img = tex.image as ImageBitmap | HTMLImageElement;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  (canvas.getContext('2d') as CanvasRenderingContext2D).drawImage(img, 0, 0, size, size);
  tex.image = canvas;
  tex.userData.mimeType = 'image/jpeg';
  tex.needsUpdate = true;
}

/**
 * World rotation of each bone in the skin's bind pose, from the inverse bind matrices.
 * FBXLoader leaves the bones in the take's first frame, not the bind pose, so the bones'
 * own transforms can't serve as the rest pose. The bind matrices live in the file's own
 * frame (an FBX keeps Z-up and centimetres there), so they are turned into the frame the
 * bones are animated in, measured on the Root bone, which no take rotates.
 */
function bindPose(root: THREE.Object3D): Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }> {
  const out = new Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.skeleton.bones.forEach((bone, i) => {
      if (out.has(bone.name)) return;
      // bone world at bind = mesh bind matrix x inverse(bone inverse)
      const w = m.bindMatrix.clone().multiply(m.skeleton.boneInverses[i].clone().invert());
      const q = new THREE.Quaternion();
      const p = new THREE.Vector3();
      w.decompose(p, q, new THREE.Vector3());
      out.set(bone.name, { q, p });
    });
  });
  let rootBone: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!rootBone && (o as THREE.Bone).isBone && o.name === 'Root') rootBone = o;
  });
  const bound = out.get('Root');
  if (rootBone && bound) {
    const frame = rootBone.getWorldQuaternion(new THREE.Quaternion()).multiply(bound.q.clone().invert());
    for (const b of out.values()) b.q.premultiply(frame);
  }
  return out;
}

async function run(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const model = q.get('model') as string;
  const anims = (q.get('anims') ?? '').split(',').filter(Boolean).map((s) => s.split('=') as [string, string]);
  const size = Number(q.get('tex') ?? 1024);

  const gltf = await new GLTFLoader().loadAsync(model);
  const bones = new Set<string>();
  let triangles = 0;
  const textures: Promise<void>[] = [];
  gltf.scene.traverse((o) => {
    bones.add(o.name);
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    triangles += (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3;
    const mat = m.material as THREE.MeshStandardMaterial;
    for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap, mat.emissiveMap]) textures.push(shrink(t, size));
  });
  await Promise.all(textures);
  const box = new THREE.Box3().setFromObject(gltf.scene);

  const clips: THREE.AnimationClip[] = [];
  const report: Report = { triangles, bones: [...bones], height: box.max.y - box.min.y, size: box.getSize(new THREE.Vector3()).toArray(), clips: [] };
  // GLB bones by name, parents before children
  const target = new Map<string, THREE.Bone>();
  gltf.scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) target.set(o.name, o as THREE.Bone);
  });
  const bindG = bindPose(gltf.scene);
  const restG = new Map<string, THREE.Quaternion>();
  for (const [n, bone] of target) restG.set(n, bindG.get(n)?.q ?? bone.getWorldQuaternion(new THREE.Quaternion()));
  const hipName = target.has('Hip') ? 'Hip' : 'Root';
  const hipRestG = (target.get(hipName) as THREE.Bone).getWorldPosition(new THREE.Vector3());
  // body size in world units, for the hip's bob: head above the feet, as posed
  const span = (bones: Map<string, THREE.Object3D>) => {
    const head = bones.get('Head')?.getWorldPosition(new THREE.Vector3());
    const foot = bones.get('L_Foot')?.getWorldPosition(new THREE.Vector3());
    return head && foot ? head.distanceTo(foot) : 1;
  };
  const spanG = span(target);

  for (const [name, url] of anims) {
    const fbx = await new FBXLoader().loadAsync(url);
    // the shallower node-path variant of the take binds correctly
    const take = [...fbx.animations].sort((x, y) => x.name.split('|').length - y.name.split('|').length)[0];
    const source = new Map<string, THREE.Object3D>();
    fbx.traverse((o) => {
      if ((o as THREE.Bone).isBone) source.set(o.name, o);
    });
    // the FBX skeleton's bind pose
    const bindF = bindPose(fbx);
    const restF = new Map<string, THREE.Quaternion>();
    for (const [n, bone] of source) restF.set(n, bindF.get(n)?.q ?? bone.getWorldQuaternion(new THREE.Quaternion()));
    const hipF = source.get(hipName);
    fbx.updateMatrixWorld(true);
    const hipRestF = hipF ? hipF.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    const scale = spanG / Math.max(1e-6, span(source));

    // Bake the take onto the GLB skeleton in world space: every bone turns from its
    // rest pose by the same world rotation as its FBX twin (that carries over the FBX
    // file's own unit and axis conventions); the hip adds only its vertical bob, so
    // the walk stays in place.
    const mixer = new THREE.AnimationMixer(fbx);
    mixer.clipAction(take).play();
    const fps = 30;
    const frames = Math.max(2, Math.round(take.duration * fps) + 1);
    const times = new Float32Array(frames);
    const quats = new Map<string, Float32Array>();
    for (const n of target.keys()) if (source.has(n)) quats.set(n, new Float32Array(frames * 4));
    const hipPos = new Float32Array(frames * 3);
    const qW = new THREE.Quaternion();
    const qP = new THREE.Quaternion();
    const v = new THREE.Vector3();
    for (let f = 0; f < frames; f += 1) {
      const t = Math.min(take.duration, f / fps);
      times[f] = t;
      mixer.setTime(t);
      fbx.updateMatrixWorld(true);
      for (const [n, bone] of target) {
        const src = source.get(n);
        const out = quats.get(n);
        if (!src || !out) continue;
        src.getWorldQuaternion(qW).multiply(qP.copy(restF.get(n) as THREE.Quaternion).invert());
        qW.multiply(restG.get(n) as THREE.Quaternion);
        (bone.parent as THREE.Object3D).getWorldQuaternion(qP).invert();
        bone.quaternion.copy(qP.multiply(qW));
        bone.updateMatrixWorld(true);
        bone.quaternion.toArray(out, f * 4);
      }
      const hip = target.get(hipName) as THREE.Bone;
      const y = hipF ? (hipF.getWorldPosition(v).y - hipRestF.y) * scale : 0;
      v.set(hipRestG.x, hipRestG.y + y, hipRestG.z);
      (hip.parent as THREE.Object3D).worldToLocal(v);
      v.toArray(hipPos, f * 3);
    }
    const tracks: THREE.KeyframeTrack[] = [...quats].map(([n, q]) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, q));
    tracks.push(new THREE.VectorKeyframeTrack(`${hipName}.position`, times, hipPos));
    const clip = new THREE.AnimationClip(name, take.duration, tracks);
    const missing = [...target.keys()].filter((n) => !source.has(n));
    report.clips.push({ name, duration: clip.duration, tracks: tracks.length, dropped: 0, missing, root: `${hipName}.position (x${scale.toFixed(3)})` });
    clips.push(clip);
  }
  // back to the bind pose before export
  gltf.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) m.skeleton.pose();
  });

  const glb = (await new GLTFExporter().parseAsync(gltf.scene, { binary: true, animations: clips, onlyVisible: false })) as ArrayBuffer;
  const bytes = new Uint8Array(glb);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  (window as unknown as { heroResult: unknown }).heroResult = { glb: btoa(bin), report };
}

run().catch((e: unknown) => {
  (window as unknown as { heroResult: unknown }).heroResult = { error: String(e instanceof Error ? e.stack : e) };
});
