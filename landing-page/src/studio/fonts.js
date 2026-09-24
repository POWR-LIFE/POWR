/**
 * The Studio's type kit. Everything is open-licence (SIL OFL) from Google
 * Fonts, so posts can be published commercially without a font licence.
 *
 * Canvas text can only use a face the document has already loaded — a
 * missing one silently falls back to a system font and the post looks wrong
 * with no error — so ensureFonts() must resolve before anything is drawn.
 */

const CSS_URL = 'https://fonts.googleapis.com/css2'
    + '?family=Anton'
    + '&family=Archivo+Black'
    + '&family=Big+Shoulders+Display:wght@800;900'
    + '&family=IBM+Plex+Mono:wght@400;500;600'
    + '&family=Instrument+Serif:ital@0;1'
    + '&family=Inter+Tight:ital,wght@0,500;0,600;0,700;0,800;1,500;1,600;1,700;1,800'
    + '&family=Michroma'
    + '&family=Outfit:wght@200;300;400;500;600;700;800'
    + '&display=block';

export const TYPE = {
    anton:     { family: 'Anton', weight: 400 },
    grotesk:   { family: 'Inter Tight', weight: 600 },
    groteskB:  { family: 'Inter Tight', weight: 700 },
    groteskM:  { family: 'Inter Tight', weight: 500 },
    wide:      { family: 'Michroma', weight: 400 },
    heavy:     { family: 'Archivo Black', weight: 400 },
    brand:     { family: 'Outfit', weight: 800 },
    brandB:    { family: 'Outfit', weight: 700 },
    brandSB:   { family: 'Outfit', weight: 600 },
    brandM:    { family: 'Outfit', weight: 500 },
    brandR:    { family: 'Outfit', weight: 400 },
    brandL:    { family: 'Outfit', weight: 300 },
    brandXL:   { family: 'Outfit', weight: 200 },
    groteskX:  { family: 'Inter Tight', weight: 800 },
    shoulders: { family: 'Big Shoulders Display', weight: 900 },
    mono:      { family: 'IBM Plex Mono', weight: 500 },
    monoR:     { family: 'IBM Plex Mono', weight: 400 },
    serif:     { family: 'Instrument Serif', weight: 400 },
    serifI:    { family: 'Instrument Serif', weight: 400, style: 'italic' },
};

/** Headline faces a template can be switched to. */
export const HEADLINE_FONTS = [
    { id: 'anton',     label: 'Anton',         note: 'condensed' },
    { id: 'shoulders', label: 'Big Shoulders', note: 'tall' },
    { id: 'grotesk',   label: 'Inter Tight',   note: 'grotesk' },
    { id: 'heavy',     label: 'Archivo Black', note: 'heavy' },
    { id: 'wide',      label: 'Michroma',      note: 'wide' },
    { id: 'brand',     label: 'Outfit',        note: 'POWR' },
    { id: 'brandL',    label: 'Outfit Light',  note: 'POWR, light' },
];

// Every face a template draws with, as a CSS font shorthand. Italic Inter
// Tight is listed at each weight because markup (_like this_) can italicise
// any headline line.
const FACES = [
    '400 64px "Anton"',
    '400 64px "Archivo Black"',
    '800 64px "Big Shoulders Display"',
    '900 64px "Big Shoulders Display"',
    '400 64px "IBM Plex Mono"',
    '500 64px "IBM Plex Mono"',
    '600 64px "IBM Plex Mono"',
    '400 64px "Instrument Serif"',
    'italic 400 64px "Instrument Serif"',
    '500 64px "Inter Tight"', '600 64px "Inter Tight"', '700 64px "Inter Tight"', '800 64px "Inter Tight"',
    'italic 500 64px "Inter Tight"', 'italic 600 64px "Inter Tight"',
    'italic 700 64px "Inter Tight"', 'italic 800 64px "Inter Tight"',
    '400 64px "Michroma"',
    '200 64px "Outfit"', '300 64px "Outfit"', '400 64px "Outfit"', '500 64px "Outfit"',
    '600 64px "Outfit"', '700 64px "Outfit"', '800 64px "Outfit"',
];

// Covers the Latin subset plus the typographic punctuation posters use —
// Google serves each unicode-range as its own file and only fetches the ones
// the sample text touches.
const SAMPLE = 'AaZz09 .,:;!?/\'"’‘“”×·*#&@–—()[]£€%';

let loading = null;

export function ensureFonts() {
    if (loading) return loading;
    loading = new Promise((resolve) => {
        let link = document.querySelector('link[data-studio-fonts]');
        if (!link) {
            link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = CSS_URL;
            link.dataset.studioFonts = '1';
            document.head.appendChild(link);
        }
        if (link.sheet) { resolve(); return; }
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => resolve(), { once: true });
    })
        .then(() => Promise.all(FACES.map((f) => document.fonts.load(f, SAMPLE).catch(() => []))))
        .then(() => ({ missing: FACES.filter((f) => !faceRenders(f)) }));
    return loading;
}

// document.fonts.check() answers true for a family the page never declared,
// so it cannot catch a face that failed to load. Measuring can: with the face
// present, two different fallbacks measure the same; without it they differ.
function faceRenders(face) {
    const ctx = document.createElement('canvas').getContext('2d');
    const probe = 'Hamburgefonstiv 0123';
    ctx.font = `${face}, monospace`;
    const a = ctx.measureText(probe).width;
    ctx.font = `${face}, serif`;
    return Math.abs(ctx.measureText(probe).width - a) < 0.5;
}
