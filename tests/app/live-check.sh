#!/bin/bash
# Live checks in the real app (macOS, debug build): fMess and Messenger when
# the computer comes back from sleep, when the network dies and comes back,
# when the encrypted chats' worker dies ("Couldn't load chats"), and when a
# notification rings. The page's traffic goes through a local proxy
# (net-proxy.py) that cuts the network; sleep is made up with the clock jump
# it leaves. Prints PASS or FAIL for each case. See
# .claude/skills/fmess-live-check/SKILL.md.
#
#   tests/app/live-check.sh [wake] [network] [chats] [sound]   (all by default)
#
# Needs a debug build with the proxy:
#   npx tauri build --debug --bundles app --features test-proxy
# It quits the fMess that is running and opens the installed one again at the
# end; the window isn't brought forward. The sound check shows a few test
# notifications, turns Do Not Disturb and Messenger's sounds off and on, and
# mutes the Mac for a few seconds; each is put back as it was.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT="${LIVE_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/fmess-live.XXXXXX")}"
APP=src-tauri/target/debug/bundle/macos/fMess.app
PORT=18080
CONTROL=18081
SUITES="${*:-wake network chats sound}"
[ -d "$APP" ] || { echo "No debug build at $APP: npx tauri build --debug --bundles app --features test-proxy"; exit 1; }
mkdir -p "$OUT"
echo "Live checks: $SUITES (logs in $OUT)"

