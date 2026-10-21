import type { Lang } from '../i18n';

export type VoiceProfile = { pitch: number; rate: number; female: boolean; f0: number };

/** Per-speaker voice character: shared by speech synthesis and the murmur fallback. */
export const VOICE_PROFILES: Record<string, VoiceProfile> = {
  zahra: { pitch: 1.18, rate: 0.95, female: true, f0: 215 },
  lahcen: { pitch: 0.72, rate: 0.86, female: false, f0: 98 },
  v1: { pitch: 0.92, rate: 1.0, female: false, f0: 118 },
  v2: { pitch: 1.25, rate: 1.02, female: true, f0: 228 },
  v3: { pitch: 0.82, rate: 1.06, female: false, f0: 108 },
  french: { pitch: 0.95, rate: 1.15, female: false, f0: 125 },
  officer: { pitch: 0.8, rate: 1.05, female: false, f0: 105 },
  makhzen: { pitch: 0.9, rate: 1.12, female: false, f0: 115 },
  default: { pitch: 1, rate: 1, female: false, f0: 120 },
};

const FEMALE_HINT = /female|woman|zira|hoda|salma|laila|zeina|mariam|amira|hortense|julie|denise|aria|jenny|samantha|google uk english female/i;
const MALE_HINT = /male|man|naayf|hamed|david|mark|paul|guy|claude|george|google uk english male/i;

/**
 * Character voice-over through the Web Speech API. Picks a voice for the line's
 * language (Moroccan Arabic first, then any Arabic; English; French for barks)
 * and reports `false` when none exists so the caller can play a murmur instead.
 */
export class VoiceOver {
  enabled = true;
  volume = 0.9;
  private voices: SpeechSynthesisVoice[] = [];
  private readonly synth: SpeechSynthesis | null = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

  constructor() {
    if (!this.synth) return;
    const load = () => {
      this.voices = this.synth?.getVoices() ?? [];
    };
    load();
    this.synth.addEventListener?.('voiceschanged', load);
  }

  /** Language codes in order of preference for a game language. */
  private codes(lang: Lang | 'fr'): string[] {
    if (lang === 'ar') return ['ar-ma', 'ar-dz', 'ar-tn', 'ar'];
    if (lang === 'fr') return ['fr-fr', 'fr'];
    return ['en-gb', 'en-us', 'en'];
  }

  pick(lang: Lang | 'fr', female: boolean): SpeechSynthesisVoice | null {
    for (const code of this.codes(lang)) {
      const pool = this.voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(code));
      if (pool.length === 0) continue;
      const hint = female ? FEMALE_HINT : MALE_HINT;
      return pool.find((v) => hint.test(v.name)) ?? pool.find((v) => !(female ? MALE_HINT : FEMALE_HINT).test(v.name)) ?? pool[0];
    }
    return null;
  }

  /** Speak a line; returns false when no suitable voice exists (caller falls back to a murmur). */
  speak(text: string, profile: VoiceProfile, lang: Lang | 'fr', interrupt = true, volume = 1): boolean {
    if (!this.synth || !this.enabled) return true;
    const voice = this.pick(lang, profile.female);
    if (!voice) return false;
    if (interrupt) this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[«»"“”]/g, ''));
    u.voice = voice;
    u.lang = voice.lang;
    u.pitch = profile.pitch;
    u.rate = profile.rate;
    u.volume = Math.max(0, Math.min(1, this.volume * volume));
    this.synth.speak(u);
    return true;
  }

  get speaking(): boolean {
    return Boolean(this.synth?.speaking);
  }

  stop(): void {
    this.synth?.cancel();
  }

  pause(paused: boolean): void {
    if (!this.synth) return;
    if (paused) this.synth.pause();
    else this.synth.resume();
  }
}
