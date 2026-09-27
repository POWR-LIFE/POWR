/**
 * Saved packs: every pack made is also kept, so there's always a reference to
 * come back to — the photos it was made from, every file it produced, and
 * the plan to open it again and rework it. Admin-only, in the private
 * `studio-packs` bucket (see supabase/migrations/20260926170000_studio_packs.sql).
 */
import { supabase } from '../../lib/supabase';
import { zipFiles } from '../zip';

const BUCKET = 'studio-packs';
const MAX_KEEP = 50 * 1024 * 1024; // the bucket's per-file limit
const SOURCE_EDGE = 3200;           // what the Studio works at anyway

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
const pad = (n) => String(n).padStart(3, '0');

// A photo as kept: JPEG, no bigger than the Studio uses. Small JPEGs go as they are.
async function keepable(file) {
    if (file.type === 'image/jpeg' && file.size < 6 * 1024 * 1024) {
        const bmp = await createImageBitmap(file).catch(() => null);
        const small = bmp && Math.max(bmp.width, bmp.height) <= SOURCE_EDGE;
        bmp?.close?.();
        if (small) return { blob: file, type: 'image/jpeg', ext: 'jpg' };
    }
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, SOURCE_EDGE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
    c.width = 0;
    return { blob, type: 'image/jpeg', ext: 'jpg' };
}

async function upload(path, blob, type) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false, cacheControl: '31536000' });
    if (error) throw new Error(`Upload failed (${path.split('/').pop()}): ${error.message}`);
}

