import { L, type Text } from '../i18n';
import type { LootBundle } from './types';

export type Objective = {
  id: string;
  text: Text;
  /** event that advances this objective */
  event: string;
  count?: number;
  /** id resolved by Game into a world position for the compass / beacon */
  target?: string | string[];
};

export type Line = [speaker: Text, text: Text];

export type Step = {
  objectives: Objective[];
  /** interactables enabled while this step is active (questGate values) */
  gate?: string;
  /** dialogue shown when talking to `npc` during this step; finishing it fires `talk:<npc>` */
  npc?: string;
  lines?: Line[];
};

export type Mission = {
  id: string;
  title: Text;
  brief: Text;
  steps: Step[];
  reward: { xp: number; items: LootBundle };
};

export const ZAHRA = L('Lalla Zahra', 'للا زهرة');
export const LAHCEN = L('Si Lahcen', 'سي لحسن');

export const MISSIONS: Mission[] = [
  {
    id: 'bread',
    title: L('Bread and Water', 'الخبز والما'),
    brief: L(
      'A fidāʾī who cannot eat or drink cannot fight. Learn to provide for yourself before the cell trusts you with more.',
      'الفدائي اللي ما كلاش وما شربش ما يقدرش يقاتل. تعلّم تدبّر على راسك عاد الخلية تتيق فيك بكثر.',
    ),
    reward: { xp: 45, items: { herbs: 1, dates: 2, cloth: 1 } },
    steps: [
      {
        npc: 'zahra',
        lines: [
          [ZAHRA, L('Driss, wlidi. Since the Manifesto of January, the Résidence has jailed every man who signed it or read it aloud.', 'إدريس، أولدي. من نهار وثيقة يناير، والإقامة كتحبس كل واحد سنياها ولا قراها بالجهر.')],
          [ZAHRA, L("The Caïd's mokhaznis ride with the French now. They watch the roads, the souk, even the wells.", 'المخازنية ديال القايد ولّاو كيركبو مع الفرنساويين. كيعسّو الطرقان، والسوق، حتى البيار.')],
          [ZAHRA, L('Before anything else: fill your guerba at the well and take bread from the ferran. Out there, hunger and thirst will kill you faster than any bullet.', 'قبل كلشي: عمّر القربة من البير وخود الخبز من الفرّان. لبرا، الجوع والعطش يقتلوك قبل أي قرطاسة.')],
        ],
        objectives: [{ id: 'talk', text: L('Talk to Lalla Zahra', 'هضر مع للا زهرة'), event: 'talk:zahra', target: 'npc:zahra' }],
      },
      {
        objectives: [
          { id: 'water', text: L('Draw water at the douar well', 'جبد الما من بير الدوار'), event: 'water:douar-well', target: 'it:douar-well' },
          { id: 'bread', text: L('Take bread from the oven', 'خود الخبز من الفرّان'), event: 'oven:douar-oven', target: 'it:douar-oven' },
        ],
      },
      {
        npc: 'zahra',
        lines: [
          [ZAHRA, L('Good. Keep your water skin full: wells, fountains and the oasis pond. Eat with F, drink with Q.', 'مزيان. خلّي القربة ديما عامرة: البيار، السقايات والضاية ديال الواحة. كول بـF، شرب بـQ.')],
          [ZAHRA, L('Search everything: jars, crates, the fallen. Cloth, wood, scrap and powder become bandages and cartridges at the bench (K).', 'فتّش كلشي: الخوابي، الصناديق، اللي طاحو. الثوب، الحطب، الخردة والبارود كيولّيو فاصمات وقرطاس فالبنكة (K).')],
          [ZAHRA, L('Now go to Si Lahcen. He prints the words they are afraid of.', 'دابا سير عند سي لحسن. هو اللي كيطبع الكلام اللي كيخلعهم.')],
        ],
        objectives: [{ id: 'back', text: L('Return to Lalla Zahra', 'رجع عند للا زهرة'), event: 'talk:zahra', target: 'npc:zahra' }],
      },
    ],
  },
  {
    id: 'leaflets',
    title: L('Words of Freedom', 'كلمات الحرية'),
    brief: L(
      "Paste the Istiqlal leaflets over the Résidence's curfew proclamations in the medina of Tadwart. Let the people read that Morocco demands its freedom.",
      'لصق مناشير الاستقلال فوق بلاغات حظر التجول ديال الإقامة فمدينة تادوارت. خلّي الناس يقراو بلّي المغرب كيطالب بالحرية ديالو.',
    ),
    reward: { xp: 90, items: { ammo: 6, bread: 1, powder: 1 } },
    steps: [
      {
        npc: 'lahcen',
        lines: [
          [LAHCEN, L('So Zahra sent you. Take these: three tracts of the Manifesto, printed in Arabic and in French.', 'إيوا زهرة صيفطاتك. خود هادو: تلاتة د المناشير ديال الوثيقة، مطبوعين بالعربية وبالفرنساوية.')],
          [LAHCEN, L('In the medina the Résidence has nailed up its curfew notices. Cover them. Let every merchant read: "Vive le Maroc libre."', 'فالمدينة الإقامة سمّرات البلاغات ديال حظر التجول. غطّيهم. خلّي كل تاجر يقرا: "عاش المغرب حر."')],
          [LAHCEN, L('Patrols walk the main streets and guard the gates. Crouch with C, stay out of their sight, and move by night if you can. If they see you, run and break the line of sight.', 'العسّة كدور فالزناقي الكبار وكتحضي البيبان. تكمّش بـC، بعّد من عينيهم، وتحرّك بالليل إلا قدرتي. إلا شافوك، جري وغبر من قدامهم.')],
        ],
        objectives: [{ id: 'talk', text: L('Talk to Si Lahcen', 'هضر مع سي لحسن'), event: 'talk:lahcen', target: 'npc:lahcen' }],
      },
      {
        gate: 'leaflets',
        objectives: [
          {
            id: 'paste',
            text: L('Paste leaflets over the proclamations in the medina', 'لصق المناشير فوق البلاغات فالمدينة'),
            event: 'leaflet',
            count: 3,
            target: ['it:leaflet-plaza', 'it:leaflet-souk', 'it:leaflet-north'],
          },
        ],
      },
      {
        npc: 'lahcen',
        lines: [
          [LAHCEN, L('They will be talking of it in the hammams tonight. Well done.', 'هاد الليلة غادي يهضرو عليها فالحمّامات. تبارك الله عليك.')],
          [LAHCEN, L('Here are cartridges for the old rifle. Use them sparingly: every shot brings the whole garrison.', 'ها القرطاس ديال الفيزي القديم. خدم بيه بالعقل: كل قرطاسة كتجيب العسكر كاملين.')],
        ],
        objectives: [{ id: 'back', text: L('Return to Si Lahcen', 'رجع عند سي لحسن'), event: 'talk:lahcen', target: 'npc:lahcen' }],
      },
    ],
  },
  {
    id: 'wires',
    title: L('Cut the Wires', 'قطع السلوك'),
    brief: L(
      'The telegraph line from the medina to the post of Bir Lahmam carries the arrest orders. Cut it in four places and the round-ups will be blind for days.',
      'خط التيليغراف من المدينة لمركز بير لحمام كيهز الأوامر ديال الحبس. قطعو فربعة د البلايص والحملات غادي يبقاو عميين لمدة أيام.',
    ),
    reward: { xp: 110, items: { ammo: 5, bread: 1, herbs: 1, scrap: 2 } },
    steps: [
      {
        npc: 'lahcen',
        lines: [
          [LAHCEN, L('Tomorrow they plan a round-up in the douars. The orders travel by the telegraph to Bir Lahmam.', 'غدّا ناويين يديرو حملة فالدواور. الأوامر كتمشي فالتيليغراف لبير لحمام.')],
          [LAHCEN, L('Cut the wires at four poles along the eastern road. A soldier and a mokhazni walk that road; take them quietly from behind with your khanjar if you must.', 'قطع السلوك فربعة د الركايز على طريق الشرق. عسكري ومخزني كيدورو فديك الطريق؛ إلا اضطرّيتي، طيّحهم بالخنجر من اللور بلا حس.')],
        ],
        objectives: [{ id: 'talk', text: L('Listen to Si Lahcen', 'سمع لسي لحسن'), event: 'talk:lahcen', target: 'npc:lahcen' }],
      },
      {
        gate: 'wires',
        objectives: [{ id: 'poles', text: L('Cut the telegraph wires on the eastern road', 'قطع سلوك التيليغراف على طريق الشرق'), event: 'pole', count: 4, target: ['it:pole-1', 'it:pole-2', 'it:pole-3', 'it:pole-4'] }],
      },
      {
        npc: 'lahcen',
        lines: [[LAHCEN, L('The line is dead. Allah ybarek fik. Zahra is asking for you, it is about her brother.', 'الخط مات. الله يبارك فيك. زهرة كتسوّل عليك، على خوها.')]],
        objectives: [{ id: 'back', text: L('Return to Si Lahcen', 'رجع عند سي لحسن'), event: 'talk:lahcen', target: 'npc:lahcen' }],
      },
    ],
  },
  {
    id: 'prison',
    title: L("The Caïd's Prison", 'حبس القايد'),
    brief: L(
      "The Caïd's men took Zahra's brother Hammou and two others for reading the Manifesto in the souk. They rot in the kasbah prison.",
      'رجال القايد شدّو حمّو خو زهرة وجوج آخرين حيت قراو الوثيقة فالسوق. راهم كيتعذّبو فحبس القصبة.',
    ),
    reward: { xp: 150, items: { ammo: 4, herbs: 2, cloth: 2 } },
    steps: [
      {
        npc: 'zahra',
        lines: [
          [ZAHRA, L('My brother Hammou… the Caïd sold him to the French for a medal. He is in the prison of the kasbah, with two others.', 'خويا حمّو… القايد باعو للفرنساويين على وسام. راه فحبس القصبة، مع جوج آخرين.')],
          [ZAHRA, L('The Khalifa of the Caïd carries the key at his belt. Take it from him, by stealth or by force, and open that cell.', 'خليفة القايد هاز الساروت فالسمطة ديالو. خودو منو، بالحيلة ولا بالسيف، وحل داك الحبس.')],
          [ZAHRA, L('The kasbah is full of mokhaznis. If they raise the alarm, the whole fortress will hunt you.', 'القصبة عامرة بالمخازنية. إلا صفّرو، القصبة كاملة غادي تقلّب عليك.')],
        ],
        objectives: [{ id: 'talk', text: L('Talk to Lalla Zahra', 'هضر مع للا زهرة'), event: 'talk:zahra', target: 'npc:zahra' }],
      },
      {
        objectives: [{ id: 'key', text: L("Take the prison key from the Caïd's Khalifa", 'خود ساروت الحبس من خليفة القايد'), event: 'key', target: 'enemy:k-khalifa' }],
      },
      {
        gate: 'prison',
        objectives: [{ id: 'free', text: L('Unlock the prison in the kasbah', 'حل الحبس فالقصبة'), event: 'prison', target: 'it:prison-door' }],
      },
      {
        npc: 'zahra',
        lines: [
          [ZAHRA, L('Hammou is free, and on his way to the mountains. I will never forget this, Driss.', 'حمّو تسرّح، وراه فالطريق للجبل. عمّري ما ننسى ليك هادي، أ إدريس.')],
          [ZAHRA, L('Si Lahcen has one last task. The biggest one.', 'سي لحسن عندو آخر خدمة. الكبيرة فيهم.')],
        ],
        objectives: [{ id: 'back', text: L('Return to Lalla Zahra', 'رجع عند للا زهرة'), event: 'talk:zahra', target: 'npc:zahra' }],
      },
    ],
  },
  {
    id: 'cache',
    title: L('Guns for the Mountains', 'السلاح للجبال'),
    brief: L(
      'The garrison of Bir Lahmam keeps a crate store of rifles. Brought to the mountains, they will arm the brothers who will not kneel.',
      'عسكر بير لحمام عندهم صناديق د المكاحل. إلا وصلو للجبل، غادي يسلّحو الخوت اللي ما كيركعوش.',
    ),
    reward: { xp: 250, items: {} },
    steps: [
      {
        npc: 'lahcen',
        lines: [
          [LAHCEN, L('Leaflets wake the people. But the day will come when words are not enough.', 'المناشير كتفيّق الناس. ولكن غادي يجي نهار والكلام ما يبقاش كافي.')],
          [LAHCEN, L('The post of Bir Lahmam keeps an arms cache in front of its depot. Steal it and bring it here. The brothers in the Atlas are waiting.', 'مركز بير لحمام عندو السلاح قدام المخزن. سرقو وجيبو لهنا. الخوت فالأطلس كيتسناو.')],
          [LAHCEN, L('There is a sentry in the watchtower and a lieutenant who never sleeps. Go at night. Go carefully.', 'كاين عسّاس فالبرج وليوطنان عمّرو ما كينعس. سير بالليل. سير بشوية.')],
        ],
        objectives: [{ id: 'talk', text: L('Talk to Si Lahcen', 'هضر مع سي لحسن'), event: 'talk:lahcen', target: 'npc:lahcen' }],
      },
      {
        gate: 'cache',
        objectives: [{ id: 'steal', text: L('Steal the arms cache at the post of Bir Lahmam', 'سرق السلاح من مركز بير لحمام'), event: 'cache', target: 'it:arms-cache' }],
      },
      {
        objectives: [{ id: 'home', text: L('Bring the weapons back to Douar Tifawt', 'رجّع السلاح لدوار تيفاوت'), event: 'reach:douar', target: 'hideout' }],
      },
    ],
  },
  {
    id: 'flight',
    title: L('Wings over Tadwart', 'جناحات فوق تادوارت'),
    brief: L(
      "The garrison's liaison plane carries the Résidence's orders between the posts. Steal it, rain the Manifesto down on the medina from the sky, and bring it down near the douar.",
      'الطيارة ديال العسكر كتهز الأوامر بين المراكز. سرقها، طيّح الوثيقة على المدينة من السما، ونزّلها حدا الدوار.',
    ),
    reward: { xp: 300, items: {} },
    steps: [
      {
        npc: 'lahcen',
        lines: [
          [LAHCEN, L('The rifles are in the mountains. Now the whole country must hear of it.', 'المكاحل وصلو للجبال. دابا خاص البلاد كاملة تسمع.')],
          [LAHCEN, L("At Bir Lahmam the French keep a small aeroplane on a dirt strip west of the post. Hammou's cousin flew with the Free French; he showed me how they fly.", 'فبير لحمام عند الفرنساويين طيارة صغيرة فوق مدرج ديال التراب غرب المركز. ولد عم حمّو طار مع فرنسا الحرة؛ ورّاني كيفاش كيطيرو.')],
          [LAHCEN, L('W opens the throttle. When she runs fast, Space pulls her into the sky; C pushes the nose down. Fly over the medina and press E to drop the leaflets, then land gently near the douar.', 'W كتزيد الغاز. ملي تجري مزيان، Space كيطلعها للسما؛ C كيهبّط الراس. دوز فوق المدينة وورك E باش تطيّح المناشير، من بعد نزّل بشوية حدا الدوار.')],
        ],
        objectives: [{ id: 'talk', text: L('Talk to Si Lahcen', 'هضر مع سي لحسن'), event: 'talk:lahcen', target: 'npc:lahcen' }],
      },
      {
        objectives: [{ id: 'board', text: L('Steal the plane at the Bir Lahmam airstrip', 'سرق الطيارة من مدرج بير لحمام'), event: 'board:plane', target: 'ride:plane' }],
      },
      {
        objectives: [{ id: 'drop', text: L('Fly over the medina and drop the leaflets (E)', 'طير فوق المدينة وطيّح المناشير (E)'), event: 'airdrop', target: 'zone:medina' }],
      },
      {
        objectives: [{ id: 'land', text: L('Land on the strip beside Douar Tifawt (flaps down, slow, brake with Space)', 'نزّل الطيارة فالمدرج حدا دوار تيفاوت (الفلاپس لتحت، بشوية، فرانا بـ Space)'), event: 'landed:douar', target: 'strip:douar' }],
      },
    ],
  },
];

