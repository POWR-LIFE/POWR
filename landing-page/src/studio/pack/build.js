/**
 * Making a pack: every post at every size, the poster, the carousel and the
 * reels, rendered at full size by the Studio's own renderer, with captions to
 * paste. Each photo is loaded once, used for all its posts and sizes, then
 * let go — a 50-photo shoot never sits in memory at full size.
 *
 * The same files go in the ZIP and to the saved pack; a small preview of each
 * post goes with the saved pack too, for the list of saved packs.
 */
import { BLEED_MM } from '../formats';
import { prepareStudio, renderPost } from '../render';
import { templateById } from '../templates';
import { loadMedia } from '../media';
import { exportVideo } from '../video';
import { pdfFromCanvas } from '../pdf';
import { captionFor, REEL_SECONDS } from './plan';

const FOLDER = {
    post: '01 Post 4x5', story: '02 Story 9x16', square: '03 Square 1x1', landscape: '04 Landscape 16x9',
    print: '05 Print', video: '06 Video', carousel: '07 Carousel',
};

const pad = (n) => String(n).padStart(2, '0');
const THUMB_W = 360;

/** Every file the plan makes, in ZIP order. */
export function jobsOf(plan) {
    const jobs = [];
    plan.posts.forEach((p, i) => {
        for (const format of plan.options.formats) jobs.push({ kind: 'still', post: p, format, name: `${FOLDER[format]}/${pad(i + 1)}-${p.templateId}.jpg` });
        if (p.poster) jobs.push({ kind: 'pdf', post: p, format: 'a4', name: `${FOLDER.print}/${pad(i + 1)}-${p.templateId}-a4.pdf` });
        jobs.push({ kind: 'thumb', post: p, format: 'post', name: `thumbs/${p.id}.jpg` });
    });
    const slides = plan.carousel?.slides ?? [];
    slides.forEach((s, i) => {
        const post = { ...s, look: plan.carousel.look };
        jobs.push({ kind: 'still', post, format: 'post', name: `${FOLDER.carousel}/${pad(i + 1)}-of-${pad(slides.length)}.jpg` });
        jobs.push({ kind: 'thumb', post, format: 'post', name: `thumbs/${s.id}.jpg` });
    });
    plan.reels.forEach((r, i) => jobs.push({ kind: 'reel', post: r, format: 'story', name: `${FOLDER.video}/${pad(i + 1)}-reel-${r.templateId}.mp4` }));
    return jobs;
}

/** "14 posts at 2 sizes, a poster, an 8-slide carousel and 2 reels — 38 files". */
export function describePlan(plan) {
    const n = plan.posts.length;
    const parts = [`${n} post${n === 1 ? '' : 's'} at ${plan.options.formats.length} size${plan.options.formats.length === 1 ? '' : 's'}`];
    const posters = plan.posts.filter((p) => p.poster).length;
    if (posters) parts.push(posters === 1 ? 'an A4 poster' : `${posters} A4 posters`);
    if (plan.carousel) parts.push(`${[8, 11, 18].includes(plan.carousel.slides.length) ? "an" : "a"} ${plan.carousel.slides.length}-slide carousel`);
    if (plan.reels.length) parts.push(plan.reels.length === 1 ? 'a reel' : `${plan.reels.length} reels`);
    const files = jobsOf(plan).filter((j) => j.kind !== 'thumb').length + 1;
    const last = parts.length > 1 ? ` and ${parts.pop()}` : '';
    return `${parts.join(', ')}${last} — ${files} files`;
}

const styleOf = (plan) => ({ colourway: plan.options.colourway, headlineFont: '' });

// The renderer's options for one post.
function optsFor(plan, post, format, media, item) {
    return {
        template: templateById(post.templateId),
        format,
        media,
        focal: item?.analysis?.subject ?? { x: 0.5, y: 0.42 },
        zoom: 1,
        style: styleOf(plan),
        fields: post.fields,
        look: post.look ?? {},
        assets: {},
    };
}

