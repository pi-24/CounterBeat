"""Generate the Steam store capsule art for CounterBeat (local only, nothing is uploaded).

Run from the repo root:   python tools/asset-tools/gen_store_art.py

Everything is drawn from geometric shapes in the project palette (data/themes.json): a perspective
neon floor, doorway panels, approach rings, hexagon outlines and a stroke-built wordmark. The wordmark is
drawn with line segments, not a font, so no font licence is involved. No pack material and no AI image is used.
Writes store/capsules/*.png at the exact sizes Steam requires (tools/check-store-assets.mjs checks them).
"""
import math
import os
import random
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "store", "capsules")
os.makedirs(OUT, exist_ok=True)

# data/themes.json palette
BASE, PANEL, LINE = (7, 11, 26), (15, 23, 48), (27, 37, 71)
CYAN, MAGENTA, WHITE = (73, 227, 255), (255, 63, 180), (255, 255, 255)

# stroke letterforms on a 0.7 x 1.0 box, y down
LETTERS = {
    "C": [[(0.7, 0.2), (0.5, 0), (0.2, 0), (0, 0.2), (0, 0.8), (0.2, 1), (0.5, 1), (0.7, 0.8)]],
    "O": [[(0.2, 0), (0.5, 0), (0.7, 0.2), (0.7, 0.8), (0.5, 1), (0.2, 1), (0, 0.8), (0, 0.2), (0.2, 0)]],
    "U": [[(0, 0), (0, 0.8), (0.2, 1), (0.5, 1), (0.7, 0.8), (0.7, 0)]],
    "N": [[(0, 1), (0, 0), (0.7, 1), (0.7, 0)]],
    "T": [[(0, 0), (0.7, 0)], [(0.35, 0), (0.35, 1)]],
    "E": [[(0.7, 0), (0, 0), (0, 1), (0.7, 1)], [(0, 0.5), (0.5, 0.5)]],
    "R": [[(0, 1), (0, 0), (0.5, 0), (0.7, 0.15), (0.7, 0.35), (0.5, 0.5), (0, 0.5)], [(0.4, 0.5), (0.7, 1)]],
    "B": [[(0, 0), (0.5, 0), (0.7, 0.12), (0.7, 0.38), (0.5, 0.5), (0, 0.5)],
          [(0.5, 0.5), (0.7, 0.62), (0.7, 0.88), (0.5, 1), (0, 1), (0, 0)]],
    "A": [[(0, 1), (0.35, 0), (0.7, 1)], [(0.14, 0.65), (0.56, 0.65)]],
}
GAP = 0.32
SS = 2  # supersample factor for smooth edges


def text_width(word, gap=GAP):
    return len(word) * 0.7 + (len(word) - 1) * gap


def word_pad(unit, stroke):
    """Transparent margin around a word's strokes: past the ~3-sigma reach of its glow blur."""
    sw = max(2, int(unit * stroke))
    return int(math.ceil(sw * 1.6 * 4)) + sw


def draw_word(word, unit, colour, stroke=0.15, gap=GAP):
    """A transparent RGBA layer holding `word` with letters `unit` px tall (plus margin), with a soft glow."""
    width_px = text_width(word, gap) * unit
    sw = max(2, int(unit * stroke))
    sigma = sw * 1.6
    pad = word_pad(unit, stroke)  # past the blur's ~3-sigma reach, so the glow is never cut at the layer edge
    w, h = int(width_px + pad * 2), int(unit + pad * 2)
    layer = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x = 0.0
    for ch in word:
        for line in LETTERS[ch]:
            pts = [((pad + (x + px) * unit) * SS, (pad + py * unit) * SS) for px, py in line]
            d.line(pts, fill=colour + (255,), width=sw * SS, joint="curve")
            for p in pts:  # round caps
                r = sw * SS / 2
                d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=colour + (255,))
        x += 0.7 + gap
    layer = layer.resize((w, h), Image.LANCZOS)
    # The word is one flat colour, so the glow is that colour with a blurred alpha. Blurring the RGBA image directly
    # would average the colour with the fully transparent (black) pixels and give a grey halo.
    soft_alpha = layer.getchannel("A").filter(ImageFilter.GaussianBlur(sigma))
    glow = Image.new("RGBA", (w, h), colour + (0,))
    glow.putalpha(soft_alpha)
    out = Image.alpha_composite(Image.new("RGBA", (w, h), (0, 0, 0, 0)), glow)
    out = Image.alpha_composite(out, glow)
    return Image.alpha_composite(out, layer)


