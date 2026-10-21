import { L, type Text } from '../i18n';
import type { ItemId, LootBundle } from './types';

export type ItemKind = 'food' | 'medical' | 'ammo' | 'material' | 'quest' | 'money';

export const ITEMS: Record<ItemId, { name: Text; desc: Text; icon: string; kind: ItemKind }> = {
  francs: { name: L('Francs', 'الفرنك'), desc: L('Protectorate francs: buy and sell in the souk', 'فرنك الحماية: بيع وشري فالسوق'), icon: 'coin', kind: 'money' },
  flour: { name: L('Flour', 'الطحين'), desc: L('Bake khobz in a clay oven', 'طيّب بيه الخبز فالفرّان'), icon: 'flour', kind: 'material' },
  tagine: { name: L('Tagine', 'الطاجين'), desc: L('Eat: +80 hunger and heals 25', 'كول: +80 شبعة وكيداوي 25'), icon: 'tagine', kind: 'food' },
  tea: { name: L('Mint tea', 'أتاي بالنعناع'), desc: L('Drink: +40 thirst, stamina restored', 'شرب: +40 ريق، والنفس كيرجع'), icon: 'tea', kind: 'food' },
  driedMeat: { name: L('Dried meat (khlii)', 'الخليع'), desc: L('Eat: +35 hunger. Keeps for the road.', 'كول: +35 شبعة. كيصبر فالطريق.'), icon: 'jerky', kind: 'food' },
  bread: { name: L('Khobz (bread)', 'الخبز'), desc: L('Eat: +40 hunger', 'كول: +40 شبعة'), icon: 'bread', kind: 'food' },
  dates: { name: L('Dates', 'التمر'), desc: L('Eat: +18 hunger, +6 thirst', 'كول: +18 شبعة، +6 ريق'), icon: 'dates', kind: 'food' },
  water: { name: L('Guerba (water skin)', 'القربة'), desc: L('Drink: +35 thirst per sip', 'شرب: +35 فكل جغمة'), icon: 'water', kind: 'food' },
  herbs: { name: L('Wild thyme', 'الزعتر'), desc: L('Heals 35 over a few seconds', 'كيداوي 35 فشوية ديال الثواني'), icon: 'herbs', kind: 'medical' },
  bandage: { name: L('Bandage', 'الفاصمة'), desc: L('Heals 60 at once (H)', 'كتداوي 60 دقة وحدة (H)'), icon: 'bandage', kind: 'medical' },
  ammo: { name: L('Rifle cartridges', 'قرطاس الفيزي'), desc: L('8 mm Lebel rounds', 'قرطاس لوبيل 8 ملم'), icon: 'ammo', kind: 'ammo' },
  pistolAmmo: { name: L('Pistol rounds', 'قرطاس الفردي'), desc: L('7.65 mm: pistol and MAS-38', '7.65 ملم: الفردي والميتراييت'), icon: 'pammo', kind: 'ammo' },
  shot: { name: L('Musket charges', 'حشوات المكحلة'), desc: L('Powder and lead shot for the moukahla', 'البارود والرصاص ديال المكحلة'), icon: 'shot', kind: 'ammo' },
  arrow: { name: L('Arrows', 'النبال'), desc: L('Reed shafts, iron heads, vulture fletching', 'قصب براس ديال الحديد وريش النسر'), icon: 'arrow', kind: 'ammo' },
  bolt: { name: L('Crossbow bolts', 'سهام الأرباليط'), desc: L('Olive-wood shafts with iron heads', 'عصي الزيتون براس ديال الحديد'), icon: 'bolt', kind: 'ammo' },
  scrap: { name: L('Scrap metal', 'الخردة'), desc: L('Nails, wire, brass: for crafting', 'مسامر، سلك، نحاس: للصنعة'), icon: 'scrap', kind: 'material' },
  cloth: { name: L('Cloth', 'الثوب'), desc: L('Rags and wool: for crafting', 'شراوط وصوف: للصنعة'), icon: 'cloth', kind: 'material' },
  wood: { name: L('Wood', 'الحطب'), desc: L('Olive and argan wood: for crafting', 'حطب الزيتون والأركان: للصنعة'), icon: 'wood', kind: 'material' },
  powder: { name: L('Gunpowder', 'البارود'), desc: L('Black powder: for ammunition', 'البارود الكحل: للقرطاس'), icon: 'powder', kind: 'material' },
  rawMeat: { name: L('Raw meat', 'اللحم النيّ'), desc: L('Eat: +15 hunger. Better grilled (K).', 'كول: +15 شبعة. حسن مشوي (K).'), icon: 'meat', kind: 'food' },
  cookedMeat: { name: L('Grilled meat', 'اللحم المشوي'), desc: L('Eat: +50 hunger', 'كول: +50 شبعة'), icon: 'cooked', kind: 'food' },
  hide: { name: L('Hide', 'الجلد'), desc: L('Skinned from game: slings, vests, gun slings', 'مسلوخ من الصيد: مقلاع، صدرية، حمّالة'), icon: 'hide', kind: 'material' },
  bone: { name: L('Bone', 'العظم'), desc: L('Handles and tools', 'للمقابض والعدة'), icon: 'bone', kind: 'material' },
  sinew: { name: L('Sinew', 'العصب'), desc: L('Strong cord for binding', 'خيط قوي للربط'), icon: 'sinew', kind: 'material' },
  stone: { name: L('Stone', 'الحجر'), desc: L('Quarried with a hammer: furnace linings, whetstones', 'مقلوع بالمطرقة: للكوشة والمسنّ'), icon: 'stone', kind: 'material' },
  ore: { name: L('Lead ore', 'معدن الرصاص'), desc: L('Galena from the hills: smelt it for scrap and shot', 'معدن من الجبال: ذوّبو للخردة والرصاص'), icon: 'ore', kind: 'material' },
  leaflet: { name: L('Istiqlal leaflets', 'مناشير الاستقلال'), desc: L('Manifesto tracts to paste in the medina', 'منشورات الوثيقة باش تلصقهم فالمدينة'), icon: 'leaflet', kind: 'quest' },
  key: { name: L('Prison key', 'ساروت الحبس'), desc: L("Taken from the Caïd's Khalifa", 'خديتيه من خليفة القايد'), icon: 'key', kind: 'quest' },
};

