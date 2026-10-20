import { createSeededRandom } from '../utils/random';

// Maqam Hijaz on D: D Eb F# G A Bb C D (Hz)
const HIJAZ = [146.83, 155.56, 185.0, 196.0, 220.0, 233.08, 261.63, 293.66, 311.13, 369.99, 392.0];

/**
 * Fully procedural Web Audio: no files. Wind/cricket ambience, Karplus-Strong
 * oud phrases in maqam Hijaz over a bendir pattern (intensifies in combat),
 * and event SFX with pitch variance.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private amb!: GainNode;
  private noise!: AudioBuffer;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private readonly oudCache = new Map<number, AudioBuffer>();
  private readonly rng = createSeededRandom(1944);
  private nextNote = 0;
  private nextDrum = 0;
  private drumStep = 0;
  private phrase: number[] = [];
  private nextCricket = 0;
  muted = false;
  volume = 0.8;
  tension = 0;
  night = 0;

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
    this.music.gain.value = 0.32;
    this.music.connect(comp);
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
    this.nextNote = ctx.currentTime + 1;
    this.nextDrum = ctx.currentTime + 1;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend(paused: boolean): void {
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
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

    // music: oud phrases
    if (t > this.nextNote - 0.1) {
      if (this.phrase.length === 0) this.phrase = this.makePhrase();
      const deg = this.phrase.shift() as number;
      if (deg >= 0) this.oud(HIJAZ[deg], this.nextNote, 0.5 + this.rng() * 0.25);
      const beat = this.tension > 0.5 ? 0.26 : 0.42;
      this.nextNote += beat * (this.rng() < 0.2 ? 2 : 1) + (this.phrase.length === 0 ? beat * 4 : 0);
    }
    // bendir
    if (t > this.nextDrum - 0.1) {
      const pattern = this.tension > 0.5 ? [1, 0, 1, 1, 0, 1, 1, 0] : [1, 0, 0, 1, 0, 0, 1, 0];
      const hit = pattern[this.drumStep % pattern.length];
      if (hit) this.drum(this.nextDrum, this.drumStep % 4 === 0 ? 1 : 0.55);
      this.drumStep += 1;
      this.nextDrum += this.tension > 0.5 ? 0.21 : 0.32;
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
    this.drum(t, 1);
    this.drum(t + 0.48, 1);
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

  /** Karplus-Strong pluck, cached per pitch. */
  private oud(freq: number, t: number, vol: number): void {
    const ctx = this.ctx as AudioContext;
    const key = Math.round(freq * 10);
    let buf = this.oudCache.get(key);
    if (!buf) {
      const sr = ctx.sampleRate;
      const len = Math.floor(sr * 1.6);
      buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const period = Math.max(2, Math.floor(sr / freq));
      const ring = new Float32Array(period);
      const r = createSeededRandom(key);
      for (let i = 0; i < period; i += 1) ring[i] = r() * 2 - 1;
      let idx = 0;
      for (let i = 0; i < len; i += 1) {
        const next = (idx + 1) % period;
        const v = (ring[idx] + ring[next]) * 0.4985;
        d[i] = ring[idx];
        ring[idx] = v;
        idx = next;
      }
      this.oudCache.set(key, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.music);
    src.start(t);
  }

  private drum(t: number, accent: number): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
    g.gain.setValueAtTime(0.35 * accent, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.32);
    // snare jingles of the bendir
    this.noiseBurst(t, 0.12, 3500, 0.06 * accent, this.music, 'highpass');
  }

  private makePhrase(): number[] {
    // stepwise motion around the Hijaz tetrachord with a cadence on D
    const out: number[] = [];
    let d = this.tension > 0.5 ? 4 : 2 + Math.floor(this.rng() * 3);
    const len = 5 + Math.floor(this.rng() * 5);
    for (let i = 0; i < len; i += 1) {
      out.push(this.rng() < 0.12 ? -1 : d);
      d = Math.max(0, Math.min(HIJAZ.length - 1, d + (this.rng() < 0.5 ? -1 : 1) * (this.rng() < 0.8 ? 1 : 2)));
    }
    out.push(this.rng() < 0.5 ? 0 : 4);
    return out;
  }
}
