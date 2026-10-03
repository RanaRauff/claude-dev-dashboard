#!/usr/bin/env python3
"""Build a dev-dash "buddy pack": a small animated character for the header's beat slot (/dash-beat buddy <name>).

The slot is 5 terminal rows (4 in a narrow pane) by about 24-30 columns. With half blocks (two square pixels per
cell) that is about 30 x 10 pixels, so a buddy is pixel art about 10 pixels tall. dev-dash draws the scene itself:
the sprite walks, flies, hops or sleeps along the slot while an effect (fire, sparks, a shadow ball, water, z's)
fills the rest. A pack is one JSON file (format v2): a palette, a mouth point, and per mood (idle, working, needs)
a motion, an effect, a frame time and a few frames. dev-dash only reads that file: it runs nothing and uses no network.

Two ways to make one:

1. From a hand-drawn sprite file (the sharpest result at this size):

       python tools/make-buddy.py my-buddy.sprite

   A sprite file is plain text:

       name ember                    # the pack name, used by /dash-beat buddy <name>
       mouth 9 4                     # where effects come out, in pixels, with the sprite facing right
       colour O #f08838              # one letter or digit per colour
       colour K #3a3a48
       mood idle sit zzz 700         # mood <idle|working|needs> <motion> <effect> [ms per frame]
       ..OO..
       .OKOO.                        # one frame: rows of palette letters, '.' is clear
       ..OO..
                                     # a blank line starts the next frame
       ..OO..
       .OOOO.
       mood working walk dust 160
       ...

   Motions: sit stand walk run fly float hop shake.  Effects: none zzz sparks thunder fire shadow water leaves dust.
   Draw the sprite facing right, at most 16 rows (10 fits 5 terminal rows exactly).

2. From animated GIFs, scaled down by a pixel-art-aware filter (crisp palette colours, outlines dropped, small
   bright features such as eyes and cheeks kept):

       python tools/make-buddy.py charizard --idle charizard.gif --working firing.gif \\
           --motion idle=sit,working=fly,needs=hop --fx working=fire,needs=fire

   Big painted sprites lose most of their detail at 10 pixels; small, flat sprites survive best.

The result goes to ~/.claude/dev-dash/buddy/<name>.json (--out puts it elsewhere). --preview <png> also writes a
contact sheet of the frames. Use it with:  /dash-beat buddy <name>

The GIF decoder is a small Python port of the LZW/GIF decoding in pokemanion (MIT, github.com/khatriadbhut/pokemanion).
Sprites are other people's artwork: make packs from art you are allowed to use, and do not commit them to this repo.
"""

import argparse
import colorsys
import json
import math
import os
import re
import struct
import sys
import zlib

MOTIONS = ('sit', 'stand', 'walk', 'run', 'fly', 'float', 'hop', 'shake')
EFFECTS = ('none', 'zzz', 'sparks', 'thunder', 'fire', 'shadow', 'water', 'leaves', 'dust')
MOODS = ('idle', 'working', 'needs')
DEFAULT_MOTION = {'idle': 'sit', 'working': 'walk', 'needs': 'hop'}
DEFAULT_FX = {'idle': 'zzz', 'working': 'dust', 'needs': 'sparks'}
LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
MAX_FRAMES, MAX_H, MAX_W, MAX_PALETTE = 12, 16, 40, 32
COMMENT = re.compile(r'(^|\s)#(?![0-9a-fA-F]{6}\b).*$')  # a comment, but not a #rrggbb colour


# ----------------------------------------------------------------------------------------------------------------- GIF
def lzw(data, min_size, count):
    clear = 1 << min_size
    end = clear + 1
    size = min_size + 1
    table = [bytes([i]) for i in range(clear)] + [b'', b'']
    out = bytearray()
    bits = 0
    nbits = 0
    pos = 0
    prev = None
    while len(out) < count:
        while nbits < size and pos < len(data):
            bits |= data[pos] << nbits
            nbits += 8
            pos += 1
        if nbits < size:
            break
        code = bits & ((1 << size) - 1)
        bits >>= size
        nbits -= size
        if code == clear:
            table = table[: clear + 2]
            size = min_size + 1
            prev = None
            continue
        if code == end:
            break
        if prev is None:
            entry = table[code]
        elif code < len(table):
            entry = table[code]
            table.append(prev + entry[:1])
        else:
            entry = prev + prev[:1]
            table.append(entry)
        out += entry
        prev = entry
        if len(table) == (1 << size) and size < 12:
            size += 1

    return bytes(out[:count])