export const emptyInventory = (): Record<ItemId, number> => ({
  francs: 0, flour: 0, tagine: 0, tea: 0, driedMeat: 0,
  bread: 0, dates: 0, herbs: 0, water: 0, bandage: 0, ammo: 0, pistolAmmo: 0, shot: 0, bolt: 0, arrow: 0, scrap: 0, cloth: 0, wood: 0, powder: 0,
  rawMeat: 0, cookedMeat: 0, hide: 0, bone: 0, sinew: 0, stone: 0, ore: 0, leaflet: 0, key: 0,
});

// ------------------------------------------------------------------ weapons

export type WeaponId = 'blade' | 'rifle' | 'pistol' | 'musket' | 'smg' | 'sling' | 'shotgun' | 'crossbow' | 'bow';
export type AmmoId = 'ammo' | 'pistolAmmo' | 'shot' | 'bolt' | 'arrow';

export type GunDef = {
  ammo: AmmoId;
  clip: number;
  reload: number;
  /** seconds between shots */
  interval: number;
  /** hold to keep firing */
  auto: boolean;
  damage: number;
  headMul: number;
  range: number;
  pellets: number;
  spreadHip: number;
  spreadAim: number;
  /** radius in metres in which guards hear the shot */
  noise: number;
  trauma: number;
  fov: number;
  pistolPose: boolean;
  /** stones from the ground: never runs out */
  infinite?: boolean;
};

