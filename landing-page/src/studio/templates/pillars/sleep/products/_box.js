/**
 * A rigid presentation box, drawn in real perspective: the open base seen
 * from above and a little to one side, its lid propped up behind it, a
 * product standing inside. Matte black board lit from the upper left, walls
 * with thickness whose top edges catch the light, an interior lined in a deep
 * shade of the brand's colour, the brand's name pressed into the lid over a
 * fine foil rule, and a soft shadow grounding it all.
 *
 * Everything is in box units (the base is 1 wide), projected through one
 * camera, then fitted into the layout box the template hands over.
 */
import { productShot, isCutout, mockRect } from '../../kit';

// ── Scene ─────────────────────────────────────────────────────────────────
const BW = 1;        // base width (x)
const BD = 0.7;      // base depth (z)
const BH = 0.3;      // base height (y)
const T = 0.035;     // wall thickness
const FLOOR = 0.02;  // floor thickness
const LID_H = 0.74;  // the lid's depth, standing up as its height
const LID_T = 0.1;   // the lid's rim depth (its thickness when propped)
const LID_LEAN = (16 * Math.PI) / 180;
const LID_GAP = 0.06; // how far behind the base the lid stands
const YAW = (-24 * Math.PI) / 180;
const PITCH = (27 * Math.PI) / 180;
const DIST = 5.2;
const AIM = [0, 0.32, -0.12];
const LIGHT = norm([-0.55, 0.85, 0.55]);

