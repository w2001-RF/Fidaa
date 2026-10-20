# FIDĀʾĪ — 1945 · Game progress

## Intent and constraints
- Request: a Three.js third-person survival open-world RPG. The player is a grassroots Moroccan fidāʾī of the national movement in 1945, under the French Protectorate. They survive in the countryside while fighting French soldiers and the soldiers/officers of the collaborating Makhzen (caïd's mokhaznis).
- Built with the in-repo `.claude/skills/threejs-*` pack: director, gameplay-systems, aaa-graphics-builder, game-ui-designer, debug-profiler, qa-release.
- External generation: TRIPO / GEMINI / ELEVENLABS keys are MISSING, so every model, texture, and sound is procedural (Three.js geometry, canvas textures, Web Audio synthesis).
- Target: desktop browser (keyboard + mouse, pointer lock). The HUD must stay responsive down to laptop sizes. Mobile touch gameplay is out of scope for this slice.
- All places and characters are fictional. The history is respected: the Manifesto of Independence (11 Jan 1944), the repression that followed it, collaborating caïds/pashas, mokhazni auxiliaries, and the French garrison posts.

## Design brief
- **Player promise:** you are Driss, a hunted fidāʾī. You live off the land between douar, medina, kasbah and garrison, and you strike the occupier and its collaborators, then vanish.
- **Target feeling:** tense, scarce, and grounded. You sneak at night and strike with purpose. Open firefights are dangerous.
- **Primary verb:** move unseen (stealth traversal). **Secondary verbs:** strike (khanjar takedown / rifle shot), scavenge (water, bread, dates, herbs, ammo), interact (post leaflets, cut wires, free prisoners, steal arms).
- **Every 5–30 s:** read patrols → choose a route or cover → advance, or strike → loot.
- **Every 1–5 min:** hunger and thirst force a supply run (wells, ovens, containers). Day turns to night (8 min per day), which changes detection range. Missions escalate across zones.
- **Lose/learn/restart:** health reaches 0 from gunfire or starvation. The death screen says what killed you. Retry respawns you at the hideout with mission progress kept (fast, under 2 s).
- **Rewarded:** unseen takedowns (bonus XP), completed objectives (XP, ammo), exploration (loot). **Risk:** gunshots alert everyone within 70 m, and daylight plus open ground means detection.
- **A better player:** moves at night, crouches through shadows, takes officers silently, conserves ammo, and plans water stops.
- **Next decision communicated by:** compass objective marker, world beacon, per-enemy detection indicator (? → !), alert badge, and the interaction prompt.
- **Non-goals:** vehicles, multiplayer, mobile controls, voiced dialogue, branching story.

## Core loop contract
Player **sneaks and strikes** to **complete resistance missions** while **patrols, day-light detection, hunger and thirst** create risk; success gives **XP → skill ranks, ammo, supplies, and mission progress**, and failure causes **death → respawn at the hideout with lost supplies**.

## World / level plan (≈ 480 × 480 m open world, Atlas mountains enclosing it)
| Zone | Pos (x,z) | Role |
| --- | --- | --- |
| Douar Tifawt (resistance hideout) | (-150, 120) | spawn, safe zone, well, bread oven, NPCs Lalla Zahra & Si Lahcen |
| Medina of Tadwart | (10, 10) | walled town with gates, souk, fountain, minaret; mixed French/mokhazni patrols; leaflet walls |
| Telegraph road | medina → post | 4 telegraph poles to sabotage; road patrol |
| Kasbah of the Caïd | (135, 120) | crenellated pisé fortress; mokhaznis + Khalifa officer (carries key); prison |
| French military post | (120, -135) | barbed wire, barracks, watchtower, tents, truck, arms depot |
| Wilds | everywhere | argan/olive/palm, prickly pear, rocks, dry oued with oasis wells |

Start: in the douar at 16:30 (golden hour). First decision: gather water/bread. First threat: the medina gate patrol (~150 m). First reward: XP + leaflets. Escalation: medina (light patrols) → road (open ground) → kasbah (dense guards, officer) → garrison (heavy, sentry tower). Recovery beats: the hideout, wells, and night.

## Missions
1. Bread and Water: draw water at the douar well and take bread from the oven.
2. Words of Freedom: post 3 independence leaflets on marked medina walls.
3. Cut the Wires: sabotage 4 telegraph poles (hold E).
4. The Caïd's Prison: take the key from the Khalifa and open the kasbah prison.
5. Guns for the Mountains: steal the arms cache from the French depot and return to Douar Tifawt → victory.

## Status
- [x] Skills read; credentials probed (all missing → procedural)
- [x] Scaffold created
- [x] Core systems: terrain, collision, nav, world kit, characters, AI, combat, survival, quests, UI, audio
- [x] Bugs found by playtests and fixed: dialogue-close E press re-triggered interaction; crouched players were "felt" at 2.6 m (takedowns impossible); swirl artefacts in canvas textures; nights too bright (IBL not dimmed)
- [x] tests/visual.spec.ts, tests/bot-playtest.spec.ts (real input M1→M2, takedown, death, retry), tests/campaign.spec.ts (all 5 missions → victory) pass
- [x] QA: production build + preview smoke, inspector manifest 12/12 PASS, evidence check passed, motion sheet, scorecard (avg ≈2.1, all ≥2) → see final-evidence.md

## Next actions (if continued)
- Generated GLB hero/enemy assets when TRIPO_API_KEY is available; ElevenLabs voice lines
- Riad/kasbah interiors, street clutter & decals, townsfolk reactions to combat
- Touch controls for mobile; save/load