export type WeaponDef = { slot: number; name: Text; icon: string; gun?: GunDef };

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  blade: { slot: 1, name: L('Khanjar', 'الخنجر'), icon: 'blade' },
  rifle: {
    slot: 2,
    name: L('Lebel rifle', 'فيزي لوبيل'),
    icon: 'rifle',
    gun: { ammo: 'ammo', clip: 5, reload: 2.3, interval: 1.05, auto: false, damage: 72, headMul: 2.8, range: 220, pellets: 1, spreadHip: 0.05, spreadAim: 0.004, noise: 80, trauma: 0.32, fov: 2.4, pistolPose: false },
  },
  pistol: {
    slot: 3,
    name: L('Ruby pistol', 'فردي روبي'),
    icon: 'pistol',
    gun: { ammo: 'pistolAmmo', clip: 9, reload: 1.5, interval: 0.3, auto: false, damage: 36, headMul: 2.6, range: 70, pellets: 1, spreadHip: 0.03, spreadAim: 0.012, noise: 42, trauma: 0.16, fov: 1.2, pistolPose: true },
  },
  musket: {
    slot: 4,
    name: L('Moukahla (musket)', 'المكحلة'),
    icon: 'musket',
    gun: { ammo: 'shot', clip: 1, reload: 3.0, interval: 0.6, auto: false, damage: 24, headMul: 1.6, range: 38, pellets: 8, spreadHip: 0.085, spreadAim: 0.06, noise: 95, trauma: 0.55, fov: 4, pistolPose: false },
  },
  smg: {
    slot: 5,
    name: L('MAS-38 submachine gun', 'ميتراييت MAS-38'),
    icon: 'smg',
    gun: { ammo: 'pistolAmmo', clip: 32, reload: 2.6, interval: 0.105, auto: true, damage: 22, headMul: 2.2, range: 85, pellets: 1, spreadHip: 0.055, spreadAim: 0.022, noise: 85, trauma: 0.12, fov: 0.7, pistolPose: false },
  },
  sling: {
    slot: 6,
    name: L("Shepherd's sling", 'المقلاع'),
    icon: 'sling',
    gun: { ammo: 'ammo', infinite: true, clip: 1, reload: 0.8, interval: 0.35, auto: false, damage: 32, headMul: 2, range: 45, pellets: 1, spreadHip: 0.04, spreadAim: 0.014, noise: 5, trauma: 0.04, fov: 0.3, pistolPose: true },
  },
  shotgun: {
    slot: 7,
    name: L('Hunting shotgun', 'فيزي الصيد'),
    icon: 'shotgun',
    gun: { ammo: 'shot', clip: 2, reload: 2.2, interval: 0.32, auto: false, damage: 21, headMul: 1.5, range: 48, pellets: 9, spreadHip: 0.075, spreadAim: 0.05, noise: 85, trauma: 0.42, fov: 3.2, pistolPose: false },
  },
  crossbow: {
    slot: 8,
    name: L('Crossbow', 'الأرباليط'),
    icon: 'crossbow',
    // one heavy bolt, slow to span, almost silent: the hunter's and the sentry-killer's weapon
    gun: { ammo: 'bolt', clip: 1, reload: 1.9, interval: 0.5, auto: false, damage: 80, headMul: 2.6, range: 120, pellets: 1, spreadHip: 0.035, spreadAim: 0.003, noise: 8, trauma: 0.08, fov: 0.8, pistolPose: false },
  },
  bow: {
    slot: 9,
    name: L('Recurve bow', 'القوس'),
    icon: 'bow',
    // horn-and-sinew horse bow: quick to nock, lighter hit than the crossbow, the quietest weapon there is
    gun: { ammo: 'arrow', clip: 1, reload: 0.8, interval: 0.35, auto: false, damage: 55, headMul: 2.4, range: 95, pellets: 1, spreadHip: 0.04, spreadAim: 0.006, noise: 4, trauma: 0.05, fov: 0.6, pistolPose: false },
  },
};

export const WEAPON_ORDER: WeaponId[] = ['blade', 'rifle', 'pistol', 'musket', 'smg', 'sling', 'shotgun', 'crossbow', 'bow'];

// ------------------------------------------------------------------ crafting

export type Recipe = {
  id: string;
  name: Text;
  desc: Text;
  cost: LootBundle;
  /** items produced (scaled by the Artisan skill when `ammo`) */
  gives?: LootBundle;
  /** one-time crafts: weapons and gear */
  weapon?: WeaponId;
  upgrade?: Upgrade;
  /** requires the workbench in Si Lahcen's house */
  bench: boolean;
  /** minimum Artisan rank */
  artisan?: number;
  /** cooked at a clay oven or over a fire (yours at a camp, or the douar's oven) */
  station?: 'oven' | 'fire';
  /** builds a camp structure in front of you */
  build?: CampKind;
};

/** What you can set up at a camp. */
export type CampKind = 'bench' | 'oven' | 'fire' | 'tent';

export type Upgrade = 'bigSkin' | 'sharpBlade' | 'hillCloak' | 'satchel' | 'skinningKnife' | 'hideVest' | 'axe' | 'hammer';

