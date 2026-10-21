import type { Lang } from '../i18n';
import { createSeededRandom } from '../utils/random';
import { VOICE_PROFILES, VoiceOver, type VoiceProfile } from './Voice';

// Maqam Hijaz on D: D Eb F# G A Bb C D (Hz)
const HIJAZ = [146.83, 155.56, 185.0, 196.0, 220.0, 233.08, 261.63, 293.66, 311.13, 369.99, 392.0];
// Maqam Bayati on D: the E is a quarter tone flat (D E½b F G A Bb C D)
const BAYATI = [146.83, 160.1, 174.61, 196.0, 220.0, 233.08, 261.63, 293.66, 320.2, 349.23, 392.0];
// Minor pentatonic on D, the Gnawa guembri's home
const PENTA = [73.42, 87.31, 98.0, 110.0, 130.81, 146.83, 174.61, 196.0, 220.0, 261.63, 293.66];
// Maqam Ajam (major) on D for the victory song
const AJAM = [146.83, 164.81, 185.0, 196.0, 220.0, 246.94, 277.18, 293.66, 329.63, 369.99, 392.0];

type Lead = 'oud' | 'ney' | 'guembri';
type Perc = 'bendir' | 'darbuka' | 'qraqeb';
/** A note is [scale degree or -1 for rest, length in steps]. */
type Note = [number, number];

type Song = {
  step: number;
  scale: number[];
  lead: Lead;
  melody: Note[];
  /** octave multiplier for the lead */
  octave: number;
  bass?: Note[];
  bassScale?: number[];
  perc: Perc;
  /** 0 rest, 1 low (doum), 2 high (tek), 3 accent */
  pattern: number[];
  drone?: number;
  claps?: number[];
  loop: boolean;
};

export type SongId = 'tifawt' | 'gnawa' | 'nights' | 'hunted' | 'victory';

/**
 * Optional generated audio (scripts/generate-audio.sh → public/audio/). Any
 * entry present replaces its procedural counterpart; a missing manifest or
 * file leaves the synthesized version in place.
 */
type AudioManifest = { music?: Partial<Record<SongId, string>>; sfx?: Record<string, string> };

