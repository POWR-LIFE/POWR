/**
 * Day arithmetic for streaks. A streak is a run of consecutive LOCAL days,
 * handled as YYYY-MM-DD keys. The keys are parsed as UTC midnight so that the
 * step between two adjacent days is always exactly 24 h. Built from local
 * wall-clock time instead, the clocks-go-back day is 25 hours long and the
 * chain snaps there: on 2026-10-28 every UK streak read 3, the days since the
 * Monday after the 25 Oct change, because hooks/useStreak compared local
 * midnights. supabase/functions/_shared/streak.ts and lib/streakRest.ts
 * already step in UTC; this is the client's strict count doing the same.
 */
const DAY_MS = 86_400_000;
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);

/**
 * The run ending on the most recent day, which must be today or yesterday
 * (else the streak is over and this is 0). `uniqueDays`: distinct keys, most
 * recent first.
 */
export function currentRun(uniqueDays: readonly string[], today: string, yesterday: string): number {
    if (!uniqueDays.length) return 0;
    if (uniqueDays[0] !== today && uniqueDays[0] !== yesterday) return 0;
    let streak = 1;
    for (let i = 1; i < uniqueDays.length; i++) {
        if (ms(uniqueDays[i - 1]) - ms(uniqueDays[i]) === DAY_MS) streak++;
        else break;
    }
    return streak;
}

/** The longest run of consecutive days anywhere in the list (distinct keys, most recent first). */
export function longestRun(uniqueDays: readonly string[]): number {
    if (!uniqueDays.length) return 0;
    let best = 1;
    let run = 1;
    for (let i = 1; i < uniqueDays.length; i++) {
        if (ms(uniqueDays[i - 1]) - ms(uniqueDays[i]) === DAY_MS) {
            run++;
            if (run > best) best = run;
        } else {
            run = 1;
        }
    }
    return best;
}
