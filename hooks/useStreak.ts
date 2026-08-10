import { useQuery } from '@tanstack/react-query';
import { getSessionUser, supabase } from '@/lib/supabase';

type StreakState = {
    currentStreak: number;
    longestStreak: number;
    multiplier: number;
    loading: boolean;
    refresh: () => void;
};

/** Mirrors the gym streak multiplier table from POWR_Points_Logic.md */
function streakMultiplier(streak: number): number {
    if (streak >= 10) return 3.0;
    if (streak >= 7)  return 2.0;
    if (streak >= 5)  return 1.5;
    if (streak >= 3)  return 1.2;
    return 1.0;
}

/**
 * Compute the current streak by counting consecutive distinct activity days
 * backward from today, using the activity_sessions table directly.
 * Also syncs the result back to user_streaks so the notification edge function
 * always has an accurate stored value to read.
 */
async function computeStreakFromSessions(): Promise<{ current: number; longest: number }> {
    const since = new Date();
    since.setDate(since.getDate() - 90);

    // Both reads below scope on user_id EXPLICITLY. RLS is the backstop, not
    // the filter: activity_sessions and streak_rescues each carry an "admins
    // can read all" policy, so without this an admin account computes its
    // streak from every user's sessions and shows a permanently maxed streak.
    const user = await getSessionUser();
    if (!user) return { current: 0, longest: 0 };

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at')
        .eq('user_id', user.id)
        .neq('verification', 'manual')
        .gte('started_at', since.toISOString())
        .order('started_at', { ascending: false });

    // Completed streak rescues bridge their missed day — the day counts as
    // active even though no session exists for it, restoring the full streak.
    //
    // Same bridge-day CONCEPT as the server's _shared/streak.ts, but NOT the
    // same day boundaries: this hook buckets sessions by device-local date,
    // the server by UTC date — a pre-existing divergence (rare ±1-day edge
    // near midnight for non-UTC users) deliberately left as-is here.
    // missed_day is stored as the user's local date at offer time, which
    // matches this hook's local bucketing.
    let bridgeDays: string[] = [];
    try {
        const { data: rescues } = await supabase
            .from('streak_rescues')
            .select('missed_day')
            .eq('user_id', user.id)
            .eq('status', 'completed')
            .gte('missed_day', since.toISOString().slice(0, 10));
        bridgeDays = (rescues ?? []).map(r => String(r.missed_day).slice(0, 10));
    } catch {
        // Table may predate this build — streak just computes without bridges.
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    let result: { current: number; longest: number };
    let lastActiveDate: string | null = null;

    const sessionDays = (error ? [] : (data ?? [])).map(s => {
        const d = new Date(s.started_at);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });

    if (!sessionDays.length) {
        result = { current: 0, longest: 0 };
    } else {
        // Unique date strings (YYYY-MM-DD, local time) + rescue bridge days.
        const uniqueDays = [...new Set([...sessionDays, ...bridgeDays])]
            .sort().reverse(); // most recent first

        lastActiveDate = uniqueDays[0] ?? null;

        if (uniqueDays[0] !== todayStr && uniqueDays[0] !== yesterdayStr) {
            result = { current: 0, longest: longestRun(uniqueDays) };
        } else {
            let streak = 1;
            for (let i = 1; i < uniqueDays.length; i++) {
                const prev = new Date(uniqueDays[i - 1] + 'T00:00:00');
                const curr = new Date(uniqueDays[i] + 'T00:00:00');
                if (prev.getTime() - curr.getTime() === 86400000) {
                    streak++;
                } else {
                    break;
                }
            }
            result = { current: streak, longest: Math.max(streak, longestRun(uniqueDays)) };
        }
    }

    // Sync computed streak back to user_streaks so notifications always read accurate data
    try {
        const { data: existing } = await supabase
            .from('user_streaks')
            .select('current_streak, longest_streak, last_activity_date')
            .eq('user_id', user.id)
            .maybeSingle();

        // ⚠ THIS WRITE MUST NEVER REGRESS THE STORED VALUE.
        //
        // Field 2026-08-10 12:53:56Z: the user opened the app after a completed
        // gym session and this sync overwrote a correct `4 / 2026-08-10` with
        // `3 / 2026-08-09` — the pre-session answer — while the +3 "4-day streak
        // bonus" stayed banked. The account was paid for a 4-day streak and then
        // told it was on 3. It self-corrected four minutes later on a complete
        // read, which is the tell: the recompute above degrades silently. Line
        // "(error ? [] : (data ?? []))" turns a failed read into an empty list,
        // and supabase-js does not throw on query errors, so a partial or failed
        // read is indistinguishable here from a genuine gap in activity.
        //
        // `longest_streak` was already guarded with Math.max for exactly this
        // reason. The other two fields were not, and they are the ones the user
        // sees. A client recompute is the LEAST reliable writer of a value the
        // server also derives (_shared/streak.ts calls user_streaks.current_streak
        // "a denormalised cache"), so it gets to raise this cache, never lower it.
        //
        // A genuine streak BREAK is not lost by this: it lands via the server's
        // own recompute, and locally the value simply stays until then rather
        // than flickering down and back up on every cold start.
        const storedCurrent = existing?.current_streak ?? 0;
        const storedLast = existing?.last_activity_date ?? null;
        const regresses = result.current < storedCurrent
            || (lastActiveDate != null && storedLast != null && lastActiveDate < storedLast)
            || (lastActiveDate == null && storedLast != null);

        if (!regresses) {
            await supabase.from('user_streaks').upsert({
                user_id: user.id,
                current_streak: result.current,
                longest_streak: Math.max(result.longest, existing?.longest_streak ?? 0),
                last_activity_date: lastActiveDate,
            }, { onConflict: 'user_id' });
        } else if (result.longest > (existing?.longest_streak ?? 0)) {
            // Still let a genuinely higher longest through — it is monotonic and
            // cannot be wrong in the direction that hurts.
            await supabase.from('user_streaks').update({
                longest_streak: result.longest,
            }).eq('user_id', user.id);
        }
    } catch {
        // Non-fatal — streak display is still correct even if sync fails
    }

    return result;
}

/** Find the longest consecutive-day run in a descending sorted array of date strings */
function longestRun(days: string[]): number {
    if (!days.length) return 0;
    let best = 1;
    let run = 1;
    for (let i = 1; i < days.length; i++) {
        const prev = new Date(days[i - 1] + 'T00:00:00');
        const curr = new Date(days[i] + 'T00:00:00');
        if (prev.getTime() - curr.getTime() === 86400000) {
            run++;
            if (run > best) best = run;
        } else {
            run = 1;
        }
    }
    return best;
}

export function useStreak(): StreakState {
    const { data, isPending, refetch } = useQuery({
        queryKey: ['streak'],
        queryFn: computeStreakFromSessions,
    });

    const currentStreak = data?.current ?? 0;
    return {
        currentStreak,
        longestStreak: data?.longest ?? 0,
        multiplier: streakMultiplier(currentStreak),
        loading: isPending,
        // Returns the refetch promise so pull-to-refresh can await completion.
        refresh: () => refetch(),
    };
}
