import { supabase } from '@/lib/supabase';

export type ActivityCount = { type: string; count: number };

export type ProfileStats = {
    totalPoints: number;
    /** Canonical lifetime-earned (positive ledger all types + pending vault) —
     *  the basis the rest of the app derives level/tier from. Use this, not
     *  totalPoints, for any level/tier computation. */
    totalEarned: number;
    currentStreak: number;
    longestStreak: number;
    dailyPoints: number[]; // last 7 days, oldest → newest
    activityBreakdown: ActivityCount[]; // last 30 days, sorted desc
    sessionCount30d: number;
};

const EMPTY_STATS: ProfileStats = {
    totalPoints: 0,
    totalEarned: 0,
    currentStreak: 0,
    longestStreak: 0,
    dailyPoints: [0, 0, 0, 0, 0, 0, 0],
    activityBreakdown: [],
    sessionCount30d: 0,
};

/**
 * Public stats for a profile card: total points, streak, 7-day sparkline, and
 * activity-type breakdown. Served by the get_profile_stats SECURITY DEFINER RPC
 * — activity_sessions / point_transactions / user_streaks are RLS-locked to the
 * owner, so a direct client read returns zeros for anyone but yourself. Degrades
 * to zeros on error so it can never break the sheet.
 */
export async function fetchProfileStats(userId: string): Promise<ProfileStats> {
    const { data, error } = await supabase.rpc('get_profile_stats', { p_user_id: userId });
    if (error) {
        console.warn('[fetchProfileStats]', error.message);
        return EMPTY_STATS;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return EMPTY_STATS;
    return {
        totalPoints: row.total_points ?? 0,
        totalEarned: Number(row.total_earned ?? row.total_points ?? 0),
        currentStreak: row.current_streak ?? 0,
        longestStreak: row.longest_streak ?? 0,
        dailyPoints: (row.daily_points ?? EMPTY_STATS.dailyPoints).map((n: any) => Number(n) || 0),
        activityBreakdown: ((row.activity_breakdown ?? []) as ActivityCount[]).map(b => ({
            type: b.type,
            count: Number(b.count) || 0,
        })),
        sessionCount30d: row.session_count_30d ?? 0,
    };
}