def sub_blocks(buf, pos):
    chunks = []
    while True:
        n = buf[pos]
        pos += 1
        if n == 0:
            break
        chunks.append(buf[pos:pos + n])
        pos += n

    return b''.join(chunks), pos


def decode_gif(buf):
    """Return (width, height, [(rgba bytes, delay_ms)]) with every frame composed onto the full canvas."""
    if buf[:3] != b'GIF':
        raise ValueError('not a GIF')
    w, h, packed = struct.unpack('<HHB', buf[6:11])
    pos = 13
    gct = None
    if packed & 0x80:
        n = 3 * (1 << ((packed & 7) + 1))
        gct = buf[pos:pos + n]
        pos += n
    canvas = bytearray(w * h * 4)
    frames = []
    delay, disposal, transp = 100, 0, None
    while pos < len(buf):
        b = buf[pos]
        pos += 1
        if b == 0x3B:
            break
        if b == 0x21:
            label = buf[pos]
            pos += 1
            if label == 0xF9:
                flags = buf[pos + 1]
                delay = max(20, struct.unpack('<H', buf[pos + 2:pos + 4])[0] * 10)
                disposal = (flags >> 2) & 7
                transp = buf[pos + 4] if flags & 1 else None
                pos += 6
            else:
                _, pos = sub_blocks(buf, pos)
        elif b == 0x2C:
            x0, y0, fw, fh, fl = struct.unpack('<HHHHB', buf[pos:pos + 9])
            pos += 9
            table = gct
            if fl & 0x80:
                n = 3 * (1 << ((fl & 7) + 1))
                table = buf[pos:pos + n]
                pos += n
            min_size = buf[pos]
            pos += 1
            data, pos = sub_blocks(buf, pos)
            idx = lzw(data, min_size, fw * fh)
            if fl & 0x40:  # interlaced: rows come in four passes
                order = []
                for start, step in ((0, 8), (4, 8), (2, 4), (1, 2)):
                    order += list(range(start, fh, step))
                rows = [None] * fh
                for i, r in enumerate(order):
                    rows[r] = idx[i * fw:(i + 1) * fw]
                idx = b''.join(rows)
            saved = bytes(canvas) if disposal == 3 else None
            for y in range(fh):
                for x in range(fw):
                    c = idx[y * fw + x]
                    if c == transp or table is None:
                        continue
                    cx, cy = x0 + x, y0 + y
                    if 0 <= cx < w and 0 <= cy < h:
                        o = (cy * w + cx) * 4
                        canvas[o:o + 4] = bytes((table[c * 3], table[c * 3 + 1], table[c * 3 + 2], 255))
            frames.append((bytes(canvas), delay))
            if disposal == 2:
                for y in range(fh):
                    for x in range(fw):
                        cx, cy = x0 + x, y0 + y
                        if 0 <= cx < w and 0 <= cy < h:
                            o = (cy * w + cx) * 4
                            canvas[o:o + 4] = b'\x00\x00\x00\x00'
            elif saved is not None:
                canvas[:] = saved
            disposal, transp = 0, None
        else:
            break

    return w, h, frames


# ----------------------------------------------------------------------------------------------------------------- PNG
def write_png(path, w, h, rgba):
    raw = b''.join(b'\x00' + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))

    def chunk(tag, body):
        return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body) & 0xFFFFFFFF)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


# ------------------------------------------------------------------------------------------------- pixel-art downscale
class Img:
    """RGBA pixels as tuples, row-major."""

    def __init__(self, w, h, px=None):
        self.w, self.h = w, h
        self.px = px if px is not None else [(0, 0, 0, 0)] * (w * h)

    def get(self, x, y):
        return self.px[y * self.w + x]


def img_of(w, h, rgba):
    return Img(w, h, [tuple(rgba[i:i + 4]) for i in range(0, len(rgba), 4)])


def luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def bbox(imgs):
    x0 = y0 = 10 ** 9
    x1 = y1 = -1
    for im in imgs:
        for y in range(im.h):
            for x in range(im.w):
                if im.px[y * im.w + x][3]:
                    x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)
    return (x0, y0, x1 + 1, y1 + 1) if x1 >= 0 else (0, 0, imgs[0].w, imgs[0].h)


def crop(im, box):
    x0, y0, x1, y1 = box
    x1, y1 = min(x1, im.w), min(y1, im.h)
    return Img(x1 - x0, y1 - y0, [im.px[y * im.w + x] for y in range(y0, y1) for x in range(x0, x1)])


