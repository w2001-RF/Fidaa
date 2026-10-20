import * as THREE from 'three';
import { PeriodicNoise, clamp } from '../utils/noise';
import { createSeededRandom } from '../utils/random';

export type MaterialRole =
  | 'plaster'
  | 'pise'
  | 'wood'
  | 'metal'
  | 'tile'
  | 'fabric'
  | 'stone'
  | 'foliage'
  | 'dark'
  | 'glow'
  | 'paper'
  | 'iron';

/**
 * Shared material roles (technical-art.md "material kit"). Every mesh that
 * plays the same part reuses one material; tint comes from vertex colours.
 */
export class MaterialLibrary {
  readonly materials: Record<MaterialRole, THREE.Material>;
  /** Night factor drives lantern/window glow. */
  private readonly glow: THREE.MeshStandardMaterial;

  constructor() {
    const plasterTex = makeTexture(256, (ctx, size, rng, noise) => {
      paintNoise(ctx, size, noise, 0.88, 0.07, 0.05);
      // hairline cracks and trowel marks
      ctx.strokeStyle = 'rgba(70,40,25,0.22)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i += 1) {
        let x = rng() * size;
        let y = rng() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let s = 0; s < 6; s += 1) {
          x += (rng() - 0.5) * 26;
          y += rng() * 18;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,240,220,0.06)';
      for (let i = 0; i < 40; i += 1) ctx.fillRect(rng() * size, rng() * size, 30 + rng() * 50, 3 + rng() * 5);
    });

    const piseTex = makeTexture(256, (ctx, size, rng, noise) => {
      paintNoise(ctx, size, noise, 0.86, 0.08, 0.06);
      // rammed-earth formwork courses + putlog holes
      for (let y = 0; y < size; y += 43) {
        ctx.fillStyle = 'rgba(60,30,15,0.20)';
        ctx.fillRect(0, y, size, 2);
        ctx.fillStyle = 'rgba(255,230,200,0.08)';
        ctx.fillRect(0, y + 2, size, 2);
        for (let x = 20 + rng() * 60; x < size; x += 120 + rng() * 80) {
          ctx.fillStyle = 'rgba(30,15,8,0.45)';
          ctx.fillRect(x, y + 7, 4, 4);
        }
      }
      ctx.fillStyle = 'rgba(80,40,20,0.10)';
      for (let i = 0; i < 300; i += 1) ctx.fillRect(rng() * size, rng() * size, 2, 2);
    });

    const woodTex = makeTexture(128, (ctx, size, rng) => {
      ctx.fillStyle = '#bfa080';
      ctx.fillRect(0, 0, size, size);
      for (let x = 0; x < size; x += 1) {
        const v = 0.75 + Math.sin(x * 0.45 + Math.sin(x * 0.07) * 4) * 0.1 + rng() * 0.08;
        ctx.fillStyle = `rgba(70,40,20,${clamp(1 - v, 0, 1)})`;
        ctx.fillRect(x, 0, 1, size);
      }
      ctx.fillStyle = 'rgba(40,20,10,0.35)';
      for (let x = 0; x < size; x += 32) ctx.fillRect(x, 0, 2, size); // plank seams
    });

