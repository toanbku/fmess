---
name: fmess-theme
description: >-
  Make an fMess theme: a look copied from another chat app (measured in its web app,
  or worked out from screenshots alone), or a theme of the user's own (Messenger's
  layout in new colours). Covers layout, light and dark colours, type, icons, emoji,
  bubbles, composer, tooltips, menus and the avatar/account button; tests it in fMess;
  and readies it for Settings › Add…, a pull request or a built-in theme. Use for
  "make an fMess theme like Discord/Slack/Telegram/Teams", "theme giống <app>", "làm
  theme <app> cho fMess", "clone <app>'s look", "a theme from these screenshots", "the
  old messenger.com look", or when continuing or fixing the Zalo, WhatsApp or Teams
  themes. Everything it needs is in this repo, so it works in a fork.
---

# fMess theme

fMess wraps facebook.com/messages. A theme is **CSS only**: the page script (`inject.js`)
puts it in the page, and the user picks it in Settings. Messenger stays underneath. The
goal of a copied look: someone who uses `<app>` every day sees `<app>` at a glance, in
light and dark, at 880×600.

Zalo, WhatsApp and Teams are shipped. The maintainer explained the same things for each
one; this skill holds them, so run it end to end without asking again.

**Read before writing selectors:**
- [hooks.md](hooks.md): every hook fMess gives themes, Messenger's variables, DOM
  landmarks, the CSS and performance gotchas.
- [template.md](template.md): `whatsapp.src.css` section by section, the build.py and
  icons.json format, the decoration tricks.
- [extraction.md](extraction.md): recon snippets, the five agent briefs, safety and
  measuring rules (measuring a live web app).
- [screenshots.md](screenshots.md): working from screenshots alone.
- [testing.md](testing.md): trying the theme in fMess, probes, dark and language checks,
  screenshots, restoring the user's app.

## 0. Before anything: what, from where, for whom

"The user" is the person you work for: the maintainer, or someone with a fork. Their
Messenger account is real, and so is their account in the target app.

**What kind of theme:**

| Kind | Example | Start from | Steps |
|---|---|---|---|
| Recolour | Messenger in new colours, the old messenger.com purple | `themes/starter/starter.css` | 0, a short mapping (3), 4, 5, 6 |
| Copy of an app | Discord, Slack, Telegram | `themes/teams/` (newest), `themes/whatsapp/` (bundled font) | all |

A recolour keeps Messenger's layout and changes its colours (and maybe bubble radius,
fonts, the chat background). It needs no recon agents, no icons and often no build step.

**Where the look comes from:**

- **A. The live web app**, logged in, in Chrome, and you have the Chrome tools
  (Claude in Chrome: `mcp__claude-in-chrome__*`). Measure it (sections 1 and 2): exact
  values.
- **B. Screenshots only**: no browser tools, a desktop-only app, or a look that no longer
  exists (messenger.com closed in April 2026). Follow [screenshots.md](screenshots.md)
  instead of sections 1 and 2: estimated values, marked as such.
- Both: measure what you can reach, and take the rest from screenshots.

**Ask once**, in one message, for whatever the user hasn't said: the app or look; for B,
the screenshots (screenshots.md lists which); their system (macOS, Windows, Linux); and
whether the theme is for them only (Settings › Add…) or a pull request.

## Where things are

