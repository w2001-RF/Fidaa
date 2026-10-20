# FIDĀʾĪ — 1945 · Final evidence

Built with the repo's `.claude/skills` Three.js pack. Loaded and followed:
- `threejs-game-director`: SKILL, evidence-manifest, check_evidence.py, credential probe.
- `threejs-gameplay-systems`: SKILL, genre-design, game-feel, physics-engine-selection, scaffold script.
- `threejs-aaa-graphics-builder`: SKILL, visual-scorecard + anchors, authoring-recipes, technical-art, shader-cookbook.
- `threejs-game-ui-designer`: SKILL, ui-patterns.
- `threejs-debug-profiler`: SKILL, debug-playbook.
- `threejs-qa-release`: SKILL, release-checks, playtest-bot, inspector.

The asset-provider credentials (`TRIPO`, `GEMINI`, `ELEVENLABS`) were probed: all `MISSING`. Every model, texture and sound is therefore procedural.

## Design artifacts
The design brief, core-loop contract, world/level plan and mission list are in [game-progress.md](game-progress.md).

## Architecture
| Area | Files |
| --- | --- |
| Loop / renderer / post | `src/core/Loop.ts`, `src/core/Renderer.ts`: ACES, PCF shadows, bloom + grade/vignette pass, DPR cap 1.75 |
| Input | `src/core/Input.ts`: keyboard + pointer-lock mouse, edge-triggered intents |
| World | `src/world/Terrain.ts` (heightfield, exact height query), `layout.ts` (zones/roads/oued), `Architecture.ts` (house, wall, tower, gate, minaret, fountain, well, oven, stall, tent, barracks, watchtower, sandbags, barbed wire, truck), `World.ts` (zones, interactables, spawns), `Vegetation.ts` (chunked instancing + LOD + wind shader), `Sky.ts` (day/night) |
| Collision / AI nav | `Collision.ts`: custom collision, OBB + cylinders in a spatial hash, segment raycasts. `NavGrid.ts`: 2 m grid, budgeted A* with string-pulling |
| Characters | `CharacterRig.ts`: one rigid/blended skinned mesh per character (1 draw call), procedural walk/run/crouch/aim/reload/slash/death/sit, robe hem weight-blended to the thighs |
| Gameplay | `Player.ts` (movement, survival, inventory, XP, skills), `Enemy.ts` (perception, alert propagation, A* chase, shooting, search, takedown), `Npc.ts`, `game/Quests.ts` (5 missions), `game/Game.ts` (orchestration) |
| Feel / FX / audio | `CameraRig.ts` (shoulder cam, collision, trauma² shake, FOV punch), hitstop in `Game.ts`, `Vfx.ts` (pooled), `Audio.ts` (Web Audio: wind, crickets, Karplus-Strong oud in maqam Hijaz + bendir, SFX) |
| UI | `index.html`, `styles.css`, `ui/Hud.ts`, `ui/MapView.ts` |

Physics: no physics engine was used (custom collision, rung 1 of the ladder). Characters are vertical capsules resolved in XZ; bullets and sight lines are segment casts against colliders and the terrain. There are no rigid bodies.