/** Idle chatter when an NPC has nothing for the current quest step. */
export const AMBIENT_LINES: Record<string, Text[]> = {
  zahra: [
    L('Eat when you can, drink when you can. The land is generous only to those who prepare.', 'كول ملي تقدر، وشرب ملي تقدر. الأرض كتعطي غير للي موجّد راسو.'),
    L('Night is our friend, Driss. Their lanterns only light their own faces.', 'الليل صاحبنا، أ إدريس. القناديل ديالهم كيضوّيو غير على وجوههم.'),
  ],
  lahcen: [
    L('A cartridge fired is a garrison awake. Use the khanjar when you can.', 'قرطاسة مطلوقة هي عسكر فايقين. خدم بالخنجر ملي تقدر.'),
    L('Rest on the mat in my house if you need the night to come faster.', 'رتاح فوق الحصيرة فداري إلا بغيتي الليل يطيح دغيا.'),
    L('My bench is yours. Bring me cloth, wood and scrap, and the old moukahla of my father will sing again.', 'البنكة ديالي ديالك. جيب ليا الثوب والحطب والخردة، والمكحلة ديال الوالد ترجع تغنّي.'),
  ],
  v1: [L('The Caïd took half my barley "for the war effort". Which war, I ask you?', 'القايد داّ ليا نص الشعير "على قبل الحرب". أشمن حرب، قول ليا؟')],
  v2: [L('My son reads the Manifesto to the children at night. Allah protect him.', 'ولدي كيقرا الوثيقة للدراري بالليل. الله يحفظو.')],
  v3: [L('Sheep do not ask for papers. Lucky sheep.', 'الغنم ما كيطلبوش الأوراق. سعدات الغنم.'), L('Past the ruined ksar to the north, there is a lookout. From there you can see half the country.', 'من ورا القصر الخربان فالشمال كاين مرقب. من تمّا كتشوف نص البلاد.')],
};

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
  dialogueFor(npc: string): Line[] | null {
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