| What | Path |
|---|---|
| A theme's workspace | `themes/<app>/`: `<app>.src.css`, `build.py`, `icons.json`, assets, `NOTES.md` (committed); `spec/` with measurements and reference screenshots (gitignored: it comes from a real account) |
| Templates | `themes/starter/starter.css` (recolour); `themes/teams/` (the newest copy: `NOTES.md`, `@container` flags, window buttons, Fluent Emoji); `themes/whatsapp/` (bundled font, chat pattern); `src-tauri/themes/zalo.css` (hand-built, no source) |
| Built-in themes | `src-tauri/themes/<id>.css`, listed in `BUILT_IN` in `src-tauri/src/themes.rs` |
| Hooks | `src-tauri/src/inject/` (the page script in parts: 09-marks.js, 17-theme-hooks.js, 20-theme.js; `--fmess-buttons`, `#fmess-account`, `applyTheme`) |
| Tools | `themes/tools/` ([README](../../../themes/tools/README.md)): `pixels.py` (colours from screenshots), `apply.py` (theme → probe), `run.sh`, `shoot.sh` + `demo-shot.js`, `bench.js`, `typing.js`, `viewer.js`, `typing-dots.js` |
| Probe and snapshot | `src-tauri/src/probe.rs` (debug builds; the snapshot is macOS only) |
| App icon per theme | `branding/icon.py --themes`, `branding/brands/<id>.svg`, `src-tauri/icons/themes/<id>-{256,512}.png`, `src-tauri/src/icon.rs` |
| fMess's settings | `settings.json` (`theme`, `zoom`, `themeIcon`): macOS `~/Library/Application Support/io.github.toanbku.fmess/`, Windows `%APPDATA%\io.github.toanbku.fmess\`, Linux `~/.config/io.github.toanbku.fmess/` |
| Themes added in Settings | `themes/<id>.css` in fMess's data folder: macOS the same folder as above, Windows the same, Linux `~/.local/share/io.github.toanbku.fmess/` |

## Rules for every theme

- A copied look covers **all** of: layout, emoji, text and type, sending files (attach),
  the typing indicator, dark mode, tooltips, the settings/account menu at the avatar, and
  the app's icon set. Each gets a row in the mapping table, even when the row says
  "can't". Official icons (the app's own SVG paths) when you can measure them; otherwise
  see Licensing (section 7).
- Dark mode is not optional. Every colour is a token with a light and a dark value.
- Marks first, English aria-label only as a fallback. Facebook translates labels.
- Read-only in every real account: the target app and Messenger alike.
- Back up `settings.json` before a test that touches it, restore it after, and reopen the
  user's installed fMess. The debug and installed apps can't run side by side.
- Screenshots of real chats and measurements from a real account stay on the machine
  (`spec/` is gitignored). Pictures that leave it (pull request, site) show demo content
  only (testing.md, "Demo screenshots").
- Don't commit, push, tag or release unless the user asks.

## 1. Recon (A: the live app, you, in Chrome)

1. If `themes/<app>/spec/` exists, read it and continue from there.
2. Load the Chrome tools in one ToolSearch call (and the browser skill, if your client
   has one). `tabs_context_mcp`, then `tabs_create_mcp`: work only in your own tab. Open
   the target's web app (Teams `teams.microsoft.com` or `teams.live.com`, Slack
   `app.slack.com`, Telegram `web.telegram.org`, Discord `discord.com/app`). If it isn't
   logged in, stop and ask the user to log in. Never type credentials.
3. `resize_window` until `innerWidth × innerHeight` is 880×600 at 100% zoom. If the window
   is fullscreen it won't resize: constrain the page instead (testing.md, "Reference at
   880×600"). Apps that size panes by container queries (Teams) then lay out as at 880.
4. Run the recon snippet (extraction.md). Note the stable attributes (`data-tid`,
   `data-testid`, `data-icon`, roles), the token system and its version (Fluent
   `--colorNeutralBackground1…`, Material `--md-sys-…`), how dark mode is switched (class or
   attribute on html/body or a provider), and where dark values can come from without
   changing the user's settings.
5. Open a conversation that has no unread badge. Take a reference screenshot
   (`save_to_disk`) into `spec/ref/light.png`, and `dark.png` if dark can be seen without a
   settings change.
6. Write `spec/recon.md`: URL, token system and version, dark mechanism, a list of regions
   with their stable selectors, the reference size. This is the agents' brief.

## 2. Parallel extraction (A: five agents, one message)

Spawn five `general-purpose` agents in a single message, each with the shared preamble from
extraction.md plus its scope. Each writes one file in `themes/<app>/spec/`. An agent that
can't spawn others does the five scopes itself, one after another.

| Agent | File | Scope |
|---|---|---|
| Tokens and type | `tokens.md` | palette light + dark (and its source), fonts with fallback stacks, sizes per role, radii, shadows |
| Layout | `layout.md` | rail, title bar, list, header, message area, composer, details: geometry at 880×600 |
| Icons | `icons.md` + `../icons.json` | official SVG paths per action, reaction emoji set, official logo + licence |
| Messages | `messages.md` | bubbles, grouping, receipts, reactions, replies, link previews, attachments, emoji, dates, typing indicator, emoji picker |
| Popups and states | `popups.md` | tooltips, menus, the account/settings card at the avatar, hover/focus/selected, scrollbars, toasts |

