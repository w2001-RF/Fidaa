/**
 * Two languages: English and Moroccan Darija (Arabic script).
 * Static UI text lives in STRINGS and is bound in index.html with data-i18n / data-i18n-html.
 * Game data (missions, prompts, names) carries its own { en, ar } pairs, translated when shown.
 */
export type Lang = 'en' | 'ar';
export type Text = { en: string; ar: string };

export const L = (en: string, ar: string): Text => ({ en, ar });

const STORAGE_KEY = 'fidai-lang';
const listeners: ((lang: Lang) => void)[] = [];

function initialLang(): Lang {
  const q = new URLSearchParams(window.location.search).get('lang');
  if (q === 'ar' || q === 'en') return q;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    // storage blocked: fall back to English
  }
  return 'en';
}

let current: Lang = initialLang();

export function lang(): Lang {
  return current;
}

export function tr(text: Text): string {
  return text[current];
}

/** The other language, for bilingual subtitles (banner, map). */
export function trAlt(text: Text): string {
  return text[current === 'en' ? 'ar' : 'en'];
}

export function t(key: StringKey, vars?: Record<string, string | number>): string {
  let s: string = STRINGS[key][current];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function setLang(next: Lang): void {
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // not persisted; still applies for this session
  }
  applyDom();
  for (const fn of listeners) fn(next);
}

export function onLangChange(fn: (lang: Lang) => void): void {
  listeners.push(fn);
}

/** Fill every bound element of the static shell and set lang/dir on <html>. */
export function applyDom(): void {
  const root = document.documentElement;
  root.lang = current === 'ar' ? 'ar-MA' : 'en';
  root.dataset.lang = current;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as StringKey);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml as StringKey);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle as StringKey);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria as StringKey));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.classList.toggle('active', b.dataset.lang === current));
  document.title = t('doc.title');
}