    const zelligeTex = makeTexture(256, (ctx, size) => {
      // eight-pointed star zellige tiling in green / white / indigo / ochre
      ctx.fillStyle = '#eee6d4';
      ctx.fillRect(0, 0, size, size);
      const cell = size / 4;
      for (let gy = 0; gy < 4; gy += 1) {
        for (let gx = 0; gx < 4; gx += 1) {
          const cx = gx * cell + cell / 2;
          const cy = gy * cell + cell / 2;
          const odd = (gx + gy) % 2 === 0;
          drawStar(ctx, cx, cy, cell * 0.46, cell * 0.3, 8, odd ? '#1f6b4e' : '#20406e');
          drawStar(ctx, cx, cy, cell * 0.2, cell * 0.12, 8, '#d79a3b');
          ctx.fillStyle = '#7a1f22';
          ctx.beginPath();
          ctx.arc(gx * cell, gy * cell, cell * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.strokeStyle = 'rgba(30,25,20,0.5)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i * cell, 0);
        ctx.lineTo(i * cell, size);
        ctx.moveTo(0, i * cell);
        ctx.lineTo(size, i * cell);
        ctx.stroke();
      }
    });

    const metalTex = makeTexture(128, (ctx, size, rng) => {
      // corrugation + rust streaks
      for (let x = 0; x < size; x += 1) {
        const v = 0.72 + Math.sin((x / size) * Math.PI * 16) * 0.18;
        const g = Math.round(v * 255);
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect(x, 0, 1, size);
      }
      for (let i = 0; i < 18; i += 1) {
        ctx.fillStyle = `rgba(130,60,20,${0.15 + rng() * 0.25})`;
        ctx.fillRect(rng() * size, rng() * size * 0.5, 2 + rng() * 4, 20 + rng() * 60);
      }
    });

    const fabricTex = makeTexture(128, (ctx, size, rng) => {
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < size; i += 2) {
        ctx.fillStyle = `rgba(0,0,0,${0.04 + rng() * 0.05})`;
        ctx.fillRect(i, 0, 1, size);
        ctx.fillRect(0, i, size, 1);
      }
    });

    const stoneTex = makeTexture(128, (ctx, size, _rng, noise) => paintNoise(ctx, size, noise, 0.82, 0.18, 0.04));

    const paperTex = makeLeafletTexture();

    this.glow = new THREE.MeshStandardMaterial({
      color: '#2a1a0a',
      emissive: '#ffb347',
      emissiveIntensity: 0.2,
      roughness: 0.6,
    });

    const std = (params: THREE.MeshStandardMaterialParameters) =>
      new THREE.MeshStandardMaterial({ vertexColors: true, color: '#ffffff', ...params });

    this.materials = {
      plaster: std({ map: plasterTex, roughness: 0.92 }),
      pise: std({ map: piseTex, roughness: 0.97 }),
      wood: std({ map: woodTex, roughness: 0.82 }),
      metal: std({ map: metalTex, roughness: 0.5, metalness: 0.55 }),
      tile: std({ map: zelligeTex, roughness: 0.22, metalness: 0.05 }),
      fabric: std({ map: fabricTex, roughness: 0.95, side: THREE.DoubleSide }),
      stone: std({ map: stoneTex, roughness: 0.9 }),
      foliage: std({ roughness: 0.85, side: THREE.DoubleSide }),
      dark: std({ roughness: 0.95 }),
      glow: this.glow,
      paper: new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.9, side: THREE.DoubleSide }),
      iron: std({ roughness: 0.45, metalness: 0.8 }),
    };
  }

  setNightFactor(night: number): void {
    this.glow.emissiveIntensity = 0.25 + night * 3.2;
  }
}

type Painter = (ctx: CanvasRenderingContext2D, size: number, rng: () => number, noise: PeriodicNoise) => void;

let textureSeed = 11;
function makeTexture(size: number, paint: Painter): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  textureSeed += 1;
  paint(ctx, size, createSeededRandom(textureSeed), new PeriodicNoise(textureSeed));
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function paintNoise(ctx: CanvasRenderingContext2D, size: number, noise: PeriodicNoise, base: number, amp: number, fine: number): void {
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const n = noise.fbm(u, v, 4, 4);
      const f = noise.fbm(u, v, 32, 2);
      const val = clamp(base + n * amp * 2 + f * fine * 2, 0, 1);
      const o = (y * size + x) * 4;
      img.data[o] = Math.round(val * 255);
      img.data[o + 1] = Math.round(val * 250);
      img.data[o + 2] = Math.round(val * 244);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
  color: string,
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Independence leaflet: hand-printed tract with Arabic and French text. */
function makeLeafletTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 360;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#efe6cf';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(120,90,50,0.15)';
  for (let i = 0; i < 400; i += 1) ctx.fillRect((i * 97) % w, (i * 53) % h, 2, 2);
  ctx.fillStyle = '#9c1c1c';
  ctx.fillRect(14, 14, w - 28, 70);
  // green pentagram (Moroccan flag, 1915)
  ctx.strokeStyle = '#1d6b3a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i <= 5; i += 1) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    const x = w / 2 + Math.cos(a) * 26;
    const y = 49 + Math.sin(a) * 26;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#1b140c';
  ctx.textAlign = 'center';
  ctx.font = 'bold 30px serif';
  ctx.fillText('الاستقلال', w / 2, 130);
  ctx.font = 'bold 20px serif';
  ctx.fillText('INDÉPENDANCE', w / 2, 162);
  ctx.font = '14px serif';
  const lines = ['Le peuple marocain', 'réclame sa liberté', '— 11 janvier 1944 —', '', 'عاش المغرب حرا', 'Vive le Maroc libre'];
  lines.forEach((line, i) => ctx.fillText(line, w / 2, 200 + i * 24));
  ctx.strokeStyle = '#1b140c';
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
