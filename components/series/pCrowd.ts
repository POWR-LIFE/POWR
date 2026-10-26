/*
 * The P mark's geometry, and the start line's crowd as a P made of Ps: one
 * tiny P per person waiting, filling a big P. Pure geometry, no React, so it
 * can be tested and memoised.
 *
 * The mark is two pieces in a 760.59 × 531.05 box with arcs at the corners
 * (P_LEG / P_BOWL, drawn by the lockup in season.tsx). Android drew the big
 * start-line P's arcs as straight cuts, so the big P draws the same shape as
 * cubic curves (P_LEG_CURVES / P_BOWL_CURVES). "Is this seat inside the P"
 * tests the pieces flattened to polygons, rounded corners and all; a tiny P is
 * just the corner points, since its corners are too small to show.
 *
 * Every sloping edge of the mark runs at one slope (SLANT), the tiny Ps' too,
 * so the seats are an italic lattice at that slope: the crowd's sides run
 * straight along the P's, never in steps.
 */

export const P_W = 760.59;
export const P_H = 531.05;
export const P_LEG = 'M251.65 0.00 L505.45 0.00 A78.00 78.00 0 0 0 465.67 41.58 L283.61 490.33 A65.25 65.25 0 0 1 223.14 531.05 L0.00 531.05 L201.84 33.54 A53.75 53.75 0 0 1 251.65 0.00 Z';
export const P_BOWL = 'M556.68 0.00 L719.59 0.00 A41.00 41.00 0 0 1 757.59 56.41 L644.27 335.71 A68.25 68.25 0 0 1 581.03 378.30 L361.61 378.30 L499.46 38.54 A61.75 61.75 0 0 1 556.68 0.00 Z';

type Pt = [number, number];
type Seg = { to: Pt; arc?: { r: number; large: boolean; sweep: boolean } };

/** The mark's paths are M, L, A (circular, unrotated) and Z only. */
function parse(d: string): { start: Pt; segs: Seg[] } {
    let start: Pt = [0, 0];
    const segs: Seg[] = [];
    for (const [, cmd, args] of d.matchAll(/([MLAZ])([^MLAZ]*)/g)) {
        const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
        if (cmd === 'M') start = [n[0], n[1]];
        else if (cmd === 'L') segs.push({ to: [n[0], n[1]] });
        else if (cmd === 'A') segs.push({ to: [n[5], n[6]], arc: { r: n[0], large: n[3] === 1, sweep: n[4] === 1 } });
    }
    return { start, segs };
}

/** An arc as its centre and the angles it runs between (SVG's endpoint-to-centre conversion, for a circle). */
function arcCentre(from: Pt, to: Pt, { r: r0, large, sweep }: NonNullable<Seg['arc']>) {
    const hx = (from[0] - to[0]) / 2;
    const hy = (from[1] - to[1]) / 2;
    const d2 = hx * hx + hy * hy;
    const r = Math.max(r0, Math.sqrt(d2));
    const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (r * r - d2) / d2));
    const cx = k * hy + (from[0] + to[0]) / 2;
    const cy = -k * hx + (from[1] + to[1]) / 2;
    const a0 = Math.atan2(from[1] - cy, from[0] - cx);
    let da = Math.atan2(to[1] - cy, to[0] - cx) - a0;
    if (sweep && da < 0) da += 2 * Math.PI;
    if (!sweep && da > 0) da -= 2 * Math.PI;
    return { cx, cy, r, a0, da };
}

const f = ([x, y]: Pt) => `${x.toFixed(2)} ${y.toFixed(2)}`;

