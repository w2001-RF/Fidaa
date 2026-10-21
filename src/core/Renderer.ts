import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Count every pass of a frame (shadow + main + post), reset manually in the loop.
  renderer.info.autoReset = false;
  return renderer;
}

/** True when WebGL runs on a CPU rasteriser (CI machines, blocklisted GPUs). */
export function isSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  return /swiftshader|llvmpipe|software|basic render/i.test(name);
}

export type Quality = 'high' | 'medium' | 'low';

/** Warm film grade + vignette in one pass (keeps the post budget at 2 passes). */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.75 },
    uWarm: { value: 0.06 },
    uDamage: { value: 0 },
    uDesat: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVignette, uWarm, uDamage, uDesat; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= mix(1.0, smoothstep(0.85, 0.28, d), uVignette * 0.55);
      c.rgb += vec3(uWarm, uWarm * 0.45, -uWarm * 0.3) * c.rgb;
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(c.rgb, vec3(l), uDesat);
      c.rgb = mix(c.rgb, vec3(l * 1.2, l * 0.15, l * 0.1), uDamage * smoothstep(0.2, 0.75, d));
      gl_FragColor = c;
    }`,
};

export class RenderPipeline {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;
  maxDpr = 1.75;
  quality: Quality = 'high';

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    readonly camera: THREE.PerspectiveCamera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.32, 0.35, 0.92);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  /** Resolution scale and bloom per preset; the next resize() applies the new DPR. */
  setQuality(q: Quality): void {
    this.quality = q;
    this.maxDpr = q === 'high' ? 1.75 : q === 'medium' ? 1.25 : 0.75;
    this.bloom.enabled = q !== 'low';
  }

  resize(): boolean {
    const canvas = this.renderer.domElement;
    const width = Math.max(1, Math.floor(canvas.clientWidth));
    const height = Math.max(1, Math.floor(canvas.clientHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const bw = Math.floor(width * dpr);
    const bh = Math.floor(height * dpr);
    if (canvas.width === bw && canvas.height === bh) return false;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
    // bloom at reduced resolution
    this.bloom.resolution.set(width * 0.5, height * 0.5);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    return true;
  }

  render(): void {
    this.renderer.info.reset();
    this.composer.render();
  }
}
