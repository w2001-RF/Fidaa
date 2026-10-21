/**
 * World layout: the single source of truth for where each zone sits. Terrain
 * flattens under these footprints, the world builder places architecture
 * there, and the map / compass read names from here.
 */
export type Zone = {
  id: 'douar' | 'medina' | 'kasbah' | 'post' | 'oasis';
  name: string;
  arabic: string;
  x: number;
  z: number;
  /** Flattened plateau radius. */
  radius: number;
  /** Blend distance from plateau back to natural terrain. */
  blend: number;
  /** Plateau height. */
  height: number;
};

export const WORLD_HALF = 320; // terrain half size
export const PLAY_RADIUS = 232; // the mountains close in beyond this

export const ZONES: Zone[] = [
  { id: 'douar', name: 'Douar Tifawt', arabic: 'دوار تيفاوت', x: -140, z: 110, radius: 30, blend: 26, height: 4.5 },
  { id: 'medina', name: 'Medina of Tadwart', arabic: 'مدينة تادوارت', x: 10, z: 10, radius: 80, blend: 30, height: 2 },
  { id: 'kasbah', name: "Kasbah of the Caïd", arabic: 'قصبة القايد', x: 128, z: 112, radius: 36, blend: 24, height: 6 },
  { id: 'post', name: 'Poste militaire de Bir Lahmam', arabic: 'المركز العسكري', x: 110, z: -122, radius: 50, blend: 26, height: 3 },
  { id: 'oasis', name: 'Oasis of the dry oued', arabic: 'الواحة', x: -95, z: -90, radius: 18, blend: 20, height: -1.5 },
];

export function zone(id: Zone['id']): Zone {
  const z = ZONES.find((entry) => entry.id === id);
  if (!z) throw new Error(`Unknown zone ${id}`);
  return z;
}

/** Dirt roads as polylines (x,z pairs). Painted on the terrain and lightly flattened. */
export const ROADS: number[][][] = [
  // douar → medina west gate
  [[-140, 110], [-118, 90], [-92, 66], [-68, 36], [-50, 12]],
  // medina east gate → telegraph road → post north gate
  [[68, 10], [84, -14], [96, -40], [104, -64], [110, -86]],
  // medina south gate → kasbah west gate
  [[10, 68], [40, 84], [74, 100], [102, 112]],
  // douar → oasis
  [[-140, 110], [-146, 60], [-128, 0], [-106, -60], [-95, -84]],
  // oasis → medina north gate
  [[-92, -92], [-56, -78], [-20, -64], [10, -48]],
];

/** Aguelmam: a Middle Atlas lake on the western plateau (boat, water). */
export const LAKE = { x: -172, z: -52, r: 24, level: -1.2, water: 19 };

/** Narrow-gauge railway across the north with a halt at each end. */
export const RAIL: number[][] = [[-132, 168], [-92, 163], [-44, 158], [0, 152], [48, 156], [88, 162], [120, 165]];

/** A dirt landing strip: centre, half width and half length (along `angle`), flattened to `height`. */
export type Strip = { id: 'post' | 'douar'; x: number; z: number; halfW: number; halfL: number; angle: number; height: number };

/** Dirt airstrip of the garrison, west of the post. */
export const AIRSTRIP: Strip = { id: 'post', x: 48, z: -168, halfW: 10, halfL: 42, angle: 0, height: 3 };

/**
 * The douar's own field strip, just east of the village and running east-west:
 * 120 m of packed earth, plenty for a Criquet (it lifts off in about 50 m and
 * stops in a few dozen).
 */
export const DOUAR_STRIP: Strip = { id: 'douar', x: -46, z: 118, halfW: 8, halfL: 60, angle: Math.PI / 2, height: 3 };

export const STRIPS: Strip[] = [AIRSTRIP, DOUAR_STRIP];

/** Point in a strip's frame: x across, z along the runway. */
export function stripLocal(s: Strip, x: number, z: number): [number, number] {
  const dx = x - s.x;
  const dz = z - s.z;
  const c = Math.cos(s.angle);
  const n = Math.sin(s.angle);
  return [dx * c - dz * n, dx * n + dz * c];
}

/** The strip under (x, z), if any. */
export function stripAt(x: number, z: number, pad = 0): Strip | null {
  for (const s of STRIPS) {
    const [lx, lz] = stripLocal(s, x, z);
    if (Math.abs(lx) < s.halfW + pad && Math.abs(lz) < s.halfL + pad) return s;
  }
  return null;
}

/** Distance outside a strip's rectangle (0 on it). */
export function distToStrip(s: Strip, x: number, z: number): number {
  const [lx, lz] = stripLocal(s, x, z);
  return Math.hypot(Math.max(0, Math.abs(lx) - s.halfW), Math.max(0, Math.abs(lz) - s.halfL));
}

/** Ground reserved for water, track and runways: no trees, rocks, scrub or loot there. */
export function reserved(x: number, z: number, pad = 0): boolean {
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 4 + pad) return true;
  if (distToPolyline(x, z, RAIL) < 4.5 + pad) return true;
  // runways plus an approach clear of obstacles at each end
  for (const s of STRIPS) {
    const [lx, lz] = stripLocal(s, x, z);
    if (Math.abs(lx) < s.halfW + 4 + pad && Math.abs(lz) < s.halfL + 6 + pad) return true;
    if (Math.abs(lx) < s.halfW + 2 + pad && Math.abs(lz) < s.halfL + 30 + pad) return true;
  }
  return false;
}

/** Total rail length and a point/heading at arc length s. */
export const RAIL_LENGTH = RAIL.slice(1).reduce((acc, p, i) => acc + Math.hypot(p[0] - RAIL[i][0], p[1] - RAIL[i][1]), 0);
export function railAt(s: number): { x: number; z: number; angle: number } {
  let left = Math.max(0, Math.min(RAIL_LENGTH, s));
  for (let i = 0; i < RAIL.length - 1; i += 1) {
    const [ax, az] = RAIL[i];
    const [bx, bz] = RAIL[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (left <= len || i === RAIL.length - 2) {
      const t = Math.min(1, left / len);
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, angle: Math.atan2(bx - ax, bz - az) };
    }
    left -= len;
  }
  return { x: RAIL[0][0], z: RAIL[0][1], angle: 0 };
}

/** Dry riverbed (oued) path; carved slightly into terrain. */
export const OUED: number[][] = [
  [-230, -40], [-180, -70], [-130, -82], [-95, -95], [-60, -120], [-20, -160], [20, -210], [40, -240],
];

export function distToPolyline(x: number, z: number, line: number[][]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i += 1) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t - x;
    const pz = az + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function distToRoads(x: number, z: number): number {
  let best = Infinity;
  for (const road of ROADS) best = Math.min(best, distToPolyline(x, z, road));
  return best;
}

/** Points along a polyline at a fixed spacing (used for telegraph poles, lamps...). */
export function samplePolyline(line: number[][], spacing: number): { x: number; z: number; angle: number }[] {
  const out: { x: number; z: number; angle: number }[] = [];
  let carry = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const angle = Math.atan2(bx - ax, bz - az);
    let d = carry;
    while (d < len) {
      const t = d / len;
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, angle });
      d += spacing;
    }
    carry = d - len;
  }
  return out;
}
