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

export async function fetchBalance(): Promise<number> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return 0;
    const { data, error } = await supabase
        .from('point_transactions')
        .select('amount')
        .eq('user_id', session.user.id);
    if (error) throw error;
    return (data ?? []).reduce((sum, t) => sum + t.amount, 0);
}

export async function fetchTotalEarned(): Promise<number> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return 0;
    const { data, error } = await supabase
        .from('point_transactions')
        .select('amount')
        .eq('user_id', session.user.id)
        .gt('amount', 0);
    if (error) throw error;
    return (data ?? []).reduce((sum, t) => sum + t.amount, 0);
}

export async function fetchTodayEarned(): Promise<number> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
        .from('point_transactions')
        .select('amount')
        .eq('user_id', session.user.id)
        .in('type', ['earn', 'adjustment'])
        .gte('created_at', today.toISOString());
    if (error) throw error;
    return (data ?? []).reduce((sum, t) => sum + t.amount, 0);
}

export async function fetchWeeklyEarned(): Promise<number> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return 0;
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
        .from('point_transactions')
        .select('amount')
        .eq('user_id', session.user.id)
        .in('type', ['earn', 'adjustment'])
        .gte('created_at', monday.toISOString());
    if (error) throw error;
    return (data ?? []).reduce((sum, t) => sum + t.amount, 0);
}

export async function fetchMonthlyEarned(): Promise<number> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return 0;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
        .from('point_transactions')
        .select('amount')
        .eq('user_id', session.user.id)
        .in('type', ['earn', 'adjustment'])
        .gte('created_at', monthStart.toISOString());
    if (error) throw error;
    return (data ?? []).reduce((sum, t) => sum + t.amount, 0);
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