/** A post drawn small from a photo's thumbnail — for the page, not the file. */
export function renderPreview(canvas, plan, post, item, format = 'post', scale = 0.25) {
    const media = item?.analysis?.thumb
        ? { kind: 'image', source: item.analysis.thumb, width: item.analysis.thumb.width, height: item.analysis.thumb.height, name: item.path }
        : null;
    return renderPost(canvas, { ...optsFor(plan, post, format, media, item), scale });
}

const toBlob = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('The browser could not encode an image.'))), type, q));

function release(m) {
    if (m?.kind !== 'video') return;
    m.source.pause();
    m.source.removeAttribute('src');
    m.source.load();
    if (m.blob) URL.revokeObjectURL(m.url);
}

/**
 * Render the plan. `media` is the shoot ({ id, kind, file, analysis }).
 * Resolves with [{ name, blob, role: 'output' | 'thumb', width, height, meta }].
 */
export async function buildPack({ plan, media, onProgress, signal }) {
    await prepareStudio();
    const jobs = jobsOf(plan);
    const byId = new Map(media.map((m) => [m.id, m]));
    // One pass per photo, so each is loaded once.
    const groups = new Map();
    for (const j of jobs) {
        const key = j.post.mediaId ?? '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(j);
    }
    const out = [];
    let done = 0;
    const tick = (label) => onProgress?.({ done, total: jobs.length, label });
    for (const [mediaId, group] of groups) {
        const item = byId.get(mediaId) ?? null;
        let full = null;
        try {
            if (item) full = await loadMedia(item.file);
            for (const job of group) {
                if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
                tick(job.name);
                if (job.kind === 'reel') {
                    const blob = await exportVideo({
                        ...optsFor(plan, job.post, 'story', full, item),
                        start: 0,
                        end: Math.min(REEL_SECONDS, full?.duration ?? REEL_SECONDS),
                        keepAudio: false,
                        signal,
                        onProgress: (p) => onProgress?.({ done: done + p, total: jobs.length, label: job.name }),
                    });
                    out.push({ name: job.name, blob, role: 'output', meta: { postId: job.post.id, format: 'story' } });
                } else {
                    // A clip standing in as a still (a reel's first frame) shows a quarter of the way in.
                    if (full?.kind === 'video') await seek(full.source, Math.min(1, full.duration * 0.25));
                    const c = document.createElement('canvas');
                    const scale = job.kind === 'thumb' ? THUMB_W / 1080 : 1;
                    const bleed = job.kind === 'pdf' ? Math.round((BLEED_MM / 25.4) * 300) : 0;
                    renderPost(c, { ...optsFor(plan, job.post, job.format, full, item), scale, bleed });
                    const blob = job.kind === 'pdf'
                        ? await pdfFromCanvas(c, { wMm: 210, hMm: 297, bleedMm: BLEED_MM })
                        : await toBlob(c, 'image/jpeg', job.kind === 'thumb' ? 0.82 : 0.92);
                    out.push({
                        name: job.name, blob, role: job.kind === 'thumb' ? 'thumb' : 'output',
                        width: c.width, height: c.height, meta: { postId: job.post.id, format: job.format },
                    });
                    c.width = 0;
                }
                done++;
            }
        } finally {
            release(full);
        }
        await new Promise((res) => setTimeout(res, 0)); // let the page breathe between photos
    }
    const caption = captionFor(plan.phase, plan.facts);
    out.push({ name: 'captions.txt', blob: new Blob([caption], { type: 'text/plain' }), role: 'output', meta: {} });
    tick('done');
    const order = new Map(jobs.map((j, i) => [j.name, i]));
    return out.sort((a, b) => (order.get(a.name) ?? 1e9) - (order.get(b.name) ?? 1e9));
}

const seek = (v, t) => new Promise((res) => {
    if (Math.abs(v.currentTime - t) < 0.01) { res(); return; }
    v.addEventListener('seeked', () => res(), { once: true });
    v.currentTime = t;
});
