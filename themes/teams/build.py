# Builds teams.css from teams.src.css: Teams' own icons go in as data: URLs,
# so the theme loads nothing. Usage: python3 build.py [out.css]
# (default: src-tauri/themes/teams.css, the built-in theme).
#   {{icon:name}}          url("data:image/svg+xml,…") of icons.json's <name>
#   {{svg:name:#hex}}      the same icon with its paths filled in <hex> (for
#                          backgrounds, where a mask can't recolour)
#   {{stack:44:a,b,…}}     icons a, b, … one under the other, 44px apart,
#                          each 24px wide (a mask for one icon per app-bar slot)
#                          ("_" leaves a slot empty)
#   {{svgfile:path}}       url("data:…") of an SVG file here (Teams' logo, assets/)
#   {{png:path}}           url("data:image/png;base64,…") of a PNG here (Copilot)
#   {{emoji}}              emoji/emoji.css, if it exists (Fluent Emoji, MIT),
#                          else nothing
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

def svg(name, fill=None):
    view_box, *paths = icons[name].split('|')
    colour = f' fill="{fill}"' if fill else ''
    body = ''.join(path_tag(p) for p in paths)
    return 'url("' + svg_url(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}"{colour}>{body}</svg>') + '")'

def stack(pitch, names):
    names = names.split(',')
    parts = []
    for i, name in enumerate(names):
        if name == '_':
            continue
        view_box, *paths = icons[name].split('|')
        body = ''.join(path_tag(p) for p in paths)
        parts.append(f'<svg y="{i * pitch}" width="24" height="24" viewBox="{view_box}">{body}</svg>')
    height = pitch * (len(names) - 1) + 24
    return 'url("' + svg_url(f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="{height}">{"".join(parts)}</svg>') + '")'

def svgfile(path):
    text = open(f'{here}/{path}', encoding='utf-8').read().strip()
    return 'url("' + svg_url(text) + '")'

css = open(f'{here}/teams.src.css', encoding='utf-8').read()
css = re.sub(r'\{\{stack:(\d+):([\w,_-]+)\}\}', lambda m: stack(int(m.group(1)), m.group(2)), css)
css = re.sub(r'\{\{svgfile:([\w./-]+)\}\}', lambda m: svgfile(m.group(1)), css)
css = re.sub(r'\{\{png:([\w./-]+)\}\}', lambda m: 'url("data:image/png;base64,' + base64.b64encode(open(f'{here}/{m.group(1)}', 'rb').read()).decode() + '")', css)
css = re.sub(r'\{\{icon:([\w-]+)\}\}', lambda m: svg(m.group(1)), css)
css = re.sub(r'\{\{svg:([\w-]+):(#[0-9a-fA-F]+)\}\}', lambda m: svg(m.group(1), m.group(2)), css)
emoji = f'{here}/emoji/emoji.css'
css = css.replace('{{emoji}}', open(emoji, encoding='utf-8').read().strip() if os.path.exists(emoji) else '/* (no emoji/emoji.css yet) */')
left = re.findall(r'\{\{[^}]*\}\}', css)
if left:
    sys.exit(f'unknown placeholders: {left}')
out = sys.argv[1] if len(sys.argv) > 1 else os.path.normpath(os.path.join(here, '..', '..', 'src-tauri', 'themes', 'teams.css'))
open(out, 'w', encoding='utf-8', newline='\n').write(css)
print(out, len(css))
