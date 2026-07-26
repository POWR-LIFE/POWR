// Calendar-month anchors for the Progress page's M view. The M view used to be
// a trailing 30-day window ("May 28 – Jun 26"), which read as nonsense to users;
// it is now the calendar month. These cover the arithmetic that change hinges
// on: month-length variation, leap years, year rollover, and the 31st-of-the-
// month setMonth() overflow that would silently land on the wrong month.

import { dayAnchor, monthAnchorEnd, monthAnchorStart, monthLabel, rangeLabel } from '@/lib/progressLookback';

/** Runs `fn` with the clock pinned to a fixed local instant. */
function at(iso: string, fn: () => void) {
    jest.useFakeTimers().setSystemTime(new Date(iso));
    try {
        fn();
    } finally {
        jest.useRealTimers();
    }
}

const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('monthAnchorStart', () => {
    it('is the 1st of the current month at offset 0', () => {
        at('2026-07-26T14:00:00', () => {
            expect(ymd(monthAnchorStart(0))).toBe('2026-07-01');
        });
    });

    it('steps back one calendar month at a time', () => {
        at('2026-07-26T14:00:00', () => {
            expect(ymd(monthAnchorStart(-1))).toBe('2026-06-01');
            expect(ymd(monthAnchorStart(-2))).toBe('2026-05-01');
            expect(ymd(monthAnchorStart(-6))).toBe('2026-01-01');
        });
    });

    it('rolls back into the previous year', () => {
        at('2026-02-10T09:00:00', () => {
            expect(ymd(monthAnchorStart(-2))).toBe('2025-12-01');
            expect(ymd(monthAnchorStart(-14))).toBe('2024-12-01');
        });
    });

    // The regression this function's construction exists to prevent: setMonth(-1)
    // on Jul 31 overflows via "Jun 31" to Jul 1, so the anchor never leaves July.
    it('does not overflow when today is the 31st', () => {
        at('2026-07-31T23:30:00', () => {
            expect(ymd(monthAnchorStart(-1))).toBe('2026-06-01');
        });
        at('2026-05-31T12:00:00', () => {
            expect(ymd(monthAnchorStart(-1))).toBe('2026-04-01');
            expect(ymd(monthAnchorStart(-3))).toBe('2026-02-01');
        });
    });

    it('anchors at local midnight', () => {
        at('2026-07-26T14:00:00', () => {
            const d = monthAnchorStart(0);
            expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0]);
        });
    });
});

describe('monthAnchorEnd', () => {
    it('stops at today for the current month rather than running to the 31st', () => {
        at('2026-07-26T14:00:00', () => {
            expect(ymd(monthAnchorEnd(0))).toBe('2026-07-26');
        });
    });

    it('is the final day for past months, whatever their length', () => {
        at('2026-07-26T14:00:00', () => {
            expect(ymd(monthAnchorEnd(-1))).toBe('2026-06-30'); // 30-day
            expect(ymd(monthAnchorEnd(-2))).toBe('2026-05-31'); // 31-day
            expect(ymd(monthAnchorEnd(-5))).toBe('2026-02-28'); // 28-day
        });
    });

    it('handles February in a leap year', () => {
        at('2024-04-15T08:00:00', () => {
            expect(ymd(monthAnchorEnd(-2))).toBe('2024-02-29');
        });
    });

    it('is the 1st when today is the 1st', () => {
        at('2026-07-01T00:05:00', () => {
            expect(ymd(monthAnchorStart(0))).toBe('2026-07-01');
            expect(ymd(monthAnchorEnd(0))).toBe('2026-07-01');
        });
    });

    it('never precedes its own start', () => {
        at('2026-07-26T14:00:00', () => {
            for (let o = 0; o >= -24; o--) {
                expect(monthAnchorEnd(o).getTime()).toBeGreaterThanOrEqual(monthAnchorStart(o).getTime());
            }
        });
    });

    // Consecutive windows must tile the calendar exactly: no day counted twice,
    // no gap. A trailing-30-day window could not satisfy this.
    it('tiles months without gaps or overlaps', () => {
        at('2026-07-26T14:00:00', () => {
            for (let o = -1; o >= -24; o--) {
                const dayAfterEnd = new Date(monthAnchorEnd(o));
                dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);
                expect(ymd(dayAfterEnd)).toBe(ymd(monthAnchorStart(o + 1)));
            }
        });
    });
});

