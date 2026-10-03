#!/usr/bin/env python3
"""Build a dev-dash "buddy pack" from animated GIFs.

A pack is one JSON file with a few moods (idle, working, needs), each a short list of frames that are already drawn
as coloured text cells. dev-dash only reads that file and plays it back: it runs no program and uses no network.
This tool is the only place that needs `chafa` (https://hpjansson.org/chafa/), and only while making a pack.

    python tools/make-buddy.py charizard \\
        --idle charizard.gif --working charizard-firing.gif --needs charizard-shiny.gif

The result goes to ~/.claude/dev-dash/buddy/<name>.json (use --out to put it elsewhere).
Use it with:  /dash-beat buddy <name>

The GIF decoder is a small Python port of the LZW/GIF decoding in pokemanion (MIT, github.com/khatriadbhut/pokemanion).
Sprites are other people's artwork: make packs from art you are allowed to use, and do not commit them to this repo.
"""

import argparse
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

ESC = chr(27)
SGR = re.compile(ESC + r'\[([0-9;]*)m')
ANY_ESC = re.compile(ESC + r'(\[[0-9;?]*[A-Za-z]|\][^\x07]*\x07)')


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


def bbox(frames, w, h):
    x0, y0, x1, y1 = w, h, -1, -1
    for rgba, _ in frames:
        for y in range(h):
            row = rgba[y * w * 4:(y + 1) * w * 4]
            for x in range(w):
                if row[x * 4 + 3]:
                    x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)

    return (x0, y0, x1 + 1, y1 + 1) if x1 >= 0 else (0, 0, w, h)


def crop(rgba, w, box):
    x0, y0, x1, y1 = box

    return b''.join(rgba[(y * w + x0) * 4:(y * w + x1) * 4] for y in range(y0, y1))


# --------------------------------------------------------------------------------------------------------------- chafa
def hexof(p):
    return '#%02x%02x%02x' % (int(p[2]), int(p[3]), int(p[4]))


def cells_from_ansi(text):
    """chafa's coloured output as rows of [text, fg, bg] runs."""
    rows = []
    fg = bg = None
    for line in text.replace('\r', '').split('\n'):
        line = ANY_ESC.sub(lambda m: m.group(0) if m.group(0).endswith('m') else '', line)
        runs = []
        pos = 0

        def add(t):
            if not t:
                return
            if runs and runs[-1][1] == fg and runs[-1][2] == bg:
                runs[-1][0] += t
            else:
                runs.append([t, fg, bg])

        for m in SGR.finditer(line):
            add(line[pos:m.start()])
            pos = m.end()
            p = m.group(1).split(';')
            if p in (['0'], ['']):
                fg = bg = None
            elif p[:2] == ['38', '2'] and len(p) >= 5:
                fg = hexof(p)
            elif p[:2] == ['48', '2'] and len(p) >= 5:
                bg = hexof(p)
            elif p == ['39']:
                fg = None
            elif p == ['49']:
                bg = None
        add(line[pos:])
        rows.append(runs)
    while rows and not any(r[0].strip() or r[2] for r in rows[-1]):
        rows.pop()

    return rows


def draw_frame(chafa, png, cols, rows):
    out = subprocess.run(
        [chafa, '--format=symbols', '--colors=full', '--animate=off', '--polite=on', '--symbols=block', '--work=9', f'--size={cols}x{rows}', png],
        capture_output=True,
        check=True,
    ).stdout.decode('utf-8', 'replace')
    cells = cells_from_ansi(out)
    while len(cells) < rows:
        cells.append([])

    return cells[:rows]


def pick(frames, most):
    if len(frames) <= most:
        return frames
    step = len(frames) / most

    return [frames[int(i * step)] for i in range(most)]


def find_chafa(given):
    found = given or shutil.which('chafa') or shutil.which('chafa.exe')
    if not found:
        sys.exit('chafa is needed to make a pack (https://hpjansson.org/chafa/). Install it, or pass --chafa <path>.')

    return found


def main():
    ap = argparse.ArgumentParser(description='Make a dev-dash buddy pack from animated GIFs.')
    ap.add_argument('name', help='the pack name, used by /dash-beat buddy <name>')
    ap.add_argument('--idle', required=True, help='GIF for the resting mood')
    ap.add_argument('--working', help='GIF for the working mood (default: the idle one)')
    ap.add_argument('--needs', help='GIF for the needs-you mood (default: the working one)')
    ap.add_argument('--cols', type=int, default=24)
    ap.add_argument('--rows', type=int, default=5)
    ap.add_argument('--frames', type=int, default=8, help='at most this many frames per mood')
    ap.add_argument('--chafa', help='path to chafa')
    ap.add_argument('--out', help='output folder (default ~/.claude/dev-dash/buddy)')
    args = ap.parse_args()

    chafa = find_chafa(args.chafa)
    sources = {'idle': args.idle, 'working': args.working or args.idle, 'needs': args.needs or args.working or args.idle}
    decoded = {}
    for mood, path in sources.items():
        with open(path, 'rb') as f:
            w, h, frames = decode_gif(f.read())
        decoded[mood] = (w, h, pick(frames, args.frames))
        print(f'{mood}: {os.path.basename(path)} {w}x{h}, {len(frames)} frames, using {len(decoded[mood][2])}')

    # Each mood is cropped to its own opaque area, then drawn to fit the same box.
    boxes = {m: bbox(fr, w, h) for m, (w, h, fr) in decoded.items()}
    pack = {'v': 1, 'name': args.name, 'cols': args.cols, 'rows': args.rows, 'moods': {}}
    with tempfile.TemporaryDirectory() as tmp:
        for mood, (w, h, frames) in decoded.items():
            box = boxes[mood]
            cw, ch = box[2] - box[0], box[3] - box[1]
            out = []
            for i, (rgba, delay) in enumerate(frames):
                png = os.path.join(tmp, f'{mood}{i}.png')
                write_png(png, cw, ch, crop(rgba, w, box))
                out.append({'ms': delay, 'rows': draw_frame(chafa, png, args.cols, args.rows)})
            pack['moods'][mood] = {'frames': out}
    folder = args.out or os.path.join(os.path.expanduser('~'), '.claude', 'dev-dash', 'buddy')
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, f'{args.name}.json')
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(pack, f, ensure_ascii=False, separators=(',', ':'))
    print(f'wrote {dest} ({os.path.getsize(dest) // 1024} KB). Use it with: /dash-beat buddy {args.name}')


if __name__ == '__main__':
    main()