export const STRINGS = {
  'doc.title': L('FIDĀʾĪ — Morocco 1945', 'فدائي — المغرب 1945'),
  'lang.label': L('Language', 'اللغة'),

  // ---- title
  'title.sub': L('Morocco · 1945 · The Protectorate', 'المغرب · 1945 · أيام الحماية'),
  'title.intro': L(
    'Since the Manifesto of Independence of <b>11 January 1944</b>, the Résidence Générale has answered the nationalists with arrests, curfews and the whip. In the countryside, the Caïds and their mokhaznis serve the occupier. You are <b>Driss</b>, a young fidāʾī of a clandestine cell in the douar of Tifawt. Survive the land. Strike, and vanish.',
    'من نهار وثيقة الاستقلال ديال <b>11 يناير 1944</b>، والإقامة العامة كترد على الوطنيين بالحبس، وحظر التجول، والسوط. فالعروبية، القياد والمخازنية ديالهم خدامين مع المستعمر. نتا <b>إدريس</b>، فدائي صغير فخلية سرية فدوار تيفاوت. عيش من الأرض. ضرب، وغبر.',
  ),
  'title.start': L('Begin the struggle', 'بدا النضال'),
  'title.continue': L('Continue the struggle', 'كمّل النضال'),
  'save.button': L('Save the game', 'سجّل اللعبة'),
  'save.saved': L('Game saved (IndexedDB).', 'تسجّلات اللعبة (IndexedDB).'),
  'save.cookie': L('Game saved in a cookie (storage limited: map fog not kept).', 'تسجّلات فكوكي (المساحة قليلة: الضباب ديال الخريطة ما تسجّلش).'),
  'save.failed': L('Could not save: browser storage is blocked.', 'ما قدرناش نسجّلو: التخزين مسدود فالمتصفح.'),
  'save.last': L('Last saved at {time}', 'آخر تسجيل {time}'),
  'save.resumed': L('Welcome back', 'مرحبا بك من جديد'),
  'title.note': L(
    'A work of historical fiction. Places and characters are invented; the struggle for independence (1944–1956) was not.',
    'قصة خيالية فإطار تاريخي. البلايص والشخصيات مخترعين، ولكن النضال على الاستقلال (1944–1956) كان حقيقة.',
  ),
  'ctl.move': L('move', 'تحرك'),
  'ctl.look': L('look', 'شوف'),
  'ctl.sprint': L('sprint', 'جري'),
  'ctl.crouch': L('crouch / sneak', 'تكمّش / تسلّل'),
  'ctl.strike': L('strike / fire', 'ضرب / طلق'),
  'ctl.aim': L('aim', 'نيشان'),
  'ctl.weapons': L('weapons', 'السلاح'),
  'ctl.view': L('first / third person', 'الشوفة: من العينين / من اللور'),
  'ctl.lookBack': L('look behind (hold)', 'شوف موراك (ضغط)'),
  'ctl.plane': L('plane: roll and pitch (W/S throttle, A/D rudder)', 'الطيارة: الميلان والراس (W/S الغاز، A/D الدفّة)'),
  'ctl.cockpit': L('engine · flaps · trim', 'الموطور · الفلاپس · التريم'),
  'view.first': L('First-person view (V)', 'الشوفة من العينين (V)'),
  'view.third': L('Third-person view (V)', 'الشوفة من اللور (V)'),
  'ctl.craft': L('crafting', 'الصنعة'),
  'ctl.hunt': L('hunt game, skin with E', 'صيد، وسلخ بـE'),
  'ctl.ride': L('ride / drive (E on and off)', 'ركوب / سياقة (E طلع ونزل)'),
  'ctl.reload': L('reload', 'عمّر'),
  'ctl.interact': L('interact / takedown', 'تفاعل / طيّح بلا حس'),
  'ctl.consume': L('drink · eat · herbs', 'شرب · كول · عشوب'),
  'ctl.inventory': L('inventory & skills', 'الشكارة والمهارات'),
  'ctl.map': L('map', 'الخريطة'),
  'ctl.pause': L('pause', 'وقّف'),

  // ---- HUD
  'hud.hunger': L('Hunger', 'الجوع'),
  'hud.thirst': L('Thirst', 'العطش'),
  'hud.level': L('Lv', 'مستوى'),
  'hud.lockHint': L('Click to take control · <kbd>Esc</kbd> pauses', 'كليكي باش تتحكم · <kbd>Esc</kbd> كيوقّف'),
  'hud.dlgNext': L('<kbd>E</kbd> / click to continue', '<kbd>E</kbd> / كليكي باش تكمّل'),
  'alert.unseen': L('Unseen', 'ما شافك حد'),
  'alert.unseenNight': L('Unseen · night', 'ما شافك حد · الليل'),
  'alert.suspicious': L('Suspicious', 'شكّو فيك'),
  'alert.hunted': L('Hunted', 'كيقلبو عليك'),
  'weapon.reloading': L('{w} · reloading', '{w} · كتعمّر'),
  'weapon.silent': L('silent', 'بلا حس'),
  'compass.n': L('N', 'ش'),
  'compass.e': L('E', 'ق'),
  'compass.s': L('S', 'ج'),
  'compass.w': L('W', 'غ'),
  'unit.m': L('{n} m', '{n} م'),

  // ---- pause / death / victory
  'pause.title': L('Paused', 'متوقّف'),
  'pause.resume': L('Resume', 'كمّل'),
  'pause.soundOn': L('Sound: on', 'الصوت: خدام'),
  'pause.soundOff': L('Sound: off', 'الصوت: مطفي'),
  'pause.volume': L('Volume', 'الصوت'),
  'pause.sens': L('Mouse sensitivity', 'حساسية الفأرة'),
  'pause.restart': L('Restart from the hideout', 'عاود من المخبأ'),
  'death.title': L('You have fallen', 'طحتي'),
  'death.retry': L('Rise again at Douar Tifawt', 'نوض من جديد فدوار تيفاوت'),
  'death.thirst': L('The sun took you before the enemy could. You died of thirst.', 'الشمس سبقات العدو. متّي بالعطش.'),
  'death.hunger': L('Your body gave out. You died of hunger.', 'جسدك ما بقاش قادر. متّي بالجوع.'),
  'death.shot': L('You were shot by a {who}.', 'ضربك {who} بالقرطاس.'),
  'death.melee': L('You were struck down by a {who}.', 'طيّحك {who} بالضرب.'),
  'death.hintSurvival': L(
    'Keep your guerba full (Q to drink) and carry bread (F to eat). Wells, fountains and the oasis never run dry.',
    'خلّي القربة ديما عامرة (Q باش تشرب) وهزّ معاك الخبز (F باش تاكل). البيار والسقايات والواحة عمرهم ما كينشفو.',
  ),
  'death.hintDay': L(
    'Daylight doubles how far guards can see. Crouch (C) in olive groves and scrub, or rest until night.',
    'فالنهار العساسة كيشوفو جوج مرات بعيد. تكمّش (C) وسط الزيتون والدوم، ولا رتاح حتى تطيح الليل.',
  ),
  'death.hintNight': L(
    'Break their line of sight to lose them. Gunshots alert every guard within 80 m; the khanjar is silent.',
    'غبر من قدام عينيهم باش يضيّعوك. القرطاس كيفيّق كاع العساسة فـ80 متر، والخنجر بلا حس.',
  ),
  'victory.title': L('The weapons reach the mountains', 'السلاح وصل للجبال'),
  'victory.body': L(
    'The rifles of Bir Lahmam are now in the Atlas. Tonight, in a hundred douars, people whisper the name of a fidāʾī they will never meet.',
    'مكاحل بير لحمام دابا فالأطلس. هاد الليلة، فمية دوار، الناس كيتهامسو بسمية فدائي عمرهم ما غادي يشوفوه.',
  ),
  'victory.epilogue': L(
    'History did not end in 1945. In August 1953 the French deposed and exiled Sultan Mohammed V, and the armed resistance of the fidāʾiyīn and the Army of Liberation rose across the country. The Sultan returned in November 1955, and on <b>2 March 1956</b> Morocco regained its independence.',
    'التاريخ ما وقفش فـ1945. فغشت 1953 الفرنساويين نحّاو السلطان محمد الخامس ونفاوه، وقامت المقاومة المسلحة ديال الفدائيين وجيش التحرير فكاع البلاد. السلطان رجع فنونبر 1955، ونهار <b>2 مارس 1956</b> المغرب رجع ليه الاستقلال ديالو.',
  ),
  'victory.continue': L('Keep roaming the land', 'كمّل تجوّل فالبلاد'),
  'victory.days': L('days survived', 'أيام صمدتي'),
  'victory.kills': L('enemies fallen', 'أعداء طاحو'),
  'victory.takedowns': L('silent takedowns', 'تطييحات بلا حس'),
  'victory.level': L('level', 'المستوى'),
  'victory.hunts': L('animals hunted', 'حيوانات تصيّدو'),
  'victory.places': L('places discovered', 'بلايص كتشفتيهم'),

  // ---- panel / map
  'tab.inv': L('Satchel', 'الشكارة'),
  'tab.journal': L('Journal', 'الكناش'),
  'tab.skills': L('Skills', 'المهارات'),
  'tab.close': L('Close', 'سد'),
  'tab.craft': L('Crafting', 'الصنعة'),
  'inv.gear': L('Weapons & gear', 'السلاح والعدة'),
  'inv.supplies': L('Supplies', 'الزّاد'),
  'inv.materials': L('Materials', 'المواد'),
  'inv.ammo': L('Ammunition', 'القرطاس'),
  'craft.intro': L("Combine what you scavenge. Ammunition and bandages can be made anywhere; gear needs Si Lahcen's workbench in the douar.", 'ركّب داكشي اللي جمعتي. القرطاس والفاصمات تقدر تصنعهم فأي بلاصة؛ العدة خاصها البنكة ديال سي لحسن فالدوار.'),
  'craft.atBench': L('At the workbench', 'حدا البنكة'),
  'craft.make': L('Craft', 'صنع'),
  'craft.owned': L('Already made', 'مصنوع'),
  'craft.needArtisan': L('Needs Village Artisan {n}', 'خاصك صنايعي الدوار {n}'),
  'craft.needBench': L('Needs the workbench', 'خاصك البنكة'),
  'craft.missing': L('Missing materials', 'ناقصين المواد'),
  'craft.done': L('Crafted: {what}', 'تصنع: {what}'),
  'craft.bench': L('bench', 'بنكة'),
  'journal.places': L('Places discovered', 'البلايص اللي كتشفتي'),
  'journal.unknown': L('Unexplored', 'باقي ما مشيتيش ليه'),
  'skills.rank': L('Rank {n}/{max}', 'الدرجة {n}/{max}'),
  'inv.kills': L('Enemies fallen', 'أعداء طاحو'),
  'inv.takedowns': L('Silent takedowns', 'تطييحات بلا حس'),
  'inv.days': L('Days survived', 'أيام صمدتي'),
  'journal.locked': L('The cell will tell you more when the time comes.', 'الخلية غادي تقول ليك كثر ملي يجي الوقت.'),
  'skills.points': L('You have {n} skill point(s) to spend.', 'عندك {n} نقطة مهارة تصرفها.'),
  'skills.none': L('Earn experience from missions, takedowns and survival to gain skill points.', 'جمع الخبرة من المهمات والتطييحات والصمود باش تربح نقط المهارة.'),
  'skills.learn': L('Learn', 'تعلّم'),
  'map.you': L('You', 'نتا'),
  'map.objective': L('Objective', 'الهدف'),
  'map.hideout': L('Hideout', 'المخبأ'),
  'map.foe': L('Hunting you', 'كيقلبو عليك'),
  'map.close': L('close', 'سد'),
  'map.landmark': L('Landmark', 'معلمة'),
  'map.unexplored': L('unexplored', 'ما مكتشفش'),

  // ---- loading / settings
  'load.title': L('Preparing the land…', 'كنوجدو البلاد…'),
  'load.terrain': L('Raising the Atlas', 'كنعلّيو الأطلس'),
  'load.world': L('Building douars, medina and kasbah', 'كنبنيو الدوار، المدينة والقصبة'),
  'load.veg': L('Planting olive and argan', 'كنغرسو الزيتون والأركان'),
  'load.nav': L('Tracing the paths', 'كنرسمو الطرقان'),
  'load.people': L('Waking the people', 'كنفيّقو الناس'),
  'load.ready': L('Ready', 'واجد'),
  'ui.fullscreen': L('Fullscreen', 'الشاشة كاملة'),
  'ui.fullscreenExit': L('Exit fullscreen', 'خرج من الشاشة كاملة'),
  'pause.voice': L('Voices', 'الأصوات'),
  'pause.music': L('Music', 'الموسيقى'),
  'pause.quality': L('Graphics: {q}', 'الكرافيك: {q}'),
  'quality.high': L('high', 'عالي'),
  'quality.medium': L('medium', 'متوسط'),
  'quality.low': L('low', 'خفيف'),

  // ---- messages
  'msg.start': L('Talk to Lalla Zahra in the douar.', 'هضر مع للا زهرة فالدوار.'),
  'msg.noAmmo': L('No ammunition left', 'ما بقا قرطاس'),
  'ride.mounted': L('You take the {what}. E to get off.', 'ركبتي {what}. E باش تنزل.'),
  'ride.leave': L('Get off the {what}', 'نزل من {what}'),
  'ride.drop': L('Drop the leaflets!', 'طيّح المناشير!'),
  'tab.trade': L('Trade', 'البيع والشرا'),
  'trade.purse': L('{n} francs', '{n} فرنك'),
  'trade.buy': L('Buy', 'شري'),
  'trade.sell': L('Sell', 'بيع'),
  'trade.price': L('{n} F', '{n} ف'),
  'trade.all': L('All', 'كلشي'),
  'trade.poor': L('Not enough francs.', 'ما عندكش الفلوس.'),
  'trade.honest': L('An honest stall: no powder, no cartridges, no guns.', 'حانوت نقي: لا بارود، لا قرطاس، لا سلاح.'),
  'trade.smuggler': L('A smuggler: powder, cartridges and guns from under the counter.', 'مهرّب: البارود والقرطاس والسلاح من تحت الكونطوار.'),
  'msg.boltBack': L('Bolt recovered (+{n})', 'رجّعتي السهم (+{n})'),
  'camp.noRoom': L('No room here: find flat, open ground.', 'ما كاينش البلاصة هنا: قلّب على أرض مستوية وخاوية.'),
  'craft.needOven': L('Needs a clay oven', 'خاصّو الفرّان'),
  'craft.needFire': L('Needs a fire or an oven', 'خاصّو العافية ولا الفرّان'),
  'gauge.kmh': L('km/h', 'كم/س'),
  'gauge.heading': L('Heading', 'الاتجاه'),
  'gauge.rpm': L('RPM', 'الدورات'),
  'gauge.engineOff': L('OFF', 'طافي'),
  'gauge.flaps': L('Flaps', 'الفلاپس'),
  'gauge.trim': L('Trim', 'التريم'),
  'ride.startEngine': L('N: start the engine', 'N: شعّل الموطور'),
  'ride.cockpit': L('In the cockpit', 'فالكابينة'),
  'ride.planeHelp': L(
    'MS.500 Criquet. N engine · W/S throttle · A/D rudder · Num 4/6 or ←/→ roll · Num 8/5 or ↑/↓ nose down/up · F/R flaps · T/G trim · Space brakes',
    'MS.500 كريكي. N الموطور · W/S الغاز · A/D الدفّة · Num 4/6 ولا ←/→ الميلان · Num 8/5 ولا ↑/↓ الراس لتحت/لفوق · F/R الفلاپس · T/G التريم · Space الفرانات',
  ),
  'gauge.speed': L('Speed', 'السرعة'),
  'gauge.airspeed': L('Airspeed', 'سرعة الهوا'),
  'gauge.alt': L('Altitude', 'العلو'),
  'gauge.vs': L('Climb', 'الطلوع'),
  'gauge.throttle': L('Throttle', 'الموطور'),
  'gauge.stall': L('STALL', 'غادي تطيح!'),
  'gauge.brake': L('BRAKE', 'فرامل'),
  'gauge.wind': L('Wind', 'النفس'),
  'ride.flyTo': L('Fly over the medina', 'طير فوق المدينة'),
  'death.crash': L('The plane hit the ground too hard. You died in the wreck.', 'الطيارة ضربات فالأرض بزّاف. متّي فالحطام.'),
  'msg.skinned': L('You skin the {what}.', 'سلختي {what}.'),
  'msg.boarCharge': L('A boar charges!', 'الحلوف هاجم!'),
  'xp.hunt': L('Hunted: {what}', 'صيد: {what}'),
  'xp.skin': L('Skinning', 'السلخ'),
  'xp.fell': L('Woodcutting', 'الحطّابة'),
  'xp.quarry': L('Quarrying', 'قلع الحجر'),
  'msg.noWeapon': L('You do not have the {w} yet', 'باقي ما عندكش {w}'),
  'msg.spotted': L('Spotted by a {who}!', 'شافك {who}!'),
  'msg.alarm': L(' The alarm spreads.', ' التصفار تفرّق على صحابو.'),
  'msg.takedown': L('Silent takedown · {who}', 'طيّح بلا حس · {who}'),
  'msg.drink': L('You drink deeply and fill your guerba ({n} sips).', 'شربتي مزيان وعمّرتي القربة ({n} جغمات).'),
  'msg.baking': L('The next loaves are still baking.', 'الخبز الجديد باقي كيطيب.'),
  'msg.nothing': L('Nothing of use.', 'والو، ما كاين ما يتّاخد.'),
  'msg.key': L('You take the prison key from the Khalifa.', 'خديتي ساروت الحبس من عند الخليفة.'),
  'msg.noLeaflets': L('You have no leaflets left. See Si Lahcen.', 'ما بقاو عندك مناشير. سير عند سي لحسن.'),
  'msg.locked': L("Locked tight. The Caïd's Khalifa carries the key.", 'مسدود مزيان. الساروت عند خليفة القايد.'),
  'msg.cache': L('You shoulder a crate of rifles. Get back to Douar Tifawt!', 'هزّيتي صندوق ديال المكاحل. رجع لدوار تيفاوت!'),
  'msg.noRest': L('You cannot rest while they hunt you.', 'ما تقدرش ترتاح وهوما كيقلبو عليك.'),
  'msg.sleepNight': L('You sleep until nightfall.', 'نعستي حتى طاحت الليل.'),
  'msg.sleepDawn': L('You sleep until dawn.', 'نعستي حتى طلع الفجر.'),
  'msg.emptySkin': L('Your guerba is empty. Find a well or fountain.', 'القربة خاوية. قلّب على شي بير ولا سقاية.'),
  'msg.noFood': L('You have nothing to eat.', 'ما عندك ما تاكل.'),
  'msg.noHerbs': L('No herbs. Wild thyme grows in the hills.', 'ما عندكش العشوب. الزعتر كينبت فالجبال.'),
  'msg.lost': L('You have lost them.', 'ضيّعو الأثر ديالك.'),
  'msg.leafletsGot': L('+3 Istiqlal leaflets', '+3 مناشير الاستقلال'),
  'msg.item': L('+{n} {item}', '+{n} {item}'),
  'xp.gain': L('+{n} XP · {why}', '+{n} خبرة · {why}'),
  'xp.leaflet': L('Leaflet pasted', 'تلصق المنشور'),
  'xp.pole': L('Telegraph line cut', 'تقطع خط التيليغراف'),
  'xp.prison': L('Prisoners freed', 'تسرّحو المحابسية'),
  'xp.headshot': L('Headshot · {who}', 'فالراس · {who}'),
  'xp.down': L('{who} down', 'طاح {who}'),
  'xp.mission': L('Mission complete: {m}', 'المهمة تقضات: {m}'),
  'xp.craft': L('Crafting', 'الصنعة'),
  'xp.discover': L('New place discovered', 'بلاصة جديدة'),
  'banner.levelUp': L('Level up', 'طلعتي فالمستوى'),
  'banner.level': L('Level {n}', 'المستوى {n}'),
  'banner.levelHint': L('Open Tab → Skills to learn a new skill', 'حل Tab ← المهارات باش تتعلم مهارة جديدة'),
  'banner.missionDone': L('Mission complete', 'المهمة تقضات'),
  'banner.newMission': L('New mission', 'مهمة جديدة'),
  'banner.newWeapon': L('New weapon', 'سلاح جديد'),
  'banner.weaponHint': L('Press {n} to equip', 'ورك {n} باش تهزّو'),
  'banner.discovered': L('Discovered', 'كتشفتي'),
  'banner.start': L('Douar Tifawt · 1945', 'دوار تيفاوت · 1945'),
  'mission.free': L('Free roam: the struggle continues', 'تجوّل بحرّيتك: النضال مازال'),
  'prompt.talk': L('Talk to {who}', 'هضر مع {who}'),
  'prompt.searchBody': L('Search the {who}', 'فتّش {who}'),
} satisfies Record<string, Text>;

export type StringKey = keyof typeof STRINGS;
