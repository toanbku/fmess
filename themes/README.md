# fMess themes

A theme changes how Messenger looks inside fMess. It is one CSS file: fMess puts it in the
page, and you pick it in **Settings › Theme**. Messenger stays underneath, so everything
keeps working. Zalo, WhatsApp and Teams come with fMess. You can add your own, and send
one in for everybody.

## Use a theme file

1. **Settings › Theme › Add…** and pick the `.css` file. fMess checks it, keeps a copy and
   selects it. **Remove** takes the selected one away again.
2. The copy lives in fMess's data folder, named after the file:

   | System | Folder |
   |---|---|
   | macOS | `~/Library/Application Support/io.github.toanbku.fmess/themes/` |
   | Windows | `%APPDATA%\io.github.toanbku.fmess\themes\` |
   | Linux | `~/.local/share/io.github.toanbku.fmess/themes/` |

3. To work on a theme, edit that copy (or build straight into it) and **Reload**
   (Cmd+R on macOS, Ctrl+R on Windows and Linux). fMess reads the file again on every
   page load. No build of fMess is needed.

A theme is CSS and nothing more: at most 2 MB, no `@import`, and no `url()` other than
`data:` ones, so it can't load or send anything. Pictures, icons and fonts go inside the
file as `data:` URLs. fMess refuses a file that breaks these rules.

The file starts with a comment that names it:

```css
/* fMess theme
   name: My theme
   preview: #f3f6f6 #ffffff #eef3f2 #0f8b7d #ffffff
*/
```

`preview` is five colours for the theme's card in Settings: the bar at the left, the
chat list, the chat, your messages, theirs. Add `mode: light` only if the theme has no
dark colours: fMess then keeps Messenger light under it.

## Make one

**Your own colours** (Messenger's layout, new colours, rounder bubbles…): copy
[`starter/starter.css`](starter/starter.css), change the tokens at the top, light and dark,
and add it as above. Its comments say what each colour paints.

**A look like another app** (Discord, Slack, Telegram, the old messenger.com…): the repo
has a skill for coding agents in
[`.claude/skills/fmess-theme/`](../.claude/skills/fmess-theme/SKILL.md). Open the repo in
Claude Code (or point another agent at that folder), say which app, and give it
screenshots of that app, light and dark if you can. It works from the screenshots alone,
or measures the real web app if you're logged in to it in Chrome. It writes the theme
under `themes/<app>/` and tests it in fMess.

What a theme can reach (fMess's marks on the page, Messenger's colour variables, the
traps) is in [`hooks.md`](../.claude/skills/fmess-theme/hooks.md).

## What's here

| Folder | What |
|---|---|
| `starter/` | a small theme to copy: Messenger's layout in your colours |
| `whatsapp/` | the WhatsApp theme's source: `whatsapp.src.css` with `{{…}}` placeholders, its icons, chat pattern and font, and `build.py` |
| `teams/` | the Teams theme's source, the same way, plus Fluent Emoji (`emoji/`) and `NOTES.md` (what maps to what, what can't) |
| `tools/` | colour picking from screenshots, probes for the debug app, demo screenshots ([README](tools/README.md)) |

The built themes that ship with fMess are in `src-tauri/themes/`. Rebuild one with
`python3 themes/whatsapp/build.py` (or `teams/`): with no argument it writes
`src-tauri/themes/<name>.css`, byte for byte the same when nothing changed. Give it a
path to build somewhere else, such as your data folder above. Zalo's theme has no source
here: `src-tauri/themes/zalo.css` is edited by hand.

A theme's measurements and reference screenshots (`themes/<app>/spec/`) are not
committed: they come from someone's real account.

## Send a theme in

Fork the repo, make the theme, and open a pull request with:

- the source in `themes/<app>/` (plus `build.py` if it has placeholders), and the built
  file in `src-tauri/themes/<app>.css`, under 2 MB;
- the theme added to `BUILT_IN` in `src-tauri/src/themes.rs`, with `cargo test themes`
  (in `src-tauri/`) passing;
- screenshots of the theme in fMess, light and dark, showing only demo content or your
  own test chats: no one else's names, pictures or messages;
- where its icons, pictures and fonts come from, and their licences.

The maintainer takes care of the rest: the app icon that follows the theme, the website
and the release. Don't bump the version.

## Licences

Roboto (in `whatsapp/`) is under the Apache License 2.0. Fluent Emoji (in `teams/emoji/`)
is under the MIT licence, in `LICENSE-fluentui-emoji`. The WhatsApp, Teams and Zalo icons,
logos and patterns belong to their owners and are there only to make those looks. For a
new theme, prefer icons and fonts under an open licence (Fluent UI System Icons, Material
Symbols, fonts under OFL or Apache), never bundle a font that isn't (Segoe UI, SF, a
company's own), and say in the pull request where everything came from.
