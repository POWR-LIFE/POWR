import { smoothPath, splitGaps } from '@/components/progress/Sparkline';

/**
 * Regression cover for the BODY tab's resting-HR chart.
 *
 * Every tangent in a monotone cubic divides by the x-gap between samples, so
 * two points sharing an x put `NaN` into the `d` string — and react-native-svg
 * does not skip the bad segment, it dies in the native parser on the 'N'
 * ("Invalid number formatting character 'N'"), taking the whole tab with it.
 *
 * Coincident x is ORDINARY input here, not a corner case: the chart's x-scale
 * clamps anything outside its window onto the edge, so the moment a series
 * carries one reading more than the window has columns, two of them stack.
 */

const hasBadNumber = (d: string) => /NaN|Infinity|undefined/.test(d);

describe('smoothPath', () => {
    it('never emits NaN when readings clamp onto the same x', () => {
        // Exactly the shape that crashed: the window's oldest two readings
        // both pinned to the left edge.
        const d = smoothPath([
            { x: 8, y: 50 }, { x: 8, y: 44 }, { x: 40, y: 46 }, { x: 80, y: 52 },
        ]);

        expect(hasBadNumber(d)).toBe(false);
        expect(d).toMatch(/^M 8 44 C /); // newest of the stacked pair wins
    });

    it.each([
        ['coincident x with identical y', [{ x: 8, y: 50 }, { x: 8, y: 50 }, { x: 40, y: 46 }]],
        ['several stacked pairs', [{ x: 8, y: 50 }, { x: 8, y: 44 }, { x: 40, y: 46 }, { x: 40, y: 41 }, { x: 80, y: 52 }]],
        ['a stack at the right edge (future-dated row)', [{ x: 8, y: 50 }, { x: 80, y: 52 }, { x: 80, y: 47 }]],
        ['a completely flat series', [{ x: 8, y: 42 }, { x: 40, y: 42 }, { x: 80, y: 42 }]],
        ['two points', [{ x: 8, y: 50 }, { x: 80, y: 44 }]],
    ])('stays free of bad numbers for %s', (_label, pts) => {
        expect(hasBadNumber(smoothPath(pts))).toBe(false);
    });

    it.each([
        ['no points', []],
        ['a single point', [{ x: 8, y: 50 }]],
        ['every point on one x', [{ x: 8, y: 50 }, { x: 8, y: 44 }, { x: 8, y: 46 }]],
    ])('draws nothing rather than a broken path for %s', (_label, pts) => {
        // The caller still renders the today dot, so an empty path degrades to
        // "no line" instead of no chart.
        expect(smoothPath(pts)).toBe('');
    });

    it('never overshoots the readings it was given', () => {
        // The whole reason for monotone cubic over a plain spline: the curve
        // must not invent a peak the wearable never recorded.
        const pts = [
            { x: 0, y: 40 }, { x: 10, y: 20 }, { x: 20, y: 21 },
            { x: 30, y: 60 }, { x: 40, y: 22 }, { x: 50, y: 21 },
        ];
        const ys = pts.map(p => p.y);

        // Control-point y's are every second number after the leading "M x y".
        const nums = smoothPath(pts).match(/-?[\d.]+/g)!.map(Number);
        const yValues = nums.filter((_, i) => i % 2 === 1);

        expect(Math.min(...yValues)).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9);
        expect(Math.max(...yValues)).toBeLessThanOrEqual(Math.max(...ys) + 1e-9);
    });
});


describe('splitGaps', () => {
    const p = (date: string) => ({ date });

    it('breaks the series wherever consecutive readings are further apart than the gap', () => {
        const segs = splitGaps([
            p('2026-09-01'), p('2026-09-02'), p('2026-09-03'),
            p('2026-09-08'), // 5 days later — a sync gap
            p('2026-09-09'),
        ], 3);
        expect(segs.map(s => s.map(x => x.date))).toEqual([
            ['2026-09-01', '2026-09-02', '2026-09-03'],
            ['2026-09-08', '2026-09-09'],
        ]);
    });

    it('a gap exactly at the limit does not break', () => {
        const segs = splitGaps([p('2026-09-01'), p('2026-09-04')], 3);
        expect(segs).toHaveLength(1);
    });

    it('a lone reading after a gap is its own segment (drawn as a dot, no curve)', () => {
        const segs = splitGaps([p('2026-09-01'), p('2026-09-02'), p('2026-09-20')], 3);
        expect(segs).toHaveLength(2);
        expect(segs[1]).toHaveLength(1);
        expect(smoothPath(segs[1].map((x, i) => ({ x: i, y: 0 })))).toBe('');
    });

    it('empty in, empty out', () => {
        expect(splitGaps([], 3)).toEqual([]);
    });
});