export const RECIPES: Recipe[] = [
  { id: 'bandage', name: L('Bandage', 'فاصمة'), desc: L('Cloth and thyme bound tight. Heals 60.', 'ثوب وزعتر مشدودين. كتداوي 60.'), cost: { cloth: 1, herbs: 1 }, gives: { bandage: 1 }, bench: false },
  { id: 'rifle-ammo', name: L('Rifle cartridges ×3', 'قرطاس الفيزي ×3'), desc: L('Reload spent brass with powder.', 'عمّر النحاس الخاوي بالبارود.'), cost: { powder: 1, scrap: 1 }, gives: { ammo: 3 }, bench: false },
  { id: 'pistol-ammo', name: L('Pistol rounds ×6', 'قرطاس الفردي ×6'), desc: L('For the Ruby and the MAS-38.', 'للفردي وللميتراييت.'), cost: { powder: 1, scrap: 1 }, gives: { pistolAmmo: 6 }, bench: false },
  { id: 'shot', name: L('Musket charges ×3', 'حشوات المكحلة ×3'), desc: L('Powder, wadding and lead shot.', 'بارود، حشوة ورصاص.'), cost: { powder: 1, scrap: 1, cloth: 1 }, gives: { shot: 3 }, bench: false },
  { id: 'musket', name: L('Restore the moukahla', 'صلّح المكحلة'), desc: L("A grandfather's musket: wild spread, terrible at close range.", 'مكحلة الجد: كتفرّق الرصاص، قاتلة من قريب.'), cost: { wood: 3, scrap: 3, cloth: 1 }, weapon: 'musket', gives: { shot: 3 }, bench: true },
  { id: 'sharp', name: L('Whetted khanjar', 'خنجر مسنون'), desc: L('Khanjar strikes deal +60% damage.', 'ضربات الخنجر +60% قوة.'), cost: { scrap: 2, wood: 1 }, upgrade: 'sharpBlade', bench: true },
  { id: 'skin', name: L('Large guerba', 'قربة كبيرة'), desc: L('The water skin holds 7 sips instead of 4.', 'القربة كتهز 7 جغمات بلاصت 4.'), cost: { cloth: 3, wood: 1 }, upgrade: 'bigSkin', bench: true },
  { id: 'cloak', name: L('Hill-coloured cloak', 'سلهام بلون الجبل'), desc: L('Guards notice you 15% later.', 'العساسة كيشوفوك 15% معطّل.'), cost: { cloth: 4, herbs: 2 }, upgrade: 'hillCloak', bench: true, artisan: 1 },
  { id: 'axe', name: L("Woodcutter's axe", 'الشاقور'), desc: L('Fell olive, argan and palm trees for wood (and dates).', 'قطع الزيتون والأركان والنخل باش تجيب الحطب (والتمر).'), cost: { wood: 2, scrap: 2, cloth: 1 }, upgrade: 'axe', bench: true },
  { id: 'hammer', name: L("Quarryman's hammer", 'مطرقة الحجّار'), desc: L('Break rocks for stone and lead ore, richest near the old mine.', 'هرّس الحجر باش تجيب الحجر ومعدن الرصاص، كثر حدا المعدن القديم.'), cost: { wood: 1, scrap: 3 }, upgrade: 'hammer', bench: true },
  { id: 'smelt', name: L('Smelt ore into scrap ×3', 'ذوّب المعدن: خردة ×3'), desc: L('A stone-lined charcoal fire turns galena into usable metal.', 'نار الفاخر بين الحجر كتردّ المعدن حديد صالح.'), cost: { ore: 2, wood: 2, stone: 1 }, gives: { scrap: 3 }, bench: true },
  { id: 'lead', name: L('Cast lead shot ×4', 'صبّ الرصاص ×4'), desc: L('Melt galena into buckshot charges for the musket and shotgun.', 'ذوّب المعدن رش للمكحلة وفيزي الصيد.'), cost: { ore: 1, powder: 1 }, gives: { shot: 4 }, bench: false },
  { id: 'whet', name: L('Whetstone edge', 'سنّ بالمسنّ'), desc: L('Khanjar strikes deal +60% damage (stone instead of scrap).', 'ضربات الخنجر +60% (بالحجر بلاصت الخردة).'), cost: { stone: 2, sinew: 1 }, upgrade: 'sharpBlade', bench: false },
  { id: 'grill', name: L('Grilled meat', 'لحم مشوي'), desc: L('Brochettes over a wood fire: +50 hunger instead of 15.', 'قطبان على نار الحطب: +50 شبعة بلاصت 15.'), cost: { rawMeat: 1, wood: 1 }, gives: { cookedMeat: 1 }, bench: false },
  { id: 'sling', name: L("Shepherd's sling", 'المقلاع'), desc: L('Silent stones that never run out. Enough for hares, a sting for men.', 'حجر بلا حس وما كيساليش. كافي للأرانب، وقرصة للرجال.'), cost: { hide: 1, sinew: 2 }, weapon: 'sling', bench: false },
  { id: 'knife', name: L('Bone skinning knife', 'موس السلخ'), desc: L('Skin twice as fast and take more hide and meat.', 'سلخ جوج مرات أسرع وخود جلد ولحم كثر.'), cost: { bone: 2, scrap: 1, sinew: 1 }, upgrade: 'skinningKnife', bench: false },
  { id: 'vest', name: L('Boar-hide vest', 'صدرية من جلد الحلوف'), desc: L('Thick hide under the djellaba: 20% less damage.', 'جلد غليظ تحت الجلابة: 20% ضرر أقل.'), cost: { hide: 3, sinew: 2, bone: 1 }, upgrade: 'hideVest', bench: true },
  { id: 'shotgun', name: L('Restore the hunting shotgun', 'صلّح فيزي الصيد'), desc: L('Two barrels of buckshot: brutal up close, good for boar.', 'جوج فواهي ديال الرش: قاسح من قريب، مزيان للحلوف.'), cost: { scrap: 4, wood: 2, hide: 1, bone: 2 }, weapon: 'shotgun', gives: { shot: 4 }, bench: true, artisan: 1 },
  { id: 'crossbow', name: L('Build a crossbow', 'صنع الأرباليط'), desc: L('Olive stock, a steel bow from a cart spring, sinew string. Silent and deadly at range.', 'قاعدة زيتون، قوس من ريسور الكرّوسة، وتر من العصب. بلا حس وقاتل من بعيد.'), cost: { wood: 3, scrap: 3, sinew: 2, bone: 1 }, weapon: 'crossbow', gives: { bolt: 6 }, bench: true, artisan: 1 },
  { id: 'bolts', name: L('Crossbow bolts ×4', 'سهام الأرباليط ×4'), desc: L('Whittled shafts with hammered iron heads.', 'عصي منجورة براس ديال الحديد المضروب.'), cost: { wood: 1, scrap: 1 }, gives: { bolt: 4 }, bench: false },
  { id: 'bow', name: L('Make a recurve bow', 'صنع القوس'), desc: L('Wood core, horn belly, sinew back, a bone grip: the old horse bow. Quick, silent, arrows you can fetch back.', 'قلب ديال الخشب، قرن، عصب، ومقبض ديال العظم: القوس القديم. سريع، بلا حس، والنبال كترجعهم.'), cost: { wood: 2, bone: 2, sinew: 3, hide: 1 }, weapon: 'bow', gives: { arrow: 8 }, bench: true },
  { id: 'arrows', name: L('Arrows ×6', 'النبال ×6'), desc: L('Reed shafts, iron points, feathers.', 'قصب، روس ديال الحديد، وريش.'), cost: { wood: 1, scrap: 1 }, gives: { arrow: 6 }, bench: false },
  // ---- camp: build anywhere, in front of you
  { id: 'camp-fire', name: L('Campfire', 'العافية'), desc: L('A ring of stones: grill, brew tea, dry meat. Lights the night.', 'دورة ديال الحجر: شوي، طيّب أتاي، نشّف اللحم. كتضوّي فالليل.'), cost: { wood: 3, stone: 3 }, build: 'fire', bench: false },
  { id: 'camp-oven', name: L('Clay oven (tannour)', 'الفرّان ديال الطين'), desc: L('Bake bread from flour, simmer a tagine.', 'طيّب الخبز من الطحين، والطاجين.'), cost: { stone: 6, wood: 2, cloth: 1 }, build: 'oven', bench: false },
  { id: 'camp-bench', name: L('Camp workbench', 'بنكة الخيمة'), desc: L('A plank table with tools: workbench recipes at your camp.', 'طبلة ديال اللوح بالعدة: صنعة البنكة فالمخيّم ديالك.'), cost: { wood: 5, scrap: 2 }, build: 'bench', bench: false },
  { id: 'camp-tent', name: L('Khaima (tent)', 'الخيمة'), desc: L('Sleep until dawn or dusk; the game saves.', 'نعس حتى للفجر ولا للمغرب؛ اللعبة كتسجّل.'), cost: { cloth: 4, hide: 2, wood: 3 }, build: 'tent', bench: false },
  // ---- cooking at a camp
  { id: 'khobz', name: L('Bake khobz ×3', 'طيّب الخبز ×3'), desc: L('Flour, water and an hour in the oven.', 'الطحين، الما وساعة فالفرّان.'), cost: { flour: 2, wood: 1, water: 1 }, gives: { bread: 3 }, bench: false, station: 'oven' },
  { id: 'tagine', name: L('Meat tagine', 'طاجين باللحم'), desc: L('Slow-cooked meat and thyme: +80 hunger, heals 25.', 'لحم وزعتر على خاطرو: +80 شبعة، كيداوي 25.'), cost: { rawMeat: 2, herbs: 1, water: 1 }, gives: { tagine: 1 }, bench: false, station: 'oven' },
  { id: 'tea', name: L('Mint tea ×2', 'أتاي ×2'), desc: L('Thyme and wild mint brewed strong: thirst and stamina.', 'زعتر ونعناع بلدي: للريق وللنفس.'), cost: { herbs: 1, water: 1 }, gives: { tea: 2 }, bench: false, station: 'fire' },
  { id: 'khlii', name: L('Dry meat (khlii) ×2', 'نشّف الخليع ×2'), desc: L('Smoked over the fire, it keeps for the road.', 'مدخّن على العافية، كيصبر فالطريق.'), cost: { rawMeat: 2, wood: 1 }, gives: { driedMeat: 2 }, bench: false, station: 'fire' },
  { id: 'satchel', name: L('Smuggler satchel', 'شكارة المهرّب'), desc: L('Scavenge one extra material from every search.', 'زيد مادة وحدة من كل تفتيش.'), cost: { cloth: 3, scrap: 2, wood: 1 }, upgrade: 'satchel', bench: true, artisan: 2 },
];

