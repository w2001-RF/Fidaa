# FIDĀʾĪ — Morocco 1945 (فدائي)

A third-person survival open-world RPG in Three.js. Morocco, autumn 1945, under the French Protectorate. You are Driss, a young fidāʾī of a clandestine nationalist cell. You live off the land between your douar, the medina of Tadwart, the Caïd's kasbah and the French garrison of Bir Lahmam. You fight the French soldiers and the collaborating Makhzen's mokhaznis and officers.

Playable in **English** and **Moroccan Darija** (Arabic script, right-to-left), switchable on the title screen or the pause menu.

All places and characters are fictional. The historical frame, from the Manifesto of Independence (11 January 1944) to independence on 2 March 1956, is real.

## Run

```bash
npm install
npm run dev        # http://127.0.0.1:5188
npm run build      # production build in dist/ (relative base, any static host)
npm run preview    # http://127.0.0.1:4188
```

Click **Begin the struggle**, then click the game view to capture the mouse. **Fullscreen**: the button on the title screen or the pause menu, or Alt+Enter.

## Controls
| Key | Action |
| --- | --- |
| W A S D / mouse | move / look |
| Shift · C · Space | sprint · crouch (sneak) · jump |
| V · B (hold) | first-person / third-person view · look behind |
| LMB · RMB · R | strike or fire (hold for the MAS-38) · aim · reload |
| 1 – 9 / wheel | khanjar · Lebel rifle · Ruby pistol · moukahla musket · MAS-38 · shepherd's sling · hunting shotgun · crossbow · recurve bow |
| E (hold) | interact: drink, take bread, search, gather, paste leaflets, cut wires, unlock. Behind an unaware guard: silent takedown |
| Q · F · H | drink from the water skin · eat · heal (bandage or thyme) |
| Tab / I · K · J · M · Esc | satchel · crafting · journal · map · pause (and save) |
| Riding / driving | E to get on and off · W accelerate · S brake (press again to reverse) · A/D steer · Shift gallop (uses the mount's wind) · Space handbrake (jeep) |
| Flying (MS.500 Criquet, GTA-style) | N engine on/off · W/S throttle · A/D rudder (and tailwheel) · Num 4/6 or ←/→ roll · Num 8/5 or ↑/↓ nose down/up · F/R flaps down/up (0°, 15°, 30°, 40°) · T/G trim nose-up/down · Space wheel brakes · E drop leaflets over the medina · move the mouse to look, leave it and the camera swings back behind the tail |

## How it plays
- **Survive.** Hunger and thirst fall all the time. Refill at wells, fountains and the oasis pond, take bread from the douar oven, search jars, crates, shrines and fallen enemies, and gather thyme, deadwood and scrap in the wilds.
- **Loot and craft.** Searches give scrap, cloth, wood and gunpowder. Make bandages and ammunition anywhere (K). At Si Lahcen's workbench, restore the moukahla and make gear: a whetted khanjar, a large guerba, a hill-coloured cloak and a smuggler's satchel.
- **Fight.** Five weapons, each with its own magazine. The khanjar is silent. The pistol and the MAS-38 share 7.65 mm rounds. The musket throws a scatter of lead. Find the pistol in the Khalifa's strongbox and the MAS-38 on the garrison's rack.
- **Stay unseen.** Guards have vision cones and fill a detection meter (? → !). Daylight doubles their sight. Crouch in olive groves and scrub. Whistles alert guards within 34 m, gunshots within 40–95 m depending on the weapon.
- **Grow.** XP from missions, takedowns, crafting and discoveries. Six skills with five ranks each: Stealth, Marksmanship, Endurance, Scavenger, Artisan, Survivalist.
- **Hunt.** Dorcas gazelle herds and hares flee from you; wild boars charge when wounded or cornered. Crouch to get close and shoot or stab, then hold E on the carcass to skin it for raw meat, hide, bone and sinew. Grill the meat, and make a sling, a bone skinning knife, a boar-hide vest, or restore a double-barrel hunting shotgun. At the bench, build a crossbow: an almost silent bolt that drops a sentry or a gazelle at range. Bolts are whittled from wood and scrap. Or make the old horn-and-sinew recurve bow (wood, bone, sinew, hide): quicker to nock and quieter than the crossbow, with a lighter hit; arrows are made from wood and scrap too.
- **Bolts and arrows come back.** A bolt or arrow stays where it struck: in the dirt, in a wall, or lying by the man or beast it hit. Walk over it to pick it up. About one in six snaps.
- **Trade.** Money is Protectorate francs. You start with 40 and find more on fallen soldiers (officers carry more). Every merchant in the souk buys and sells food, medicine, materials and tools; you sell your hides, ore and meat and buy bread, flour, tools and guns. The souk's first merchant and the nomad trader at the camp are smugglers and also deal in powder, cartridges, the musket, the shotgun and the Ruby pistol. Each Scavenger rank buys 4% cheaper and sells 6% dearer. Talk to a merchant (E) to open their stall.
- **Camping.** From the crafting menu (K), build a camp anywhere flat and open: a campfire (tea, dried meat), a clay tannour oven (bread from flour, meat tagine), a workbench that works like Si Lahcen's, and a black goat-hair khaima where you sleep until dawn or dusk and the game saves. Camps are saved with the game.
- **Cut and quarry.** Craft a woodcutter's axe and a quarryman's hammer at the bench. Fell olive, argan and palm trees for wood (palms give dates), and break rocks for stone and lead ore, which is richest near the old mine. Smelt the ore into scrap or cast lead shot.
- **Ride and drive.** A donkey at the douar, a mule at the oasis, the Caïd's Barb horse in the kasbah stables, a camel at the nomad camp, the garrison's Willys jeep (it runs down whatever stands in its way), a fishing boat on the Middle Atlas lake, and the train that shuttles between the two halts of the northern line.
- **Handling.** The jeep has inertia, brakes and a handbrake, front wheels that steer, grip that is lower off the road (push too hard and it runs wide or slides), and it slows climbing and speeds up going downhill. Mounts pivot at a walk but need room at a gallop, and tire when galloping. The boat rows in strokes, carries its way and drifts in turns. The speedometer is at the bottom of the screen.
- **Flying.** The garrison's plane is a Morane-Saulnier MS.500 Criquet, the French-built Fieseler Storch that the French army flew in 1945 (Argus 240 hp, 2,050 rpm), flown with its real figures: 175 km/h flat out, 150 km/h cruise at about 65% power, stall at 67 km/h clean and 50 km/h with 40° of flap, a 4.8 m/s climb, a take-off run of about 50 m and a landing roll of a few dozen metres. The model covers lift with a stall at 17° (fixed slats), flaps, induced and parasite drag, a propeller whose thrust fades with speed, ground effect, banked turns, sideslip from the rudder, dihedral, adverse yaw, a wing that drops in a stall, pitch stability toward the trimmed angle (pitch sets the speed, throttle sets the climb), and a taildragger on the ground: tail-down, tailwheel steering, wheel brakes that can pivot her or tip her onto her nose. To take off: N, one notch of flap (F), trim nose-up (T), full throttle (W); she lifts off by herself, then hold 5 to climb. To land: full flap, about 60 km/h, a gentle sink (under 3.5 m/s), wings level, then Space to brake. The instruments show airspeed, altitude, climb, heading, rpm, throttle, flaps and trim, with a stall warning.
- **Airstrips.** The garrison's strip west of the post, and a 120 m field strip just east of Douar Tifawt with a windsock, edge flags, threshold stones and a mechanic's shelter. Mission 6 ends with a landing on it.
- **Collision.** Walls, houses, trees, cactus, rocks, jars, crates, barrels, stall posts and hanging rugs are solid, as are people, animals and parked vehicles. Low stones are stepped over. Bullets stop on trunks and rocks. A felled tree or broken rock stops blocking.
- **The lands beyond the passes.** The valley is only where it starts. Three passes cut through the mountain ring (north, east and west-south-west, each with a mule track), and beyond them the land goes on for kilometres, generated as you go: every new game draws new lands from a fresh seed, built in 80 m chunks a few milliseconds per frame as you approach, with a coarse horizon out to the haze. Four kinds of ground (ochre steppe with argan and alfa, pale erg dunes, green highland groves of olive and argan, red badlands of rock) each have their own resources: trees to fell, rocks to quarry (the badlands are rich in lead ore), deadwood, thyme and scrap to gather, and game that drifts in from far away (gazelles on the steppe, boars in the hills, hares everywhere). Scattered across them are places to find, each named in Amazigh and Arabic: villages with a well, a bread oven, storage jars and a grocer to trade with; ruined ksour with arms chests (sometimes a musket); whitewashed shrines where you can rest; nomad camps whose trader deals under the counter; palm-ringed springs; and caves to sleep in. Finding one gives a banner and XP, and the region map (M, then *The lands*) fills in as you explore. The save keeps the world's seed, felled trees and searched jars. Past about 1.6 km the great erg turns you back.
- **Explore.** The map starts under fog. Nine landmarks wait in the wilds (Roman ruins, a shepherds' cave, a nomad camp, a lead mine, an olive press, an ambushed convoy, an Atlas lookout, a fidāʾiyīn hideaway, a ruined ksar), each with loot and XP.
- **Missions.** (1) Bread and Water; (2) Words of Freedom; (3) Cut the Wires; (4) The Caïd's Prison; (5) Guns for the Mountains; (6) Wings over Tadwart: steal the garrison's liaison plane, drop leaflets over the medina from the air, and land near the douar.
- **Saving.** Progress autosaves to IndexedDB on every mission step, every minute, on pause and when the tab is hidden. If IndexedDB is blocked, the save falls back to a cookie without the map fog. Pause → Save the game saves on demand; **Continue the struggle** on the title screen resumes.
- **Music and voices.** Five original procedural songs change with the situation: oud in Hijaz by day, a Gnawa road song, a ney in Bayati at night, darbuka in combat, and a victory song with a zaghrouda. Characters speak through the browser's speech engine, with a synthesized murmur when no voice exists for the language. Guards shout in French or Darija.

## Generated hero model

The player's fidāʾī is a Tripo-generated character (`public/assets/characters/fidai/fidai.glb`, listed in `public/assets/characters/manifest.json`): 11,776 triangles, 1024 px textures, idle and walk clips, 1.4 MB. He stands and walks in place of the procedural figure and carries the weapon in hand (khanjar, pistol, sling) or slung across his back (long guns, the bow); the procedural rig, which has the poses the generated character lacks, takes over to aim, fire, reload, crouch, fight with the knife, ride, carry, die and in first person. Without the manifest the game uses the procedural figure throughout.

It was made from Tripo's rigged model and its retargeted idle and walk FBX files (1.39 M triangles, three 4096 px textures and 60 MB a piece) in two steps:

```bash
npx @gltf-transform/cli optimize <rig.glb> public/assets/characters/src/fidai-simple.glb \
  --compress false --texture-compress false --simplify-ratio 0.0085 --simplify-error 0.02
node scripts/build-hero.mjs assets/characters/src/fidai-simple.glb idle=<idle.fbx> walk=<walk.fbx>   # dev server running
```

`scripts/build-hero.mjs` runs `scripts/hero-build.ts` in the browser: it shrinks the textures, bakes each FBX take onto the GLB skeleton in world space at 30 fps (against the skin's bind pose, since FBXLoader leaves the bones in the take's first frame and the FBX keeps its centimetres and Z-up), keeps the walk in place and checks every track binds. The raw Tripo downloads stay out of git.

## Optional generated audio
Generated weapon models work the same way. Drop a GLB in `public/assets/models/` and list it in `public/assets/models/manifest.json`; the player then holds it instead of the procedural weapon, and a missing file or manifest changes nothing:

```json
{ "weapons": { "bow": { "file": "bow/model.glb", "length": 1.15 } } }
```

The loader (`src/assets/WeaponModels.ts`) turns the longest side of the model into the limbs or barrel, scales it to `length` metres and puts the grip in the hand, whatever axes the file uses. If the bow curves the wrong way add `"flip": true`; `"orient": [x, y, z]` (degrees) overrides the automatic orientation and `"muzzle"` moves where shots leave. Make one with `python .claude/skills/threejs-3d-generator/scripts/threejs_3d_asset.py image --image <photo> --wait --download --out-dir public/assets/models/bow`. The bow gets its arrow added in code.

With an ElevenLabs key, `ELEVENLABS_API_KEY=... bash scripts/generate-audio.sh` writes recorded-quality songs and effects to `public/audio/` with a manifest. The game uses any file it finds and keeps the procedural version for the rest.

## Graphics quality
Pause → Graphics cycles high / medium / low (resolution scale and bloom). Machines without GPU acceleration start on a light preset without shadows.

## Tests
```bash
npx playwright test                       # all specs on the local GPU
SOFTWARE_GL=1 CI=1 npx playwright test    # rehearse CI: CPU WebGL, simulated game time
```
| Spec | Checks |
| --- | --- |
| `visual` | title → play, WASD moves, canvas is not blank |
| `features` | language switch and persistence, crafting and the workbench, weapon slots and magazines, exploration and fog, skills and settings, save and continue, the crossbow, first-person and look-behind views |
| `bot-playtest` | real input through mission 1–2, eating, a silent takedown, death and retry |
| `campaign` | all six missions to the victory screen, including the flight |
| `hunting` | shoot a hare, skin it, grill the meat, craft a sling; fell a tree and quarry a rock |
| `rides` | ride the donkey, drive the jeep, row the boat, take the train, take off in the plane |
| `plane` | the Criquet's cockpit key by key: on the ground the cold engine (throttle moves, no rpm), N starter and idle, F/R flap notches and crank travel, T/G trim, Space holding her at full power, rudder taxi steering, braking to a stop, engine shut-down; in the air ailerons (numpad 4/6 and ←/→) roll and bank her into turns, elevator (numpad 5/8 and ↓/↑) pitches, climbs and dives, rudder (A/D) slips and yaws, throttle cut glides and full power climbs, flaps slow her, and a held pull stalls her (warning on), with recovery |
| `weaponmodel` | a stand-in GLB listed in the manifest replaces the procedural bow and is fitted to the hand whatever its axes; a listed file that is missing, or no manifest at all, leaves the procedural weapons |
| `frontier` | the three passes are walkable cols in a high ring, valley and streamed ground meet without a step, walking out through the north pass, chunks streaming in with trees, rocks, deadwood and herbs, gathering deadwood, the region map; a village found (banner, discovery), its well, storage jar and grocer used, then saved and reloaded with the same world and the jar still searched; a new seed changes the lands and their places but never the valley, the same seed gives the same lands |
| `hero` | the generated fidāʾī loads with idle and walk clips, stands and walks, and hands over to the procedural rig to aim, crouch and in first person, coming back at ease |
| `economy` | shoot crossbow bolts and bow arrows into the ground and pick them back up; sell hides and ore and buy bread, an axe and a crossbow from a souk smuggler; build a fire, an oven, a workbench and a tent, cook a tagine and bread, use the bench, sleep in the tent |
| `collision` | walk into a tree trunk and a parked jeep and stop at them; the jeep accelerates, shows its speed and brakes to a stop; flight instruments and the stall warning |
| `perf` (load test) | flythrough of every zone and landmark at day and night plus a garrison firefight. Asserts draw calls ≤ 340, triangles ≤ 900k, textures ≤ 110, heap growth ≤ 120 MB, and p95 frame ≤ 34 ms on a GPU. Writes `artifacts/perf-metrics.json` |

## Deploy (GitHub Pages)
`.github/workflows/deploy.yml` runs the type check, build and the full Playwright suite on every push and pull request, then deploys `dist/` to GitHub Pages from `main`. One-time setup: repository **Settings → Pages → Source: GitHub Actions**.

The evidence, scorecard and known limitations are in [artifacts/final-evidence.md](artifacts/final-evidence.md).