def mirror(im):
    return Img(im.w, im.h, [im.px[y * im.w + (im.w - 1 - x)] for y in range(im.h) for x in range(im.w)])


def palette_of(imgs, merge=28, most=14):
    """The sprite's main colours: close shades merged, most used first."""
    counts = {}
    for im in imgs:
        for p in im.px:
            if p[3]:
                counts[p[:3]] = counts.get(p[:3], 0) + 1
    reps = []  # [weighted sum, count, representative]
    for c, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        for r in reps:
            if math.dist(c, r[2]) < merge:
                r[0] = [a + b * n for a, b in zip(r[0], c)]
                r[1] += n
                break
        else:
            reps.append([[v * n for v in c], n, c])
    reps.sort(key=lambda r: -r[1])
    return [tuple(round(v / r[1]) for v in r[0]) for r in reps[:most]]


def nearest(pal, c):
    return min(range(len(pal)), key=lambda i: math.dist(pal[i], c))


def rarity(imgs, pal, power=0.5, cap=4.0):
    """Weights that favour small, saturated features (cheeks, eyes, flames) over big areas of body colour."""
    n = [0] * len(pal)
    for im in imgs:
        for p in im.px:
            if p[3]:
                n[nearest(pal, p[:3])] += 1
    top = max(n) or 1
    out = []
    for i, c in enumerate(pal):
        _, l, s = colorsys.rgb_to_hls(*(v / 255 for v in c))
        out.append(min(cap, (top / max(1, n[i])) ** power) if s > 0.45 and 0.2 < l < 0.85 else 1.0)
    return out


def classify(im):
    """Per pixel: 0 clear, 1 body, 2 outer outline (dark, next to clear), 3 inner dark (eyes, mouths)."""
    cls = [0] * (im.w * im.h)
    for y in range(im.h):
        for x in range(im.w):
            p = im.px[y * im.w + x]
            if not p[3]:
                continue
            if luma(p) >= 62:
                cls[y * im.w + x] = 1
                continue
            edge = False
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
                xx, yy = x + dx, y + dy
                if not (0 <= xx < im.w and 0 <= yy < im.h) or not im.px[yy * im.w + xx][3]:
                    edge = True
                    break
            cls[y * im.w + x] = 2 if edge else 3
    return cls


CLASS_WEIGHT = {1: 1.0, 2: 0.12, 3: 2.2}


def boost(c):
    """A touch more saturation and light, and nothing so dark it vanishes on a dark terminal."""
    h, l, s = colorsys.rgb_to_hls(*(v / 255 for v in c))
    c = tuple(round(v * 255) for v in colorsys.hls_to_rgb(h, min(1, l * 1.04 + 0.02), min(1, s * 1.15)))
    lo, y = 70, luma(c)
    if y >= lo:
        return c
    return tuple(min(255, round(v + (lo - y))) for v in c)


def downscale(im, th, pal, rare, cover=0.42):
    """Area-weighted, but each target pixel takes the single palette colour that wins its area (no muddy averages).
    Outer outlines count little, inner dark details (eyes) and rare bright colours count more."""
    tw = max(1, round(im.w * th / im.h))
    cls = classify(im)
    idx = [nearest(pal, p[:3]) if p[3] else -1 for p in im.px]
    out = [[None] * tw for _ in range(th)]
    sx, sy = im.w / tw, im.h / th
    for ty in range(th):
        for tx in range(tw):
            fx0, fx1, fy0, fy1 = tx * sx, (tx + 1) * sx, ty * sy, (ty + 1) * sy
            weights = {}
            area = opaque = 0.0
            for y in range(int(fy0), min(im.h, math.ceil(fy1))):
                wy = min(fy1, y + 1) - max(fy0, y)
                for x in range(int(fx0), min(im.w, math.ceil(fx1))):
                    a = (min(fx1, x + 1) - max(fx0, x)) * wy
                    area += a
                    c = cls[y * im.w + x]
                    if c == 0:
                        continue
                    opaque += a * (0.45 if c == 2 else 1.0)
                    k = idx[y * im.w + x]
                    weights[k] = weights.get(k, 0) + a * CLASS_WEIGHT[c] * rare[k]
            if area and weights and opaque / area >= cover:
                out[ty][tx] = max(weights, key=weights.get)
    return out


# ------------------------------------------------------------------------------------------------------- pack building
def hexc(c):
    return '#%02x%02x%02x' % tuple(c[:3])


