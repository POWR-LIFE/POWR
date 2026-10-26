import {
    fillOrder, glyph, insideP, P_BOWL_CURVES, P_H, P_LEG_CURVES, P_W, seatsFor, SLANT,
} from '@/components/series/pCrowd';

describe('pCrowd', () => {
    it('knows the inside of the P from the outside', () => {
        expect(insideP(250, 300)).toBe(true); // the leg
        expect(insideP(620, 150)).toBe(true); // the bowl
        expect(insideP(700, 500)).toBe(false); // under the bowl, right of the leg
        expect(insideP(20, 20)).toBe(false); // top left, left of the leg
        expect(insideP(418, 200)).toBe(false); // the channel between leg and bowl (x 401–434 at this height)
        // The bowl's rounded top right: outside the straight cut between the arc's ends, inside the curve.
        expect(insideP(745, 15)).toBe(true);
        expect(insideP(757, 2)).toBe(false); // the square corner the curve rounds off
    });

    it('draws the big P with curves, not arcs, ending where the mark does', () => {
        for (const d of [P_LEG_CURVES, P_BOWL_CURVES]) {
            expect(d).not.toMatch(/A/);
            expect(d).toMatch(/C/);
            expect(d.endsWith('Z')).toBe(true);
        }
        expect(P_LEG_CURVES.startsWith('M251.65 0.00L505.45 0.00C')).toBe(true);
        expect(P_LEG_CURVES).toContain('465.67 41.58L283.61 490.33');
        expect(P_BOWL_CURVES).toContain('757.59 56.41L644.27 335.71');
    });

    it('lays the seats on a lattice at the mark’s slope, so the sides run straight', () => {
        expect(SLANT).toBeCloseTo(0.4057, 4);
        const { cells, pitch } = seatsFor(377, 1500);
        // Down a column, each row up moves right by exactly the slope.
        const leg = cells.filter((c) => c.u < 0.5 && c.col === 0);
        expect(leg.length).toBeGreaterThan(20);
        const ordered = [...leg].sort((a, b) => a.row - b.row);
        for (let i = 1; i < ordered.length; i += 1) {
            const up = ordered[i - 1].y - ordered[i].y;
            expect(ordered[i].x - ordered[i - 1].x).toBeCloseTo(up * SLANT, 3);
        }
        // Rows line up across the leg and the bowl.
        const rowY = new Map<number, number>();
        for (const c of cells) {
            if (rowY.has(c.row)) expect(c.y).toBeCloseTo(rowY.get(c.row)!, 6);
            else rowY.set(c.row, c.y);
        }
        expect(pitch).toBeGreaterThanOrEqual(4.5);
        // Every tiny P's centre is inside the P.
        const k = P_W / 377;
        cells.forEach((c) => expect(insideP(c.x * k, c.y * k)).toBe(true));
    });

    it('seats the crowd at the gun, down to the smallest rows', () => {
        for (const people of [130, 600, 1500]) expect(seatsFor(377, people).cells.length).toBeGreaterThanOrEqual(people);
        // A small phone can't seat 5,000 at a readable size: the rows stop at 4.5 px.
        expect(seatsFor(300, 5000).pitch).toBeGreaterThanOrEqual(4.5);
    });

    it('fills scattered across the whole P, never row by row', () => {
        const { cells } = seatsFor(377, 1500);
        const order = fillOrder(cells);
        expect(new Set(order).size).toBe(cells.length);
        expect(fillOrder(cells)).toEqual(order); // the same every time
        // A third in: every part of the P is about a third full, top and bottom, leg and bowl.
        const third = new Set(order.slice(0, Math.floor(order.length / 3)));
        const top = Math.max(...cells.map((c) => c.row));
        const parts = [
            cells.filter((c) => c.row < top / 3),
            cells.filter((c) => c.row > (2 * top) / 3),
            cells.filter((c) => c.u < 0.5),
            cells.filter((c) => c.u > 0.5),
        ];
        for (const part of parts) {
            const share = part.filter((c) => third.has(cells.indexOf(c))).length / part.length;
            expect(share).toBeGreaterThan(0.25);
            expect(share).toBeLessThan(0.42);
        }
        expect(fillOrder(cells, new Set([0, 1, 2])).length).toBe(cells.length - 3);
    });

    it('draws a tiny P as its two corner-point pieces', () => {
        expect(glyph(10, 10, 8).match(/Z/g)).toHaveLength(2);
        expect(glyph(10, 10, 8)).not.toMatch(/[AC]/);
        expect(P_H).toBeCloseTo(531.05);
    });
});