// Both month fetchers derive their entry count as monthAnchorEnd(offset).getDate(),
// leaning on rangeStart always being the 1st. If that drifts, heatmaps silently
// lose or gain days — which is exactly what a setDate()-walked cursor did in
// zones where DST springs forward at midnight.
describe('entry-count contract used by the month fetchers', () => {
    it('yields the true month length for every past month across four years', () => {
        for (let y = 2023; y <= 2026; y++) {
            for (let m = 0; m < 12; m++) {
                at(`${y}-${String(m + 1).padStart(2, '0')}-15T12:00:00`, () => {
                    const start = monthAnchorStart(-1);
                    const dayCount = monthAnchorEnd(-1).getDate();
                    const trueLength = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
                    expect(dayCount).toBe(trueLength);
                    expect(start.getDate()).toBe(1);
                });
            }
        }
    });

    it('counts only elapsed days for the current month', () => {
        at('2026-07-26T14:00:00', () => {
            expect(monthAnchorEnd(0).getDate()).toBe(26);
        });
    });
});

// The Sleep tab gained a D/W/M stepper to match Workouts/Movement. Its day view
// resolves "the night belonging to day D" as [D-1 6pm, D 6pm) — the same 6pm
// evening-attribution rule the week and month views bucket by. These pin that
// window down, because an unbounded version showed last night's sleep on every
// past day.
describe('sleep day-detail window', () => {
    const sleepWindow = (offset: number) => {
        const day = dayAnchor(offset);
        const start = new Date(day);
        start.setDate(start.getDate() - 1);
        start.setHours(18, 0, 0, 0);
        const end = new Date(day);
        end.setHours(18, 0, 0, 0);
        return { start, end };
    };

    it('spans 6pm the previous evening to 6pm on the day itself', () => {
        at('2026-07-26T09:00:00', () => {
            const { start, end } = sleepWindow(0);
            expect(`${ymd(start)} ${start.getHours()}`).toBe('2026-07-25 18');
            expect(`${ymd(end)} ${end.getHours()}`).toBe('2026-07-26 18');
        });
    });

    it('is bounded, so a past day cannot resolve to last night', () => {
        at('2026-07-26T09:00:00', () => {
            const past = sleepWindow(-3);
            const today = sleepWindow(0);
            expect(ymd(past.end)).toBe('2026-07-23');
            expect(past.end.getTime()).toBeLessThan(today.start.getTime());
        });
    });

    it('tiles consecutive nights without gap or overlap', () => {
        at('2026-07-26T09:00:00', () => {
            for (let o = 0; o >= -60; o--) {
                expect(sleepWindow(o).start.getTime()).toBe(sleepWindow(o - 1).end.getTime());
            }
        });
    });
});

describe('monthLabel / rangeLabel', () => {
    it('names the month instead of a cross-month day range', () => {
        at('2026-07-26T14:00:00', () => {
            expect(monthLabel(0)).toBe('This Month');
            expect(monthLabel(-1)).toBe('June');
            expect(monthLabel(-6)).toBe('January');
        });
    });

    it('adds the year once it differs from the current one', () => {
        at('2026-02-10T09:00:00', () => {
            expect(monthLabel(-1)).toBe('January');
            expect(monthLabel(-2)).toBe('December 2025');
        });
    });

    it('is what the M stepper renders', () => {
        at('2026-07-26T14:00:00', () => {
            expect(rangeLabel('M', 0)).toBe('This Month');
            expect(rangeLabel('M', -1)).toBe('June');
        });
    });
});
