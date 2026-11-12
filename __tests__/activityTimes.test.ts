/**
 * The admin profile's "Activity times" card: which local hours a member
 * sleeps, walks and works out in. The figures an admin reads off it are only
 * as good as the hour bucketing, so the timezone cases are the point here.
 */
import {
    buildActivityTimes,
    clockLabel,
    durationLabel,
    hourLabel,
    hourRange,
    localClock,
    minutesByLocalHour,
    resolveTimezone,
    sessionTimes,
} from '../shared/activityTimes';

const LDN = 'Europe/London';
const ms = (iso: string) => Date.parse(iso);
const nonZero = (arr: number[]) =>
    Object.fromEntries(arr.map((v, h) => [h, Math.round(v)]).filter(([, v]) => v));

describe('minutesByLocalHour', () => {
    it('splits a winter evening session across its local hours (GMT = UTC)', () => {
        const out = minutesByLocalHour(ms('2026-01-14T17:30:00Z'), ms('2026-01-14T19:15:00Z'), localClock(LDN));
        expect(nonZero(out)).toEqual({ 17: 30, 18: 60, 19: 15 });
    });

    it('shifts a summer session by the BST hour', () => {
        // 16:30Z is 17:30 BST.
        const out = minutesByLocalHour(ms('2026-07-01T16:30:00Z'), ms('2026-07-01T17:30:00Z'), localClock(LDN));
        expect(nonZero(out)).toEqual({ 17: 30, 18: 30 });
    });

    it('handles a half-hour-offset zone', () => {
        // 00:00Z is 05:30 in India.
        const out = minutesByLocalHour(ms('2026-01-01T00:00:00Z'), ms('2026-01-01T01:00:00Z'), localClock('Asia/Kolkata'));
        expect(nonZero(out)).toEqual({ 5: 30, 6: 30 });
    });

    it('wraps a night across midnight into the right hours', () => {
        const out = minutesByLocalHour(ms('2026-01-14T23:00:00Z'), ms('2026-01-15T07:00:00Z'), localClock(LDN));
        expect(nonZero(out)).toEqual({ 23: 60, 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60 });
    });

    it('counts both 1am hours on the night the clocks go back', () => {
        // 25 Oct 2026: 01:00 BST happens, then 01:00 GMT again. 00:00Z–02:00Z is
        // local 01:00 BST → 01:00 GMT → 02:00 GMT: two hours, both in the 1am bucket.
        const out = minutesByLocalHour(ms('2026-10-25T00:00:00Z'), ms('2026-10-25T02:00:00Z'), localClock(LDN));
        expect(nonZero(out)).toEqual({ 1: 120 });
    });
});

