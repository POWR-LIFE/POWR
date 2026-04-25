import { supabase } from '@/lib/supabase';

export const MAX_ACHIEVEMENTS = 4;

export type Achievement = {
    id: string;
    user_id: string;
    title: string;
    value: string;
    context: string | null;
    display_order: number;
    created_at: string;
};

export type AchievementInput = {
    title: string;
    value: string;
    context?: string | null;
};

export async function fetchAchievements(userId: string): Promise<Achievement[]> {
    const { data, error } = await supabase
        .from('pro_achievements')
        .select('*')
        .eq('user_id', userId)
        .order('display_order', { ascending: true });
    if (error) return [];
    return data as Achievement[];
}

export async function createAchievement(
    input: AchievementInput,
): Promise<{ achievement: Achievement | null; error: string | null }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { achievement: null, error: 'Not authenticated' };

    const { data: existing } = await supabase
        .from('pro_achievements')
        .select('display_order')
        .eq('user_id', user.id)
        .order('display_order', { ascending: false })
        .limit(1);
    const nextOrder = (existing?.[0]?.display_order ?? -1) + 1;

    const { data, error } = await supabase
        .from('pro_achievements')
        .insert({
            user_id: user.id,
            title: input.title.trim(),
            value: input.value.trim(),
            context: input.context?.trim() || null,
            display_order: nextOrder,
        })
        .select()
        .single();

    if (error) return { achievement: null, error: error.message };
    return { achievement: data as Achievement, error: null };
}

export async function updateAchievement(
    id: string,
    input: AchievementInput,
): Promise<{ error: string | null }> {
    const { error } = await supabase
        .from('pro_achievements')
        .update({
            title: input.title.trim(),
            value: input.value.trim(),
            context: input.context?.trim() || null,
        })
        .eq('id', id);
    return { error: error?.message ?? null };
}

export async function deleteAchievement(id: string): Promise<{ error: string | null }> {
    const { error } = await supabase.from('pro_achievements').delete().eq('id', id);
    return { error: error?.message ?? null };
}