/** Original compositions: short loops in Moroccan modes and rhythms. */
const SONGS: Record<SongId, Song> = {
  // "Tifawt": oud melody in Hijaz over the 3+3+2 bendir rhythm of the douar
  tifawt: {
    step: 0.2,
    scale: HIJAZ,
    lead: 'oud',
    octave: 1,
    melody: [
      [4, 2], [5, 1], [4, 1], [3, 2], [2, 2], [1, 1], [2, 1], [0, 4], [-1, 2],
      [0, 1], [1, 1], [2, 2], [3, 1], [4, 1], [5, 2], [4, 2], [3, 1], [2, 1], [1, 2], [0, 4], [-1, 2],
      [7, 2], [6, 1], [5, 1], [4, 2], [5, 1], [4, 1], [3, 2], [2, 1], [1, 1], [2, 2], [0, 4], [-1, 2],
      [4, 1], [4, 1], [5, 2], [7, 3], [6, 1], [5, 2], [4, 2], [3, 1], [2, 1], [1, 2], [2, 2], [0, 6], [-1, 4],
    ],
    perc: 'bendir',
    pattern: [3, 0, 0, 2, 0, 0, 1, 0],
    drone: 73.42,
    loop: true,
  },
  // "Road of the Gnawa": guembri ostinato, qraqeb, handclaps, sparse oud calls
  gnawa: {
    step: 0.17,
    scale: PENTA,
    lead: 'oud',
    octave: 2,
    melody: [
      [-1, 8], [7, 2], [8, 2], [7, 1], [6, 1], [5, 4], [-1, 6],
      [-1, 8], [8, 2], [9, 2], [8, 1], [7, 1], [8, 2], [7, 2], [5, 4], [-1, 4],
    ],
    bass: [[0, 2], [0, 1], [3, 1], [2, 2], [1, 2], [0, 2], [0, 1], [4, 1], [3, 2], [2, 1], [1, 1]],
    bassScale: PENTA,
    perc: 'qraqeb',
    pattern: [3, 0, 2, 2, 0, 2],
    claps: [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1],
    loop: true,
  },
  // "Nights of Tadwart": ney flute in Bayati over a low drone
  nights: {
    step: 0.3,
    scale: BAYATI,
    lead: 'ney',
    octave: 1,
    melody: [
      [0, 6], [1, 2], [2, 4], [3, 6], [2, 2], [1, 2], [2, 2], [1, 4], [0, 8], [-1, 4],
      [3, 4], [4, 6], [5, 2], [4, 2], [3, 4], [2, 2], [1, 2], [0, 8], [-1, 6],
      [7, 6], [6, 2], [5, 2], [4, 4], [3, 2], [4, 2], [2, 6], [1, 2], [0, 10], [-1, 8],
    ],
    perc: 'bendir',
    pattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0],
    drone: 73.42,
    loop: true,
  },
  // "Hunted": darbuka maqsum, guembri, urgent oud stabs in Hijaz
  hunted: {
    step: 0.13,
    scale: HIJAZ,
    lead: 'oud',
    octave: 1,
    melody: [
      [4, 2], [5, 2], [4, 1], [3, 1], [2, 2], [1, 2], [0, 4], [-1, 2],
      [7, 2], [6, 2], [5, 2], [4, 2], [5, 1], [4, 1], [3, 2], [-1, 4],
      [2, 1], [3, 1], [4, 2], [2, 1], [3, 1], [4, 2], [5, 2], [4, 2], [1, 2], [0, 4], [-1, 2],
    ],
    bass: [[0, 1], [0, 1], [1, 1], [0, 1], [3, 1], [2, 1], [1, 1], [0, 1]],
    bassScale: [73.42, 77.78, 92.5, 98.0, 110.0],
    perc: 'darbuka',
    pattern: [1, 2, 0, 2, 1, 0, 2, 0, 1, 2, 0, 2, 1, 0, 2, 2],
    loop: true,
  },
  // "Song of Independence": bright Ajam melody, darbuka, ending in a zaghrouda
  victory: {
    step: 0.19,
    scale: AJAM,
    lead: 'oud',
    octave: 1,
    melody: [
      [0, 1], [2, 1], [4, 2], [4, 1], [5, 1], [4, 2], [2, 2], [3, 1], [4, 1], [5, 2], [7, 4], [-1, 2],
      [7, 1], [6, 1], [5, 2], [4, 1], [5, 1], [6, 2], [7, 2], [5, 2], [4, 2], [2, 2], [0, 4], [-1, 2],
      [4, 1], [5, 1], [7, 2], [7, 1], [8, 1], [9, 2], [7, 2], [5, 2], [4, 2], [5, 2], [7, 6], [-1, 4],
    ],
    bass: [[0, 4], [3, 4], [4, 4], [0, 4]],
    bassScale: [73.42, 82.41, 92.5, 98.0, 110.0],
    perc: 'darbuka',
    pattern: [1, 0, 2, 2, 1, 0, 2, 0],
    claps: [0, 0, 1, 0, 0, 0, 1, 1],
    loop: false,
  },
};

const BARKS: Record<'french' | 'makhzen', { text: string; lang: 'fr' | Lang }[]> = {
  french: [
    { text: 'Halte ! Là-bas !', lang: 'fr' },
    { text: 'Alerte ! Un fellagha !', lang: 'fr' },
    { text: 'Arrêtez-le !', lang: 'fr' },
    { text: 'Feu à volonté !', lang: 'fr' },
  ],
  makhzen: [
    { text: 'وقف! شكون تما؟', lang: 'ar' },
    { text: 'شدّوه! شدّوه!', lang: 'ar' },
    { text: 'راه هنا! جيو!', lang: 'ar' },
  ],
};

