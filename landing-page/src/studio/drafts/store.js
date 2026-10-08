/**
 * Drafts: a post or carousel saved from the editor to finish later. The row
 * (studio_drafts) holds the editor's state as JSON; the photos, clips and
 * logos it uses sit beside it in the private studio-packs bucket, under
 * drafts/<id>/ (a gym's under gyms/<partner_id>/drafts/<id>/, a reward
 * brand's under brands/<brand slug>/drafts/<id>/). See
 * supabase/migrations/20261006120000_studio_drafts.sql and
 * 20261008130000_studio_drafts_brands.sql.
 *
 * Whose drafts is the `scope` every call takes: { partnerId } a gym's,
 * { brand } a reward brand's (rewards.brand_name), neither for POWR's own.
 *
 * Saving again only uploads what's new: every photo, clip and logo opened
 * from or saved to a draft is remembered (`kept`), so re-saving a draft whose
 * words changed is one small write. Files the draft no longer uses are
 * cleared after the save lands.
 */
import { supabase } from '../../lib/supabase';
import { loadMedia } from '../media';
import { assetWithPreview } from '../assets';

const BUCKET = 'studio-packs';
// The bucket takes 50 MB a file; leave room for the container overhead.
const MAX_FILE = 48 * 1024 * 1024;
// A clip over the limit keeps just the part the slides use, at up to 1920 px.
const KEEP_EDGE = 1920;
const THUMB = 'thumb.jpg';
const VIDEO_TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

// Photo/clip/logo object → where it's kept: { path, bytes, mime, offset, length }.
// offset/length: the stretch of the original clip the kept file holds.
const kept = new WeakMap();

// "Healthspan Elite" → "healthspan-elite": a brand's folder. The bucket's
// policy works it out the same way (studio_brand_slug), and anything outside
// a–z 0–9 becomes a dash however each side lowercases it.
export const brandSlug = (name) => String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const folderOf = (id, { partnerId = null, brand = null } = {}) => (partnerId ? `gyms/${partnerId}/drafts/${id}`
    : brand ? `brands/${brandSlug(brand)}/drafts/${id}` : `drafts/${id}`);

// The rows in a scope. A brand matches case-insensitively, as everywhere in
// the partner portal; POWR's own are the rows that are neither a gym's nor a brand's.
function inScope(q, { partnerId = null, brand = null } = {}) {
    if (partnerId) return q.eq('partner_id', partnerId);
    if (brand) return q.ilike('brand_name', brand.replace(/[\\%_]/g, '\\$&'));
    return q.is('partner_id', null).is('brand_name', null);
}
const token = () => Math.random().toString(36).slice(2, 8);

// A stable id per photo/clip/logo object, for comparing states.
const ids = new WeakMap();
let seq = 0;
const idOf = (o) => {
    if (!ids.has(o)) ids.set(o, ++seq);
    return ids.get(o);
};
const isMedia = (v) => v && typeof v === 'object' && (v.kind === 'image' || v.kind === 'video') && 'source' in v;
const isAsset = (v) => v && typeof v === 'object' && 'image' in v && 'preview' in v;

/** The editor's state as a string, photos and logos by identity — equal strings, nothing to save. */
export function signature(payload) {
    return JSON.stringify(payload, (k, v) => (isMedia(v) ? `m${idOf(v)}` : isAsset(v) ? `a${idOf(v)}` : v));
}

async function upload(path, blob, type, { upsert = false } = {}) {
    if (blob.size > MAX_FILE) throw new Error(`${path.split('/').pop()} is ${mb(blob.size)} — over the 50 MB a draft can keep.`);
    // storage-js sends a Blob as multipart, where the file's own type is what
    // the bucket checks — so it's re-typed (a .m4v says video/x-m4v).
    const body = blob.type === type ? blob : new Blob([blob], { type });
    const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: type, upsert, cacheControl: upsert ? '0' : '31536000' });
    if (error) throw new Error(`Upload failed (${path.split('/').pop()}): ${error.message}`);
}

const canvasBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t encode the image.'))), type, q));

