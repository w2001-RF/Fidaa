import * as THREE from 'three';
import { Input } from '../core/Input';
import { Loop } from '../core/Loop';
import { RenderPipeline, createRenderer, isSoftwareRenderer, type Quality } from '../core/Renderer';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MaterialLibrary } from '../assets/Materials';
import { Enemy, type EnemyContext, type ShotRequest } from '../entities/Enemy';
import { Npc } from '../entities/Npc';
import { SPECIES, Wildlife, type Animal } from '../entities/Wildlife';
import { RIDES, Rides, type Ride, type RideKind, type Body, type PlaneControls } from '../entities/Rides';
import { Player, type Skill } from '../entities/Player';
import { AudioSystem } from '../systems/Audio';
import { CameraRig } from '../systems/CameraRig';
import { Vfx } from '../systems/Vfx';
import { Hud, type AlertLevel, type CompassMarker, type Indicator } from '../ui/Hud';
import { MapView } from '../ui/MapView';
import { clamp, dampAngle } from '../utils/noise';
import { createSeededRandom } from '../utils/random';
import { NavGrid } from '../world/NavGrid';
import { Sky } from '../world/Sky';
import { Vegetation, type Harvestable } from '../world/Vegetation';
import { World } from '../world/World';
import { LAKE, zone, DOUAR_STRIP } from '../world/layout';
import { L, lang, onLangChange, setLang, t, tr, trAlt, type Lang } from '../i18n';
import { ITEMS, RECIPES, SKILL_MAX, WEAPONS, WEAPON_ORDER, emptyInventory, type Recipe, type WeaponId, type CampKind } from './Items';
import { AMBIENT_LINES, MISSIONS, QuestSystem, type Line } from './Quests';
import { pushApart } from '../world/Collision';
import { BoltDrops } from '../entities/Bolts';
import { Camp } from '../world/Camp';
import { WARES, priceBuy, priceSell, type Ware } from './Trade';
import { SaveStore, packBits, unpackBits, type SaveData } from './SaveGame';
import type { Interactable, ItemId, LootBundle } from './types';

type GameState = 'title' | 'playing' | 'paused' | 'dialogue' | 'panel' | 'map' | 'dead' | 'victory';

