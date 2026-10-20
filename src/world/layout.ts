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
