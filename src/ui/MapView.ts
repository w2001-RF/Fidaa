import * as THREE from 'three';
import { ROADS, ZONES, OUED, distToPolyline, zone } from '../world/layout';
import { CHUNK, CORE_HALF, LIMIT, PASSES, type SiteKind } from '../world/Lands';
import { lang, tr, type Text } from '../i18n';
import type { Terrain } from '../world/Terrain';

const EXTENT = 250;
/** coarse grid per chunk the region map paints from (matches the frontier's horizon grid) */
const LN = 9;
const SITE_COLOR: Record<SiteKind, string> = { village: '#2f9a68', ksar: '#a8572f', shrine: '#f1efe9', nomads: '#3a3a3a', spring: '#4fa7c4', cave: '#5a4a40' };

/** Hand-drawn-style survey map: hillshaded terrain, roads, zones, markers. */
export class MapView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly fogCanvas = document.createElement('canvas');
  private readonly terrain: Terrain;
  /** the whole lands (±LIMIT), painted chunk by chunk as they are generated */
  private readonly region: HTMLCanvasElement;
  private readonly regionFog = document.createElement('canvas');
  /** 'valley' is the hand-drawn survey of the home valley; 'region' the lands beyond */
  mode: 'valley' | 'region' = 'valley';

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    const c = document.querySelector<HTMLCanvasElement>('#map-canvas');
    if (!c) throw new Error('map canvas');
    this.canvas = c;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('map ctx');
    this.ctx = ctx;
    this.base = document.createElement('canvas');
    this.base.width = c.width;
    this.base.height = c.height;
    this.paintBase(terrain);
    this.region = document.createElement('canvas');
    this.region.width = c.width;
    this.region.height = c.height;
    this.clearRegion();
  }

  /** A new world: blank lands, the valley painted in again. */
  clearRegion(): void {
    const ctx = this.region.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#d6c4a0';
    ctx.fillRect(0, 0, this.region.width, this.region.height);
    const n = CORE_HALF / CHUNK;
    const col = new THREE.Color();
    for (let ci = -n; ci < n; ci += 1) {
      for (let cj = -n; cj < n; cj += 1) {
        const h = new Float32Array(LN * LN);
        const c = new Float32Array(LN * LN * 3);
        for (let j = 0; j < LN; j += 1) {
          for (let i = 0; i < LN; i += 1) {
            const x = ci * CHUNK + (i * CHUNK) / (LN - 1);
            const z = cj * CHUNK + (j * CHUNK) / (LN - 1);
            const k = j * LN + i;
            h[k] = this.terrain.getHeight(x, z);
            this.terrain.colorAt(x, z, h[k], this.terrain.getSlope(x, z), col);
            c.set([col.r, col.g, col.b], k * 3);
          }
        }
        this.paintChunk(ci, cj, h, c);
      }
    }
  }

  private toRegion(x: number, z: number): [number, number] {
    const s = this.region.width / (LIMIT * 2);
    return [(x + LIMIT) * s, (z + LIMIT) * s];
  }

  /** Paint one generated chunk onto the region map from its coarse heights and ground colours. */
  paintChunk(ci: number, cj: number, h: Float32Array, c: Float32Array): void {
    const ctx = this.region.getContext('2d') as CanvasRenderingContext2D;
    const [px0, py0] = this.toRegion(ci * CHUNK, cj * CHUNK);
    const [px1, py1] = this.toRegion((ci + 1) * CHUNK, (cj + 1) * CHUNK);
    const x0 = Math.floor(px0);
    const y0 = Math.floor(py0);
    const w = Math.max(1, Math.ceil(px1) - x0);
    const hgt = Math.max(1, Math.ceil(py1) - y0);
    if (x0 + w < 0 || y0 + hgt < 0 || x0 >= this.region.width || y0 >= this.region.height) return;
    const img = ctx.createImageData(w, hgt);
    const at = (arr: Float32Array, u: number, v: number, stride: number, off: number) => {
      const fu = Math.min(LN - 1.0001, Math.max(0, u * (LN - 1)));
      const fv = Math.min(LN - 1.0001, Math.max(0, v * (LN - 1)));
      const i = Math.floor(fu);
      const j = Math.floor(fv);
      const a = fu - i;
      const b = fv - j;
      const g = (ii: number, jj: number) => arr[(jj * LN + ii) * stride + off];
      return (g(i, j) * (1 - a) + g(i + 1, j) * a) * (1 - b) + (g(i, j + 1) * (1 - a) + g(i + 1, j + 1) * a) * b;
    };
    for (let y = 0; y < hgt; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const u = (x + 0.5) / w;
        const v = (y + 0.5) / hgt;
        const hh = at(h, u, v, 1, 0);
        const shade = Math.max(0.6, Math.min(1.25, 1 - (at(h, u + 1 / w, v, 1, 0) - hh + at(h, u, v + 1 / hgt, 1, 0) - hh) * 0.12));
        const contour = Math.abs((hh % 10) + 10) % 10 < 0.6 ? 0.88 : 1;
        const o = (y * w + x) * 4;
        // ground colour washed into parchment
        img.data[o] = Math.min(255, (at(c, u, v, 3, 0) * 255 * 0.6 + 214 * 0.4) * shade * contour);
        img.data[o + 1] = Math.min(255, (at(c, u, v, 3, 1) * 255 * 0.6 + 192 * 0.4) * shade * contour);
        img.data[o + 2] = Math.min(255, (at(c, u, v, 3, 2) * 255 * 0.6 + 150 * 0.4) * shade * contour);
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, x0, y0);
  }

  /** The lands: everything generated so far, under the fog of what has not been walked. */
  drawRegion(
    player: { x: number; z: number; yaw: number },
    objective: { x: number; z: number } | null,
    fog: Uint8Array,
    fogN: number,
    sites: { x: number; z: number; name: Text; kind: SiteKind }[],
    landmarks: { x: number; z: number; name: Text }[],
  ): void {
    const ctx = this.ctx;
    ctx.drawImage(this.region, 0, 0);
    // pass tracks
    ctx.strokeStyle = 'rgba(90,55,30,0.7)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 3]);
    for (const p of PASSES) {
      const [ax, ay] = this.toRegion(p.dx * 190, p.dz * 190);
      const [bx, by] = this.toRegion(p.dx * 640, p.dz * 640);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (this.regionFog.width !== fogN) {
      this.regionFog.width = fogN;
      this.regionFog.height = fogN;
    }
    const fctx = this.regionFog.getContext('2d') as CanvasRenderingContext2D;
    const img = fctx.createImageData(fogN, fogN);
    for (let i = 0; i < fog.length; i += 1) {
      const o = i * 4;
      img.data[o] = 214;
      img.data[o + 1] = 196;
      img.data[o + 2] = 160;
      img.data[o + 3] = fog[i] ? 0 : 245;
    }
    fctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.regionFog, 0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    // the home valley, named
    ctx.textAlign = 'center';
    ctx.font = '700 12px "El Messiri", serif';
    ctx.fillStyle = '#2a1a10';
    const [vx, vy] = this.toRegion(0, 0);
    ctx.fillText(tr({ en: 'Valley of Tadwart', ar: 'وادي تادوارت' }), vx, vy);
    for (const l of landmarks) {
      const [px, py] = this.toRegion(l.x, l.z);
      ctx.fillStyle = '#7a1717';
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }
    for (const s of sites) {
      const [px, py] = this.toRegion(s.x, s.z);
      ctx.fillStyle = SITE_COLOR[s.kind];
      ctx.strokeStyle = '#1a100a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = '700 11px "El Messiri", serif';
      ctx.fillStyle = '#2a1a10';
      ctx.fillText(tr(s.name), px, py + 16);
    }
    if (objective) {
      const [px, py] = this.toRegion(objective.x, objective.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#f2c14e';
      ctx.fillRect(-5, -5, 10, 10);
      ctx.strokeStyle = '#1a100a';
      ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();
    }
    const [px, py] = this.toRegion(player.x, player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-player.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1a100a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.lineTo(6, -6);
    ctx.lineTo(0, -2);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // frame
    ctx.strokeStyle = '#2a1a10';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, this.canvas.width - 6, this.canvas.height - 6);
  }

  /** Zone labels swap their primary language. */
  setLang(): void {
    this.paintBase(this.terrain);
  }

  private toPx(x: number, z: number): [number, number] {
    const s = this.canvas.width / (EXTENT * 2);
    return [(x + EXTENT) * s, (z + EXTENT) * s];
  }

  private paintBase(terrain: Terrain): void {
    const W = this.base.width;
    const ctx = this.base.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.createImageData(W, W);
    for (let py = 0; py < W; py += 1) {
      for (let px = 0; px < W; px += 1) {
        const x = (px / W) * EXTENT * 2 - EXTENT;
        const z = (py / W) * EXTENT * 2 - EXTENT;
        const h = terrain.getHeight(x, z);
        const hx = terrain.getHeight(x + 1.5, z) - h;
        const hz = terrain.getHeight(x, z + 1.5) - h;
        const shade = Math.max(0.55, Math.min(1.25, 1 - (hx + hz) * 0.35));
        let r = 196, g = 160, b = 116; // parchment ochre
        if (h > 30) { r = 170; g = 140; b = 112; }
        if (h > 80) { r = 225; g = 222; b = 214; }
        const oasis = zone('oasis');
        const wet = distToPolyline(x, z, OUED) < 9 || Math.hypot(x - oasis.x, z - oasis.z) < 26;
        if (wet) { r = 132; g = 156; b = 108; }
        else if (h < -1.2) { r = 182; g = 140; b = 100; }
        const contour = Math.abs((h % 6) + 6) % 6 < 0.35 ? 0.86 : 1;
        const o = (py * W + px) * 4;
        img.data[o] = Math.min(255, r * shade * contour);
        img.data[o + 1] = Math.min(255, g * shade * contour);
        img.data[o + 2] = Math.min(255, b * shade * contour);
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // oued
    ctx.strokeStyle = 'rgba(60,110,120,0.6)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    OUED.forEach(([x, z], i) => {
      const [px, py] = this.toPx(x, z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    // roads
    ctx.strokeStyle = 'rgba(90,55,30,0.75)';
    ctx.lineWidth = 2.4;
    for (const road of ROADS) {
      ctx.beginPath();
      road.forEach(([x, z], i) => {
        const [px, py] = this.toPx(x, z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    // zones
    ctx.textAlign = 'center';
    for (const zn of ZONES) {
      const [px, py] = this.toPx(zn.x, zn.z);
      ctx.fillStyle = zn.id === 'douar' ? 'rgba(47,154,104,0.25)' : zn.id === 'oasis' ? 'rgba(79,167,196,0.25)' : 'rgba(179,32,31,0.18)';
      ctx.strokeStyle = 'rgba(40,25,15,0.6)';
      ctx.lineWidth = 1.5;
      const half = zn.id === 'medina' ? 56 : zn.id === 'kasbah' ? 24 : zn.id === 'post' ? 34 : 18;
      const s = this.canvas.width / (EXTENT * 2);
      ctx.fillRect(px - half * s, py - half * s, half * 2 * s, half * 2 * s);
      ctx.strokeRect(px - half * s, py - half * s, half * 2 * s, half * 2 * s);
      ctx.fillStyle = '#2a1a10';
      const [first, second] = lang() === 'ar' ? [zn.arabic, zn.name] : [zn.name, zn.arabic];
      ctx.font = lang() === 'ar' ? '700 17px "El Messiri", serif' : '700 15px "El Messiri", serif';
      ctx.fillText(first, px, py + half * s + 16);
      ctx.font = '14px "Amiri", serif';
      ctx.fillText(second, px, py + half * s + 33);
    }
    // frame + compass rose
    ctx.strokeStyle = '#2a1a10';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, W - 6);
    ctx.font = '700 18px "El Messiri", serif';
    ctx.fillStyle = '#7a1717';
    ctx.fillText('N', W - 36, 40);
    ctx.beginPath();
    ctx.moveTo(W - 36, 46);
    ctx.lineTo(W - 42, 66);
    ctx.lineTo(W - 30, 66);
    ctx.fill();
  }

  draw(
    player: { x: number; z: number; yaw: number },
    objective: { x: number; z: number } | null,
    hideout: { x: number; z: number },
    foes: { x: number; z: number }[],
    fog: Uint8Array,
    fogN: number,
    landmarks: { x: number; z: number; name: Text }[],
  ): void {
    const ctx = this.ctx;
    ctx.drawImage(this.base, 0, 0);
    // fog of war: unexplored cells as aged parchment, blurred edges via bilinear upscale
    if (this.fogCanvas.width !== fogN) {
      this.fogCanvas.width = fogN;
      this.fogCanvas.height = fogN;
    }
    const fctx = this.fogCanvas.getContext('2d') as CanvasRenderingContext2D;
    const img = fctx.createImageData(fogN, fogN);
    for (let i = 0; i < fog.length; i += 1) {
      const o = i * 4;
      img.data[o] = 214;
      img.data[o + 1] = 196;
      img.data[o + 2] = 160;
      img.data[o + 3] = fog[i] ? 0 : 236;
    }
    fctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.fogCanvas, 0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    // landmarks the player has found
    ctx.textAlign = 'center';
    for (const l of landmarks) {
      const [px, py] = this.toPx(l.x, l.z);
      ctx.fillStyle = '#7a1717';
      ctx.beginPath();
      ctx.moveTo(px, py - 8);
      ctx.lineTo(px + 6, py + 4);
      ctx.lineTo(px - 6, py + 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#f1e8d4';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.font = '700 12px "El Messiri", serif';
      ctx.fillStyle = '#2a1a10';
      ctx.fillText(tr(l.name), px, py + 18);
    }
    const dot = (x: number, z: number, color: string, r: number) => {
      const [px, py] = this.toPx(x, z);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1a100a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    dot(hideout.x, hideout.z, '#2f9a68', 7);
    for (const f of foes) dot(f.x, f.z, '#d0553a', 4);
    if (objective) {
      const [px, py] = this.toPx(objective.x, objective.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#f2c14e';
      ctx.fillRect(-7, -7, 14, 14);
      ctx.strokeStyle = '#1a100a';
      ctx.strokeRect(-7, -7, 14, 14);
      ctx.restore();
    }
    const [px, py] = this.toPx(player.x, player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-player.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1a100a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(7, -7);
    ctx.lineTo(0, -3);
    ctx.lineTo(-7, -7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