// A photo as the editor holds it (EXIF-rotated, ≤ 3200 px) → JPEG.
async function photoBlob(m) {
    const c = document.createElement('canvas');
    c.width = m.width;
    c.height = m.height;
    c.getContext('2d').drawImage(m.source, 0, 0, c.width, c.height);
    const blob = await canvasBlob(c, 'image/jpeg', 0.92);
    c.width = 0;
    return blob;
}

const videoType = (blob, name) => {
    if (Object.values(VIDEO_TYPES).includes(blob.type)) return blob.type;
    return VIDEO_TYPES[(name.split('.').pop() || '').toLowerCase()] ?? 'video/mp4';
};

// A clip too big to keep whole: the [start, end] stretch, re-encoded to fit.
async function trimmedClip(blob, m, start, end, onProgress) {
    const lib = await import('mediabunny');
    const input = new lib.Input({ source: new lib.BlobSource(blob), formats: lib.ALL_FORMATS });
    const output = new lib.Output({ format: new lib.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new lib.BufferTarget() });
    const k = Math.min(1, KEEP_EDGE / Math.max(m.width, m.height));
    const even = (n) => Math.max(2, Math.round(n / 2) * 2);
    const size = k < 1 ? (m.width >= m.height ? { width: even(m.width * k) } : { height: even(m.height * k) }) : {};
    // Whatever fits the file limit for this length, up to a clean 12 Mbps.
    const bitrate = Math.max(1.5e6, Math.min(12e6, Math.floor(((MAX_FILE * 0.9 * 8) / (end - start)) - 160e3)));
    const conversion = await lib.Conversion.init({
        input, output, trim: { start, end }, copy: false, showWarnings: false,
        video: { ...size, codec: 'avc', bitrate },
        audio: { codec: 'aac', bitrate: 128e3 },
    });
    if (!conversion.isValid) throw new Error('This browser can’t re-encode that clip.');
    conversion.onProgress = (p) => onProgress?.(p);
    await conversion.execute();
    return new Blob([output.target.buffer], { type: 'video/mp4' });
}

/**
 * Save the editor's state as a draft — new (no `id`), or over draft `id`.
 * `payload` is what the editor hands over: { format, style, current, slides }
 * where each slide carries its photo/clip and logo OBJECTS; `thumb` is a JPEG
 * of the first slide. Resolves with { draft: { id, title, updated_at }, notes }.
 */
