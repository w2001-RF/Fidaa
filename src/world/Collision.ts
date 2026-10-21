import * as THREE from 'three';

export type BoxCollider = {
  kind: 'box';
  id: number;
  x: number;
  z: number;
  hx: number;
  hz: number;
  /** rotation about Y in radians */
  angle: number;
  cos: number;
  sin: number;
  y0: number;
  y1: number;
  enabled: boolean;
  /** true for things you can't see through (walls, houses); false for e.g. thin fences */
  opaque: boolean;
  tag?: string;
};

export type CircleCollider = {
  kind: 'circle';
  id: number;
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
  enabled: boolean;
  opaque: boolean;
  tag?: string;
};

export type Collider = BoxCollider | CircleCollider;

const CELL = 8;

/**
 * Static collision world (custom collision rung of the physics ladder):
 * characters are vertical capsules resolved in XZ against oriented boxes and
 * cylinders; bullets, sight lines and the camera use segment queries.
 */
export class CollisionWorld {
  readonly colliders: Collider[] = [];
  private readonly grid = new Map<number, number[]>();
  private stamp = 1;
  private readonly marks: number[] = [];

  addBox(
    x: number,
    z: number,
    hx: number,
    hz: number,
    angle: number,
    y0: number,
    y1: number,
    opaque = true,
    tag?: string,
  ): BoxCollider {
    const c: BoxCollider = {
      kind: 'box',
      id: this.colliders.length,
      x,
      z,
      hx,
      hz,
      angle,
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      y0,
      y1,
      enabled: true,
      opaque,
      tag,
    };
    this.insert(c);
    return c;
  }

  addCircle(x: number, z: number, r: number, y0: number, y1: number, opaque = true, tag?: string): CircleCollider {
    const c: CircleCollider = { kind: 'circle', id: this.colliders.length, x, z, r, y0, y1, enabled: true, opaque, tag };
    this.insert(c);
    return c;
  }

  /**
   * Push a vertical capsule (feet y .. y+height) out of colliders. Returns true
   * when it touched something. Two passes, so a push out of one collider into
   * its neighbour (corners, a tree beside a wall) is settled in the same frame.
   */
  resolveCircle(pos: THREE.Vector3, radius: number, height: number): boolean {
    const a = this.resolvePass(pos, radius, height);
    return (a && this.resolvePass(pos, radius, height)) || a;
  }

  private resolvePass(pos: THREE.Vector3, radius: number, height: number): boolean {
    let touched = false;
    const ids = this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);
    for (const id of ids) {
      const c = this.colliders[id];
      if (!c.enabled) continue;
      // step-over: low colliders (< 0.45 above feet) don't block
      if (c.y1 < pos.y + 0.45 || c.y0 > pos.y + height) continue;
      if (c.kind === 'circle') {
        const dx = pos.x - c.x;
        const dz = pos.z - c.z;
        const min = c.r + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 0.0001;
          pos.x = c.x + (dx / d) * min;
          pos.z = c.z + (dz / d) * min;
          touched = true;
        }
      } else {
        // to local
        const dx = pos.x - c.x;
        const dz = pos.z - c.z;
        const lx = dx * c.cos - dz * c.sin;
        const lz = dx * c.sin + dz * c.cos;
        const cx = Math.max(-c.hx, Math.min(c.hx, lx));
        const cz = Math.max(-c.hz, Math.min(c.hz, lz));
        let ox = lx - cx;
        let oz = lz - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= radius * radius) continue;
        let nlx: number;
        let nlz: number;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nlx = cx + (ox / d) * radius;
          nlz = cz + (oz / d) * radius;
        } else {
          // centre inside the box: push out along the shallowest axis
          const px = c.hx - Math.abs(lx);
          const pz = c.hz - Math.abs(lz);
          if (px < pz) {
            nlx = Math.sign(lx || 1) * (c.hx + radius);
            nlz = lz;
          } else {
            nlx = lx;
            nlz = Math.sign(lz || 1) * (c.hz + radius);
          }
          ox = 0;
          oz = 0;
        }
        // back to world (inverse rotation)
        pos.x = c.x + nlx * c.cos + nlz * c.sin;
        pos.z = c.z - nlx * c.sin + nlz * c.cos;
        touched = true;
      }
    }
    return touched;
  }

  /** True when a point footprint overlaps any enabled collider taller than knee height. */
  blockedAt(x: number, z: number, radius: number, groundY: number): boolean {
    const ids = this.query(x - radius, z - radius, x + radius, z + radius);
    for (const id of ids) {
      const c = this.colliders[id];
      if (!c.enabled || c.y1 < groundY + 0.45 || c.y0 > groundY + 1.8) continue;
      if (c.kind === 'circle') {
        if (Math.hypot(x - c.x, z - c.z) < c.r + radius) return true;
      } else {
        const dx = x - c.x;
        const dz = z - c.z;
        const lx = dx * c.cos - dz * c.sin;
        const lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) < c.hx + radius && Math.abs(lz) < c.hz + radius) return true;
      }
    }
    return false;
  }

  /**
   * First hit along from→to (0..1), or -1. `opaqueOnly` ignores see-through
   * colliders (fences) for sight lines.
   */
  raycast(from: THREE.Vector3, to: THREE.Vector3, opaqueOnly = false): number {
    const ids = this.querySegment(from.x, from.z, to.x, to.z);
    let best = -1;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    for (const id of ids) {
      const c = this.colliders[id];
      if (!c.enabled || (opaqueOnly && !c.opaque)) continue;
      const t = c.kind === 'box' ? segBox(c, from, dx, dy, dz) : segCircle(c, from, dx, dy, dz);
      if (t >= 0 && (best < 0 || t < best)) best = t;
    }
    return best;
  }

  private insert(c: Collider): void {
    this.colliders.push(c);
    let minX: number;
    let maxX: number;
    let minZ: number;
    let maxZ: number;
    if (c.kind === 'circle') {
      minX = c.x - c.r;
      maxX = c.x + c.r;
      minZ = c.z - c.r;
      maxZ = c.z + c.r;
    } else {
      const ex = Math.abs(c.hx * c.cos) + Math.abs(c.hz * c.sin);
      const ez = Math.abs(c.hx * c.sin) + Math.abs(c.hz * c.cos);
      minX = c.x - ex;
      maxX = c.x + ex;
      minZ = c.z - ez;
      maxZ = c.z + ez;
    }
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx += 1) {
      for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz += 1) {
        const key = cellKey(gx, gz);
        let list = this.grid.get(key);
        if (!list) {
          list = [];
          this.grid.set(key, list);
        }
        list.push(c.id);
      }
    }
    this.marks.push(0);
  }

  private readonly result: number[] = [];

  private query(minX: number, minZ: number, maxX: number, maxZ: number): number[] {
    this.stamp += 1;
    this.result.length = 0;
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx += 1) {
      for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz += 1) {
        const list = this.grid.get(cellKey(gx, gz));
        if (!list) continue;
        for (const id of list) {
          if (this.marks[id] === this.stamp) continue;
          this.marks[id] = this.stamp;
          this.result.push(id);
        }
      }
    }
    return this.result;
  }

  private querySegment(ax: number, az: number, bx: number, bz: number): number[] {
    this.stamp += 1;
    this.result.length = 0;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
    let lastKey = Number.NaN;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const cgx = Math.floor(x / CELL);
      const cgz = Math.floor(z / CELL);
      const key = cellKey(cgx, cgz);
      if (key === lastKey) continue;
      lastKey = key;
      // include the 3x3 neighbourhood so diagonal crossings are never missed
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          const list = this.grid.get(cellKey(cgx + ox, cgz + oz));
          if (!list) continue;
          for (const id of list) {
            if (this.marks[id] === this.stamp) continue;
            this.marks[id] = this.stamp;
            this.result.push(id);
          }
        }
      }
    }
    return this.result;
  }
}

