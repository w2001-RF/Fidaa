# FIDĀʾĪ — Morocco 1945 (فدائي)

A third-person survival open-world RPG in Three.js. Morocco, autumn 1945, under the French Protectorate. You are Driss, a young fidāʾī of a clandestine nationalist cell. You live off the land between your douar, the medina of Tadwart, the Caïd's kasbah and the French garrison of Bir Lahmam. You fight the French soldiers and the collaborating Makhzen's mokhaznis and officers.

All places and characters are fictional. The historical frame, from the Manifesto of Independence (11 January 1944) to independence on 2 March 1956, is real.

## Run

```bash
npm install
npm run dev        # http://127.0.0.1:5188
npm run build      # production build in dist/ (relative base, any static host)
npm run preview    # http://127.0.0.1:4188
```

Click **Begin the struggle**, then click the game view to capture the mouse.

## Controls
| Key | Action |
| --- | --- |
| W A S D / mouse | move / look |
| Shift · C · Space | sprint · crouch (sneak) · jump |
| LMB · RMB · R | strike or fire · aim rifle · reload |
| 1 · 2 | khanjar (silent) · Lebel rifle |
| E (hold) | interact: drink, take bread, search, paste leaflets, cut wires, unlock. Behind an unaware guard: silent takedown |
| Q · F · H | drink from the water skin · eat · use herbs |
| Tab / I · J · M · Esc | satchel and skills · journal · map · pause |

## How it plays
- **Survive.** Hunger and thirst fall all the time; sprinting speeds them up. Refill at wells, fountains and the oasis pond. Take bread from the douar oven. Search jars, crates, shrines (koubbas) and fallen enemies. Wild thyme heals.
- **Stay unseen.** Guards have vision cones and fill a detection meter (? → !). Daylight doubles how far they see. Crouching in olive groves, scrub and prickly pear hides you. One guard's whistle alerts everyone within about 34 m, and a gunshot alerts everyone within 80 m. Break line of sight to lose them. Rest on the mat in Si Lahcen's house to skip to dusk or dawn.
- **Strike.** The khanjar is silent. From behind, a takedown kills instantly. The rifle is powerful (headshots kill) but loud, and cartridges are scarce.
- **Grow.** XP from missions, takedowns and sabotage gives levels. Spend skill points (Tab → Skills) on Stealth, Marksmanship or Endurance.
- **Missions.** (1) Bread and Water; (2) Words of Freedom: cover the curfew notices in the medina with Istiqlal leaflets; (3) Cut the Wires; (4) The Caïd's Prison; (5) Guns for the Mountains.

## Tests
```bash
npx playwright test                 # visual, bot playtest, full campaign
npm run inspect:canvas -- --manifest artifacts/evidence.json --url http://127.0.0.1:5188 --seed 42
```
The evidence, scorecard and known limitations are in [artifacts/final-evidence.md](artifacts/final-evidence.md).