FAILED=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: $2"; FAILED=$((FAILED + 1)); }
verdict() { if [ "$2" = "True" ]; then pass "$1"; else fail "$1" "${3:-}"; fi; }
PROXY_PID=
MUTED_BEFORE=$(osascript -e 'output muted of (get volume settings)' 2> /dev/null || echo false)
cleanup() {
  pkill -f "debug/bundle/macos/fMess.app/Contents/MacOS/fmess" 2> /dev/null
  [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2> /dev/null
  osascript -e "set volume output muted $MUTED_BEFORE" 2> /dev/null
  sleep 1
  [ -d /Applications/fMess.app ] && open -g -a /Applications/fMess.app
}
trap cleanup EXIT

proxy() { curl -s --max-time 5 "localhost:$CONTROL/$1" > /dev/null; }
# start <dir>: the proxy, logging to <dir>, the network up.
start() {
  [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2> /dev/null
  mkdir -p "$1"
  python3 tests/app/net-proxy.py $PORT $CONTROL "$1/proxy.jsonl" 2> "$1/proxy.err" &
  PROXY_PID=$!
  disown "$PROXY_PID"
  sleep 1
}
# launch <dir> [probe] [wait s]: the debug app through the proxy.
launch() {
  pkill -x fmess
  sleep 2
  local args=(--env FMESS_PROXY="http://127.0.0.1:$PORT" --env FMESS_PROBE_NO_FOCUS=1)
  [ -n "${2:-}" ] && args+=(--env FMESS_PROBE="$2" --env FMESS_PROBE_DELAY=20 --env FMESS_PROBE_WAIT="${3:-60}")
  open -g "${args[@]}" --stderr "$1/app.log" "$APP"
}
stop_app() {
  pkill -f "debug/bundle/macos/fMess.app/Contents/MacOS/fmess"
  sleep 2
}
# seen <log> <pattern> <seconds>: waits for a line.
seen() {
  for _ in $(seq 1 $(($3 * 2))); do
    grep -q -- "$2" "$1" 2> /dev/null && return 0
    sleep 0.5
  done
  return 1
}
now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }
# judge <dir> <python expression>: True or False, with
#   notes: [(text, ms)] the page's recover: lines, in order
#   probe: the probe's result (or None)
#   back(after_ms): seconds from after_ms until the page talked to Facebook
#     again (a new tunnel with answers to gateway.facebook.com, and one to
#     web-chat-e2ee.facebook.com, the encrypted chats' worker), or None
#   reloads(a, b): reloads by fMess between a and b (ms)
#   at(text): when the page logged a line starting with text (ms), or 0
# value <dir> <python expression>: its value, the same way.
judge() {
  curl -s --max-time 5 "localhost:$CONTROL/stats" > "$1/stats.json" 2> /dev/null
  python3 - "$1" "$2" "${3:-bool}" << 'EOF'
import json, re, sys
d, expr, mode = sys.argv[1], sys.argv[2], sys.argv[3]
log = open(f'{d}/app.log').read()
notes = [(m[0], int(m[1])) for m in re.findall(r'\[page\] main recover: (.*?) @(\d+)', log)]
marks = [(m[0], int(m[1])) for m in re.findall(r'\[page\] main (.*?) @(\d+)', log)]
def at(text):
    return next((t for line, t in marks if line.startswith(text)), 0)
line = next((l for l in log.splitlines() if l.startswith('[probe] ')), None)
raw = json.loads(line[8:]) if line else None
probe = json.loads(raw) if isinstance(raw, str) else raw
try:
    tunnels = json.load(open(f'{d}/stats.json'))['tunnels']
except Exception:
    tunnels = []
def back(after_ms):
    after = after_ms / 1000
    def first(host):
        times = [t['opened'] for t in tunnels if t['host'].startswith(host) and t['opened'] >= after and t['down'] > 0]
        return min(times) - after if times else None
    g, e = first('gateway.facebook.com'), first('web-chat-e2ee.facebook.com')
    return None if g is None or e is None else round(max(g, e), 1)
# The new page notes "reloaded (reason)" with the time of the reload.
def reloads(a, b):
    return [t for text, t in notes if text.startswith('reloaded (') and a <= t <= b]
print(bool(eval(expr)) if mode == 'bool' else eval(expr))
EOF
}
value() { judge "$1" "$2" value; }
show() { grep -E '\[page\] main (recover|chats-error|sound):' "$1/app.log" | sed 's/^/    /' | tail -${2:-8}; }

# ---------------------------------------------------------------- wake
if [[ " $SUITES " == *" wake "* ]]; then
  # A late timer, a short sleep, then a sleep while a message is typed.
  D="$OUT/wake-quiet"
  start "$D"
  sed "s/__CASE__/quiet/" tests/app/live-wake.js > "$D/probe.js"
  launch "$D" "$D/probe.js" 90
  if seen "$D/app.log" '^\[probe\]' 130; then
    T=$(now_ms)
    verdict "wake: a timer a minute late doesn't reload" "$(judge "$D" "probe.get('afterLateTimer') == 'same page'")" "$(grep '^\[probe\]' "$D/app.log")"
    verdict "wake: a 2-minute sleep doesn't reload" "$(judge "$D" "probe.get('afterShortSleep') == 'same page'")"
    verdict "wake: no reload while a message is being typed" "$(judge "$D" "probe.get('whileTyping') == 'same page'")"
    seen "$D/app.log" 'recover: reloaded (slept' 20
    sleep 20
    verdict "wake: reloads once the message is sent" "$(judge "$D" "len(reloads($T, $T + 20000)) == 1")" "$(show "$D")"
    verdict "wake: after the reload, messages and encrypted chats talk to Facebook within 20 s" "$(judge "$D" "(back($T) or 99) <= 20")" "back after $(value "$D" "back($T)") s"
  else
    fail "wake: quiet cases" "no probe result"
  fi
  stop_app

  # Waking with the network off, then dead (no answer at all).
  for mode in refuse blackhole; do
    D="$OUT/wake-$mode"
    start "$D"
    sed "s/__CASE__/wake/" tests/app/live-wake.js > "$D/probe.js"
    launch "$D" "$D/probe.js" 60
    name="wake: with the network $([ $mode = refuse ] && echo off || echo dead)"
    if seen "$D/app.log" '^\[probe\]' 90; then
      proxy $mode
      DOWN=$(now_ms)
      sleep 25
      proxy pass
      T=$(now_ms)
      seen "$D/app.log" 'recover: reloaded' 25
      sleep 10
      verdict "$name: no reload until it's back" "$(judge "$D" "not reloads($DOWN, $T)")" "$(show "$D")"
      verdict "$name: reloads within 10 s of it coming back" "$(judge "$D" "len(reloads($T, $T + 10000)) == 1")" "$(show "$D")"
    else
      fail "$name" "no probe result"
    fi
    stop_app
  done
fi

# ---------------------------------------------------------------- network
if [[ " $SUITES " == *" network "* ]]; then
  # No sleep: the network dies and comes back; Messenger reconnects by itself
  # when it can, and fMess reloads when a connection stays down.
  D="$OUT/network"
  start "$D"
  launch "$D"
  seen "$D/app.log" 'unread chats' 60
  sleep 40
  # cut <mode> <seconds>: sets T (back) and A (cut).
  cut() {
    A=$(now_ms)
    proxy "$1"
    [ "$2" -gt 0 ] && sleep "$2"
    proxy pass
    T=$(now_ms)
  }
  reloaded() { grep -c 'recover: reloaded (' "$D/app.log"; }
  # Messenger brings its messages connection back by itself; the realtime and
  # streamcontroller ones it left down (measured), so fMess reloads for them.
  cut blackhole 60
  sleep 60
  verdict "network: a minute of dead network: messages back within 10 s, and fMess reloads at most once, within 60 s, for what Messenger leaves down" "$(judge "$D" "(back($T) or 99) <= 10 and len(reloads($A, $T + 60000)) <= 1 and not reloads($A, $T)")" "$(show "$D")"
  cut reset 0
  sleep 30
  verdict "network: every connection dropped: back within 10 s, no reload" "$(judge "$D" "(back($T) or 99) <= 10 and not reloads($A, $T + 30000)")" "$(show "$D")"
  cut refuse 30
  sleep 60
  verdict "network: 30 s offline: back within 60 s" "$(judge "$D" "(back($T) or 99) <= 60")" "$(show "$D")"
  # Long enough that Messenger gives up on its calls connection (~110 s).
  sleep 70
  BEFORE=$(reloaded)
  cut refuse 150
  for _ in $(seq 1 75); do [ "$(reloaded)" -gt "$BEFORE" ] && break; sleep 1; done
  sleep 20
  verdict "network: 2.5 minutes offline: fMess reloads within 60 s of it coming back (a connection stays down)" "$(judge "$D" "len(reloads($T, $T + 60000)) == 1 and not reloads($A, $T)")" "$(show "$D")"
  verdict "network: 2.5 minutes offline: everything talks to Facebook again within 75 s" "$(judge "$D" "(back($T) or 99) <= 75")" "$(show "$D")"
  stop_app
fi

# ---------------------------------------------------------------- chats
if [[ " $SUITES " == *" chats "* ]]; then
  # "Couldn't load chats" (#24): the encrypted chats' worker dies for good.
  D="$OUT/chats-first"
  start "$D"
  sed "s/__CASE__/first/" tests/app/live-chats-error.js > "$D/probe.js"
  launch "$D" "$D/probe.js" 90
  seen "$D/app.log" 'chats-error: worker killed' 90
  seen "$D/app.log" 'recover: reloaded (chats error)' 45
  sleep 20
  K="at(\"recover: Messenger's error screen\")"
  verdict "chats: Messenger shows its error screen" "$(judge "$D" "any(t.startswith(\"Messenger's error screen\") for t, _ in notes)")" "$(show "$D")"
  verdict "chats: fMess reloads by itself within 30 s" "$(judge "$D" "$K and len(reloads($K, $K + 30000)) == 1")" "$(show "$D")"
  verdict "chats: after the reload, encrypted chats talk to Facebook within 30 s" "$(judge "$D" "$K and (back($K) or 99) <= 30")" "back after $(value "$D" "back($K)") s"
  stop_app

  D="$OUT/chats-again"
  start "$D"
  sed "s/__CASE__/again/" tests/app/live-chats-error.js > "$D/probe.js"
  launch "$D" "$D/probe.js" 90
  seen "$D/app.log" 'chats-error: worker killed' 90
  sleep 30
  verdict "chats: back again within 10 minutes: the screen stays for Messenger's own Reload" "$(judge "$D" "not reloads(0, 10**14) and any(t == 'not again so soon: chats error' for t, _ in notes)")" "$(show "$D")"
  stop_app
fi

# ---------------------------------------------------------------- sound
if [[ " $SUITES " == *" sound "* ]]; then
  D="$OUT/sound"
  start "$D"
  cp tests/app/live-sound.js "$D/probe.js"
  launch "$D" "$D/probe.js" 300
  # The probe asks for the Mac to be muted and unmuted.
  STARTED=$SECONDS
  while ! grep -q '^\[probe\]' "$D/app.log" 2> /dev/null && [ $((SECONDS - STARTED)) -lt 360 ]; do
    if grep -q 'sound: mute$' "$D/app.log" 2> /dev/null && ! [ -e "$D/muted" ]; then
      osascript -e 'set volume output muted true' && touch "$D/muted"
    fi
    if grep -q 'sound: unmute' "$D/app.log" 2> /dev/null && ! [ -e "$D/unmuted" ]; then
      osascript -e "set volume output muted $MUTED_BEFORE" && touch "$D/unmuted"
    fi
    sleep 0.5
  done
  osascript -e "set volume output muted $MUTED_BEFORE"
  python3 - "$D/app.log" > "$D/judged.txt" << 'EOF'
import json, re, sys
log = open(sys.argv[1]).read()
line = next((l for l in log.splitlines() if l.startswith('[probe] ')), None)
raw = json.loads(line[8:]) if line else None
r = (json.loads(raw) if isinstance(raw, str) else raw) or {}
if isinstance(r, str):
    r = {'error': r}
# What fMess's native side was told, per test notification (its debug log).
told = dict(re.findall(r'notify #\d+: fMess live check (\S+) \(.*sound (true|false)\)', log))
for case in r.get('cases', []):
    native = told.get(case['id'])
    problems = []
    if native != str(case['want']).lower():
        problems.append(f"rang {native}, want {str(case['want']).lower()}")
    if case.get('ping') is not None and case.get('pinged') != case['ping']:
        problems.append("Messenger's sound " + ("didn't play" if case['ping'] else 'played'))
    if 'heldBack' in case and not case['heldBack']:
        problems.append("Messenger's sound wasn't held back" if case.get('asked') else "Messenger didn't ask for its sound")
    print(f"{'FAIL' if problems else 'PASS'} sound: {case['name']}" + (': ' + '; '.join(problems) if problems else ''))
for note in r.get('notes', []):
    print('    note:', note)
if r.get('error') or not r.get('cases'):
    print('FAIL sound:', r.get('error') or 'no cases ran')
EOF
  cat "$D/judged.txt"
  FAILED=$((FAILED + $(grep -c '^FAIL' "$D/judged.txt")))
  stop_app
fi

echo
if [ "$FAILED" -eq 0 ]; then echo "PASSED"; else echo "FAILED ($FAILED)"; fi
[ "$FAILED" -eq 0 ]
