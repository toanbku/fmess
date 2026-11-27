#!/bin/bash
# Checks how chats look in the real app (macOS, debug build): each kind of chat
# (encrypted, not encrypted, group) with each Messenger chat theme found
# (default, gradient, colour), in each fMess look (Messenger, Zalo, WhatsApp,
# Teams and any other theme in src-tauri/themes/), light and dark. Prints what
# failed and makes one picture per chat.
#
#   tests/app/chat-check.sh [output dir] [max chats, default 6]
#
# Needs a debug build (npx tauri build --debug --bundles app). It quits the
# fMess that is running and opens the installed one again at the end.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-$(mktemp -d "${TMPDIR:-/tmp}/fmess-chat-check.XXXXXX")}"
MAX="${2:-6}"
APP=src-tauri/target/debug/bundle/macos/fMess.app
mkdir -p "$OUT"
[ -d "$APP" ] || { echo "No debug build at $APP: npx tauri build --debug --bundles app"; exit 1; }

python3 - "$OUT" "$MAX" <<'EOF'
import glob, json, os, sys
out, max_chats = sys.argv[1], int(sys.argv[2])
themes = {'messenger': None}
# The shipped themes first, then any other built theme (a new one being made).
names = ['zalo', 'whatsapp', 'teams']
names += sorted(n for n in (os.path.basename(p)[:-4] for p in glob.glob('src-tauri/themes/*.css')) if n not in names)
for name in names:
    themes[name] = open(f'src-tauri/themes/{name}.css').read()
probe = open('tests/app/chat-check.js').read()
probe = probe.replace('__OUT__', json.dumps(out)).replace('__THEMES__', json.dumps(themes)).replace('__MAX_CHATS__', str(max_chats))
open(f'{out}/probe.js', 'w').write(probe)
open(f'{out}/looks.txt', 'w').write(' '.join(themes))
EOF

pkill -f "fMess.app/Contents/MacOS/fmess" || true
sleep 2
open --env FMESS_PROBE="$OUT/probe.js" --env FMESS_PROBE_DELAY=15 --env FMESS_PROBE_WAIT=900 --stderr "$OUT/app.log" "$APP"
echo "Checking (a few minutes); pictures go to $OUT"
for _ in $(seq 1 330); do
  grep -q '^\[probe\]' "$OUT/app.log" 2>/dev/null && break
  sleep 3
done

python3 - "$OUT" <<'EOF'
# Reads the pictures' pixels at the points the probe gave and judges them.
import json, subprocess, sys
out = sys.argv[1]
line = next((l for l in open(f'{out}/app.log') if l.startswith('[probe]')), None)
if not line:
    print('No result from the probe; see', f'{out}/app.log'); sys.exit(1)
raw = json.loads(line[len('[probe] '):])
result = json.loads(raw) if isinstance(raw, str) else raw
if isinstance(result, str):
    print('Probe:', result); sys.exit(1)

def picture(path):
    size = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout.strip()
    w, h = map(int, size.split(','))
    data = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    return w, h, data
def lum(c):
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
def contrast(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)
def same(a, b):
    return sum(abs(p - q) for p, q in zip(a, b)) < 18
def col(c):
    return (c['r'], c['g'], c['b'])

