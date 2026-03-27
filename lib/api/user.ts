import { supabase } from '@/lib/supabase';

export type Profile = {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    level: number;
};

export async function fetchProfile(): Promise<Profile | null> {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, level')
        .single();
    if (error) return null;
    return data as Profile;
}
