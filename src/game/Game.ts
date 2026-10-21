import * as THREE from 'three';
import { Input } from '../core/Input';
import { Loop } from '../core/Loop';
import { RenderPipeline, createRenderer, isSoftwareRenderer, type Quality } from '../core/Renderer';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MaterialLibrary } from '../assets/Materials';
import { Enemy, type EnemyContext, type ShotRequest } from '../entities/Enemy';
import { Npc } from '../entities/Npc';
import { Player, type Skill } from '../entities/Player';
import { AudioSystem } from '../systems/Audio';
import { CameraRig } from '../systems/CameraRig';
import { Vfx } from '../systems/Vfx';
import { Hud, type AlertLevel, type CompassMarker, type Indicator } from '../ui/Hud';
import { MapView } from '../ui/MapView';
import { clamp } from '../utils/noise';
import { createSeededRandom } from '../utils/random';
import { NavGrid } from '../world/NavGrid';
import { Sky } from '../world/Sky';
import { Vegetation } from '../world/Vegetation';
import { World } from '../world/World';
import { zone } from '../world/layout';
import { lang, onLangChange, setLang, t, tr, trAlt, type Lang } from '../i18n';
import { ITEMS, RECIPES, SKILL_MAX, WEAPONS, WEAPON_ORDER, emptyInventory, type Recipe, type WeaponId } from './Items';
import { AMBIENT_LINES, MISSIONS, QuestSystem, type Line } from './Quests';
import type { Interactable, ItemId, LootBundle } from './types';

type GameState = 'title' | 'playing' | 'paused' | 'dialogue' | 'panel' | 'map' | 'dead' | 'victory';

