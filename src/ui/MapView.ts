import { ROADS, ZONES, OUED, distToPolyline, zone } from '../world/layout';
import type { Terrain } from '../world/Terrain';

const EXTENT = 250;

/** Hand-drawn-style survey map: hillshaded terrain, roads, zones, markers. */
export class MapView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;

  constructor(terrain: Terrain) {
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
      ctx.font = '700 15px "El Messiri", serif';
      ctx.fillText(zn.name, px, py + half * s + 16);
      ctx.font = '15px "Amiri", serif';
      ctx.fillText(zn.arabic, px, py + half * s + 33);
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

  draw(player: { x: number; z: number; yaw: number }, objective: { x: number; z: number } | null, hideout: { x: number; z: number }, foes: { x: number; z: number }[]): void {
    const ctx = this.ctx;
    ctx.drawImage(this.base, 0, 0);
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
