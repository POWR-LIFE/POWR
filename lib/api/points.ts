import { supabase } from '@/lib/supabase';

export async function awardBonus(bonusType: string): Promise<{ earned: number }> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const { data, error } = await supabase.functions.invoke('award-bonus', {
        body: { bonus_type: bonusType },
        headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) throw error;
    return data;
}

export interface PointsSummary {
    balance: number;
    todayEarned: number;
    weeklyEarned: number;
    monthlyEarned: number;
    totalEarned: number;
}

const EMPTY_SUMMARY: PointsSummary = {
    balance: 0,
    todayEarned: 0,
    weeklyEarned: 0,
    monthlyEarned: 0,
    totalEarned: 0,
};

/**
 * All points aggregates in one round-trip, summed server-side.
 * Boundaries are computed here (local midnight, Monday-start week) so the
 * numbers match what the app has always shown regardless of the user's tz.
 */
export async function fetchPointsSummary(): Promise<PointsSummary> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return EMPTY_SUMMARY;

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);

    const { data, error } = await supabase.rpc('get_my_points_summary', {
        p_today_start: todayStart.toISOString(),
        p_week_start: weekStart.toISOString(),
        p_month_start: monthStart.toISOString(),
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return EMPTY_SUMMARY;
    return {
        balance: Number(row.balance ?? 0),
        todayEarned: Number(row.today_earned ?? 0),
        weeklyEarned: Number(row.weekly_earned ?? 0),
        monthlyEarned: Number(row.monthly_earned ?? 0),
        totalEarned: Number(row.total_earned ?? 0),
    };
}

export async function fetchBalance(): Promise<number> {
    return (await fetchPointsSummary()).balance;
}

export interface PointTransaction {
    id: string;
    amount: number;
    type: 'earn' | 'redeem' | 'bonus' | 'streak' | 'penalty' | 'adjustment';
    /** Origin of the row, e.g. 'shared_challenge' | 'shared_challenge_bonus' | 'weekly_challenge'. */
    source: string | null;
    description: string | null;
    created_at: string;
    session_id: string | null;
    activity_type: string | null;
    multiplier: number;
}

export async function fetchTransactionHistory(): Promise<PointTransaction[]> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];
    const { data, error } = await supabase
        .from('point_transactions')
        .select('id, amount, type, source, description, created_at, session_id, multiplier, activity_sessions(type)')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(500);
    if (error) throw error;
    return ((data ?? []) as any[]).map((row) => ({
        ...row,
        activity_type: row.activity_sessions?.type ?? null,
        multiplier: row.multiplier ?? 1,
        activity_sessions: undefined,
    }));
}
