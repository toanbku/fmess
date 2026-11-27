#!/bin/zsh
# shoot.sh <theme-id|none> <out.png>                           (macOS, debug build)
# Demo content (demo-shot.js: made-up names, pictures and lines), then a WebKit
# snapshot of the page at 880x600 (1760x1200 on a Retina screen).
# It writes `theme` and `zoom: 1` into the REAL settings.json: back it up before
# and restore it after (testing.md, "Setup" and "Restore").
# DEMO=<file.js> runs another copy of demo-shot.js, e.g. one that starts with
# `const DEMO_LANG = 'vi';` and/or `const DEMO_DARK = true;`.
HERE=${0:A:h}
APP=${FMESS_APP:-$HERE/../../src-tauri/target/debug/bundle/macos/fMess.app}
[[ -d $APP ]] || { echo "no debug build at $APP: run npx tauri build --debug --bundles app first" >&2; exit 1; }
[[ -n $1 && -n $2 ]] || { echo "usage: shoot.sh <theme-id|none> <out.png>" >&2; exit 1; }
F="$HOME/Library/Application Support/io.github.toanbku.fmess/settings.json"
D=${TMPDIR:-/tmp}/fmess-shoot; mkdir -p $D
PROBE=${DEMO:-$HERE/demo-shot.js}; PROBE=${PROBE:A}; OUT=${2:A}
python3 -c "
import json,sys; p=sys.argv[1]; d=json.load(open(p)); d['theme']=None if sys.argv[2]=='none' else sys.argv[2]; d['zoom']=1; json.dump(d, open(p,'w'), indent=2)" "$F" $1
pkill -f "fMess.app/Contents/MacOS/fmess"; sleep 1; rm -f $D/shot.log $OUT
open --env FMESS_PROBE=$PROBE --env FMESS_PROBE_DELAY=12 --env FMESS_WINDOW_SIZE=880x600 --env FMESS_SNAPSHOT=$OUT --stderr $D/shot.log $APP
for i in $(seq 1 60); do sleep 2; grep -q '\[snapshot\]\|no result' $D/shot.log 2>/dev/null && break; done
grep '\[probe\]\|\[snapshot\]' $D/shot.log | cut -c1-600
