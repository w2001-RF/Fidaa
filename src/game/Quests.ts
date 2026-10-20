import type { LootBundle } from './types';

export type Objective = {
  id: string;
  text: string;
  /** event that advances this objective */
  event: string;
  count?: number;
  /** id resolved by Game into a world position for the compass / beacon */
  target?: string | string[];
};

export type Step = {
  objectives: Objective[];
  /** interactables enabled while this step is active (questGate values) */
  gate?: string;
  /** dialogue shown when talking to `npc` during this step; finishing it fires `talk:<npc>` */
  npc?: string;
  lines?: [speaker: string, text: string][];
};

export type Mission = {
  id: string;
  title: string;
  arabic: string;
  brief: string;
  steps: Step[];
  reward: { xp: number; items: LootBundle };
};

export const MISSIONS: Mission[] = [
  {
    id: 'bread',
    title: 'Bread and Water',
    arabic: 'الخبز والماء',
    brief: 'A fidāʾī who cannot eat or drink cannot fight. Learn to provide for yourself before the cell trusts you with more.',
    reward: { xp: 45, items: { herbs: 1, dates: 2 } },
    steps: [
      {
        npc: 'zahra',
        lines: [
          ['Lalla Zahra', 'Driss, wlidi. Since the Manifesto of January, the Résidence has jailed every man who signed it or read it aloud.'],
          ['Lalla Zahra', "The Caïd's mokhaznis ride with the French now. They watch the roads, the souk, even the wells."],
          ['Lalla Zahra', 'Before anything else: fill your guerba at the well and take bread from the ferran. Out there, hunger and thirst will kill you faster than any bullet.'],
        ],
        objectives: [{ id: 'talk', text: 'Talk to Lalla Zahra', event: 'talk:zahra', target: 'npc:zahra' }],
      },
      {
        objectives: [
          { id: 'water', text: 'Draw water at the douar well', event: 'water:douar-well', target: 'it:douar-well' },
          { id: 'bread', text: 'Take bread from the oven', event: 'oven:douar-oven', target: 'it:douar-oven' },
        ],
      },
      {
        npc: 'zahra',
        lines: [
          ['Lalla Zahra', 'Good. Keep your water skin full: wells, fountains and the oasis pond. Eat with F, drink with Q.'],
          ['Lalla Zahra', 'Now go to Si Lahcen. He prints the words they are afraid of.'],
        ],
        objectives: [{ id: 'back', text: 'Return to Lalla Zahra', event: 'talk:zahra', target: 'npc:zahra' }],
      },
    ],
  },
  {
    id: 'leaflets',
    title: 'Words of Freedom',
    arabic: 'كلمات الحرية',
    brief: "Paste the Istiqlal leaflets over the Résidence's curfew proclamations in the medina of Tadwart. Let the people read that Morocco demands its freedom.",
    reward: { xp: 90, items: { ammo: 6, bread: 1 } },
    steps: [
      {
        npc: 'lahcen',
        lines: [
          ['Si Lahcen', 'So Zahra sent you. Take these: three tracts of the Manifesto, printed in Arabic and in French.'],
          ['Si Lahcen', 'In the medina the Résidence has nailed up its curfew notices. Cover them. Let every merchant read: "Vive le Maroc libre."'],
          ['Si Lahcen', 'Patrols walk the main streets and guard the gates. Crouch with C, stay out of their sight, and move by night if you can. If they see you, run and break the line of sight.'],
        ],
        objectives: [{ id: 'talk', text: 'Talk to Si Lahcen', event: 'talk:lahcen', target: 'npc:lahcen' }],
      },
      {
        gate: 'leaflets',
        objectives: [
          {
            id: 'paste',
            text: 'Paste leaflets over the proclamations in the medina',
            event: 'leaflet',
            count: 3,
            target: ['it:leaflet-plaza', 'it:leaflet-souk', 'it:leaflet-north'],
          },
        ],
      },
      {
        npc: 'lahcen',
        lines: [
          ['Si Lahcen', 'They will be talking of it in the hammams tonight. Well done.'],
          ['Si Lahcen', 'Here are cartridges for the old rifle. Use them sparingly: every shot brings the whole garrison.'],
        ],
        objectives: [{ id: 'back', text: 'Return to Si Lahcen', event: 'talk:lahcen', target: 'npc:lahcen' }],
      },
    ],
  },
  {
    id: 'wires',
    title: 'Cut the Wires',
    arabic: 'قطع الأسلاك',
    brief: 'The telegraph line from the medina to the post of Bir Lahmam carries the arrest orders. Cut it in four places and the round-ups will be blind for days.',
    reward: { xp: 110, items: { ammo: 5, bread: 1, herbs: 1 } },
    steps: [
      {
        npc: 'lahcen',
        lines: [
          ['Si Lahcen', 'Tomorrow they plan a round-up in the douars. The orders travel by the telegraph to Bir Lahmam.'],
          ['Si Lahcen', 'Cut the wires at four poles along the eastern road. A soldier and a mokhazni walk that road; take them quietly from behind with your khanjar if you must.'],
        ],
        objectives: [{ id: 'talk', text: 'Listen to Si Lahcen', event: 'talk:lahcen', target: 'npc:lahcen' }],
      },
      {
        gate: 'wires',
        objectives: [{ id: 'poles', text: 'Cut the telegraph wires on the eastern road', event: 'pole', count: 4, target: ['it:pole-1', 'it:pole-2', 'it:pole-3', 'it:pole-4'] }],
      },
      {
        npc: 'lahcen',
        lines: [['Si Lahcen', 'The line is dead. Allah ybarek fik. Zahra is asking for you, it is about her brother.']],
        objectives: [{ id: 'back', text: 'Return to Si Lahcen', event: 'talk:lahcen', target: 'npc:lahcen' }],
      },
    ],
  },
  {
    id: 'prison',
    title: "The Caïd's Prison",
    arabic: 'سجن القايد',
    brief: "The Caïd's men took Zahra's brother Hammou and two others for reading the Manifesto in the souk. They rot in the kasbah prison.",
    reward: { xp: 150, items: { ammo: 4, herbs: 2 } },
    steps: [
      {
        npc: 'zahra',
        lines: [
          ['Lalla Zahra', 'My brother Hammou… the Caïd sold him to the French for a medal. He is in the prison of the kasbah, with two others.'],
          ['Lalla Zahra', 'The Khalifa of the Caïd carries the key at his belt. Take it from him, by stealth or by force, and open that cell.'],
          ['Lalla Zahra', 'The kasbah is full of mokhaznis. If they raise the alarm, the whole fortress will hunt you.'],
        ],
        objectives: [{ id: 'talk', text: 'Talk to Lalla Zahra', event: 'talk:zahra', target: 'npc:zahra' }],
      },
      {
        objectives: [{ id: 'key', text: "Take the prison key from the Caïd's Khalifa", event: 'key', target: 'enemy:k-khalifa' }],
      },
      {
        gate: 'prison',
        objectives: [{ id: 'free', text: 'Unlock the prison in the kasbah', event: 'prison', target: 'it:prison-door' }],
      },
      {
        npc: 'zahra',
        lines: [
          ['Lalla Zahra', 'Hammou is free, and on his way to the mountains. I will never forget this, Driss.'],
          ['Lalla Zahra', 'Si Lahcen has one last task. The biggest one.'],
        ],
        objectives: [{ id: 'back', text: 'Return to Lalla Zahra', event: 'talk:zahra', target: 'npc:zahra' }],
      },
    ],
  },
  {
    id: 'cache',
    title: 'Guns for the Mountains',
    arabic: 'سلاح للجبال',
    brief: 'The garrison of Bir Lahmam keeps a crate store of rifles. Brought to the mountains, they will arm the brothers who will not kneel.',
    reward: { xp: 250, items: {} },
    steps: [
      {
        npc: 'lahcen',
        lines: [
          ['Si Lahcen', 'Leaflets wake the people. But the day will come when words are not enough.'],
          ['Si Lahcen', 'The post of Bir Lahmam keeps an arms cache in front of its depot. Steal it and bring it here. The brothers in the Atlas are waiting.'],
          ['Si Lahcen', 'There is a sentry in the watchtower and a lieutenant who never sleeps. Go at night. Go carefully.'],
        ],
        objectives: [{ id: 'talk', text: 'Talk to Si Lahcen', event: 'talk:lahcen', target: 'npc:lahcen' }],
      },
      {
        gate: 'cache',
        objectives: [{ id: 'steal', text: 'Steal the arms cache at the post of Bir Lahmam', event: 'cache', target: 'it:arms-cache' }],
      },
      {
        objectives: [{ id: 'home', text: 'Bring the weapons back to Douar Tifawt', event: 'reach:douar', target: 'hideout' }],
      },
    ],
  },
];

