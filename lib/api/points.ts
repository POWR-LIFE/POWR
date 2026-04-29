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
    const { data, error } = await supabase
        .from('point_transactions')
        .select('amount');
    if (error) throw error;
    return (data ?? []).reduce((sum, t) => sum + t.amount, 0);
}

export async function fetchTotalEarned(): Promise<number> {
    const { data, error } = await supabase
        .from('point_transactions')
        .select('amount')
        .in('type', ['earn', 'adjustment']);
    if (error) throw error;
    return (data ?? []).reduce((sum, t) => sum + t.amount, 0);
}

export async function fetchTodayEarned(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
        .from('point_transactions')
        .select('amount')
        .in('type', ['earn', 'adjustment'])
        .gte('created_at', today.toISOString());
    if (error) throw error;
    return (data ?? []).reduce((sum, t) => sum + t.amount, 0);
}

export async function fetchWeeklyEarned(): Promise<number> {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
        .from('point_transactions')
        .select('amount')
        .in('type', ['earn', 'adjustment'])
        .gte('created_at', monday.toISOString());
    if (error) throw error;
    return (data ?? []).reduce((sum, t) => sum + t.amount, 0);
}

export async function fetchMonthlyEarned(): Promise<number> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
        .from('point_transactions')
        .select('amount')
        .in('type', ['earn', 'adjustment'])
        .gte('created_at', monthStart.toISOString());
    if (error) throw error;
    return (data ?? []).reduce((sum, t) => sum + t.amount, 0);
}

export interface PointTransaction {
    id: string;
    amount: number;
    type: 'earn' | 'redeem' | 'bonus' | 'streak' | 'penalty' | 'adjustment';
    description: string | null;
    created_at: string;
    session_id: string | null;
    activity_type: string | null;
}

export async function fetchTransactionHistory(): Promise<PointTransaction[]> {
    const { data, error } = await supabase
        .from('point_transactions')
        .select('id, amount, type, description, created_at, session_id, activity_sessions(type)')
        .order('created_at', { ascending: false })
        .limit(500);
    if (error) throw error;
    return ((data ?? []) as any[]).map((row) => ({
        ...row,
        activity_type: row.activity_sessions?.type ?? null,
        activity_sessions: undefined,
    }));
}
