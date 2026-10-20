import * as THREE from 'three';
import { clamp, smoothstep } from '../utils/noise';
import { createSeededRandom } from '../utils/random';

type Key = { h: number; top: string; horizon: string; fog: string; key: string; keyI: number; hemiSky: string; hemiGround: string; hemiI: number; exposure: number };

// Time-of-day palette keys (hour → colours). Golden hour is deliberately long: it is the game's signature look.
const KEYS: Key[] = [
  { h: 0, top: '#03060f', horizon: '#141b30', fog: '#121827', key: '#8fa6d8', keyI: 0.32, hemiSky: '#2c3a63', hemiGround: '#120e0c', hemiI: 0.34, exposure: 1.05 },
  { h: 4.8, top: '#070b1a', horizon: '#1f2540', fog: '#1a1f33', key: '#8fa6d8', keyI: 0.3, hemiSky: '#2c3a63', hemiGround: '#120e0c', hemiI: 0.32, exposure: 1.05 },
  { h: 6.0, top: '#2b3a63', horizon: '#e0895a', fog: '#b58572', key: '#ffb27a', keyI: 1.2, hemiSky: '#8c96b8', hemiGround: '#5a3a28', hemiI: 0.7, exposure: 1.0 },
  { h: 8.0, top: '#4b79b8', horizon: '#f0cfa6', fog: '#d9c0a0', key: '#fff0d6', keyI: 2.6, hemiSky: '#bcd2ef', hemiGround: '#7a5a3e', hemiI: 1.0, exposure: 0.95 },
  { h: 12.5, top: '#3a6fbf', horizon: '#d3e2ee', fog: '#d8d5c8', key: '#fff7e8', keyI: 3.1, hemiSky: '#c6dcf5', hemiGround: '#8a6444', hemiI: 1.1, exposure: 0.9 },
  { h: 16.0, top: '#4570b0', horizon: '#f1d09a', fog: '#e2c49a', key: '#ffe2b0', keyI: 2.8, hemiSky: '#b8cbe6', hemiGround: '#8a5a3a', hemiI: 1.0, exposure: 0.95 },
  { h: 18.2, top: '#34457a', horizon: '#f08a4a', fog: '#d39470', key: '#ff9a52', keyI: 2.0, hemiSky: '#9aa2c8', hemiGround: '#6a3a24', hemiI: 0.85, exposure: 1.0 },
  { h: 19.4, top: '#141c3c', horizon: '#7a4a5a', fog: '#4a3a48', key: '#c78a7a', keyI: 0.7, hemiSky: '#4a4e78', hemiGround: '#2a1a14', hemiI: 0.6, exposure: 1.1 },
  { h: 20.6, top: '#05081a', horizon: '#1d2040', fog: '#161a2c', key: '#8fa6d8', keyI: 0.32, hemiSky: '#2c3a63', hemiGround: '#120e0c', hemiI: 0.34, exposure: 1.05 },
  { h: 24, top: '#03060f', horizon: '#141b30', fog: '#121827', key: '#8fa6d8', keyI: 0.32, hemiSky: '#2c3a63', hemiGround: '#120e0c', hemiI: 0.34, exposure: 1.05 },
];

const HOURS_PER_SECOND = 24 / 480; // 8-minute day

/**
 * Day/night cycle: sky dome, sun & moon (one shadow-casting key light that
 * swaps role at the horizon), hemisphere fill, stars and fog.
 */