The preamble carries the rules: read-only; never send, react, call, type in a message box,
change settings, or click a menu item; Escape after opening a popup; open only read
conversations; own tab only; ask before downloading anything; exact computed values, or
`UNMEASURED` with the reason. When they finish, read all five and list the UNMEASURED gaps.
Fill the ones that matter yourself, or leave them as known gaps.

## 3. Mapping table → `spec/mapping.md`

One row per region of the target: **target region → fMess/Messenger hook → technique →
can't**. Start from this (details in hooks.md). A recolour theme needs only the rows it
changes.

| Target region | Hook | Notes |
|---|---|---|
| Title bar / window strip | `html::before`, height `var(--fmess-title-bar)`; a taller band by raising `--header-height` in the chats | 28px macOS, 0 on Windows/Linux; `pointer-events: none`. Real controls in it: Messenger's search field moved there, `--fmess-window-buttons` (hooks.md) |
| App rail with app icons | `html[data-fmess-service="rail"]` in fMess's own rail web view (`ui/rail.html`, `data-fmess-rail` items) | decorative icons are pictures; Messenger, Instagram, settings and account act (see hooks.md) |
| Avatar + account/settings card | `--fmess-avatar`, the rail's `account` item, `account` in `--fmess-window-buttons` (anywhere in the page), or `#fmess-account` | opens fMess's **native** menu (name, Settings…, Log Out). The target's card can't be copied. |
| Unread count | `html[data-fmess-unread]::after` | `content: attr(data-fmess-unread)` |
| List title / logo | `[role="navigation"] h1 a` masked with a wordmark | |
| New chat, list ⋯ | `a[href="/messages/new/"]`, `[data-fmess-ui="list-menu"]` | svg mask |
| Search | `label:has(input[type="search"])`, `::placeholder` | written placeholder = one language |
| Filters | `[role="tablist"]`, `[role="tab"][aria-selected]` | can't add tabs Messenger lacks |
| Chat rows | `[role="row"] a[role="link"]`, `:hover`, `[aria-current="page"]` | painting your own hover: set `--hover-overlay: transparent` on the row link, or Messenger's layer covers part of the row in another shade (Teams' dark rows showed two tones) |
| Chat background / pattern | `[data-mw-file-dropzone]` + its `::before` layer | per-chat picture host transparent |
| Chat header + buttons | `chat-header`, `audio-call`, `video-call`, `info` (`[aria-expanded="true"]`) | extra target buttons only as decoration |
| Bubbles | `--chat-*` vars, `[data-message-id] [role="presentation"]`, `[dir="auto"]` | no group-position mark: no tails, no first/last radii |
| Date dividers | `[data-scope="date_break"] > span > span` | |
| Reactions | `--reaction-pill-*`, `reactions`, `more-emojis`, `img[alt="…"] { content: url() }` | the img swap is global |
| Composer, send files, emoji, like/send | `composer`, `attach`, `more-actions`, `emoji`, `sticker`, `gif`, `voice-clip`, `like`, `send`; flex `order`, `display: contents` | rich-text toolbars, formatting: can't. The default 👍 is marked `like` (hooks.md); check it in a chat that uses it |
| Reply / link preview bar | `composer-bar`, `--chat-replied-message-background-color` | UNDER_EVERY_THEME makes it grow |
| Typing indicator | no mark; a structure (hooks.md) | only someone else typing shows it: catch it with `themes/tools/typing-dots.js`. Messenger draws its picture 8px left of the messages' pictures; Teams aligns it |
| Read receipt, reaction pills, group sender names | structural selectors (hooks.md, "No mark, but a structure") | the img swap / `@container style()` flag |
| Details pane | `details` + `::before` title; inner rules with `@container style(--flag: 1)` | |
| Tooltips, menus, popovers | `[role="tooltip"]`, `[role="menu"]`, `--popover-background` + the island blocks | |
| Photo viewer | `html[data-fmess-media]` | in chats it is a layer at the same address (not `/messenger_media`, no dialog). Hide **everything** the theme draws or asks for: `html`/`body` pseudo-elements, the unread badge, `#fmess-search-box`, `--fmess-window-buttons` (scope them `:not([data-fmess-media])`). Issue #1 was a theme's title and badge over a photo |
| Calls | none: call windows get no theme | |
| Scroll bars | `--chat-scrollbar-thumb-color` | fMess owns the scroll bars |
| Type | font stack on `html :is(div, span, …)`, `@font-face` from a data URL | only openly licensed fonts bundled |

