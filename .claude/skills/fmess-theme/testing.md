# Testing a theme in the real app

fMess runs as the user, in the user's Messenger account. All the read-only rules from
extraction.md apply to tests and probes too: no sending, reacting, calling, or opening
unread chats.

## Quick loop (any system, the installed fMess)

fMess reads a theme added in Settings from its data folder on every page load:

| System | Theme file |
|---|---|
| macOS | `~/Library/Application Support/io.github.toanbku.fmess/themes/<id>.css` |
| Windows | `%APPDATA%\io.github.toanbku.fmess\themes\<id>.css` |
| Linux | `~/.local/share/io.github.toanbku.fmess/themes/<id>.css` |

Add the theme once with **Settings › Theme › Add…** (it checks the file, copies it there
and selects it; `<id>` is the file name in lowercase ASCII, with spaces and punctuation
as dashes: `My Theme.css` becomes `my-theme`; a built-in's name gets `-custom`). Then build
or copy each change over **that same file** and **Reload** (Cmd+R / Ctrl+R). Don't make
new files in that folder by hand: a file named after a built-in (`zalo.css`,
`whatsapp.css`, `teams.css`) is ignored for the built-in, and a name Add… wouldn't make
(`my_theme.css`) shows in Settings but never loads. A file that breaks a rule (2 MB,
`@import`, a non-`data:` URL) doesn't load either: add it with Add… again to read the
reason. Remove it in Settings when
done if it was only a test.

Nothing to back up for this loop: it changes only the theme the user chose to add. You
can't see fMess's window from here: ask the user for screenshots of what you need, light
and dark, and compare them with the reference (on macOS the deep loop below takes its
own). On Windows, `python3` may be `py` or `python`.

## What to look at

In light and dark, region by region, top left to bottom right: rail, list header, search,
filters, rows (hover, selected, unread), chat header, chat background, bubbles (yours,
theirs, a reply, a quote `> …`, emoji only), dates, reactions, the composer (empty, with
text: the send button; the default 👍 must not look like a send button), details pane.
Then: a tooltip, the ⋯ menu, the reaction picker, a toast (text readable, close button
visible), the photo viewer (nothing the theme draws over it), a group chat, a link
preview, the reply bar, the typing dots if someone types, Settings › Appearance › Hide
profile pictures on, and on Windows/Linux the top of the window (`--fmess-title-bar` is 0
there: nothing drawn under where macOS has its buttons).

## Deep loop setup (macOS, debug build)

```sh
S=<scratchpad from the system prompt>; APP=<app>
F="$HOME/Library/Application Support/io.github.toanbku.fmess/settings.json"
cp "$F" "$S/settings.backup.json"        # restore this at the end, whatever happens
cp "$(dirname "$F")/.window-state.json" "$S/window-state.backup.json"   # the debug app's 880x600 lands here
npm install                              # once, in a fresh clone (README, Build from source)
npx tauri build --debug --bundles app    # in the repo; only after Rust/inject.js/BUILT_IN changes
```

The debug and installed apps share a bundle id and are single-instance: a second one only
focuses the first. Always `pkill -f "fMess.app/Contents/MacOS/fmess"` before launching
either.

Other agents may need the debug app too. Convention: while
`<scratchpad>/debug-app-busy` exists, don't launch the debug app, kill fMess or edit
settings.json; poll until it's gone. Put that check at the top of your run script.

Reusable probes and a launcher are in `themes/tools/` (README there): `run.sh <probe.js>
[wait-s] [--env K=V …]`, `apply.py`, `bench.js` (frames while scrolling and opening chats,
the same script runs in Chrome), `typing.js`, `viewer.js`, `typing-dots.js`, `pixels.py`.
Keep anything worth reusing there, not in `/tmp` (wiped when the Mac restarts). Don't count
on Pillow: `pixels.py` reads PNGs with nothing installed; crop with
`sips -c <h> <w> --cropOffset <y> <x>`, shrink with `sips -Z`.

zsh doesn't split an unquoted variable: `open $E …` with `E="--env A=1"` fails. Write each
`--env K=V` as its own argument.

## Launch with a probe

`src-tauri/src/probe.rs` (debug builds only):

- `FMESS_PROBE=<file.js>`: the file is the body of an async function (`await` is fine,
  it must `return`). It runs in the main window after `FMESS_PROBE_DELAY` s (default 15)
  and prints `[probe] <json>` to stderr. It gives up after `FMESS_PROBE_WAIT` s (default
  60, "no result"). A probe that waits for something only a person does (someone typing,
  the user pasting) sets it higher and keeps its own wait loop time-based. To chain two,
  wrap each in `await (async () => { … })()`.
- `FMESS_NO_INJECT=1` leaves fMess's page script out (WebKit and Facebook alone), to tell
  whether a cost is fMess's or WebKit's.
- `FMESS_WINDOW_SIZE=880x600` sizes the window first (logical px). The site shots and the
  Chrome reference use 880×600.
- `FMESS_SNAPSHOT=<file.png>` (macOS) saves the page as the probe left it, through WebKit
  (no Screen Recording permission needed), at screen scale (1760×1200 on Retina).

```sh
pkill -f "fMess.app/Contents/MacOS/fmess"; sleep 1
# zoom 1 to compare with the target at 100%, and no theme of its own (the probe brings one)
python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["zoom"]=1; d["theme"]=None; json.dump(d, open(p,"w"), indent=2)' "$F"
rm -f $S/probe.log
open --env FMESS_PROBE=$S/apply.js --env FMESS_PROBE_DELAY=12 --env FMESS_WINDOW_SIZE=880x600 \
     --env FMESS_SNAPSHOT=$S/$APP-light.png --stderr $S/probe.log \
     src-tauri/target/debug/bundle/macos/fMess.app
# then wait until the log has "[snapshot]" or "no result" (Monitor, or shoot.sh's polling loop)
grep '\[probe\]\|\[snapshot\]' $S/probe.log | cut -c1-2000
```

`themes/tools/run.sh` does the launch, the wait and the printing in one go (no snapshot
unless you pass `--env FMESS_SNAPSHOT=…`).

### Windows and Linux

`npm install` once, then `npx tauri build --debug --no-bundle`, and run the binary with the
variables set; it prints `[probe] …` to its own stderr. Quit the installed fMess first.
`bench.js` and `typing.js` only define a function there: append
`return await window.__fmessBench();` (or `__fmessTyping`) to a copy, as run.sh does.

```sh
FMESS_PROBE=$S/apply.js FMESS_WINDOW_SIZE=880x600 ./src-tauri/target/debug/fmess 2>$S/probe.log   # Linux
```
```powershell
$env:FMESS_PROBE="$S\apply.js"; $env:FMESS_WINDOW_SIZE="880x600"; .\src-tauri\target\debug\fmess.exe 2> $S\probe.log   # Windows
```

There is no `FMESS_SNAPSHOT` there: ask the user for a screenshot of the window. The
settings folder is in SKILL.md ("Where things are"): back up `settings.json` and
`.window-state.json` (`FMESS_WINDOW_SIZE` lands there) and restore both the same way.

## apply.py: the built CSS plus a measuring body

There's no rebuild per CSS change. Build the theme, then wrap it into a probe:

```sh
python3 themes/$APP/build.py $S/$APP.css          # a recolour: its .css is already built
python3 themes/tools/apply.py $S/$APP.css $S/apply.js $S/measure.js           # light
python3 themes/tools/apply.py $S/$APP.css $S/apply-dark.js $S/measure.js --dark
```

A probe-applied theme lacks `UNDER_EVERY_THEME` (hooks.md).

**Snapshots are not the screen.** A `position: fixed` search field moved out of the list
showed in every WebKit snapshot and passed `elementFromPoint`, yet on the user's screen
WebKit clipped it away (a transformed ancestor). For anything moved across containing
blocks, ask the user to look, or avoid the move (hooks.md, `--fmess-search-box`).

**No focus in probes.** probe.rs calls `set_focus`, but macOS won't make a background-launched
app key: `:focus-within`, focus rings and focus events can't be checked by probes.

**Size limit:** a probe of about 800 KB (two copies of a 390 KB theme) never runs: no
result, not even from a `setTimeout` watchdog. Keep one copy of the theme per probe; to
change a few rules mid-probe, append a small `<style>` of just those rules.

**Demo text vs. moved elements:** demo-shot.js sorts a row's text by its position, so
anything the theme moves (Teams puts the row's time on the name's line) is emptied. Apply
a copy of the theme without those rules, run the demo, then add them back. That matters only for the
reply/link bar. For the final pass, test it as a built-in theme (Ship step), or prepend
that block.

`measure.js` returns the numbers to compare against the spec:

```js
const pick = (sel, props, pseudo) => {
  const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0);
  if (!el) return 'MISSING';
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el, pseudo);
  return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} ` +
    props.map((p) => `${p}=${cs.getPropertyValue(p)}`).join(' ');
};
return {
  dark: document.documentElement.hasAttribute('data-fmess-dark'), size: [innerWidth, innerHeight],
  rail: pick('[role="navigation"]', ['background-color', 'width'], '::before'),
  header: pick('[data-fmess-ui="chat-header"]', ['background-color', 'box-shadow', 'border-bottom-width']),
  bubble: pick('[role="main"] [data-message-id] [role="presentation"]', ['background-color', 'border-top-left-radius', 'padding-top', 'padding-left']),
  text: pick('[role="main"] [data-message-id] [dir="auto"]', ['font-family', 'font-size', 'line-height', 'color']),
  composer: pick('[data-fmess-ui="composer"]', ['background-color', 'border-top-left-radius', 'height']),
};
```

## Dark mode without touching Messenger's setting

`apply.py --dark` puts this before the measuring body (it's also the `DEMO_DARK` block of
demo-shot.js). Since 0.1.24 `data-fmess-dark` follows Facebook's own mark on `<html>`
(`__fb-dark-mode`/`__fb-light-mode`) as it changes, so the class change below is what flips
it; it lasts until Facebook rewrites the class or the page reloads. Measure or snapshot
right away.

```js
for (const el of document.querySelectorAll('.__fb-light-mode')) el.classList.replace('__fb-light-mode', '__fb-dark-mode');
document.documentElement.classList.add('__fb-dark-mode');
document.documentElement.setAttribute('data-fmess-dark', '');
document.documentElement.style.colorScheme = 'dark';
```

## Any language: marks, not labels

Changing the account's Facebook language is a settings change, so don't. Simulate a
translated Facebook instead: rewrite every aria-label and check that no themed style
changes.

```js
const props = ['display', 'order', 'background-color', 'background-image', '-webkit-mask-image', 'border-radius', 'visibility'];
const snap = () => [...document.querySelectorAll('[data-fmess-ui]')].flatMap((el) =>
  [el, el.querySelector('svg')].filter(Boolean).map((e, i) => `${el.getAttribute('data-fmess-ui')}${i ? ' svg' : ''}: ` +
    props.map((p) => getComputedStyle(e).getPropertyValue(p).slice(0, 40)).join(' | ')));
