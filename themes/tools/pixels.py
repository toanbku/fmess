#!/usr/bin/env python3
"""Colours in a PNG screenshot, with nothing to install.

  python3 pixels.py shot.png --size                      width and height in pixels
  python3 pixels.py shot.png 120,40 300,200              the colour at each x,y
  python3 pixels.py shot.png --box 0,0,64,600            the most common colours in a box
  python3 pixels.py shot.png --scale 2 60,20 --box 0,0,32,300

Points and boxes (x,y,width,height) are in the picture's pixels, or in CSS px
with --scale N (2 for a Retina screenshot). A box gives its three most common
colours, so anti-aliased edges and text don't fool it: the first one is the
background. Colours print as hex (#rrggbb, or #rrggbbaa when not opaque).

Screenshots on macOS are in the display's colour space (Display P3 on most
Macs), so the numbers are a little off from the CSS colours. Convert to sRGB
first:  sips -m "/System/Library/ColorSync/Profiles/sRGB Profile.icc" in.png --out srgb.png
JPEG or WebP: convert to PNG first (sips -s format png, or ImageMagick's
`magick in.jpg out.png`).
"""
import struct, sys, zlib
from collections import Counter


def read_png(path, last_row):
    data = open(path, 'rb').read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        sys.exit(f'{path} is not a PNG: convert it first (see --help)')
    pos, idat, palette, trns = 8, [], None, None
    while pos < len(data):
        length, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b'IHDR':
            width, height, depth, colour, _, _, interlace = struct.unpack('>IIBBBBB', body)
        elif kind == b'PLTE':
            palette = body
        elif kind == b'tRNS':
            trns = body
        elif kind == b'IDAT':
            idat.append(body)
        elif kind == b'IEND':
            break
    if depth != 8 or interlace:
        sys.exit('only 8-bit, non-interlaced PNGs (screenshots are): re-save it with sips or magick')
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colour]
    stride = width * channels
    raw = zlib.decompress(b''.join(idat))
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(min(height, last_row + 1)):
        kind, line = raw[i], bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - channels] if x >= channels else 0
            if kind == 1:
                line[x] = (line[x] + a) & 255
            elif kind == 2:
                line[x] = (line[x] + prev[x]) & 255
            elif kind == 3:
                line[x] = (line[x] + (a + prev[x]) // 2) & 255
            elif kind == 4:
                b, c = prev[x], prev[x - channels] if x >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = line

    def pixel(x, y):
        px = rows[y][x * channels:(x + 1) * channels]
        if colour == 3:
            r, g, b = palette[px[0] * 3:px[0] * 3 + 3]
            a = trns[px[0]] if trns and px[0] < len(trns) else 255
            return r, g, b, a
        if colour in (0, 4):
            return px[0], px[0], px[0], px[1] if colour == 4 else 255
        return px[0], px[1], px[2], px[3] if colour == 6 else 255

    return width, height, pixel


def hex_of(rgba):
    r, g, b, a = rgba
    return f'#{r:02x}{g:02x}{b:02x}' + ('' if a == 255 else f'{a:02x}')


def main(argv):
    if not argv or argv[0] in ('-h', '--help'):
        sys.exit(__doc__)
    path, rest = argv[0], argv[1:]
    scale, points, boxes, size = 1.0, [], [], False
    while rest:
        arg = rest.pop(0)
        if arg == '--scale':
            scale = float(rest.pop(0))
        elif arg == '--box':
            boxes.append([float(n) for n in rest.pop(0).split(',')])
        elif arg == '--size':
            size = True
        else:
            points.append([float(n) for n in arg.split(',')])
    to_px = lambda v: int(round(v * scale))
    last = max([to_px(p[1]) for p in points] + [to_px(b[1] + b[3]) - 1 for b in boxes] + [0])
    width, height, pixel = read_png(path, last if (points or boxes) else 0)
    if size:
        print(f'{width}x{height}')
    for x, y in points:
        px, py = to_px(x), to_px(y)
        if not (0 <= px < width and 0 <= py < height):
            print(f'{x:g},{y:g}: outside the picture ({width}x{height})')
            continue
        print(f'{x:g},{y:g}: {hex_of(pixel(px, py))}')
    for x, y, w, h in boxes:
        x0, y0 = max(0, to_px(x)), max(0, to_px(y))
        x1, y1 = min(width, to_px(x + w)), min(height, to_px(y + h))
        counts = Counter(pixel(px, py) for py in range(y0, y1) for px in range(x0, x1))
        total = sum(counts.values()) or 1
        top = ', '.join(f'{hex_of(c)} {n * 100 // total}%' for c, n in counts.most_common(3))
        print(f'box {x:g},{y:g},{w:g},{h:g}: {top}')


if __name__ == '__main__':
    main(sys.argv[1:])
