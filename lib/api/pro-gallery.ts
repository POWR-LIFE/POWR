import * as FileSystem from 'expo-file-system/legacy';

import { getSessionUser, supabase } from '@/lib/supabase';

export type GalleryPhoto = {
    id: string;
    user_id: string;
    url: string;
    display_order: number;
    created_at: string;
};

export async function fetchGallery(userId: string): Promise<GalleryPhoto[]> {
    const { data, error } = await supabase
        .from('pro_gallery_photos')
        .select('*')
        .eq('user_id', userId)
        .order('display_order', { ascending: true });
    if (error) return [];
    return data as GalleryPhoto[];
}

export async function uploadGalleryPhoto(
    localUri: string
): Promise<{ photo: GalleryPhoto | null; error: string | null }> {
    const user = await getSessionUser();
    if (!user) return { photo: null, error: 'Not authenticated' };

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
        .from('gallery')
        .upload(path, buffer, { contentType, upsert: false });
    if (uploadError) return { photo: null, error: uploadError.message };

    const { data: urlData } = supabase.storage.from('gallery').getPublicUrl(path);

    // Get current max display_order for this user
    const { data: existing } = await supabase
        .from('pro_gallery_photos')
        .select('display_order')
        .eq('user_id', user.id)
        .order('display_order', { ascending: false })
        .limit(1);
    const nextOrder = (existing?.[0]?.display_order ?? -1) + 1;

    const { data: row, error: insertError } = await supabase
        .from('pro_gallery_photos')
        .insert({ user_id: user.id, url: urlData.publicUrl, display_order: nextOrder })
        .select()
        .single();

    if (insertError) return { photo: null, error: insertError.message };
    return { photo: row as GalleryPhoto, error: null };
}

export async function deleteGalleryPhoto(
    photoId: string,
    url: string
): Promise<{ error: string | null }> {
    const user = await getSessionUser();
    if (!user) return { error: 'Not authenticated' };

    // Derive storage path from URL (everything after /gallery/)
    const storagePath = url.split('/gallery/').pop();
    if (storagePath) {
        await supabase.storage.from('gallery').remove([storagePath]);
    }

    const { error } = await supabase
        .from('pro_gallery_photos')
        .delete()
        .eq('id', photoId)
        .eq('user_id', user.id);
    return { error: error?.message ?? null };
}

export async function reorderGalleryPhoto(
    photoId: string,
    displayOrder: number
): Promise<{ error: string | null }> {
    const user = await getSessionUser();
    if (!user) return { error: 'Not authenticated' };
    const { error } = await supabase
        .from('pro_gallery_photos')
        .update({ display_order: displayOrder })
        .eq('id', photoId)
        .eq('user_id', user.id);
    return { error: error?.message ?? null };
}
