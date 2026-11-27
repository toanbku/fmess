#!/usr/bin/env python3
"""Wraps a built theme into a probe for the debug app (FMESS_PROBE, testing.md).

  python3 apply.py <theme.css> <out.js> [body.js ...] [--dark]

The probe puts the CSS in <style id="fmess-theme"> the way fMess does (without
UNDER_EVERY_THEME), waits 1.5 s, with --dark turns the page dark (in the page
only: nothing is saved, and it lasts until Facebook rewrites the class or the
page reloads), then runs the body files one after the other. The last body must
`return` something; with no body the probe returns the window size and mode.

Keep one copy of a theme per probe: a probe of about 800 KB never runs.
"""
import json, sys

DARK = """
for (const el of document.querySelectorAll('.__fb-light-mode')) el.classList.replace('__fb-light-mode', '__fb-dark-mode');
document.documentElement.classList.add('__fb-dark-mode');
document.documentElement.setAttribute('data-fmess-dark', '');
document.documentElement.style.colorScheme = 'dark';
await new Promise((r) => setTimeout(r, 800));
"""

DEFAULT_BODY = """
return { applied: true, dark: document.documentElement.hasAttribute('data-fmess-dark'), size: [innerWidth, innerHeight] };
"""


def main(argv):
    dark = '--dark' in argv
    args = [a for a in argv if a != '--dark']
    if len(args) < 2:
        sys.exit(__doc__)
    css_path, out_path, bodies = args[0], args[1], args[2:]
    css = open(css_path, encoding='utf-8').read()
    probe = (
        "let style = document.getElementById('fmess-theme');\n"
        "if (!style) { style = document.createElement('style'); style.id = 'fmess-theme'; }\n"
        f"style.textContent = {json.dumps(css)};\n"
        "document.documentElement.append(style);\n"
        "await new Promise((r) => setTimeout(r, 1500));\n"
    )
    if dark:
        probe += DARK
    probe += ''.join(open(b, encoding='utf-8').read() + '\n' for b in bodies) if bodies else DEFAULT_BODY
    open(out_path, 'w', encoding='utf-8').write(probe)
    print(out_path, len(probe))


if __name__ == '__main__':
    main(sys.argv[1:])
