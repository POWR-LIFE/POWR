/**
 * The join poster: "This gym is on POWR", with a QR that opens the app. A gym
 * prints it for the front desk and posts it once, and every member who scans
 * it lands in the app. Built with the Ticket template, type on black, so it
 * needs no photo, at A4 and A5 for print and Post, Story and Square for the
 * feed, in one ZIP with the caption to paste.
 */
import { buildKit, treatmentFor } from './kit';
import { twoLines } from './words';

/**
 * Where the QR sends people: the app (or the store for someone new), opened
 * on this gym's card in Discover, which needs the id and where it is.
 * app.html forwards every param but `to` into powr://discover?venue=…
 */
export function joinUrlFor(gym) {
    const id = gym.partner_id ?? gym.id ?? '';
    const lat = Number(gym.lat); const lng = Number(gym.lng);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return 'https://powr.life/app?to=discover';
    return `https://powr.life/app?to=discover&venue=${encodeURIComponent(id)}&lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`;
}

/** "Leamington Spa" out of "1 High St, Leamington Spa CV32 4AB". */
export function townOf(address) {
    const parts = String(address ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return '';
    const last = parts[parts.length - 1].replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, '').trim();
    return last || parts[parts.length - 2];
}

const FOLDER = { post: '01 Post 4x5', story: '02 Story 9x16', square: '03 Square 1x1', print: '04 Print' };

/** The words on the poster for this gym. */
export function joinFields(gym) {
    const town = townOf(gym.address);
    return {
        side: 'Train _here_. Earn.',
        lockup: `${twoLines(gym.name, 16)}\nis on POWR`,
        date: 'From\ntoday',
        place: town ? `${gym.name},\n${town}` : `${gym.name}`,
        time: 'Every session',
        qrLabel: 'Scan to get the app',
        qr: joinUrlFor(gym),
    };
}

/** The jobs the join kit renders. */
export function planJoinKit(gym) {
    const fields = joinFields(gym);
    const tr = treatmentFor({ look: 'film', accent: 'powr' }, 0, 'ticket');
    const job = (kind, format, folder, file, label) => ({ id: `${folder}/${file}`, label, template: 'ticket', format, kind, folder, file, stem: 'join', fields, asset: null, look: tr.look, style: tr.style });
    return [
        job('pdf', 'a4', FOLDER.print, 'join-poster-a4.pdf', 'A4 poster'),
        job('pdf', 'a5', FOLDER.print, 'join-flyer-a5.pdf', 'A5 flyer'),
        job('png', 'post', FOLDER.post, 'join.png', 'Post'),
        job('png', 'story', FOLDER.story, 'join.png', 'Story'),
        job('png', 'square', FOLDER.square, 'join.png', 'Square'),
    ];
}

export function joinCaption(gym) {
    return `${gym.name} is on POWR. Every session you do here counts: check in, earn POWR, and get on the gym's leaderboard. Get the app and pick ${gym.name} as your gym: ${joinUrlFor(gym)}\n\n#POWR #${String(gym.name).toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

export async function buildJoinKit({ gym, onProgress, signal }) {
    const jobs = planJoinKit(gym);
    const readme = [
        `${gym.name} on POWR — the join poster`,
        '',
        '04 Print: A4 for the wall or the front desk, A5 for the counter. 3 mm bleed on both; any printer handles it.',
        '01–03: the same poster for your feed, your stories and your grid.',
        'captions.txt has the words to paste.',
        '',
        'The QR opens the POWR app, or the app store for someone new. Ask them to pick your gym in the app: that is what puts them on your board.',
        '',
    ].join('\n');
    return buildKit({ phase: 'before', facts: { name: `${gym.name} on POWR`, venue: gym.name }, jobs, onProgress, signal, captions: joinCaption(gym), readme });
}