**Decorations** that Messenger lacks (rails, extra tabs, title bars, badges) are drawn on
`html`/`[role="navigation"]` pseudo-elements with `pointer-events: none`, and icons go in
as `-webkit-mask` layers. Clickable fakes go through `--fmess-buttons`. Never hide a real
button's box: hide its `svg *` and paint in its place (template.md).

## 4. Build

**Recolour:** copy `themes/starter/starter.css` to `themes/<app>/<app>.css`, rename it in
its opening comment, set the tokens (light and dark) and the five preview colours, and
add rows only for what you change. No placeholders, no build step: the file is the theme.

**Copy of an app:**

1. In `themes/<app>/`, copy `themes/teams/build.py` (or `themes/whatsapp/build.py` if you
   bundle a font) and adapt the file names and placeholders. Teams' adds
   `{{svg:name:#hex}}` (an icon filled in a colour, for backgrounds and `img` `content`)
   and `{{emoji}}` (an `emoji/emoji.css`, if present). Keep `icons.json` in the same
   `viewBox|d|Ed` format. Use forward slashes and `encoding='utf-8'` as those do, so it
   builds on Windows too.
2. Write `<app>.src.css` in WhatsApp's section order (template.md): opening comment (name,
   five preview colours) → `@font-face` (if allowed) → `--<app>-*` tokens on `:root` and
   `html[data-fmess-dark]` → Messenger variable remap → font stack → strip → rail → unread
   → viewer → list → chat background → header → dates → bubbles → composer → details →
   the island blocks. Facebook draws some things the other way round from the page
   (toasts such as "All chats loaded." or "Link copied", some tooltips): `.__fb-dark-mode`
   islands on a light page, `.__fb-light-mode` islands on a dark one. A remap on
   `.__fb-dark-mode, .__fb-light-mode` puts the page's colours into them, so add both
   island blocks: `html:not([data-fmess-dark]) .__fb-dark-mode` (light text, icons) and
   `html[data-fmess-dark] .__fb-light-mode` (dark text, icons), and reset there any button
   face the theme remaps (`--secondary-button-background`: a toast's close button). 0.1.33
   shipped white text on white toasts in dark mode in all three themes. The starter has
   both blocks ready.
3. Values come from the spec files, not from memory. Where the spec says UNMEASURED, choose
   and leave a `/* UNMEASURED: … */` comment.
4. **Fonts:** bundle only openly licensed ones (Roboto, Apache 2.0, was fine for
   WhatsApp). Proprietary fonts (Segoe UI for Teams, SF, the vendor's custom fonts) are not
   bundled. Use the target's own fallback stack with its font first, so users who have it
   (e.g. Windows) get it.
5. `python3 themes/<app>/build.py <out.css>`, then check the size: under 2 MB (WhatsApp is
   613 KB). No `@import`, and `data:` URLs only. Build into fMess's data folder to try it
   (section 5), and into `src-tauri/themes/<app>.css` when shipping.

## 5. Test (testing.md has the commands)

**Quick loop, any system, no Rust needed.** The installed fMess is enough:

1. The first time, add the theme with **Settings › Theme › Add…**: it checks the file,
   copies it into fMess's data folder as `themes/<id>.css` (folders above) and selects it.
   After that, build each change over that same file (testing.md, "Quick loop": don't
   name files there by hand).
2. **Reload** (Cmd+R on macOS, Ctrl+R on Windows and Linux): fMess reads the file again on
   every page load. If the theme disappears, the file broke a rule (2 MB, `@import`, a
   non-`data:` URL): add it with Add… again to see why.
3. Ask the user to look and send screenshots, light and dark (on macOS with a debug build
   the deep loop takes its own). Dark follows Messenger's own setting, so the user switches
   it (Messenger's settings, or the system when Messenger follows it); don't change it
   yourself.
4. Go through the checklist in testing.md ("What to look at").

**Deep loop, macOS with a debug build.** For measured comparisons, snapshots without
Screen Recording permission, the language check and the performance check:

1. Back up `settings.json` into your scratchpad before anything else.
2. Debug build once: `npm install`, then `npx tauri build --debug --bundles app`. CSS
   changes need no rebuild:
   `themes/tools/apply.py` wraps the built CSS into a probe, run with
   `FMESS_WINDOW_SIZE=880x600` and `FMESS_SNAPSHOT`, zoom 1, theme none.
3. Snapshot light and dark (`apply.py --dark`), and compare them side by side with
   `spec/ref/`: picture first to find differences, then the probe numbers against the
   spec. Fix, rebuild CSS, repeat until the regions match.
4. Languages: run the aria-label rewrite probe. `changed` must be empty, and every
   aria-label selector must have a mark beside it.
5. Run `tests/app/chat-check.sh` (skill fmess-chat-check; needs ffmpeg): bubbles, quotes,
   emoji messages and **toasts** (text and close button) in every built-in look, light and
   dark, on the pictures' pixels. It checks the themes in `src-tauri/themes/`, so build
   yours there first (Ship, step 2). It switches Messenger's own dark setting for each
   mode and puts it back at the end: ask the user before running it. Keep the debug window
   in view while it runs: Facebook shows no toast in a hidden page, and the check then
   fails with `no toast showed`.
6. Look at tooltips (light and dark), the ⋯ menu, the reaction picker, the photo viewer, the
   call buttons (look only), the reply bar (open, measure, cancel in the same probe), a group
   chat, a link preview, the details pane, and the `--fmess-title-bar: 0` case.
7. Performance: no `:has()` left of a combinator and none nested, full-chat pictures on a
   `will-change` layer, and `themes/tools/bench.js` (scroll, opening chats) the same with
   and without the theme. Since 0.1.28 fMess draws up to 120 fps on a 120 Hz Mac: compare
   with a no-theme run, not with 60.
8. Hide profile pictures (Settings › Appearance) on: fMess swaps people's pictures with
   `content: url(<initials svg>)`, so the theme must not use `content:` on them; resizing
   them with `zoom` or sizes is fine. Look at the list, header, messages and typing dots.
9. Restore: quit the debug app, copy the backup over `settings.json`, reopen the user's
   fMess (`open -a fMess`), close your Chrome tabs.

On Windows and Linux the probes run too (`FMESS_PROBE` and the rest work in any debug
build), but there is no snapshot: ask the user for screenshots instead (testing.md).

## 6. Ship

**For the user only:** done once it works through Settings › Add…. Tell them where the
file is, and that Remove in Settings takes it away.

**As a pull request** (a fork, or a branch of the main repo):

1. The source in `themes/<app>/` (plus `build.py` if it has placeholders). A recolour's
   source is its CSS file.
2. The built file: `python3 themes/<app>/build.py src-tauri/themes/<app>.css` (or copy the
   recolour's file there).
3. `src-tauri/src/themes.rs`: add `("<app>", include_str!("../themes/<app>.css"))` to
   `BUILT_IN` (card order = array order), and update the module comment ("Zalo, WhatsApp
   and Teams come with fMess"). Run `cd src-tauri && cargo test themes`.
4. Screenshots for the pull request, light and dark: demo content only (testing.md, "Demo
   screenshots"), or the user's own test chats that show no one else.
5. The pull request says what it copies, what it can't (the mapping table's "can't"
   column, short), where icons, pictures and fonts come from and their licences, and on
   which systems it was tried. Open it only when the user says so.

**The maintainer's part** (skip in a fork unless the user wants to do it; never the
release):

1. App icon:
   - Put the official logo in `branding/brands/<app>.svg`.
   - In `branding/icon.py`, add `<app>` to the `--themes` tuple. Give `brand()` a branch
     for how this logo sits in the 1024 square: Zalo's logo is the whole app icon; the
     default branch is WhatsApp-specific (bubble on a green squircle). Add its source and
     licence to the docstring.
   - Run `python3 branding/icon.py --themes $S/theme-icons`. Render the 256 and 512 SVGs
     with headless Chrome as the docstring says (`--headless=new
     --force-device-scale-factor=1 --default-background-color=00000000 --window-size=N,N
     --screenshot=…`, with its own `--user-data-dir`), into
     `src-tauri/icons/themes/<app>-256.png` and `-512.png`.
   - Add a match arm to `icon()` in `src-tauri/src/icon.rs`, and update its doc comment.
   - Update the hint in `ui/settings.html` ("With Zalo, WhatsApp or Teams, the icon
     shows…") in English and in the Vietnamese dictionary below it (`themeIconHint`). The
     Settings window speaks both since 0.1.24: write Vietnamese that reads naturally (the
     maintainer's bar: like genk.vn), not word-for-word.
   - A picture chosen in Settings › App icon (0.1.28) wins over the theme's icon: test with
     none chosen (`customIcon` false).
2. Debug build, choose the theme in Settings, check the Dock icon and the "App icon follows
   the theme" switch, then restore.
3. Docs and site: `grep -rn -i whatsapp README.md README.vi.md site/ ui/` and add the new
   theme everywhere it's listed:
   - `site/index.html`: carousel `<img data-shot>`, the theme buttons, `shot_title`,
     `shot_note`, `cmp_also`, the image list near the top.
   - `site/assets/site.js`: the VI strings for the same keys, plus `shot_<app>`.
   - `site/llms.txt`: the Themes line.
   - Screenshots `site/assets/shot-<app>{,-vi}{,-dark}.webp` (testing.md), and bump `?v=`.
4. Commit only when asked: plain English subject ("Teams theme", like the earlier
   "WhatsApp theme; …"), Co-Authored-By trailer.
5. Releases are the maintainer's alone (README, "Releasing", and their own notes). Don't
   bump versions or push tags.

## 7. Licensing

- **Icons.** Measured official icons of the target app went into the Zalo, WhatsApp and
  Teams themes with the maintainer's consent. For a new app, say in the pull request
  which icons are the vendor's; the maintainer decides. From screenshots there are no
  official paths: use an openly licensed set (Fluent UI System Icons, MIT; Material
  Symbols, Apache 2.0), or keep Messenger's own icons recoloured. Don't trace a vendor's
  icons or logo from a picture: that is still their artwork.
- **Emoji:** Fluent Emoji is MIT (Teams uses it). Other vendors' emoji sets: ask.
- **Logos** for the app icon: Zalo's and WhatsApp's are public domain on Wikimedia
  Commons (icon.py docstring). Prefer such a source, and write the licence down.
- **Fonts:** OFL or Apache fonts may be bundled. Never bundle proprietary fonts (Segoe UI,
  SF Pro, vendor fonts): use the fallback stack with the vendor's font first.
- **Pictures:** no vendor screenshots or marketing pictures in the repo or on the site,
  only fMess's own shots with demo content.

## Done when

- [ ] spec/ has what the kind of theme needs (a copy: tokens, layout, icons, messages,
      popups, mapping; from screenshots: screenshots.md), with gaps and estimates marked
- [ ] Light and dark match the references region by region at 880×600 (or, from
      screenshots, as closely as the pictures allow)
- [ ] No themed style depends on an English label; the rewrite probe shows no change
      (macOS deep loop), or every aria-label selector has a mark beside it
- [ ] Tooltips are readable in both modes; viewer, calls, reply bar and details are fine
- [ ] Toasts readable, close button visible, light and dark (both island blocks;
      `tests/app/chat-check.sh` on macOS)
- [ ] Nothing the theme draws shows over a photo; typing dots line up with the messages;
      Hide profile pictures on still looks right
- [ ] Scrolling as smooth as without the theme (`themes/tools/bench.js` on macOS)
- [ ] Under 2 MB, `cargo test themes` passes, no broad `:has()`
- [ ] Shipping: icon, Settings hint, site, llms.txt updated (maintainer)
- [ ] The user's settings (and `.window-state.json`) are restored, their fMess reopened,
      Chrome tabs closed, the target app's own settings put back as found
