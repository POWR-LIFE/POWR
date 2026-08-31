import { supabase } from '@/lib/supabase';

export type LeaderboardEntry = {
    user_id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    level: number;
    is_pro: boolean;
    points: number;
    rank: number;
    /** Level basis (positive ledger + pending vault). null → no pill. */
    total_earned: number | null;
    /** Ledger points since UTC midnight. 0 → no chip. */
    today_points: number;
    /** Live-event boards only: places moved since the scoring day began.
     *  Absent/null/0 → no arrow. League views never carry it. */
    rank_delta?: number | null;
    /** Live-event boards only: this user's referral-gate progress (count is
     *  uncapped — 6/3 renders as 6/3). Either side absent → no chip. League
     *  views never carry them. */
    gate_count?: number | null;
    gate_required?: number | null;
};

export type LeaderboardMetric = 'weekly' | 'alltime';

export async function fetchLeaderboard(
    isPro: boolean,
    metric: LeaderboardMetric,
    limit = 50
): Promise<LeaderboardEntry[]> {
    const view = metric === 'weekly' ? 'leaderboard_weekly' : 'leaderboard_alltime';
    const pointsCol = metric === 'weekly' ? 'weekly_points' : 'total_points';

    const { data, error } = await supabase
        .from(view)
        .select('*')
        .eq('is_pro', isPro)
        .order(pointsCol, { ascending: false })
        .limit(limit);

    if (error || !data) return [];

    return data.map((row, i) => ({
        user_id: row.user_id,
        display_name: row.display_name,
        username: row.username,
        avatar_url: row.avatar_url,
        level: row.level,
        is_pro: row.is_pro,
        points: row[pointsCol] ?? 0,
        rank: i + 1,
        total_earned: row.total_earned ?? null,
        today_points: row.today_points ?? 0,
    }));
}
