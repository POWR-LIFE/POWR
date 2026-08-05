#!/usr/bin/env python3
"""Bake the POWR favicon set from the transparent mark.

    python3 scripts/gen-favicon.py        # needs Pillow: pip install pillow

Why this exists rather than pointing <link rel="icon"> straight at the mark:

  1. The source mark is WHITE on transparency. A browser's tab strip is light
     in light mode, so a transparent white favicon is invisible there. Every
     size below therefore sits on the brand plate — the same white-on-near-black
     treatment as public/powr-avatar.png and the app icon.
  2. The source is a 1128x1128 canvas whose ink only occupies 763x534 in the
     middle — about 26% dead padding top and bottom. Scaled to 32px that leaves
     a 15px mark rattling around in a 32px box. We crop to the ink and re-pad to
     a deliberate optical margin instead.

Outputs (committed, so the site never depends on this script at build time):
  public/favicon-32.png       tab icon, hand-sized rather than browser-downscaled
  public/favicon-512.png      high-DPI / PWA
  public/apple-touch-icon.png iOS home screen — FULL BLEED, no rounding: iOS
                              applies its own mask and rounds a rounded icon twice
"""
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen

from PIL import Image, ImageDraw

SRC = 'https://auth.powr.life/storage/v1/object/public/landing-page-assets/powr_transparent.png'
OUT = Path(__file__).resolve().parent.parent / 'public'

PLATE = (8, 8, 8, 255)   # pg.bg — the site canvas, not pure black
INK_WIDTH = 0.70         # mark width as a fraction of the box
RADIUS = 0.22            # corner radius as a fraction of the box


def mark():
    """The source cropped to its ink, so padding is ours to decide."""
    im = Image.open(BytesIO(urlopen(SRC).read())).convert('RGBA')
    return im.crop(im.getchannel('A').getbbox())


def icon(src, size, rounded=True):
    w = round(size * INK_WIDTH)
    h = round(w * src.height / src.width)
    art = src.resize((w, h), Image.LANCZOS)

    plate = Image.new('RGBA', (size, size), PLATE)
    if rounded:
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, size - 1, size - 1), radius=round(size * RADIUS), fill=255)
        plate.putalpha(mask)

    plate.alpha_composite(art, ((size - w) // 2, (size - h) // 2))
    return plate


if __name__ == '__main__':
    src = mark()
    print(f'source ink {src.width}x{src.height}')
    for name, size, rounded in [
        ('favicon-32.png', 32, True),
        ('favicon-512.png', 512, True),
        ('apple-touch-icon.png', 180, False),
    ]:
        icon(src, size, rounded).save(OUT / name)
        print('wrote', OUT / name)
