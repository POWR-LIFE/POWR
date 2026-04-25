import { supabase } from '@/lib/supabase';

export type ActivityCount = { type: string; count: number };

export type ProfileStats = {
    totalPoints: number;
    currentStreak: number;
    longestStreak: number;
    dailyPoints: number[]; // last 7 days, oldest → newest
    activityBreakdown: ActivityCount[]; // last 30 days, sorted desc
    sessionCount30d: number;
};

/**
 * Fetches public stats for a profile card: total points, streak, 7-day
 * sparkline data, activity-type breakdown. All queries run in parallel
 * and missing data degrades gracefully to zeros.
 */
export async function fetchProfileStats(userId: string): Promise<ProfileStats> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalRes, streakRes, dailyRes, sessionsRes] = await Promise.all([
        supabase
            .from('point_transactions')
            .select('amount')
            .eq('user_id', userId)
            .in('type', ['earn', 'adjustment']),
        supabase
            .from('user_streaks')
            .select('current_streak, longest_streak')
            .eq('user_id', userId)
            .maybeSingle(),
        supabase
            .from('point_transactions')
            .select('amount, created_at')
            .eq('user_id', userId)
            .in('type', ['earn', 'adjustment'])
            .gte('created_at', sevenDaysAgo.toISOString()),
        supabase
            .from('activity_sessions')
            .select('type')
            .eq('user_id', userId)
            .gte('started_at', thirtyDaysAgo.toISOString()),
    ]);

    // Total points
    const totalPoints = (totalRes.data ?? []).reduce((s, r: any) => s + (r.amount ?? 0), 0);

    // Streak
    const currentStreak = streakRes.data?.current_streak ?? 0;
    const longestStreak = streakRes.data?.longest_streak ?? 0;

    // Daily points, bucketed into 7 days
    const dailyPoints = bucketByDay(dailyRes.data ?? [], 7);

    // Activity breakdown
    const counts = new Map<string, number>();
    for (const row of (sessionsRes.data ?? []) as { type: string }[]) {
        counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
    }
    const activityBreakdown: ActivityCount[] = Array.from(counts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);

    return {
        totalPoints,
        currentStreak,
        longestStreak,
        dailyPoints,
        activityBreakdown,
        sessionCount30d: sessionsRes.data?.length ?? 0,
    };
}

function bucketByDay(
    rows: { amount: number; created_at: string }[],
    days: number,
): number[] {
    const buckets = new Array(days).fill(0);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayMs = 24 * 60 * 60 * 1000;

    for (const row of rows) {
        const t = new Date(row.created_at).getTime();
        const daysAgo = Math.floor((todayStart - t) / dayMs);
        if (daysAgo < 0) {
            buckets[days - 1] += row.amount;
        } else if (daysAgo < days) {
            buckets[days - 1 - daysAgo] += row.amount;
        }
    }
    return buckets;
}