function norm(v) {
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const cy = Math.cos(YAW);
const sy = Math.sin(YAW);
const yawed = ([x, y, z]) => [x * cy + z * sy, y, -x * sy + z * cy];
// The camera sits on the +z side, raised by PITCH, looking at AIM.
const CAM = [AIM[0], AIM[1] + DIST * Math.sin(PITCH), AIM[2] + DIST * Math.cos(PITCH)];
const UP = [0, Math.cos(PITCH), -Math.sin(PITCH)];
const FWD = [0, -Math.sin(PITCH), -Math.cos(PITCH)];
// World → camera-space depth and unit-focal screen coordinates.
function project(p) {
    const d = sub(yawed(p), CAM);
    const z = dot(d, FWD);
    return [d[0] / z, -dot(d, UP) / z, z];
}
// Facing the camera? (n is the face's world normal, before yaw.)
const facing = (n, p) => dot(yawed(n), sub(CAM, yawed(p))) > 0;
const lambert = (n) => Math.max(0, dot(yawed(n), LIGHT));

// The lid stands on the ground behind the base, leaning back, outer face out.
const LID_Z0 = -BD / 2 - LID_GAP;
const LU = [0, Math.cos(LID_LEAN), -Math.sin(LID_LEAN)]; // up the lid
const LN = [0, Math.sin(LID_LEAN), Math.cos(LID_LEAN)];  // out of its face
const lidAt = (u, v, w = 0) => [
    (u - 0.5) * (BW + 0.03),
    LU[1] * v * LID_H + LN[1] * w,
    LID_Z0 + LU[2] * v * LID_H + LN[2] * w,
];

// ── Colour ────────────────────────────────────────────────────────────────
function rgb(hex) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
// Matte black board under the key light: never pure black, never grey.
const BOARD = [24, 24, 26];
const lit = (base, n, amb = 0.42, k = 0.75) => {
    const l = amb + k * lambert(n);
    return base.map((v) => Math.min(255, Math.round(v * l + 6 * lambert(n))));
};

/**
 * Draw the box into `box` (canvas px). `k` is the template's unit. Returns
 * the drawn bounds.
 */
export function presentationBox(e, box, k, { kind = 'pouch', name = 'POWR' } = {}) {
    const { ctx } = e;
    const acc = rgb(e.accent);
    // The lining: a warm black with a breath of the brand's colour. A strong
    // mix turns yellow to olive; this keeps any accent rich and dark.
    const lining = mixRgb(mixRgb(acc, [128, 128, 128], 0.35), [14, 12, 12], 0.88);

    // The product: an upright card standing on the floor, centred, a little
    // back so the front wall hides its foot. Its size follows the shot.
    const img = e.asset('product');
    let aspect;
    if (img) {
        aspect = img.width / img.height;
    } else {
        const m = mockRect({ x: 0, y: 0, w: 100, h: 100 }, kind);
        aspect = m.w / m.h;
    }
    const cut = !img || isCutout(img);
    let ph = cut ? BH * 2.15 : BH * 2.4;
    let pw = ph * aspect;
    const maxW = BW * (cut ? 0.62 : 0.56);
    if (pw > maxW) { pw = maxW; ph = pw / aspect; }
    const pz = -0.04;
    // A raised insert for short pieces (an eye mask, a tin): the floor comes
    // up so at least ~60% of the product shows above the rim.
    const FL = Math.min(BH - 0.05, Math.max(FLOOR, BH - ph * 0.42));
    const pBase = [0, FL, pz];
    const z0Inner = -BD / 2 + T;

    // Fit: every point that can show, projected at unit focal length.
    const corners = [];
    for (const x of [-BW / 2, BW / 2]) for (const z of [-BD / 2, BD / 2]) for (const y of [0, BH]) corners.push([x, y, z]);
    for (const u of [0, 1]) for (const v of [0, 1]) for (const w of [0, -LID_T]) corners.push(lidAt(u, v, w));
    const pc = project(pBase);
    const pt = project([0, FL + ph, pz]);
    const pts = corners.map(project);
    const halfW = (pw / 2) / pc[2];
    pts.push([pc[0] - halfW, pt[1]], [pc[0] + halfW, pt[1]]);
    const minX = Math.min(...pts.map((p) => p[0]));
    const maxX = Math.max(...pts.map((p) => p[0]));
    const minY = Math.min(...pts.map((p) => p[1]));
    const maxY = Math.max(...pts.map((p) => p[1]));
    const shadowPad = (maxY - minY) * 0.06;
    const S = Math.min(box.w / (maxX - minX), box.h / (maxY - minY + shadowPad));
    const ox = box.x + (box.w - (maxX - minX) * S) / 2 - minX * S;
    const oy = box.y + (box.h - (maxY - minY + shadowPad) * S) - minY * S;
    const P = (p) => {
        const q = project(p);
        return [ox + q[0] * S, oy + q[1] * S];
    };
    const path = (ps) => {
        ctx.beginPath();
        ps.map(P).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
    };
    // A quad filled along a gradient from one edge's midpoint to the other's.
    const quad = (ps, a, b, from = 0, to = 2) => {
        path(ps);
        const m0 = P(ps[from]);
        const m1 = P(ps[to]);
        const g = ctx.createLinearGradient(m0[0], m0[1], m1[0], m1[1]);
        g.addColorStop(0, a);
        g.addColorStop(1, b);
        ctx.fillStyle = g;
        ctx.fill();
    };
    const edge = (a, b, color, width = 1.2) => {
        const [x0, y0] = P(a);
        const [x1, y1] = P(b);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, width * k);
        ctx.lineCap = 'round';
        ctx.stroke();
    };

    // A photo that isn't a cut-out: a printed card with a white border,
    // leaning back against the inside of the back wall.
    const printedCard = (im) => {
        const lean = (14 * Math.PI) / 180;
        const zc = z0Inner + ph * Math.sin(lean) + 0.012;
        const at = (u, v) => [(u - 0.5) * pw, FL + v * ph * Math.cos(lean), zc - v * ph * Math.sin(lean)];
        const o = P(at(0, 0));
        const xa = P(at(1, 0));
        const ya = P(at(0, 1));
        const cw = Math.hypot(xa[0] - o[0], xa[1] - o[1]);
        const ch = Math.hypot(ya[0] - o[0], ya[1] - o[1]);
        // A soft shadow the card throws on the wall and floor behind it.
        const sc = P(at(0.5, 0.5));
        const sh = ctx.createRadialGradient(sc[0], sc[1], 0, sc[0], sc[1], Math.max(cw, ch) * 0.75);
        sh.addColorStop(0, 'rgba(0,0,0,0.5)');
        sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sh;
        ctx.fillRect(sc[0] - cw, sc[1] - ch, cw * 2, ch * 2);
        ctx.save();
        ctx.setTransform(xa[0] - o[0], xa[1] - o[1], ya[0] - o[0], ya[1] - o[1], o[0], o[1]);
        ctx.transform(1, 0, 0, -1, 0, 1);
        ctx.scale(1 / cw, 1 / ch);
        // Card stock: warm white, lit from the top, a hairline edge.
        const r = Math.min(cw, ch) * 0.025;
        const paper = ctx.createLinearGradient(0, 0, 0, ch);
        paper.addColorStop(0, '#EDEAE3');
        paper.addColorStop(1, '#BDB9B1');
        ctx.fillStyle = paper;
        ctx.beginPath();
        ctx.roundRect(0, 0, cw, ch, r);
        ctx.fill();
        const bd = Math.min(cw, ch) * 0.055;
        const iw = cw - bd * 2;
        const ih = ch - bd * 2.6;
        const sr = Math.max(iw / im.width, ih / im.height);
        const sW = iw / sr;
        const sH = ih / sr;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(im, (im.width - sW) / 2, (im.height - sH) / 2, sW, sH, bd, bd, iw, ih);
        // The print's own light: a touch darker toward the foot of the card.
        const dim = ctx.createLinearGradient(0, 0, 0, ch);
        dim.addColorStop(0, 'rgba(0,0,0,0)');
        dim.addColorStop(1, 'rgba(0,0,0,0.28)');
        ctx.fillStyle = dim;
        ctx.fillRect(0, 0, cw, ch);
        ctx.restore();
        const xs = [o[0], xa[0], ya[0], xa[0] + ya[0] - o[0]];
        const ys = [o[1], xa[1], ya[1], xa[1] + ya[1] - o[1]];
        const box2 = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        e.mark('product', box2);
        return box2;
    };

    ctx.save();

    // ── Ground: a pool of light behind, a soft shadow under ────────────────
    const [gx, gy] = P([0, 0, -0.1]);
    const span = S * 0.9;
    const pool = ctx.createRadialGradient(gx, gy - span * 0.35, 0, gx, gy - span * 0.35, span * 1.3);
    pool.addColorStop(0, css(mixRgb([255, 246, 228], acc, 0.25), 0.1));
    pool.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pool;
    ctx.fillRect(gx - span * 1.4, gy - span * 1.7, span * 2.8, span * 2.8);
    const shadow = (x0, x1, z0, z1, a) => {
        const c = P([(x0 + x1) / 2, 0, (z0 + z1) / 2]);
        const a0 = P([x0, 0, z0]);
        const a1 = P([x1, 0, z0]);
        const rx = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) * 0.62;
        const ry = Math.abs(P([0, 0, z1])[1] - P([0, 0, z0])[1]) * 0.75 + rx * 0.08;
        ctx.save();
        ctx.translate(c[0], c[1]);
        ctx.scale(1, ry / rx);
        const g = ctx.createRadialGradient(0, 0, rx * 0.2, 0, 0, rx);
        g.addColorStop(0, `rgba(0,0,0,${a})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    };
    shadow(-BW / 2 - 0.06, BW / 2 + 0.06, -BD / 2 - 0.04, BD / 2 + 0.08, 0.7);
    shadow(-BW / 2, BW / 2, LID_Z0 - 0.2, LID_Z0 + 0.02, 0.45);

    // ── The lid, propped behind ─────────────────────────────────────────────
    const lidFace = [lidAt(0, 0), lidAt(1, 0), lidAt(1, 1), lidAt(0, 1)];
    const lidTop = [lidAt(0, 1), lidAt(1, 1), lidAt(1, 1, -LID_T), lidAt(0, 1, -LID_T)];
    const lidSideR = [lidAt(1, 0), lidAt(1, 0, -LID_T), lidAt(1, 1, -LID_T), lidAt(1, 1)];
    const lidSideL = [lidAt(0, 0, -LID_T), lidAt(0, 0), lidAt(0, 1), lidAt(0, 1, -LID_T)];
    if (facing([1, 0, 0], lidSideR[0])) quad(lidSideR, css(lit(BOARD, [1, 0, 0], 0.3)), css(lit(BOARD, [1, 0, 0], 0.22)), 0, 3);
    if (facing([-1, 0, 0], lidSideL[1])) quad(lidSideL, css(lit(BOARD, [-1, 0, 0], 0.3)), css(lit(BOARD, [-1, 0, 0], 0.22)), 0, 3);
    quad(lidTop, css(lit(BOARD, LU, 0.5)), css(lit(BOARD, LU, 0.4)), 0, 3);
    // The outer face: light falls off toward the ground.
    quad(lidFace, css(lit(BOARD, LN, 0.46, 0.55)), css(lit(BOARD, LN, 0.3, 0.5)), 3, 0);
    // Edge highlights where the board turns: the top and the lit side.
    edge(lidAt(0, 1), lidAt(1, 1), 'rgba(255,255,255,0.16)', 1.4);
    edge(lidAt(0, 0), lidAt(0, 1), 'rgba(255,255,255,0.08)', 1);

    // The name, pressed into the face, over a fine foil rule. Drawn in the
    // face's own plane (an affine fit of its corners: the lean is mild).
    const o = P(lidAt(0, 0));
    const xa = P(lidAt(1, 0));
    const ya = P(lidAt(0, 1));
    ctx.save();
    ctx.setTransform(xa[0] - o[0], xa[1] - o[1], ya[0] - o[0], ya[1] - o[1], o[0], o[1]);
    // Now (0,0)→(1,1) spans the face, v running up. Flip v so text reads up.
    ctx.transform(1, 0, 0, -1, 0, 1);
    const t = String(name).toUpperCase().trim() || 'POWR';
    const faceW = Math.hypot(xa[0] - o[0], xa[1] - o[1]);
    const faceH = Math.hypot(ya[0] - o[0], ya[1] - o[1]);
    // Work in face pixels: scale the unit square to faceW × faceH.
    ctx.scale(1 / faceW, 1 / faceH);
    let px = faceH * 0.1;
    ctx.font = `500 ${px}px "Outfit"`;
    const track = 0.42;
    const measure = () => [...t].reduce((s, ch) => s + ctx.measureText(ch).width + px * track, -px * track);
    if (measure() > faceW * 0.62) { px *= (faceW * 0.62) / measure(); ctx.font = `500 ${px}px "Outfit"`; }
    const tw = measure();
    const ty = faceH * 0.2 + px * 0.5;
    const write = (dx, dy, color) => {
        ctx.fillStyle = color;
        let pen = faceW / 2 - tw / 2 + dx;
        for (const ch of t) { ctx.fillText(ch, pen, ty + dy); pen += ctx.measureText(ch).width + px * track; }
    };
    // Deboss: a dark lip above-left, a lit lip below-right, the letter a step darker than the board.
    write(-px * 0.03, -px * 0.03, 'rgba(0,0,0,0.55)');
    write(px * 0.03, px * 0.03, 'rgba(255,255,255,0.09)');
    write(0, 0, css(lit(BOARD, LN, 0.3, 0.45)));
    // Foil rule in the accent, with a sheen.
    const rw = faceW * 0.1;
    const rg = ctx.createLinearGradient(faceW / 2 - rw / 2, 0, faceW / 2 + rw / 2, 0);
    rg.addColorStop(0, css(mixRgb(acc, [0, 0, 0], 0.25)));
    rg.addColorStop(0.45, css(mixRgb(acc, [255, 255, 255], 0.35)));
    rg.addColorStop(1, css(mixRgb(acc, [0, 0, 0], 0.2)));
    ctx.fillStyle = rg;
    ctx.fillRect(faceW / 2 - rw / 2, ty + px * 0.75, rw, Math.max(1, px * 0.07));
    ctx.restore();

    // ── The base: floor and the inside of the far walls ─────────────────────
    const x0 = -BW / 2 + T;
    const x1 = BW / 2 - T;
    const z0 = -BD / 2 + T;
    const z1 = BD / 2 - T;
    const floor = [[x0, FL, z0], [x1, FL, z0], [x1, FL, z1], [x0, FL, z1]];
    const inner = {
        back: { ps: [[x0, FL, z0], [x1, FL, z0], [x1, BH, z0], [x0, BH, z0]], n: [0, 0, 1] },
        front: { ps: [[x1, FL, z1], [x0, FL, z1], [x0, BH, z1], [x1, BH, z1]], n: [0, 0, -1] },
        left: { ps: [[x0, FL, z1], [x0, FL, z0], [x0, BH, z0], [x0, BH, z1]], n: [1, 0, 0] },
        right: { ps: [[x1, FL, z0], [x1, FL, z1], [x1, BH, z1], [x1, BH, z0]], n: [-1, 0, 0] },
    };
    // The lining in shadow: the box's own walls block most of the light.
    quad(floor, css(lit(lining, [0, 1, 0], 0.5, 0.35)), css(lit(lining, [0, 1, 0], 0.7, 0.35)), 0, 3);
    for (const w of Object.values(inner)) {
        if (!facing(w.n, w.ps[0])) continue;
        // Darker at the floor (where the corners meet), lighter at the rim.
        quad(w.ps, css(lit(lining, w.n, 0.28, 0.25)), css(lit(lining, w.n, 0.62, 0.5)), 0, 3);
    }
    // Ambient occlusion along the floor's far edges.
    const fc = P([0, FL, 0]);
    const ao = ctx.createRadialGradient(fc[0], fc[1], 0, fc[0], fc[1], S * 0.42);
    ao.addColorStop(0, 'rgba(0,0,0,0)');
    ao.addColorStop(1, 'rgba(0,0,0,0.35)');
    path(floor);
    ctx.fillStyle = ao;
    ctx.fill();

    // Rim tops behind the product: the back wall's and the far side's.
    const rim = {
        back: { ps: [[-BW / 2, BH, -BD / 2], [BW / 2, BH, -BD / 2], [x1, BH, z0], [x0, BH, z0]] },
        front: { ps: [[x0, BH, z1], [x1, BH, z1], [BW / 2, BH, BD / 2], [-BW / 2, BH, BD / 2]] },
        left: { ps: [[-BW / 2, BH, -BD / 2], [x0, BH, z0], [x0, BH, z1], [-BW / 2, BH, BD / 2]] },
        right: { ps: [[x1, BH, z0], [BW / 2, BH, -BD / 2], [BW / 2, BH, BD / 2], [x1, BH, z1]] },
    };
    const rimFill = css(lit(BOARD, [0, 1, 0], 0.62, 0.55));
    const drawRim = (r) => { path(r.ps); ctx.fillStyle = rimFill; ctx.fill(); };
    // Which side wall is the far one depends on the yaw.
    const farSide = facing([1, 0, 0], [x0, BH, 0]) ? 'left' : 'right';
    const nearSide = farSide === 'left' ? 'right' : 'left';
    drawRim(rim.back);
    drawRim(rim[farSide]);

    // A soft shadow the product casts on the floor and back wall.
    const pb = P(pBase);
    const sw = (pw / pc[2]) * S;
    const cs = ctx.createRadialGradient(pb[0], pb[1], 0, pb[0], pb[1], sw * 0.75);
    cs.addColorStop(0, 'rgba(0,0,0,0.45)');
    cs.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    path(floor);
    ctx.clip();
    ctx.fillStyle = cs;
    ctx.fillRect(pb[0] - sw, pb[1] - sw, sw * 2, sw * 2);
    ctx.restore();

    ctx.restore();

    // ── The product ─────────────────────────────────────────────────────────
    let shot;
    if (img && !cut) {
        shot = { rect: printedCard(img) };
    } else {
        const top = P([0, FL + ph, pz]);
        const rect = { x: pb[0] - sw / 2, y: top[1], w: sw, h: pb[1] - top[1] };
        shot = productShot(e, rect, { kind, stage: false, sub: '', radius: 10 });
    }

    // ── Near walls and rims, over the product's foot ────────────────────────
    ctx.save();
    drawRim(rim.front);
    drawRim(rim[nearSide]);
    const outer = {
        front: { ps: [[-BW / 2, 0, BD / 2], [BW / 2, 0, BD / 2], [BW / 2, BH, BD / 2], [-BW / 2, BH, BD / 2]], n: [0, 0, 1] },
        right: { ps: [[BW / 2, 0, BD / 2], [BW / 2, 0, -BD / 2], [BW / 2, BH, -BD / 2], [BW / 2, BH, BD / 2]], n: [1, 0, 0] },
        left: { ps: [[-BW / 2, 0, -BD / 2], [-BW / 2, 0, BD / 2], [-BW / 2, BH, BD / 2], [-BW / 2, BH, -BD / 2]], n: [-1, 0, 0] },
    };
    for (const w of Object.values(outer)) {
        if (!facing(w.n, w.ps[0])) continue;
        // Light from above: the top of each wall a touch brighter than its foot.
        quad(w.ps, css(lit(BOARD, w.n, 0.26, 0.5)), css(lit(BOARD, w.n, 0.44, 0.62)), 0, 3);
    }
    // The board's edges catching the light: the outer rim, and the near
    // vertical corner. The inner rim stays dark.
    edge([-BW / 2, BH, BD / 2], [BW / 2, BH, BD / 2], 'rgba(255,255,255,0.22)', 1.4);
    const sideX = nearSide === 'right' ? BW / 2 : -BW / 2;
    edge([sideX, BH, BD / 2], [sideX, BH, -BD / 2], 'rgba(255,255,255,0.14)', 1.2);
    edge([sideX, 0, BD / 2], [sideX, BH, BD / 2], 'rgba(255,255,255,0.1)', 1);
    edge([x0, BH, z1], [x1, BH, z1], 'rgba(0,0,0,0.5)', 1);
    // A ribbon pull in the accent, built on the box itself: it comes up from
    // inside, folds ribOver the front rim and hangs down the outer face, ending
    // in a ribNotch — every point lives on the board, so it follows the wall's
    // angle in any size.
    const ribX = -BW * 0.3;
    const ribW = 0.052;
    const ribLift = 0.0025; // just proud of the board
    const ribZ = BD / 2 + ribLift;
    const ribEnd = BH * 0.4;
    const ribNotch = ribW * 0.55;
    const ribTail = (dx = 0, dy = 0) => [
        [ribX - ribW / 2 + dx, BH + dy, ribZ], [ribX + ribW / 2 + dx, BH + dy, ribZ],
        [ribX + ribW / 2 + dx, ribEnd + dy, ribZ], [ribX + dx, ribEnd + ribNotch + dy, ribZ], [ribX - ribW / 2 + dx, ribEnd + dy, ribZ],
    ];
    // Its shadow on the board: the same shape, a hair down and to the right.
    path(ribTail(0.006, -0.008));
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    // Over the rim: a short run across the wall's top, lit from above.
    const ribOver = [[ribX - ribW / 2, BH + ribLift, z1 - 0.004], [ribX + ribW / 2, BH + ribLift, z1 - 0.004], [ribX + ribW / 2, BH + ribLift, ribZ], [ribX - ribW / 2, BH + ribLift, ribZ]];
    path(ribOver);
    ctx.fillStyle = css(mixRgb(acc, [255, 255, 255], 0.18));
    ctx.fill();
    // Down the face: ribSatin, a sheen running along the ribbon's length.
    const ribL = P([ribX - ribW / 2, (BH + ribEnd) / 2, ribZ]);
    const ribR = P([ribX + ribW / 2, (BH + ribEnd) / 2, ribZ]);
    const ribSatin = ctx.createLinearGradient(ribL[0], ribL[1], ribR[0], ribR[1]);
    ribSatin.addColorStop(0, css(mixRgb(acc, [0, 0, 0], 0.42)));
    ribSatin.addColorStop(0.42, css(mixRgb(acc, [255, 255, 255], 0.1)));
    ribSatin.addColorStop(0.6, css(acc));
    ribSatin.addColorStop(1, css(mixRgb(acc, [0, 0, 0], 0.48)));
    path(ribTail());
    ctx.fillStyle = ribSatin;
    ctx.fill();
    // The fold at the rim's edge catches the light.
    edge([ribX - ribW / 2, BH + ribLift, ribZ], [ribX + ribW / 2, BH + ribLift, ribZ], css(mixRgb(acc, [255, 255, 255], 0.45)), 1);
    ctx.restore();

    return {
        x: ox + minX * S, y: oy + minY * S, w: (maxX - minX) * S, h: (maxY - minY) * S,
        product: shot.rect,
    };
}
