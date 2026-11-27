#!/bin/zsh
# run.sh <probe.js> [wait-seconds] [extra open args…]          (macOS, debug build)
# Relaunches the debug app with a probe and prints its result. Extra args go to
# `open`, each --env as its own argument (zsh doesn't split a variable):
#   run.sh typing-dots.js 1500 --env FMESS_WINDOW_SIZE=1744x1078
#   run.sh bench.js 200 --env FMESS_NO_INJECT=1
# Files that define window.__fmess…() (bench.js, typing.js) get the call appended.
# FMESS_APP=<path to fMess.app> runs another build. On Windows and Linux, run the
# debug binary with the same FMESS_* variables instead (testing.md).
HERE=${0:A:h}
APP=${FMESS_APP:-$HERE/../../src-tauri/target/debug/bundle/macos/fMess.app}
[[ -d $APP ]] || { echo "no debug build at $APP: run npx tauri build --debug --bundles app first" >&2; exit 1; }
P=${1:?usage: run.sh <probe.js> [wait-seconds] [open args…]}; W=${2:-60}
shift $(( $# < 2 ? $# : 2 ))
D=${TMPDIR:-/tmp}/fmess-probe; mkdir -p $D; L=$D/probe.log; J=$D/probe.js
cp $P $J
grep -q 'window.__fmessBench = ' $P && echo 'return await window.__fmessBench();' >> $J
grep -q 'window.__fmessTyping = ' $P && echo 'return await window.__fmessTyping();' >> $J
pkill -f "fMess.app/Contents/MacOS/fmess"; sleep 1; rm -f $L
open --env FMESS_PROBE=$J --env FMESS_PROBE_DELAY=${FMESS_PROBE_DELAY:-14} --env FMESS_PROBE_WAIT=$W "$@" \
     --stderr $L $APP
until grep -q '\[probe\]' $L 2>/dev/null || ! pgrep -f "target/debug/bundle/macos/fMess.app/Contents/MacOS/fmess" >/dev/null; do sleep 2; done
grep '\[probe\]' $L | tail -1 | cut -c9- | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); d=json.loads(d) if isinstance(d,str) and d[:1] in '[{\"' else d; print(json.dumps(d, ensure_ascii=False, indent=1))"
