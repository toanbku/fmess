# Makes png/ and emoji.css: Fluent Emoji 3D (MIT, github.com/microsoft/fluentui-emoji)
# for the emoji Messenger shows most. Needs Pillow, imagequant and zopfli:
#   python3 make.py <cache dir>     downloads the 256px PNGs into <cache dir> once
#
# Messenger draws every emoji as <img src="…/emoji.php/v9/<hash>/<dpr>/<size>/<name>.png">:
# in text, reaction pills, the reaction picker and the full emoji list. <name> is the
# codepoints in lowercase hex joined by "_", without FE0F (❤️ = 2764, 🏳️‍🌈 = 1f3f3_200d_1f308).
import base64, json, os, sys, urllib.parse, urllib.request
from PIL import Image
import imagequant
from zopfli.png import optimize

SIZE, COLOURS = 64, 96  # 64px = 32 css px on a 2x screen (the reaction picker)
GROUPS = [
    ("Messenger's quick reactions, and the older angry face", [
        ("2764", "Red heart"), ("1f606", "Grinning squinting face"), ("1f62e", "Face with open mouth"),
        ("1f622", "Crying face"), ("1f621", "Pouting face"), ("1f44d", "Thumbs up"), ("1f620", "Angry face")]),
    ("Smileys", [
        ("1f600", "Grinning face"), ("1f603", "Grinning face with big eyes"), ("1f604", "Grinning face with smiling eyes"),
        ("1f601", "Beaming face with smiling eyes"), ("1f605", "Grinning face with sweat"), ("1f602", "Face with tears of joy"),
        ("1f923", "Rolling on the floor laughing"), ("1f972", "Smiling face with tear"), ("1f979", "Face holding back tears"),
        ("263a", "Smiling face"), ("1f60a", "Smiling face with smiling eyes"), ("1f607", "Smiling face with halo"),
        ("1f642", "Slightly smiling face"), ("1f643", "Upside-down face"), ("1f609", "Winking face"), ("1f60c", "Relieved face"),
        ("1f60d", "Smiling face with heart-eyes"), ("1f970", "Smiling face with hearts"), ("1f618", "Face blowing a kiss"),
        ("1f61a", "Kissing face with closed eyes"), ("1f60b", "Face savoring food"), ("1f61b", "Face with tongue"),
        ("1f61d", "Squinting face with tongue"), ("1f61c", "Winking face with tongue"), ("1f92a", "Zany face"),
        ("1f928", "Face with raised eyebrow"), ("1f913", "Nerd face"), ("1f60e", "Smiling face with sunglasses"),
        ("1f929", "Star-struck"), ("1f973", "Partying face"), ("1f60f", "Smirking face"), ("1f612", "Unamused face"),
        ("1f61e", "Disappointed face"), ("1f614", "Pensive face"), ("1f615", "Confused face"), ("1f641", "Slightly frowning face"),
        ("1f62b", "Tired face"), ("1f629", "Weary face"), ("1f97a", "Pleading face"), ("1f62d", "Loudly crying face"),
        ("1f624", "Face with steam from nose"), ("1f92c", "Face with symbols on mouth"), ("1f92f", "Exploding head"),
        ("1f633", "Flushed face"), ("1f975", "Hot face"), ("1f976", "Cold face"), ("1f631", "Face screaming in fear"),
        ("1f628", "Fearful face"), ("1f630", "Anxious face with sweat"), ("1f613", "Downcast face with sweat"),
        ("1f917", "Hugging face"), ("1f914", "Thinking face"), ("1fae3", "Face with peeking eye"),
        ("1f92d", "Face with hand over mouth"), ("1fae1", "Saluting face"), ("1f92b", "Shushing face"), ("1fae0", "Melting face"),
        ("1f610", "Neutral face"), ("1f611", "Expressionless face"), ("1f636", "Face without mouth"), ("1f62c", "Grimacing face"),
        ("1f644", "Face with rolling eyes"), ("1f632", "Astonished face"), ("1f971", "Yawning face"), ("1f634", "Sleeping face"),
        ("1f924", "Drooling face"), ("1f635", "Knocked-out face"), ("1f922", "Nauseated face"),
        ("1f92e", "Face vomiting"), ("1f637", "Face with medical mask"), ("1f911", "Money-mouth face"),
        ("1f608", "Smiling face with horns"), ("1f921", "Clown face"), ("1f4a9", "Pile of poo"), ("1f47b", "Ghost"),
        ("1f480", "Skull"), ("1f648", "See-no-evil monkey"), ("1f649", "Hear-no-evil monkey"), ("1f64a", "Speak-no-evil monkey")]),
    ("Hearts", [
        ("1f9e1", "Orange heart"), ("1f49b", "Yellow heart"), ("1f49a", "Green heart"), ("1f499", "Blue heart"),
        ("1f49c", "Purple heart"), ("1f5a4", "Black heart"), ("1f90d", "White heart"), ("1f494", "Broken heart"),
        ("1f495", "Two hearts"), ("1f496", "Sparkling heart"), ("1f497", "Growing heart"), ("1f49e", "Revolving hearts"),
        ("2763", "Heart exclamation"), ("2764_200d_1f525", "Heart on fire"), ("1f48b", "Kiss mark")]),
    ("Hands (default skin tone only)", [
        ("1f44e", "Thumbs down"), ("1f44c", "OK hand"), ("270c", "Victory hand"), ("1f91e", "Crossed fingers"),
        ("1f91f", "Love-you gesture"), ("1f919", "Call me hand"), ("1f44b", "Waving hand"), ("1f44f", "Clapping hands"),
        ("1f64c", "Raising hands"), ("1f64f", "Folded hands"), ("1f4aa", "Flexed biceps"), ("1f91d", "Handshake"),
        ("1faf6", "Heart hands"), ("1f449", "Backhand index pointing right"), ("1f448", "Backhand index pointing left"),
        ("261d", "Index pointing up"), ("1f44a", "Oncoming fist")]),
    ("Things", [
        ("1f525", "Fire"), ("1f4af", "Hundred points"), ("2728", "Sparkles"), ("1f389", "Party popper"),
        ("1f382", "Birthday cake"), ("1f381", "Wrapped gift"), ("1f339", "Rose"), ("1f338", "Cherry blossom"),
        ("1f440", "Eyes"), ("1f4a4", "Zzz"), ("1f4a6", "Sweat droplets"), ("2b50", "Star"), ("2705", "Check mark button"),
        ("274c", "Cross mark"), ("2753", "Red question mark"), ("1f37b", "Clinking beer mugs"), ("1f4b0", "Money bag")]),
]
REPO = 'microsoft/fluentui-emoji'
tree = []

