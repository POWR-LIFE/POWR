/**
 * Bringing a shoot in: a folder (picked or dropped), a pile of files, a ZIP —
 * or any mix of them. Everything is read in the browser; nothing is uploaded
 * here. The result is the photos and clips, in name order, within the limits,
 * with a count of what was left out and why, so the page can say so plainly.
 */
import { zipEntries, mimeOf } from './unzip';

const MB = 1024 * 1024;

export const LIMITS = {
    photos: 100,
    clips: 10,
    photoBytes: 40 * MB,
    clipBytes: 500 * MB,
    zipBytes: 2048 * MB,
    // A folder walk stops here — someone will drop their whole Pictures folder.
    walk: 3000,
};

const PHOTO = /\.(jpe?g|png|webp|gif|avif|hei[cf]|tiff?)$/i;
const CLIP = /\.(mp4|m4v|mov|webm)$/i;
const ZIP = /\.zip$/i;
// macOS resource forks, dotfiles and Windows thumbnail caches.
const JUNK = /(^|\/)(__MACOSX\/|\.[^/]*$)|(^|\/)(thumbs\.db|desktop\.ini)$/i;

function kindOf(path, type = '') {
    if (ZIP.test(path) || type === 'application/zip' || type === 'application/x-zip-compressed') return 'zip';
    if (CLIP.test(path) || type.startsWith('video/')) return 'clip';
    if (PHOTO.test(path) || type.startsWith('image/')) return 'photo';
    return null;
}

/**
 * The entries of a drop, walked: files, folders (all the way down) and ZIPs.
 * Call it straight from the drop handler — the browser only hands out folder
 * entries synchronously, before the first await.
 */
export function droppedItems(dataTransfer) {
    const entries = [...(dataTransfer.items ?? [])].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
    const loose = entries.length ? null : [...dataTransfer.files].map((file) => ({ file, path: file.name }));
    return (async () => {
        if (loose) return loose;
        const out = [];
        let seen = 0;
        const walk = async (entry, prefix) => {
            if (seen >= LIMITS.walk) return;
            if (entry.isFile) {
                seen++;
                const file = await new Promise((res, rej) => entry.file(res, rej));
                out.push({ file, path: `${prefix}${entry.name}` });
            } else if (entry.isDirectory) {
                const reader = entry.createReader();
                for (;;) {
                    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
                    if (!batch.length) break;
                    for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
                }
            }
        };
        for (const e of entries) await walk(e, '');
        return out;
    })();
}

/** A file input's files (a folder picker gives each one its path). */
export const pickedItems = (fileList) => [...fileList].map((file) => ({ file, path: file.webkitRelativePath || file.name }));

/**
 * Items → { photos, clips, left } within the limits. ZIPs are opened (and
 * ZIPs inside them). Duplicates (same name and size) count once. `have`
 * holds what's already in the pack, so a second drop adds to it.
 */
export async function collect(items, { have = { photos: 0, clips: 0 }, onProgress } = {}) {
    const left = { junk: 0, unsupported: 0, tooBig: 0, overLimit: 0, badZip: 0, duplicate: 0 };
    const photos = [];
    const clips = [];
    const seen = new Set();
    const queue = [...items];
    for (let i = 0; i < queue.length; i++) {
        const { file, path } = queue[i];
        onProgress?.({ done: i, total: queue.length, path });
        if (JUNK.test(path)) { left.junk++; continue; }
        const kind = kindOf(path, file.type);
        if (!kind) { left.unsupported++; continue; }
        if (kind === 'zip') {
            if (file.size > LIMITS.zipBytes) { left.tooBig++; continue; }
            try {
                for (const e of await zipEntries(file)) {
                    if (JUNK.test(e.path) || !kindOf(e.path, mimeOf(e.path))) { left[JUNK.test(e.path) ? 'junk' : 'unsupported']++; continue; }
                    queue.push({ zipped: e, path: `${path}/${e.path}`, file: { name: e.path.split('/').pop(), size: e.size, type: mimeOf(e.path) } });
                }
            } catch {
                left.badZip++;
            }
            continue;
        }
        const key = `${file.name}|${file.size}`;
        if (seen.has(key)) { left.duplicate++; continue; }
        seen.add(key);
        if (kind === 'photo') {
            if (file.size > LIMITS.photoBytes) { left.tooBig++; continue; }
            if (have.photos + photos.length >= LIMITS.photos) { left.overLimit++; continue; }
            photos.push({ path, file: queue[i].zipped ? await queue[i].zipped.read() : file });
        } else {
            if (file.size > LIMITS.clipBytes) { left.tooBig++; continue; }
            if (have.clips + clips.length >= LIMITS.clips) { left.overLimit++; continue; }
            clips.push({ path, file: queue[i].zipped ? await queue[i].zipped.read() : file });
        }
    }
    const byName = (a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
    photos.sort(byName);
    clips.sort(byName);
    onProgress?.({ done: queue.length, total: queue.length });
    return { photos, clips, left };
}

/** "3 left out: 2 too big, 1 not a photo or clip" — or null. */
export function leftOutNote(left) {
    const parts = [
        [left.overLimit, `over the ${LIMITS.photos}-photo / ${LIMITS.clips}-clip limit`],
        [left.tooBig, `too big (photos ${LIMITS.photoBytes / MB} MB, clips ${LIMITS.clipBytes / MB} MB, ZIPs 2 GB)`],
        [left.unsupported, 'not a photo or clip'],
        [left.badZip, 'a ZIP that wouldn’t open'],
        [left.duplicate, 'already added'],
    ].filter(([n]) => n > 0);
    if (!parts.length) return null;
    const total = parts.reduce((s, [n]) => s + n, 0);
    return `${total} left out: ${parts.map(([n, why]) => `${n} ${why}`).join(', ')}.`;
}