def lockup(width_px):
    """COUNTER over a widely tracked BEAT of the same letter height and width, as one transparent layer."""
    unit = width_px / text_width("COUNTER")
    big = unit * 1.45  # BEAT is taller, tracked out to the width of COUNTER
    wide_gap = (text_width("COUNTER") * unit / big - 4 * 0.7) / 3
    top = draw_word("COUNTER", unit, (235, 245, 255), stroke=0.12)
    bottom = draw_word("BEAT", big, CYAN, stroke=0.12, gap=wide_gap)
    # the layers' glow margins overlap; the visible gap between the words is a fraction of the letter height
    offset = top.height - word_pad(unit, 0.12) - word_pad(big, 0.12) + int(unit * 0.5)
    out = Image.new("RGBA", (max(top.width, bottom.width), offset + bottom.height), (0, 0, 0, 0))
    out.alpha_composite(top, ((out.width - top.width) // 2, 0))
    glow_pass = Image.new("RGBA", out.size, (0, 0, 0, 0))
    glow_pass.alpha_composite(bottom, ((out.width - bottom.width) // 2, offset))
    return Image.alpha_composite(out, glow_pass)


def glow_layer(size, painter, blur):
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    painter(ImageDraw.Draw(layer))
    soft = layer.filter(ImageFilter.GaussianBlur(blur))
    return Image.alpha_composite(soft, layer)


def hexagon(cx, cy, r, rot=0.0):
    return [(cx + r * math.cos(rot + i * math.pi / 3), cy + r * math.sin(rot + i * math.pi / 3)) for i in range(6)]


def arena(w, h, focus=(0.5, 0.5), seed=1, lit=1, door_scale=1.0):
    """The arena backdrop: dark base, horizon glow, doorway panels, perspective floor grid, hexagons."""
    rnd = random.Random(seed)
    fx, hy = int(w * focus[0]), int(h * focus[1])
    img = Image.new("RGBA", (w, h), BASE + (255,))
    d = ImageDraw.Draw(img)
    for y in range(h):  # vertical gradient, lighter toward the horizon
        t = 1 - min(1.0, abs(y - hy) / (h * 0.62))
        c = tuple(int(BASE[i] + (PANEL[i] - BASE[i]) * t * 1.15) for i in range(3))
        d.line([(0, y), (w, y)], fill=c + (255,))
    unit = min(w, h)
    lw = max(1, int(unit * 0.003))

    def floor(dr):
        for i in range(-24, 25):  # lines converging on the vanishing point
            x = fx + i * w * 0.16
            dr.line([(fx + (x - fx) * 0.04, hy), (fx + (x - fx) * 2.2, h)], fill=CYAN + (120,), width=lw)
        z = 0.03
        while z < 1:  # horizontals, spaced by perspective
            y = hy + (h - hy) * (z ** 2.0)
            dr.line([(0, y), (w, y)], fill=CYAN + (int(40 + 150 * z),), width=lw)
            z += 0.06
    img = Image.alpha_composite(img, glow_layer((w, h), floor, unit * 0.004))

    def doors(dr):  # one lit lane (cyan), the rest dark outlines
        n = 4
        pw, ph = unit * 0.2 * door_scale, unit * 0.62 * door_scale
        span = w * 0.78
        for i in range(n):
            cx = fx - span / 2 + span * (i + 0.5) / n
            is_lit = i == lit
            col = CYAN if is_lit else LINE
            box = [cx - pw / 2, hy - ph * 0.85, cx + pw / 2, hy + ph * 0.15]
            dr.rectangle(box, outline=col + (255,), width=max(2, int(unit * (0.012 if is_lit else 0.006))),
                         fill=(CYAN + (46,)) if is_lit else (PANEL + (200,)))
    img = Image.alpha_composite(img, glow_layer((w, h), doors, unit * 0.006))

    def hexes(dr):
        for _ in range(int(14 * max(1, w / h) ** 0.5)):
            r = unit * rnd.uniform(0.03, 0.09)
            cx, cy = rnd.uniform(0, w), rnd.uniform(0, hy * 0.85)
            dr.polygon(hexagon(cx, cy, r, rnd.uniform(0, 1)), outline=(MAGENTA if rnd.random() < 0.3 else CYAN) + (70,), width=lw)
    img = Image.alpha_composite(img, glow_layer((w, h), hexes, 2))
    vig = Image.new("L", (w, h), 0)  # vignette
    ImageDraw.Draw(vig).ellipse([-w * 0.25, -h * 0.35, w * 1.25, h * 1.35], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(unit * 0.12))
    return Image.composite(img, Image.new("RGBA", (w, h), BASE + (255,)), vig)


def approach_ring(img, cx, cy, r):
    """Approach ring + crosshair: the game's primary timing cue, as a brand mark."""
    w, h = img.size

    def paint(dr):
        for rr, col, a, wd in [(1.0, CYAN, 255, 0.07), (1.35, CYAN, 140, 0.03), (1.75, MAGENTA, 120, 0.025), (2.2, CYAN, 60, 0.02)]:
            R = r * rr
            dr.ellipse([cx - R, cy - R, cx + R, cy + R], outline=col + (a,), width=max(2, int(r * wd)))
        for ang in range(0, 360, 90):  # crosshair ticks
            a = math.radians(ang)
            dr.line([(cx + math.cos(a) * r * 0.25, cy + math.sin(a) * r * 0.25),
                     (cx + math.cos(a) * r * 0.6, cy + math.sin(a) * r * 0.6)], fill=WHITE + (255,), width=max(2, int(r * 0.05)))
        dr.polygon(hexagon(cx, cy, r * 0.12, math.pi / 6), fill=MAGENTA + (255,))
    return Image.alpha_composite(img, glow_layer((w, h), paint, r * 0.05))


def place(img, layer, cx, cy):
    img.alpha_composite(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2)))


def save(img, name, alpha=False):
    path = os.path.join(OUT, name)
    (img if alpha else img.convert("RGB")).save(path, "PNG", optimize=True)
    print("wrote", os.path.normpath(path), img.size)


def scrim(img, cx, cy, rw, rh, alpha=170):
    """A soft dark ellipse behind the wordmark so the doorways and floor lines never cut through the letters."""
    w, h = img.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([cx - rw, cy - rh, cx + rw, cy + rh], fill=BASE + (alpha,))
    return Image.alpha_composite(img, layer.filter(ImageFilter.GaussianBlur(min(rw, rh) * 0.35)))


def capsule(name, w, h, ring, mark, focus=(0.5, 0.55), seed=1, lit=1, door_scale=1.0):
    """ring = (cx, cy, r) as fractions of the canvas (r of the short side); mark = (cx, cy, width) as fractions."""
    img = arena(w, h, focus=focus, seed=seed, lit=lit, door_scale=door_scale)
    lock = lockup(int(mark[2] * w))
    img = scrim(img, mark[0] * w, mark[1] * h, lock.width * 0.62, lock.height * 0.62)
    img = approach_ring(img, ring[0] * w, ring[1] * h, ring[2] * min(w, h))
    place(img, lock, mark[0] * w, mark[1] * h)
    save(img, name)


# header 920x430, small 462x174, main 1232x706, vertical 748x896, library capsule 600x900.
# The three large capsules each get their own composition (not one layout re-seeded):
#   main      wordmark left, ring and lit doorway right
#   vertical  ring over the wordmark, lit door left of centre
#   library   wordmark on top, ring and floor below, lit door right
capsule("header.png", 920, 430, (0.82, 0.5, 0.17), (0.37, 0.5, 0.58), focus=(0.5, 0.62), seed=3, lit=2)
capsule("capsule-small.png", 462, 174, (0.86, 0.5, 0.2), (0.35, 0.5, 0.46), focus=(0.5, 0.7), seed=4, lit=2)
capsule("capsule-main.png", 1232, 706, (0.793, 0.42, 0.15), (0.38, 0.52, 0.56), focus=(0.5, 0.56), seed=5, lit=3)
capsule("capsule-vertical.png", 748, 896, (0.5, 0.2, 0.14), (0.5, 0.7, 0.8), focus=(0.5, 0.5), seed=6, lit=0, door_scale=0.9)
capsule("library-capsule.png", 600, 900, (0.5, 0.7, 0.2), (0.5, 0.25, 0.8), focus=(0.5, 0.82), seed=7, lit=3, door_scale=0.8)

# library hero: wide, no logo (the logo layers over it), subject kept right of centre
hero = arena(3840, 1240, focus=(0.5, 0.56), seed=8)
hero = approach_ring(hero, 3840 * 0.68, 1240 * 0.42, 1240 * 0.2)
save(hero, "library-hero.png")

# library logo: the wordmark alone on transparency
logo = Image.new("RGBA", (1280, 720), (0, 0, 0, 0))
place(logo, lockup(1000), 640, 360)
save(logo, "library-logo.png", alpha=True)
