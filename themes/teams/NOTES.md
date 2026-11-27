# Teams theme: notes

Built 2026-11-02 from a `spec/` measured in the maintainer's account (teams.live.com/v2,
Fluent UI v9 tokens; not in git: it holds screenshots of real chats). `teams.src.css` +
`icons.json` + `emoji/emoji.css` (Fluent Emoji, MIT, from the emoji agent) →
`python3 build.py` → `src-tauri/themes/teams.css` (429 KB, 338 KB of it emoji).

## What maps to what

| Teams | Messenger / fMess hook | How |
|---|---|---|
| Window #ebebeb / #0a0a0a | `html`, `body`, the nav's parent | `--tm-window` |
| Title bar, 48px | `html[data-fmess-chats]::before` (band, z-index 0), `--header-height: 48px` in the chats; the macOS drag strip made 48px with a hole for the search | the window buttons stay where macOS puts them |
| Title-bar search box, centred | fMess's own `#fmess-search-box` (`--fmess-search-box: 1`), which focuses Messenger's field; that field stays in the list, folded until used (moving it with `position: fixed` looked right in snapshots but WebKit clipped it on screen) | 32px, 8px corners, 468px or less; "Search" over an English Facebook |
| "…" (Settings and more) + avatar with presence, top right | `--fmess-window-buttons: settings -53 8 32, account -12 8 32` (new inject.js hook), pictures in `body::before` | open fMess's Settings / account menu; hover = Teams' 70% white pill |
| App bar, 68px: Teams' logo on top (the window buttons hold its title-bar row), Chat selected (gradient filled icon), Meet, People, Communities, Calendar, Activity | `[data-fmess-list]` `padding-left: 68px`, `::before` (colour, hover cell), `::after` (one masked layer); `--fmess-buttons` for hover | outline icons in #242424 (Teams' colorNeutralForeground1, measured), Copilot as Teams' colour picture (assets/copilot.png, rendered from Teams' own image, 48px); hovered: white slot, filled icon in the gradient, Teams' white tooltip with the app's name (`data-fmess-hover`); they do nothing |
| Sidebar toggle (title bar) | `sidebar` in `--fmess-window-buttons`, `body::after` | folds the app bar away as Teams does (`data-fmess-sidebar-collapsed`): no rail, logo, icons, badge or tooltips; the chat list starts at the window's edge |
| Unread badge on Chat | `html[data-fmess-unread]::after` | red counter at the icon's corner |
| "Chat" title row (61px), its icons, a line | the row holding `#fmess-account`, `h1`, `[data-fmess-ui="list-menu"]` (more-horizontal-20: it opens Messenger's menu), `a[href="/messages/new/"]` (compose-20) | 18px/700 at 32px in; "Chat" over an English Facebook, Messenger's title otherwise |
| Filter pills row (41px), a line | `[role="tab"]` and its row | 24px pills, #d1d1d1 line, 32px in; selected = brand fill |
| Chat rows | `[role="row"] a[role="link"]` | 52px, 36px pictures (`zoom`), 14/12px type; the time on the name's line at the right (" · " hidden, gone while hovered); read rows grey (`:not(:has([role="button"]))` = no unread dot), selected white, hover 70% white + ring |
| Chat card | `[role="main"]` | white, 10px corners, shadow8, 8px from the window edges |
| Header | `chat-header`, `audio-call`, `video-call`, `info` | 20px bold name, 32px avatar; video before audio in brand purple (filled), divider, "more" for info |
| Bubbles | `--chat-*` vars | 12px corners, 8/12 padding, 14/20 type; yours #e8ebfa / #2b2b40, theirs #f5f5f5 / #1f1f1f |
| Sender name (groups) | `[data-scope="messages_table"] h4 span` | 12px #616161 |
| Dates | `[data-scope="date_break"]` | plain 12px grey text |
| Reactions | the pill under a bubble (structural) + Fluent Emoji | white pill, 1px #e0e0e0 line |
| Seen | the reader's 14px picture (structural) | Teams' brand eye |
| Composer | `composer`, `emoji`, `attach`, `more-actions`, like/`send` | 1px #e0e0e0 box, 6px corners, 2px brand line while focused; emoji, attach, +, │, send |
| Quote card in the box (replying, link preview) | `composer-bar` + `composer` as one bordered box; the bar's content as Teams' card | #fafafa, 1px #f0f0f0, 4px corners, shadow2, 3px #c7c7c7 bar, 12px grey name line, 14px dark text, 20px X; dark #242424 / #3d3d3d / #757575 (bar UNMEASURED) |
| Hover actions card | Messenger's react / reply / more (by icon) + fMess's quick reactions (`--fmess-quick-reactions`) | above the message (theirs from its start, yours ending at its end), white, 8px corners, shadow16: 👍 ❤️ 😆 😮, add-reaction, divider, reply, more |
| Tooltips | `[role="tooltip"]` | white card (dark in dark), 12px text, 4px corners, drop shadow; not inverted |
| Menus | `[role="menu"]` (not reactions) | 4px corners, shadow16, 32px items #424242, grey hover, no arrow |
| Focus ring | `--focus-ring-*` | Fluent's 2px black (white in dark) |
| Font | font stack | Teams' own stack, nothing bundled |

## What Messenger can't have

- The title bar's sidebar toggle and Teams logo (no such controls; the window buttons sit there on macOS).
- Names above every incoming message group in 1:1 chats, section headers (Favorites / Chats), "Last read" line, hover-only timestamps: Messenger doesn't render them.
- The hover card's pencil (edit) on your messages: Messenger's own actions are react, reply, more; editing stays in "more". Theirs sit from the message's start, not ending at its end as in Teams. The hover time is Messenger's tooltip, not Teams' plain text.
- Words ("Chat", "Search", "Type a message") only over an English Facebook; other languages keep Messenger's own.
- The Chat / Files / Photos tabs: left out (the "Chat" label would be English-only and do nothing).
- Typing indicator (Teams' animated balls): no mark and can't be triggered without typing; it keeps Messenger's dots in the bubble colours.
- Teams' account card at the avatar: fMess's native menu opens instead.
- Calls keep Facebook's look (call windows get no theme).

## Known differences from Teams

- Messenger's "All" tab is always selected, so one purple pill shows; Teams shows none selected.
- Search results stay in the list (Messenger's typeahead panel), not in a popup under the box; while searching, Messenger's back button sits left of the box. The box is Teams' CSS fallback width (468px, less on narrow windows), not its JS-computed one.
- The send arrow on an empty box is a picture (no clicks), in #424242 as Teams'; with text it's Messenger's send in brand purple (Teams' "has text" state is UNMEASURED).
- Composer box is 48px tall (Teams 46); chat header 57px (Teams 61).
- Reaction pills stay where Messenger puts them (bottom corner of the bubble), not under its start.
- Group chats show one eye per reader picture.
- Unread badge colour/size: UNMEASURED in Teams (no badge on screen); Fluent's danger counter used.
- The premium diamond isn't on the bar; the avatar is 28px in a 32px button (Teams: 40px). The app names in the tooltips are Teams' English ones.
- On macOS the band drags the window except over the search box and the two buttons.
- The list is at least 348px (68 bar + 280, Teams' minimum); Messenger's own minimum was 300.
- Scroll fps with the theme 52 vs 57 without (one 2 s run each, same chat).

## inject.js hooks this theme added

- `data-fmess-hover` / `data-fmess-window-hover`: the lit theme button's name (round 5), for Teams' app-bar tooltips.
- `sidebar` window button + `data-fmess-sidebar-collapsed` (round 6; was `list`, folding the chat list), and `data-fmess-reacted` after a quick reaction (the lead, round 4); tested with a 👍 on one of your own messages, then taken back.
- `--fmess-quick-reactions` (round 3): emoji buttons in a message's hover actions that pick that emoji in Messenger's picker; tested end to end once (a 👍 on one of your own messages, then taken back).
- `--fmess-search-box` (the lead, round 3): fMess's own search box, which the theme puts in the band.
- `--fmess-window-buttons` (round 2): theme buttons anywhere in the window, like
  `--fmess-buttons` but on `:root` and in window px; in the skill's hooks.md.
- Messenger's own thumbs-up is marked `like` (1537252), so no workaround here.
