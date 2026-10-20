import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothstep } from '../utils/noise';
import type { MaterialLibrary, MaterialRole } from './Materials';

export type AddOptions = {
  /** World Y of the ground under this piece: vertices near it are darkened (cheap baked AO). */
  groundY?: number;
  aoHeight?: number;
  aoStrength?: number;
  /** World-space texture tiling size in metres (box projection). 0 keeps the geometry's own UVs. */
  uvScale?: number;
  /** Per-piece brightness jitter (0..1) */
  jitter?: number;
};

const tmpPos = new THREE.Vector3();
const tmpNormal = new THREE.Vector3();
const tmpColor = new THREE.Color();

/**
 * Accumulates authored pieces per material role and merges them into one mesh
 * per role. A whole settlement renders in ~8 draw calls.
 */
export class MergeBuilder {
  private readonly buckets = new Map<MaterialRole, THREE.BufferGeometry[]>();
  private jitterSeed = 1;

  add(role: MaterialRole, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.ColorRepresentation, opts: AddOptions = {}): void {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geo.applyMatrix4(matrix);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
    const count = pos.count;

    const uvScale = opts.uvScale ?? 2.5;
    if (uvScale > 0 || !geo.getAttribute('uv')) {
      const s = uvScale > 0 ? uvScale : 1;
      const uv = new Float32Array(count * 2);
      for (let i = 0; i < count; i += 1) {
        tmpPos.fromBufferAttribute(pos, i);
        tmpNormal.fromBufferAttribute(nor, i);
        const ax = Math.abs(tmpNormal.x);
        const ay = Math.abs(tmpNormal.y);
        const az = Math.abs(tmpNormal.z);
        if (ay >= ax && ay >= az) {
          uv[i * 2] = tmpPos.x / s;
          uv[i * 2 + 1] = tmpPos.z / s;
        } else if (ax >= az) {
          uv[i * 2] = tmpPos.z / s;
          uv[i * 2 + 1] = tmpPos.y / s;
        } else {
          uv[i * 2] = tmpPos.x / s;
          uv[i * 2 + 1] = tmpPos.y / s;
        }
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }

    const colors = new Float32Array(count * 3);
    tmpColor.set(color);
    this.jitterSeed = (this.jitterSeed * 16807) % 2147483647;
    const j = opts.jitter ?? 0.06;
    const jitter = 1 + ((this.jitterSeed / 2147483647) - 0.5) * 2 * j;
    const groundY = opts.groundY;
    const aoH = opts.aoHeight ?? 1.6;
    const aoS = opts.aoStrength ?? 0.38;
    for (let i = 0; i < count; i += 1) {
      let f = jitter;
      if (groundY !== undefined) {
        const y = pos.getY(i);
        f *= 1 - aoS * (1 - smoothstep(0, aoH, y - groundY));
      }
      colors[i * 3] = tmpColor.r * f;
      colors[i * 3 + 1] = tmpColor.g * f;
      colors[i * 3 + 2] = tmpColor.b * f;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    let list = this.buckets.get(role);
    if (!list) {
      list = [];
      this.buckets.set(role, list);
    }
    list.push(geo);
  }

  /** Convenience: add with position / rotationY / scale. */
  put(
    role: MaterialRole,
    geometry: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    rotY: number,
    color: THREE.ColorRepresentation,
    opts?: AddOptions,
    rotX = 0,
    rotZ = 0,
  ): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(role, geometry, m, color, opts);
  }

  build(lib: MaterialLibrary, name: string, castShadow = true): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [role, list] of this.buckets) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, lib.materials[role]);
      mesh.name = `${name}-${role}`;
      mesh.castShadow = castShadow && role !== 'glow' && role !== 'paper';
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const g of list) g.dispose();
    }
    this.buckets.clear();
    return group;
  }
}

/** Moroccan horseshoe arch outline, base at y=0, total height h. */
export function horseshoeArchShape(width: number, height: number, overshoot = 0.32): THREE.Shape {
  const half = width / 2;
  const r = half / Math.cos(overshoot);
  const cy = height - r;
  const shape = new THREE.Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(-half, cy - r * Math.sin(overshoot));
  shape.absarc(0, cy, r, Math.PI + overshoot, -overshoot, true);
  shape.lineTo(half, 0);
  shape.closePath();
  return shape;
}

/** Arch frame: an outer arch with the inner arch cut out. */
export function archFrameShape(width: number, height: number, border: number): THREE.Shape {
  const outer = horseshoeArchShape(width + border * 2, height + border);
  const inner = horseshoeArchShape(width, height);
  const hole = new THREE.Path(inner.getPoints(24));
  outer.holes.push(hole);
  return outer;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `box:${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}

export function cylGeo(rt: number, rb: number, h: number, seg = 12): THREE.BufferGeometry {
  const key = `cyl:${rt.toFixed(3)}:${rb.toFixed(3)}:${h.toFixed(3)}:${seg}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg);
    geoCache.set(key, g);
  }
  return g;
}

export function extrudeGeo(shape: THREE.Shape, depth: number, bevel = 0): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 14,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Lathe from a (radius, y) profile; used for jars, domes, finials, wells. */
export function latheGeo(profile: number[][], segments = 16): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

/** Stepped Moroccan merlon (crenel tooth) — base box plus smaller stepped cap. */
export function addMerlon(
  b: MergeBuilder,
  role: MaterialRole,
  x: number,
  y: number,
  z: number,
  rotY: number,
  size: number,
  color: THREE.ColorRepresentation,
): void {
  b.put(role, boxGeo(size, size * 0.9, size * 0.55), x, y + size * 0.45, z, rotY, color, { uvScale: 2 });
  b.put(role, boxGeo(size * 0.62, size * 0.45, size * 0.5), x, y + size * 0.9 + size * 0.22, z, rotY, color, { uvScale: 2 });
  b.put(role, boxGeo(size * 0.28, size * 0.3, size * 0.45), x, y + size * 1.35 + size * 0.15, z, rotY, color, { uvScale: 2 });
}

const ARCH2 = new Map<string, THREE.BufferGeometry>();
/** Cached extruded horseshoe arch (solid). */
export function archGeo2(w: number, h: number, depth: number): THREE.BufferGeometry {
  const key = `${w}:${h}:${depth}`;
  let g = ARCH2.get(key);
  if (!g) {
    g = extrudeGeo(horseshoeArchShape(w, h), depth);
    ARCH2.set(key, g);
  }
  return g;
}
