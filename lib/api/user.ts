import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/lib/supabase';

export type Profile = {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    cover_url: string | null;
    bio: string | null;
    level: number;
    is_pro: boolean;
    show_on_leaderboard: boolean;
    activity_preferences: string[];
    referral_code: string | null;
    preferred_gym_id: string | null;
};

export type PublicProfile = Pick<Profile,
    'id' | 'username' | 'display_name' | 'avatar_url' | 'cover_url' | 'bio' | 'level' | 'is_pro'
>;

export async function fetchProfile(): Promise<Profile | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, cover_url, bio, level, is_pro, show_on_leaderboard, activity_preferences, referral_code, preferred_gym_id')
        .eq('id', user.id)
        .single();
    if (error) return null;
    return data as Profile;
}

export async function fetchPublicProfile(userId: string): Promise<PublicProfile | null> {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, cover_url, bio, level, is_pro')
        .eq('id', userId)
        .single();
    if (error) return null;
    return data as PublicProfile;
}

export async function updateProfile(
    fields: Partial<Pick<Profile, 'display_name' | 'username' | 'avatar_url'>>
): Promise<{ error: string | null }> {
    const { error } = await supabase
        .from('profiles')
        .update(fields)
        .eq('id', (await supabase.auth.getUser()).data.user?.id ?? '');
    return { error: error?.message ?? null };
}

export async function updateProProfile(
    fields: Partial<Pick<Profile, 'bio' | 'cover_url'>>
): Promise<{ error: string | null }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Not authenticated' };
    const { error } = await supabase.from('profiles').update(fields).eq('id', user.id);
    return { error: error?.message ?? null };
}

export async function setPreferredGym(gymId: string | null): Promise<{ error: string | null }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Not authenticated' };
    const { error } = await supabase
        .from('profiles')
        .update({ preferred_gym_id: gymId })
        .eq('id', user.id);
    return { error: error?.message ?? null };
}

export async function updateLeaderboardVisibility(show: boolean): Promise<{ error: string | null }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Not authenticated' };
    const { error } = await supabase
        .from('profiles')
        .update({ show_on_leaderboard: show })
        .eq('id', user.id);
    return { error: error?.message ?? null };
}

export async function uploadCover(localUri: string): Promise<{ url: string | null; error: string | null }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { url: null, error: 'Not authenticated' };

    const ext = localUri.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `${user.id}/${Date.now()}.${ext}`;
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';

    const base64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
    });
    const binary = atob(base64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        buffer[i] = binary.charCodeAt(i);
    }

    const { error: uploadError } = await supabase.storage
        .from('covers')
        .upload(path, buffer, { contentType, upsert: true });

    if (uploadError) return { url: null, error: uploadError.message };

    const { data } = supabase.storage.from('covers').getPublicUrl(path);
    return { url: data.publicUrl, error: null };
}

/** Persists activity preferences to both the profiles table and auth user_metadata. */
export async function updateActivityPreferences(
    preferences: string[]
): Promise<{ error: string | null }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Not authenticated' };

    // Write to profiles table (source of truth)
    const { error: dbError } = await supabase
        .from('profiles')
        .update({ activity_preferences: preferences })
        .eq('id', user.id);
    if (dbError) return { error: dbError.message };

    // Mirror to auth metadata so it's available on the client session immediately
    const { error: authError } = await supabase.auth.updateUser({
        data: { activity_preferences: preferences },
    });
    if (authError) return { error: authError.message };

    return { error: null };
}

/**
 * Uploads a local file URI to Supabase Storage under avatars/<userId>/<timestamp>.jpg
 * and returns the public URL, or an error string.
 *
 * Uses expo-file-system to read the file as base64, then converts to an ArrayBuffer
 * for upload. This is the most reliable approach in Expo for all URI schemes
 * (file://, ph://, content://) without needing any special permissions.
 */
export async function uploadAvatar(localUri: string): Promise<{ url: string | null; error: string | null }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { url: null, error: 'Not authenticated' };

    const ext = localUri.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `${user.id}/${Date.now()}.${ext}`;
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';

    // Read file as base64 via the legacy FileSystem API, then decode to raw bytes
    const base64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
    });
    const binary = atob(base64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        buffer[i] = binary.charCodeAt(i);
    }

    const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, buffer, { contentType, upsert: true });

    if (uploadError) return { url: null, error: uploadError.message };

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    return { url: data.publicUrl, error: null };
}
