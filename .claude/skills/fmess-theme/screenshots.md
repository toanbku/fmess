# Working from screenshots alone

For when the look can't be measured live: no browser tools, a desktop-only app, or a look
that is gone (messenger.com closed in April 2026, so its purple look survives only in
pictures). The screenshots become the spec. Everything taken from them is an estimate:
mark it `screenshot` in the spec, never pass it off as measured.

## What to ask the user for

One message, all at once:

1. **The main window**, light: the chat list and an open chat, with messages from both
   sides. The same in dark. A window about 880×600 (or any size; say which).
2. **Close-ups** if they have them: the composer with some text typed; a message with a
   reaction and one that replies to another; a menu or tooltip; the left bar with its icons;
   a group chat.
3. **PNG files, not resized and not compressed**, and the screen's scale (2 on a Retina
   Mac or a 200% Windows screen, 1 on most others). Photos of a screen don't work.
4. A chat they don't mind an agent seeing. The pictures stay on their machine
   (`spec/` is gitignored), but you read them.

If the look is gone and they have only a few old pictures (from the web, a blog post, an
old screenshot), take what there is and tell them which parts will be guesses.

## Steps

1. Put the pictures in `themes/<app>/spec/ref/` (`light.png`, `dark.png`,
   `composer.png`…). Paths below are from the repo's root. Convert anything else to PNG. On macOS, convert to sRGB too, so the
   colours match CSS (pixels.py's help has the `sips` command): Mac screenshots are in the
   display's colour space.
2. **Scale.** Picture width ÷ window width in CSS px. When the user doesn't know: a
   screenshot over 2000 px wide of a normal window is almost always 2. Check it against
   something whose size you know (a 16px line of text, a 40px avatar).
3. **Look at the pictures yourself first** and write `spec/recon.md`: the regions you see
   (rail, list, header, messages, composer, details), what's in each, what the
   pictures don't show (hover states, menus, tooltips, dark mode if no dark picture).
4. **Colours** with `themes/tools/pixels.py`, nothing to install:
   ```sh
   python3 themes/tools/pixels.py themes/<app>/spec/ref/light.png --scale 2 --box 0,0,64,600     # the rail
   python3 themes/tools/pixels.py themes/<app>/spec/ref/light.png --scale 2 --box 300,200,40,16  # a bubble
   ```
   A box gives its three most common colours: the first is the background. For text, box
   a few letters: the background comes first, the darkest frequent colour after it is
   the text. A gradient (a colour that shifts across the window or down the chat):
   sample both ends and build a `linear-gradient`. Write
   `spec/tokens.md`: role, light hex, dark hex, `screenshot <file> <x,y>`.
5. **Sizes**: read edges from the picture, then confirm the ones that matter with points
   (where the rail's colour stops is its width). Divide by the scale. Round to whole px
   and write `screenshot ±1px` as the source in `spec/layout.md`.
6. **Type**: a picture can't name a font. Use the app's own font name if the user knows
   it, else its usual fallback stack with the system font. Sizes from the height of
   capital letters: a cap height of about 0.7 × the font size. Mark them as estimates.
7. **Icons**: a picture has no SVG paths. In order: the app's icons under an open licence
   (Fluent UI System Icons for Microsoft apps, Material Symbols for Google ones); for a
   Messenger look, Messenger's own icons, already on the page, recoloured; otherwise keep
   Messenger's icons recoloured and write "can't: no source" in the mapping table. Don't
   trace a vendor's icons or logo from the picture (SKILL.md, Licensing).
8. **Dark mode**: only from a dark picture. Without one, work out dark tokens from the
   light ones (dark surfaces, light text, the brand colour lifted for contrast), mark them
   `UNMEASURED: derived`, and tell the user.
9. **Hover, menus, tooltips**: if no picture shows them, keep Messenger's own, in the
   theme's colours, and note it in the mapping table.
10. Carry on with SKILL.md sections 3 to 6. In the test loop, put fMess's screenshot next
    to the reference one and compare region by region; numbers from pixels.py on both
    decide.

## The old messenger.com look (issue #33)

This means messenger.com as it looked before it closed (the request remembers "the purple
tint"), not the Facebook look of facebook.com/messages that fMess shows. The layout is
Messenger's own, so it is a **recolour** (SKILL.md, section 0): start from
`themes/starter/starter.css`, keep Messenger's icons, and take every colour from the
user's pictures, not from memory. If your messages shade from one colour to another,
`--chat-outgoing-message-background-gradient` is the hook: fMess paints it on your bubbles
fixed to the window (hooks.md, Messenger's variables), which no shipped theme has tried
yet, so test it in chats with and without their own chat theme. The starter's remap puts
the theme's colours over each chat's own colour, as the shipped themes do; keeping chats'
own colours instead is untried too: say which way it goes in the pull request.
