#!/bin/bash
# Random sequences of what a person does in the real app (macOS, debug
# build), checking after each step what must always hold: the keyboard goes
# where it is put, the message box keeps its width, Escape closes the
# viewer, text can be selected, fMess's script throws no error, a sent
# message shows. The idea of property-based UI testing (Bombadil), on WebKit
# with fMess's own probe and real clicks and keys. See tests/app/fuzz-check.js
# for what it does and never does.
#
#   tests/app/fuzz-check.sh [seed] [steps, default 40] [runs, default 1] [looks]
#
# Looks, one per run in turn (default all): messenger (Messenger's own),
# zalo, whatsapp, teams, or any theme in src-tauri/themes/. Put in the page
# as Settings would, not saved.
#
# The same seed does the same steps again (Messenger's live data aside), to
# see a failure again. Without one, each run picks one.
#
# It may type and send only in chats listed in ~/.config/fmess/fuzz.json
# (FMESS_FUZZ_CONFIG), kept on this computer and never in the repo:
#   { "sendTo": { "<thread id>": "who" }, "maxSendsPerRun": 6 }
# Without the file it sends nothing anywhere.
#
# Needs a debug build (npx tauri build --debug --bundles app). It quits the
# fMess that is running and opens the installed one again at the end.
set -uo pipefail
cd "$(dirname "$0")/../.."
SEED="${1:-}"
STEPS="${2:-40}"
RUNS="${3:-1}"
LOOKS=(${4:-messenger zalo whatsapp teams})
CONFIG="${FMESS_FUZZ_CONFIG:-$HOME/.config/fmess/fuzz.json}"
OUT="${FUZZ_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/fmess-fuzz.XXXXXX")}"
APP=src-tauri/target/debug/bundle/macos/fMess.app
[ -d "$APP" ] || { echo "No debug build at $APP: npx tauri build --debug --bundles app"; exit 1; }
mkdir -p "$OUT"
[ -f "$CONFIG" ] || echo "No $CONFIG: nothing will be sent."
trap 'pkill -f "debug/bundle/macos/fMess.app/Contents/MacOS/fmess"; sleep 1; [ -d /Applications/fMess.app ] && open -g -a /Applications/fMess.app' EXIT

FAILED=0
for run in $(seq 1 "$RUNS"); do
  seed="${SEED:-$((RANDOM * 32768 + RANDOM))}"
  look="${LOOKS[$(((run - 1) % ${#LOOKS[@]}))]}"
  DIR="$OUT/$look-$seed"
  mkdir -p "$DIR"
  python3 - "$seed" "$STEPS" "$CONFIG" "$DIR" "$look" <<'PY'
import json, os, sys
seed, steps, config, out, look = sys.argv[1:]
cfg = json.load(open(config)) if os.path.exists(config) else {}
css = None if look == 'messenger' else open(f'src-tauri/themes/{look}.css').read()
probe = open('tests/app/fuzz-check.js').read()
for k, v in {'__SEED__': seed, '__STEPS__': steps, '__CONFIG__': json.dumps(cfg), '__OUT__': json.dumps(out), '__LOOK__': json.dumps(css)}.items():
    probe = probe.replace(k, v)
open(f'{out}/probe.js', 'w').write(probe)
PY
  pkill -f "fMess.app/Contents/MacOS/fmess"
  sleep 2
  open -g --env FMESS_PROBE="$DIR/probe.js" --env FMESS_PROBE_DELAY=15 --env FMESS_PROBE_WAIT=900 --env FMESS_PROBE_NO_FOCUS=1 --stderr "$DIR/app.log" "$APP"
  for _ in $(seq 1 900); do grep -q '^\[probe\] [^a]' "$DIR/app.log" 2> /dev/null && break; sleep 1; done
  python3 - "$DIR" "$seed $look" <<'PY' || FAILED=$((FAILED + 1))
import json, sys
out, seed = sys.argv[1], sys.argv[2]
line = next((l for l in open(f'{out}/app.log') if l.startswith('[probe] ') and not l.startswith('[probe] again')), None)
if not line:
    print(f'FAIL seed {seed}: no result; see {out}/app.log'); sys.exit(1)
raw = json.loads(line[8:]); r = json.loads(raw) if isinstance(raw, str) else raw
if not isinstance(r, dict):
    print(f'FAIL seed {seed}: {r}'); sys.exit(1)
json.dump(r, open(f'{out}/result.json', 'w'), indent=1, ensure_ascii=False)
for k in r['known']:
    print(f'known  seed {seed}: {k}')
for v in r['violations']:
    print(f"FAIL   seed {seed} step {v['step']}: {v['rule']}: {v['detail']}  (picture: {out}/violation-{v['step']}.png)")
print(f"{'FAIL' if r['violations'] else 'PASS'}   seed {seed}: {len(r['steps'])} steps, {r['sends']} sent")
sys.exit(1 if r['violations'] else 0)
PY
done
echo "Steps and pictures: $OUT"
[ "$FAILED" = 0 ] && echo PASSED || echo "FAILED ($FAILED of $RUNS runs; run again with the seed to see it)"
exit "$FAILED"
