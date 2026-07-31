import * as FileSystem from 'expo-file-system/legacy';

import { getSessionUser, supabase } from '@/lib/supabase';
import { isHandleFree } from '@/lib/onboarding/username';

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
    created_at: string | null;
};

export type PublicProfile = Pick<Profile,
    'id' | 'username' | 'display_name' | 'avatar_url' | 'cover_url' | 'bio' | 'level' | 'is_pro'
    | 'preferred_gym_id' | 'activity_preferences' | 'created_at'
>;

/** Where the caller stands with another user — mirrors the QR flow's relationship. */
export type FriendRelationship =
    | 'self'
    | 'none'
    | 'pending_outgoing'
    | 'pending_incoming'
    | 'accepted'
    | 'blocked';

export async function fetchProfile(): Promise<Profile | null> {
    const user = await getSessionUser();
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
        .select('id, username, display_name, avatar_url, cover_url, bio, level, is_pro, preferred_gym_id, activity_preferences, created_at')
        .eq('id', userId)
        .single();
    if (error) return null;
    return data as PublicProfile;
}

/** Display name + locality for a user's home gym (profiles.preferred_gym_id). */
export async function fetchGymName(
    gymId: string,
): Promise<{ name: string; address: string | null } | null> {
    const { data, error } = await supabase
        .from('partners')
        .select('name, address')
        .eq('id', gymId)
        .maybeSingle();
    if (error || !data) return null;
    return { name: data.name, address: (data as any).address ?? null };
}

export type MutualFriend = {
    id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
};

export type ProfileSocial = {
    friendCount: number;
    mutualCount: number;
    mutualPreview: MutualFriend[];
    /** When you two connected — non-null only if you're already friends. */
    friendsSince: string | null;
    challengesTogether: number;
};

const EMPTY_SOCIAL: ProfileSocial = {
    friendCount: 0,
    mutualCount: 0,
    mutualPreview: [],
    friendsSince: null,
    challengesTogether: 0,
};

/**
 * Social connective tissue for the profile sheet: their friend count, friends
 * you share, when you connected, and challenges you've done together. Backed by
 * the get_profile_social RPC. Degrades to zeros so it can never break the sheet.
 */
export async function fetchProfileSocial(userId: string): Promise<ProfileSocial> {
    const { data, error } = await supabase.rpc('get_profile_social', { p_user_id: userId });
    if (error) {
        console.warn('[fetchProfileSocial]', error.message);
        return EMPTY_SOCIAL;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return EMPTY_SOCIAL;
    return {
        friendCount: row.friend_count ?? 0,
        mutualCount: row.mutual_count ?? 0,
        mutualPreview: (row.mutual_preview ?? []) as MutualFriend[],
        friendsSince: row.friends_since ?? null,
        challengesTogether: row.challenges_together ?? 0,
    };
}

/**
 * Resolves the caller's friendship state with `userId` for the profile sheet's
 * CTA (Add friend / Requested / Accept / Friends). Backed by the
 * get_friend_relationship RPC. Callers that already hold the graph (the friends
 * screen) can skip this and pass the relationship straight to the sheet.
 */
export async function fetchFriendRelationship(userId: string): Promise<FriendRelationship> {
    const { data, error } = await supabase.rpc('get_friend_relationship', { p_user_id: userId });
    if (error) {
        console.warn('[fetchFriendRelationship]', error.message);
        return 'none';
    }
    return (data ?? 'none') as FriendRelationship;
}

export async function updateProfile(
    fields: Partial<Pick<Profile, 'display_name' | 'username' | 'avatar_url'>>
): Promise<{ error: string | null }> {
    const { error } = await supabase
        .from('profiles')
        .update(fields)
        .eq('id', (await getSessionUser())?.id ?? '');
    return { error: error?.message ?? null };
}

/**
 * Checks whether a username is free to claim. A username is "available" if no
 * other profile holds it (the current user's own row is ignored, so re-saving
 * your existing handle reports available). The DB unique constraint remains the
 * authoritative backstop against races.
 */
export async function isUsernameAvailable(
    username: string,
): Promise<{ available: boolean; error: string | null }> {
    const user = await getSessionUser();
    const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username)
        .limit(1)
        .maybeSingle();
    if (error) return { available: false, error: error.message };
    return { available: isHandleFree(data, user?.id), error: null };
}

export async function updateProProfile(
    fields: Partial<Pick<Profile, 'bio' | 'cover_url'>>
): Promise<{ error: string | null }> {
    const user = await getSessionUser();
    if (!user) return { error: 'Not authenticated' };
    const { error } = await supabase.from('profiles').update(fields).eq('id', user.id);
    return { error: error?.message ?? null };
}

export async function setPreferredGym(gymId: string | null): Promise<{ error: string | null }> {
    const user = await getSessionUser();
    if (!user) return { error: 'Not authenticated' };
    const { error } = await supabase
        .from('profiles')
        .update({ preferred_gym_id: gymId })
        .eq('id', user.id);
    return { error: error?.message ?? null };
}

export async function updateLeaderboardVisibility(show: boolean): Promise<{ error: string | null }> {
    const user = await getSessionUser();
    if (!user) return { error: 'Not authenticated' };
    const { error } = await supabase
        .from('profiles')
        .update({ show_on_leaderboard: show })
        .eq('id', user.id);
    return { error: error?.message ?? null };
}

export async function uploadCover(localUri: string): Promise<{ url: string | null; error: string | null }> {
    const user = await getSessionUser();
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
    const user = await getSessionUser();
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
 * Persists the user's concrete activity picks (Padel, Boxing…) AND the derived
 * scoring buckets, keeping every legacy consumer of activity_preferences
 * working. Gym is always prepended to the buckets (it's the locked slot).
 */
export async function updateActivitySelections(
    selections: { slug: string; label: string; bucket: string }[]
): Promise<{ error: string | null }> {
    const user = await getSessionUser();
    if (!user) return { error: 'Not authenticated' };

    const buckets = ['gym', ...selections.map(s => s.bucket)]
        .filter((b, i, arr) => arr.indexOf(b) === i);

    const { error: dbError } = await supabase
        .from('profiles')
        .update({ activity_preferences: buckets, activity_selections: selections })
        .eq('id', user.id);
    if (dbError) return { error: dbError.message };

    const { error: authError } = await supabase.auth.updateUser({
        data: { activity_preferences: buckets, activity_selections: selections },
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
    const user = await getSessionUser();
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