function cellKey(gx: number, gz: number): number {
  return (gx + 4096) * 8192 + (gz + 4096);
}

function segBox(c: BoxCollider, from: THREE.Vector3, dx: number, dy: number, dz: number): number {
  // into local space
  const ox = from.x - c.x;
  const oz = from.z - c.z;
  const lox = ox * c.cos - oz * c.sin;
  const loz = ox * c.sin + oz * c.cos;
  const ldx = dx * c.cos - dz * c.sin;
  const ldz = dx * c.sin + dz * c.cos;
  let tmin = 0;
  let tmax = 1;
  // x slab
  if (Math.abs(ldx) < 1e-9) {
    if (lox < -c.hx || lox > c.hx) return -1;
  } else {
    let t1 = (-c.hx - lox) / ldx;
    let t2 = (c.hx - lox) / ldx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  // z slab
  if (Math.abs(ldz) < 1e-9) {
    if (loz < -c.hz || loz > c.hz) return -1;
  } else {
    let t1 = (-c.hz - loz) / ldz;
    let t2 = (c.hz - loz) / ldz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  // y slab
  if (Math.abs(dy) < 1e-9) {
    if (from.y < c.y0 || from.y > c.y1) return -1;
  } else {
    let t1 = (c.y0 - from.y) / dy;
    let t2 = (c.y1 - from.y) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Segment against a capped vertical cylinder: the side wall and the top and bottom caps. */
function segCircle(c: CircleCollider, from: THREE.Vector3, dx: number, dy: number, dz: number): number {
  const fx = from.x - c.x;
  const fz = from.z - c.z;
  const a = dx * dx + dz * dz;
  let tmin = 0;
  let tmax = 1;
  if (a < 1e-9) {
    // vertical segment: inside the disc or not at all
    if (fx * fx + fz * fz > c.r * c.r) return -1;
  } else {
    const b = 2 * (fx * dx + fz * dz);
    const cc = fx * fx + fz * fz - c.r * c.r;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    tmin = Math.max(tmin, (-b - s) / (2 * a));
    tmax = Math.min(tmax, (-b + s) / (2 * a));
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) {
    if (from.y < c.y0 || from.y > c.y1) return -1;
  } else {
    let t1 = (c.y0 - from.y) / dy;
    let t2 = (c.y1 - from.y) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Push a moving circle out of another circle (characters, animals, parked rides). */
export function pushApart(pos: THREE.Vector3, r: number, x: number, z: number, r2: number): boolean {
  const dx = pos.x - x;
  const dz = pos.z - z;
  const min = r + r2;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-4) {
    pos.x = x + min;
    return true;
  }
  pos.x = x + (dx / d) * min;
  pos.z = z + (dz / d) * min;
  return true;
}
