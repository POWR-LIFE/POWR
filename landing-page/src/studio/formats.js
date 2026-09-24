/**
 * Output sizes for the Studio, at 1× — the pixel sizes each platform stores,
 * so an export is never re-scaled on upload. Print sizes are A-series at
 * 300 dpi and also download as PDF with a 3 mm bleed.
 *
 * `safe` is the inset type may sit in. Feed posts only lose a sliver to the
 * profile grid's crop; stories and reels lose the top ~200 px to the progress
 * bar + handle and the bottom ~330 px to the reply bar and captions; print
 * keeps type ~5 mm clear of the trim.
 */
const mm = (v) => Math.round((v / 25.4) * 300); // mm → px at 300 dpi

export const FORMATS = {
    post:      { id: 'post',      group: 'Social',  label: 'Post',      ratio: '4:5',    w: 1080, h: 1350, safe: { t: 64,  r: 64, b: 64,  l: 64 } },
    portrait:  { id: 'portrait',  group: 'Social',  label: 'Portrait',  ratio: '3:4',    w: 1080, h: 1440, safe: { t: 64,  r: 64, b: 64,  l: 64 } },
    square:    { id: 'square',    group: 'Social',  label: 'Square',    ratio: '1:1',    w: 1080, h: 1080, safe: { t: 60,  r: 60, b: 60,  l: 60 } },
    story:     { id: 'story',     group: 'Social',  label: 'Story',     ratio: '9:16',   w: 1080, h: 1920, safe: { t: 210, r: 72, b: 330, l: 72 } },

    landscape: { id: 'landscape', group: 'Banners', label: 'Landscape', ratio: '16:9',   w: 1920, h: 1080, safe: { t: 64,  r: 84, b: 64,  l: 84 }, note: 'YouTube · web · gym screens' },
    link:      { id: 'link',      group: 'Banners', label: 'Link',      ratio: '1.91:1', w: 1200, h: 628,  safe: { t: 40,  r: 56, b: 40,  l: 56 }, note: 'LinkedIn & Facebook posts' },
    header:    { id: 'header',    group: 'Banners', label: 'Header',    ratio: '3:1',    w: 1500, h: 500,  safe: { t: 36,  r: 64, b: 36,  l: 64 }, note: 'X header · email' },
    cover:     { id: 'cover',     group: 'Banners', label: 'Cover',     ratio: '4:1',    w: 1584, h: 396,  safe: { t: 30,  r: 72, b: 30,  l: 72 }, note: 'LinkedIn cover' },

    a5:        { id: 'a5',        group: 'Print',   label: 'A5',        ratio: 'flyer',  w: mm(148), h: mm(210), safe: { t: mm(7), r: mm(7), b: mm(7), l: mm(7) }, print: { wMm: 148, hMm: 210 } },
    a4:        { id: 'a4',        group: 'Print',   label: 'A4',        ratio: 'sheet',  w: mm(210), h: mm(297), safe: { t: mm(9), r: mm(9), b: mm(9), l: mm(9) }, print: { wMm: 210, hMm: 297 } },
    a3:        { id: 'a3',        group: 'Print',   label: 'A3',        ratio: 'poster', w: mm(297), h: mm(420), safe: { t: mm(12), r: mm(12), b: mm(12), l: mm(12) }, print: { wMm: 297, hMm: 420 } },
};

export const FORMAT_LIST = Object.values(FORMATS);
export const FORMAT_GROUPS = ['Social', 'Banners', 'Print'];
export const BLEED_MM = 3;

/**
 * The layout family a size belongs to — templates branch on this:
 * tall (9:16) · post (4:5, 3:4, A-series) · square · wide (16:9, 1.91:1) ·
 * strip (3:1, 4:1).
 */
export function shapeOf(w, h) {
    const r = h / w;
    if (r > 1.6) return 'tall';
    if (r >= 1.1) return 'post';
    if (r >= 0.9) return 'square';
    if (r >= 0.42) return 'wide';
    return 'strip';
}