export class Sky {
  hour = 16.5;
  readonly key = new THREE.DirectionalLight('#ffffff', 2);
  readonly hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  readonly group = new THREE.Group();
  readonly sunDir = new THREE.Vector3();
  night = 0;
  exposure = 1;
  private readonly dome: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly moon: THREE.Mesh;
  private readonly uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color('#fff2cc') },
    uNight: { value: 0 },
  };
  private readonly fog: THREE.Fog;
  private readonly tmpA = new THREE.Color();
  private readonly tmpB = new THREE.Color();

  constructor(private readonly scene: THREE.Scene) {
    this.fog = new THREE.Fog('#d8c0a0', 60, 520);
    scene.fog = this.fog;

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: `varying vec3 vDir;
          void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
        fragmentShader: `varying vec3 vDir;
          uniform vec3 uTop, uHorizon, uSunColor, uSunDir; uniform float uNight;
          void main(){
            vec3 d = normalize(vDir);
            float h = clamp(d.y, -0.2, 1.0);
            vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.55));
            col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.2, h));
            float s = max(dot(d, normalize(uSunDir)), 0.0);
            float day = 1.0 - uNight;
            col += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35 + pow(s, 3.0) * 0.12) * day;
            // warm haze band on the horizon
            col += uSunColor * 0.08 * (1.0 - abs(h)) * day * pow(s, 1.5);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.group.add(this.dome);

    const rng = createSeededRandom(8);
    const starPos: number[] = [];
    for (let i = 0; i < 1600; i += 1) {
      const u = rng() * 2 - 1;
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      if (u < 0.05) continue;
      starPos.push(Math.cos(a) * r * 1300, u * 1300, Math.sin(a) * r * 1300);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#dfe6ff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    this.moon = new THREE.Mesh(new THREE.CircleGeometry(26, 32), new THREE.MeshBasicMaterial({ color: '#f4f1e2', fog: false, transparent: true }));
    this.group.add(this.moon);

    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const cam = this.key.shadow.camera;
    cam.left = -62;
    cam.right = 62;
    cam.top = 62;
    cam.bottom = -62;
    cam.near = 1;
    cam.far = 400;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.04;
    scene.add(this.key, this.key.target, this.hemi, this.group);
  }

  advance(dt: number): void {
    this.hour = (this.hour + dt * HOURS_PER_SECOND) % 24;
  }

  setHour(h: number): void {
    this.hour = ((h % 24) + 24) % 24;
  }

  isNight(): boolean {
    return this.night > 0.5;
  }

  update(focus: THREE.Vector3, camera: THREE.Camera): void {
    const h = this.hour;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i += 1;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = clamp((h - a.h) / (b.h - a.h), 0, 1);
    const mix = (x: string, y: string) => this.tmpA.set(x).lerp(this.tmpB.set(y), t);

    this.uniforms.uTop.value.copy(mix(a.top, b.top));
    this.uniforms.uHorizon.value.copy(mix(a.horizon, b.horizon));
    this.fog.color.copy(mix(a.fog, b.fog));
    this.scene.background = null;

    // Sun path: rises in the east (+x), sets in the west (-x), slightly south.
    const dayT = (h - 6) / 12; // 0 at 6h, 1 at 18h
    const el = Math.sin(dayT * Math.PI) * 1.05;
    const az = dayT * Math.PI;
    this.sunDir.set(Math.cos(az), Math.sin(el) * 0.95 + 0.02, 0.35).normalize();
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.night = 1 - smoothstep(-0.12, 0.1, this.sunDir.y);
    this.uniforms.uNight.value = this.night;
    this.uniforms.uSunColor.value.set(mix(a.key, b.key));

    // Moon opposite-ish the sun, high in the night sky
    const moonDir = new THREE.Vector3(-this.sunDir.x * 0.6, Math.max(0.35, -this.sunDir.y + 0.3), -0.45).normalize();
    this.moon.position.copy(camera.position).addScaledVector(moonDir, 1200);
    this.moon.lookAt(camera.position);
    (this.moon.material as THREE.MeshBasicMaterial).opacity = this.night;
    (this.stars.material as THREE.PointsMaterial).opacity = this.night * 0.9;
    this.dome.position.copy(camera.position);
    this.stars.position.copy(camera.position);

    // Key light: sun by day, moon by night (never below horizon)
    const lightDir = this.night > 0.5 ? moonDir : this.sunDir.clone().setY(Math.max(this.sunDir.y, 0.08)).normalize();
    this.key.color.copy(mix(a.key, b.key));
    this.key.intensity = THREE.MathUtils.lerp(a.keyI, b.keyI, t);
    this.key.position.copy(focus).addScaledVector(lightDir, 160);
    this.key.target.position.copy(focus);
    this.key.target.updateMatrixWorld();

    this.hemi.color.copy(mix(a.hemiSky, b.hemiSky));
    this.hemi.groundColor.copy(mix(a.hemiGround, b.hemiGround));
    this.hemi.intensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, t);
    this.exposure = THREE.MathUtils.lerp(a.exposure, b.exposure, t);

    this.fog.near = THREE.MathUtils.lerp(70, 30, this.night);
    this.fog.far = THREE.MathUtils.lerp(560, 260, this.night);
  }

  /** "16:45" */
  clock(): string {
    const hh = Math.floor(this.hour);
    const mm = Math.floor((this.hour - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}
