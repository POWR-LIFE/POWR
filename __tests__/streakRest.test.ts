import { streakWithRest, weekOf } from '@/lib/streakRest';

// Sat 24 Oct 2026; its week runs Mon 19 – Sun 25.
const TODAY = '2026-10-24';
const range = (from: string, to: string) => {
    const out: string[] = [];
    for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += 86_400_000) {
        out.push(new Date(ms).toISOString().slice(0, 10));
    }
    return out;
};
const without = (days: string[], ...gone: string[]) => days.filter((d) => !gone.includes(d));

describe('streakWithRest', () => {
    it('weeks start on Monday', () => {
        expect(weekOf('2026-10-24')).toBe('2026-10-19');
        expect(weekOf('2026-10-19')).toBe('2026-10-19');
        expect(weekOf('2026-10-25')).toBe('2026-10-19');
        expect(weekOf('2026-10-26')).toBe('2026-10-26');
    });

    it('no days, no streak', () => {
        expect(streakWithRest([], TODAY)).toEqual({ current: 0, restDays: [], restFree: true, safeTonight: false });
    });

    it('every day moved: the plain streak, rest day still free', () => {
        const r = streakWithRest(range('2026-10-15', TODAY), TODAY);
        expect(r).toEqual({ current: 10, restDays: [], restFree: true, safeTonight: false });
    });

    it('not moved yet today: the streak stands and tonight is safe', () => {
        const r = streakWithRest(range('2026-10-19', '2026-10-23'), TODAY);
        expect(r.current).toBe(5);
        expect(r.safeTonight).toBe(true);
    });

    it('one day off this week holds the streak but does not add to it', () => {
        const r = streakWithRest(without(range('2026-10-12', TODAY), '2026-10-20'), TODAY);
        expect(r.current).toBe(12);
        expect(r.restDays).toEqual(['2026-10-20']);
        expect(r.restFree).toBe(false);
        expect(r.safeTonight).toBe(false);
    });

    it('rest used and not moved yet today: today has to count', () => {
        const r = streakWithRest(without(range('2026-10-12', '2026-10-23'), '2026-10-20'), TODAY);
        expect(r.current).toBe(11);
        expect(r.safeTonight).toBe(false);
    });

    it('a second day off in the same week breaks it', () => {
        const r = streakWithRest(without(range('2026-10-12', TODAY), '2026-10-20', '2026-10-21'), TODAY);
        expect(r.current).toBe(3); // Thu, Fri, Sat
    });

    it('one day off in each of two weeks: both held', () => {
        const r = streakWithRest(without(range('2026-10-05', TODAY), '2026-10-14', '2026-10-21'), TODAY);
        expect(r.current).toBe(18);
        expect(r.restDays).toEqual(['2026-10-21', '2026-10-14']);
    });

    it('lapsed for days: no streak', () => {
        expect(streakWithRest(range('2026-10-01', '2026-10-18'), TODAY).current).toBe(0);
    });
});
