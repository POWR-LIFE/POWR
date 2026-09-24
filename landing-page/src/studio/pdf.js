/**
 * PDFs from rendered canvases: each page is the design as a high-quality JPEG
 * filling a page of the exact size. Print pages declare the bleed (BleedBox =
 * the full page, TrimBox = the finished size) so a print shop trims where it
 * should. Several pages make a double-sided flyer, or a LinkedIn carousel
 * (LinkedIn posts carousels as PDF documents). Written by hand — image pages
 * need nothing a PDF library would add.
 */
export const mmToPt = (mm) => (mm / 25.4) * 72;

/** A canvas as a PDF page image (JPEG bytes). Encode, then the canvas can go. */
export async function jpegPage(canvas) {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

/**
 * One PDF, one full-bleed image per page. Sizes are in points: `w` × `h` is
 * the finished page, `bleed` the extra all round that gets trimmed off.
 */
export function pdfFromPages(pages, { w, h, bleed = 0 }) {
    const W = w + 2 * bleed;
    const H = h + 2 * bleed;
    const f = (n) => n.toFixed(2);

    const enc = new TextEncoder();
    const parts = [];
    const offsets = [];
    let length = 0;
    const push = (data) => {
        const bytes = typeof data === 'string' ? enc.encode(data) : data;
        parts.push(bytes);
        length += bytes.length;
    };
    const obj = (n, body) => {
        offsets[n] = length;
        push(`${n} 0 obj\n${body}\nendobj\n`);
    };

    // Objects: 1 catalog, 2 page tree, then per page k: page, image, contents.
    const pageObj = (k) => 3 + 3 * k;
    push('%PDF-1.4\n%âãÏÓ\n'); // high bytes mark the file as binary
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${pages.map((_, k) => `${pageObj(k)} 0 R`).join(' ')}] /Count ${pages.length} >>`);
    pages.forEach((p, k) => {
        const n = pageObj(k);
        obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /BleedBox [0 0 ${f(W)} ${f(H)}] `
            + `/TrimBox [${f(bleed)} ${f(bleed)} ${f(W - bleed)} ${f(H - bleed)}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`);
        offsets[n + 1] = length;
        push(`${n + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} `
            + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);
        push(p.bytes);
        push('\nendstream\nendobj\n');
        const content = `q ${f(W)} 0 0 ${f(H)} 0 0 cm /Im0 Do Q`;
        obj(n + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });

    const count = pageObj(pages.length);
    const xref = length;
    const entries = Array.from({ length: count - 1 }, (_, i) => `${String(offsets[i + 1]).padStart(10, '0')} 00000 n \n`).join('');
    push(`xref\n0 ${count}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${count} /Root 1 0 R /Info << /Producer (POWR Studio) >> >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
}

/** A one-page print PDF of `canvas`, `wMm` × `hMm` finished, plus bleed. */
export async function pdfFromCanvas(canvas, { wMm, hMm, bleedMm = 0 }) {
    return pdfFromPages([await jpegPage(canvas)], { w: mmToPt(wMm), h: mmToPt(hMm), bleed: mmToPt(bleedMm) });
}
