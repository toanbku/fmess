# Builds whatsapp.css from whatsapp.src.css: icons, the doodle pattern and the
# font go in as data: URLs, so the theme loads nothing.
# Usage: python3 build.py [out.css]
# (default: src-tauri/themes/whatsapp.css, the built-in theme).
#   {{icon:name}}     url("data:image/svg+xml,…") of icons.json's <name>
#   {{doodle:#hex}}   the chat pattern (doodle-min.svg) drawn in <hex>, bare
#   {{font}}          roboto.woff2 as a bare data: URL (Roboto, Apache 2.0)
import base64, json, os, re, sys, urllib.parse
here = os.path.dirname(os.path.abspath(__file__))
icons = json.load(open(f'{here}/icons.json', encoding='utf-8'))

def path_tag(p):
    # One <path>; a leading E in icons.json means fill-rule="evenodd".
    # (No backslashes inside the f-string: Python before 3.12 refuses them.)
    evenodd = ' fill-rule="evenodd"' if p.startswith('E') else ''
    d = p[1:] if p.startswith('E') else p
    return f'<path{evenodd} d="{d}"/>'

def svg_url(svg):
    svg = svg.replace('"', "'")
    return 'data:image/svg+xml,' + urllib.parse.quote(svg, safe=" =:/'.,-")

def icon(name):
    view_box, *paths = icons[name].split('|')
    body = ''.join(path_tag(p) for p in paths)
    return 'url("' + svg_url(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}">{body}</svg>') + '")'

css = open(f'{here}/whatsapp.src.css', encoding='utf-8').read()
css = re.sub(r'\{\{icon:([\w-]+)\}\}', lambda m: icon(m.group(1)), css)
doodle = open(f'{here}/doodle-min.svg', encoding='utf-8').read()
css = re.sub(r'\{\{doodle:(#[0-9a-f]+)\}\}', lambda m: svg_url(doodle.replace('currentColor', m.group(1))), css)
css = css.replace('{{font}}', 'data:font/woff2;base64,' + base64.b64encode(open(f'{here}/roboto.woff2', 'rb').read()).decode())
out = sys.argv[1] if len(sys.argv) > 1 else os.path.normpath(os.path.join(here, '..', '..', 'src-tauri', 'themes', 'whatsapp.css'))
open(out, 'w', encoding='utf-8', newline='\n').write(css)
print(out, len(css))