export type QuestEventResult = {
  progressed: boolean;
  stepDone: boolean;
  missionDone: Mission | null;
  allDone: boolean;
};

/** Linear mission chain with per-step objective counters. */
export class QuestSystem {
  mission = 0;
  step = 0;
  private counts = new Map<string, number>();

  get current(): Mission | null {
    return MISSIONS[this.mission] ?? null;
  }

  get currentStep(): Step | null {
    return this.current?.steps[this.step] ?? null;
  }

  get finished(): boolean {
    return this.mission >= MISSIONS.length;
  }

  activeGate(): string | null {
    return this.currentStep?.gate ?? null;
  }

  objectiveState(): { obj: Objective; have: number; need: number; done: boolean }[] {
    const st = this.currentStep;
    if (!st) return [];
    return st.objectives.map((obj) => {
      const need = obj.count ?? 1;
      const have = Math.min(need, this.counts.get(obj.id) ?? 0);
      return { obj, have, need, done: have >= need };
    });
  }

  /** NPC dialogue if this NPC has something to say for the current step. */
  dialogueFor(npc: string): [string, string][] | null {
    const st = this.currentStep;
    if (st?.npc === npc && st.lines) return st.lines;
    return null;
  }

  /** Feed a gameplay event (e.g. "water:douar-well", "leaflet", "talk:zahra"). */
  handle(event: string): QuestEventResult {
    const res: QuestEventResult = { progressed: false, stepDone: false, missionDone: null, allDone: false };
    const st = this.currentStep;
    if (!st) return res;
    for (const o of st.objectives) {
      if (o.event !== event) continue;
      const need = o.count ?? 1;
      const have = this.counts.get(o.id) ?? 0;
      if (have >= need) continue;
      this.counts.set(o.id, have + 1);
      res.progressed = true;
      break;
    }
    if (!res.progressed) return res;
    const allMet = st.objectives.every((o) => (this.counts.get(o.id) ?? 0) >= (o.count ?? 1));
    if (allMet) {
      res.stepDone = true;
      this.counts.clear();
      this.step += 1;
      const m = this.current;
      if (m && this.step >= m.steps.length) {
        res.missionDone = m;
        this.mission += 1;
        this.step = 0;
        if (this.finished) res.allDone = true;
      }
    }
    return res;
  }

  /** Jump to a mission/step (test hooks). */
  jump(mission: number, step: number): void {
    this.mission = mission;
    this.step = step;
    this.counts.clear();
  }

  snapshot(): { mission: number; step: number; counts: [string, number][] } {
    return { mission: this.mission, step: this.step, counts: [...this.counts] };
  }

  restore(s: { mission: number; step: number; counts: [string, number][] }): void {
    this.mission = s.mission;
    this.step = s.step;
    this.counts = new Map(s.counts);
  }
}
