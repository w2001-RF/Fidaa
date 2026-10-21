import { ITEMS, SKILLS, SKILL_MAX, SKILL_ORDER, UPGRADE_NAMES, WEAPONS, type ItemKind, type Recipe, type Skill, type Upgrade, type WeaponId } from '../game/Items';
import type { Mission } from '../game/Quests';
import type { ItemId } from '../game/types';
import { t, tr, trAlt, type Text } from '../i18n';

export type AlertLevel = 'hidden' | 'suspicious' | 'hunted';
export type CompassMarker = { x: number; z: number; kind: 'objective' | 'hideout' | 'foe' | 'water' };

export type HudState = {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  hunger: number;
  thirst: number;
  clock: string;
  night: boolean;
  alert: AlertLevel;
  level: number;
  xpProgress: number;
  weapon: WeaponId;
  weaponName: string;
  slots: { slot: number; owned: boolean; active: boolean }[];
  clip: number;
  reserve: number;
  water: number;
  food: number;
  herbs: number;
  reloading: boolean;
  missionTitle: string;
  objectives: { text: string; have: number; need: number; done: boolean }[];
  yaw: number;
  px: number;
  pz: number;
  markers: CompassMarker[];
  crosshair: boolean;
  spread: number;
};

export type Indicator = { x: number; y: number; a: number; alert: boolean; officer: boolean; edge: boolean };

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing HUD element ${sel}`);
  return el;
};

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export class Hud {
  readonly root = $('#hud');
  private readonly compass = $<HTMLCanvasElement>('#compass');
  private readonly cctx: CanvasRenderingContext2D;
  private readonly healthFill = $('#health-fill');
  private readonly healthGhost = $('#health-ghost');
  private readonly healthNum = $('#health-num');
  private readonly staminaFill = $('#stamina-fill');
  private readonly hungerG = $('#hunger-gauge');
  private readonly thirstG = $('#thirst-gauge');
  private readonly hungerNum = $('#hunger-num');
  private readonly thirstNum = $('#thirst-num');
  private readonly clockText = $('#clock-text');
  private readonly clockIcon = $('#clock-icon');
  private readonly alertBadge = $('#alert-badge');
  private readonly alertText = $('#alert-text');
  private readonly levelNum = $('#level-num');
  private readonly xpFill = $('#xp-fill');
  private readonly objTitle = $('#obj-title');
  private readonly objList = $('#obj-list');
  private readonly toasts = $('#toasts');
  private readonly weaponIcon = $('#weapon-icon');
  private readonly weaponName = $('#weapon-name');
  private readonly ammo = $('#ammo');
  private readonly ammoClip = $('#ammo-clip');
  private readonly ammoReserve = $('#ammo-reserve');
  private readonly slotsEl = $('#slots');
  private lastSlotsKey = '';
  private readonly qWater = $('#q-water');
  private readonly qFood = $('#q-food');
  private readonly qHerbs = $('#q-herbs');
  private readonly crosshair = $('#crosshair');
  private readonly hitmarker = $('#hitmarker');
  private readonly prompt = $('#prompt');
  private readonly promptText = $('#prompt-text');
  private readonly promptRing = $('#prompt-ring circle') as unknown as SVGCircleElement;
  private readonly indicatorsEl = $('#indicators');
  private readonly damageDir = $('#damage-dir');
  private readonly banner = $('#banner');
  private readonly flashEl = $('#flash');
  readonly lockHint = $('#lock-hint');
  private readonly dialogue = $('#dialogue');
  private readonly dlgSpeaker = $('#dlg-speaker');
  private readonly dlgText = $('#dlg-text');
  private readonly indPool: HTMLDivElement[] = [];
  private lastObjKey = '';
  private lastHealth = 100;
  private bannerTimer = 0;

  constructor() {
    const ctx = this.compass.getContext('2d');
    if (!ctx) throw new Error('compass canvas');
    this.cctx = ctx;
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  update(s: HudState): void {
    const hp = Math.max(0, s.health / s.maxHealth);
    this.healthFill.style.width = `${hp * 100}%`;
    if (s.health < this.lastHealth - 0.5 || s.health > this.lastHealth) this.healthGhost.style.width = `${hp * 100}%`;
    this.lastHealth = s.health;
    this.healthNum.textContent = String(Math.ceil(s.health));
    this.staminaFill.style.width = `${(s.stamina / s.maxStamina) * 100}%`;
    this.setGauge(this.hungerG, s.hunger);
    this.setGauge(this.thirstG, s.thirst);
    this.hungerNum.textContent = String(Math.round(s.hunger));
    this.thirstNum.textContent = String(Math.round(s.thirst));
    this.clockText.textContent = s.clock;
    this.clockIcon.classList.toggle('night', s.night);
    this.alertBadge.className = s.alert === 'hidden' ? '' : s.alert;
    this.alertText.textContent = s.alert === 'hidden' ? t(s.night ? 'alert.unseenNight' : 'alert.unseen') : t(s.alert === 'suspicious' ? 'alert.suspicious' : 'alert.hunted');
    this.levelNum.textContent = String(s.level);
    this.xpFill.style.width = `${s.xpProgress * 100}%`;

    this.weaponIcon.className = WEAPONS[s.weapon].icon;
    this.weaponName.textContent = s.reloading ? t('weapon.reloading', { w: s.weaponName }) : s.weaponName;
    const slotsKey = s.slots.map((x) => `${x.owned ? 1 : 0}${x.active ? 1 : 0}`).join('');
    if (slotsKey !== this.lastSlotsKey) {
      this.lastSlotsKey = slotsKey;
      this.slotsEl.innerHTML = s.slots.map((x) => `<i class="${x.owned ? 'owned' : ''}${x.active ? ' active' : ''}">${x.slot}</i>`).join('');
    }
    if (s.weapon !== 'blade') {
      this.ammoClip.textContent = String(s.clip);
      this.ammoReserve.textContent = `/ ${s.reserve}`;
      this.ammo.classList.toggle('low', s.clip === 0);
    } else {
      this.ammoClip.textContent = '∞';
      this.ammoReserve.textContent = t('weapon.silent');
      this.ammo.classList.remove('low');
    }
    this.qWater.textContent = String(s.water);
    this.qFood.textContent = String(s.food);
    this.qHerbs.textContent = String(s.herbs);
    (this.qWater.parentElement as HTMLElement).classList.toggle('empty', s.water === 0);
    (this.qFood.parentElement as HTMLElement).classList.toggle('empty', s.food === 0);
    (this.qHerbs.parentElement as HTMLElement).classList.toggle('empty', s.herbs === 0);

    this.crosshair.classList.toggle('on', s.crosshair);
    this.crosshair.classList.toggle('blade', s.weapon === 'blade');
    this.crosshair.style.setProperty('--gap', `${6 + s.spread * 18}px`);

    const key = s.missionTitle + s.objectives.map((o) => `${o.text}${o.have}${o.done}`).join('|');
    if (key !== this.lastObjKey) {
      this.lastObjKey = key;
      this.objTitle.textContent = s.missionTitle;
      this.objList.replaceChildren(
        ...s.objectives.map((o) => {
          const li = document.createElement('li');
          li.className = o.done ? 'done' : '';
          const t = document.createElement('span');
          t.textContent = o.text;
          const c = document.createElement('em');
          c.textContent = o.need > 1 ? `${o.have}/${o.need}` : '';
          li.append(t, c);
          return li;
        }),
      );
    }
    this.drawCompass(s);
  }

  private setGauge(el: HTMLElement, v: number): void {
    el.style.setProperty('--v', String(Math.max(0, v) / 100));
    el.classList.toggle('low', v < 25 && v > 0);
    el.classList.toggle('empty', v <= 0);
  }

  private drawCompass(s: HudState): void {
    const c = this.cctx;
    const W = this.compass.width;
    const H = this.compass.height;
    c.clearRect(0, 0, W, H);
    const grad = c.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(14,16,30,0)');
    grad.addColorStop(0.15, 'rgba(14,16,30,0.78)');
    grad.addColorStop(0.85, 'rgba(14,16,30,0.78)');
    grad.addColorStop(1, 'rgba(14,16,30,0)');
    c.fillStyle = grad;
    c.fillRect(0, 6, W, 30);
    c.strokeStyle = 'rgba(201,162,74,0.45)';
    c.beginPath();
    c.moveTo(W * 0.1, 36.5);
    c.lineTo(W * 0.9, 36.5);
    c.stroke();
    // camera heading: forward = (-sin yaw, -cos yaw); bearing measured clockwise from north (-z)
    const heading = normalize(-s.yaw);
    const fov = Math.PI * 0.9;
    const toX = (bearing: number) => W / 2 + (angDiff(heading, bearing) / (fov / 2)) * (W / 2);
    const labels: [number, string][] = [[0, t('compass.n')], [Math.PI / 2, t('compass.e')], [Math.PI, t('compass.s')], [Math.PI * 1.5, t('compass.w')]];
    c.textAlign = 'center';
    for (let deg = 0; deg < 360; deg += 15) {
      const b = (deg * Math.PI) / 180;
      const x = toX(b);
      if (x < W * 0.08 || x > W * 0.92) continue;
      const major = deg % 45 === 0;
      c.fillStyle = major ? 'rgba(241,232,212,0.8)' : 'rgba(241,232,212,0.35)';
      c.fillRect(x - 0.5, major ? 26 : 30, 1, major ? 10 : 6);
    }
    c.font = '700 15px "El Messiri", serif';
    for (const [b, l] of labels) {
      const x = toX(b);
      if (x < W * 0.08 || x > W * 0.92) continue;
      c.fillStyle = b === 0 ? '#d0553a' : '#f1e8d4';
      c.fillText(l, x, 22);
    }
    for (const m of s.markers) {
      const b = Math.atan2(m.x - s.px, -(m.z - s.pz));
      let x = toX(normalize(b));
      const dist = Math.hypot(m.x - s.px, m.z - s.pz);
      x = Math.max(W * 0.1, Math.min(W * 0.9, x));
      c.save();
      c.translate(x, 30);
      if (m.kind === 'objective') {
        c.fillStyle = '#f2c14e';
        c.rotate(Math.PI / 4);
        c.fillRect(-6, -6, 12, 12);
        c.restore();
        c.fillStyle = '#f2c14e';
        c.font = '700 11px "Alegreya Sans", sans-serif';
        c.fillText(t('unit.m', { n: Math.round(dist) }), x, 50);
        continue;
      }
      if (m.kind === 'hideout') c.fillStyle = '#2f9a68';
      else if (m.kind === 'water') c.fillStyle = '#4fa7c4';
      else c.fillStyle = '#d0553a';
      c.beginPath();
      c.arc(0, 0, m.kind === 'foe' ? 4 : 5, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    // centre notch
    c.fillStyle = '#c9a24a';
    c.beginPath();
    c.moveTo(W / 2 - 6, 40);
    c.lineTo(W / 2 + 6, 40);
    c.lineTo(W / 2, 34);
    c.fill();
  }

  setPrompt(text: string | null, progress = 0, takedown = false): void {
    if (!text) {
      this.prompt.classList.add('hidden');
      return;
    }
    this.prompt.classList.remove('hidden');
    this.prompt.classList.toggle('takedown', takedown);
    if (this.promptText.textContent !== text) this.promptText.textContent = text;
    this.promptRing.style.strokeDashoffset = String(94.25 * (1 - progress));
  }

  setIndicators(list: Indicator[]): void {
    while (this.indPool.length < list.length) {
      const d = document.createElement('div');
      d.className = 'ind';
      this.indicatorsEl.appendChild(d);
      this.indPool.push(d);
    }
    this.indPool.forEach((d, i) => {
      const it = list[i];
      if (!it) {
        d.style.display = 'none';
        return;
      }
      d.style.display = 'grid';
      d.style.left = `${it.x}px`;
      d.style.top = `${it.y}px`;
      d.style.setProperty('--a', String(it.a));
      d.className = `ind${it.alert ? ' alert' : ''}${it.officer ? ' officer' : ''}${it.edge ? ' edge' : ''}`;
      d.textContent = it.alert ? '!' : '?';
    });
  }

  toast(text: string, kind: 'xp' | 'bad' | 'good' | '' = ''): void {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => t.remove(), 3800);
  }

  showBanner(kicker: string, title: string, sub = '', ms = 3400): void {
    $('#banner-kicker').textContent = kicker;
    $('#banner-title').textContent = title;
    $('#banner-sub').textContent = sub;
    this.banner.classList.remove('hidden');
    this.banner.style.animation = 'none';
    void this.banner.offsetWidth;
    this.banner.style.animation = '';
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.add('hidden'), ms);
  }

  hitMarker(kill: boolean): void {
    this.hitmarker.classList.toggle('kill', kill);
    this.hitmarker.animate([{ opacity: 1, transform: 'translate(-50%,-50%) rotate(45deg) scale(1.3)' }, { opacity: 0, transform: 'translate(-50%,-50%) rotate(45deg) scale(1)' }], { duration: 260, easing: 'ease-out' });
  }

  damageFrom(screenAngle: number): void {
    this.damageDir.style.transform = `rotate(${screenAngle}rad)`;
    this.damageDir.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' });
  }

  flash(opacity = 0.7, color = '#ffffff'): void {
    this.flashEl.style.background = color;
    this.flashEl.animate([{ opacity }, { opacity: 0 }], { duration: 160, easing: 'ease-out' });
  }

  showDialogue(speaker: string, text: string): void {
    this.dialogue.classList.remove('hidden');
    this.dlgSpeaker.textContent = speaker;
    this.dlgText.textContent = text;
  }

  hideDialogue(): void {
    this.dialogue.classList.add('hidden');
  }

  get dialogueEl(): HTMLElement {
    return this.dialogue;
  }

  // -------------------------------------------------------------- panel

  renderInventory(
    inv: Record<ItemId, number>,
    use: (id: ItemId) => void,
    stats: { kills: number; takedowns: number; days: number },
    weapons: WeaponId[],
    upgrades: Upgrade[],
  ): void {
    const body = $('#tab-inv');
    const section = (title: string, kinds: ItemKind[]) => {
      const wrap = document.createElement('div');
      wrap.className = 'inv-section';
      const h = document.createElement('h4');
      h.textContent = title;
      const grid = document.createElement('div');
      grid.className = 'inv-grid';
      (Object.keys(ITEMS) as ItemId[]).forEach((id) => {
        const info = ITEMS[id];
        if (!kinds.includes(info.kind)) return;
        if (info.kind === 'quest' && inv[id] <= 0) return;
        const el = document.createElement('div');
        el.className = `item${inv[id] <= 0 ? ' zero' : ''}`;
        el.innerHTML = `<span class="qi ${info.icon}"></span><span>${esc(tr(info.name))} <b>×${inv[id]}</b></span><small>${esc(tr(info.desc))}</small>`;
        if (info.kind === 'food' || info.kind === 'medical') el.addEventListener('click', () => use(id));
        grid.appendChild(el);
      });
      wrap.append(h, grid);
      return wrap;
    };
    const gear = document.createElement('div');
    gear.className = 'inv-section';
    const gh = document.createElement('h4');
    gh.textContent = t('inv.gear');
    const chips = document.createElement('div');
    chips.className = 'gear-row';
    chips.innerHTML =
      weapons.map((w) => `<span class="chip weapon"><kbd>${WEAPONS[w].slot}</kbd>${esc(tr(WEAPONS[w].name))}</span>`).join('') +
      upgrades.map((u) => `<span class="chip">${esc(tr(UPGRADE_NAMES[u]))}</span>`).join('');
    gear.append(gh, chips);
    const st = document.createElement('div');
    st.className = 'stats-row';
    st.innerHTML = `<span>${t('inv.kills')} <b>${stats.kills}</b></span><span>${t('inv.takedowns')} <b>${stats.takedowns}</b></span><span>${t('inv.days')} <b>${stats.days}</b></span>`;
    body.replaceChildren(gear, section(t('inv.supplies'), ['food', 'medical', 'quest']), section(t('inv.ammo'), ['ammo']), section(t('inv.materials'), ['material']), st);
  }

  renderCraft(list: { r: Recipe; can: boolean; reason: string; done: boolean }[], craft: (r: Recipe) => void, atBench: boolean): void {
    const body = $('#tab-craft');
    const head = document.createElement('p');
    head.className = 'craft-intro';
    head.textContent = t('craft.intro') + (atBench ? ` · ${t('craft.atBench')}` : '');
    const grid = document.createElement('div');
    grid.className = 'craft-grid';
    for (const { r, can, reason, done } of list) {
      const d = document.createElement('div');
      d.className = `recipe${can ? ' can' : ''}${done ? ' done' : ''}`;
      const cost = (Object.entries(r.cost) as [ItemId, number][]).map(([k, v]) => `<span class="cost"><span class="qi ${ITEMS[k].icon}"></span>${v} ${esc(tr(ITEMS[k].name))}</span>`).join('');
      d.innerHTML = `<h5>${esc(tr(r.name))}${r.bench ? ` <em>${t('craft.bench')}</em>` : ''}</h5><p>${esc(tr(r.desc))}</p><div class="costs">${cost}</div>`;
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.type = 'button';
      btn.textContent = can ? t('craft.make') : reason;
      btn.disabled = !can;
      btn.addEventListener('click', () => craft(r));
      d.appendChild(btn);
      grid.appendChild(d);
    }
    body.replaceChildren(head, grid);
  }

  renderJournal(missions: Mission[], current: number, places: { name: Text; found: boolean }[]): void {
    const body = $('#tab-journal');
    const ms = missions.map((m, i) => {
      const d = document.createElement('div');
      d.className = `journal-mission ${i < current ? 'done' : i === current ? 'active' : 'locked'}`;
      d.innerHTML = `<h3>${i < current ? '✓ ' : ''}${esc(tr(m.title))} <span>${esc(trAlt(m.title))}</span></h3><p>${esc(i <= current ? tr(m.brief) : t('journal.locked'))}</p>`;
      return d;
    });
    const pl = document.createElement('div');
    pl.className = 'journal-places';
    const found = places.filter((p) => p.found).length;
    pl.innerHTML = `<h3>${t('journal.places')} <span>${found}/${places.length}</span></h3><ul>${places
      .map((p) => `<li class="${p.found ? 'found' : ''}">${p.found ? esc(tr(p.name)) : t('journal.unknown')}</li>`)
      .join('')}</ul>`;
    body.replaceChildren(...ms, pl);
  }

  renderSkills(skills: Record<Skill, number>, points: number, spend: (s: Skill) => void): void {
    $('#sp-badge').textContent = points > 0 ? String(points) : '';
    const body = $('#tab-skills');
    const head = document.createElement('p');
    head.style.cssText = 'margin:0 0 6px;color:var(--muted)';
    head.textContent = points > 0 ? t('skills.points', { n: points }) : t('skills.none');
    body.replaceChildren(
      head,
      ...SKILL_ORDER.map((k) => {
        const d = document.createElement('div');
        d.className = 'skill';
        const pips = Array.from({ length: SKILL_MAX }, (_, i) => `<i class="${i < skills[k] ? 'on' : ''}"></i>`).join('');
        d.innerHTML = `<h4>${esc(tr(SKILLS[k].name))}</h4><button class="btn" type="button">${t('skills.learn')}</button><div><p>${esc(tr(SKILLS[k].desc))}</p><div class="pips">${pips}<small>${t('skills.rank', { n: skills[k], max: SKILL_MAX })}</small></div></div>`;
        const btn = d.querySelector('button') as HTMLButtonElement;
        btn.disabled = points <= 0 || skills[k] >= SKILL_MAX;
        btn.addEventListener('click', () => spend(k));
        return d;
      }),
    );
  }
}

function normalize(a: number): number {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

function angDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
