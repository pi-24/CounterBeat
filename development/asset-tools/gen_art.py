"""Generate all original artwork for the CounterBeat game.

Drawn from scratch with Pillow:

  images/bot-sheet.png      the range-bot sprite sheet (idle, hit, death)
  images/spark.png          soft particle used for hit sparks and muzzle flash
  images/emblem.png         site emblem / favicon
  images/textures/*.png     tiling floor and wall textures, one set per level

The level thumbnails in images/levels/ are screenshots of the real 3D arenas
and are produced by development/tests/capture-levels.mjs, not by this script.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = "../../website/images"
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(OUT, "textures"), exist_ok=True)

SS = 4                 # supersample factor
FW, FH = 96, 128       # final frame size
COLS = 5


# ---------------------------------------------------------------- helpers
def new_frame():
    img = Image.new("RGBA", (FW * SS, FH * SS), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def ell(d, box, fill, outline=None, width=2):
    x0, y0, x1, y1 = box
    d.ellipse([x0 * SS, y0 * SS, x1 * SS, y1 * SS], fill=fill,
              outline=outline, width=int(width * SS) if outline else 0)


def rrect(d, box, radius, fill, outline=None, width=2):
    x0, y0, x1, y1 = box
    d.rounded_rectangle([x0 * SS, y0 * SS, x1 * SS, y1 * SS], radius=radius * SS,
                        fill=fill, outline=outline,
                        width=width * SS if outline else 0)


def limb(d, a, b, thickness, fill):
    d.line([(a[0] * SS, a[1] * SS), (b[0] * SS, b[1] * SS)],
           fill=fill, width=int(thickness * SS))
    for p in (a, b):
        r = thickness / 2
        ell(d, (p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill)


# ------------------------------------------------------------- range bot
BODY = (224, 228, 236)
BODY_DK = (168, 176, 194)
JOINT = (92, 100, 120)
RING = (255, 138, 42)
RING_DK = (198, 96, 22)
VISOR = (108, 226, 255)


def draw_bot(bob=0.0, sway=0.0, flash=0.0, collapse=0.0, alpha=1.0):
    """A front-facing practice bot, the kind you shoot in a shooting range.

    bob       vertical breathing offset in pixels
    sway      arm sway, -1 .. 1
    flash     0 .. 1, whitens the body on a hit
    collapse  0 .. 1, folds the bot towards the floor
    alpha     overall opacity
    """
    img, d = new_frame()
    cx = FW / 2
    ground = FH - 6

    def tint(col):
        return tuple(int(c + (255 - c) * flash) for c in col)

    # vertical squash for the collapse animation
    def sy(y):
        return ground - (ground - y) * (1.0 - collapse * 0.78)

    # shadow
    ell(d, (cx - 22, ground - 4, cx + 22, ground + 4), (0, 0, 0, 80))

    hip_y = sy(ground - 46 + bob)
    shoulder_y = sy(ground - 84 + bob)
    head_cy = sy(ground - 102 + bob)

    # legs
    for side in (-1, 1):
        x = cx + side * 9
        limb(d, (x, hip_y), (x + side * 2, ground - 4), 9, tint(BODY_DK))
        rrect(d, (x + side * 2 - 7, ground - 8, x + side * 2 + 7, ground - 1), 2, tint(JOINT))

    # torso
    rrect(d, (cx - 20, shoulder_y - 2, cx + 20, hip_y + 4), 7, tint(BODY))
    # chest target ring
    ring_cy = (shoulder_y + hip_y) / 2 + 2
    ell(d, (cx - 13, ring_cy - 13, cx + 13, ring_cy + 13), tint(RING_DK))
    ell(d, (cx - 9, ring_cy - 9, cx + 9, ring_cy + 9), tint(BODY))
    ell(d, (cx - 4, ring_cy - 4, cx + 4, ring_cy + 4), tint(RING))

    # arms
    for side in (-1, 1):
        sx = cx + side * 22
        ex = sx + side * (5 + sway * 3 * side)
        limb(d, (sx, shoulder_y + 4), (ex, hip_y + 2), 8, tint(BODY_DK))
        ell(d, (ex - 5, hip_y - 2, ex + 5, hip_y + 8), tint(JOINT))

    # neck + head
    neck_top = min(head_cy + 10, shoulder_y - 1)
    rrect(d, (cx - 5, neck_top, cx + 5, shoulder_y), 2, tint(JOINT))
    ell(d, (cx - 14, head_cy - 14, cx + 14, head_cy + 14), tint(BODY))
    rrect(d, (cx - 10, head_cy - 5, cx + 10, head_cy + 1), 3, tint(VISOR))
    # head ring so the headshot zone is readable
    ell(d, (cx - 15, head_cy - 15, cx + 15, head_cy + 15), None,
        outline=tint(RING), width=1.5)

    frame = img.resize((FW, FH), Image.LANCZOS)
    if alpha < 1.0:
        a = frame.getchannel("A").point(lambda v: int(v * alpha))
        frame.putalpha(a)
    return frame


def build_bot_sheet():
    frames = []
    # 0-3 idle: breathing bob and a little arm sway
    for i in range(4):
        t = i / 4 * 2 * math.pi
        frames.append(draw_bot(bob=1.6 * math.sin(t), sway=math.sin(t)))
    # 4-5 hit: white flash, slight recoil upward
    frames.append(draw_bot(bob=-2, flash=0.85))
    frames.append(draw_bot(bob=-1, flash=0.45))
    # 6-9 death: collapse and fade
    frames.append(draw_bot(collapse=0.25, flash=0.2, alpha=0.95))
    frames.append(draw_bot(collapse=0.55, alpha=0.8))
    frames.append(draw_bot(collapse=0.85, alpha=0.5))
    frames.append(draw_bot(collapse=1.0, alpha=0.15))

    rows = math.ceil(len(frames) / COLS)
    sheet = Image.new("RGBA", (FW * COLS, FH * rows), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, ((i % COLS) * FW, (i // COLS) * FH))
    sheet.save(os.path.join(OUT, "bot-sheet.png"))
    print("bot-sheet.png", sheet.size, len(frames), "frames")


# ---------------------------------------------------------------- effects
def build_particle():
    s = 64
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = s / 2
    for r, a in ((30, 18), (22, 60), (14, 140), (7, 255)):
        d.ellipse([c - r, c - r, c + r, c + r], fill=(255, 236, 190, a))
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    img.save(os.path.join(OUT, "spark.png"))
    print("spark.png")


def build_emblem():
    w, h = 560, 150
    img = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = w, h
    for r, a in ((120, 60), (86, 110), (54, 190)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=RING + (a,), width=10)
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        d.line([(cx + dx * 90, cy + dy * 90), (cx + dx * 150, cy + dy * 150)],
               fill=(126, 255, 186, 230), width=10)
    img.resize((w, h), Image.LANCZOS).save(os.path.join(OUT, "emblem.png"))
    print("emblem.png")


# --------------------------------------------------------------- textures
def grid_texture(name, base, line, minor, size=256, cells=4, line_w=3, minor_w=1):
    """A tiling grid, the classic aim-trainer floor."""
    img = Image.new("RGB", (size, size), base)
    d = ImageDraw.Draw(img)
    step = size // cells
    sub = step // 4
    for i in range(0, size, sub):
        d.line([(i, 0), (i, size)], fill=minor, width=minor_w)
        d.line([(0, i), (size, i)], fill=minor, width=minor_w)
    for i in range(0, size + 1, step):
        x = min(i, size - 1)
        d.line([(x, 0), (x, size)], fill=line, width=line_w)
        d.line([(0, x), (size, x)], fill=line, width=line_w)
    img.save(os.path.join(OUT, "textures", name + ".png"), optimize=True)
    print("textures/" + name + ".png")


def panel_texture(name, base, seam, size=256):
    """Flat wall panels with a seam, for pillars and walls."""
    img = Image.new("RGB", (size, size), base)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, size - 1, size - 1], outline=seam, width=4)
    d.line([(0, size // 2), (size, size // 2)], fill=seam, width=2)
    d.rectangle([14, 14, size - 15, size // 2 - 8], outline=seam, width=1)
    d.rectangle([14, size // 2 + 8, size - 15, size - 15], outline=seam, width=1)
    img.save(os.path.join(OUT, "textures", name + ".png"), optimize=True)
    print("textures/" + name + ".png")


if __name__ == "__main__":
    build_bot_sheet()
    build_particle()
    build_emblem()

    # Level 1 - The Range: light, aim-trainer blue
    grid_texture("floor-range", (188, 200, 216), (118, 136, 162), (164, 178, 198))
    panel_texture("wall-range", (206, 214, 226), (150, 162, 182))
    # Level 2 - Neon Alley: near-black with cyan lines
    grid_texture("floor-neon", (16, 14, 34), (108, 226, 255), (40, 36, 70))
    panel_texture("wall-neon", (26, 22, 48), (255, 92, 176))
    # Level 3 - Server Vault: dark green
    grid_texture("floor-vault", (10, 22, 18), (126, 255, 186), (22, 44, 36))
    panel_texture("wall-vault", (16, 32, 26), (60, 110, 86))
