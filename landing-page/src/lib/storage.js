import { supabase } from './supabase';

const OBJECT_PATH = '/storage/v1/object/public/';
const RENDER_PATH = '/storage/v1/render/image/public/';

/**
 * Ask Supabase for a card-sized copy of a stored image, bounding its longest
 * side to `max` px and leaving the aspect ratio alone.
 *
 * Brand art is uploaded at press resolution — hero shots run to 13 megapixels
 * and one partner logo is 7554x2123. Bytes understate the damage: the browser
 * decodes to RGBA however well the file compresses, so that logo costs ~60MB
 * of bitmap to paint a 38px chip. Art painted at card scale has to be resized
 * at the CDN, not in the layout.
 *
 * Pass width AND height with resize=contain. A width-only request does NOT
 * scale proportionally — it pins the width and keeps the original height, so
 * a 4425x2950 hero comes back 800x2950 and every face in it is squashed.
 * `contain` never pads and never upscales, so art already smaller than the
 * bound is returned untouched.
 *
 * Non-Supabase and already-transformed URLs pass through. The endpoint
 * negotiates WebP off the Accept header and keeps the alpha channel, so
 * transparent logos stay transparent.
 */
export function storageImage(url, max, quality = 72) {
    if (!url || !url.includes(OBJECT_PATH)) return url;
    const [path] = url.split('?');
    return `${path.replace(OBJECT_PATH, RENDER_PATH)}?width=${max}&height=${max}&resize=contain&quality=${quality}`;
}

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