const english = snap();
for (const el of document.querySelectorAll('[aria-label]')) el.setAttribute('aria-label', `xx ${el.getAttribute('aria-label')}`);
await new Promise((r) => setTimeout(r, 300));
const translated = snap();
return { marks: [...new Set(english.map((l) => l.split(':')[0]))], changed: english.filter((l, i) => l !== translated[i]) };
```

`changed` must be empty. Open the details first if they're themed. Also grep the source for
aria-label selectors without a mark beside them:
`grep -n 'aria-label' $APP.src.css | grep -v 'data-fmess-ui'`. Each one is English-only.
Without the deep loop, that grep is the check.

## Snapshots of states that must be undone (reply bar, viewer, menus)

The snapshot is taken when probe.rs reads a result. To photograph a state and still undo
it in the same probe, hand over a result early and carry on:

```js
replyButton.click(); await sleep(1200);
window.__fmessProbe = JSON.stringify({ open: true });   // probe.rs snapshots now
await sleep(4000);
cancelButton.click();                                      // then undo
return 'done';
```

**Photo viewer.** A chat's photo opens in a layer over the page at the same address, with
no dialog role (2026-11-02); `/messenger_media` is no longer the way in. Click the photo's
`[role="button"]` wrapper in a message (`img` 100px or wider inside `[data-message-id]`),
not other links: shared posts and link cards open in the system browser (links.rs). fMess
finds the layer by the download link in its top bar (`a[download]` outside `[role="main"]`).
Escape closes it (Facebook's own), or the last button of that bar. `themes/tools/viewer.js`
does the whole check: flag set, the theme's title and badge hidden, double-click zoom,
Escape unzooms then closes.

## States only people cause: the typing dots

Nobody can make the other side type. Run `themes/tools/typing-dots.js` with
`FMESS_PROBE_WAIT=1500` and ask the user to keep a busy chat open in the debug app; it
returns when the dots show. Don't type to trigger them: the dots are the other person's.

## Typing in a test

Typing in a message box shows "typing…" to the people in that chat. Turn on `blockTyping`
in settings.json for the test (fMess then sends "not typing"), use a read chat, never press
Enter, insert with `document.execCommand('insertText', false, ch)`, and empty the box after
with `execCommand('selectAll')` + `execCommand('delete')` (works in WebKit; in Chrome it may
not: use real keys there). Return `boxEmptyAfter` and check it.

## Hover, tooltips, the reply bar

Facebook reacts to synthetic pointer events, so a probe can show hover states and tooltips:

```js
const at = (el) => { const b = el.getBoundingClientRect(); return { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }; };
const hover = (el) => { for (const t of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'])
  el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, at(el))); };