describe('buildActivityTimes', () => {
    const night = (date: string, bed: string, wake: string) => ({
        type: 'sleep', started_at: `${date}T${bed}Z`, ended_at: wake,
    });

    it('gives sleep its median bedtime and wake time, across midnight', () => {
        const sessions = [
            night('2026-01-10', '23:00:00', '2026-01-11T07:00:00Z'),
            night('2026-01-11', '23:30:00', '2026-01-12T07:30:00Z'),
            { type: 'sleep', started_at: '2026-01-13T00:30:00Z', ended_at: '2026-01-13T06:30:00Z' },
        ];
        const [sleep] = buildActivityTimes({ sessions, stepHours: null, tz: LDN, sinceMs: null });
        expect(sleep.key).toBe('sleep');
        expect(sleep.total).toBe(3);
        expect(sleep.nights).toBe(3);
        expect(clockLabel(sleep.bedtime!)).toBe('11:30pm'); // 23:00, 23:30, 00:30 → 23:30, not noon
        expect(clockLabel(sleep.wake!)).toBe('7:00am');
        expect(sleep.counts[3]).toBe(3);
    });

    it('lets a nap shade the hours without moving bedtime', () => {
        const sessions = [
            night('2026-01-10', '23:00:00', '2026-01-11T07:00:00Z'),
            { type: 'sleep', started_at: '2026-01-11T14:00:00Z', ended_at: '2026-01-11T14:40:00Z' },
        ];
        const [sleep] = buildActivityTimes({ sessions, stepHours: null, tz: LDN, sinceMs: null });
        expect(sleep.total).toBe(2);
        expect(sleep.nights).toBe(1);
        expect(clockLabel(sleep.bedtime!)).toBe('11:00pm');
        expect(Math.round(sleep.values[14])).toBe(40);
    });

    it('leaves out whole-day walking totals but keeps tracked walks', () => {
        const sessions = [
            { type: 'walking', started_at: '2026-01-10T00:00:00Z', ended_at: '2026-01-11T00:00:00Z' },
            // Today's running total: midnight → last sync, short but still not a walk.
            { type: 'walking', started_at: '2026-01-12T00:00:00Z', ended_at: '2026-01-12T02:30:00Z' },
            // A day total from a UTC+5:30 phone: local midnight is 18:30Z.
            { type: 'walking', started_at: '2026-01-12T18:30:00Z', ended_at: '2026-01-12T21:00:00Z' },
            { type: 'walking', started_at: '2026-01-10T12:10:07Z', ended_at: '2026-01-10T12:50:07Z' },
        ];
        const rows = buildActivityTimes({ sessions, stepHours: null, tz: LDN, sinceMs: null });
        expect(rows.map(r => r.key)).toEqual(['walking']);
        expect(rows[0].total).toBe(1);
        expect(nonZero(rows[0].values)).toEqual({ 12: 40 });
    });

    it('finds the two-hour window most workouts start in', () => {
        const at = (iso: string) => ({ type: 'gym', started_at: iso, ended_at: new Date(ms(iso) + 3_600_000).toISOString() });
        const sessions = [
            at('2026-01-05T17:10:00Z'), at('2026-01-06T18:20:00Z'), at('2026-01-07T17:45:00Z'),
            at('2026-01-08T07:00:00Z'),
        ];
        const [gym] = buildActivityTimes({ sessions, stepHours: null, tz: LDN, sinceMs: null });
        expect(gym.total).toBe(4);
        expect(gym.peak).toEqual({ from: 17, to: 19 });
        expect(gym.peakCount).toBe(3);
        expect(hourRange(gym.peak!.from, gym.peak!.to)).toBe('5–7pm');
    });

    it('opens a lone session’s window on its own start hour', () => {
        const [gym] = buildActivityTimes({
            sessions: [{ type: 'gym', started_at: '2026-01-05T18:15:00Z', ended_at: '2026-01-05T19:15:00Z' }],
            stepHours: null, tz: LDN, sinceMs: null,
        });
        expect(gym.peak!.from).toBe(18);
    });

    it('averages steps per hour over the days that have them', () => {
        const day = (date: string, hour: number, n: number) => {
            const steps = new Array(24).fill(0);
            steps[hour] = n;
            return { date, steps };
        };
        const rows = buildActivityTimes({
            sessions: [],
            stepHours: [day('2026-01-10', 8, 3000), day('2026-01-11', 8, 1000), day('2026-01-12', 18, 2000)],
            tz: LDN,
            sinceMs: null,
        });
        const [steps] = rows;
        expect(steps.key).toBe('steps');
        expect(steps.total).toBe(3);
        expect(Math.round(steps.values[8])).toBe(1333);
        expect(steps.counts[8]).toBe(2);
        expect(steps.peak).toEqual({ from: 8, to: 9 });
    });

    it('applies the range to sessions and step days alike', () => {
        const steps = new Array(24).fill(0);
        steps[9] = 500;
        const rows = buildActivityTimes({
            sessions: [
                { type: 'running', started_at: '2026-01-01T08:00:00Z', ended_at: '2026-01-01T08:30:00Z' },
                { type: 'running', started_at: '2026-01-20T08:00:00Z', ended_at: '2026-01-20T08:30:00Z' },
            ],
            stepHours: [{ date: '2026-01-01', steps }, { date: '2026-01-20', steps }],
            tz: LDN,
            sinceMs: ms('2026-01-15T00:00:00Z'),
        });
        expect(rows.find(r => r.key === 'running')!.total).toBe(1);
        expect(rows.find(r => r.key === 'steps')!.total).toBe(1);
    });

    it('drops rows with nothing in them and orders the rest the same for everyone', () => {
        const s = (type: string) => ({ type, started_at: '2026-01-10T10:00:00Z', ended_at: '2026-01-10T11:00:00Z' });
        const rows = buildActivityTimes({
            sessions: [s('yoga'), s('gym'), s('sleep'), s('running')],
            stepHours: [],
            tz: LDN,
            sinceMs: null,
        });
        expect(rows.map(r => r.key)).toEqual(['sleep', 'gym', 'running', 'yoga']);
    });

    it('ignores rows with no end, a backwards span or an impossible length', () => {
        const rows = buildActivityTimes({
            sessions: [
                { type: 'gym', started_at: '2026-01-10T10:00:00Z', ended_at: null },
                { type: 'gym', started_at: '2026-01-10T10:00:00Z', ended_at: '2026-01-10T09:00:00Z' },
                { type: 'gym', started_at: '2026-01-10T00:00:00Z', ended_at: '2026-01-11T12:00:00Z' },
            ],
            stepHours: null,
            tz: LDN,
            sinceMs: null,
        });
        expect(rows).toEqual([]);
    });
});

