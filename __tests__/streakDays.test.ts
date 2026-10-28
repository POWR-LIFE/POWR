// London: the clocks go back on Sun 25 Oct 2026, so that local day is 25 hours long.
process.env.TZ = 'Europe/London';

import { currentRun, longestRun } from '@/lib/streakDays';

/** Every day from `from` to `to`, most recent first (stepped in UTC, so DST can't skip one). */
const days = (from: string, to: string) => {
    const out: string[] = [];
    for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += 86_400_000) {
        out.push(new Date(ms).toISOString().slice(0, 10));
    }
    return out.reverse();
};

describe('streak day arithmetic across the clock change', () => {
    it('the local-midnight step the old count used is 25 h on the fall-back day', () => {
        const gap = new Date('2026-10-26T00:00:00').getTime() - new Date('2026-10-25T00:00:00').getTime();
        expect(gap).toBe(25 * 3_600_000);
    });

    it('counts straight through 25 Oct', () => {
        const run = days('2026-09-08', '2026-10-28');
        expect(run).toHaveLength(51);
        expect(currentRun(run, '2026-10-28', '2026-10-27')).toBe(51);
        expect(longestRun(run)).toBe(51);
    });

    it('counts straight through the spring-forward day (29 Mar 2026)', () => {
        const run = days('2026-03-20', '2026-04-02');
        expect(currentRun(run, '2026-04-02', '2026-04-01')).toBe(14);
    });

    it('still stands when you have not moved yet today', () => {
        expect(currentRun(days('2026-10-20', '2026-10-27'), '2026-10-28', '2026-10-27')).toBe(8);
    });

    it('is over once the last day is before yesterday', () => {
        expect(currentRun(days('2026-10-20', '2026-10-26'), '2026-10-28', '2026-10-27')).toBe(0);
    });

    it('stops at a real gap, and the longest run looks past it', () => {
        const run = [...days('2026-10-26', '2026-10-28'), ...days('2026-10-01', '2026-10-24')];
        expect(currentRun(run, '2026-10-28', '2026-10-27')).toBe(3);
        expect(longestRun(run)).toBe(24);
    });

    it('is 0 with no days', () => {
        expect(currentRun([], '2026-10-28', '2026-10-27')).toBe(0);
        expect(longestRun([])).toBe(0);
    });
});