def check_mood(mood, motion, fx):
    if mood not in MOODS:
        sys.exit(f'unknown mood "{mood}" (use {", ".join(MOODS)})')
    if motion not in MOTIONS:
        sys.exit(f'unknown motion "{motion}" (use {", ".join(MOTIONS)})')
    if fx not in EFFECTS:
        sys.exit(f'unknown effect "{fx}" (use {", ".join(EFFECTS)})')


def validate(pack):
    pal = pack['palette']
    if not 0 < len(pal) <= MAX_PALETTE:
        sys.exit(f'a pack has 1 to {MAX_PALETTE} colours, this one has {len(pal)}')
    for mood, m in pack['moods'].items():
        if not 0 < len(m['frames']) <= MAX_FRAMES:
            sys.exit(f'{mood}: 1 to {MAX_FRAMES} frames, not {len(m["frames"])}')
        for f in m['frames']:
            if not 0 < len(f) <= MAX_H or any(len(r) > MAX_W for r in f):
                sys.exit(f'{mood}: a frame is at most {MAX_W} x {MAX_H} pixels')
            bad = {ch for r in f for ch in r if ch != '.' and ch not in pal}
            if bad:
                sys.exit(f'{mood}: letters with no colour: {"".join(sorted(bad))}')


def from_sprite_file(path):
    """Parse a hand-drawn .sprite file into a v2 pack."""
    pack = {'v': 2, 'name': os.path.splitext(os.path.basename(path))[0], 'palette': {}, 'moods': {}}
    mood = None
    frame = []

    def close():
        nonlocal frame
        if frame and mood:
            pack['moods'][mood]['frames'].append(frame)
        frame = []

    with open(path, encoding='utf-8') as f:
        lines = f.read().splitlines()
    for raw in lines:
        line = COMMENT.sub('', raw).strip()
        if not line:
            close()
            continue
        word = line.split()
        if word[0] == 'name':
            pack['name'] = word[1]
        elif word[0] == 'mouth':
            pack['mouth'] = [int(word[1]), int(word[2])]
        elif word[0] in ('colour', 'color'):
            if len(word[1]) != 1 or word[1] not in LETTERS or not (len(word[2]) == 7 and word[2][0] == '#'):
                sys.exit(f'bad colour line: {raw}')
            pack['palette'][word[1]] = word[2].lower()
        elif word[0] == 'mood':
            close()
            mood = word[1]
            motion = word[2] if len(word) > 2 else DEFAULT_MOTION.get(mood, 'stand')
            fx = word[3] if len(word) > 3 else 'none'
            check_mood(mood, motion, fx)
            pack['moods'][mood] = {'motion': motion, 'fx': fx, 'ms': int(word[4]) if len(word) > 4 else 250, 'frames': []}
        elif mood and all(ch == '.' or ch in pack['palette'] for ch in line):
            frame.append(line)
        else:
            sys.exit(f'{path}: cannot read this line: {raw}')
    close()
    if 'idle' not in pack['moods']:
        sys.exit('a sprite file needs at least an idle mood')
    return pack


def kv(text):
    out = {}
    for part in (text or '').split(','):
        if '=' in part:
            k, v = part.split('=', 1)
            out[k.strip()] = v.strip()
    return out


def pick(frames, most):
    if len(frames) <= most:
        return frames
    step = len(frames) / most
    return [frames[int(i * step)] for i in range(most)]


def from_gifs(args):
    """Scale GIF frames down to sprites with one shared palette."""
    sources = {'idle': args.idle, 'working': args.working or args.idle, 'needs': args.needs or args.working or args.idle}
    motion = {**DEFAULT_MOTION, **kv(args.motion)}
    fx = {**DEFAULT_FX, **kv(args.fx)}
    crops = {k: tuple(int(v) for v in b.split(':')) for k, b in kv(args.crop).items()}
    frames = {}
    for mood, path in sources.items():
        check_mood(mood, motion[mood], fx[mood])
        with open(path, 'rb') as f:
            w, h, raw = decode_gif(f.read())
        chosen = pick(raw, args.frames)
        imgs = [img_of(w, h, rgba) for rgba, _ in chosen]
        if mood in crops:
            imgs = [crop(im, crops[mood]) for im in imgs]
        box = bbox(imgs)  # one box for the mood, so the frames do not jump
        imgs = [crop(im, box) for im in imgs]
        if args.mirror:
            imgs = [mirror(im) for im in imgs]
        ms = max(60, min(2000, round(sum(d for _, d in chosen) / len(chosen))))
        frames[mood] = (imgs, ms)
        print(f'{mood}: {os.path.basename(path)} {w}x{h}, {len(raw)} frames, using {len(imgs)}, cropped to {imgs[0].w}x{imgs[0].h}')
    every = [im for imgs, _ in frames.values() for im in imgs]
    pal = palette_of(every)
    rare = rarity(every, pal)
    colours = [hexc(boost(c)) for c in pal]
    pack = {'v': 2, 'name': args.name, 'palette': {LETTERS[i]: c for i, c in enumerate(colours)}, 'moods': {}}
    for mood, (imgs, ms) in frames.items():
        sprite_frames = []
        for im in imgs:
            grid = downscale(im, args.height, pal, rare)
            sprite_frames.append([''.join('.' if k is None else LETTERS[k] for k in row) for row in grid])
        pack['moods'][mood] = {'motion': motion[mood], 'fx': fx[mood], 'ms': ms, 'frames': sprite_frames}
    return pack