const LIGHT_POOL = 5;
const NO_CONTROLS = { f: false, b: false, l: false, r: false, boost: false, up: false, down: false };
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
  private readonly wildlife: Wildlife;
  /** One reusable prompt for the nearest tree or rock (thousands exist; only the closest matters). */
  private readonly harvestIt: Interactable = { id: 'harvest', kind: 'harvest', pos: new THREE.Vector3(), radius: 2.6, prompt: { en: '', ar: '' }, hold: 2.2, enabled: false };
  private harvestRef: Harvestable | null = null;
  private readonly rides: Rides;
  /** the mount or vehicle the player is on */
  private riding: Ride | null = null;
  private landedReported = false;
  private readonly saves = new SaveStore();
  private pendingSave: SaveData | null = null;
  private autosaveT = 60;
  private lastSaveAt = -99;

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
  private stats = { kills: 0, takedowns: 0, shots: 0, startDay: 0, hunts: 0 };
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

    // wildlife: gazelles, boars and hares of the wilds, each carcass can be skinned
    this.wildlife = new Wildlife(this.world.terrain, this.world.collision);
    this.scene.add(this.wildlife.group);
    this.scene.add(this.bolts.mesh);
    this.camp = new Camp(this.world.terrain, this.world.collision);
    this.scene.add(this.camp.group);
    // traders: the souk's merchants behind their counters, and the nomads at their camp
    for (const n of this.npcs) {
      if (!n.spawn.id.startsWith('merchant-') && n.spawn.id !== 'nomad-trader') continue;
      this.world.interactables.push({
        id: `trade-${n.spawn.id}`,
        kind: 'trade',
        pos: n.pos,
        radius: 2.8,
        prompt: n.spawn.id === 'nomad-trader' ? L('Trade with the nomads', 'تبادل مع الرحّالة') : L('Trade with the merchant', 'بيع وشري مع مول الحانوت'),
        hold: 0,
        enabled: true,
        ref: n.spawn.id,
      });
    }
    this.wildlife.onAttack = (a) => this.onAnimalAttack(a);
    this.wildlife.onCharge = (a) => {
      this.audio.grunt(a.pos.distanceTo(this.camera.position));
      if (a.pos.distanceTo(this.player.pos) < 40) this.hud.toast(t('msg.boarCharge'), 'bad');
    };
    for (const a of this.wildlife.animals) {
      const name = SPECIES[a.species].name;
      this.world.interactables.push({ id: `carcass-${a.id}`, kind: 'carcass', pos: a.pos, radius: 2, prompt: { en: `Skin the ${name.en.toLowerCase()}`, ar: `سلخ ${name.ar}` }, hold: 1.6, enabled: false, ref: a.id });
    }

    this.world.interactables.push(this.harvestIt);

    // mounts and vehicles
    this.rides = new Rides(this.world.terrain, this.world.collision);
    this.scene.add(this.rides.group);
    const verb: Record<RideKind, [string, string]> = {
      donkey: ['Ride the donkey', 'ركب الحمار'],
      mule: ['Ride the mule', 'ركب البغل'],
      horse: ["Steal the Caïd's horse", 'سرق عود القايد'],
      camel: ['Ride the camel', 'ركب الجمل'],
      jeep: ['Drive the jeep', 'سوق الجيب'],
      boat: ['Take the boat', 'ركب الفلوكة'],
      train: ['Board the train', 'طلع للماشينا'],
      plane: ['Climb into the plane', 'طلع للطيارة'],
    };
    for (const r of this.rides.rides) {
      const [en, ar] = verb[r.kind];
      this.world.interactables.push({ id: `ride-${r.kind}`, kind: 'ride', pos: r.pos, radius: RIDES[r.kind].reach, prompt: L(en, ar), hold: r.kind === 'horse' || r.kind === 'plane' || r.kind === 'jeep' ? 0.8 : 0, enabled: true, ref: r.kind });
    }
    this.rides.onCrash = (r) => this.onPlaneCrash(r);
    this.rides.onImpact = (r, speed) => this.onRideImpact(r, speed);

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
    try {
      if (localStorage.getItem('fidai-view') === 'fps') {
        this.camRig.firstPerson = this.player.firstPerson = true;
        this.player.rig.hideHead(true);
      }
    } catch {
      /* storage blocked */
    }
    void this.saves.load().then((data) => {
      this.pendingSave = data;
      document.querySelector('#btn-continue-save')?.classList.toggle('hidden', !data);
    });
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
    on('#btn-continue-save', () => {
      const data = this.pendingSave;
      this.beginPlay();
      if (data) this.applySave(data);
    });
    on('#btn-save', () => void this.saveNow(true));
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
    void this.saveNow(false);
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
    this.tradeWith = '';
    document.querySelector('#panel')?.classList.add('hidden');
    document.querySelector('#map-screen')?.classList.add('hidden');
    this.state = 'playing';
    this.input.requestLock();
  }

  private renderPanel(): void {
    document.querySelectorAll<HTMLButtonElement>('.tab[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.panelTab));
    if (this.panelTab === 'trade' && !this.tradeWith) this.panelTab = 'inv';
    document.querySelector('.tab[data-tab="trade"]')?.classList.toggle('hidden', !this.tradeWith);
    for (const tab of ['inv', 'craft', 'journal', 'skills', 'trade']) document.querySelector(`#tab-${tab}`)?.classList.toggle('hidden', tab !== this.panelTab);
    if (this.tradeWith) this.renderTrade();
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
      if (lx || ly) this.lastLookAt = this.elapsed;
      if (this.riding) {
        this.updateRiding(sim, blocked);
      } else {
        this.player.update(sim, this.input, this.camRig.yaw, this.world.terrain, this.world.collision, blocked, this.gameTime);
        this.pushPlayerFromBodies();
        // deep water: the lake is crossed by boat, not on foot
        const lx = this.player.pos.x - LAKE.x;
        const lz = this.player.pos.z - LAKE.z;
        const ld = Math.hypot(lx, lz);
        if (ld < LAKE.water - 1.2) {
          const k = (LAKE.water - 1.2) / (ld || 1);
          this.player.pos.x = LAKE.x + lx * k;
          this.player.pos.z = LAKE.z + lz * k;
          this.player.pos.y = this.world.terrain.getHeight(this.player.pos.x, this.player.pos.z);
        }
        if (!blocked) {
          this.handleWeapons(sim);
          this.handleInteraction(sim);
        } else {
          this.hud.setPrompt(null);
        }
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
      this.ctx.playerStealth = this.player.stealthFactor() * (this.riding ? RIDES[this.riding.kind].stealth : 1);
      this.ctx.playerConcealed = this.concealed;
      this.ctx.playerDead = this.player.dead || this.state === 'title' || this.ceasefire;
      this.ctx.pathBudget.left = 4;
      for (const e of this.enemies) {
        const d = e.pos.distanceTo(this.camera.position);
        e.rig.root.visible = e.alive ? d < 150 : d < 90;
        // a rifle is a few pixels past 70 m: skip its draw call
        if (e.rig.rifle) e.rig.rifle.visible = d < 70;
        e.update(sim, this.ctx);
        if (!e.alive && e.respawnAt === Infinity) this.onEnemyKilledCleanup(e);
        if (!e.alive && this.gameTime > e.respawnAt && e.pos.distanceTo(this.player.pos) > 120) this.respawnEnemy(e);
      }
      if (!this.riding) this.rides.update(sim, null, NO_CONTROLS, this.camera.position);
      this.wildlife.update(sim, {
        playerPos: this.player.pos,
        stealth: this.player.stealthFactor() * (this.concealed ? 0.5 : 1),
        hunterRank: this.player.skills.hunter,
        night: this.sky.night,
        now: this.gameTime,
        cameraPos: this.camera.position,
        playerDead: this.player.dead || this.state === 'title',
      });
      this.syncCarcasses();
      const got = this.bolts.update(sim, this.player.pos);
      if (got > 0 && !this.player.dead) {
        this.player.inventory.bolt += got;
        this.audio.pickup();
        this.hud.toast(t('msg.boltBack', { n: got }), 'good');
      }
      this.camp.update(this.elapsed);
      for (const n of this.npcs) {
        n.rig.root.visible = !n.fled && n.pos.distanceTo(this.camera.position) < 110;
        n.update(sim, this.world.terrain, this.world.collision, this.player.pos);
      }
      this.updateQuestsAmbient();
      this.updateAlertLevel();
      this.updateExploration(sim);
      this.autosaveT -= sim;
      if (this.autosaveT <= 0 && this.state === 'playing' && !this.player.dead) {
        this.autosaveT = 60;
        void this.saveNow(false);
      }
    }

    // ---- camera, sky, lights, effects
    this.camRig.reducedMotion = this.reducedMotion;
    if (this.state === 'playing') {
      if (this.input.wasPressed('view')) this.setFirstPerson(!this.camRig.firstPerson);
      this.camRig.lookBack = this.input.isHeld('lookBack');
    } else this.camRig.lookBack = false;
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
    const slotKeys = ['weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5', 'weapon6', 'weapon7', 'weapon8'] as const;
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
    if (i.wasPressed('eat')) this.useItem(p.inventory.tagine > 0 ? 'tagine' : p.inventory.cookedMeat > 0 ? 'cookedMeat' : p.inventory.bread > 0 ? 'bread' : p.inventory.driedMeat > 0 ? 'driedMeat' : 'dates');
    if (i.wasPressed('heal')) this.useItem(p.inventory.bandage > 0 && p.health < p.maxHealth - 30 ? 'bandage' : 'herbs');

    const gun = p.gun;
    if (gun && i.wasPressed('reload') && p.reloadT < 0 && p.clip < gun.clip && (gun.infinite || p.inventory[gun.ammo] > 0)) {
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
          if (gun && (gun.infinite || p.inventory[gun.ammo] > 0)) {
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
      return;
    }
    for (const a of this.wildlife.animals) {
      if (a.state === 'dead') continue;
      const dx = a.pos.x - p.pos.x;
      const dz = a.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.2 || (dx * fx + dz * fz) / (d || 1) < 0.3) continue;
      const killed = this.wildlife.takeHit(a, 60 * (p.upgrades.has('sharpBlade') ? 1.6 : 1) * (1 + p.skills.hunter * 0.2), p.pos);
      this.audio.hit(true);
      this.vfx.impact(this.tmpA.set(a.pos.x, a.pos.y + SPECIES[a.species].bodyY, a.pos.z), 'blood', 5);
      this.hud.hitMarker(killed);
      if (killed) this.onAnimalKill(a);
      return;
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
    // sling and crossbow: no flash, no tracer
    const sling = p.weapon === 'sling' || p.weapon === 'crossbow';
    if (!sling) this.vfx.muzzle(muzzle, aimDir);
    const hits = new Map<Enemy, { dmg: number; head: boolean }>();
    const animalHits = new Map<Animal, number>();
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
      let hitAnimal: Animal | null = null;
      let head = false;
      for (const e of this.enemies) {
        const h = e.hitTest(origin, dir, range);
        if (h && h.t < hitT) {
          hitT = h.t;
          hitEnemy = e;
          head = h.head;
        }
      }
      const ah = this.wildlife.hitTest(origin, dir, range);
      if (ah && ah.t < hitT) {
        hitT = ah.t;
        hitAnimal = ah.animal;
        hitEnemy = null;
      }
      const tw = this.world.collision.raycast(origin, end, false);
      if (tw >= 0 && tw * range < hitT) {
        hitT = tw * range;
        hitEnemy = null;
        hitAnimal = null;
      }
      const tt = this.world.terrain.raycastSegment(origin, end, 1);
      if (tt >= 0 && tt * range < hitT) {
        hitT = tt * range;
        hitEnemy = null;
        hitAnimal = null;
      }
      const hitPoint = origin.clone().addScaledVector(dir, hitT);
      if (k < 3 && !sling) this.vfx.tracer(muzzle, hitPoint);
      if (p.weapon === 'crossbow') this.landBolt(hitPoint, dir, hitT < range, hitEnemy?.pos ?? hitAnimal?.pos ?? null);
      if (hitAnimal) {
        const fall = clamp(1.4 - hitT / range, 0.45, 1);
        animalHits.set(hitAnimal, (animalHits.get(hitAnimal) ?? 0) + gun.damage * fall * (1 + p.skills.hunter * 0.2) * (1 + p.skills.marksman * 0.12));
        this.vfx.impact(hitPoint, 'blood', gun.pellets > 1 ? 3 : 6);
        continue;
      }
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
    for (const [a, dmg] of animalHits) {
      const killed = this.wildlife.takeHit(a, dmg, p.pos);
      this.hud.hitMarker(killed);
      if (killed) this.onAnimalKill(a);
    }
    this.audio.gunShot(p.weapon);
    this.camRig.addTrauma(gun.trauma);
    this.camRig.punchFov(gun.fov);
    // gunshots carry
    this.broadcastNoise(p.pos, gun.noise, true);
  }

  /**
   * A shot bolt ends up somewhere you can fetch it: stuck where it struck, lying
   * by the man or beast it hit, or in the dirt where it came down. One in six
   * snaps on stone or bone.
   */
  private landBolt(hitPoint: THREE.Vector3, dir: THREE.Vector3, struck: boolean, body: THREE.Vector3 | null): void {
    if (this.rng() < (body ? 0.25 : 0.15)) return;
    const terrain = this.world.terrain;
    if (body) {
      const x = body.x + dir.x * 0.4;
      const z = body.z + dir.z * 0.4;
      this.bolts.drop(this.tmpA.set(x, terrain.getHeight(x, z) + 0.05, z), this.tmpB.set(dir.x, -0.7, dir.z).normalize());
      return;
    }
    if (struck) {
      this.bolts.drop(hitPoint, dir);
      return;
    }
    // spent at full range: it comes down in the dirt
    const x = hitPoint.x;
    const z = hitPoint.z;
    this.bolts.drop(this.tmpA.set(x, terrain.getHeight(x, z) + 0.02, z), this.tmpB.set(dir.x, -0.8, dir.z).normalize());
  }

  // ================================================================ trade

  private openTrade(trader: string): void {
    this.tradeWith = trader;
    this.panelTab = 'trade';
    this.openOverlay('panel');
  }

  /** Smugglers (the souk's first merchant, the nomads) also deal in powder, cartridges and guns. */
  private smuggler(trader: string): boolean {
    return trader === 'merchant-0' || trader === 'nomad-trader';
  }

  private tradeBuy(w: Ware): void {
    const p = this.player;
    const price = priceBuy(w, p.skills.scavenger);
    if (p.inventory.francs < price) return void this.hud.toast(t('trade.poor'), 'bad');
    if ((w.weapon && p.owned.has(w.weapon)) || (w.upgrade && p.upgrades.has(w.upgrade))) return;
    p.inventory.francs -= price;
    if (w.item) p.inventory[w.item] += w.qty;
    if (w.weapon) this.grantWeapon(w.weapon);
    if (w.upgrade) {
      p.upgrades.add(w.upgrade);
      if (w.upgrade === 'bigSkin') p.inventory.water = p.waterCharges;
    }
    this.audio.pickup();
  }

  private tradeSell(w: Ware, all: boolean): void {
    const p = this.player;
    if (!w.item || !w.sell || p.inventory[w.item] <= 0) return;
    const n = all ? p.inventory[w.item] : 1;
    p.inventory[w.item] -= n;
    p.inventory.francs += priceSell(w, p.skills.scavenger) * n;
    this.audio.pickup();
  }

  private renderTrade(): void {
    const p = this.player;
    const smuggler = this.smuggler(this.tradeWith);
    const wares = WARES.filter((w) => smuggler || !w.contraband).map((w) => ({
      w,
      buy: w.buy ? priceBuy(w, p.skills.scavenger) : 0,
      sell: w.sell ? priceSell(w, p.skills.scavenger) : 0,
      have: w.item ? p.inventory[w.item] : 0,
      owned: Boolean((w.weapon && p.owned.has(w.weapon)) || (w.upgrade && p.upgrades.has(w.upgrade))),
    }));
    this.hud.renderTrade(
      wares,
      p.inventory.francs,
      smuggler,
      (w) => {
        this.tradeBuy(w);
        this.renderPanel();
      },
      (w, all) => {
        this.tradeSell(w, all);
        this.renderPanel();
      },
    );
  }

  // ================================================================ camp

  /** Set a camp piece down two and a half metres in front of the fidāʾī. */
  private buildCamp(kind: CampKind): boolean {
    const p = this.player;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    for (const d of [2.6, 3.4, 2]) {
      const x = p.pos.x + fx * d;
      const z = p.pos.z + fz * d;
      if (!this.camp.canPlace(kind, x, z)) continue;
      const piece = this.camp.place(kind, x, z, p.yaw + Math.PI);
      this.world.interactables.push(piece.it);
      this.vfx.impact(this.tmpA.set(x, this.world.terrain.getHeight(x, z) + 0.4, z), 'dust', 10);
      return true;
    }
    this.hud.toast(t('camp.noRoom'), 'bad');
    return false;
  }

  /** Near a cooking station: your camp's oven or fire, or the douar's bread oven. */
  private nearStation(station: 'oven' | 'fire'): boolean {
    const p = this.player.pos;
    if (this.camp.near(station, p.x, p.z)) return true;
    return this.world.interactables.some((it) => it.kind === 'oven' && Math.hypot(it.pos.x - p.x, it.pos.z - p.z) < 4);
  }

  private onAnimalKill(a: Animal): void {
    if (a.counted) return;
    a.counted = true;
    this.stats.hunts += 1;
    const def = SPECIES[a.species];
    this.giveXp(def.xp, t('xp.hunt', { what: tr(def.name) }));
  }

  private onAnimalAttack(a: Animal): void {
    const p = this.player;
    if (p.dead || this.state !== 'playing') return;
    p.damage(18, { kind: 'melee', by: SPECIES[a.species].name }, this.gameTime);
    this.audio.hit(true);
    this.audio.hurt();
    this.audio.grunt(1);
    this.camRig.addTrauma(0.45);
    this.hud.damageFrom(this.screenAngleTo(a.pos));
    this.hitstop(0.06);
  }

  // ================================================================ camera views

  private setFirstPerson(on: boolean): void {
    this.camRig.firstPerson = on;
    this.player.firstPerson = on;
    this.player.rig.hideHead(on);
    this.hud.toast(t(on ? 'view.first' : 'view.third'));
    try {
      localStorage.setItem('fidai-view', on ? 'fps' : 'tps');
    } catch {
      /* storage blocked */
    }
  }

  // ================================================================ save / load

  private serialize(): SaveData {
    const p = this.player;
    return {
      version: 1,
      savedAt: Date.now(),
      quest: this.quests.snapshot(),
      player: {
        x: p.pos.x,
        z: p.pos.z,
        yaw: p.yaw,
        health: p.health,
        hunger: p.hunger,
        thirst: p.thirst,
        xp: p.xp,
        level: p.level,
        skillPoints: p.skillPoints,
        skills: { ...p.skills },
        inventory: { ...p.inventory },
        weapons: [...p.owned],
        clips: { ...p.clips },
        upgrades: [...p.upgrades],
      },
      world: {
        hour: this.sky.hour,
        days: this.daysPassed,
        used: [...this.usedInteractables, ...this.world.interactables.filter((i) => i.kind === 'loot' && !i.enabled).map((i) => `searched:${i.id}`)],
        discovered: [...this.discovered],
        fog: packBits(this.fog),
        harvested: this.veg.harvestables.filter((h) => h.done).map((h) => h.id),
        camp: this.camp.pieces.map((c) => ({ kind: c.kind, x: c.x, z: c.z, yaw: c.yaw })),
        prisonOpened: this.prisonOpened,
        carrying: this.carrying,
      },
      stats: { ...this.stats },
    };
  }

  /** Save to IndexedDB (cookie fallback). Throttled; `announce` shows a toast. */
  private async saveNow(announce: boolean): Promise<void> {
    if (this.state === 'title' || this.player.dead || this.victoryShown) return;
    if (!announce && this.elapsed - this.lastSaveAt < 2) return;
    this.lastSaveAt = this.elapsed;
    const ok = await this.saves.save(this.serialize());
    if (announce) this.hud.toast(ok ? t(this.saves.backend === 'cookie' ? 'save.cookie' : 'save.saved') : t('save.failed'), ok ? 'good' : 'bad');
    const label = document.querySelector('#save-status');
    if (label && ok) label.textContent = t('save.last', { time: new Date().toLocaleTimeString(lang() === 'ar' ? 'ar-MA' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) });
  }

  private applySave(d: SaveData): void {
    const p = this.player;
    this.quests.restore(d.quest);
    p.spawn(new THREE.Vector3(d.player.x, this.world.terrain.getHeight(d.player.x, d.player.z), d.player.z), d.player.yaw);
    p.health = d.player.health;
    p.hunger = d.player.hunger;
    p.thirst = d.player.thirst;
    p.xp = d.player.xp;
    p.level = d.player.level;
    p.skillPoints = d.player.skillPoints;
    Object.assign(p.skills, d.player.skills);
    p.inventory = { ...p.inventory, ...d.player.inventory };
    p.owned.clear();
    for (const w of d.player.weapons) p.owned.add(w as WeaponId);
    Object.assign(p.clips, d.player.clips);
    p.upgrades.clear();
    for (const u of d.player.upgrades) p.upgrades.add(u as (typeof p.upgrades extends Set<infer U> ? U : never));
    this.sky.setHour(d.world.hour);
    this.lastHour = d.world.hour;
    this.daysPassed = d.world.days;
    for (const id of d.world.used) {
      if (id.startsWith('searched:')) {
        const it = this.world.interactables.find((i) => i.id === id.slice(9));
        if (it) it.enabled = false;
        continue;
      }
      this.usedInteractables.add(id);
      const it = this.world.interactables.find((i) => i.id === id);
      if (!it) continue;
      if (it.kind === 'leaflet') this.world.postLeaflet(id);
      else if (it.kind === 'pole') this.world.cutPole(Number(it.ref));
      else if (it.kind === 'cache') this.world.takeArmsCache();
      else if (it.kind === 'weapon') it.enabled = false;
    }
    if (d.world.prisonOpened) {
      this.prisonOpened = true;
      this.world.openPrison();
      for (const n of this.npcs) {
        if (n.spawn.outfit !== 'prisoner') continue;
        n.fled = true;
        n.rig.root.visible = false;
      }
    }
    this.carrying = d.world.carrying;
    this.carryCrate.visible = this.carrying;
    for (const id of d.world.discovered) this.discovered.add(id);
    if (d.world.fog) unpackBits(d.world.fog, this.fog);
    for (const c of d.world.camp ?? []) {
      if (this.camp.pieces.some((q) => q.kind === c.kind && Math.hypot(q.x - c.x, q.z - c.z) < 0.5)) continue;
      this.world.interactables.push(this.camp.place(c.kind as CampKind, c.x, c.z, c.yaw).it);
    }
    for (const id of d.world.harvested ?? []) {
      const h = this.veg.harvestables[id];
      if (h) this.veg.harvest(h);
    }
    Object.assign(this.stats, d.stats);
    this.camRig.yaw = p.yaw + Math.PI;
    this.camRig.snap();
    const m = this.quests.current;
    this.hud.showBanner(t('save.resumed'), m ? tr(m.title) : t('mission.free'), m ? trAlt(m.title) : '');
  }

  // ================================================================ riding

  private mount(r: Ride): void {
    this.riding = r;
    this.player.crouched = false;
    this.player.setWeapon('blade');
    this.player.rig.sheathBlade();
    this.interactTarget = null;
    this.hud.setPrompt(null);
    this.camRig.rideDistance = RIDES[r.kind].cam;
    this.camRig.rideHeight = RIDES[r.kind].camH;
    this.camRig.seated = true;
    this.camRig.yaw = r.yaw + Math.PI;
    this.audio.pickup();
    this.hud.toast(t('ride.mounted', { what: tr(RIDES[r.kind].name) }), 'good');
    if (r.kind === 'plane') this.hud.showBanner(t('ride.cockpit'), tr(RIDES.plane.name), t('ride.planeHelp'), 8000);
    if (r.kind === 'plane') this.questEvent('board:plane');
    for (const it of this.world.interactables) if (it.kind === 'ride') it.enabled = false;
  }

  private dismount(): void {
    this.hud.setGauges(null);
    const r = this.riding;
    if (!r) return;
    this.riding = null;
    const at = this.rides.exitPoint(r, this.tmpA);
    this.player.spawn(at.clone(), r.yaw);
    this.player.health = Math.min(this.player.maxHealth, this.player.health);
    this.camRig.rideDistance = 0;
    this.camRig.rideHeight = 0;
    this.camRig.seated = false;
    this.camRig.snap();
    for (const it of this.world.interactables) if (it.kind === 'ride') it.enabled = true;
  }

  /** The player sits on the ride: rides take WASD; E dismounts or drops leaflets from the plane. */
  private updateRiding(dt: number, blocked: boolean): void {
    const r = this.riding as Ride;
    const p = this.player;
    const i = this.input;
    const ctl = blocked
      ? NO_CONTROLS
      : {
          f: i.isHeld('forward'),
          b: i.isHeld('back'),
          l: i.isHeld('left'),
          r: i.isHeld('right'),
          boost: i.isHeld('sprint'),
          up: i.isHeld('jump'),
          down: i.isHeld('crouch'),
          plane: r.kind === 'plane' ? this.cockpit() : undefined,
        };
    // people and animals stand in the way; a fast jeep runs enemies and game down instead
    const fast = r.kind === 'jeep' && Math.abs(r.speed) > 7;
    this.rides.obstacles = this.characterBodies(fast, this.rides.bodies(r, []));
    this.rides.update(dt, r, ctl, this.camera.position);
    this.updateRideGauges(r);
    this.chaseCamera(r, dt);
    // survival keeps ticking while riding; the seat holds the body
    const seat = this.rides.seatWorld(r, this.tmpB);
    p.update(dt, this.input, this.camRig.yaw, this.world.terrain, this.world.collision, true, this.gameTime);
    p.pos.copy(seat);
    p.vy = 0;
    p.yaw = r.kind === 'train' ? r.yaw : r.yaw;
    p.rig.pose({ dt, speed: 0, crouch: 0, aim: 0, melee: -1, flinch: p.flinch, dead: 0, sitting: true, lookPitch: 0, talk: 0, reload: -1, interact: 0 });
    p.syncTransform();
    if (p.dead) {
      this.dismount();
      return;
    }
    // the jeep runs down whatever stands in its way
    if (r.kind === 'jeep' && Math.abs(r.speed) > 7) {
      for (const e of this.enemies) {
        if (e.alive && e.pos.distanceTo(r.pos) < 2.2) {
          e.takeHit(400, r.pos);
          this.audio.hit(true);
          this.onKill(e, false);
        }
      }
      for (const a of this.wildlife.animals) if (a.state !== 'dead' && a.pos.distanceTo(r.pos) < 2.2 && this.wildlife.takeHit(a, 400, r.pos)) this.onAnimalKill(a);
    }
    if (blocked) return;
    const flying = r.kind === 'plane' && r.flying;
    if (flying && this.quests.currentStep?.objectives.some((o) => o.event === 'airdrop')) {
      const m = zone('medina');
      const over = Math.hypot(r.pos.x - m.x, r.pos.z - m.z) < 75 && r.pos.y - this.world.terrain.getHeight(r.pos.x, r.pos.z) > 12;
      this.hud.setPrompt(over ? t('ride.drop') : t('ride.flyTo'), 0);
      if (over && i.wasPressed('interact')) {
        for (let k = 0; k < 4; k += 1) this.vfx.glint(this.tmpA.set(r.pos.x + (k - 1.5) * 3, r.pos.y - 1, r.pos.z));
        this.audio.discover();
        this.questEvent('airdrop');
      }
    } else if (this.rides.canLeave(r)) {
      const leave = t('ride.leave', { what: tr(RIDES[r.kind].name) });
      this.hud.setPrompt(r.kind === 'plane' && !r.engineOn ? `${leave} · ${t('ride.startEngine')}` : leave, 0);
      if (i.wasPressed('interact')) {
        const landedAway = this.rides.checkLanded(r);
        const nearDouar = Math.hypot(r.pos.x - this.world.hideout.x, r.pos.z - this.world.hideout.z) < 170;
        this.dismount();
        if (landedAway && nearDouar) this.questEvent('landed:douar');
        return;
      }
    } else this.hud.setPrompt(null);
    // a landed plane near the douar completes the flight even before the pilot steps out
    if (r.kind === 'plane' && this.rides.checkLanded(r) && !this.landedReported) {
      if (Math.hypot(r.pos.x - this.world.hideout.x, r.pos.z - this.world.hideout.z) < 170) {
        this.landedReported = true;
        this.questEvent('landed:douar');
      }
    }
    if (r.kind === 'plane' && r.flying) this.landedReported = false;
  }

  private lastLookAt = -99;
  /** test hook: soldiers treat the player as gone */
  private ceasefire = false;
  private readonly bolts = new BoltDrops();
  private camp!: Camp;
  /** the trader whose stall is open in the panel ('' = none) */
  private tradeWith = '';
  private readonly tmpTarget = new THREE.Vector3();

  /**
   * Cockpit controls, GTA-style: W/S throttle, A/D rudder, numpad 4/6 (or ←/→)
   * ailerons, numpad 8/5 (or ↑/↓) elevator, 8 = nose down, 5 = nose up.
   * Space wheel brakes, F/R flaps down/up, T/G trim nose-up/down, N engine.
   */
  private cockpit(): PlaneControls {
    const i = this.input;
    const axis = (plus: boolean, minus: boolean) => (plus ? 1 : 0) - (minus ? 1 : 0);
    return {
      throttle: axis(i.keyHeld('KeyW'), i.keyHeld('KeyS')),
      rudder: axis(i.keyHeld('KeyD'), i.keyHeld('KeyA')),
      aileron: axis(i.keyHeld('Numpad6', 'ArrowRight'), i.keyHeld('Numpad4', 'ArrowLeft')),
      elevator: axis(i.keyHeld('Numpad5', 'ArrowDown', 'Numpad2'), i.keyHeld('Numpad8', 'ArrowUp')),
      brake: i.keyHeld('Space'),
      flaps: axis(i.keyPressed('KeyF'), i.keyPressed('KeyR')),
      trim: axis(i.keyHeld('KeyT'), i.keyHeld('KeyG')),
      engine: i.keyPressed('KeyN'),
    };
  }

  /** In the jeep and the plane the camera swings back behind the nose when the mouse is left alone. */
  private chaseCamera(r: Ride, dt: number): void {
    if ((r.kind !== 'plane' && r.kind !== 'jeep') || this.camRig.lookBack || this.camRig.firstPerson && r.kind === 'jeep') return;
    if (this.elapsed - this.lastLookAt < 1.5) return;
    const k = r.kind === 'plane' ? 2.2 : 1.6;
    this.camRig.yaw = dampAngle(this.camRig.yaw, r.yaw + Math.PI, k, dt);
    const pitch = r.kind === 'plane' && r.flying ? 0.12 + clamp(-r.gamma, -0.4, 0.5) : 0.16;
    this.camRig.pitch += (pitch - this.camRig.pitch) * Math.min(1, dt * k);
  }

  /** People, animals and parked rides as solid circles. `skipHostile` leaves out what a fast jeep runs down. */
  private characterBodies(skipHostile: boolean, out: Body[]): Body[] {
    if (!skipHostile) {
      for (const e of this.enemies) if (e.alive) out.push({ x: e.pos.x, z: e.pos.z, r: 0.36, y0: e.pos.y, y1: e.pos.y + 1.8 });
      for (const a of this.wildlife.animals) {
        if (a.state === 'dead') continue;
        out.push({ x: a.pos.x, z: a.pos.z, r: SPECIES[a.species].radius * 0.8, y0: a.pos.y, y1: a.pos.y + SPECIES[a.species].bodyY * 2 });
      }
    }
    for (const n of this.npcs) if (!n.fled && n.rig.root.visible) out.push({ x: n.pos.x, z: n.pos.z, r: 0.32, y0: n.pos.y, y1: n.pos.y + 1.75 });
    return out;
  }

  private readonly bodyScratch: Body[] = [];

  /** Walk round people, animals and parked rides instead of through them. */
  private pushPlayerFromBodies(): void {
    const p = this.player;
    if (p.dead) return;
    const list = this.bodyScratch;
    list.length = 0;
    this.characterBodies(false, this.rides.bodies(null, list));
    let moved = false;
    for (const b of list) {
      if (b.y1 < p.pos.y + 0.45 || b.y0 > p.pos.y + 1.75) continue;
      if (Math.abs(b.x - p.pos.x) > b.r + 1 || Math.abs(b.z - p.pos.z) > b.r + 1) continue;
      moved = pushApart(p.pos, 0.36, b.x, b.z, b.r) || moved;
    }
    // never shoved into a wall
    if (moved) this.world.collision.resolveCircle(p.pos, 0.36, 1.75);
  }

  /** A driven ride hit something: shake, a thump, and a hurt rider if it was hard. */
  private onRideImpact(r: Ride, speed: number): void {
    if (this.riding !== r) return;
    this.camRig.addTrauma(clamp(speed / 14, 0.15, 0.8));
    this.audio.hit(false);
    if (speed > 11) {
      this.player.damage((speed - 11) * 6, { kind: 'crash' }, this.gameTime);
      this.hud.flash(0.35, '#ff3b2f');
    }
  }

  private updateRideGauges(r: Ride): void {
    const g = this.rides.gauges(r);
    const kmh = `${Math.round(g.speed * 3.6)} ${t('gauge.kmh')}`;
    if (r.kind === 'plane') {
      const flying = r.flying;
      this.hud.setGauges([
        { label: t('gauge.airspeed'), value: kmh, warn: g.stall },
        { label: t('gauge.alt'), value: `${Math.max(0, Math.round(g.alt))} m` },
        { label: t('gauge.vs'), value: `${g.vs >= 0 ? '+' : ''}${g.vs.toFixed(1)} m/s`, warn: flying && g.alt < 15 && g.vs < -3.5 },
        { label: t('gauge.heading'), value: `${String(Math.round(g.heading) % 360).padStart(3, '0')}°` },
        { label: t('gauge.rpm'), value: g.engine === 'off' ? t('gauge.engineOff') : String(g.rpm), warn: g.engine !== 'on' },
        { label: t('gauge.throttle'), value: `${Math.round(g.throttle * 100)}%` },
        { label: t('gauge.flaps'), value: `${g.flaps}°` },
        { label: t('gauge.trim'), value: `${g.trim >= 0 ? '+' : ''}${Math.round(g.trim * 100)}` },
        ...(g.brake ? [{ label: '', value: t('gauge.brake'), warn: true }] : []),
        ...(g.stall ? [{ label: '', value: t('gauge.stall'), warn: true }] : []),
      ]);
      if (g.engine === 'off' && !flying) this.hud.setPrompt(t('ride.startEngine'), 0);
    } else if (r.kind === 'jeep' || r.kind === 'boat' || r.kind === 'train') {
      this.hud.setGauges([{ label: t('gauge.speed'), value: kmh }, ...(g.brake ? [{ label: '', value: t('gauge.brake'), warn: true }] : [])]);
    } else {
      this.hud.setGauges([
        { label: t('gauge.speed'), value: kmh },
        { label: t('gauge.wind'), value: `${Math.round(g.stamina * 100)}%`, warn: g.stamina < 0.2 },
      ]);
    }
  }

  private onPlaneCrash(r: Ride): void {
    this.vfx.impact(this.tmpA.copy(r.pos).setY(r.pos.y + 1), 'spark', 30);
    this.vfx.impact(this.tmpA.copy(r.pos).setY(r.pos.y + 1), 'dust', 30);
    this.audio.gunShot('musket');
    this.camRig.addTrauma(1);
    if (this.riding === r) this.player.damage(999, { kind: 'crash' }, this.gameTime);
  }

  /** Point the single harvest prompt at the nearest tree (axe) or rock (hammer). */
  private syncHarvest(): void {
    const p = this.player;
    const axe = p.upgrades.has('axe');
    const hammer = p.upgrades.has('hammer');
    const it = this.harvestIt;
    it.enabled = false;
    if (!axe && !hammer) return;
    let h = this.veg.nearestHarvestable(p.pos.x, p.pos.z, 1.9);
    if (h && ((h.kind === 'tree' && !axe) || (h.kind === 'rock' && !hammer))) h = null;
    if (!h) return;
    this.harvestRef = h;
    it.enabled = true;
    it.pos.set(h.x, h.y, h.z);
    it.radius = (h.kind === 'rock' ? h.scale * 0.8 : 0.4) + 2.0;
    it.hold = h.kind === 'tree' ? 2.2 : 2.5;
    const tree = { palm: L('Fell the palm', 'قطع النخلة'), olive: L('Fell the olive tree', 'قطع الزيتونة'), argan: L('Fell the argan tree', 'قطع الأركانة'), rock: L('Quarry the rock', 'هرّس الحجرة') }[h.species];
    it.prompt = tree;
  }

  /** Carcasses become searchable when an animal dies; knife speeds skinning. */
  private syncCarcasses(): void {
    const hold = this.player.upgrades.has('skinningKnife') ? 0.8 : 1.6;
    for (const it of this.world.interactables) {
      if (it.kind !== 'carcass') continue;
      const a = this.wildlife.animals.find((x) => x.id === it.ref);
      if (!a) continue;
      if (a.state === 'dead' && !a.counted) this.onAnimalKill(a);
      it.enabled = a.state === 'dead' && !a.skinned && a.deadT > 0.4;
      it.hold = hold;
    }
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
        // a soldier's pay, an officer's purse
        francs: e.isOfficer ? 60 + Math.floor(r() * 80) : 8 + Math.floor(r() * 25),
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
    // a rider or pilot going fast is a hard target for a bolt-action rifle
    const moving = this.riding ? Math.abs(this.riding.speed) : 0;
    if (this.rng() < req.hitChance / (1 + moving / 6)) {
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
    this.wildlife.hearNoise(at, radius);
  }

  private onFootstep(loud: number): void {
    this.audio.footstep(loud);
    if (loud >= 1) {
      this.vfx.footDust(this.tmpC.copy(this.player.pos).setY(this.player.pos.y + 0.05), loud);
      // sprinting is audible
      for (const e of this.enemies) if (e.alive && e.state !== 'alert' && e.pos.distanceTo(this.player.pos) < 7) e.hearNoise(this.player.pos, 7, false);
      if (loud >= 1) this.wildlife.hearNoise(this.player.pos, 11);
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
    this.syncHarvest();
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
      case 'cook':
        this.panelTab = 'craft';
        this.openOverlay('panel');
        break;
      case 'trade':
        this.openTrade(it.ref ?? '');
        break;
      case 'harvest': {
        const h = this.harvestRef;
        if (!h || h.done) break;
        this.veg.harvest(h);
        let loot: LootBundle;
        if (h.kind === 'tree') {
          const big = h.scale > 1.05 ? 1 : 0;
          loot = h.species === 'palm' ? { wood: 2 + big, dates: 2 } : { wood: (h.species === 'olive' ? 4 : 3) + big };
          this.audio.chop();
          this.vfx.impact(this.tmpA.set(h.x, h.y + 1, h.z), 'dust', 10);
        } else {
          // galena lies in the hills around the old lead mine
          const nearMine = Math.hypot(h.x - 196, h.z + 38) < 70;
          const ore = this.rng() < (nearMine ? 0.85 : 0.3) ? 1 + (nearMine && this.rng() < 0.5 ? 1 : 0) : 0;
          loot = { stone: 2 + Math.round(h.scale), ...(ore ? { ore } : {}) };
          this.audio.quarry();
          this.vfx.impact(this.tmpA.set(h.x, h.y + h.scale * 0.6, h.z), 'spark', 8);
          this.vfx.impact(this.tmpA.set(h.x, h.y + h.scale * 0.4, h.z), 'dust', 8);
        }
        this.addItems(this.scavenge(loot));
        this.broadcastNoise(p.pos, 14, false);
        this.giveXp(3, t(h.kind === 'tree' ? 'xp.fell' : 'xp.quarry'));
        this.harvestRef = null;
        break;
      }
      case 'ride': {
        const r = this.rides.get(it.ref as RideKind);
        if (r.crashed) break;
        this.mount(r);
        break;
      }
      case 'carcass': {
        const a = this.wildlife.animals.find((x) => x.id === it.ref);
        if (!a || a.skinned) break;
        const def = SPECIES[a.species];
        const loot: LootBundle = { ...def.yield };
        if (p.upgrades.has('skinningKnife')) {
          loot.hide = (loot.hide ?? 0) + 1;
          loot.rawMeat = (loot.rawMeat ?? 0) + 1;
        }
        loot.rawMeat = (loot.rawMeat ?? 0) + Math.floor(p.skills.hunter / 2);
        this.wildlife.skin(a, this.gameTime);
        it.enabled = false;
        this.addItems(loot);
        this.audio.bandage();
        this.hud.toast(t('msg.skinned', { what: tr(def.name) }), 'good');
        this.giveXp(5, t('xp.skin'));
        break;
      }
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
        window.setTimeout(() => void this.saveNow(false), 50);
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
    const p = this.player.pos;
    return p.distanceTo(this.world.bench) < 5 || this.camp.near('bench', p.x, p.z, 3.5);
  }

  private craftState(r: Recipe): { can: boolean; reason: string; done: boolean } {
    const p = this.player;
    const done = Boolean((r.weapon && p.owned.has(r.weapon)) || (r.upgrade && p.upgrades.has(r.upgrade)));
    if (done) return { can: false, reason: t('craft.owned'), done };
    if ((r.artisan ?? 0) > p.skills.artisan) return { can: false, reason: t('craft.needArtisan', { n: r.artisan ?? 0 }), done };
    if (r.bench && !this.nearBench()) return { can: false, reason: t('craft.needBench'), done };
    if (r.station && !this.nearStation(r.station)) return { can: false, reason: t(r.station === 'oven' ? 'craft.needOven' : 'craft.needFire'), done };
    for (const [k, v] of Object.entries(r.cost) as [ItemId, number][]) {
      if (p.inventory[k] < v) return { can: false, reason: t('craft.missing'), done };
    }
    return { can: true, reason: '', done };
  }

  private craft(r: Recipe): void {
    if (!this.craftState(r).can) return;
    const p = this.player;
    if (r.build && !this.buildCamp(r.build)) return;
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
    } else if (id === 'tea') {
      if (p.inventory.tea <= 0 || p.thirst > 97) return;
      p.inventory.tea -= 1;
      p.thirst = Math.min(100, p.thirst + 40);
      p.stamina = p.maxStamina;
      this.audio.drink();
    } else if (id === 'bread' || id === 'dates' || id === 'cookedMeat' || id === 'rawMeat' || id === 'tagine' || id === 'driedMeat') {
      if (p.inventory[id] <= 0) {
        // F eats the best food in the satchel
        const other = (['tagine', 'cookedMeat', 'bread', 'driedMeat', 'dates', 'rawMeat'] as const).find((f) => p.inventory[f] > 0);
        if (other) return this.useItem(other);
        return void this.hud.toast(t('msg.noFood'), 'bad');
      }
      if (p.hunger > 97) return;
      p.inventory[id] -= 1;
      const food = { bread: 40, dates: 18, cookedMeat: 50, rawMeat: 15, tagine: 80, driedMeat: 35 }[id];
      if (id === 'tagine') p.health = Math.min(p.maxHealth, p.health + 25);
      p.hunger = Math.min(100, p.hunger + food * (1 + p.skills.survivalist * 0.1));
      if (id === 'dates') p.thirst = Math.min(100, p.thirst + 6);
      if (id === 'rawMeat') p.thirst = Math.max(0, p.thirst - 4);
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
    window.setTimeout(() => void this.saveNow(false), 50);
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
    if (id === 'strip:douar') return this.tmpTarget.set(DOUAR_STRIP.x, this.world.terrain.getHeight(DOUAR_STRIP.x, DOUAR_STRIP.z), DOUAR_STRIP.z);
    if (id.startsWith('npc:')) {
      const n = this.npcs.find((x) => x.spawn.id === id.slice(4));
      return n ? n.pos : null;
    }
    if (id.startsWith('it:')) {
      const it = this.world.interactables.find((x) => x.id === id.slice(3));
      if (!it || this.usedInteractables.has(it.id)) return null;
      return it.pos;
    }
    if (id.startsWith('ride:')) {
      if (this.riding) return null;
      return this.rides.get(id.slice(5) as RideKind).pos;
    }
    if (id.startsWith('zone:')) {
      const z = zone(id.slice(5) as 'medina');
      return this.tmpC.set(z.x, this.world.terrain.getHeight(z.x, z.z), z.z);
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
      cause.kind === 'thirst' ? t('death.thirst') : cause.kind === 'hunger' ? t('death.hunger') : cause.kind === 'crash' ? t('death.crash') : cause.kind === 'melee' ? t('death.melee', { who }) : t('death.shot', { who });
    const hint = cause.kind === 'thirst' || cause.kind === 'hunger' ? t('death.hintSurvival') : this.sky.night < 0.5 ? t('death.hintDay') : t('death.hintNight');
    document.querySelector('#death-hint')!.textContent = hint;
  }

  private retry(): void {
    document.querySelector('#death-screen')?.classList.add('hidden');
    document.querySelector('#pause-screen')?.classList.add('hidden');
    this.respawnPlayer(false);
    this.riding = null;
    this.camRig.rideDistance = 0;
    this.camRig.rideHeight = 0;
    this.camRig.seated = false;
    for (const it of this.world.interactables) if (it.kind === 'ride') it.enabled = true;
    const plane = this.rides.get('plane');
    if (plane.crashed || plane.flying) {
      this.rides.reset(plane);
      if (this.quests.current?.id === 'flight' && this.quests.step > 1) this.quests.jump(5, 1);
    }
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
      [this.stats.hunts, t('victory.hunts')],
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
      reserve: p.gun ? (p.gun.infinite ? -1 : p.inventory[p.gun.ammo]) : 0,
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
      harvestables: (kind: string) =>
        this.veg.harvestables
          .filter((h) => !h.done && h.kind === kind)
          .map((h) => ({ id: h.id, x: h.x, z: h.z, scale: h.scale }))
          .sort((a, b) => Math.hypot(a.x - this.player.pos.x, a.z - this.player.pos.z) - Math.hypot(b.x - this.player.pos.x, b.z - this.player.pos.z))
          .slice(0, 5),
      colliders: (x: number, z: number, r: number) =>
        this.world.collision.colliders
          .filter((c) => c.enabled && Math.hypot(c.x - x, c.z - z) < r + (c.kind === 'circle' ? c.r : Math.max(c.hx, c.hz)))
          .map((c) => ({ tag: c.tag ?? c.kind, x: c.x, z: c.z, r: c.kind === 'circle' ? c.r : Math.max(c.hx, c.hz), top: c.y1 })),
      save: () => this.saveNow(false).then(() => this.saves.backend),
      bolts: () => this.bolts.positions(),
      camp: () => this.camp.pieces.map((c) => ({ kind: c.kind, x: c.x, z: c.z, ix: c.it.pos.x, iz: c.it.pos.z })),
      rides: () => this.rides.rides.map((r) => ({ kind: r.kind, x: r.pos.x, y: r.pos.y, z: r.pos.z, speed: r.speed, flying: r.flying, crashed: r.crashed, reason: r.crashReason, yaw: r.yaw, pitch: r.pitch, roll: r.roll, gamma: r.gamma, beta: r.beta, stalled: r.stalled })),
      ceasefire: (on: boolean) => {
        // soldiers ignore the player while it holds (tests that need a quiet sky)
        this.ceasefire = on;
        if (on) for (const e of this.enemies) e.pacify();
      },
      gauges: () => {
        const r = this.rides.get('plane');
        return { ...this.rides.gauges(r), flapPos: r.flapPos };
      },
      pilot: (x: number, alt: number, z: number, yaw: number, speed: number, flaps = 0) => {
        // place the stolen plane in flight (tests skip the long cross-country leg)
        const r = this.rides.get('plane');
        r.pos.set(x, this.world.terrain.getHeight(x, z) + alt, z);
        r.yaw = yaw;
        r.speed = speed;
        r.flying = true;
        r.crashed = false;
        r.vy = 0;
        r.roll = 0;
        this.rides.trimFor(r, speed, flaps);
      },
      animals: () => this.wildlife.animals.map((a) => ({ id: a.id, species: a.species, x: a.pos.x, y: a.pos.y + SPECIES[a.species].bodyY, z: a.pos.z, alive: a.state !== 'dead', skinned: a.skinned })),
      aimAt: (x: number, y: number, z: number) => {
        // point the camera ray at a world point (stands in for mouse aim)
        for (let k = 0; k < 3; k += 1) {
          const c = this.camera.position;
          const d = this.tmpA.set(x - c.x, y - c.y, z - c.z).normalize();
          this.camRig.yaw = Math.atan2(-d.x, -d.z);
          this.camRig.pitch = -Math.asin(d.y);
          this.camRig.update(0.016, this.player.pos, this.player.crouchAmt, this.player.aimAmt, false, this.world.collision, this.world.terrain);
          this.camRig.snap();
        }
      },
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
        animalsAlive: this.wildlife.alive,
        riding: this.riding?.kind ?? null,
        view: { firstPerson: this.camRig.firstPerson, lookBack: this.camRig.lookBack, cam: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z }, yaw: this.camRig.yaw },
        hunts: this.stats.hunts,
        song: this.audio.currentSong,
        quality: this.pipeline.quality,
        software: this.software,
      },
    };
  }
}