/**
 * Fully procedural Web Audio: no files. Wind/cricket ambience, a song engine
 * that crossfades between composed loops by situation (day, night, combat,
 * victory), weapon and event SFX, plus character voice-over.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private musicBus!: GainNode;
  private amb!: GainNode;
  private noise!: AudioBuffer;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private readonly oudCache = new Map<string, AudioBuffer>();
  private readonly rng = createSeededRandom(1944);
  private nextCricket = 0;
  muted = false;
  volume = 0.8;
  musicVolume = 0.32;
  tension = 0;
  night = 0;
  /** Game language, for voice selection. */
  voiceLang: Lang = 'en';
  readonly voice = new VoiceOver();

  // song engine
  private musicOn = false;
  private song: SongId | null = null;
  private pending: SongId | null = null;
  private switchAt = 0;
  private melIdx = 0;
  private melT = 0;
  private bassIdx = 0;
  private bassT = 0;
  private percStep = 0;
  private percT = 0;
  private droneNodes: AudioScheduledSourceNode[] = [];
  private droneGain: GainNode | null = null;
  private dayAlt = 0;
  private victoryUntil = 0;
  private lastBark = 0;
  private readonly files = new Map<string, AudioBuffer>();
  private fileSource: AudioBufferSourceNode | null = null;

  get currentSong(): SongId | null {
    return this.song;
  }

  async unlock(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    // gentle bus compression keeps gunshots from clipping
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(comp);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicVolume;
    this.music.connect(comp);
    // musicBus carries song crossfades; music carries the user's music volume
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 1;
    this.musicBus.connect(this.music);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.5;
    this.amb.connect(comp);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = this.rng() * 2 - 1;

    // wind bed
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.08;
    src.connect(this.windFilter).connect(this.windGain).connect(this.amb);
    src.start();
    await ctx.resume();
    void this.loadManifest();
  }

  private async loadManifest(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    let manifest: AudioManifest;
    try {
      const res = await fetch('audio/manifest.json', { cache: 'no-cache' });
      if (!res.ok) return;
      manifest = (await res.json()) as AudioManifest;
    } catch {
      return; // no generated audio: procedural only
    }
    const entries = [
      ...Object.entries(manifest.music ?? {}).map(([k, v]) => [`music:${k}`, v] as const),
      ...Object.entries(manifest.sfx ?? {}).map(([k, v]) => [`sfx:${k}`, v] as const),
    ];
    await Promise.all(
      entries.map(async ([id, url]) => {
        if (!url) return;
        try {
          const data = await fetch(`audio/${url}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))));
          this.files.set(id, await ctx.decodeAudioData(data));
        } catch {
          // a broken file falls back to the procedural sound
        }
      }),
    );
  }

  /** Play a generated effect if one was loaded; false lets the caller synthesize it. */
  private playFile(id: string, volume = 1): boolean {
    const buf = this.files.get(`sfx:${id}`);
    if (!buf || !this.ready()) return false;
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.96 + this.rng() * 0.08;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.sfx);
    src.start();
    return true;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (m) this.voice.stop();
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setVolume(v: number): void {
    this.volume = v;
    this.voice.volume = v;
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    if (this.ctx) this.music.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  suspend(paused: boolean): void {
    this.voice.pause(paused);
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /** Songs begin with play (the title screen stays quiet until audio is unlocked). */
  startMusic(): void {
    this.musicOn = true;
  }

  /** Called every frame: schedules music & ambience a little ahead. */
  update(elapsed: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    // wind gusts
    this.windFilter.frequency.setTargetAtTime(380 + Math.sin(elapsed * 0.13) * 160 + Math.sin(elapsed * 0.41) * 80, t, 0.5);
    this.windGain.gain.setTargetAtTime(0.06 + (Math.sin(elapsed * 0.09) * 0.5 + 0.5) * 0.06, t, 0.8);

    // crickets at night
    if (this.night > 0.4 && t > this.nextCricket) {
      this.nextCricket = t + 0.35 + this.rng() * 0.9;
      const f = 4200 + this.rng() * 600;
      for (let k = 0; k < 3; k += 1) this.tone(f, 0.035, 0.012 * this.night, 'sine', t + k * 0.06, this.amb);
    }
    if (this.musicOn) this.updateSongs(t, elapsed);
  }

  // ------------------------------------------------------------------ songs

  private chooseSong(elapsed: number): SongId {
    if (this.victoryUntil > elapsed) return 'victory';
    if (this.tension > 0.5) return 'hunted';
    if (this.night > 0.55) return 'nights';
    // daytime alternates between the douar oud and the Gnawa road song every ~2 minutes
    return Math.floor((elapsed + this.dayAlt) / 120) % 2 === 0 ? 'tifawt' : 'gnawa';
  }

  private updateSongs(t: number, elapsed: number): void {
    const want = this.chooseSong(elapsed);
    if (this.song === null) {
      this.beginSong(want, t + 0.2);
    } else if (want !== this.song && this.pending !== want) {
      // fade out, then switch at the end of the fade
      this.pending = want;
      this.switchAt = t + (want === 'hunted' ? 0.5 : 1.6);
      this.musicBus.gain.setTargetAtTime(0.0001, t, want === 'hunted' ? 0.12 : 0.45);
    }
    if (this.pending && t >= this.switchAt) {
      const next = this.pending;
      this.pending = null;
      this.beginSong(next, t + 0.05);
    }
    if (!this.song || this.pending || this.fileSource) return;
    const s = SONGS[this.song];
    // lead melody
    while (this.melT < t + 0.25) {
      if (this.melIdx >= s.melody.length) {
        if (!s.loop) {
          this.melT = Infinity;
          break;
        }
        this.melIdx = 0;
      }
      const [deg, len] = s.melody[this.melIdx];
      if (deg >= 0) this.playLead(s, deg, this.melT, len * s.step);
      this.melT += len * s.step;
      this.melIdx += 1;
    }
    // bass ostinato
    if (s.bass && s.bassScale) {
      while (this.bassT < t + 0.25) {
        const [deg, len] = s.bass[this.bassIdx % s.bass.length];
        if (deg >= 0) this.guembri(s.bassScale[deg], this.bassT, 0.55);
        this.bassT += len * s.step;
        this.bassIdx += 1;
      }
    }
    // percussion & claps
    while (this.percT < t + 0.25) {
      const hit = s.pattern[this.percStep % s.pattern.length];
      if (hit) this.percussion(s.perc, hit, this.percT);
      if (s.claps && s.claps[this.percStep % s.claps.length]) this.clap(this.percT);
      this.percT += s.step;
      this.percStep += 1;
    }
    if (this.song === 'victory' && !s.loop && this.melT === Infinity && this.percStep % 64 === 0) {
      this.zaghrouda(t + 0.1);
      this.percStep += 1;
    }
  }

  private beginSong(id: SongId, at: number): void {
    const ctx = this.ctx as AudioContext;
    this.song = id;
    this.melIdx = 0;
    this.bassIdx = 0;
    this.percStep = 0;
    this.melT = at;
    this.bassT = at;
    this.percT = at;
    this.musicBus.gain.cancelScheduledValues(at);
    this.musicBus.gain.setTargetAtTime(1, at, 0.3);
    // drone: replace any running one
    for (const n of this.droneNodes) n.stop(at + 0.6);
    this.droneGain?.gain.setTargetAtTime(0.0001, at, 0.2);
    this.droneNodes = [];
    this.droneGain = null;
    this.fileSource?.stop(at + 0.6);
    this.fileSource = null;
    const file = this.files.get(`music:${id}`);
    if (file) {
      const src = ctx.createBufferSource();
      src.buffer = file;
      src.loop = id !== 'victory';
      src.connect(this.musicBus);
      src.start(at);
      this.fileSource = src;
      return;
    }
    const s = SONGS[id];
    if (s.drone) {
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime(0.05, at, 1.5);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 380;
      f.connect(g).connect(this.musicBus);
      for (const [type, mul, vol] of [['sawtooth', 1, 0.6], ['sine', 2, 0.5], ['sine', 1.5, 0.25]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = s.drone * mul;
        const og = ctx.createGain();
        og.gain.value = vol;
        o.connect(og).connect(f);
        o.start(at);
        this.droneNodes.push(o);
      }
      this.droneGain = g;
    }
  }

  private playLead(s: Song, deg: number, t: number, dur: number): void {
    const f = s.scale[Math.min(deg, s.scale.length - 1)] * s.octave;
    if (s.lead === 'ney') this.ney(f, t, dur, 0.16);
    else if (s.lead === 'guembri') this.guembri(f, t, 0.5);
    else {
      this.oud(f, t, 0.5 + this.rng() * 0.2, this.musicBus);
      // oud players tremolo long notes (risha)
      if (dur > 0.5) for (let k = 1; k < Math.floor(dur / 0.11); k += 1) this.oud(f, t + k * 0.11, 0.22, this.musicBus);
    }
  }

  // ---------------------------------------------------------------- instruments

  /** Breathy end-blown reed flute: sine + soft overtone + filtered breath noise, slow vibrato. */
  private ney(freq: number, t: number, dur: number, vol: number): void {
    const ctx = this.ctx as AudioContext;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.18, dur * 0.4));
    g.gain.setValueAtTime(vol * 0.85, t + Math.max(0.2, dur - 0.15));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    g.connect(this.musicBus);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lg = ctx.createGain();
    lg.gain.value = freq * 0.006;
    lfo.connect(lg);
    for (const [mul, v] of [[1, 1], [2, 0.18], [3, 0.06]] as const) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(freq * mul * 0.985, t);
      o.frequency.exponentialRampToValueAtTime(freq * mul, t + 0.12);
      lg.connect(o.frequency);
      const og = ctx.createGain();
      og.gain.value = v;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 0.3);
    }
    lfo.start(t);
    lfo.stop(t + dur + 0.3);
    // breath
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = freq * 2;
    bf.Q.value = 2.5;
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    n.connect(bf).connect(ng).connect(g);
    n.start(t, this.rng());
    n.stop(t + dur + 0.3);
  }

  /** Guembri: deep plucked bass with a skin slap. */
  private guembri(freq: number, t: number, vol: number): void {
    const ctx = this.ctx as AudioContext;
    const buf = this.pluckBuffer(freq, 0.4962, 1.1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.musicBus);
    src.start(t);
    this.noiseBurst(t, 0.04, 300, 0.12 * vol, this.musicBus, 'lowpass');
  }

  private percussion(kind: Perc, hit: number, t: number): void {
    if (kind === 'bendir') {
      this.drum(t, hit === 3 ? 1 : hit === 1 ? 0.8 : 0.5);
    } else if (kind === 'darbuka') {
      if (hit === 1 || hit === 3) {
        this.tone(105, 0.22, 0.34, 'sine', t, this.musicBus, 0.62);
        this.noiseBurst(t, 0.05, 600, 0.06, this.musicBus, 'lowpass');
      } else {
        this.noiseBurst(t, 0.045, 4200, 0.12, this.musicBus, 'highpass');
        this.tone(820, 0.04, 0.05, 'triangle', t, this.musicBus);
      }
    } else {
      // qraqeb: iron castanets, a double click
      const v = hit === 3 ? 0.11 : 0.07;
      this.noiseBurst(t, 0.03, 5600, v, this.musicBus, 'bandpass');
      this.noiseBurst(t + 0.022, 0.03, 6100, v * 0.8, this.musicBus, 'bandpass');
      if (hit === 3) this.drum(t, 0.5);
    }
  }

  private clap(t: number): void {
    for (let k = 0; k < 3; k += 1) this.noiseBurst(t + k * 0.008, 0.06, 1400, 0.07, this.musicBus, 'bandpass');
  }

  /** Ululation of celebration: high voice with a fast tongue trill. */
  private zaghrouda(t: number): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1150, t);
    o.frequency.linearRampToValueAtTime(1350, t + 0.4);
    o.frequency.linearRampToValueAtTime(1250, t + 2.2);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9.5;
    const lg = ctx.createGain();
    lg.gain.value = 220;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.15);
    g.gain.setValueAtTime(0.07, t + 2.0);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    lfo.start(t);
    o.stop(t + 2.6);
    lfo.stop(t + 2.6);
  }

  victorySong(): void {
    this.musicOn = true;
    // victory plays out once (~30 s) before the situational songs return
    this.victoryUntil = Number.POSITIVE_INFINITY;
    window.setTimeout(() => (this.victoryUntil = 0), 32000);
    if (this.ctx) {
      this.pending = null;
      this.beginSong('victory', this.ctx.currentTime + 0.3);
      this.zaghrouda(this.ctx.currentTime + 0.4);
    }
  }

  // ------------------------------------------------------------------- voice

  /** Voice a dialogue line; falls back to a murmur when the browser has no voice for the language. */
  speak(text: string, speaker: string, lang: Lang): void {
    if (this.muted || !this.voice.enabled) return;
    const profile = VOICE_PROFILES[speaker] ?? VOICE_PROFILES.default;
    if (!this.voice.speak(text, profile, lang)) this.murmur(text, profile);
  }

  stopVoice(): void {
    this.voice.stop();
  }

  /** Guards shout when they spot you: French soldiers in French, mokhaznis in Darija. */
  bark(faction: 'french' | 'makhzen', officer: boolean, distance: number): void {
    if (this.muted || !this.voice.enabled || distance > 70) return;
    const now = performance.now();
    if (now - this.lastBark < 3500 || this.voice.speaking) return;
    this.lastBark = now;
    const pool = BARKS[faction];
    const line = pool[Math.floor(this.rng() * pool.length)];
    const profile = VOICE_PROFILES[officer ? 'officer' : faction];
    const vol = 1 - Math.min(1, distance / 80) * 0.7;
    if (!this.voice.speak(line.text, { ...profile, rate: profile.rate * 1.1 }, line.lang, false, vol)) this.murmur(line.text, profile, vol * 1.4, true);
  }

  /** Formant "speech" with the speaker's pitch: syllables follow the text's length and rhythm. */
  private murmur(text: string, p: VoiceProfile, vol = 1, shout = false): void {
    if (!this.ready()) return;
    const ctx = this.ctx as AudioContext;
    const vowels: [number, number][] = [[800, 1200], [300, 2300], [350, 800], [500, 1800], [650, 1080]];
    const words = text.split(/\s+/).filter(Boolean);
    let t = ctx.currentTime + 0.05;
    const syllables = Math.min(42, Math.max(3, Math.round(text.length / 3.2)));
    let wordLeft = Math.max(1, Math.round(syllables / Math.max(1, words.length)));
    for (let i = 0; i < syllables; i += 1) {
      const dur = (shout ? 0.11 : 0.085 + this.rng() * 0.06) / p.rate;
      const fall = i > syllables - 3 ? 0.86 : 1;
      const f0 = p.f0 * (1 + (this.rng() - 0.5) * 0.12) * fall * (shout ? 1.3 : 1);
      const [f1, f2] = vowels[Math.floor(this.rng() * vowels.length)];
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.linearRampToValueAtTime(f0 * (0.94 + this.rng() * 0.1), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 * vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      for (const [ff, q] of [[f1 * (p.female ? 1.15 : 1), 6], [f2 * (p.female ? 1.12 : 1), 9]] as const) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = ff;
        bp.Q.value = q;
        o.connect(bp).connect(g);
      }
      g.connect(this.sfx);
      o.start(t);
      o.stop(t + dur + 0.02);
      t += dur + 0.012;
      wordLeft -= 1;
      if (wordLeft <= 0) {
        t += 0.06 + this.rng() * 0.05;
        wordLeft = Math.max(1, Math.round(syllables / Math.max(1, words.length)));
      }
    }
  }

  // ------------------------------------------------------------------- SFX

  rifleShot(distance = 0, pan = 0, pistol = false): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const far = Math.min(1, distance / 120);
    const vol = (1 - far * 0.85) * (pistol ? 0.6 : 0.9);
    const out = this.panner(pan);
    // crack
    this.noiseBurst(t, 0.18 + far * 0.3, pistol ? 2400 : 1800 - far * 1200, vol, out, 'lowpass');
    // body thump
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    g.gain.setValueAtTime(vol * 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.35);
    // valley echo
    this.noiseBurst(t + 0.25 + far * 0.2, 0.7, 500, vol * 0.18, out, 'lowpass');
  }

  /** The player's own weapon report, by gun. */
  gunShot(weapon: string): void {
    if (!this.ready() || this.playFile(`shot-${weapon}`)) return;
    const t = this.now();
    if (weapon === 'sling') {
      // whirl and release: a soft whoosh, no report
      for (let k = 0; k < 2; k += 1) this.noiseBurst(t + k * 0.12, 0.12, 900 + k * 500, 0.12, this.sfx, 'bandpass');
    } else if (weapon === 'bow') {
      // the string's low thrum against the bracer, then the arrow's whisper
      this.tone(150, 0.18, 0.28, 'triangle', t, this.sfx, 0.55);
      this.noiseBurst(t, 0.04, 1800, 0.18, this.sfx, 'bandpass');
      this.noiseBurst(t + 0.02, 0.3, 2200, 0.06, this.sfx, 'highpass');
    } else if (weapon === 'crossbow') {
      // string slap and the hiss of the bolt leaving
      this.tone(220, 0.12, 0.35, 'triangle', t, this.sfx, 0.35);
      this.noiseBurst(t, 0.05, 2600, 0.3, this.sfx, 'bandpass');
      this.noiseBurst(t + 0.03, 0.25, 1500, 0.08, this.sfx, 'highpass');
    } else if (weapon === 'shotgun') {
      this.noiseBurst(t, 0.3, 1300, 0.95, this.sfx, 'lowpass');
      this.tone(110, 0.3, 0.6, 'sine', t, this.sfx, 0.4);
      this.noiseBurst(t + 0.3, 0.8, 450, 0.18, this.sfx, 'lowpass');
    } else if (weapon === 'pistol') {
      this.rifleShot(0, 0, true);
    } else if (weapon === 'smg') {
      this.noiseBurst(t, 0.09, 2600, 0.55, this.sfx, 'lowpass');
      this.tone(160, 0.08, 0.3, 'sine', t, this.sfx, 0.4);
      this.noiseBurst(t + 0.02, 0.05, 3800, 0.12, this.sfx, 'highpass'); // bolt clatter
    } else if (weapon === 'musket') {
      // flash in the pan, then the big black-powder boom rolling down the valley
      this.noiseBurst(t, 0.05, 3000, 0.25, this.sfx, 'highpass');
      this.noiseBurst(t + 0.06, 0.55, 900, 1.0, this.sfx, 'lowpass');
      this.tone(90, 0.5, 0.7, 'sine', t + 0.06, this.sfx, 0.35);
      this.noiseBurst(t + 0.5, 1.1, 380, 0.22, this.sfx, 'lowpass');
    } else {
      this.rifleShot(0, 0);
    }
  }

  /** Axe blows and the creak and crash of a falling tree. */
  chop(): void {
    if (!this.ready()) return;
    const t = this.now();
    for (let k = 0; k < 3; k += 1) {
      this.noiseBurst(t + k * 0.22, 0.08, 1100, 0.35, this.sfx, 'bandpass');
      this.tone(180, 0.1, 0.2, 'triangle', t + k * 0.22, this.sfx, 0.7);
    }
    this.tone(90, 0.9, 0.12, 'sawtooth', t + 0.7, this.sfx, 0.6);
    this.noiseBurst(t + 1.4, 0.7, 700, 0.4, this.sfx, 'lowpass');
  }

  /** Hammer on stone: ringing strikes and falling rubble. */
  quarry(): void {
    if (!this.ready()) return;
    const t = this.now();
    for (let k = 0; k < 3; k += 1) {
      this.tone(1600 + this.rng() * 400, 0.12, 0.12, 'square', t + k * 0.25, this.sfx, 0.5);
      this.noiseBurst(t + k * 0.25, 0.06, 3200, 0.25, this.sfx, 'highpass');
    }
    for (let k = 0; k < 5; k += 1) this.noiseBurst(t + 0.8 + k * 0.07, 0.1, 900, 0.15, this.sfx, 'lowpass');
  }

  /** Boar grunt / squeal. */
  grunt(distance: number): void {
    if (!this.ready()) return;
    const t = this.now();
    const vol = 0.35 * (1 - Math.min(1, distance / 60) * 0.85);
    this.tone(120, 0.28, vol, 'sawtooth', t, this.sfx, 0.6);
    this.noiseBurst(t, 0.25, 500, vol * 0.6, this.sfx, 'lowpass');
    this.tone(420, 0.18, vol * 0.4, 'square', t + 0.22, this.sfx, 1.4);
  }

  craft(): void {
    if (!this.ready() || this.playFile('craft')) return;
    const t = this.now();
    for (let i = 0; i < 4; i += 1) {
      this.tone(520 + this.rng() * 260, 0.09, 0.12, 'square', t + i * 0.16, this.sfx, 0.6);
      this.noiseBurst(t + i * 0.16, 0.05, 2400, 0.16, this.sfx, 'bandpass');
    }
  }

  bandage(): void {
    if (!this.ready()) return;
    const t = this.now();
    this.noiseBurst(t, 0.35, 3200, 0.18, this.sfx, 'bandpass');
    this.noiseBurst(t + 0.4, 0.2, 2600, 0.12, this.sfx, 'bandpass');
  }

  discover(): void {
    if (!this.ready() || this.playFile('discover')) return;
    const t = this.now();
    [0, 2, 4, 7, 9].forEach((d, i) => this.oud(BAYATI[d], t + i * 0.14, 0.5));
    this.ney(BAYATI[7], t + 0.75, 1.4, 0.12);
  }

  whiz(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(2200, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.18);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500;
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.22);
  }

  slash(): void {
    if (!this.ready()) return;
    const t = this.now();
    this.noiseBurst(t, 0.16, 3200 + this.rng() * 600, 0.25, this.sfx, 'highpass');
  }

  hit(flesh = true): void {
    if (!this.ready()) return;
    const t = this.now();
    this.noiseBurst(t, 0.12, flesh ? 700 : 2200, 0.5, this.sfx, 'lowpass');
    this.tone(flesh ? 90 : 300, 0.12, 0.3, 'sine', t, this.sfx);
  }

  hurt(): void {
    if (!this.ready()) return;
    const t = this.now();
    this.tone(70, 0.25, 0.5, 'sine', t, this.sfx);
    this.noiseBurst(t, 0.1, 400, 0.3, this.sfx, 'lowpass');
  }

  footstep(loud: number): void {
    if (!this.ready()) return;
    this.noiseBurst(this.now(), 0.06, 900 + this.rng() * 500, 0.05 + loud * 0.07, this.sfx, 'lowpass');
  }

  pickup(): void {
    if (!this.ready()) return;
    const t = this.now();
    this.oud(HIJAZ[7], t, 0.35);
    this.oud(HIJAZ[9], t + 0.08, 0.3);
  }

  drink(): void {
    if (!this.ready()) return;
    const t = this.now();
    for (let i = 0; i < 4; i += 1) this.tone(300 + this.rng() * 200, 0.08, 0.08, 'sine', t + i * 0.12, this.sfx, 0.5);
  }

  eat(): void {
    if (!this.ready()) return;
    const t = this.now();
    for (let i = 0; i < 3; i += 1) this.noiseBurst(t + i * 0.15, 0.07, 2600, 0.12, this.sfx, 'bandpass');
  }

  reload(): void {
    if (!this.ready()) return;
    const t = this.now();
    for (const [dt, f] of [[0, 1800], [0.35, 1400], [1.4, 2000], [1.9, 1200]]) this.noiseBurst(t + dt, 0.04, f, 0.22, this.sfx, 'bandpass');
  }

  dryFire(): void {
    if (!this.ready()) return;
    this.noiseBurst(this.now(), 0.03, 2500, 0.2, this.sfx, 'bandpass');
  }

  snapWire(): void {
    if (!this.ready()) return;
    const t = this.now();
    this.tone(1800, 0.4, 0.15, 'triangle', t, this.sfx, 0.25);
    this.noiseBurst(t, 0.2, 5000, 0.2, this.sfx, 'highpass');
  }

  clank(): void {
    if (!this.ready()) return;
    const t = this.now();
    this.tone(220, 0.5, 0.25, 'square', t, this.sfx, 0.4);
    this.tone(330, 0.4, 0.15, 'square', t + 0.05, this.sfx, 0.4);
  }

  /** French police whistle: raised alarm. */
  whistle(distance = 0): void {
    if (!this.ready()) return;
    const ctx = this.ctx as AudioContext;
    const t = ctx.currentTime;
    const vol = 0.22 * (1 - Math.min(1, distance / 90) * 0.8);
    for (let k = 0; k < 2; k += 1) {
      const o = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      const g = ctx.createGain();
      o.frequency.value = 2900 + k * 180;
      lfo.frequency.value = 28;
      lg.gain.value = 120;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t + k * 0.5);
      g.gain.exponentialRampToValueAtTime(vol, t + k * 0.5 + 0.03);
      g.gain.setValueAtTime(vol, t + k * 0.5 + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + k * 0.5 + 0.45);
      o.connect(g).connect(this.sfx);
      o.start(t + k * 0.5);
      lfo.start(t + k * 0.5);
      o.stop(t + k * 0.5 + 0.5);
      lfo.stop(t + k * 0.5 + 0.5);
    }
  }

  questComplete(): void {
    if (!this.ready()) return;
    const t = this.now();
    [0, 2, 3, 4, 7].forEach((d, i) => this.oud(HIJAZ[d] * 2, t + i * 0.12, 0.6));
    this.drum(t, 1, this.music);
    this.drum(t + 0.48, 1, this.music);
  }

  levelUp(): void {
    if (!this.ready()) return;
    const t = this.now();
    [4, 7, 9, 10].forEach((d, i) => this.oud(HIJAZ[d], t + i * 0.09, 0.5));
  }

  death(): void {
    if (!this.ready()) return;
    const t = this.now();
    [7, 6, 5, 4, 3, 1, 0].forEach((d, i) => this.oud(HIJAZ[d] / 2, t + i * 0.32, 0.7));
  }

  ui(): void {
    if (!this.ready()) return;
    this.tone(880, 0.05, 0.05, 'triangle', this.now(), this.sfx);
  }

  // --------------------------------------------------------------- helpers

  private ready(): boolean {
    return Boolean(this.ctx && this.ctx.state === 'running');
  }

  private now(): number {
    return (this.ctx as AudioContext).currentTime;
  }

  private panner(pan: number): AudioNode {
    const ctx = this.ctx as AudioContext;
    if (Math.abs(pan) < 0.05) return this.sfx;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.sfx);
    return p;
  }

  private noiseBurst(t: number, dur: number, freq: number, vol: number, out: AudioNode, type: BiquadFilterType): void {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + this.rng() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, this.rng() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType, t: number, out: AudioNode, glide = 1): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide !== 1) o.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Karplus-Strong string, cached per pitch and damping. */
  private pluckBuffer(freq: number, damping: number, seconds: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const key = `${Math.round(freq * 10)}:${damping}`;
    let buf = this.oudCache.get(key);
    if (buf) return buf;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const period = Math.max(2, Math.floor(sr / freq));
    const ring = new Float32Array(period);
    const r = createSeededRandom(Math.round(freq * 10));
    for (let i = 0; i < period; i += 1) ring[i] = r() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < len; i += 1) {
      const next = (idx + 1) % period;
      const v = (ring[idx] + ring[next]) * damping;
      d[i] = ring[idx];
      ring[idx] = v;
      idx = next;
    }
    this.oudCache.set(key, buf);
    return buf;
  }

  private oud(freq: number, t: number, vol: number, out: AudioNode = this.music): void {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.pluckBuffer(freq, 0.4985, 1.6);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(out);
    src.start(t);
  }

  private drum(t: number, accent: number, out: AudioNode = this.musicBus): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
    g.gain.setValueAtTime(0.35 * accent, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.32);
    // snare jingles of the bendir
    this.noiseBurst(t, 0.12, 3500, 0.06 * accent, out, 'highpass');
  }
}
