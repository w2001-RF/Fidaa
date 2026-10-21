/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  score: number;
  targetScore: number;
  complete: boolean;
  player: {
    position: { x: number; y: number; z: number };
    speed: number;
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
  game?: Record<string, unknown>;
}

interface ThreeGameTestHooks {
  /** Re-seed the game RNG; all gameplay randomness must flow through it. */
  seed(value: number): void | Promise<void>;
  /** Acknowledge after setup/assets are ready; throw for unknown states. */
  setState(name: string): { state: string } | Promise<{ state: string }>;
  /** Stop simulation/state transitions immediately; keep rendering. Await optional synchronization. */
  setPausedForScreenshot(paused: boolean): void | Promise<void>;
  /** Stabilize ambient/idle visuals without requiring an unpaused simulation tick. */
  setReducedMotion(enabled: boolean): void | Promise<void>;
  /** Hide debug UI (lil-gui) before capturing. */
  hideDebugUi(hidden: boolean): void | Promise<void>;
  lookAt?(x: number, z: number): void;
  targets?(): Record<string, { x: number; z: number }>;
  teleport?(x: number, z: number): void;
  setHour?(h: number): void;
  input?(action: string, down: boolean): void;
  give?(items: Record<string, number>): void;
  step?(seconds: number): void;
  grantWeapon?(weapon: string): void;
  landmarks?(): { id: string; x: number; z: number }[];
  setLang?(lang: string): void;
  animals?(): { id: string; species: string; x: number; y: number; z: number; alive: boolean; skinned: boolean }[];
  aimAt?(x: number, y: number, z: number): void;
  rides?(): { kind: string; x: number; y: number; z: number; speed: number; flying: boolean; crashed: boolean; reason?: string; yaw: number; pitch: number; roll: number; gamma: number; beta: number; stalled: boolean }[];
  ceasefire?(on: boolean): void;
  /** the Criquet's instruments, plus how far the flaps have travelled (0..1) */
  gauges?(): { speed: number; alt: number; vs: number; throttle: number; stall: boolean; brake: boolean; rpm: number; engine: 'off' | 'starting' | 'on'; flaps: number; trim: number; heading: number; flapPos: number };
  pilot?(x: number, alt: number, z: number, yaw: number, speed: number, flaps?: number): void;
  save?(): Promise<string>;
  bolts?(): { x: number; y: number; z: number }[];
  /** where a loaded weapon model sits in gun space (size, min, max); null while the procedural one is used */
  weaponModel?(kind: string): { size: number[]; min: number[]; max: number[] } | null;
  arrows?(): { x: number; y: number; z: number }[];
  camp?(): { kind: string; x: number; z: number; ix: number; iz: number }[];
  colliders?(x: number, z: number, r: number): { tag: string; x: number; z: number; r: number; top: number }[];
  harvestables?(kind: string): { id: number; x: number; z: number; scale: number }[];
  stress?(radius: number): void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