failures = []
for chat in result['chats']:
    for run in chat['runs']:
        where = f"{chat['label']} · {run['look']} · {run['mode']}"
        run['problems'] = []
        try:
            w, h, data = picture(f"{out}/{run['file']}")
        except Exception:
            failures.append(f"{where}: no picture"); continue
        if run.get('moved'):
            failures.append(f"{where}: the messages kept moving, picture and points may not match")
        scale = w / run['viewport'][0]
        def px(point):
            x = min(max(int(point[0] * scale), 0), w - 1)
            y = min(max(int(point[1] * scale), 0), h - 1)
            i = (y * w + x) * 3
            return tuple(data[i:i + 3])
        for b in run['bubbles']:
            inside, outside = px(b['inside']), [px(o) for o in b['outside']]
            if b['faded']:
                continue
            if all(same(inside, o) for o in outside):
                run['problems'].append(f"{b['who']} bubble invisible (\"{b['words']}\"): {inside} inside and outside")
            elif b['text'] and contrast(col(b['text']), inside) < 2.5:
                run['problems'].append(f"{b['who']} text hard to read (\"{b['words']}\"): contrast {contrast(col(b['text']), inside):.2f} on {inside}")
        for q in run['quotes']:
            under = px(q['under'])
            if q['text'] and contrast(col(q['text']), under) < 2:
                run['problems'].append(f"quote text hard to read: contrast {contrast(col(q['text']), under):.2f} on {under}")
            if q['bar'] and contrast(col(q['bar']), under) < 1.25:
                run['problems'].append(f"quote bar hard to see on {under}")
        for t in run.get('toasts', []):
            under = px(t['inside'])
            if contrast(col(t['text']), under) < 3:
                run['problems'].append(f"toast text hard to read: contrast {contrast(col(t['text']), under):.2f}, {col(t['text'])} on {under}")
            for b in t.get('buttons', []):
                cross, face = px(b['cross']), px(b['face'])
                if contrast(cross, face) < 2:
                    run['problems'].append(f"toast's close button hard to see: its cross {cross} on {face}")
        for i in run['icons']:
            # A bubble behind an emoji is far from the chat's colour; a
            # wallpaper's pattern (WhatsApp's doodles) is near it.
            beside = px(i['beside'])
            if all(sum(abs(p - q) for p, q in zip(beside, px(f))) >= 60 for f in i['further']):
                run['problems'].append(f"emoji message {i['alt']} sits on something: {beside} beside it, {[px(f) for f in i['further']]} further out")
        failures += [f"{where}: {p}" for p in run['problems']]
# A toast that never showed is a check not made, not a pass.
for chat in result['chats']:
    for m in chat.get('missing', []):
        failures.append(f"toast · {m['look']} · {m['mode']}: no toast showed ({m['why']})")
result['failures'] = failures
json.dump(result, open(f'{out}/result.json', 'w'), indent=1, ensure_ascii=False)
for chat in result['chats']:
    runs = chat['runs']
    bad = sum(len(r.get('problems', [])) for r in runs)
    grad = 'yes' if any(r['containerGradient'] for r in runs) else 'no'
    if chat.get('toast'):
        print(f"{'FAIL' if bad else 'ok  '} {'toast':<16} {sum(len(r.get('toasts', [])) for r in runs)} toasts in {len(runs)} looks/modes")
        continue
    print(f"{'FAIL' if bad else 'ok  '} {chat['label']:<16} {sum(len(r['bubbles']) for r in runs)} bubbles, {sum(len(r['quotes']) for r in runs)} quotes, {sum(len(r['icons']) for r in runs)} emoji messages in {len(runs)} looks/modes; box gradient: {grad}")
for note in result['notes']:
    print('note:', note)
for failure in failures:
    print('  -', failure)
print('FAILED' if failures else 'PASSED', f'({len(failures)} problems)')
EOF

# One picture per chat: Messenger, then each theme; light above, dark below.
looks=$(cat "$OUT/looks.txt")
columns=$(echo $looks | wc -w | tr -d ' ')
for first in "$OUT"/*-messenger-light.png; do
  [ -e "$first" ] || break
  chat=$(basename "$first" -messenger-light.png)
  frames=$(mktemp -d)
  i=1
  for mode in light dark; do
    for look in $looks; do
      [ -e "$OUT/$chat-$look-$mode.png" ] && ln -s "$OUT/$chat-$look-$mode.png" "$frames/$(printf %02d $i).png"
      i=$((i + 1))
    done
  done
  ffmpeg -v error -y -i "$frames/%02d.png" -vf "scale=720:-1,tile=${columns}x2:padding=8:color=gray" -frames:v 1 "$OUT/sheet-$chat.png" && echo "sheet: $OUT/sheet-$chat.png"
  rm -rf "$frames"
done

pkill -f "debug/bundle/macos/fMess.app/Contents/MacOS/fmess" || true
sleep 1
[ -d /Applications/fMess.app ] && open -a /Applications/fMess.app || true