describe('labels and timezone', () => {
    it('labels hours and spans the way the portal reads them', () => {
        expect(hourLabel(0)).toBe('12am');
        expect(hourLabel(12)).toBe('12pm');
        expect(hourLabel(23)).toBe('11pm');
        expect(hourRange(11, 13)).toBe('11am–1pm');
        expect(hourRange(23, 1)).toBe('11pm–1am');
        expect(hourRange(8, 9)).toBe('8–9am');
        expect(clockLabel(0)).toBe('12:00am');
        expect(clockLabel(23 * 60 + 5)).toBe('11:05pm');
        expect(durationLabel(45)).toBe('45m');
        expect(durationLabel(260)).toBe('4h 20m');
        expect(durationLabel(120)).toBe('2h');
    });

    it('falls back to UK time when the member has no usable timezone', () => {
        expect(resolveTimezone('America/New_York')).toEqual({ tz: 'America/New_York', reported: true });
        expect(resolveTimezone(null)).toEqual({ tz: 'Europe/London', reported: false });
        expect(resolveTimezone('Not/AZone')).toEqual({ tz: 'Europe/London', reported: false });
    });
});

describe('sessionTimes (Activity Logs rows)', () => {
    const NOW = ms('2026-11-12T12:00:00Z');

    it('gives a workout its day and a compact start–end time in local time', () => {
        // 18:05Z in November is 18:05 GMT.
        const t = sessionTimes({ type: 'gym', started_at: '2026-11-08T18:05:00Z', ended_at: '2026-11-08T18:50:00Z' }, LDN, null, NOW);
        expect(t).toEqual({ day: 'Sun 8 Nov', time: '6:05–6:50pm', busiestHour: null });
    });

    it('shows a night across midnight in full', () => {
        const t = sessionTimes({ type: 'sleep', started_at: '2026-11-08T22:06:00Z', ended_at: '2026-11-09T07:07:00Z' }, LDN, null, NOW);
        expect(t!.time).toBe('10:06pm – 7:07am');
        expect(t!.day).toBe('Sun 8 Nov');
    });

    it('converts to the member’s zone, not the viewer’s', () => {
        const t = sessionTimes({ type: 'running', started_at: '2026-07-01T12:00:00Z', ended_at: '2026-07-01T12:45:00Z' }, 'America/New_York', null, NOW);
        expect(t!.time).toBe('8:00–8:45am');
    });

    it('falls back to duration_sec when a row has no end', () => {
        const t = sessionTimes({ type: 'gym', started_at: '2026-11-08T07:00:00Z', ended_at: null, duration_sec: 3600 }, LDN, null, NOW);
        expect(t!.time).toBe('7:00–8:00am');
    });

    it('calls a daily step total "Whole day", with the busiest hour once step hours exist', () => {
        const total = { type: 'walking', started_at: '2026-11-08T00:00:00Z', ended_at: '2026-11-09T00:00:00Z' };
        expect(sessionTimes(total, LDN, null, NOW)).toEqual({ day: 'Sun 8 Nov', time: 'Whole day', busiestHour: null });
        const steps = new Array(24).fill(50);
        steps[8] = 2400;
        const withHours = sessionTimes(total, LDN, new Map([['2026-11-08', steps]]), NOW);
        expect(withHours!.busiestHour).toBe('8–9am');
    });

    it('says "Day so far" on today’s still-counting step total', () => {
        const today = { type: 'walking', started_at: '2026-11-12T00:00:00Z', ended_at: '2026-11-12T11:40:00Z' };
        expect(sessionTimes(today, LDN, null, NOW)!.time).toBe('Day so far');
    });

    it('adds the year to an older session', () => {
        const t = sessionTimes({ type: 'gym', started_at: '2025-12-30T10:00:00Z', ended_at: '2025-12-30T11:00:00Z' }, LDN, null, NOW);
        expect(t!.day).toBe('Tue 30 Dec 2025');
    });
});