export async function saveDraft({ id = null, title, scope = {}, payload, thumb, onProgress }) {
    // A draft deleted from the Drafts tab while open here saves as a new one.
    if (id) {
        const { data } = await supabase.from('studio_drafts').select('id').eq('id', id).maybeSingle();
        if (!data) id = null;
    }
    const isNew = !id;
    const draftId = id ?? crypto.randomUUID();
    const base = folderOf(draftId, scope);
    const notes = [];

    // Every photo/clip and logo the slides use, once each.
    const mediaList = [];
    const assetList = [];
    for (const sl of payload.slides) {
        if (sl.media && !mediaList.includes(sl.media)) mediaList.push(sl.media);
        for (const byKey of Object.values(sl.assets ?? {})) {
            for (const a of Object.values(byKey ?? {})) if (a && !assetList.includes(a)) assetList.push(a);
        }
    }
    const steps = mediaList.length + assetList.length + 1;
    let done = 0;
    const step = (label) => onProgress?.({ done: done++, total: steps, label });

    // What each clip's slides need of it: the range from the earliest start to the latest end.
    const rangeOf = (m) => {
        const uses = payload.slides.filter((sl) => sl.media === m && sl.clip);
        if (!uses.length) return { start: 0, end: m.duration };
        return { start: Math.min(...uses.map((u) => u.clip.start)), end: Math.max(...uses.map((u) => u.clip.end)) };
    };

    const keepMedia = async (m) => {
        const was = kept.get(m);
        const range = m.kind === 'video' ? rangeOf(m) : null;
        const covers = !range || !was || (range.start >= was.offset - 0.01 && range.end <= was.offset + was.length + 0.01);
        if (was && covers) {
            if (was.path.startsWith(`${base}/`)) return was;
            // Kept by another draft (Save as copy): copy it across, or upload again if it's gone.
            const path = `${base}/${was.path.split('/').pop()}`;
            const { error } = await supabase.storage.from(BUCKET).copy(was.path, path);
            if (!error) return { ...was, path };
        }
        if (m.kind === 'image') {
            const blob = await photoBlob(m);
            const path = `${base}/photo-${token()}.jpg`;
            await upload(path, blob, 'image/jpeg');
            return { path, bytes: blob.size, mime: 'image/jpeg', offset: 0, length: 0 };
        }
        const original = m.blob ?? await (await fetch(m.url)).blob();
        if (original.size <= MAX_FILE) {
            const mime = videoType(original, m.name || '');
            const path = `${base}/clip-${token()}.${mime === 'video/quicktime' ? 'mov' : mime === 'video/webm' ? 'webm' : 'mp4'}`;
            await upload(path, original, mime);
            return { path, bytes: original.size, mime, offset: 0, length: m.duration };
        }
        // Too big to keep whole: keep the stretch the slides use, with a second either side.
        const start = Math.max(0, range.start - 1);
        const end = Math.min(m.duration, range.end + 1);
        const blob = await trimmedClip(original, m, start, end, (p) => onProgress?.({ done, total: steps, label: `Keeping the clip… ${Math.round(p * 100)}%` }));
        const path = `${base}/clip-${token()}.mp4`;
        await upload(path, blob, 'video/mp4');
        notes.push(`“${m.name}” is ${mb(original.size)}, so the draft keeps the ${(end - start).toFixed(0)} s it uses (${mb(blob.size)}).`);
        return { path, bytes: blob.size, mime: 'video/mp4', offset: start, length: end - start };
    };

    const keepAsset = async (a) => {
        const was = kept.get(a);
        if (was) {
            if (was.path.startsWith(`${base}/`)) return was;
            const path = `${base}/${was.path.split('/').pop()}`;
            const { error } = await supabase.storage.from(BUCKET).copy(was.path, path);
            if (!error) return { ...was, path };
        }
        const blob = await canvasBlob(a.image, 'image/png');
        const path = `${base}/image-${token()}.png`;
        await upload(path, blob, 'image/png');
        return { path, bytes: blob.size, mime: 'image/png' };
    };

    const keptMedia = new Map();
    for (const m of mediaList) {
        step(m.kind === 'video' ? 'Keeping the clip…' : 'Keeping the photo…');
        try {
            keptMedia.set(m, await keepMedia(m));
        } catch (e) {
            // The draft still saves — words, look and crop — and says what's missing.
            keptMedia.set(m, null);
            notes.push(`“${m.name}” wasn’t kept (${e.message.replace(/\.$/, '')}) — drop it in again when you open the draft.`);
        }
    }
    const keptAssets = new Map();
    for (const a of assetList) {
        step('Keeping the images…');
        try {
            keptAssets.set(a, await keepAsset(a));
        } catch (e) {
            keptAssets.set(a, null);
            notes.push(`“${a.name}” wasn’t kept (${e.message.replace(/\.$/, '')}).`);
        }
    }
    step('Saving…');
    if (thumb) await upload(`${base}/${THUMB}`, thumb, 'image/jpeg', { upsert: true }).catch(() => {});

    const media = mediaList.map((m) => {
        const k = keptMedia.get(m);
        return k ? { path: k.path, kind: m.kind, name: m.name, mime: k.mime, bytes: k.bytes } : { missing: true, kind: m.kind, name: m.name };
    });
    const assets = assetList.map((a) => {
        const k = keptAssets.get(a);
        return k ? { path: k.path, name: a.name, bytes: k.bytes } : { missing: true, name: a.name };
    });
    const slides = payload.slides.map((sl) => {
        const k = sl.media ? keptMedia.get(sl.media) : null;
        // A trimmed clip starts later: move the slide's range and frame with it.
        const shift = (t) => Math.max(0, t - (k?.offset ?? 0));
        return {
            ...sl,
            media: sl.media ? mediaList.indexOf(sl.media) : null,
            clip: sl.media?.kind === 'video' && sl.clip ? { start: shift(sl.clip.start), end: shift(sl.clip.end) } : null,
            time: sl.media?.kind === 'video' ? shift(sl.time ?? 0) : 0,
            assets: Object.fromEntries(Object.entries(sl.assets ?? {}).map(([tid, byKey]) => [
                tid, Object.fromEntries(Object.entries(byKey ?? {}).filter(([, a]) => a).map(([key, a]) => [key, assetList.indexOf(a)])),
            ])),
        };
    });
    const state = { v: 1, format: payload.format, style: payload.style, current: payload.current, media, assets, slides };
    const row = {
        title,
        state,
        format: payload.format,
        slide_count: slides.length,
        has_video: mediaList.some((m) => m.kind === 'video'),
        template_id: slides[0]?.templateId ?? null,
        thumb_path: thumb ? `${base}/${THUMB}` : null,
        bytes: [...keptMedia.values(), ...keptAssets.values()].reduce((n, k) => n + (k?.bytes ?? 0), 0) + (thumb?.size ?? 0),
    };
    const q = isNew
        ? supabase.from('studio_drafts').insert({ id: draftId, partner_id: scope.partnerId ?? null, ...(scope.brand ? { brand_name: scope.brand } : {}), ...row })
        : supabase.from('studio_drafts').update(row).eq('id', draftId);
    const { data: saved, error } = await q.select('id, title, updated_at').single();
    if (error) {
        if (isNew) await clearFolder(base).catch(() => {});
        throw new Error(`Couldn’t save the draft — ${error.message}`);
    }
    // Remember what's where, so the next save reuses it.
    for (const [m, k] of keptMedia) if (k) kept.set(m, k);
    for (const [a, k] of keptAssets) if (k) kept.set(a, k);
    // Clear out photos and clips this draft no longer uses.
    if (!isNew) {
        const keep = new Set([THUMB, ...media.map((x) => x.path), ...assets.map((x) => x.path)].filter(Boolean).map((p) => p.split('/').pop()));
        await clearFolder(base, (name) => !keep.has(name)).catch(() => {});
    }
    onProgress?.({ done: steps, total: steps, label: 'Saved' });
    return { draft: saved, notes };
}

