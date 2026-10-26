/**
 * One rest day a week. The first day in a Mon–Sun week (local) that you don't
 * move doesn't break your streak. It doesn't add to it either: a rest day
 * holds the chain, it isn't a day of it. A second missed day in the same week
 * breaks it as before. Recovery is part of training, and a chain that snaps
 * on the first day off is the moment people stop.
 *
 * Display only while STREAK_REST_DAYS is a dev flag: the streak bonus
 * (claim-points via supabase/functions/_shared/streak.ts), the rescue sweep
 * and the streak-at-risk push still count the strict streak. Going live means
 * mirroring this there, so the card, the bonus and the pushes agree.
 */
export const STREAK_REST_DAYS = __DEV__;

export type RestStreak = {
    current: number;
    /** Days (YYYY-MM-DD) a rest day held the streak over, most recent first. */
    restDays: string[];
    /** This week's rest day hasn't been used. */
    restFree: boolean;
    /** You haven't moved today, and the streak still stands tomorrow if you don't. */
    safeTonight: boolean;
};

const DAY_MS = 86_400_000;
// Date-only strings parse as UTC midnight, so stepping by a day is exact (DST included).
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** The Monday of a day's week. */
export function weekOf(day: string): string {
    const ms = toMs(day);
    const dow = (new Date(ms).getUTCDay() + 6) % 7; // Mon = 0
    return toDay(ms - dow * DAY_MS);
}

/** `days`: the local days you moved (YYYY-MM-DD). `today`: today's local day. */
export function streakWithRest(days: Iterable<string>, today: string): RestStreak {
    const set = new Set(days);
    if (set.size === 0) return { current: 0, restDays: [], restFree: true, safeTonight: false };
    const earliest = [...set].sort()[0];
    const used = new Map<string, string>();
    const todayActive = set.has(today);
    let current = todayActive ? 1 : 0;
    for (let ms = toMs(today) - DAY_MS; ms >= toMs(earliest); ms -= DAY_MS) {
        const d = toDay(ms);
        if (set.has(d)) { current += 1; continue; }
        const wk = weekOf(d);
        if (used.has(wk)) break;
        used.set(wk, d);
    }
    if (current === 0) return { current: 0, restDays: [], restFree: true, safeTonight: false };
    const restDays = [...used.values()];
    const restFree = !used.has(weekOf(today));
    return { current, restDays, restFree, safeTonight: !todayActive && restFree };
}
