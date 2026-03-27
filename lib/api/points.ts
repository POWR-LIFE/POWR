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
        .eq('type', 'earn');
    if (error) throw error;
    return (data ?? []).reduce((sum, t) => sum + t.amount, 0);
}

export async function fetchTodayEarned(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
        .from('point_transactions')
        .select('amount')
        .eq('type', 'earn')
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
        .eq('type', 'earn')
        .gte('created_at', monday.toISOString());
    if (error) throw error;
    return (data ?? []).reduce((sum, t) => sum + t.amount, 0);
}