def preview(pack, path, scale=6):
    """A contact sheet of every frame, one mood a row, each pixel `scale` px square on a dark terminal background."""
    rows = [pack['moods'][m]['frames'] for m in MOODS if m in pack['moods']]
    fw = max(len(r) for fr in rows for f in fr for r in f) + 2
    fh = max(len(f) for fr in rows for f in fr) + 2
    per = max(len(fr) for fr in rows)
    W, H = per * fw * scale, len(rows) * fh * scale
    buf = bytearray(bytes((30, 30, 30, 255)) * (W * H))
    for j, fr in enumerate(rows):
        for i, f in enumerate(fr):
            for y, line in enumerate(f):
                for x, ch in enumerate(line):
                    if ch == '.':
                        continue
                    c = pack['palette'][ch]
                    rgba = bytes((int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16), 255))
                    for dy in range(scale):
                        o = (((j * fh + 1 + y) * scale + dy) * W + (i * fw + 1 + x) * scale) * 4
                        buf[o:o + 4 * scale] = rgba * scale
    write_png(path, W, H, bytes(buf))


def main():
    ap = argparse.ArgumentParser(description='Make a dev-dash buddy pack from a hand-drawn .sprite file or animated GIFs.')
    ap.add_argument('name', help='a .sprite file, or the pack name (used by /dash-beat buddy <name>) when making it from GIFs')
    ap.add_argument('--idle', help='GIF for the resting mood')
    ap.add_argument('--working', help='GIF for the working mood (default: the idle one)')
    ap.add_argument('--needs', help='GIF for the needs-you mood (default: the working one)')
    ap.add_argument('--height', type=int, default=10, help='sprite height in pixels (10 = 5 terminal rows)')
    ap.add_argument('--frames', type=int, default=6, help='at most this many frames per mood')
    ap.add_argument('--motion', help='per mood, e.g. idle=sit,working=fly,needs=hop')
    ap.add_argument('--fx', help='per mood, e.g. idle=zzz,working=fire,needs=fire')
    ap.add_argument('--crop', help='per mood source crop x0:y0:x1:y1, e.g. working=0:0:240:226 (to leave out a baked-in effect)')
    ap.add_argument('--mirror', action='store_true', help='the GIFs face left; flip them to face right')
    ap.add_argument('--mouth', help='where effects come out, x,y in sprite pixels facing right')
    ap.add_argument('--out', help='output folder (default ~/.claude/dev-dash/buddy)')
    ap.add_argument('--preview', help='also write a PNG contact sheet of the frames here')
    args = ap.parse_args()

    if args.name.endswith('.sprite'):
        pack = from_sprite_file(args.name)
    else:
        if not args.idle:
            sys.exit('give a .sprite file, or --idle <gif> (and optionally --working, --needs)')
        pack = from_gifs(args)
    if args.mouth:
        pack['mouth'] = [int(v) for v in args.mouth.split(',')]
    validate(pack)
    name = pack['name']
    if not (name[:1].isalnum() and all(ch.isalnum() or ch in '-_' for ch in name) and len(name) <= 32):
        sys.exit(f'"{name}" is not a pack name: letters, digits, - and _ only')
    folder = args.out or os.path.join(os.path.expanduser('~'), '.claude', 'dev-dash', 'buddy')
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, f'{name}.json')
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(pack, f, ensure_ascii=False, separators=(',', ':'))
    if args.preview:
        preview(pack, args.preview)
        print(f'preview: {args.preview}')
    print(f'wrote {dest} ({os.path.getsize(dest)} bytes). Use it with: /dash-beat buddy {name}')


if __name__ == '__main__':
    main()
