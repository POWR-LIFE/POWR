import { eventNightLine, eventStatusChip, gateProgress, inviteRewardLine, rankMove, scoringLine } from '@/lib/liveEventDisplay';

const realToLocaleDateString = Date.prototype.toLocaleDateString;
const realToLocaleTimeString = Date.prototype.toLocaleTimeString;

// Both formatters are pinned, not just the date one: eventNightLine renders a
// TIME, so on a UTC runner "7pm BST" comes out as 6pm and the assertions fail
// for reasons that have nothing to do with the code.
//
// `this: Date` is load-bearing — without it tsc fails TS2683 under
// noImplicitThis, and jest would never catch it because babel doesn't
// typecheck.
beforeAll(() => {
    jest.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
        this: Date,
        locales?: Intl.LocalesArgument,
        options?: Intl.DateTimeFormatOptions,
    ): string {
        return realToLocaleDateString.call(this, locales ?? 'en-GB', { ...options, timeZone: 'Europe/London' });
    });
    jest.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(function (
        this: Date,
        locales?: Intl.LocalesArgument,
        options?: Intl.DateTimeFormatOptions,
    ): string {
        return realToLocaleTimeString.call(this, locales ?? 'en-GB', { ...options, timeZone: 'Europe/London' });
    });
});

afterAll(() => {
    jest.restoreAllMocks();
});

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
        expect(scoringLine({ ...WINDOW, status: 'live' })).toContain('2 Sep');
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

describe('eventNightLine', () => {
    const on4th = (from: string | null, to?: string | null) =>
        eventNightLine({ doors_open_at: from, doors_close_at: to ?? null });

    it('renders the night as a flyer writes it, sharing one meridiem', () => {
        expect(on4th('2026-09-04T18:00:00+01:00', '2026-09-04T19:00:00+01:00')).toBe('Fri 4 Sept, 6\u20137pm');
    });

    it('keeps both meridiems when the range crosses noon', () => {
        expect(on4th('2026-09-04T11:00:00+01:00', '2026-09-04T13:00:00+01:00')).toBe('Fri 4 Sept, 11am\u20131pm');
    });

    it('keeps minutes when there are any', () => {
        expect(on4th('2026-09-04T18:30:00+01:00', '2026-09-04T19:30:00+01:00')).toBe('Fri 4 Sept, 6:30\u20137:30pm');
    });

    it('falls back to the start alone when there is no close time', () => {
        expect(on4th('2026-09-04T18:00:00+01:00')).toBe('Fri 4 Sept, 6pm');
    });

    // "Doors close 00:00 on the 5th" is a counting boundary meaning "the end of
    // the 4th" — pairing it with the start would render "Fri 4 Sept, 12–12am".
    it('ignores a close time that lands on a later day', () => {
        expect(on4th('2026-09-04T09:00:00+01:00', '2026-09-05T00:00:00+01:00')).toBe('Fri 4 Sept, 9am');
    });

    it('never renders a 24-hour clock, which no flyer uses', () => {
        const line = on4th('2026-09-04T19:00:00+01:00')!;
        expect(line).not.toContain('19');
        expect(line).toMatch(/(am|pm)$/);
    });

    // The datetime input defaults to 00:00, so "date only" is the shape an
    // admin produces by picking a day and not touching the time.
    it('shows the date alone when the start is midnight, never "12am"', () => {
        expect(on4th('2026-09-04T00:00:00+01:00')).toBe('Fri 4 Sept');
        expect(on4th('2026-09-04T00:00:00+01:00', '2026-09-05T00:00:00+01:00')).toBe('Fri 4 Sept');
    });

    // Guessing a date from the scoring window is exactly the wrong-day bug
    // scoringLine() exists to prevent, so an unset door time must stay unset.
    it('returns null when doors are not set, so callers hide the pill', () => {
        expect(on4th(null)).toBeNull();
        expect(eventNightLine({})).toBeNull();
    });
});

describe('rankMove', () => {
    it('climbs are positive deltas, drops negative', () => {
        expect(rankMove(2)).toEqual({ dir: 'up', places: 2 });
        expect(rankMove(-3)).toEqual({ dir: 'down', places: 3 });
    });

    it('draws nothing for holds, missing references, or junk', () => {
        expect(rankMove(0)).toBeNull();
        expect(rankMove(null)).toBeNull();
        expect(rankMove(undefined)).toBeNull();
        expect(rankMove(NaN)).toBeNull();
    });
});

describe('gateProgress', () => {
    it('reads count/required, met at the line and beyond it', () => {
        expect(gateProgress(0, 3)).toEqual({ label: '0/3', met: false });
        expect(gateProgress(2, 3)).toEqual({ label: '2/3', met: false });
        expect(gateProgress(3, 3)).toEqual({ label: '3/3', met: true });
    });

    it('never caps the count — over-completion shows as 6/3', () => {
        expect(gateProgress(6, 3)).toEqual({ label: '6/3', met: true });
    });

    it('draws nothing without both sides of the fraction, or without a gate', () => {
        expect(gateProgress(null, 3)).toBeNull();
        expect(gateProgress(undefined, 3)).toBeNull();
        expect(gateProgress(2, null)).toBeNull();
        expect(gateProgress(2, undefined)).toBeNull();
        expect(gateProgress(2, 0)).toBeNull();
        expect(gateProgress(NaN, 3)).toBeNull();
    });

    it('clamps a negative count to 0 rather than rendering -1/3', () => {
        expect(gateProgress(-1, 3)).toEqual({ label: '0/3', met: false });
    });
});

describe('inviteRewardLine', () => {
    it('splits the timing when the inviter is paid at signup', () => {
        const line = inviteRewardLine({ invite_bonus_points: 20, reward_referrals_on_signup: true });
        expect(line).toBe(
            'You get +20 POWR the moment a friend joins with your code. '
            + 'They earn their +20 on their first verified workout.',
        );
    });

    it('keeps the both-on-conversion promise when the switch is off', () => {
        expect(inviteRewardLine({ invite_bonus_points: 20, reward_referrals_on_signup: false })).toBe(
            'You each get +20 POWR when a friend joins with your code and logs their first verified workout.',
        );
    });

    // A payload written before 2026-09-03 has no such key, and reading `undefined`
    // as "paid at signup" would promise money the server does not pay.
    it('treats a missing flag as pay-on-conversion', () => {
        expect(inviteRewardLine({ invite_bonus_points: 20 })).toContain('logs their first verified workout');
    });

    it('carries the event\'s own bonus figure, never a hardcoded 20', () => {
        expect(inviteRewardLine({ invite_bonus_points: 50, reward_referrals_on_signup: true }))
            .toContain('+50 POWR the moment');
    });
});
