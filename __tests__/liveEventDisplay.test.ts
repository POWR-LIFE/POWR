import { eventStatusChip, scoringLine } from '@/lib/liveEventDisplay';

// The FNL x POWR window: scoring opens a week before the night at the venue,
// which is exactly the gap that made a bare date on the home card read as the
// date of the event.
const WINDOW = {
    window_start_at: '2026-08-26T23:00:00+00:00',
    window_end_at: '2026-09-02T23:00:00+00:00',
};

describe('scoringLine', () => {
    it('names the date as the scoring start, never a bare date', () => {
        const line = scoringLine({ ...WINDOW, status: 'scheduled' });
        expect(line).toMatch(/^Scoring starts /);
        expect(line).toContain('27');
    });

    it('switches to the deadline once the window is open', () => {
        const line = scoringLine({ ...WINDOW, status: 'live' });
        expect(line).toMatch(/^Scoring ends /);
    });

    it('ends on the last day anyone can score, not the half-open boundary', () => {
        // The window closes at 00:00 on 3 Sep local — the last day that counts
        // is 2 Sep, and quoting the boundary would cost people a day.
        expect(scoringLine({ ...WINDOW, status: 'live' })).toContain('2');
        expect(scoringLine({ ...WINDOW, status: 'live' })).not.toContain('3 Sep');
    });
});

describe('eventStatusChip', () => {
    afterEach(() => { jest.useRealTimers(); });

    // The chip counts down to the scoring window, NOT to the night at the
    // venue — which for this event is a further week out. Every branch has to
    // say so, or the chip points at a date a week before the one people are
    // reading it as.
    const chipOn = (now: string) => {
        jest.useFakeTimers().setSystemTime(new Date(now));
        return eventStatusChip({ ...WINDOW, status: 'scheduled' });
    };

    it('names scoring in every countdown branch, never a bare "in N days"', () => {
        expect(chipOn('2026-08-21T09:00:00+01:00')).toBe('SCORING IN 6 DAYS');
        expect(chipOn('2026-08-26T09:00:00+01:00')).toBe('SCORING TOMORROW');
        expect(chipOn('2026-08-27T09:00:00+01:00')).toBe('SCORING TODAY');
    });

    it('never counts below zero once the window has opened', () => {
        expect(chipOn('2026-08-30T09:00:00+01:00')).toBe('SCORING TODAY');
    });

    it('drops the countdown entirely once live', () => {
        expect(eventStatusChip({ ...WINDOW, status: 'live' })).toBe('LIVE NOW');
    });
});
