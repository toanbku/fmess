# Theme tools

Small tools for making and checking a theme. The skill (`.claude/skills/fmess-theme/`,
testing.md) says when to use each one.

| File | What it does | Needs |
|---|---|---|
| `pixels.py` | colours at points, or the most common colours in a box, of a PNG screenshot | Python 3 only |
| `apply.py` | wraps a built theme (plus an optional measuring script) into a probe file | Python 3 only |
| `run.sh` | relaunches the debug app with a probe and prints what it returned | macOS, a debug build |
| `shoot.sh` | demo content, then a snapshot of the window at 880×600 | macOS, a debug build |
| `demo-shot.js` | the demo content: made-up names, pictures and lines over the open chat | used by `shoot.sh` |
| `bench.js` | frame times at rest, opening 6 read chats, scrolling the list and the messages (the same script runs in Chrome) | a probe; without run.sh, end it with `return await window.__fmessBench();` |
| `typing.js` | per character typed: the page's work and the time to the frame that shows it | a probe, `blockTyping` on; without run.sh, end it with `return await window.__fmessTyping();` |
| `viewer.js` | opens a photo in a read encrypted chat: viewer flag, the theme's decorations hidden, double-click zoom, Escape twice | a probe |
| `typing-dots.js` | waits (up to 24 min) for someone to type in the open chat, then compares the dots with a message | a probe, someone else typing |

Examples from the repo's root (the last three: macOS, after `npm install` and
`npx tauri build --debug --bundles app`). On Windows, `python3` may be `py` or `python`.

```sh
python3 themes/tools/pixels.py themes/<app>/spec/ref/light.png --scale 2 --box 0,0,64,600   # the rail's colour
python3 themes/whatsapp/build.py /tmp/wa.css && python3 themes/tools/apply.py /tmp/wa.css /tmp/apply.js --dark
themes/tools/run.sh /tmp/apply.js 60 --env FMESS_WINDOW_SIZE=880x600 --env FMESS_SNAPSHOT=/tmp/wa-dark.png
themes/tools/run.sh themes/tools/bench.js 200 --env FMESS_WINDOW_SIZE=1744x1078
themes/tools/run.sh themes/tools/typing-dots.js 1500     # ask the person to keep a busy chat open
```

Every probe runs in the real Messenger account of whoever runs fMess. They are read-only:
they open only read chats (not bold in the list), never send, and empty any box they typed
in. `run.sh` and `shoot.sh` quit the running fMess first; `shoot.sh` also writes `theme` and
`zoom` into the real `settings.json`. Back it up before and restore it after (testing.md).

Numbers from 2026-11-02 (M2 Pro, built-in 120 Hz screen, 1395×862): Chrome 119 fps at rest,
fMess 0.1.26 60 fps, fMess 0.1.28 119 fps; typing key to screen 12 ms Chrome, 17 ms fMess
0.1.28; six chats opened: 3 frames over 50 ms in Chrome, 10 to 11 in fMess, 15 to 16 in
WebKit without fMess's script.