// A few uploads at a time: faster than one by one, gentle on a slow line.
async function inParallel(items, n, fn) {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/**
 * Save a pack: the shoot (`media`), the files `buildPack` made and the plan.
 * Resolves with { id, skipped } — clips too big to keep are listed (their
 * posts are saved). Leaves the pack marked 'failed' if it can't finish.
 */
export async function savePack({ plan, title, media, files, partnerId = null, onProgress, signal }) {
    const { data: pack, error } = await supabase
        .from('studio_packs')
        .insert({ live_event_id: plan.eventId, partner_id: partnerId, title, phase: plan.phase, plan: stripped(plan), status: 'saving' })
        .select('id')
        .single();
    if (error) throw new Error(`Couldn’t start saving the pack — ${error.message}`);
    // A gym's packs live under its own folder; its staff can reach nothing else.
    const base = partnerId ? `gyms/${partnerId}/packs/${pack.id}` : `packs/${pack.id}`;
    const skipped = [];
    const rows = [];
    let bytes = 0;
    const sources = media.filter((m) => m.analysis?.ok && !m.excluded);
    const total = sources.length + files.length;
    let done = 0;
    const tick = () => onProgress?.({ done: ++done, total });
    try {
        await inParallel(sources, 3, async (m, i) => {
            if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
            if (m.kind === 'clip' && m.file.size > MAX_KEEP) { skipped.push(m.path); tick(); return; }
            const kept = m.kind === 'photo' ? await keepable(m.file) : { blob: m.file, type: m.file.type || 'video/mp4', ext: (m.file.name.split('.').pop() || 'mp4').toLowerCase() };
            const path = `${base}/source/${pad(i + 1)}-${slug(m.path.split('/').pop().replace(/\.[^.]+$/, ''))}.${kept.ext}`;
            await upload(path, kept.blob, kept.type);
            bytes += kept.blob.size;
            rows.push({
                pack_id: pack.id, role: 'source', path, name: m.path, mime: kept.type, bytes: kept.blob.size,
                width: m.analysis.width ?? null, height: m.analysis.height ?? null,
                meta: { mediaId: m.id, kind: m.kind, duration: m.analysis.duration ?? null, analysis: { stats: m.analysis.stats, calm: m.analysis.calm, subject: m.analysis.subject, hash: m.analysis.hash } },
            });
            tick();
        });
        await inParallel(files, 3, async (f) => {
            if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
            const path = `${base}/${f.role === 'thumb' ? '' : 'out/'}${f.name.split('/').map(slug).join('/')}`;
            const type = f.blob.type || 'application/octet-stream';
            await upload(path, f.blob, type);
            bytes += f.blob.size;
            rows.push({ pack_id: pack.id, role: f.role, path, name: f.name, mime: type, bytes: f.blob.size, width: f.width ?? null, height: f.height ?? null, meta: f.meta ?? {} });
            tick();
        });
        for (let i = 0; i < rows.length; i += 100) {
            const { error: e } = await supabase.from('studio_pack_files').insert(rows.slice(i, i + 100));
            if (e) throw new Error(`Couldn’t record the pack’s files — ${e.message}`);
        }
        const { error: e2 } = await supabase.from('studio_packs').update({
            status: 'saved',
            source_count: rows.filter((r) => r.role === 'source').length,
            output_count: rows.filter((r) => r.role === 'output').length,
            bytes,
            updated_at: new Date().toISOString(),
        }).eq('id', pack.id);
        if (e2) throw new Error(`Couldn’t finish saving — ${e2.message}`);
        return { id: pack.id, skipped };
    } catch (err) {
        // Keep what's up (it's listed, so it can be deleted), and say it didn't finish.
        if (rows.length) await supabase.from('studio_pack_files').insert(rows).then(() => {}, () => {});
        await supabase.from('studio_packs').update({ status: 'failed', bytes, updated_at: new Date().toISOString() }).eq('id', pack.id).then(() => {}, () => {});
        throw err;
    }
}

// The plan without what can't or needn't be stored (thumbnails are canvases).
const stripped = (plan) => JSON.parse(JSON.stringify(plan));

/**
 * Saved packs, newest first — one event's, or all of them — each with a few
 * previews. `partnerId` is a gym's packs; without it, POWR's own.
 */
export async function listPacks({ eventId = null, partnerId = null, limit = 40 } = {}) {
    let q = supabase
        .from('studio_packs')
        .select('id, title, phase, status, created_at, source_count, output_count, bytes, live_event_id, live_events:live_event_id (name)')
        .order('created_at', { ascending: false })
        .limit(limit);
    q = partnerId ? q.eq('partner_id', partnerId) : q.is('partner_id', null);
    if (eventId) q = q.eq('live_event_id', eventId);
    const { data, error } = await q;
    if (error) throw new Error(`Couldn’t load saved packs — ${error.message}`);
    const packs = data ?? [];
    if (!packs.length) return [];
    const { data: thumbs } = await supabase
        .from('studio_pack_files')
        .select('pack_id, path, meta')
        .eq('role', 'thumb')
        .in('pack_id', packs.map((p) => p.id));
    const firstThumbs = new Map();
    for (const t of thumbs ?? []) {
        const list = firstThumbs.get(t.pack_id) ?? [];
        if (list.length < 4) list.push(t.path);
        firstThumbs.set(t.pack_id, list);
    }
    const paths = [...firstThumbs.values()].flat();
    const urls = paths.length ? await signed(paths) : new Map();
    return packs.map((p) => ({ ...p, eventName: p.live_events?.name ?? null, thumbs: (firstThumbs.get(p.id) ?? []).map((path) => urls.get(path)).filter(Boolean) }));
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

async function filesOf(packId, role) {
    const { data, error } = await supabase.from('studio_pack_files').select('path, name, mime, bytes, meta').eq('pack_id', packId).eq('role', role).order('name');
    if (error) throw new Error(`Couldn’t read the pack — ${error.message}`);
    return data ?? [];
}

/** The pack's files again, as the ZIP it was downloaded as. */
export async function packZip(packId, { onProgress, signal } = {}) {
    const rows = await filesOf(packId, 'output');
    const urls = await signed(rows.map((r) => r.path));
    const files = [];
    for (const [i, r] of rows.entries()) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        onProgress?.({ done: i, total: rows.length });
        const res = await fetch(urls.get(r.path));
        if (!res.ok) throw new Error(`Couldn’t fetch ${r.name} (${res.status})`);
        files.push({ name: r.name, data: await res.blob() });
    }
    onProgress?.({ done: rows.length, total: rows.length });
    return zipFiles(files);
}

/**
 * A saved pack, ready to open again: its plan, and the photos and clips it
 * was made from as Files (each tagged with the id the plan knows it by).
 */
export async function reopenPack(packId, { onProgress, signal } = {}) {
    const { data: pack, error } = await supabase.from('studio_packs').select('id, title, phase, plan, live_event_id').eq('id', packId).single();
    if (error) throw new Error(`Couldn’t open the pack — ${error.message}`);
    const rows = await filesOf(packId, 'source');
    const urls = await signed(rows.map((r) => r.path));
    const sources = [];
    for (const [i, r] of rows.entries()) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        onProgress?.({ done: i, total: rows.length });
        const res = await fetch(urls.get(r.path));
        if (!res.ok) throw new Error(`Couldn’t fetch ${r.name} (${res.status})`);
        const blob = await res.blob();
        sources.push({ id: r.meta?.mediaId, kind: r.meta?.kind ?? 'photo', path: r.name, file: new File([blob], r.name.split('/').pop(), { type: r.mime }) });
    }
    onProgress?.({ done: rows.length, total: rows.length });
    return { pack, sources };
}

/** Delete a pack and everything it saved. */
export async function deletePack(packId) {
    const { data, error } = await supabase.from('studio_pack_files').select('path').eq('pack_id', packId);
    if (error) throw new Error(`Couldn’t delete the pack — ${error.message}`);
    const paths = (data ?? []).map((r) => r.path);
    for (let i = 0; i < paths.length; i += 100) {
        const { error: e } = await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
        if (e) throw new Error(`Couldn’t delete the pack’s files — ${e.message}`);
    }
    const { error: e2 } = await supabase.from('studio_packs').delete().eq('id', packId);
    if (e2) throw new Error(`Couldn’t delete the pack — ${e2.message}`);
}