const LIGHT_POOL = 5;
/** Map fog-of-war grid over the ±250 m map extent. */
const FOG_N = 96;
const FOG_EXTENT = 250;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly pipeline: RenderPipeline;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 2600);
  private readonly lib: MaterialLibrary;
  private readonly world: World;
  private readonly sky: Sky;
  private readonly veg: Vegetation;
  private readonly nav: NavGrid;
  private readonly player = new Player();
  private readonly enemies: Enemy[] = [];
  private readonly npcs: Npc[] = [];
  private readonly vfx = new Vfx();
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly map: MapView;
  private readonly quests = new QuestSystem();
  private readonly input: Input;
  private readonly camRig: CameraRig;
  private readonly loop: Loop;
  private readonly lights: THREE.PointLight[] = [];
  private readonly carryCrate: THREE.Mesh;

  private state: GameState = 'title';
  private frame = 0;
  private elapsed = 0;
  private gameTime = 0;
  private rng = createSeededRandom(1945);
  private pausedForScreenshot = false;
  private reducedMotion = false;

  private interactTarget: Interactable | null = null;
  private interactProgress = 0;
  private readonly usedInteractables = new Set<string>();
  private dialogueLines: Line[] = [];
  private dialogueIdx = 0;
  private dialogueNpc = '';
  private dialogueQuest = false;
  private alertLevel: AlertLevel = 'hidden';
  private concealed = false;
  private concealT = 0;
  private lightT = 0;
  private stats = { kills: 0, takedowns: 0, shots: 0, startDay: 0 };
  private carrying = false;
  private prisonOpened = false;
  private victoryShown = false;
  private victoryAt = -1;
  private hourAtStart = 16.5;
  private daysPassed = 0;
  private lastHour = 16.5;
  private panelTab = 'inv';
  /** Landmark and zone ids the player has found. */
  private readonly discovered = new Set<string>();
  readonly fog = new Uint8Array(FOG_N * FOG_N);
  private exploreT = 0;
  private readonly software: boolean;
  private autoFireT = 0;

  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly ctx: EnemyContext;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    parts: { lib: MaterialLibrary; world: World; veg: Vegetation; nav: NavGrid },
  ) {
    this.lib = parts.lib;
    this.renderer = createRenderer(canvas);
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera);
    this.software = isSoftwareRenderer(this.renderer);
    // CPU rasterisers (CI runners, blocklisted GPUs): drop the shadow pass before anything compiles
    if (this.software) this.renderer.shadowMap.enabled = false;
    this.pipeline.setQuality(this.loadQuality() ?? (this.software ? 'low' : 'high'));
    if (this.software) this.pipeline.maxDpr = 0.5;
    this.input = new Input(canvas);
    this.camRig = new CameraRig(this.camera);

    // world
    this.world = parts.world;
    this.scene.add(this.world.group);
    this.sky = new Sky(this.scene);
    this.sky.setHour(this.hourAtStart);
    this.veg = parts.veg;
    this.scene.add(this.veg.group);
    this.nav = parts.nav;
    this.scene.add(this.vfx.group);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    for (let i = 0; i < LIGHT_POOL; i += 1) {
      const l = new THREE.PointLight('#ffa64a', 0, 22, 1.6);
      this.lights.push(l);
      this.scene.add(l);
    }

    // characters
    this.scene.add(this.player.group);
    this.player.onFootstep = (loud) => this.onFootstep(loud);
    for (const s of this.world.enemySpawns) {
      const e = new Enemy(s);
      e.onAlert = (en) => this.onEnemyAlert(en);
      e.onShoot = (req) => this.onEnemyShot(req);
      e.onMelee = (en) => this.onEnemyMelee(en);
      this.enemies.push(e);
      this.scene.add(e.rig.root);
    }
    for (const s of this.world.npcSpawns) {
      const n = new Npc(s);
      this.npcs.push(n);
      this.scene.add(n.rig.root);
    }
    // body interactables (enabled on death)
    for (const e of this.enemies) {
      this.world.interactables.push({ id: `body-${e.spawn.id}`, kind: 'body', pos: e.pos, radius: 1.9, prompt: { en: `Search the ${e.label.en}`, ar: `فتّش ${e.label.ar}` }, hold: 0.8, enabled: false, ref: e.spawn.id });
    }

    this.carryCrate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.32), new THREE.MeshStandardMaterial({ color: '#4f5a35', roughness: 0.8 }));
    this.carryCrate.position.set(0, 0.1, -0.3);
    this.carryCrate.visible = false;
    this.player.rig.chestBone.add(this.carryCrate);

    this.map = new MapView(this.world.terrain);

    this.ctx = {
      terrain: this.world.terrain,
      collision: this.world.collision,
      nav: this.nav,
      night: 0,
      now: 0,
      rng: this.rng,
      playerPos: this.player.pos,
      playerChest: new THREE.Vector3(),
      playerHead: new THREE.Vector3(),
      playerStealth: 1,
      playerConcealed: false,
      playerDead: false,
      pathBudget: { left: 4 },
    };

    this.respawnPlayer(true);
    // the douar is home: known from the start
    this.revealFog(this.world.hideout.x, this.world.hideout.z, 70);
    this.audio.voiceLang = lang();
    this.bindUi();
    this.refreshQualityLabel();
    this.loop = new Loop(
      (dt, t) => this.update(dt, t),
      () => this.pipeline.render(),
    );
    this.pipeline.resize();
    this.installTestHooks();
    this.publishDiagnostics();
    if (import.meta.env.DEV) (window as unknown as { __GAME_SCENE__: THREE.Scene }).__GAME_SCENE__ = this.scene;
  }

  start(): void {
    this.loop.start();
  }

  /** Compile every material once so the first frames of play do not hitch. */
  warmUp(): void {
    this.renderer.compile(this.scene, this.camera);
    this.pipeline.render();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  // ================================================================ UI wiring

  private bindUi(): void {
    const on = (sel: string, fn: () => void) => document.querySelector(sel)?.addEventListener('click', () => {
      this.audio.ui();
      fn();
    });
    on('#btn-start', () => this.beginPlay());
    on('#btn-resume', () => this.resume());
    on('#btn-retry', () => this.retry());
    on('#btn-restart', () => {
      this.retry();
    });
    on('#btn-continue', () => {
      document.querySelector('#victory-screen')?.classList.add('hidden');
      this.resume();
    });
    on('#btn-close-panel', () => this.closeOverlay());
    on('#btn-quality', () => {
      const order: Quality[] = ['high', 'medium', 'low'];
      const next = order[(order.indexOf(this.pipeline.quality) + 1) % order.length];
      this.pipeline.setQuality(next);
      try {
        window.localStorage.setItem('fidai-quality', next);
      } catch {
        // not persisted
      }
      this.refreshQualityLabel();
    });
    on('#btn-mute', () => {
      this.audio.setMuted(!this.audio.muted);
      this.refreshMuteLabel();
    });
    document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => {
        this.audio.ui();
        setLang(b.dataset.lang as Lang);
      }),
    );
    document.querySelectorAll<HTMLButtonElement>('.btn-fullscreen').forEach((b) => b.addEventListener('click', () => this.toggleFullscreen()));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && e.altKey) {
        e.preventDefault();
        this.toggleFullscreen();
      }
    });
    document.addEventListener('fullscreenchange', () => this.refreshFullscreenLabel());
    onLangChange(() => this.onLanguageChanged());
    document.querySelector<HTMLInputElement>('#vol')?.addEventListener('input', (e) => this.audio.setVolume(Number((e.target as HTMLInputElement).value)));
    document.querySelector<HTMLInputElement>('#music-vol')?.addEventListener('input', (e) => this.audio.setMusicVolume(Number((e.target as HTMLInputElement).value)));
    document.querySelector<HTMLInputElement>('#voices')?.addEventListener('change', (e) => {
      this.audio.voice.enabled = (e.target as HTMLInputElement).checked;
      if (!this.audio.voice.enabled) this.audio.stopVoice();
    });
    document.querySelector<HTMLInputElement>('#sens')?.addEventListener('input', (e) => {
      this.camRig.sensitivity = Number((e.target as HTMLInputElement).value);
    });
    document.querySelectorAll<HTMLButtonElement>('.tab[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.panelTab = b.dataset.tab ?? 'inv';
        this.renderPanel();
      }),
    );
    this.hud.dialogueEl.addEventListener('click', () => this.advanceDialogue());
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
    });
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
      this.hud.lockHint.classList.toggle('hidden', locked || this.state !== 'playing');
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
  }

  private loadQuality(): Quality | null {
    try {
      const q = window.localStorage.getItem('fidai-quality');
      return q === 'high' || q === 'medium' || q === 'low' ? q : null;
    } catch {
      return null;
    }
  }

  private refreshQualityLabel(): void {
    const b = document.querySelector('#btn-quality');
    if (b) b.textContent = t('pause.quality', { q: t(`quality.${this.pipeline.quality}`) });
  }

  private refreshMuteLabel(): void {
    const b = document.querySelector('#btn-mute');
    if (b) b.textContent = t(this.audio.muted ? 'pause.soundOff' : 'pause.soundOn');
  }

  private refreshFullscreenLabel(): void {
    const on = Boolean(document.fullscreenElement);
    document.querySelectorAll<HTMLElement>('.btn-fullscreen').forEach((b) => {
      b.textContent = t(on ? 'ui.fullscreenExit' : 'ui.fullscreen');
      b.classList.toggle('on', on);
    });
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const el = document.documentElement;
    const req = el.requestFullscreen?.({ navigationUI: 'hide' });
    void req?.then(() => {
      // pointer lock is dropped by some browsers on the fullscreen transition
      if (this.state === 'playing') this.input.requestLock();
    }).catch(() => undefined);
  }

  /** Re-render everything that holds translated text. */
  private onLanguageChanged(): void {
    this.refreshMuteLabel();
    this.refreshQualityLabel();
    this.refreshFullscreenLabel();
    this.audio.voiceLang = lang();
    if (this.state === 'panel') this.renderPanel();
    if (this.state === 'map') this.drawMap();
    if (this.state === 'dialogue') this.showDialogueLine(false);
    if (this.state === 'dead') this.fillDeathText();
    if (this.state === 'victory') this.fillVictoryStats();
    this.map.setLang();
    if (this.interactTarget) this.hud.setPrompt(tr(this.interactTarget.prompt), this.interactProgress);
  }

  private beginPlay(): void {
    document.querySelector('#title-screen')?.classList.add('hidden');
    this.state = 'playing';
    this.hud.show(true);
    this.input.requestLock();
    void this.audio.unlock();
    const m = this.quests.current;
    if (m) this.hud.showBanner(t('banner.start'), tr(m.title), trAlt(m.title));
    this.hud.toast(t('msg.start'), 'good');
    this.audio.startMusic();
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    document.querySelector('#pause-screen')?.classList.remove('hidden');
    this.audio.suspend(true);
  }

  private resume(): void {
    for (const id of ['#pause-screen', '#panel', '#map-screen']) document.querySelector(id)?.classList.add('hidden');
    this.state = 'playing';
    this.audio.suspend(false);
    void this.audio.unlock();
    this.input.requestLock();
  }

  private openOverlay(kind: 'panel' | 'map'): void {
    this.state = kind;
    this.input.releaseLock();
    if (kind === 'panel') {
      document.querySelector('#panel')?.classList.remove('hidden');
      this.renderPanel();
    } else {
      document.querySelector('#map-screen')?.classList.remove('hidden');
      this.drawMap();
    }
  }

  private closeOverlay(): void {
    document.querySelector('#panel')?.classList.add('hidden');
    document.querySelector('#map-screen')?.classList.add('hidden');
    this.state = 'playing';
    this.input.requestLock();
  }

  private renderPanel(): void {
    document.querySelectorAll<HTMLButtonElement>('.tab[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.panelTab));
    for (const tab of ['inv', 'craft', 'journal', 'skills']) document.querySelector(`#tab-${tab}`)?.classList.toggle('hidden', tab !== this.panelTab);
    this.hud.renderInventory(this.player.inventory, (id) => {
      this.useItem(id);
      this.renderPanel();
    }, { kills: this.stats.kills, takedowns: this.stats.takedowns, days: this.daysPassed + 1 }, [...this.player.owned], [...this.player.upgrades]);
    this.hud.renderCraft(
      RECIPES.map((r) => ({ r, ...this.craftState(r) })),
      (r) => {
        this.craft(r);
        this.renderPanel();
      },
      this.nearBench(),
    );
    this.hud.renderJournal(MISSIONS, this.quests.mission, this.world.landmarks.map((l) => ({ name: l.name, found: this.discovered.has(l.id) })));
    this.hud.renderSkills(this.player.skills, this.player.skillPoints, (s: Skill) => {
      if (this.player.skillPoints <= 0 || this.player.skills[s] >= SKILL_MAX) return;
      this.player.skillPoints -= 1;
      this.player.skills[s] += 1;
      if (s === 'endurance') this.player.health += 15;
      this.audio.levelUp();
      this.renderPanel();
    });
  }

  private drawMap(): void {
    const obj = this.objectiveTarget();
    const foes = this.enemies.filter((e) => e.alive && e.state === 'alert').map((e) => ({ x: e.pos.x, z: e.pos.z }));
    const marks = this.world.landmarks.filter((l) => this.discovered.has(l.id)).map((l) => ({ x: l.x, z: l.z, name: l.name }));
    this.map.draw({ x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw }, obj ? { x: obj.x, z: obj.z } : null, this.world.hideout, foes, this.fog, FOG_N, marks);
  }

  // ================================================================ main loop

  private update(dt: number, _t: number): void {
    this.frame += 1;
    this.pipeline.resize();
    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }
    this.elapsed += dt;
    const active = this.state === 'playing' || this.state === 'dialogue' || this.state === 'dead' || this.state === 'title';
    let sim = active ? dt : 0;
    if (this.hitstopT > 0) {
      // hitstop: the world crawls for a beat, camera/HUD stay live
      this.hitstopT -= dt;
      sim *= 0.06;
    }

    if (sim > 0 && this.state !== 'title') {
      this.gameTime += sim;
      this.sky.advance(sim);
      if (this.sky.hour < this.lastHour) this.daysPassed += 1;
      this.lastHour = this.sky.hour;
    }

    // ---- UI keys (a key that drove the UI this frame must not also act in the world)
    const uiConsumed = this.handleUiKeys();

    // ---- player
    const blocked = this.state !== 'playing' || uiConsumed;
    if (this.state !== 'title' && sim > 0) {
      const [lx, ly] = this.input.consumeLook();
      if (!blocked) this.camRig.look(lx, ly);
      this.player.update(sim, this.input, this.camRig.yaw, this.world.terrain, this.world.collision, blocked, this.gameTime);
      if (!blocked) {
        this.handleWeapons(sim);
        this.handleInteraction(sim);
      } else {
        this.hud.setPrompt(null);
      }
      if (this.player.dead && this.state !== 'dead' && this.player.deathT > 1.6) this.showDeath();
    } else if (this.state === 'title') {
      // slow cinematic orbit of the douar behind the title
      this.camRig.yaw = this.elapsed * 0.05 + 2.2;
      this.camRig.pitch = 0.12;
      this.player.update(0.0001, this.input, this.camRig.yaw, this.world.terrain, this.world.collision, true, this.gameTime);
    }

    // ---- world sims
    if (sim > 0) {
      this.updateConcealment(sim);
      this.ctx.night = this.sky.night;
      this.ctx.now = this.gameTime;
      this.player.chestPoint(this.ctx.playerChest);
      this.player.headPoint(this.ctx.playerHead);
      this.ctx.playerStealth = this.player.stealthFactor();
      this.ctx.playerConcealed = this.concealed;
      this.ctx.playerDead = this.player.dead || this.state === 'title';
      this.ctx.pathBudget.left = 4;
      for (const e of this.enemies) {
        const d = e.pos.distanceTo(this.camera.position);
        e.rig.root.visible = e.alive ? d < 150 : d < 90;
        e.update(sim, this.ctx);
        if (!e.alive && e.respawnAt === Infinity) this.onEnemyKilledCleanup(e);
        if (!e.alive && this.gameTime > e.respawnAt && e.pos.distanceTo(this.player.pos) > 120) this.respawnEnemy(e);
      }
      for (const n of this.npcs) {
        n.rig.root.visible = !n.fled && n.pos.distanceTo(this.camera.position) < 110;
        n.update(sim, this.world.terrain, this.world.collision, this.player.pos);
      }
      this.updateQuestsAmbient();
      this.updateAlertLevel();
      this.updateExploration(sim);
    }

    // ---- camera, sky, lights, effects
    this.camRig.reducedMotion = this.reducedMotion;
    this.camRig.update(dt, this.player.pos, this.player.crouchAmt, this.player.aimAmt, this.player.sprinting, this.world.collision, this.world.terrain);
    this.sky.update(this.player.pos, this.camera);
    this.renderer.toneMappingExposure = this.sky.exposure;
    this.scene.environmentIntensity = 0.35 * (1 - this.sky.night * 0.85);
    this.lib.setNightFactor(this.sky.night);
    this.updateLights(dt);
    this.veg.update(this.reducedMotion ? 0 : this.elapsed, this.camera.position);
    this.world.update(this.reducedMotion ? 0 : this.elapsed);
    this.vfx.update(dt, this.elapsed, this.sky.night);
    const obj = this.objectiveTarget();
    this.vfx.setBeacon(this.state === 'title' ? null : obj);
    const grade = this.pipeline.grade.uniforms;
    const hpFrac = this.player.health / this.player.maxHealth;
    grade.uDamage.value = clamp((0.45 - hpFrac) * 2.2, 0, 1) * 0.8 + this.player.flash * 0.4;
    grade.uDesat.value = this.player.dead ? Math.min(0.85, this.player.deathT * 0.6) : clamp(0.35 - hpFrac, 0, 0.35);
    grade.uWarm.value = 0.07 * (1 - this.sky.night);

    // ---- audio
    this.audio.night = this.sky.night;
    this.audio.tension += ((this.alertLevel === 'hunted' ? 1 : 0) - this.audio.tension) * (1 - Math.exp(-dt * 0.8));
    this.audio.update(this.elapsed);

    // ---- HUD
    if (this.state !== 'title') this.updateHud();
    if (this.state === 'map' && this.frame % 10 === 0) this.drawMap();

    this.input.endFrame();
    this.publishDiagnostics();
  }

  private handleUiKeys(): boolean {
    const i = this.input;
    if (this.state === 'dialogue') {
      if (i.wasPressed('interact') || i.wasPressed('jump') || i.wasPressed('attack')) {
        this.advanceDialogue();
        return true;
      }
      return false;
    }
    if (this.state === 'playing') {
      if (i.wasPressed('inventory') || i.wasPressed('journal') || i.wasPressed('craft')) {
        this.panelTab = i.wasPressed('journal') ? 'journal' : i.wasPressed('craft') ? 'craft' : 'inv';
        this.openOverlay('panel');
      } else if (i.wasPressed('map')) this.openOverlay('map');
      else if (i.wasPressed('pause')) {
        this.input.releaseLock();
        this.pause();
      }
    } else if (this.state === 'panel') {
      if (i.wasPressed('inventory') || i.wasPressed('pause') || i.wasPressed('journal') || i.wasPressed('craft')) this.closeOverlay();
    } else if (this.state === 'map') {
      if (i.wasPressed('map') || i.wasPressed('pause')) this.closeOverlay();
    } else if (this.state === 'paused') {
      if (i.wasPressed('pause')) this.resume();
    }
    return false;
  }

  // ================================================================ combat

  private handleWeapons(dt: number): void {
    const p = this.player;
    const i = this.input;
    if (p.dead) return;
    const slotKeys = ['weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5'] as const;
    slotKeys.forEach((k, idx) => {
      if (!i.wasPressed(k)) return;
      const w = WEAPON_ORDER[idx];
      if (p.owned.has(w)) p.setWeapon(w);
      else this.hud.toast(t('msg.noWeapon', { w: tr(WEAPONS[w].name) }), 'bad');
    });
    if (i.wheel !== 0) {
      const owned = WEAPON_ORDER.filter((w) => p.owned.has(w));
      const at = owned.indexOf(p.weapon);
      p.setWeapon(owned[(at + (i.wheel > 0 ? 1 : -1) + owned.length) % owned.length]);
    }
    if (i.wasPressed('drink')) this.useItem('water');
    if (i.wasPressed('eat')) this.useItem(p.inventory.bread > 0 ? 'bread' : 'dates');
    if (i.wasPressed('heal')) this.useItem(p.inventory.bandage > 0 && p.health < p.maxHealth - 30 ? 'bandage' : 'herbs');

    const gun = p.gun;
    if (gun && i.wasPressed('reload') && p.reloadT < 0 && p.clip < gun.clip && p.inventory[gun.ammo] > 0) {
      p.reloadT = 0;
      this.audio.reload();
    }

    // takedown takes priority over a normal slash
    const victim = this.takedownCandidate();
    if (victim && (i.wasPressed('interact') || (i.wasPressed('attack') && p.weapon === 'blade'))) {
      this.performTakedown(victim);
      return;
    }

    // automatic weapons keep firing while the trigger is held
    this.autoFireT -= dt;
    const autoHeld = Boolean(gun?.auto) && i.isHeld('attack') && p.clip > 0 && p.reloadT < 0 && p.fireCooldown <= 0;
    if (i.wasPressed('attack') || autoHeld) {
      if (p.weapon === 'blade') {
        if (p.meleeT < 0 && p.stamina >= 10) {
          p.meleeT = 0;
          p.meleeHitDone = false;
          p.stamina -= 10;
          this.audio.slash();
        }
      } else if (p.reloadT < 0 && p.fireCooldown <= 0) {
        if (p.clip <= 0) {
          this.audio.dryFire();
          if (p.inventory.ammo > 0) {
            p.reloadT = 0;
            this.audio.reload();
          } else this.hud.toast(t('msg.noAmmo'), 'bad');
        } else this.fireGun();
      }
    }

    if (p.meleeT >= 0.42 && !p.meleeHitDone) {
      p.meleeHitDone = true;
      this.resolveMelee();
    }
  }

  private takedownCandidate(): Enemy | null {
    if (this.player.weapon !== 'blade' && this.player.weapon !== 'rifle') return null;
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (!e.canBeTakenDown(this.player.pos)) continue;
      const d = e.pos.distanceTo(this.player.pos);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private performTakedown(e: Enemy): void {
    const p = this.player;
    if (p.weapon !== 'blade') p.setWeapon('blade');
    p.meleeT = 0.3;
    p.meleeHitDone = true;
    p.yaw = Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    e.takeHit(9999, p.pos);
    this.stats.takedowns += 1;
    this.audio.slash();
    this.audio.hit(true);
    this.vfx.impact(this.tmpA.set(e.pos.x, e.pos.y + 1.3, e.pos.z), 'blood', 8);
    this.camRig.addTrauma(0.2);
    this.hud.hitMarker(true);
    this.onKill(e, true);
  }

  private resolveMelee(): void {
    const p = this.player;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.1 || (dx * fx + dz * fz) / (d || 1) < 0.35) continue;
      const unaware = e.state !== 'alert';
      const dmg = (unaware ? 110 : 36) * (p.upgrades.has('sharpBlade') ? 1.6 : 1);
      const killed = e.takeHit(dmg, p.pos);
      this.audio.hit(true);
      this.vfx.impact(this.tmpA.set(e.pos.x, e.pos.y + 1.25, e.pos.z), 'blood', 5);
      this.camRig.addTrauma(0.3);
      this.hud.hitMarker(killed);
      this.hitstop(0.06);
      if (killed) this.onKill(e, unaware);
      else this.onEnemyAlert(e);
      break;
    }
  }

  private hitstopT = 0;
  private hitstop(s: number): void {
    this.hitstopT = Math.max(this.hitstopT, s);
  }

  private fireGun(): void {
    const p = this.player;
    const gun = p.gun;
    if (!gun) return;
    p.clip -= 1;
    p.fireCooldown = gun.interval;
    this.stats.shots += 1;
    const origin = this.camera.position.clone();
    const aimDir = this.camRig.forward(new THREE.Vector3());
    // start the ray at the player's shoulder plane so walls behind the camera don't block
    const toPlayer = this.tmpA.copy(p.pos).setY(p.pos.y + 1.4).sub(origin).dot(aimDir);
    origin.addScaledVector(aimDir, Math.max(0, toPlayer));
    // spread: tight when aimed and still, worse while moving, better with Marksman
    let spread = p.aiming ? gun.spreadAim : gun.spreadHip;
    spread += Math.min(1, p.moveSpeed / 4) * 0.03;
    spread *= 1 - p.skills.marksman * 0.12;
    const muzzle = p.rig.muzzleWorld(new THREE.Vector3());
    this.vfx.muzzle(muzzle, aimDir);
    const hits = new Map<Enemy, { dmg: number; head: boolean }>();
    for (let k = 0; k < gun.pellets; k += 1) {
      const dir = aimDir.clone();
      dir.x += (this.rng() - 0.5) * spread;
      dir.y += (this.rng() - 0.5) * spread;
      dir.z += (this.rng() - 0.5) * spread;
      dir.normalize();
      const range = gun.range;
      const end = this.tmpB.copy(origin).addScaledVector(dir, range);
      let hitT = range;
      let hitEnemy: Enemy | null = null;
      let head = false;
      for (const e of this.enemies) {
        const h = e.hitTest(origin, dir, range);
        if (h && h.t < hitT) {
          hitT = h.t;
          hitEnemy = e;
          head = h.head;
        }
      }
      const tw = this.world.collision.raycast(origin, end, false);
      if (tw >= 0 && tw * range < hitT) {
        hitT = tw * range;
        hitEnemy = null;
      }
      const tt = this.world.terrain.raycastSegment(origin, end, 1);
      if (tt >= 0 && tt * range < hitT) {
        hitT = tt * range;
        hitEnemy = null;
      }
      const hitPoint = origin.clone().addScaledVector(dir, hitT);
      if (k < 3) this.vfx.tracer(muzzle, hitPoint);
      if (hitEnemy) {
        // damage falls off past half range
        const fall = clamp(1.4 - hitT / range, 0.45, 1);
        const dmg = gun.damage * (head ? gun.headMul : 1) * fall * (1 + p.skills.marksman * 0.12);
        const prev = hits.get(hitEnemy);
        hits.set(hitEnemy, { dmg: (prev?.dmg ?? 0) + dmg, head: Boolean(prev?.head) || head });
        this.vfx.impact(hitPoint, 'blood', gun.pellets > 1 ? 3 : 6);
      } else if (hitT < range) {
        this.vfx.impact(hitPoint, 'dust', gun.pellets > 1 ? 3 : 7);
      }
    }
    for (const [e, h] of hits) {
      const killed = e.takeHit(h.dmg, p.pos);
      this.hud.hitMarker(killed);
      if (killed) this.onKill(e, false, h.head);
    }
    this.audio.gunShot(p.weapon);
    this.camRig.addTrauma(gun.trauma);
    this.camRig.punchFov(gun.fov);
    // gunshots carry
    this.broadcastNoise(p.pos, gun.noise, true);
  }

  private onKill(e: Enemy, silent: boolean, head = false): void {
    this.stats.kills += 1;
    let xp = e.isOfficer ? 40 : 18;
    if (silent) xp += 15;
    if (head) xp += 8;
    const who = tr(e.label);
    this.giveXp(xp, silent ? t('msg.takedown', { who }) : head ? t('xp.headshot', { who }) : t('xp.down', { who }));
    if (!silent) {
      // allies nearby notice the body / scream
      for (const o of this.enemies) if (o !== e && o.alive && o.pos.distanceTo(e.pos) < 18) o.hearNoise(e.pos, 18, false);
    }
  }

  private onEnemyKilledCleanup(e: Enemy): void {
    e.respawnAt = this.gameTime + 300;
    const it = this.world.interactables.find((x) => x.id === `body-${e.spawn.id}`);
    if (it) {
      it.enabled = true;
      it.pos = e.pos;
      const french = e.spawn.faction === 'french';
      const r = this.rng;
      it.loot = {
        ammo: french ? 3 + Math.floor(r() * 3) : 2 + Math.floor(r() * 2),
        ...(r() < 0.3 ? { bread: 1 } : {}),
        ...(r() < 0.25 ? { dates: 1 } : {}),
        ...(r() < (french ? 0.55 : 0.3) ? { powder: 1 } : {}),
        ...(r() < 0.4 ? { scrap: 1 } : {}),
        ...(!french && r() < 0.55 ? { cloth: 1 } : {}),
        ...(e.isOfficer ? { pistolAmmo: 6 + Math.floor(r() * 6) } : {}),
        ...(french && r() < 0.15 ? { bandage: 1 } : {}),
      };
      it.weapon = e.isOfficer && !this.player.owned.has('pistol') ? 'pistol' : undefined;
      if (e.spawn.carries === 'key' && this.player.inventory.key <= 0 && !this.prisonOpened) it.loot.key = 1;
    }
  }

  private respawnEnemy(e: Enemy): void {
    e.reset();
    const it = this.world.interactables.find((x) => x.id === `body-${e.spawn.id}`);
    if (it) it.enabled = false;
  }

  private onEnemyAlert(e: Enemy): void {
    if (this.player.dead) return;
    let shouted = 0;
    for (const o of this.enemies) {
      if (o === e || !o.alive) continue;
      if (o.pos.distanceTo(e.pos) < 34) {
        o.alertFrom(e.lastKnown);
        shouted += 1;
      }
    }
    this.audio.whistle(e.pos.distanceTo(this.player.pos));
    if (this.alertLevel !== 'hunted') this.hud.toast(t('msg.spotted', { who: tr(e.label) }) + (shouted ? t('msg.alarm') : ''), 'bad');
    this.audio.bark(e.spawn.faction, e.isOfficer, this.camera.position.distanceTo(e.pos));
  }

  private onEnemyShot(req: ShotRequest): void {
    const p = this.player;
    const chest = p.chestPoint(this.tmpA);
    const distToPlayer = req.from.distanceTo(chest);
    // sound from the shooter's direction
    const pan = this.panFor(req.from);
    this.audio.rifleShot(this.camera.position.distanceTo(req.from), pan, req.enemy.isOfficer);
    const blocked = this.world.collision.raycast(req.from, chest, false);
    const dir = chest.clone().sub(req.from).normalize();
    this.vfx.muzzle(req.from, dir);
    if (blocked >= 0 && blocked < 0.97) {
      const hp = req.from.clone().lerp(chest, blocked);
      this.vfx.tracer(req.from, hp);
      this.vfx.impact(hp, 'dust', 5);
      if (distToPlayer < 40) this.audio.whiz();
      return;
    }
    if (this.rng() < req.hitChance) {
      p.damage(req.damage * (0.85 + this.rng() * 0.3), { kind: 'shot', by: req.enemy.label }, this.gameTime);
      this.vfx.tracer(req.from, chest);
      this.vfx.impact(chest, 'blood', 5);
      this.audio.hurt();
      this.camRig.addTrauma(0.42);
      this.hud.damageFrom(this.screenAngleTo(req.from));
      this.hitstop(0.07);
    } else {
      const miss = chest.clone().add(new THREE.Vector3((this.rng() - 0.5) * 2.4, (this.rng() - 0.3) * 1.6, (this.rng() - 0.5) * 2.4));
      const far = miss.clone().sub(req.from).normalize().multiplyScalar(distToPlayer + 30).add(req.from);
      this.vfx.tracer(req.from, far);
      this.audio.whiz();
      const tg = this.world.terrain.raycastSegment(req.from, far, 1);
      if (tg >= 0) this.vfx.impact(req.from.clone().lerp(far, tg), 'dust', 4);
    }
  }

  private onEnemyMelee(e: Enemy): void {
    if (e.pos.distanceTo(this.player.pos) > 2.4 || this.player.dead) return;
    this.player.damage(13, { kind: 'melee', by: e.label }, this.gameTime);
    this.audio.hit(true);
    this.audio.hurt();
    this.camRig.addTrauma(0.35);
    this.hud.damageFrom(this.screenAngleTo(e.pos));
  }

  private broadcastNoise(at: THREE.Vector3, radius: number, gunshot: boolean): void {
    for (const e of this.enemies) e.hearNoise(at, radius, gunshot);
  }

  private onFootstep(loud: number): void {
    this.audio.footstep(loud);
    if (loud >= 1) {
      this.vfx.footDust(this.tmpC.copy(this.player.pos).setY(this.player.pos.y + 0.05), loud);
      // sprinting is audible
      for (const e of this.enemies) if (e.alive && e.state !== 'alert' && e.pos.distanceTo(this.player.pos) < 7) e.hearNoise(this.player.pos, 7, false);
    }
  }

  // ================================================================ interaction

  private handleInteraction(dt: number): void {
    const p = this.player;
    if (p.dead) return;
    // takedown prompt wins
    const victim = this.takedownCandidate();
    if (victim) {
      this.hud.setPrompt(t('msg.takedown', { who: tr(victim.label) }), 0, true);
      this.interactTarget = null;
      return;
    }
    const gate = this.quests.activeGate();
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of this.world.interactables) {
      if (it.questGate) {
        it.enabled = it.questGate === gate && !this.usedInteractables.has(it.id);
      }
      if (!it.enabled) continue;
      const d = Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z);
      if (d < it.radius && d < bestD && Math.abs(it.pos.y - p.pos.y) < 3) {
        bestD = d;
        best = it;
      }
    }
    if (best !== this.interactTarget) {
      this.interactTarget = best;
      this.interactProgress = 0;
    }
    if (!best) {
      this.hud.setPrompt(null);
      p.interactT = 0;
      return;
    }
    if (best.hold <= 0) {
      if (this.input.wasPressed('interact')) this.perform(best);
    } else if (this.input.isHeld('interact')) {
      this.interactProgress += dt / best.hold;
      p.interactT = this.interactProgress;
      if (this.interactProgress >= 1) {
        this.interactProgress = 0;
        p.interactT = 0;
        this.perform(best);
      }
    } else {
      this.interactProgress = Math.max(0, this.interactProgress - dt * 2);
      p.interactT = 0;
    }
    if (this.interactTarget) this.hud.setPrompt(tr(this.interactTarget.prompt), this.interactProgress);
  }

  private perform(it: Interactable): void {
    const p = this.player;
    switch (it.kind) {
      case 'water':
        p.thirst = 100;
        p.inventory.water = p.waterCharges;
        this.audio.drink();
        this.hud.toast(t('msg.drink', { n: p.waterCharges }), 'good');
        this.questEvent(`water:${it.id}`);
        break;
      case 'oven':
        if ((it.cooldownUntil ?? 0) > this.gameTime) {
          this.hud.toast(t('msg.baking'), '');
          break;
        }
        it.cooldownUntil = this.gameTime + 120;
        this.addItems({ bread: 2 });
        this.audio.pickup();
        this.questEvent(`oven:${it.id}`);
        break;
      case 'talk':
        this.startDialogue(it.ref ?? '');
        break;
      case 'loot':
      case 'body': {
        const loot = this.scavenge(it.loot ?? {});
        it.enabled = false;
        if (Object.keys(loot).length === 0) this.hud.toast(t('msg.nothing'), '');
        this.addItems(loot);
        if (it.weapon) this.grantWeapon(it.weapon);
        this.vfx.glint(this.tmpA.copy(it.pos).setY(it.pos.y + 0.6));
        this.audio.pickup();
        if (loot.key) {
          this.questEvent('key');
          this.hud.toast(t('msg.key'), 'good');
        }
        if (it.kind === 'body') {
          const e = this.enemies.find((x) => x.spawn.id === it.ref);
          if (e) e.looted = true;
        }
        break;
      }
      case 'herb':
      case 'wood':
      case 'scrap': {
        it.enabled = false;
        window.setTimeout(() => (it.enabled = true), 300000);
        const base: LootBundle = it.kind === 'herb' ? { herbs: 1 } : it.kind === 'wood' ? { wood: 2 } : { scrap: 2, ...(this.rng() < 0.3 ? { powder: 1 } : {}) };
        this.addItems(this.scavenge(base));
        this.audio.pickup();
        break;
      }
      case 'weapon': {
        this.usedInteractables.add(it.id);
        it.enabled = false;
        if (it.weapon) this.grantWeapon(it.weapon);
        if (it.loot) this.addItems(it.loot);
        this.audio.clank();
        this.broadcastNoise(p.pos, 8, false);
        break;
      }
      case 'bench':
        this.panelTab = 'craft';
        this.openOverlay('panel');
        break;
      case 'leaflet':
        if (p.inventory.leaflet <= 0) {
          this.hud.toast(t('msg.noLeaflets'), 'bad');
          break;
        }
        p.inventory.leaflet -= 1;
        this.usedInteractables.add(it.id);
        this.world.postLeaflet(it.id);
        this.audio.pickup();
        this.giveXp(15, t('xp.leaflet'));
        this.questEvent('leaflet');
        break;
      case 'pole':
        this.usedInteractables.add(it.id);
        this.world.cutPole(Number(it.ref));
        this.audio.snapWire();
        this.vfx.impact(this.tmpA.copy(it.pos).setY(it.pos.y + 6.9), 'spark', 14);
        this.giveXp(15, t('xp.pole'));
        this.addItems({ scrap: 1 });
        this.broadcastNoise(p.pos, 10, false);
        this.questEvent('pole');
        break;
      case 'prison':
        if (p.inventory.key <= 0) {
          this.hud.toast(t('msg.locked'), 'bad');
          break;
        }
        p.inventory.key = 0;
        this.usedInteractables.add(it.id);
        this.prisonOpened = true;
        this.world.openPrison();
        this.audio.clank();
        for (const n of this.npcs) {
          if (n.spawn.outfit !== 'prisoner') continue;
          n.fleeTo(this.nav, this.world.kasbahGate.x - 30, this.world.kasbahGate.z + 30);
        }
        this.giveXp(30, t('xp.prison'));
        this.questEvent('prison');
        break;
      case 'cache':
        this.usedInteractables.add(it.id);
        this.world.takeArmsCache();
        this.carrying = true;
        this.carryCrate.visible = true;
        this.audio.pickup();
        this.broadcastNoise(p.pos, 9, false);
        this.hud.toast(t('msg.cache'), 'good');
        this.questEvent('cache');
        break;
      case 'rest': {
        if (this.alertLevel === 'hunted') {
          this.hud.toast(t('msg.noRest'), 'bad');
          break;
        }
        const h = this.sky.hour;
        const target = h >= 6 && h < 20.5 ? 21 : 6.5;
        let delta = target - h;
        if (delta < 0) delta += 24;
        this.sky.setHour(target);
        if (target === 6.5) this.daysPassed += 1;
        this.lastHour = target;
        p.health = Math.min(p.maxHealth, p.health + 40);
        p.stamina = p.maxStamina;
        p.hunger = Math.max(5, p.hunger - delta * 1.6);
        p.thirst = Math.max(5, p.thirst - delta * 2.2);
        this.hud.flash(0.95, '#0b0d18');
        this.hud.toast(t(target === 21 ? 'msg.sleepNight' : 'msg.sleepDawn'), 'good');
        break;
      }
    }
  }

  private addItems(loot: LootBundle): void {
    for (const [k, v] of Object.entries(loot) as [ItemId, number][]) {
      if (!v) continue;
      this.player.inventory[k] += v;
      this.hud.toast(t('msg.item', { n: v, item: tr(ITEMS[k].name) }), 'good');
    }
  }

  /** Scavenger skill and the smuggler satchel add materials/ammo to every search. */
  private scavenge(loot: LootBundle): LootBundle {
    const out: LootBundle = { ...loot };
    const p = this.player;
    const bonus: ItemId[] = ['scrap', 'cloth', 'wood', 'powder', 'ammo', 'pistolAmmo'];
    for (let rank = 0; rank < p.skills.scavenger; rank += 1) {
      if (this.rng() < 0.3) {
        const k = bonus[Math.floor(this.rng() * bonus.length)];
        out[k] = (out[k] ?? 0) + 1;
      }
    }
    if (p.upgrades.has('satchel')) {
      const k = bonus[Math.floor(this.rng() * 4)];
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  private grantWeapon(w: WeaponId): void {
    const p = this.player;
    if (p.owned.has(w)) return;
    p.owned.add(w);
    const gun = WEAPONS[w].gun;
    if (gun) p.clips[w] = gun.clip;
    this.audio.questComplete();
    this.hud.showBanner(t('banner.newWeapon'), tr(WEAPONS[w].name), t('banner.weaponHint', { n: WEAPONS[w].slot }), 3000);
  }

  // ================================================================ crafting

  private nearBench(): boolean {
    return this.player.pos.distanceTo(this.world.bench) < 5;
  }

  private craftState(r: Recipe): { can: boolean; reason: string; done: boolean } {
    const p = this.player;
    const done = Boolean((r.weapon && p.owned.has(r.weapon)) || (r.upgrade && p.upgrades.has(r.upgrade)));
    if (done) return { can: false, reason: t('craft.owned'), done };
    if ((r.artisan ?? 0) > p.skills.artisan) return { can: false, reason: t('craft.needArtisan', { n: r.artisan ?? 0 }), done };
    if (r.bench && !this.nearBench()) return { can: false, reason: t('craft.needBench'), done };
    for (const [k, v] of Object.entries(r.cost) as [ItemId, number][]) {
      if (p.inventory[k] < v) return { can: false, reason: t('craft.missing'), done };
    }
    return { can: true, reason: '', done };
  }

  private craft(r: Recipe): void {
    if (!this.craftState(r).can) return;
    const p = this.player;
    for (const [k, v] of Object.entries(r.cost) as [ItemId, number][]) p.inventory[k] -= v;
    if (r.gives) {
      const gives: LootBundle = {};
      for (const [k, v] of Object.entries(r.gives) as [ItemId, number][]) {
        gives[k] = v + (ITEMS[k].kind === 'ammo' ? p.skills.artisan : 0);
      }
      this.addItems(gives);
    }
    if (r.weapon) this.grantWeapon(r.weapon);
    if (r.upgrade) {
      p.upgrades.add(r.upgrade);
      if (r.upgrade === 'bigSkin') p.inventory.water = p.waterCharges;
    }
    this.audio.craft();
    this.hud.toast(t('craft.done', { what: tr(r.name) }), 'good');
    this.giveXp(r.weapon || r.upgrade ? 20 : 4, t('xp.craft'));
  }

  private useItem(id: ItemId): void {
    const p = this.player;
    if (p.dead) return;
    if (id === 'water') {
      if (p.inventory.water <= 0) return void this.hud.toast(t('msg.emptySkin'), 'bad');
      if (p.thirst > 97) return;
      p.inventory.water -= 1;
      p.thirst = Math.min(100, p.thirst + 35);
      this.audio.drink();
    } else if (id === 'bread' || id === 'dates') {
      if (p.inventory[id] <= 0) {
        const other = id === 'bread' ? 'dates' : 'bread';
        if (p.inventory[other] > 0) return this.useItem(other);
        return void this.hud.toast(t('msg.noFood'), 'bad');
      }
      if (p.hunger > 97) return;
      p.inventory[id] -= 1;
      p.hunger = Math.min(100, p.hunger + (id === 'bread' ? 40 : 18) * (1 + p.skills.survivalist * 0.1));
      if (id === 'dates') p.thirst = Math.min(100, p.thirst + 6);
      this.audio.eat();
    } else if (id === 'herbs') {
      if (p.inventory.herbs <= 0) {
        if (p.inventory.bandage > 0) return this.useItem('bandage');
        return void this.hud.toast(t('msg.noHerbs'), 'bad');
      }
      if (p.health >= p.maxHealth) return;
      p.inventory.herbs -= 1;
      p.healPool += 35;
      this.audio.eat();
    } else if (id === 'bandage') {
      if (p.inventory.bandage <= 0 || p.health >= p.maxHealth) return;
      p.inventory.bandage -= 1;
      p.health = Math.min(p.maxHealth, p.health + 60);
      this.audio.bandage();
    }
  }

  private giveXp(amount: number, reason: string): void {
    this.hud.toast(t('xp.gain', { n: amount, why: reason }), 'xp');
    if (this.player.gainXp(amount)) {
      this.audio.levelUp();
      this.hud.showBanner(t('banner.levelUp'), t('banner.level', { n: this.player.level }), t('banner.levelHint'), 2800);
    }
  }

  // ================================================================ quests & dialogue

  private startDialogue(npc: string): void {
    const lines = this.quests.dialogueFor(npc);
    const n = this.npcs.find((x) => x.spawn.id === npc);
    if (lines) {
      this.dialogueLines = lines;
      this.dialogueQuest = true;
    } else {
      const pool = AMBIENT_LINES[npc] ?? [{ en: '…', ar: '…' }];
      this.dialogueLines = [[n?.spawn.name ?? { en: '', ar: '' }, pool[Math.floor(this.rng() * pool.length)]]];
      this.dialogueQuest = false;
    }
    this.dialogueNpc = npc;
    this.dialogueIdx = 0;
    this.state = 'dialogue';
    this.hud.setPrompt(null);
    if (n) n.talking = 30;
    this.showDialogueLine();
  }

  private showDialogueLine(speak = true): void {
    const [who, text] = this.dialogueLines[this.dialogueIdx];
    this.hud.showDialogue(tr(who), tr(text));
    if (speak) this.audio.speak(tr(text), this.dialogueNpc, lang());
    const n = this.npcs.find((x) => x.spawn.id === this.dialogueNpc);
    if (n) n.talking = 30;
  }

  private advanceDialogue(): void {
    if (this.state !== 'dialogue') return;
    this.dialogueIdx += 1;
    if (this.dialogueIdx < this.dialogueLines.length) {
      this.showDialogueLine();
      return;
    }
    this.hud.hideDialogue();
    this.audio.stopVoice();
    this.state = 'playing';
    const n = this.npcs.find((x) => x.spawn.id === this.dialogueNpc);
    if (n) n.talking = 0;
    if (this.dialogueQuest) this.questEvent(`talk:${this.dialogueNpc}`);
  }

  private questEvent(evt: string): void {
    const before = this.quests.current;
    const beforeStep = this.quests.step;
    const res = this.quests.handle(evt);
    if (!res.progressed) return;
    // step-entry side effects
    if (before?.id === 'leaflets' && beforeStep === 0 && res.stepDone) {
      this.player.inventory.leaflet = 3;
      this.hud.toast(t('msg.leafletsGot'), 'good');
    }
    if (res.missionDone) {
      const m = res.missionDone;
      this.addItems(m.reward.items);
      this.giveXp(m.reward.xp, t('xp.mission', { m: tr(m.title) }));
      this.audio.questComplete();
      this.hud.showBanner(t('banner.missionDone'), tr(m.title), trAlt(m.title));
      const next = this.quests.current;
      if (next) window.setTimeout(() => this.hud.showBanner(t('banner.newMission'), tr(next.title), trAlt(next.title)), 3600);
      if (res.allDone) this.victoryAt = this.elapsed + 3.5;
    } else if (res.stepDone) {
      this.audio.pickup();
    }
  }

  private updateQuestsAmbient(): void {
    const st = this.quests.currentStep;
    if (st?.objectives.some((o) => o.event === 'reach:douar') && this.carrying) {
      if (this.player.pos.distanceTo(this.world.hideout) < 22) {
        this.carrying = false;
        this.carryCrate.visible = false;
        this.questEvent('reach:douar');
      }
    }
    if (this.victoryAt > 0 && this.elapsed > this.victoryAt && !this.victoryShown) this.showVictory();
  }

  private resolveTarget(id: string): THREE.Vector3 | null {
    if (id === 'hideout') return this.world.hideout;
    if (id.startsWith('npc:')) {
      const n = this.npcs.find((x) => x.spawn.id === id.slice(4));
      return n ? n.pos : null;
    }
    if (id.startsWith('it:')) {
      const it = this.world.interactables.find((x) => x.id === id.slice(3));
      if (!it || this.usedInteractables.has(it.id)) return null;
      return it.pos;
    }
    if (id.startsWith('enemy:')) {
      const e = this.enemies.find((x) => x.spawn.id === id.slice(6));
      return e ? e.pos : null;
    }
    return null;
  }

  /** Nearest unfinished objective target. */
  private objectiveTarget(): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    for (const o of this.quests.objectiveState()) {
      if (o.done || !o.obj.target) continue;
      const ids = Array.isArray(o.obj.target) ? o.obj.target : [o.obj.target];
      for (const id of ids) {
        const v = this.resolveTarget(id);
        if (!v) continue;
        const d = v.distanceTo(this.player.pos);
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
    }
    return best;
  }

  // ================================================================ state

  private updateConcealment(dt: number): void {
    this.concealT -= dt;
    if (this.concealT > 0) return;
    this.concealT = 0.25;
    this.concealed = false;
    if (!this.player.crouched) return;
    const p = this.player.pos;
    for (const c of this.veg.cover) {
      const dx = c.x - p.x;
      const dz = c.z - p.z;
      if (dx * dx + dz * dz < c.r * c.r) {
        this.concealed = true;
        return;
      }
    }
  }

  private updateAlertLevel(): void {
    let level: AlertLevel = 'hidden';
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.state === 'alert' && e.timeSinceSeen < 12) {
        level = 'hunted';
        break;
      }
      if (e.awareness > 0.3 || e.state === 'search') level = 'suspicious';
    }
    if (level === 'hidden' && this.alertLevel === 'hunted') this.hud.toast(t('msg.lost'), 'good');
    this.alertLevel = level;
  }

  /** Reveal map fog around the player and discover landmarks/zones. */
  private updateExploration(dt: number): void {
    this.exploreT -= dt;
    if (this.exploreT > 0 || this.state === 'title') return;
    this.exploreT = 0.5;
    const p = this.player.pos;
    this.revealFog(p.x, p.z, 48);
    for (const l of this.world.landmarks) {
      if (this.discovered.has(l.id) || Math.hypot(l.x - p.x, l.z - p.z) > l.r) continue;
      this.discovered.add(l.id);
      this.revealFog(l.x, l.z, l.reveal);
      this.audio.discover();
      this.hud.showBanner(t('banner.discovered'), tr(l.name), trAlt(l.name), 3000);
      this.giveXp(l.xp, t('xp.discover'));
    }
  }

  revealFog(x: number, z: number, r: number): void {
    const cell = (FOG_EXTENT * 2) / FOG_N;
    const cx = Math.floor((x + FOG_EXTENT) / cell);
    const cz = Math.floor((z + FOG_EXTENT) / cell);
    const rc = Math.ceil(r / cell);
    for (let j = Math.max(0, cz - rc); j <= Math.min(FOG_N - 1, cz + rc); j += 1) {
      for (let i = Math.max(0, cx - rc); i <= Math.min(FOG_N - 1, cx + rc); i += 1) {
        const dx = (i + 0.5) * cell - FOG_EXTENT - x;
        const dz = (j + 0.5) * cell - FOG_EXTENT - z;
        if (dx * dx + dz * dz <= r * r) this.fog[j * FOG_N + i] = 1;
      }
    }
  }

  private updateLights(dt: number): void {
    this.lightT -= dt;
    if (this.lightT <= 0) {
      this.lightT = 0.5;
      const pts = this.world.lightPoints
        .map((v) => ({ v, d: v.distanceToSquared(this.player.pos) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, LIGHT_POOL);
      this.lights.forEach((l, i) => {
        const pt = pts[i];
        if (pt) l.position.copy(pt.v);
        l.userData.active = Boolean(pt) && pt.d < 140 * 140;
      });
    }
    for (const l of this.lights) {
      const flicker = this.reducedMotion ? 1 : 0.9 + Math.sin(this.elapsed * 13 + l.id) * 0.06 + Math.sin(this.elapsed * 7.3 + l.id * 2) * 0.04;
      l.intensity = l.userData.active ? this.sky.night * 18 * flicker : 0;
    }
  }

  private respawnPlayer(first: boolean): void {
    this.player.spawn(this.world.playerSpawn, 2.4);
    if (!first) {
      this.player.hunger = Math.max(this.player.hunger, 55);
      this.player.thirst = Math.max(this.player.thirst, 55);
      // losses
      this.player.inventory.ammo = Math.floor(this.player.inventory.ammo * 0.6);
      this.player.inventory.bread = Math.max(0, this.player.inventory.bread - 1);
    }
    this.camRig.yaw = this.player.yaw + Math.PI;
    this.camRig.pitch = 0.18;
    this.camRig.snap();
    for (const e of this.enemies) {
      if (e.alive) e.reset();
    }
  }

  private showDeath(): void {
    this.state = 'dead';
    this.input.releaseLock();
    this.audio.death();
    this.fillDeathText();
    document.querySelector('#death-screen')?.classList.remove('hidden');
  }

  private fillDeathText(): void {
    const cause = this.player.causeOfDeath;
    const who = cause.by ? tr(cause.by) : '';
    document.querySelector('#death-cause')!.textContent =
      cause.kind === 'thirst' ? t('death.thirst') : cause.kind === 'hunger' ? t('death.hunger') : cause.kind === 'melee' ? t('death.melee', { who }) : t('death.shot', { who });
    const hint = cause.kind === 'thirst' || cause.kind === 'hunger' ? t('death.hintSurvival') : this.sky.night < 0.5 ? t('death.hintDay') : t('death.hintNight');
    document.querySelector('#death-hint')!.textContent = hint;
  }

  private retry(): void {
    document.querySelector('#death-screen')?.classList.add('hidden');
    document.querySelector('#pause-screen')?.classList.add('hidden');
    this.respawnPlayer(false);
    if (this.carrying) {
      // the crate is lost on death, but the depot can be raided again
      this.carrying = false;
      this.carryCrate.visible = false;
      this.usedInteractables.delete('arms-cache');
      this.world.armsCache.visible = true;
      this.quests.jump(4, 1);
    }
    this.state = 'playing';
    this.audio.suspend(false);
    this.input.requestLock();
  }

  private showVictory(): void {
    this.victoryShown = true;
    this.state = 'victory';
    this.input.releaseLock();
    this.fillVictoryStats();
    document.querySelector('#victory-screen')?.classList.remove('hidden');
    this.audio.victorySong();
  }

  private fillVictoryStats(): void {
    const s = document.querySelector('#victory-stats');
    if (!s) return;
    const found = this.world.landmarks.filter((l) => this.discovered.has(l.id)).length;
    s.innerHTML = [
      [this.daysPassed + 1, t('victory.days')],
      [this.stats.kills, t('victory.kills')],
      [this.stats.takedowns, t('victory.takedowns')],
      [`${found}/${this.world.landmarks.length}`, t('victory.places')],
      [this.player.level, t('victory.level')],
    ]
      .map(([v, l]) => `<span><b>${v}</b>${l}</span>`)
      .join('');
  }

  // ================================================================ HUD

  private updateHud(): void {
    const p = this.player;
    const st = this.quests.objectiveState();
    const markers: CompassMarker[] = [];
    const obj = this.objectiveTarget();
    if (obj) markers.push({ x: obj.x, z: obj.z, kind: 'objective' });
    markers.push({ x: this.world.hideout.x, z: this.world.hideout.z, kind: 'hideout' });
    for (const e of this.enemies) if (e.alive && e.state === 'alert') markers.push({ x: e.pos.x, z: e.pos.z, kind: 'foe' });
    this.hud.update({
      health: p.health,
      maxHealth: p.maxHealth,
      stamina: p.stamina,
      maxStamina: p.maxStamina,
      hunger: p.hunger,
      thirst: p.thirst,
      clock: this.sky.clock(),
      night: this.sky.night > 0.5,
      alert: this.alertLevel,
      level: p.level,
      xpProgress: p.xpProgress(),
      weapon: p.weapon,
      weaponName: tr(WEAPONS[p.weapon].name),
      slots: WEAPON_ORDER.map((w) => ({ slot: WEAPONS[w].slot, owned: p.owned.has(w), active: p.weapon === w })),
      clip: p.clip,
      reserve: p.gun ? p.inventory[p.gun.ammo] : 0,
      water: p.inventory.water,
      food: p.inventory.bread + p.inventory.dates,
      herbs: p.inventory.herbs,
      reloading: p.reloadT >= 0,
      missionTitle: this.quests.current ? tr(this.quests.current.title) : t('mission.free'),
      objectives: st.map((o) => ({ text: tr(o.obj.text), have: o.have, need: o.need, done: o.done })),
      yaw: this.camRig.yaw,
      px: p.pos.x,
      pz: p.pos.z,
      markers,
      crosshair: this.state === 'playing' && !p.dead && (p.weapon !== 'blade' || p.aiming),
      spread: p.gun ? (p.aiming ? p.gun.spreadAim * 8 : p.gun.spreadHip * 12) + Math.min(1, p.moveSpeed / 4) * 0.4 : 0,
    });
    this.hud.lockHint.classList.toggle('hidden', this.input.locked || this.state !== 'playing');

    // awareness indicators
    const list: Indicator[] = [];
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (const e of this.enemies) {
      if (!e.alive || (e.awareness < 0.04 && e.state !== 'alert')) continue;
      if (e.pos.distanceTo(p.pos) > 90) continue;
      const v = this.tmpA.set(e.pos.x, e.pos.y + 2.2, e.pos.z).project(this.camera);
      let x = (v.x * 0.5 + 0.5) * w;
      let y = (-v.y * 0.5 + 0.5) * h;
      let edge = false;
      if (v.z > 1 || x < 20 || x > w - 20 || y < 70 || y > h - 20) {
        edge = true;
        // direction on screen from centre
        const ang = this.screenAngleTo(e.pos);
        const r = Math.min(w, h) * 0.42;
        x = w / 2 + Math.sin(ang) * r;
        y = h / 2 - Math.cos(ang) * r;
      }
      list.push({ x, y, a: e.awareness, alert: e.state === 'alert', officer: e.isOfficer, edge });
      if (list.length >= 12) break;
    }
    this.hud.setIndicators(list);
  }

  private screenAngleTo(pos: THREE.Vector3): number {
    const fwd = this.camRig.forward(this.tmpB);
    const heading = Math.atan2(fwd.x, -fwd.z);
    const bearing = Math.atan2(pos.x - this.player.pos.x, -(pos.z - this.player.pos.z));
    return bearing - heading;
  }

  private panFor(pos: THREE.Vector3): number {
    return Math.sin(this.screenAngleTo(pos)) * 0.8;
  }

  // ================================================================ test hooks / diagnostics

  private installTestHooks(): void {
    const setPlayer = (x: number, z: number, yawCam: number, pitch = 0.18) => {
      this.player.spawn(new THREE.Vector3(x, this.world.terrain.getHeight(x, z), z), yawCam + Math.PI);
      this.camRig.yaw = yawCam;
      this.camRig.pitch = pitch;
      this.camRig.snap();
    };
    const hideOverlays = () => {
      for (const id of ['#title-screen', '#pause-screen', '#death-screen', '#victory-screen', '#panel', '#map-screen']) document.querySelector(id)?.classList.add('hidden');
      this.hud.hideDialogue();
      this.hud.show(true);
    };
    const botHelpers = import.meta.env.DEV || new URLSearchParams(window.location.search).has('test');
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.rng = createSeededRandom(value);
        this.ctx.rng = this.rng;
      },
      setState: (name: string) => {
        const known = ['title', 'active-play', 'medina-day', 'medina-souk', 'kasbah-night', 'combat', 'night-stealth', 'map', 'inventory', 'dialogue', 'death', 'victory'];
        if (!known.includes(name)) throw new Error(`Unknown test state: ${name}`);
        hideOverlays();
        for (const e of this.enemies) e.reset();
        this.quests.jump(0, 0);
        this.player.inventory = { ...emptyInventory(), bread: 1, dates: 2, herbs: 1, ammo: 12, water: 3, cloth: 2, scrap: 2, powder: 1, wood: 1 };
        this.player.clips.rifle = 5;
        this.state = 'playing';
        const d = zone('douar');
        const m = zone('medina');
        const k = zone('kasbah');
        const post = zone('post');
        switch (name) {
          case 'title':
            this.state = 'title';
            this.hud.show(false);
            document.querySelector('#title-screen')?.classList.remove('hidden');
            this.sky.setHour(16.6);
            break;
          case 'active-play':
            this.sky.setHour(16.8);
            setPlayer(d.x + 6, d.z + 10, 0.5);
            break;
          case 'medina-day':
            this.sky.setHour(17.4);
            this.quests.jump(1, 1);
            this.player.inventory.leaflet = 3;
            setPlayer(m.x - 92, m.z + 26, -1.2, 0.08);
            break;
          case 'medina-souk':
            this.sky.setHour(17.8);
            this.quests.jump(1, 1);
            this.player.inventory.leaflet = 3;
            setPlayer(m.x + 8, m.z + 0.5, -Math.PI / 2 - 0.06, 0.12);
            for (const e of this.enemies) if (e.spawn.zone === 'medina') e.pacify();
            break;
          case 'kasbah-night':
            this.sky.setHour(22.5);
            this.quests.jump(3, 1);
            setPlayer(k.x - 44, k.z - 10, -1.05, 0.12);
            this.player.crouched = true;
            break;
          case 'night-stealth':
            this.sky.setHour(23);
            this.quests.jump(4, 1);
            setPlayer(post.x + 2, post.z - 52, Math.PI + 0.02, 0.1);
            this.player.crouched = true;
            break;
          case 'combat': {
            this.sky.setHour(15.5);
            this.quests.jump(2, 1);
            setPlayer(post.x - 3, post.z - 44, Math.PI + 0.05, 0.08);
            this.player.setWeapon('rifle');
            for (const e of this.enemies) if (e.spawn.zone === 'post' && e.pos.distanceTo(this.player.pos) < 40) e.alertFrom(this.player.pos);
            break;
          }
          case 'map':
            this.sky.setHour(12);
            setPlayer(d.x + 6, d.z + 10, 0.5);
            this.openOverlay('map');
            break;
          case 'inventory':
            this.sky.setHour(12);
            setPlayer(d.x + 6, d.z + 10, 0.5);
            this.panelTab = 'inv';
            this.openOverlay('panel');
            break;
          case 'dialogue':
            this.sky.setHour(16.8);
            setPlayer(d.x - 1, d.z, 2.4);
            this.startDialogue('zahra');
            break;
          case 'death':
            this.sky.setHour(14);
            setPlayer(post.x - 6, post.z - 50, Math.PI);
            this.player.damage(999, { kind: 'shot', by: { en: 'French soldier', ar: 'عسكري فرنساوي' } }, this.gameTime);
            this.player.deathT = 3;
            this.showDeath();
            break;
          case 'victory':
            this.sky.setHour(6.4);
            setPlayer(d.x + 6, d.z + 10, 0.5);
            this.showVictory();
            break;
        }
        this.camRig.update(0.016, this.player.pos, this.player.crouched ? 1 : 0, 0, false, this.world.collision, this.world.terrain);
        this.sky.update(this.player.pos, this.camera);
        this.player.update(0.016, this.input, this.camRig.yaw, this.world.terrain, this.world.collision, true, this.gameTime);
        this.updateAlertLevel();
        if (this.state !== 'title') this.updateHud();
        this.pipeline.render();
        this.publishDiagnostics();
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
      },
      hideDebugUi: () => undefined,
      // Bot-only helpers: aim the camera (stands in for mouse look, which needs pointer lock)
      // and read target positions. Movement and actions still go through real keyboard input.
      lookAt: (x: number, z: number) => {
        this.camRig.yaw = Math.atan2(-(x - this.player.pos.x), -(z - this.player.pos.z));
      },
      targets: () => {
        const out: Record<string, { x: number; z: number }> = {};
        for (const it of this.world.interactables) out[it.id] = { x: it.pos.x, z: it.pos.z };
        for (const n of this.npcs) out[`npc:${n.spawn.id}`] = { x: n.pos.x, z: n.pos.z };
        for (const e of this.enemies) out[`enemy:${e.spawn.id}`] = { x: e.pos.x, z: e.pos.z, yaw: e.yaw, alive: e.alive ? 1 : 0 } as { x: number; z: number };
        out.hideout = { x: this.world.hideout.x, z: this.world.hideout.z };
        return out;
      },
      setHour: (h: number) => this.sky.setHour(h),
      input: (action: string, down: boolean) => this.input.press(action as Parameters<Input['press']>[0], down),
      teleport: (x: number, z: number) => {
        this.player.pos.set(x, this.world.terrain.getHeight(x, z), z);
        this.camRig.snap();
      },
      step: (seconds: number) => {
        // fixed-step simulation without rendering: lets slow (CPU-rendered) CI runs advance game time
        const n = Math.max(1, Math.round(seconds / 0.05));
        for (let i = 0; i < n; i += 1) this.update(0.05, this.elapsed + 0.05);
      },
      give: (items: Record<string, number>) => {
        for (const [k, v] of Object.entries(items)) if (k in this.player.inventory) this.player.inventory[k as ItemId] += v;
      },
      grantWeapon: (w: string) => this.grantWeapon(w as WeaponId),
      landmarks: () => this.world.landmarks.map((l) => ({ id: l.id, x: l.x, z: l.z })),
      setLang: (l: string) => setLang(l as Lang),
      stress: (n: number) => {
        // load test: alert every guard near the player and fill the sky with gunfire
        for (const e of this.enemies) if (e.alive && e.pos.distanceTo(this.player.pos) < n) e.alertFrom(this.player.pos);
      },
    };
    if (!botHelpers) {
      // player-facing build: keep the inspector contract, drop the cheat-capable bot helpers
      const h = window.__THREE_GAME_TEST_HOOKS__;
      delete h.teleport;
      delete h.setHour;
      delete h.input;
      delete h.give;
      delete h.grantWeapon;
      delete h.stress;
    }
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const p = this.player;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.quests.mission,
      targetScore: MISSIONS.length,
      complete: this.quests.finished,
      player: {
        position: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
        speed: p.moveSpeed,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.pipeline.maxDpr),
      },
      game: {
        state: this.state,
        hour: this.sky.hour,
        health: p.health,
        hunger: p.hunger,
        thirst: p.thirst,
        dead: p.dead,
        alert: this.alertLevel,
        mission: this.quests.current?.id ?? 'done',
        step: this.quests.step,
        enemiesAlive: this.enemies.filter((e) => e.alive).length,
        kills: this.stats.kills,
        inventory: { ...p.inventory },
        clip: p.clip,
        interact: this.interactTarget?.id ?? null,
        weapon: p.weapon,
        weapons: [...p.owned],
        upgrades: [...p.upgrades],
        discovered: [...this.discovered],
        fogRevealed: this.fog.reduce((a, v) => a + v, 0) / this.fog.length,
        skills: { ...p.skills },
        lang: lang(),
        song: this.audio.currentSong,
        quality: this.pipeline.quality,
        software: this.software,
      },
    };
  }
}
