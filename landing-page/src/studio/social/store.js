/**
 * Studio → Instagram (admin Studio only, POWR's own account). Files go to the
 * private `studio-social` bucket; a row in studio_social_posts says what to
 * post and when; the publish-instagram function does the posting (now, or
 * from the 5-minute cron). See supabase/migrations/20261001120000_studio_social_posts.sql.
 */
import { supabase } from '../../lib/supabase';
import { invokeFn } from '../../lib/invokeFn';

const BUCKET = 'studio-social';
export const CAPTION_MAX = 2200;
export const HASHTAG_MAX = 30;
export const CAROUSEL_MAX = 10;

export const hashtagCount = (s) => (String(s).match(/(^|\s)#[^\s#]+/gu) ?? []).length;

/**
 * What a Studio size can go out as. Feed takes 4:5 (0.8) to 1.91:1; stories
 * and reels are 9:16. Banners and print don't fit Instagram at all.
 */
export function kindsFor({ formatInfo: F, slideCount, hasVideo }) {
    const r = F.w / F.h;
    const tall = Math.abs(r - 9 / 16) < 0.01;
    const feed = r >= 0.8 - 0.001 && r <= 1.91 + 0.001;
    if (F.print || (!tall && !feed)) {
        return { kinds: [], reason: `${F.label} (${F.w}×${F.h}) isn't an Instagram size — Instagram takes 4:5 to 1.91:1 in the feed and 9:16 for stories and reels. Switch to Post, Square or Story.` };
    }
    if (slideCount > CAROUSEL_MAX) return { kinds: [], reason: `Instagram carousels take up to ${CAROUSEL_MAX} slides — this has ${slideCount}.` };
    if (slideCount > 1) {
        if (tall) return { kinds: [], reason: 'A story goes out one frame at a time — post the slides one by one, or switch to Post for a carousel.' };
        return { kinds: ['carousel'] };
    }
    if (tall) return { kinds: hasVideo ? ['reel', 'story'] : ['story'] };
    if (hasVideo) return { kinds: [], reason: 'Reels are 9:16 — switch to Story size to post this video as a reel.' };
    return { kinds: ['image'] };
}

export const KIND_LABEL = { image: 'Feed post', carousel: 'Carousel', reel: 'Reel', story: 'Story' };

export async function accountStatus() {
    return invokeFn('publish-instagram', { status: true });
}

export async function connectAccount({ accessToken, igUserId }) {
    return invokeFn('publish-instagram', { connect: { access_token: accessToken, ig_user_id: igUserId } });
}

export async function disconnectAccount() {
    return invokeFn('publish-instagram', { disconnect: true });
}

async function upload(path, blob, type) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: true });
    if (error) throw new Error(`Upload failed (${path.split('/').pop()}): ${error.message}`);
}

async function thumbBlob(dataUrl) {
    if (!dataUrl) return null;
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const k = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
}

/**
 * Upload the files and create the row. `scheduledAt` null = now: the row is
 * then published straight away through the function.
 */
export async function createPost({ kind, caption, files, thumb, format, scheduledAt = null }) {
    const id = crypto.randomUUID();
    const base = `posts/${id}`;
    const media = [];
    for (const [i, f] of files.entries()) {
        const ext = f.type === 'video' ? 'mp4' : 'jpg';
        const path = `${base}/${String(i + 1).padStart(2, '0')}.${ext}`;
        await upload(path, f.blob, f.type === 'video' ? 'video/mp4' : 'image/jpeg');
        media.push({ path, type: f.type, width: f.width, height: f.height });
    }
    let thumbPath = null;
    const tb = await thumbBlob(thumb).catch(() => null);
    if (tb) { thumbPath = `${base}/thumb.jpg`; await upload(thumbPath, tb, 'image/jpeg'); }
    const { error } = await supabase.from('studio_social_posts').insert({
        id, platform: 'instagram', kind, caption: kind === 'story' ? '' : caption, media, thumb_path: thumbPath, format,
        status: 'scheduled', scheduled_at: (scheduledAt ?? new Date()).toISOString(),
    });
    if (error) throw new Error(`Couldn’t save the post — ${error.message}`);
    if (!scheduledAt) return publishNow(id);
    return { id, ok: true, scheduled: true };
}

export async function publishNow(id) {
    const { data, error } = await supabase.functions.invoke('publish-instagram', { body: { postId: id } });
    if (error) {
        let msg = error.message;
        try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep */ }
        throw new Error(msg);
    }
    return data;
}

export async function listPosts({ limit = 60 } = {}) {
    const { data, error } = await supabase
        .from('studio_social_posts')
        .select('id, kind, caption, status, scheduled_at, published_at, permalink, error, note, attempts, thumb_path, media, format, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw new Error(`Couldn’t load posts — ${error.message}`);
    const rows = data ?? [];
    const paths = rows.map((r) => r.thumb_path).filter(Boolean);
    const urls = new Map();
    if (paths.length) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
        for (const d of signed ?? []) if (d.signedUrl) urls.set(d.path, d.signedUrl);
    }
    return rows.map((r) => ({ ...r, thumbUrl: urls.get(r.thumb_path) ?? null }));
}

export async function cancelPost(id) {
    const { error } = await supabase.from('studio_social_posts')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'scheduled');
    if (error) throw new Error(`Couldn’t cancel — ${error.message}`);
}

/** Put a failed post back in the queue and publish it now. */
export async function retryPost(id) {
    const { error } = await supabase.from('studio_social_posts')
        .update({ status: 'scheduled', error: null, scheduled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'failed');
    if (error) throw new Error(`Couldn’t retry — ${error.message}`);
    return publishNow(id);
}

/** A Europe/London wall-clock time ("2026-10-02T09:30") as a Date. */
export function londonToDate(local) {
    const [d, t] = local.split('T');
    const [y, mo, da] = d.split('-').map(Number);
    const [h, mi] = t.split(':').map(Number);
    const guess = Date.UTC(y, mo - 1, da, h, mi);
    const offset = (ms) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
            .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
        return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms;
    };
    return new Date(guess - offset(guess - offset(guess)));
}

export const fmtLondon = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');
