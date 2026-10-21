/**
 * Keyboard + mouse intents. `held` for continuous actions, `pressed` for
 * edge-triggered ones (cleared by endFrame()). Mouse look accumulates while
 * the pointer is locked to the canvas.
 */
export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'crouch'
  | 'jump'
  | 'attack'
  | 'aim'
  | 'reload'
  | 'interact'
  | 'weapon1'
  | 'weapon2'
  | 'weapon3'
  | 'weapon4'
  | 'weapon5'
  | 'weapon6'
  | 'weapon7'
  | 'weapon8'
  | 'view'
  | 'lookBack'
  | 'craft'
  | 'drink'
  | 'eat'
  | 'heal'
  | 'inventory'
  | 'map'
  | 'pause'
  | 'journal';

const KEYMAP: Record<string, Action> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyC: 'crouch',
  ControlLeft: 'crouch',
  Space: 'jump',
  KeyR: 'reload',
  KeyE: 'interact',
  Digit1: 'weapon1',
  Digit2: 'weapon2',
  Digit3: 'weapon3',
  Digit4: 'weapon4',
  Digit5: 'weapon5',
  Digit6: 'weapon6',
  Digit7: 'weapon7',
  Digit8: 'weapon8',
  KeyK: 'craft',
  KeyV: 'view',
  KeyB: 'lookBack',
  KeyQ: 'drink',
  KeyF: 'eat',
  KeyH: 'heal',
  Tab: 'inventory',
  KeyI: 'inventory',
  KeyM: 'map',
  Escape: 'pause',
  KeyP: 'pause',
  KeyJ: 'journal',
};

export class Input {
  private readonly held = new Set<Action>();
  private readonly pressedSet = new Set<Action>();
  /** physical keys by `KeyboardEvent.code`, for the cockpit (numpad stick, flaps, trim, engine) */
  private readonly keys = new Set<string>();
  private readonly keysPressed = new Set<string>();
  lookX = 0;
  lookY = 0;
  wheel = 0;
  locked = false;
  /** When true (menus open) gameplay ignores input but UI keys still register. */
  onLockChange: ((locked: boolean) => void) | null = null;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!e.repeat) this.keysPressed.add(e.code);
    this.keys.add(e.code);
    if (e.code.startsWith('Numpad')) e.preventDefault();
    const a = KEYMAP[e.code];
    if (!a) return;
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'ControlLeft') e.preventDefault();
    if (!e.repeat) this.pressedSet.add(a);
    this.held.add(a);
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    const a = KEYMAP[e.code];
    if (a) this.held.delete(a);
  };

  private readonly onMouseDown = (e: MouseEvent) => {
    if (!this.locked) return;
    if (e.button === 0) {
      this.held.add('attack');
      this.pressedSet.add('attack');
    } else if (e.button === 2) {
      this.held.add('aim');
      this.pressedSet.add('aim');
    }
  };

  private readonly onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.held.delete('attack');
    else if (e.button === 2) this.held.delete('aim');
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  };

  private readonly onWheel = (e: WheelEvent) => {
    if (this.locked) this.wheel += Math.sign(e.deltaY);
  };

  private readonly onLock = () => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) {
      this.held.delete('attack');
      this.held.delete('aim');
    }
    this.onLockChange?.(this.locked);
  };

  private readonly onBlur = () => {
    this.held.clear();
    this.keys.clear();
  };

  private readonly onContext = (e: Event) => e.preventDefault();

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLock);
    canvas.addEventListener('contextmenu', this.onContext);
  }

  requestLock(): void {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const r = this.canvas.requestPointerLock() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch {
      // pointer lock can be refused (e.g. headless tests); gameplay still works with keys
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Physical key held, by `KeyboardEvent.code` (e.g. 'Numpad8', 'KeyF'). */
  keyHeld(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  keyPressed(...codes: string[]): boolean {
    return codes.some((c) => this.keysPressed.has(c));
  }

  isHeld(a: Action): boolean {
    return this.held.has(a);
  }

  wasPressed(a: Action): boolean {
    return this.pressedSet.has(a);
  }

  /** Synthetic intents for tests/bots. */
  press(a: Action, down: boolean): void {
    if (down) {
      if (!this.held.has(a)) this.pressedSet.add(a);
      this.held.add(a);
    } else this.held.delete(a);
  }

  consumeLook(): [number, number] {
    const v: [number, number] = [this.lookX, this.lookY];
    this.lookX = 0;
    this.lookY = 0;
    return v;
  }

  endFrame(): void {
    this.pressedSet.clear();
    this.keysPressed.clear();
    this.wheel = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLock);
    this.canvas.removeEventListener('contextmenu', this.onContext);
  }
}
