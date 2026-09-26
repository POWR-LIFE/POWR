/**
 * A ZIP file, written by hand, entries stored uncompressed: everything the
 * Studio puts in one (PNG, MP4, PDF) is already compressed, so deflating
 * again would only cost time. UTF-8 names, one central directory, no data
 * descriptors — the sizes are known before each entry is written.
 */

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// MS-DOS date and time, as ZIP headers want them (2-second resolution).
function dosStamp(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
}

async function bytesOf(data, enc) {
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string') return enc.encode(data);
    return new Uint8Array(await data.arrayBuffer());
}

/**
 * `files`: [{ name, data }] where data is a Blob, a Uint8Array or a string.
 * Folders come from the names ("02 Story 9x16/01-ticket.png"). Resolves with
 * the ZIP as a Blob.
 */
export async function zipFiles(files, { date = new Date() } = {}) {
    const enc = new TextEncoder();
    const { time, date: dosDate } = dosStamp(date);
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
        const data = await bytesOf(f.data, enc);
        const name = enc.encode(f.name);
        const crc = crc32(data);

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);   // local file header
        local.setUint16(4, 20, true);           // version needed: 2.0
        local.setUint16(6, 0x0800, true);       // flags: UTF-8 names
        local.setUint16(8, 0, true);            // method: stored
        local.setUint16(10, time, true);
        local.setUint16(12, dosDate, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true); // compressed size
        local.setUint32(22, data.length, true); // uncompressed size
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);           // no extra field
        parts.push(new Uint8Array(local.buffer), name, data);

        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, 0x02014b50, true);      // central directory header
        cd.setUint16(4, 20, true);              // made by: 2.0
        cd.setUint16(6, 20, true);              // version needed
        cd.setUint16(8, 0x0800, true);
        cd.setUint16(10, 0, true);
        cd.setUint16(12, time, true);
        cd.setUint16(14, dosDate, true);
        cd.setUint32(16, crc, true);
        cd.setUint32(20, data.length, true);
        cd.setUint32(24, data.length, true);
        cd.setUint16(28, name.length, true);
        cd.setUint16(30, 0, true);              // extra
        cd.setUint16(32, 0, true);              // comment
        cd.setUint16(34, 0, true);              // disk
        cd.setUint16(36, 0, true);              // internal attributes
        cd.setUint32(38, 0, true);              // external attributes
        cd.setUint32(42, offset, true);         // where the local header is
        central.push(new Uint8Array(cd.buffer), name);

        offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);         // end of central directory
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    end.setUint16(20, 0, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