hover(document.querySelector('[data-fmess-ui="audio-call"]'));   // never click it
await new Promise((r) => setTimeout(r, 1500));
const tip = [...document.querySelectorAll('[role="tooltip"]')].find((t) => t.getBoundingClientRect().width > 0);
```

Then read the tooltip's text colour and the nearest drawn background, in light and in dark.
For the reply bar (`composer-bar`), hover the last message, click its button whose
aria-label starts with "Reply", measure, then click "Cancel reply" in the same probe and
return whether the bar is gone. English labels: check them first on a non-English
Facebook. A reply bar left open stays in that chat for the user.

## Performance

- `grep -n ':has(' $APP.src.css`: no `:has()` left of a combinator, none nested (hooks.md).
- Scroll speed with and without the theme (scrolling up loads older messages, which is
  harmless):
  ```js
  const log = document.querySelector('[role="main"] [role="log"]');
  let box = log; while (box && !(box.scrollHeight > box.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  let frames = 0; const t0 = performance.now();
  await new Promise((done) => { const step = () => { frames++; box.scrollTop -= 40; performance.now() - t0 < 2000 ? requestAnimationFrame(step) : done(); }; requestAnimationFrame(step); });
  return { fps: Math.round(frames / 2) };
  ```
  It should be about the same as with no theme. A big drop means a full-chat mask or
  background, or a broad `:has()`.
- `themes/tools/bench.js` measures more (rest, opening six read chats, scrolling the list
  and the messages): run it with the theme, with `theme: null`, and with
  `FMESS_NO_INJECT=1` for WebKit alone. Same window size each time.

## Side by side

- Reference: the target in your Chrome tab at 880×600 CSS px, 100% zoom, light and dark,
  `save_to_disk` into `spec/ref/` (or the user's screenshots, screenshots.md). fMess:
  `$S/$APP-light.png` / `-dark.png`, or the user's screenshots of fMess.
- **Reference at 880×600 when Chrome won't resize** (the user's window is fullscreen): in
  your tab add a style `html, body { width: 880px !important; height: 600px !important;
  overflow: hidden !important } html { background: #ff00ff !important }` (keep the body's
  own colour), hide banners, then `computer zoom` a region a bit larger than the page and
  crop away the magenta (`img box`, `img crop`). `zoom`/`screenshot` regions are in the
  screenshot's frame (e.g. 1400×865 for a 1864×1152 viewport), not CSS px. Popups
  (menus) are still placed against the real viewport and may overflow the 880 edge.
- Check the composer's last button in a chat whose quick reaction is the default 👍: it
  must not look like a working send button (hooks.md, like/send).
- Read both images and compare region by region ("What to look at"). Then compare the
  probe's numbers (or `pixels.py` on both pictures) with the spec tables. Numbers decide;
  the picture only shows where to look.
- Optional quick look in Chrome: open facebook.com/messages in your own tab and put the
  built CSS in a `<style>` there (Chrome tools' JavaScript, or the console). There's no
  inject.js in Chrome, so no marks and no `data-fmess-dark`: only the English-label
  fallbacks and the light colours get tested. Close the tab after.

## Demo screenshots (pull requests, the site)

Pictures that leave the machine show no real people. `themes/tools/shoot.sh <theme|none>
<out.png>` (macOS, debug build) writes `theme` and `zoom: 1` into the **real
settings.json** (back it up first), quits fMess, and runs `demo-shot.js` (made-up names,
pictures and lines; nothing real left visible).

- Variants: copy demo-shot.js, prepend `const DEMO_LANG = 'vi';` and/or
  `const DEMO_DARK = true;` (and `const DEMO_CHAT = '<thread id>';` to try one chat
  first; keep that copy out of git), and pass `DEMO=<that file>`.
- The theme must be known to the debug build (built-in, after the Ship step), or pass
  `none` and prepend the apply snippet (`apply.py` output without its body) to the demo
  copy.
- For the site: four shots per theme, `shot-<app>.webp`, `-vi`, `-dark`, `-vi-dark`, at
  1760×1200 WebP like the others (`sips` can read WebP but not write it).
- On Windows and Linux: no shoot.sh. Ask the user to open a chat with only their own test
  messages, or blur names and pictures before sharing.

## Restore (always, also after a failure)

```sh
pkill -f "fMess.app/Contents/MacOS/fmess"; sleep 1
cp "$S/settings.backup.json" "$HOME/Library/Application Support/io.github.toanbku.fmess/settings.json"
cp "$S/window-state.backup.json" "$HOME/Library/Application Support/io.github.toanbku.fmess/.window-state.json"
open -a fMess
```

On Windows and Linux, quit the debug binary, copy the backups back into the settings
folder (SKILL.md, "Where things are"), and start the user's fMess again. Restore while no
fMess runs: a running fMess writes its settings back on changes. Remove any theme file
you put in fMess's `themes/` folder that the user didn't ask to keep. Close your Chrome
tabs.