async function clearFolder(base, which = () => true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(base, { limit: 1000 });
    if (error) throw new Error(error.message);
    const paths = (data ?? []).filter((f) => f.id && which(f.name)).map((f) => `${base}/${f.name}`);
    for (let i = 0; i < paths.length; i += 100) {
        const { error: e } = await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
        if (e) throw new Error(e.message);
    }
}

async function signed(paths, seconds = 3600) {
    const map = new Map();
    for (let i = 0; i < paths.length; i += 100) {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 100), seconds);
        if (error) throw new Error(`Couldn’t open the saved files — ${error.message}`);
        for (const d of data ?? []) if (d.signedUrl) map.set(d.path, d.signedUrl);
    }
    return map;
}

/** A scope's drafts, last edited first, each with its preview and who last saved it. */
export async function listDrafts(scope = {}, { limit = 200 } = {}) {
    const q = supabase
        .from('studio_drafts')
        .select('id, title, format, slide_count, has_video, template_id, thumb_path, bytes, created_at, updated_at, updated_by')
        .order('updated_at', { ascending: false })
        .limit(limit);
    const { data, error } = await inScope(q, scope);
    if (error) throw new Error(`Couldn’t load the drafts — ${error.message}`);
    const rows = data ?? [];
    if (!rows.length) return [];
    const [urls, names] = await Promise.all([
        signed(rows.map((r) => r.thumb_path).filter(Boolean)).catch(() => new Map()),
        peopleNames(rows.map((r) => r.updated_by)),
    ]);
    return rows.map((r) => ({ ...r, thumbUrl: urls.get(r.thumb_path) ?? null, by: names.get(r.updated_by) ?? null }));
}

async function peopleNames(userIds) {
    const want = [...new Set(userIds.filter(Boolean))];
    if (!want.length) return new Map();
    const { data } = await supabase.from('profiles').select('id, display_name, username').in('id', want);
    return new Map((data ?? []).map((p) => [p.id, (p.display_name || p.username || '').split(' ')[0] || null]));
}