## Tests run (all pass)
| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run build` | 213 KB gzip JS, no errors; `base: './'` for static hosting |
| `npx playwright test tests/visual.spec.ts` | title → Begin → WASD moves the player; canvas varied; no console errors |
| `npx playwright test tests/bot-playtest.spec.ts` | real input completes mission 1 and starts mission 2; crouched takedown stays silent; death under garrison fire and retry work. Metrics in [bot-metrics.json](bot-metrics.json) |
| `npx playwright test tests/campaign.spec.ts` | all 5 missions → victory screen (teleport skips walks; every objective done with real key holds) |
| Inspector, manifest [evidence.json](evidence.json) | 12/12 PASS on hardware GPU (RTX 4060, ANGLE D3D11) |
| `check_evidence.py --manifest` | passed, 12 artifacts |
| Production preview `:4188` smoke | boots in 3.5 s, ~60 fps, no page/console errors |

Bot metrics: seed 12345, 33 m travelled by real input, 0 softlock windows, takedown alert `hidden`. Standing still in the open before the garrison in daylight leads to death in ≈ 8.3 s. The fail state is fair, and retry restores full health at the hideout.

### Bugs found by playtesting and fixed
1. The E press that closed a dialogue also re-triggered the nearest interaction, so dialogue looped.
2. Crouched players were "felt" by guards at 2.6 m (stealth threshold 0.5 < crouch factor 0.55), which made takedowns impossible.
3. Canvas textures showed swirl artefacts from torus-sampled 2D noise; they were replaced with periodic value noise.
4. Nights were too bright because the IBL did not dim; it is now scaled by the night factor.
5. Robe legs poked through the djellaba when walking or crouching; the hem is now weight-blended to the thighs.
6. The medina was sparse because of oversized street/plaza exclusions; the layout was rebuilt with stall-lined streets and townsfolk.

## Captures (pass-1)
Desktop 1280×720 captures: [title](pass-1/desktop-title.png) · [douar](pass-1/desktop-active-play.png) · [souk](pass-1/desktop-medina-souk.png) · [medina walls](pass-1/desktop-medina-day.png) · [kasbah at night](pass-1/desktop-kasbah-night.png) · [garrison at night](pass-1/desktop-night-stealth.png) · [combat](pass-1/desktop-combat.png) · [dialogue](pass-1/desktop-dialogue.png) · [satchel](pass-1/desktop-inventory.png) · [map](pass-1/desktop-map.png) · [death](pass-1/desktop-death.png) · [victory](pass-1/desktop-victory.png)

Motion evidence (unpaused): [motion-sheet.png](pass-1/motion-sheet.png). Rows show walk, sprint (dust), crouch-sneak, khanjar slash (windup → cut → recover) and rifle aim.

## Renderer diagnostics (inspector, active play)
| State | calls | triangles | textures | entropy | edges | contrast |
| --- | --- | --- | --- | --- | --- | --- |
| douar | 207–248 | ~0.67–0.93 M | 73 | 5.96 | 0.25 | 134 |
| souk | ≤ 300 | < 750 k | 77 | 5.38 | 0.26 | 121 |
| medina walls | ≤ 300 | 756 k (+0.8 %) | 80 | 3.89 | 0.11 | 88 |
| kasbah night | ≤ 300 | < 750 k | 76 | 5.08 | 0.14 | 131 |
| combat | 286 | 699 k | 80 | 5.46 | 0.25 | 156 |

The performance pass measured triangles by group, then added near/far LOD for trees, cactus and rocks, reduced the terrain to 2.5 m cells, and tightened character draw distances:
- Triangles: medina-day 1.26 M → 0.76 M; combat 1.14 M → 0.70 M.
- Draw calls: ≤ 350 → ≤ 300 in every state.

Documented tradeoffs:
- **Texture count (73–80 > 60):** ~47 are per-character bone DataTextures of a few hundred bytes each. ~15 are composer/bloom/shadow/IBL render targets, and ~16 are 128–256 px canvas textures. Estimated texture memory is a few MB, far under 256 MB.
- **Medina-day is 0.8 % over the triangle budget.** This is accepted because the frame rate holds at 60 fps.
- **Shadows:** one 2048² map that follows the player (±62 m). Post: bloom + grade (2 passes).

## Visual scorecard (genre mapping)
Hero = the fidāʾī. Obstacles = French soldiers, mokhaznis and officers. Interactables = wells, ovens, leaflets, poles, prison, cache, loot.

| Category | Before | After | Evidence |
| --- | --- | --- | --- |
| Art direction | not captured | 2.5 | Moroccan identity everywhere: pisé ramparts, merlons, zellige, horseshoe arches, Arabic/French leaflets, brass-and-indigo UI with Arabic calligraphy, oud music |
| Hero | not captured | 2 | Pointed-hood djellaba, bandolier, red sash, babouches, khanjar + slung rifle; crouch/aim/hit-flash states; capsule proxy |
| Enemies | not captured | 2 | Factions distinct by silhouette: khaki kepi vs navy cloak + turban; officers have a gold-band kepi or a red fez + green cloak. ?/! indicators and whistle telegraph detection |
| Interactables | not captured | 2 | Authored well/oven/fountain/poster/pole/prison/cache; hold-ring prompts, sparks, glints, beacon, compass markers |
| World | not captured | 2 | Five authored zones plus wilds; layered near/mid/far props and Atlas skyline; edge density 0.11–0.26 |
| Materials | not captured | 2 | Shared material roles; procedural plaster/pisé/wood/zellige/corrugated textures; vertex AO; tints by role |
| Lighting | not captured | 2 | ACES, golden-hour start, keyed day/night, moon key, lantern pool at night, contrast 88–156 |
| VFX / motion | not captured | 2 | Muzzle flash + light, tracers, blood/dust/sparks, footstep dust, hitstop, shake, FOV punch; robe-blended locomotion |
| UI / HUD | not captured | 2.5 | Survival gauges, compass with objective/foe markers, alert badge, world indicators, dialogue, satchel/journal/skills, map, death/victory |
| Performance evidence | not captured | 2 | Inspector budgets, measured triangle breakdown, before/after LOD numbers, documented tradeoffs, 60 fps on preview |

Average ≈ **2.1**. Every category is at least 2 and there are no automatic failures. This is "premium stylized" per category, but below the 2.3 average needed for a "premium" claim, which the request did not ask for. The next passes that would raise it:
1. Generated hero/enemy GLBs with real rigs, once a TRIPO key is available.
2. Interior spaces (riad courtyards, the Caïd's hall).
3. Street-level clutter and decals (laundry, doors, lanterns per alley).
4. Mobile/touch controls.

## Known limitations
- Desktop only (keyboard + mouse). There is no touch UI.
- Mouse-look needs pointer lock (click the game). Headless tests use a `lookAt` test hook in its place.
- Buildings are solid (no interiors), and guards cannot climb.
- Townsfolk do not react to combat.
- There is no save system; progress lasts for the session (death keeps mission progress).
- Characters are procedural low-poly, and facial detail is minimal.
