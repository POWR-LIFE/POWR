// The made-up world every docs screenshot is set in. Nothing here is a real
// gym, brand or person: the guides are public, so the screens must be too.
//
// Northpoint Strength (a gym in the fictional town of Riverton) and Peakform
// Nutrition (a brand) are the only two businesses. Dates are relative to the
// day the screenshots are taken, so "this week" always reads as this week.

export const BASE_URL = process.env.BASE || 'http://localhost:5173';
// Artwork: fictional logos from ./assets, photos from the app's own licensed
// samples (public/studio-samples/credits.json).
export const asset = (name) => `https://docs-assets.invalid/${name}`;
export const photo = (name) => `${BASE_URL}/studio-samples/${name}`;

export const GYM = {
    id: '6f1d2c3b-0000-4000-8000-00000000a001',
    name: 'Northpoint Strength',
    slug: 'northpoint-strength',
    town: 'Riverton',
    address: '14 Canal Street, Riverton',
    logo_url: asset('northpoint-logo.svg'),
    logo_bg: 'dark',
    photo_url: photo('rope.jpg'),
    board_key: 'docs-board-key',
};

export const OWNER = {
    id: '6f1d2c3b-0000-4000-8000-00000000b001',
    email: 'sam@northpoint.example',
    name: 'Sam Carter',
};

export const BRAND = {
    name: 'Peakform Nutrition',
    code: 'PEAK',
    logo_url: asset('peakform-logo.svg'),
    wordmark_url: asset('peakform-wordmark.svg'),
    // Not plate.jpg: a real gym's name is on its wall.
    hero_url: photo('headphones.jpg'),
    website: 'https://peakform.example',
};

export const BRAND_USER = {
    id: '6f1d2c3b-0000-4000-8000-00000000c001',
    email: 'alex@peakform.example',
    name: 'Alex Morgan',
};

// Members, as the portals show them (first name + initial). Order is stable,
// so a fixture can take the first n and get the same people every run.
export const PEOPLE = [
    'Amara K.', 'Ben T.', 'Chloe R.', 'Dev P.', 'Ella M.', 'Finn O.', 'Grace L.', 'Hassan A.',
    'Isla W.', 'Jonah B.', 'Kemi O.', 'Leo F.', 'Maya S.', 'Nico D.', 'Orla H.', 'Priya N.',
    'Quinn E.', 'Rosa G.', 'Sami J.', 'Tara C.', 'Umar Y.', 'Vera Z.', 'Will H.', 'Xena P.',
    'Yusuf I.', 'Zoe V.', 'Arlo M.', 'Bea N.', 'Cal R.', 'Dina S.', 'Eli T.', 'Fern U.',
    'Gus W.', 'Hana X.', 'Ivo B.', 'Jade C.', 'Kit D.', 'Lena E.', 'Milo F.', 'Nell G.',
].map((display, i) => ({
    id: `6f1d2c3b-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`,
    name: display,
    first_name: display.split(' ')[0],
    powr_id: `PWR${String(48213 + i * 37).slice(-5)}`,
    username: display.split(' ')[0].toLowerCase() + (i + 7),
}));

const DAY = 864e5;
/** ISO timestamp n days from now (negative = ago), at an optional hour. */
export const daysFromNow = (n, hour) => {
    const d = new Date(Date.now() + n * DAY);
    if (hour != null) d.setHours(hour, 0, 0, 0);
    return d.toISOString();
};
/** YYYY-MM-DD n days from now. */
export const dateFromNow = (n) => daysFromNow(n).slice(0, 10);
/** Monday 00:00 of this week, local time. */
export const thisMonday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
};
/** A stable uuid for fixture rows: uid('event', 1). */
export const uid = (kind, n) => {
    let h = 0;
    for (const c of kind) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `${h.toString(16).padStart(8, '0').slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
};
