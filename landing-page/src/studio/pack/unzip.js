/**
 * Reading a ZIP in the browser: the central directory from the end of the
 * file, then each entry's bytes — sliced straight out when stored, inflated
 * with the browser's own DecompressionStream when deflated. ZIP64 is
 * understood (big archives from macOS and Windows use it). Nothing is read
 * until an entry is asked for, so a 2 GB shoot costs only what's opened.
 */

const MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
    heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
    mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm',
};
export const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] ?? '';

const u64 = (view, at) => Number(view.getBigUint64(at, true));

/** The ZIP's file entries: [{ path, size, read() → File }]. Throws if it isn't a ZIP. */
export async function zipEntries(file) {
    // The end-of-central-directory record sits in the last 64 KB (+ its size).
    const tailSize = Math.min(file.size, 65535 + 22 + 20);
    const tailAt = file.size - tailSize;
    const tail = new DataView(await file.slice(tailAt).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
        if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a ZIP');
    let count = tail.getUint16(eocd + 10, true);
    let cdSize = tail.getUint32(eocd + 12, true);
    let cdAt = tail.getUint32(eocd + 16, true);
    if (count === 0xffff || cdSize === 0xffffffff || cdAt === 0xffffffff) {
        const loc = eocd - 20; // ZIP64 locator, just before the record
        if (loc >= 0 && tail.getUint32(loc, true) === 0x07064b50) {
            const at = u64(tail, loc + 8);
            const z = new DataView(await file.slice(at, at + 56).arrayBuffer());
            if (z.getUint32(0, true) !== 0x06064b50) throw new Error('damaged ZIP64 record');
            count = u64(z, 32);
            cdSize = u64(z, 40);
            cdAt = u64(z, 48);
        }
    }
    const cd = new DataView(await file.slice(cdAt, cdAt + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    const entries = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
        if (cd.getUint32(p, true) !== 0x02014b50) break;
        const flags = cd.getUint16(p + 8, true);
        const method = cd.getUint16(p + 10, true);
        let csize = cd.getUint32(p + 20, true);
        let usize = cd.getUint32(p + 24, true);
        const nameLen = cd.getUint16(p + 28, true);
        const extraLen = cd.getUint16(p + 30, true);
        const commentLen = cd.getUint16(p + 32, true);
        let local = cd.getUint32(p + 42, true);
        const path = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
        // ZIP64: the sizes/offset that overflowed live in extra field 0x0001, in this order.
        if (usize === 0xffffffff || csize === 0xffffffff || local === 0xffffffff) {
            let q = p + 46 + nameLen;
            const end = q + extraLen;
            while (q + 4 <= end) {
                const id = cd.getUint16(q, true);
                const len = cd.getUint16(q + 2, true);
                if (id === 0x0001) {
                    let r = q + 4;
                    if (usize === 0xffffffff) { usize = u64(cd, r); r += 8; }
                    if (csize === 0xffffffff) { csize = u64(cd, r); r += 8; }
                    if (local === 0xffffffff) local = u64(cd, r);
                    break;
                }
                q += 4 + len;
            }
        }
        p += 46 + nameLen + extraLen + commentLen;
        if (path.endsWith('/') || flags & 1) continue; // folders; encrypted entries
        entries.push({ path, size: usize, read: () => readEntry(file, { path, method, csize, local }) });
    }
    return entries;
}

async function readEntry(zip, e) {
    const head = new DataView(await zip.slice(e.local, e.local + 30).arrayBuffer());
    if (head.getUint32(0, true) !== 0x04034b50) throw new Error(`damaged entry ${e.path}`);
    const start = e.local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const raw = zip.slice(start, start + e.csize);
    const name = e.path.split('/').pop();
    const type = mimeOf(name);
    if (e.method === 0) return new File([raw], name, { type });
    if (e.method === 8) {
        const inflated = await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        return new File([inflated], name, { type });
    }
    throw new Error(`${name}: compression method ${e.method} isn't supported`);
}