/** How many drafts a scope has — for the tab's count. */
export async function countDrafts(scope = {}) {
    const { count, error } = await inScope(supabase.from('studio_drafts').select('id', { count: 'exact', head: true }), scope);
    return error ? null : count ?? 0;
}

/**
 * A draft, ready for the editor: its state with every photo, clip and logo
 * loaded again (slides point at the loaded objects, as the editor holds them).
 * A file that won't load leaves its slide without it, and says so in `notes`.
 */
export async function openDraft(id, { onProgress } = {}) {
    const { data: row, error } = await supabase.from('studio_drafts').select('id, title, updated_at, state').eq('id', id).single();
    if (error) throw new Error(`Couldn’t open the draft — ${error.message}`);
    const { state } = row;
    const notes = [];
    const files = [...state.media, ...state.assets].filter((f) => f.path);
    const urls = files.length ? await signed(files.map((f) => f.path)) : new Map();
    let done = 0;
    const total = files.length;
    const fetchFile = async (f) => {
        onProgress?.({ done: done++, total });
        const res = await fetch(urls.get(f.path));
        if (!res.ok) throw new Error(`${res.status}`);
        const blob = await res.blob();
        return new File([blob], f.name || f.path.split('/').pop(), { type: f.mime || blob.type });
    };
    const media = [];
    for (const f of state.media) {
        if (!f.path) { media.push(null); notes.push(`“${f.name}” wasn’t kept with this draft — drop it in again.`); continue; }
        try {
            const m = await loadMedia(await fetchFile(f));
            kept.set(m, { path: f.path, bytes: f.bytes, mime: f.mime, offset: 0, length: m.duration ?? 0 });
            media.push(m);
        } catch (e) {
            media.push(null);
            notes.push(`“${f.name}” wouldn’t open (${e.message}) — drop it in again.`);
        }
    }
    const assets = [];
    for (const f of state.assets) {
        if (!f.path) { assets.push(null); continue; }
        try {
            const a = await assetWithPreview(await fetchFile(f));
            kept.set(a, { path: f.path, bytes: f.bytes, mime: 'image/png' });
            assets.push(a);
        } catch {
            assets.push(null);
            notes.push(`“${f.name}” wouldn’t open — upload it again.`);
        }
    }
    onProgress?.({ done: total, total });
    const slides = state.slides.map((sl) => {
        const m = sl.media === null || sl.media === undefined ? null : media[sl.media] ?? null;
        return {
            ...sl,
            media: m,
            clip: m?.kind === 'video' ? clampClip(sl.clip, m.duration) : { start: 0, end: 0 },
            time: m?.kind === 'video' ? Math.min(sl.time ?? 0, m.duration) : 0,
            assets: Object.fromEntries(Object.entries(sl.assets ?? {}).map(([tid, byKey]) => [
                tid, Object.fromEntries(Object.entries(byKey).map(([key, i]) => [key, assets[i]]).filter(([, a]) => a)),
            ])),
        };
    });
    return {
        draft: { id: row.id, title: row.title, updated_at: row.updated_at },
        state: { format: state.format, style: state.style, current: Math.min(state.current ?? 0, slides.length - 1), slides },
        notes,
    };
}

const clampClip = (clip, duration) => {
    const start = Math.min(Math.max(0, clip?.start ?? 0), Math.max(0, duration - 0.5));
    const end = Math.min(duration, Math.max(clip?.end ?? duration, start + 0.5));
    return { start, end };
};

export async function renameDraft(id, title) {
    const { data, error } = await supabase.from('studio_drafts').update({ title }).eq('id', id).select('id, title, updated_at').single();
    if (error) throw new Error(`Couldn’t rename the draft — ${error.message}`);
    return data;
}

/** Delete a draft and its files. */
export async function deleteDraft(id, scope = {}) {
    await clearFolder(folderOf(id, scope)).catch((e) => { throw new Error(`Couldn’t delete the draft’s files — ${e.message}`); });
    const { error } = await supabase.from('studio_drafts').delete().eq('id', id);
    if (error) throw new Error(`Couldn’t delete the draft — ${error.message}`);
}

export const mb = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
