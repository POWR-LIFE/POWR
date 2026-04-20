import { supabase } from './supabase';

// Uploads a File to a public bucket under a timestamped key and returns the public URL.
export async function uploadPublicImage(bucket, file, prefix = '') {
    if (!file) return null;
    const ext = (file.name?.split('.').pop() || 'png').toLowerCase();
    const key = `${prefix ? prefix + '/' : ''}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(key, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'image/png',
    });
    if (error) throw error;
    const { data } = supabase.storage.from(bucket).getPublicUrl(key);
    return data.publicUrl;
}
