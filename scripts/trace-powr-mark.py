"""Rebuild the POWR P (leg + bowl) as clean geometry from the logo artwork.

Writes components/drop/powrMark.ts, the mark the Drop prototype draws. A raw
pixel trace copies the artwork's 1px wobble, so instead this measures the
logo's construction from its anti-aliased edges (the shared slant, flat tops
and bottoms, each corner's radius, the channel, the leg's top-right flare) and
redraws both pieces as straight lines and arcs. It prints how closely the
result matches the artwork.

Usage (from the repo root; needs numpy + Pillow):
    python3 scripts/trace-powr-mark.py assets/images/powr_transparent.png components/drop/powrMark.ts
"""
import json
import math
import re
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

src, outp = sys.argv[1], sys.argv[2]
png = src
a = np.array(Image.open(src).convert('RGBA'))[:, :, 3].astype(float) / 255.0
H, W = a.shape
ink = a > 0.5

# Split the two pieces: the leg is the component touching the lowest rows.
lab = np.zeros((H, W), int)
n = 0
for y in range(H):
    for x in range(W):
        if ink[y, x] and not lab[y, x]:
            n += 1
            q = deque([(y, x)]); lab[y, x] = n
            while q:
                cy, cx = q.popleft()
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and ink[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = n; q.append((ny, nx))
sizes = [(lab == i).sum() for i in range(1, n + 1)]
ids = sorted(range(1, n + 1), key=lambda i: -sizes[i - 1])[:2]
leg_id = min(ids, key=lambda i: np.nonzero(lab == i)[1].min())
bowl_id = [i for i in ids if i != leg_id][0]


def edges(pid):
    """Per row: sub-pixel left and right edge x (alpha = 0.5 crossing)."""
    m = lab == pid
    rows = {}
    ys = np.nonzero(m.any(axis=1))[0]
    for y in ys:
        xs = np.nonzero(m[y])[0]
        l, r = xs.min(), xs.max()
        # left: crossing between l-1 (outside) and l (inside)
        al, ai = a[y, l - 1], a[y, l]
        xl = (l - 1) + (0.5 - al) / (ai - al) if ai != al else l
        ar, ao = a[y, r], a[y, r + 1]
        xr = r + (ar - 0.5) / (ar - ao) if ar != ao else r
        rows[y] = (xl + 0.5, xr + 0.5)  # pixel-centre coords
    return rows, ys.min(), ys.max()


def top_bottom(pid):
    m = lab == pid
    cols = np.nonzero(m.any(axis=0))[0]
    tops, bots = [], []
    for x in cols:
        ys = np.nonzero(m[:, x])[0]
        t, b = ys.min(), ys.max()
        at, ai = a[t - 1, x], a[t, x]
        tops.append((x, (t - 1) + (0.5 - at) / (ai - at) + 0.5 if ai != at else t))
        ab, ao = a[b, x], a[b + 1, x]
        bots.append((x, b + (ab - 0.5) / (ab - ao) + 0.5 if ab != ao else b))
    return tops, bots


leg_rows, leg_y0, leg_y1 = edges(leg_id)
bowl_rows, bowl_y0, bowl_y1 = edges(bowl_id)
leg_tops, leg_bots = top_bottom(leg_id)
bowl_tops, bowl_bots = top_bottom(bowl_id)


def fit_line(pairs):
    """x = c + s*y least squares."""
    ys = np.array([p[0] for p in pairs]); xs = np.array([p[1] for p in pairs])
    A = np.vstack([np.ones_like(ys), ys]).T
    (c, s), *_ = np.linalg.lstsq(A, xs, rcond=None)
    return c, s


def frac(lo, hi, y0, y1):
    return int(y0 + (y1 - y0) * lo), int(y0 + (y1 - y0) * hi)

# Straight runs, well clear of the corners.
L_left = [(y, leg_rows[y][0]) for y in range(*frac(0.3, 0.92, leg_y0, leg_y1))]
L_right = [(y, leg_rows[y][1]) for y in range(*frac(0.45, 0.82, leg_y0, leg_y1))]
B_left = [(y, bowl_rows[y][0]) for y in range(*frac(0.3, 0.92, bowl_y0, bowl_y1))]
B_right = [(y, bowl_rows[y][1]) for y in range(*frac(0.3, 0.75, bowl_y0, bowl_y1))]
fits = {k: fit_line(v) for k, v in dict(L_left=L_left, L_right=L_right, B_left=B_left, B_right=B_right).items()}
slopes = {k: round(v[1], 4) for k, v in fits.items()}
s = float(np.mean([v[1] for v in fits.values()]))  # shared slant (x per y; negative = leans right going up)

# Refit each line's intercept with the shared slope.
def intercept(pairs):
    return float(np.mean([x - s * y for y, x in pairs]))
cL_left, cL_right, cB_left, cB_right = (intercept(p) for p in (L_left, L_right, B_left, B_right))

# Flat tops/bottoms: the run of columns sitting at the extreme, not the
# columns that happen to be in the middle (on the leg most are on the slant).
def flat(vals, extreme):
    v = np.array([p[1] for p in vals])
    e = v.min() if extreme == 'min' else v.max()
    run = v[np.abs(v - e) <= 1.5]
    return float(np.median(run))
top = (flat(leg_tops, 'min') + flat(bowl_tops, 'min')) / 2
leg_bot = flat(leg_bots, 'max')
bowl_bot = flat(bowl_bots, 'max')

# Channel: perpendicular distance between the leg's right line and the bowl's left line.
cos_t = 1 / math.sqrt(1 + s * s)
gap_h = cB_left - cL_right            # horizontal
gap_p = gap_h * cos_t                 # perpendicular


def tangent_circle(hy, h_side, c_line, x_side, r):
    """Centre of the circle of radius r tangent to y=hy (inside on h_side: +1 below,
    -1 above) and to the slanted line x = c_line + s*y (inside on x_side: +1 right, -1 left)."""
    cy = hy + h_side * r
    # point on the line at cy, then offset perpendicular by r on x_side
    x_on = c_line + s * cy
    cx = x_on + x_side * r / cos_t
    return cx, cy


def fit_corner(pts, hy, h_side, c_line, x_side):
    best = (1e9, None)
    P = np.array(pts)
    for r in np.arange(4, 200, 0.25):
        cx, cy = tangent_circle(hy, h_side, c_line, x_side, r)
        d = np.abs(np.hypot(P[:, 0] - cx, P[:, 1] - cy) - r)
        # only score points that lie in the arc's quadrant region (near the corner)
        err = float(np.mean(d))
        if err < best[0]:
            best = (err, r)
    return best[1], round(best[0], 3)


def contour_pts(rows, ylo, yhi, side):
    return [(rows[y][0 if side == 'l' else 1], y + 0.5) for y in range(ylo, yhi) if y in rows]

# Corner samples (rows near each corner).
leg_TL = contour_pts(leg_rows, leg_y0 + 1, leg_y0 + 35, 'l')
leg_BR = contour_pts(leg_rows, leg_y1 - 35, leg_y1, 'r')
bowl_TL = contour_pts(bowl_rows, bowl_y0 + 1, bowl_y0 + 35, 'l')
bowl_TR = contour_pts(bowl_rows, bowl_y0 + 1, bowl_y0 + 35, 'r')
bowl_BR = contour_pts(bowl_rows, bowl_y1 - 40, bowl_y1, 'r')

r_leg_TL, e1 = fit_corner(leg_TL, top, +1, cL_left, +1)
r_leg_BR, e2 = fit_corner(leg_BR, leg_bot, -1, cL_right, -1)
r_bowl_TL, e3 = fit_corner(bowl_TL, top, +1, cB_left, +1)
r_bowl_TR, e4 = fit_corner(bowl_TR, top, +1, cB_right, -1)
r_bowl_BR, e5 = fit_corner(bowl_BR, bowl_bot, -1, cB_right, -1)


# ── rebuild from the measurements ─────────────────────────────────────────
cLl, cLr, cBl, cBr = cL_left, cL_right, cB_left, cB_right
R = dict(leg_TL=r_leg_TL, leg_BR=r_leg_BR, bowl_TL=r_bowl_TL, bowl_TR=r_bowl_TR, bowl_BR=r_bowl_BR)

cos_t = 1 / math.sqrt(1 + s * s)
# unit normal of the lines x - s*y = c, pointing to +x
n = (cos_t, -s * cos_t)


def xline(c, y):
    return c + s * y


def corner(hy, h_side, c, x_side, r):
    """Circle tangent to y=hy and x = c + s*y. Returns centre, tangent point on
    the horizontal, tangent point on the slant."""
    cy = hy + h_side * r
    cx = xline(c, cy) + x_side * r / cos_t
    th = (cx, hy)
    # foot of the perpendicular from the centre to the slanted line
    d = (cx - s * cy - c) * cos_t  # signed distance along n
    ts = (cx - d * n[0], cy - d * n[1])
    return (cx, cy), th, ts


# ── leg spike: circle tangent to the leg's right line (centre on the gap side),
# best fitting the flare at the top. Search the tangent height and radius.
alpha = a
spike = [(float(x), float(y)) for x, y in contour_pts(leg_rows, leg_y0 + 1, leg_y0 + 90, 'r') if y < 360]
best = (1e9, None)
for ty in np.arange(320, 460, 1.0):
    tp = (xline(cLr, ty), ty)
    for r in np.arange(20, 400, 1.0):
        c = (tp[0] + r * n[0], tp[1] + r * n[1])
        err = np.mean([abs(math.hypot(x - c[0], y - c[1]) - r) for x, y in spike])
        if err < best[0]:
            best = (err, (ty, r, c, tp))
sp_err, (sp_ty, sp_r, sp_c, sp_tp) = best
# where that circle meets the top edge, on its left side
dy = top - sp_c[1]
tip_x = sp_c[0] - math.sqrt(max(0.0, sp_r ** 2 - dy ** 2))
tip = (tip_x, top)

# ── corners
lTL_c, lTL_h, lTL_s = corner(top, +1, cLl, +1, R['leg_TL'])
lBR_c, lBR_h, lBR_s = corner(leg_bot, -1, cLr, -1, R['leg_BR'])
bTL_c, bTL_h, bTL_s = corner(top, +1, cBl, +1, R['bowl_TL'])
bTR_c, bTR_h, bTR_s = corner(top, +1, cBr, -1, R['bowl_TR'])
bBR_c, bBR_h, bBR_s = corner(bowl_bot, -1, cBr, -1, R['bowl_BR'])
leg_BL = (xline(cLl, leg_bot), leg_bot)
bowl_BL = (xline(cBl, bowl_bot), bowl_bot)

# bbox for normalising
xs = [leg_BL[0], bTR_c[0] + R['bowl_TR']]
X0 = min(xs)
Y0 = top
VBW = max(xs) - X0
VBH = leg_bot - top


def P(p):
    return f'{p[0] - X0:.2f} {p[1] - Y0:.2f}'


def A(r, sweep, p):
    return f'A{r:.2f} {r:.2f} 0 0 {sweep} {P(p)}'


leg = ' '.join([
    f'M{P(lTL_h)}',
    f'L{P(tip)}',
    A(sp_r, 0, sp_tp),          # the flare, curving back into the right edge
    f'L{P(lBR_s)}',
    A(R['leg_BR'], 1, lBR_h),
    f'L{P(leg_BL)}',
    f'L{P(lTL_s)}',
    A(R['leg_TL'], 1, lTL_h),
    'Z',
])
bowl = ' '.join([
    f'M{P(bTL_h)}',
    f'L{P(bTR_h)}',
    A(R['bowl_TR'], 1, bTR_s),
    f'L{P(bBR_s)}',
    A(R['bowl_BR'], 1, bBR_h),
    f'L{P(bowl_BL)}',
    f'L{P(bTL_s)}',
    A(R['bowl_TL'], 1, bTL_h),
    'Z',
])

# ── score: rasterise the path (arcs flattened) and compare with the artwork
def flatten(d):
    toks = re.findall(r'[MLAZ]|-?\d+\.?\d*', d)
    pts, i, cur = [], 0, None
    while i < len(toks):
        t = toks[i]
        if t in 'ML':
            cur = (float(toks[i + 1]), float(toks[i + 2])); pts.append(cur); i += 3
        elif t == 'A':
            r = float(toks[i + 1]); sweep = int(toks[i + 5]); end = (float(toks[i + 6]), float(toks[i + 7]))
            # centre of the minor arc between cur and end with this sweep
            mx, my = (cur[0] + end[0]) / 2, (cur[1] + end[1]) / 2
            dx, dy = end[0] - cur[0], end[1] - cur[1]
            q = math.hypot(dx, dy)
            h = math.sqrt(max(0.0, r * r - (q / 2) ** 2))
            ux, uy = -dy / q, dx / q
            c = (mx + ux * h, my + uy * h) if sweep == 1 else (mx - ux * h, my - uy * h)
            a0 = math.atan2(cur[1] - c[1], cur[0] - c[0]); a1 = math.atan2(end[1] - c[1], end[0] - c[0])
            if sweep == 1 and a1 < a0: a1 += 2 * math.pi
            if sweep == 0 and a1 > a0: a1 -= 2 * math.pi
            for k in range(1, 25):
                ang = a0 + (a1 - a0) * k / 24
                pts.append((c[0] + r * math.cos(ang), c[1] + r * math.sin(ang)))
            cur = end; i += 8
        else:
            i += 1
    return pts

S = 4
Wc, Hc = int(VBW) + 6, int(VBH) + 6
img = Image.new('L', (Wc * S, Hc * S), 0)
dr = ImageDraw.Draw(img)
for d in (leg, bowl):
    dr.polygon([((x + 2) * S, (y + 2) * S) for x, y in flatten(d)], fill=255)
mine = np.array(img.resize((Wc, Hc), Image.BOX)) > 127
src = alpha > 0.5
best_iou = 0
for oy in range(-3, 4):
    for ox in range(-3, 4):
        y0 = int(round(Y0)) - 2 + oy; x0 = int(round(X0)) - 2 + ox
        o = src[y0:y0 + Hc, x0:x0 + Wc]
        if o.shape != mine.shape: continue
        iou = (mine & o).sum() / (mine | o).sum()
        if iou > best_iou: best_iou, bo = iou, (ox, oy)

out = dict(vbW=round(VBW, 2), vbH=round(VBH, 2), leg=leg, bowl=bowl, iou=round(float(best_iou), 4),
           spike=dict(r=sp_r, err=round(float(sp_err), 2), tip_x=round(tip_x - X0, 1)),
           gap_k=round(-s, 4), gap_w=round(gap_h, 2),
           gap_x_mid=round(((xline(cLr, Y0 + VBH / 2) + xline(cBl, Y0 + VBH / 2)) / 2 - X0) / VBW, 4))
print(json.dumps({k: v for k, v in out.items() if k not in ('leg', 'bowl')}))
open(outp, 'w').write(f'''/**
 * The POWR P, rebuilt as clean geometry from assets/images/powr_transparent.png
 * by scripts/trace-powr-mark.py: the artwork's own slant, flat edges, corner
 * radii, channel and top-right flare, measured from its anti-aliased edges and
 * redrawn as lines + arcs (match vs the artwork: {out['iou'] * 100:.2f}%).
 * GENERATED — re-run the script rather than editing the paths by hand.
 */

export const POWR_MARK_VB_W = {out['vbW']};
export const POWR_MARK_VB_H = {out['vbH']};

/** The left piece: the full-height leg. Its top-right flares into a point that follows the bowl. */
export const POWR_MARK_LEG = '{leg}';

/** The right piece: the bowl, sharp at its bottom-left. */
export const POWR_MARK_BOWL = '{bowl}';

/** The channel between them: horizontal shift per unit of height along its slant. */
export const POWR_MARK_GAP_K = {out['gap_k']};

/** The channel's centre at mid-height, as a fraction of the width. */
export const POWR_MARK_GAP_X = {out['gap_x_mid']};

/** The channel's horizontal width, in viewBox units. */
export const POWR_MARK_GAP_W = {out['gap_w']};
''')
