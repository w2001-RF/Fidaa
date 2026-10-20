import type { CollisionWorld } from './Collision';
import type { Terrain } from './Terrain';

const CELL = 2;
const HALF = 244;
const N = Math.ceil((HALF * 2) / CELL);

/**
 * Coarse walkability grid with budgeted A*. Guards use it to chase and search
 * through alleys; patrol routes are authored and don't need it.
 */
export class NavGrid {
  private readonly walkable = new Uint8Array(N * N);
  private readonly gScore = new Float32Array(N * N);
  private readonly cameFrom = new Int32Array(N * N);
  private readonly visited = new Uint32Array(N * N);
  private searchId = 1;
  private readonly heap: number[] = [];
  private readonly fScore = new Float32Array(N * N);

  constructor(terrain: Terrain, collision: CollisionWorld) {
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const x = -HALF + (i + 0.5) * CELL;
        const z = -HALF + (j + 0.5) * CELL;
        const h = terrain.getHeight(x, z);
        const ok = Math.hypot(x, z) < 236 && terrain.getSlope(x, z) < 0.85 && !collision.blockedAt(x, z, 0.55, h);
        this.walkable[j * N + i] = ok ? 1 : 0;
      }
    }
  }

  isWalkable(x: number, z: number): boolean {
    const i = Math.floor((x + HALF) / CELL);
    const j = Math.floor((z + HALF) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return false;
    return this.walkable[j * N + i] === 1;
  }

  /** Returns world-space waypoints (x,z pairs) or null when no path within budget. */
  findPath(sx: number, sz: number, tx: number, tz: number, budget = 5000): number[][] | null {
    let start = this.cellOf(sx, sz);
    let goal = this.cellOf(tx, tz);
    if (start < 0 || goal < 0) return null;
    start = this.nearestWalkable(start);
    goal = this.nearestWalkable(goal);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [[tx, tz]];

    this.searchId += 1;
    const id = this.searchId;
    const gi = goal % N;
    const gj = Math.floor(goal / N);
    this.heap.length = 0;
    this.gScore[start] = 0;
    this.fScore[start] = this.h(start % N, Math.floor(start / N), gi, gj);
    this.cameFrom[start] = -1;
    this.visited[start] = id;
    this.push(start);
    let expanded = 0;
    let best = start;
    let bestH = this.fScore[start];

    while (this.heap.length > 0 && expanded < budget) {
      const cur = this.pop();
      expanded += 1;
      if (cur === goal) {
        best = goal;
        break;
      }
      const ci = cur % N;
      const cj = Math.floor(cur / N);
      const hc = this.h(ci, cj, gi, gj);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          if (di === 0 && dj === 0) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const nIdx = nj * N + ni;
          if (!this.walkable[nIdx]) continue;
          // no corner cutting
          if (di !== 0 && dj !== 0 && (!this.walkable[cj * N + ni] || !this.walkable[nj * N + ci])) continue;
          const cost = this.gScore[cur] + (di !== 0 && dj !== 0 ? 1.4142 : 1);
          if (this.visited[nIdx] !== id || cost < this.gScore[nIdx]) {
            this.visited[nIdx] = id;
            this.gScore[nIdx] = cost;
            this.cameFrom[nIdx] = cur;
            this.fScore[nIdx] = cost + this.h(ni, nj, gi, gj);
            this.push(nIdx);
          }
        }
      }
    }

    // reconstruct (to goal, or to the closest node reached)
    const cells: number[] = [];
    let c = best;
    let guard = 0;
    while (c >= 0 && guard < 4000) {
      cells.push(c);
      c = this.cameFrom[c];
      guard += 1;
    }
    cells.reverse();
    if (cells.length === 0) return null;

    // string-pull smoothing
    const pts: number[][] = [];
    let anchor = 0;
    for (let k = 2; k < cells.length; k += 1) {
      if (!this.lineWalkable(cells[anchor], cells[k])) {
        pts.push(this.centerOf(cells[k - 1]));
        anchor = k - 1;
      }
    }
    if (best === goal) pts.push([tx, tz]);
    else pts.push(this.centerOf(cells[cells.length - 1]));
    return pts;
  }

  private lineWalkable(a: number, b: number): boolean {
    const ai = a % N;
    const aj = Math.floor(a / N);
    const bi = b % N;
    const bj = Math.floor(b / N);
    const steps = Math.max(Math.abs(bi - ai), Math.abs(bj - aj)) * 2;
    for (let s = 1; s < steps; s += 1) {
      const t = s / steps;
      const i = Math.round(ai + (bi - ai) * t);
      const j = Math.round(aj + (bj - aj) * t);
      if (!this.walkable[j * N + i]) return false;
    }
    return true;
  }

  private nearestWalkable(cell: number): number {
    if (this.walkable[cell]) return cell;
    const ci = cell % N;
    const cj = Math.floor(cell / N);
    for (let r = 1; r < 6; r += 1) {
      for (let dj = -r; dj <= r; dj += 1) {
        for (let di = -r; di <= r; di += 1) {
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          if (this.walkable[j * N + i]) return j * N + i;
        }
      }
    }
    return -1;
  }

  private cellOf(x: number, z: number): number {
    const i = Math.floor((x + HALF) / CELL);
    const j = Math.floor((z + HALF) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    return j * N + i;
  }

  private centerOf(cell: number): number[] {
    return [-HALF + ((cell % N) + 0.5) * CELL, -HALF + (Math.floor(cell / N) + 0.5) * CELL];
  }

  private h(i: number, j: number, gi: number, gj: number): number {
    const dx = Math.abs(i - gi);
    const dy = Math.abs(j - gj);
    return dx + dy + (1.4142 - 2) * Math.min(dx, dy);
  }

  private push(node: number): void {
    const heap = this.heap;
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.fScore[heap[p]] <= this.fScore[heap[i]]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  }

  private pop(): number {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop() as number;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && this.fScore[heap[l]] < this.fScore[heap[m]]) m = l;
        if (r < heap.length && this.fScore[heap[r]] < this.fScore[heap[m]]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  }
}