export const UPGRADE_NAMES: Record<Upgrade, Text> = {
  bigSkin: L('Large guerba', 'قربة كبيرة'),
  sharpBlade: L('Whetted khanjar', 'خنجر مسنون'),
  hillCloak: L('Hill-coloured cloak', 'سلهام بلون الجبل'),
  satchel: L('Smuggler satchel', 'شكارة المهرّب'),
  skinningKnife: L('Bone skinning knife', 'موس السلخ'),
  hideVest: L('Boar-hide vest', 'صدرية من جلد الحلوف'),
  axe: L("Woodcutter's axe", 'الشاقور'),
  hammer: L("Quarryman's hammer", 'مطرقة الحجّار'),
};

// ------------------------------------------------------------------ skills

export type Skill = 'stealth' | 'marksman' | 'endurance' | 'scavenger' | 'artisan' | 'survivalist' | 'hunter';
export const SKILL_MAX = 5;

export const SKILLS: Record<Skill, { name: Text; desc: Text }> = {
  stealth: { name: L('Shadow of the Medina', 'ظل المدينة'), desc: L('Guards notice you 9% later per rank. Rank 3: silent sprint steps.', 'العساسة كيشوفوك 9% معطّل فكل درجة. الدرجة 3: الجري بلا حس.') },
  marksman: { name: L('Mountain Marksman', 'نيشان الجبل'), desc: L('Steadier aim, +12% gun damage and faster reloads per rank.', 'نيشان ثابت، +12% قوة القرطاس وتعمار أسرع فكل درجة.') },
  endurance: { name: L('Atlas Endurance', 'صبر الأطلس'), desc: L('+15 max health and +20 stamina per rank.', '+15 صحة و+20 نفس فكل درجة.') },
  scavenger: { name: L('Souk Scavenger', 'بحّاث السوق'), desc: L('30% chance per rank to find extra materials and ammo when searching.', '30% فكل درجة باش تلقى مواد وقرطاس زايدين ملي تفتّش.') },
  artisan: { name: L('Village Artisan', 'صنايعي الدوار'), desc: L('Crafted ammunition yields +1 per rank; unlocks advanced recipes.', 'القرطاس اللي كتصنع كيزيد +1 فكل درجة؛ كيحل وصفات جديدة.') },
  hunter: { name: L('Atlas Hunter', 'صيّاد الأطلس'), desc: L('Game notices you 8% later per rank; +20% damage to animals and more meat per carcass.', 'الصيد كيحس بيك 8% معطّل فكل درجة؛ +20% ضرر على الحيوانات ولحم كثر.') },
  survivalist: { name: L('Son of the Land', 'ولد البلاد'), desc: L('Hunger and thirst fall 12% slower per rank; food restores more.', 'الجوع والعطش كينقصو 12% بشوية فكل درجة؛ الماكلة كتشبّع كثر.') },
};

export const SKILL_ORDER: Skill[] = ['stealth', 'marksman', 'endurance', 'scavenger', 'artisan', 'survivalist', 'hunter'];