/** The same shape with each arc as cubic curves (a quarter turn at most per curve). */
export function toCurves(d: string): string {
    const { start, segs } = parse(d);
    let at = start;
    let out = `M${f(start)}`;
    for (const s of segs) {
        if (s.arc) {
            const { cx, cy, r, a0, da } = arcCentre(at, s.to, s.arc);
            const n = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 2) - 1e-9));
            const step = da / n;
            const k = (4 / 3) * Math.tan(step / 4);
            for (let i = 0; i < n; i += 1) {
                const a = a0 + i * step;
                const b = a + step;
                const p1: Pt = [cx + r * Math.cos(a) - k * r * Math.sin(a), cy + r * Math.sin(a) + k * r * Math.cos(a)];
                const p2: Pt = [cx + r * Math.cos(b) + k * r * Math.sin(b), cy + r * Math.sin(b) - k * r * Math.cos(b)];
                const p3: Pt = i === n - 1 ? s.to : [cx + r * Math.cos(b), cy + r * Math.sin(b)];
                out += `C${f(p1)} ${f(p2)} ${f(p3)}`;
            }
        } else {
            out += `L${f(s.to)}`;
        }
        at = s.to;
    }
    return `${out}Z`;
}

/** The shape as a polygon, each arc in `steps` straight pieces. */
function toPolygon(d: string, steps = 10): Pt[] {
    const { start, segs } = parse(d);
    const out: Pt[] = [start];
    let at = start;
    for (const s of segs) {
        if (s.arc) {
            const { cx, cy, r, a0, da } = arcCentre(at, s.to, s.arc);
            for (let i = 1; i < steps; i += 1) out.push([cx + r * Math.cos(a0 + (da * i) / steps), cy + r * Math.sin(a0 + (da * i) / steps)]);
        }
        out.push(s.to);
        at = s.to;
    }
    return out;
}

/** Just the corner points (the arcs' ends), for a tiny P. */
function toCorners(d: string): Pt[] {
    const { start, segs } = parse(d);
    const pts = [start, ...segs.map((s) => s.to)];
    const last = pts[pts.length - 1];
    return last[0] === start[0] && last[1] === start[1] ? pts.slice(0, -1) : pts;
}

export const P_LEG_CURVES = toCurves(P_LEG);
export const P_BOWL_CURVES = toCurves(P_BOWL);
const SHAPE = [toPolygon(P_LEG), toPolygon(P_BOWL)];
const CORNERS = [toCorners(P_LEG), toCorners(P_BOWL)];

function inside(poly: Pt[], x: number, y: number): boolean {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
}
/** Is a point (in P units) inside the P? */
export const insideP = (x: number, y: number) => SHAPE.some((poly) => inside(poly, x, y));

/** The mark's slope: every sloping edge runs 0.4057 across for each 1 down. */
export const SLANT = 201.84 / (531.05 - 33.54);
/** Across the slope, in P units: in this frame the leg and the bowl are upright boxes. */
const uOf = (x: number, y: number) => x - (P_H - y) * SLANT;

/** Where a horizontal line at `y` crosses a polygon: its leftmost and rightmost x. */
function spanAt(poly: Pt[], y: number): [number, number] {
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
    }
    return [Math.min(...xs), Math.max(...xs)];
}

/** The leg and the bowl in the slope's frame: across (u0–u1) where their sloping sides are, and down to y1. */
export const BOXES = SHAPE.map((poly) => {
    const y1 = Math.max(...poly.map((p) => p[1]));
    const [l, r] = spanAt(poly, y1 / 2);
    return { u0: uOf(l, y1 / 2), u1: uOf(r, y1 / 2), y1 };
});
/** The mark's width across the slope (a tiny P's too). */
const U_W = BOXES[1].u1;
/** The largest corner radius (P units): only a seat this near one of a box's corners can miss the P. */
const CORNER = 80;

/**
 * A seat in the big P, in pixels from its top left. `row` 0 is the bottom;
 * `col` counts along the row within its piece, `lane` across the whole P (the
 * leg's columns, then the bowl's); `u` is how far across the P it is, 0–1.
 */
export type Cell = { x: number; y: number; row: number; col: number; lane: number; u: number };
export type Seats = { cells: Cell[]; size: number; pitch: number };

/**
 * The seats for a big P `width` px wide at fineness `k`: the leg 7k rows tall
 * and the bowl 5k (the pieces are 7 : 5), both as many columns wide as fit at
 * the tiny Ps' own proportions, each piece's columns spaced to fill it exactly.
 * Rows line up across both pieces from the top. A seat is kept when its tiny P
 * sits inside the P (the rounded corners lose a few). Bottom row first, left
 * to right. `size` is a tiny P's width and `pitch` the row spacing, in px.
 */