def fetch(cache, code, folder):
    """The 256px 3D PNG (default skin tone), checked against the folder's metadata.json."""
    path = f'{cache}/{code}.png'
    if not os.path.exists(path):
        if not tree:
            url = f'https://api.github.com/repos/{REPO}/git/trees/main?recursive=1'
            tree.extend(x['path'] for x in json.load(urllib.request.urlopen(url))['tree'])
        get = lambda p: urllib.request.urlopen(f'https://raw.githubusercontent.com/{REPO}/main/' + urllib.parse.quote(p)).read()
        meta = json.loads(get(f'assets/{folder}/metadata.json'))
        name = '_'.join(c for c in meta['unicode'].lower().split() if c != 'fe0f')
        assert name == code, (code, folder, meta['unicode'])
        pngs = [p for p in tree if p.startswith(f'assets/{folder}/') and p.endswith('.png') and '/3D/' in p]
        pick = [p for p in pngs if '/Default/3D/' in p] or [p for p in pngs if p.count('/') == 3]
        assert len(pick) == 1, (code, folder, pngs)
        open(path, 'wb').write(get(pick[0]))
    return path

def shrink(src, dst):
    im = Image.open(src).convert('RGBA').convert('RGBa').resize((SIZE, SIZE), Image.LANCZOS).convert('RGBA')
    imagequant.quantize_pil_image(im, dithering_level=1.0, max_colors=COLOURS).save(dst)
    data = optimize(open(dst, 'rb').read())
    open(dst, 'wb').write(data)
    return data

here = os.path.dirname(os.path.abspath(__file__))
cache = sys.argv[1]
os.makedirs(f'{here}/png', exist_ok=True)
css = ['/* Emoji: Fluent Emoji 3D from github.com/microsoft/fluentui-emoji (MIT, see\n'
       '   emoji/LICENSE-fluentui-emoji), the same designs Teams uses. Messenger draws\n'
       '   every emoji as an <img> from emoji.php named by its codepoints (text,\n'
       '   reaction pills, reaction picker); content swaps the picture and keeps\n'
       '   the size Messenger set. Made by emoji/make.py. */']
count = 0
for title, items in GROUPS:
    css.append(f'\n/* {title} */')
    for code, folder in items:
        data = shrink(fetch(cache, code, folder), f'{here}/png/{code}.png')
        css.append(f'img[src*="/{code}.png"] {{ content: url("data:image/png;base64,{base64.b64encode(data).decode()}") }}')
        count += 1
open(f'{here}/emoji.css', 'w').write('\n'.join(css) + '\n')
print(count, 'emoji,', os.path.getsize(f'{here}/emoji.css'), 'bytes')
