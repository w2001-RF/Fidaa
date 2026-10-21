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
| LMB · RMB · R | strike or fire (hold for the MAS-38) · aim · reload |
| 1 – 5 / wheel | khanjar · Lebel rifle · Ruby pistol · moukahla musket · MAS-38 |
| E (hold) | interact: drink, take bread, search, gather, paste leaflets, cut wires, unlock. Behind an unaware guard: silent takedown |
| Q · F · H | drink from the water skin · eat · heal (bandage or thyme) |
| Tab / I · K · J · M · Esc | satchel · crafting · journal · map · pause |

## How it plays
- **Survive.** Hunger and thirst fall all the time. Refill at wells, fountains and the oasis pond, take bread from the douar oven, search jars, crates, shrines and fallen enemies, and gather thyme, deadwood and scrap in the wilds.
- **Loot and craft.** Searches give scrap, cloth, wood and gunpowder. Make bandages and ammunition anywhere (K). At Si Lahcen's workbench, restore the moukahla and make gear: a whetted khanjar, a large guerba, a hill-coloured cloak and a smuggler's satchel.
- **Fight.** Five weapons, each with its own magazine. The khanjar is silent. The pistol and the MAS-38 share 7.65 mm rounds. The musket throws a scatter of lead. Find the pistol in the Khalifa's strongbox and the MAS-38 on the garrison's rack.
- **Stay unseen.** Guards have vision cones and fill a detection meter (? → !). Daylight doubles their sight. Crouch in olive groves and scrub. Whistles alert guards within 34 m, gunshots within 40–95 m depending on the weapon.
- **Grow.** XP from missions, takedowns, crafting and discoveries. Six skills with five ranks each: Stealth, Marksmanship, Endurance, Scavenger, Artisan, Survivalist.
- **Explore.** The map starts under fog. Nine landmarks wait in the wilds (Roman ruins, a shepherds' cave, a nomad camp, a lead mine, an olive press, an ambushed convoy, an Atlas lookout, a fidāʾiyīn hideaway, a ruined ksar), each with loot and XP.
- **Missions.** (1) Bread and Water; (2) Words of Freedom; (3) Cut the Wires; (4) The Caïd's Prison; (5) Guns for the Mountains.
- **Music and voices.** Five original procedural songs change with the situation: oud in Hijaz by day, a Gnawa road song, a ney in Bayati at night, darbuka in combat, and a victory song with a zaghrouda. Characters speak through the browser's speech engine, with a synthesized murmur when no voice exists for the language. Guards shout in French or Darija.

## Optional generated audio
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
| `features` | language switch and persistence, crafting and the workbench, weapon slots and magazines, exploration and fog, skills and settings |
| `bot-playtest` | real input through mission 1–2, eating, a silent takedown, death and retry |
| `campaign` | all five missions to the victory screen |
| `perf` (load test) | flythrough of every zone and landmark at day and night plus a garrison firefight. Asserts draw calls ≤ 340, triangles ≤ 900k, textures ≤ 110, heap growth ≤ 120 MB, and p95 frame ≤ 34 ms on a GPU. Writes `artifacts/perf-metrics.json` |

## Deploy (GitHub Pages)
`.github/workflows/deploy.yml` runs the type check, build and the full Playwright suite on every push and pull request, then deploys `dist/` to GitHub Pages from `main`. One-time setup: repository **Settings → Pages → Source: GitHub Actions**.

The evidence, scorecard and known limitations are in [artifacts/final-evidence.md](artifacts/final-evidence.md).
