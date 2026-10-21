#!/usr/bin/env bash
# Generate the optional ElevenLabs audio set into public/audio/ and write its manifest.
# Needs ELEVENLABS_API_KEY in the environment. Without it the game keeps its
# procedural songs and effects (src/systems/Audio.ts); every file here is an
# optional drop-in replacement, keyed by the manifest.
#
#   ELEVENLABS_API_KEY=... bash scripts/generate-audio.sh            # all
#   ELEVENLABS_API_KEY=... bash scripts/generate-audio.sh music      # songs only
#   ELEVENLABS_API_KEY=... bash scripts/generate-audio.sh sfx        # effects only
set -euo pipefail
cd "$(dirname "$0")/.."
GEN="python .claude/skills/threejs-audio-generator/scripts/threejs_audio_asset.py"
OUT=public/audio
mkdir -p "$OUT/music" "$OUT/sfx"
what="${1:-all}"

$GEN probe | grep -q "=SET" || { echo "ELEVENLABS_API_KEY is not set; procedural audio stays in use." >&2; exit 1; }

music() { # id duration prompt
  [ -f "$OUT/music/$1.mp3" ] && { echo "skip music/$1.mp3"; return; }
  $GEN music --instrumental --duration "$2" --prompt "$3" --out "$OUT/music/$1.mp3"
}
sfx() { # id duration influence prompt
  [ -f "$OUT/sfx/$1.mp3" ] && { echo "skip sfx/$1.mp3"; return; }
  $GEN sfx --duration "$2" --prompt-influence "$3" --prompt "$4" --out "$OUT/sfx/$1.mp3"
}

if [ "$what" = all ] || [ "$what" = music ]; then
  music tifawt 90 "Moroccan village daytime loop, solo oud in maqam Hijaz on D over a bendir frame drum in a 3+3+2 rhythm, low drone, warm and dusty, Atlas foothills, 1940s, calm but watchful, no vocals, steady energy with no intro or fade-out, designed to loop"
  music gnawa 90 "Gnawa trance groove, guembri bass ostinato in D minor pentatonic, iron qraqeb castanets in triplets, sparse handclaps, short oud calls, hypnotic road travel music, no vocals, no intro or fade-out, designed to loop"
  music nights 90 "Moroccan night ambience music, breathy ney flute improvising slowly in maqam Bayati on D, soft low drone, distant single frame-drum hits, sparse and tense stealth mood, no vocals, no intro or fade-out, designed to loop"
  music hunted 60 "urgent North African chase music, fast darbuka maqsum rhythm, driving guembri bass, staccato oud stabs in maqam Hijaz, rising tension, combat loop, no vocals, no intro or fade-out, designed to loop"
  music victory 35 "triumphant Moroccan celebration, bright oud melody in maqam Ajam, darbuka and handclaps, ending with joyful zaghrouda ululation, independence day, short finale with a clear ending"
fi

if [ "$what" = all ] || [ "$what" = sfx ]; then
  sfx shot-rifle 1.6 0.7 "single 1940s bolt-action rifle shot outdoors in a dry valley, sharp crack, heavy body, short rolling echo"
  sfx shot-pistol 1.0 0.7 "single small 7.65mm pistol shot outdoors, snappy crack, light echo"
  sfx shot-musket 2.2 0.7 "antique flintlock musket firing, flash pan fizz then deep black powder boom rolling down a valley"
  sfx shot-smg 0.5 0.75 "single shot of a 1930s submachine gun, short crack with bolt clatter, outdoors"
  sfx craft 1.4 0.6 "small metal hammer taps and file scraping on a wooden workbench, crafting cartridges"
  sfx discover 2.0 0.5 "short Moroccan oud arpeggio rising with a soft ney flute note, discovery chime, warm"
fi

# manifest: list whatever exists so partial runs still load
node -e '
const fs = require("fs");
const dir = "public/audio";
const pick = (sub) => Object.fromEntries((fs.existsSync(`${dir}/${sub}`) ? fs.readdirSync(`${dir}/${sub}`) : [])
  .filter((f) => f.endsWith(".mp3")).map((f) => [f.replace(/\.mp3$/, ""), `${sub}/${f}`]));
fs.writeFileSync(`${dir}/manifest.json`, JSON.stringify({ music: pick("music"), sfx: pick("sfx") }, null, 2) + "\n");
console.log("wrote", `${dir}/manifest.json`);
'
