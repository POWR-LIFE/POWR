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

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at')
        .neq('verification', 'manual')
        .gte('started_at', since.toISOString())
        .order('started_at', { ascending: false });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    let result: { current: number; longest: number };
    let lastActiveDate: string | null = null;

    if (error || !data?.length) {
        result = { current: 0, longest: 0 };
    } else {
        // Build a sorted set of unique date strings (YYYY-MM-DD, local time)
        const uniqueDays = [...new Set(
            data.map(s => {
                const d = new Date(s.started_at);
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            })
        )].sort().reverse(); // most recent first

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
        const userId = (await getSessionUser())?.id;
        if (userId) {
            const { data: existing } = await supabase
                .from('user_streaks')
                .select('longest_streak')
                .eq('user_id', userId)
                .maybeSingle();
            await supabase.from('user_streaks').upsert({
                user_id: userId,
                current_streak: result.current,
                longest_streak: Math.max(result.longest, existing?.longest_streak ?? 0),
                last_activity_date: lastActiveDate,
            }, { onConflict: 'user_id' });
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