function lattice(width: number, k: number): Seats {
    const px = width / P_W;
    const py = P_H / (7 * k);
    const pu = (U_W / P_H) * py;
    const legRows = 7 * k;
    const out: Cell[] = [];
    let cu0 = pu;
    let lanes = 0;
    BOXES.forEach((box, b) => {
        const rows = Math.round(box.y1 / py);
        const cols = Math.max(1, Math.round((box.u1 - box.u0) / pu));
        const cu = (box.u1 - box.u0) / cols;
        if (b === 0) cu0 = cu;
        for (let i = 0; i < rows; i += 1) {
            const yc = (i + 0.5) * py;
            const nearEnd = yc < CORNER || box.y1 - yc < CORNER;
            for (let c = 0; c < cols; c += 1) {
                const uc = box.u0 + (c + 0.5) * cu;
                // The sides are exact by construction; near a rounded corner, most of the
                // tiny P must be inside the P (the mask trims the rest).
                let fits = true;
                if (nearEnd && (uc - box.u0 < CORNER || box.u1 - uc < CORNER)) {
                    for (let q = 0; q < 4 && fits; q += 1) {
                        const yy = yc + (q < 2 ? -0.3 : 0.3) * py;
                        fits = inside(SHAPE[b], uc + (q === 0 || q === 3 ? -0.3 : 0.3) * cu + (P_H - yy) * SLANT, yy);
                    }
                }
                if (fits) out.push({ x: (uc + (P_H - yc) * SLANT) * px, y: yc * px, row: legRows - 1 - i, col: c, lane: lanes + c, u: uc / U_W });
            }
        }
        lanes += cols;
    });
    out.sort((a, b) => a.row - b.row || a.x - b.x);
    return { cells: out, size: 0.8 * cu0 * (P_W / U_W) * px, pitch: py * px };
}

/**
 * The seats for a big P `width` px wide and a crowd of `people`: the finest
 * lattice needed to give everyone a seat, but rows never closer than
 * `minPitch` px (past that, one tiny P stands for more than one person).
 */
export function seatsFor(width: number, people: number, minPitch = 4.5): Seats {
    // Rows are P_H / 7k apart: the finest k that keeps them readable.
    const finest = Math.max(2, Math.floor((width / P_W) * (P_H / (7 * minPitch))));
    // About 40k² seats at fineness k: start just under the estimate (usually one or two builds).
    let k = Math.min(finest, Math.max(2, Math.floor(Math.sqrt(people / 40))));
    let best = lattice(width, k);
    while (best.cells.length < people && k < finest) {
        k += 1;
        best = lattice(width, k);
    }
    return best;
}

/** A fixed pseudo-random number in 0–1 for `i`: the same every time. */
export const jitter = (i: number) => {
    const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
};

/**
 * The order the seats fill in: scattered across the whole P (people come
 * forward from the depth behind it into any seat, never row by row). The same
 * every time for the same seats. Seats in `skip` (you, your friends, the space
 * around you) are left out.
 */
export function fillOrder(cells: Cell[], skip: Set<number> = new Set()): number[] {
    const key = cells.map((_, i) => jitter(i));
    return cells.map((_, i) => i).filter((i) => !skip.has(i)).sort((a, b) => key[a] - key[b]);
}

/** One tiny P, `size` px wide, centred on (cx, cy), as path commands. */
export function glyph(cx: number, cy: number, size: number): string {
    const k = size / P_W;
    const x0 = cx - size / 2;
    const y0 = cy - (P_H * k) / 2;
    // Built by hand: a crowd is a couple of thousand of these, and Hermes is slow at toFixed and map/join.
    let d = '';
    for (const poly of CORNERS) {
        for (let i = 0; i < poly.length; i += 1) {
            d += `${i ? 'L' : 'M'}${Math.round((x0 + poly[i][0] * k) * 10) / 10} ${Math.round((y0 + poly[i][1] * k) * 10) / 10}`;
        }
        d += 'Z';
    }
    return d;
}

/** Many tiny Ps as one path: a crowd draws as a single shape. */
export function glyphs(cells: Cell[], size: number): string {
    let d = '';
    for (const c of cells) d += glyph(c.x, c.y, size);
    return d;
}
