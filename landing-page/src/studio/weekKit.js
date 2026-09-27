/**
 * The week's posts, for a gym's Overview: seven, one for each day, Monday to
 * Sunday, always all seven. Each day has a job, from the gym's own numbers
 * and its own photo (the one on its POWR listing):
 *   Mon  last week in numbers        Fri  the Gym League
 *   Tue  the join poster             Sat  the event: results, or the next one's ticket
 *   Wed  the board, midweek          Sun  a brand post
 *   Thu  who leads it
 * When the week can't carry a day's post (a board of two, a quiet week, no
 * league), that day gets one that needs no numbers, so there are always seven.
 *
 * A new set every Monday: the words, the fallbacks and the looks turn over
 * with the week (`seed`), so the feed doesn't repeat week to week. The
 * numbers inside are live: the board post shows the board as it is when it's
 * made. Each post at Post, Story and Square, in one ZIP with the captions.
 */
import { buildKit, wordsFor } from './kit';
import { joinFields, joinCaption } from './joinKit';
import { fieldDefaults } from './render';
import { templateById } from './templates';
import { thousands, wrapParagraphs } from './words';

export const WEEK_FORMATS = ['post', 'story', 'square'];
const FOLDER = { post: '01 Post 4x5', story: '02 Story 9x16', square: '03 Square 1x1' };
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// A number worth posting: below this a week reads as quiet, not busy.
export const MIN_SESSIONS = 10;
export const MIN_ON_BOARD = 3;
const DAY = 86_400_000;

const plural = (n, one, many) => `${thousands(n)} ${n === 1 ? one : many}`;
// A template's own words underneath, so a field left out never draws blank.
const words = (id, fields) => ({ ...fieldDefaults(templateById(id)), ...fields });
const tagOf = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const pick = (list, seed) => list[((seed % list.length) + list.length) % list.length];
const ORD = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const COUNT = ['', 'one', 'two', 'three', 'four', 'five'];

/** One number per week, the same all week: the set turns over every Monday. */
export const weekSeed = (weekStartIso) => Math.round(Date.parse(weekStartIso) / (7 * DAY));

// ── The seven days ─────────────────────────────────────────────────────────
// Each returns { stem, label, template, fields, caption, asset?, free? }.
// Each day keeps to its own templates (Mon grid/countdown, Tue ticket, Wed
// results/dots, Thu editorial, Fri club, Sat ticket/results/manifesto, Sun
// bleed/barcode) and its own lines, so no two posts in a week look or read
// alike; only an event week repeats the ticket or the table.

function monday(w, seed) {
    const g = w.gym.name;
    const last = w.last;
    if (last && last.sessions >= MIN_SESSIONS) {
        const first = last.newFaces > 0 ? `, ${plural(last.newFaces, 'of them', 'of them')} here for the first time` : '';
        return {
            stem: 'last-week', label: 'Last week', template: 'grid',
            fields: words('grid', {
                headline: `${thousands(last.sessions)}\n_sessions_\nlast week`,
                kicker: `${plural(last.athletes, 'person', 'people')}\ntrained here`,
                footer: last.newFaces > 0 ? `${plural(last.newFaces, 'first-timer', 'first-timers')}.\nWelcome.` : 'Every session\ncounts.',
                date: w.lastLabel,
            }),
            caption: `${thousands(last.sessions)} sessions at ${g} last week, from ${plural(last.athletes, 'person', 'people')}${first}. Thanks for showing up. New week, clean board: it starts today.`,
        };
    }
    return {
        stem: 'new-week', label: 'New week', template: 'countdown',
        fields: words('countdown', {
            kicker: `This week at ${g}`, headline: 'Day\none', day: '1', of: '7', footer: 'Show up · Earn · Repeat',
            line: pick(['Show up. Check in. The streak does the rest.', 'Seven days. One board. Every session counts.'], seed),
        }),
        caption: `Day one. The board at ${g} starts again today, and every session counts. Check in with POWR and get on it.`,
    };
}

function tuesday(w, seed) {
    // The join poster: gets members onto POWR, so it downloads on every package.
    // Over the gym's photo here (a feed post); /venue/poster keeps type on black for print.
    return {
        stem: 'join', label: 'Join us', template: 'ticket', free: true,
        fields: { ...joinFields(w.gym), side: pick(['Train _here_. Earn.', 'Show _up_. Earn.', 'Check _in_. Earn.'], seed) },
        caption: joinCaption(w.gym),
    };
}

function wednesday(w, seed) {
    const g = w.gym.name;
    const top = w.board;
    if (top.length >= MIN_ON_BOARD) {
        const shown = Math.min(5, top.length);
        const board = templateById('results').fill.board({ gym: g, week: w.label, standings: top.slice(0, shown) });
        const list = top.slice(0, shown).map((r, i) => `${i + 1}. ${r.name} · ${thousands(r.points)} POWR`).join('\n');
        return {
            stem: 'board', label: 'The board', template: 'results',
            fields: words('results', { ...board, title: pick([`Gym\nfloor top ${shown}`, `Midweek\ntop ${shown}`], seed), line: `Top ${COUNT[shown]}, ${w.label}.` }),
            caption: `Midweek at ${g}. The top ${COUNT[shown]} so far:\n\n${list}\n\nEvery session here counts. Check in with POWR and get on the board.`,
        };
    }
    // One or two on it: nobody can say the top spot is open, so ask for names.
    const open = top.length === 0 && seed % 2 === 0;
    return {
        stem: 'board', label: 'The board', template: 'dots',
        fields: words('dots', { headline: open ? 'Top\nspot’s\nopen.' : 'Your\nname\nhere.', note: g }),
        caption: open
            ? `Halfway through the week and the top of the board at ${g} is anyone’s. Check in with POWR and it could be you.`
            : `The board at ${g} has room at the top. Check in with POWR and get your name on it.`,
    };
}

function thursday(w, seed) {
    const g = w.gym.name;
    const top = w.board;
    if (top.length >= 2) {
        const [lead] = top;
        return {
            stem: 'leader', label: 'Top of the board', template: 'editorial',
            fields: words('editorial', {
                tag: 'This week',
                headline: `${lead.name}\n{leads}.`,
                line: pick([`${thousands(lead.points)} POWR at ${g} so far this week.`, `${thousands(lead.points)} POWR and counting at ${g}.`], seed),
                footer: 'Train · Earn · Repeat',
            }),
            caption: `${lead.name} leads the board at ${g} with ${thousands(lead.points)} POWR this week. Three days left to catch them.`,
        };
    }
    return pick([
        {
            stem: 'show-up', label: 'Show up', template: 'editorial',
            fields: words('editorial', { tag: 'Thursday', headline: 'Show up.\n{Check in}.', line: `Every session at ${g} counts toward the board.`, footer: 'Train · Earn · Repeat' }),
            caption: `Show up, check in. Every session at ${g} counts toward the board on POWR.`,
        },
        {
            stem: 'show-up', label: 'Every session', template: 'editorial',
            fields: words('editorial', { tag: 'Thursday', headline: 'Every session\nleaves a {mark}.', line: `${g}, this week and every week.`, footer: 'Train · Earn · Repeat' }),
            caption: `Every session leaves a mark. Check in at ${g} with POWR and it counts.`,
        },
    ], seed);
}

function friday(w, seed) {
    const g = w.gym.name;
    const l = w.league;
    if (l && l.rival && l.count >= 2) {
        const race = l.ahead
            ? (l.gap > 0 ? `${thousands(l.gap)} POWR clear of ${l.rival.name}.` : `Level with ${l.rival.name}.`)
            : `${thousands(l.gap)} POWR behind ${l.rival.name}. Every session counts.`;
        return {
            stem: 'league', label: 'Gym League', template: 'club',
            fields: words('club', {
                headline: ORD(l.rank),
                left: 'In the\nGym\nLeague',
                right: `Of ${l.count}\nwithin\n${l.radiusKm} km`,
                line: race,
                signoff: l.rank === 1 ? 'Top of the league.' : 'Earned, not given.',
            }),
            caption: `${g} is ${ORD(l.rank)} of ${l.count} gyms within ${l.radiusKm} km in the Gym League this week. ${race} The weekend decides it: check in with POWR and your sessions count for us.`,
        };
    }
    return {
        stem: 'weekend', label: 'The weekend', template: 'club',
        fields: words('club', {
            headline: pick(['Week\nend', 'Two\ndays'], seed),
            left: 'Board\nresets\nMonday',
            right: 'Every\nsession\ncounts',
            line: `The weekend at ${g} counts as much as the week.`,
            signoff: 'Earned, not given.',
        }),
        caption: `The board at ${g} resets on Monday. Every session this weekend counts: check in with POWR.`,
    };
}

function saturday(w, seed) {
    const g = w.gym.name;
    const asset = w.eventPhoto ?? w.photo;
    const r = w.results;
    if (r?.standings?.length) {
        const podium = r.standings.slice(0, 3).map((s, i) => `${['1st', '2nd', '3rd'][i]} ${s.name} · ${thousands(s.points)} POWR`).join('\n');
        return {
            stem: 'results', label: 'Results', template: 'results', asset,
            fields: wordsFor('results', r),
            caption: `The results are in. ${r.standings[0].name} took ${r.name} at ${g} with ${thousands(r.standings[0].points)} POWR.\n\n${podium}\n\nThanks to everyone who showed up.`,
        };
    }
    if (w.next) {
        return {
            stem: 'event', label: w.next.name, template: 'ticket', asset,
            fields: wordsFor('ticket', w.next),
            caption: `${w.next.name} at ${g}. Every verified workout counts, and the board runs itself in the POWR app. Join here: ${w.next.joinUrl}`,
        };
    }
    return pick([
        {
            stem: 'weekend', label: 'Weekend', template: 'manifesto',
            fields: words('manifesto', { headline: 'It was never\njust the\nworkout.', flow: 'Body\nMind\nStreak\nBody' }),
            caption: `It was never just the workout. Every session at ${g} counts on POWR, weekends included.`,
        },
        {
            stem: 'weekend', label: 'Weekend', template: 'manifesto',
            fields: words('manifesto', { headline: 'From the\nfirst rep\nto forever.', flow: 'Show up\nCheck in\nEarn\nRepeat' }),
            caption: `From the first rep to forever. Show up, check in, earn, repeat: every session at ${g} counts on POWR.`,
        },
    ], seed);
}

function sunday(w, seed) {
    const g = w.gym.name;
    const code = String(w.code ?? '').replace(/\D/g, '').slice(0, 12);
    return pick([
        {
            stem: 'every-move', label: 'Every move', template: 'bleed',
            fields: words('bleed', { headline: 'Every\nmove', caption: 'Counts.\nEarned,\nnot given.', credit: g }),
            caption: `Every move counts. Earned, not given. See you at ${g} this week.`,
        },
        {
            stem: 'every-move', label: 'Every move', template: 'barcode',
            fields: words('barcode', { title: 'Every move counts', line: 'Gym Run Walk Ride', body: `Every session at ${g}, and every run, walk and ride: rewarded on POWR.`, code }),
            caption: `Every move counts. Every session at ${g}, and every run, walk and ride, earns on POWR.`,
        },
        {
            stem: 'every-move', label: 'The streak', template: 'bleed',
            fields: words('bleed', { headline: 'Show\nup', caption: 'The streak\nis yours.', credit: g }),
            caption: `The streak is yours. Show up at ${g} this week and keep it going on POWR.`,
        },
        {
            stem: 'every-move', label: 'Earned', template: 'barcode',
            fields: words('barcode', { title: 'Earned, not given', line: 'Show up · Check in · Earn · Repeat', body: `Every session at ${g} builds toward something real. The streak matters.`, code }),
            caption: `Earned, not given. Every session at ${g} builds toward something real on POWR.`,
        },
    ], seed);
}

const SLOTS = [monday, tuesday, wednesday, thursday, friday, saturday, sunday];

// ── The week's colour ──────────────────────────────────────────────────────
// Every template grades its photo to black-and-white film unless told
// otherwise, so a week left to the defaults comes out monochrome. The week
// has a rhythm instead: mostly the photo in colour (warm, as shot, cool),
// one black-and-white day and one gold day, turning a day on every Monday so
// Tuesday isn't always the same. "Colour" keeps every day in colour; "Film"
// is the house black and white throughout.
// A full duotone replaces the photo's colour, so the colour days take a
// light cast (tintAmount) over a little extra saturation (mono below 0).
const GRADES = {
    warm:   { mono: -0.15, tint: 'warm', tintAmount: 0.3 },
    colour: { mono: -0.25, tint: 'none' },
    cool:   { mono: -0.15, tint: 'cool', tintAmount: 0.3 },
    film:   { mono: 1, tint: 'none' },
    gold:   { mono: 1, tint: 'gold' },
};
const RHYTHM = ['warm', 'colour', 'film', 'cool', 'gold', 'colour', 'warm'];
const COLOURS = ['warm', 'colour', 'cool'];
export const WEEK_LOOKS = [
    { id: 'mixed',  label: 'Mixed',  blurb: 'colour most days, a black-and-white day and a gold day' },
    { id: 'colour', label: 'Colour', blurb: 'your photo in colour every day' },
    { id: 'film',   label: 'Film',   blurb: 'black and white, the house look' },
];
// Templates that set their type in the accent colour: gold type vanishes on
// the gold duotone, so they take cool colour that day instead.
const ACCENT_TYPE = new Set(['barcode']);

/** The grade and colourway for day `day` (0 = Monday) of the week `seed`. */
export function weekTreatment(look, day, seed, template) {
    let grade = look === 'film' ? 'film' : look === 'colour' ? COLOURS[(day + seed) % COLOURS.length] : RHYTHM[(day + seed) % RHYTHM.length];
    if (grade === 'gold' && ACCENT_TYPE.has(template)) grade = 'cool';
    return { look: { ...GRADES[grade] }, grade, style: { colourway: (day + seed) % 2 ? 'gold' : 'powr', headlineFont: '' } };
}

/**
 * The seven posts. `week`:
 *   gym        { partner_id, name, address, lat, lng }
 *   photo      the gym's picture as a kit asset, or null (type on black)
 *   eventPhoto the event's own picture, for the event post, or null
 *   seed       weekSeed(week start): turns the set over every Monday
 *   label      "21–27 Sep"; lastLabel "14–20 Sep"; days ["Mon 21", …]
 *   last       last week, complete: { sessions, athletes, newFaces }
 *   board      this week's board [{ name, points }], names already shortened
 *   league     { rank, count, radiusKm, rival: { name } | null, ahead, gap } | null
 *   next       eventFacts of the next published event, or null
 *   results    eventFacts of an event revealed in the last fortnight, with standings, or null
 *   code       digits for the barcode (the week's Monday, YYYYMMDD)
 * Returns kit jobs, every size of a post sharing a stem, each with `day`
 * (0 = Monday), `dayLabel`, `caption` and `free` (downloads on any package).
 */
export function planWeekKit(week, { look = 'mixed' } = {}) {
    const w = { ...week, board: (week.board ?? []).filter((r) => r.points > 0) };
    const seed = week.seed ?? 0;
    const tags = `#POWR #${tagOf(week.gym.name) || 'gym'}`;
    const jobs = [];
    SLOTS.forEach((slot, day) => {
        const p = slot(w, seed + day);
        const tr = weekTreatment(look, day, seed, p.template);
        const stem = `${day + 1}-${p.stem}`;
        for (const format of WEEK_FORMATS) {
            const folder = FOLDER[format];
            // JPEG: over a photo a PNG runs to 2–5 MB, and the week's ZIP to 60.
            const file = `${day + 1}-${DAY_NAMES[day].toLowerCase()}-${p.stem}.jpg`;
            jobs.push({
                id: `${folder}/${file}`, label: p.label, template: p.template, format, kind: 'jpg', folder, file, stem,
                fields: p.fields, asset: p.asset === undefined ? (week.photo ?? null) : p.asset,
                look: tr.look, grade: tr.grade, style: tr.style, free: !!p.free,
                day, dayLabel: week.days?.[day] ?? DAY_NAMES[day].slice(0, 3), caption: p.caption,
                // What to paste with it: the caption and the tags (the join caption carries its own).
                share: p.template === 'ticket' && p.free ? p.caption : `${p.caption}\n\n${tags}`,
            });
        }
    });
    return jobs;
}

/** The words to paste, one block per day. */
export function weekCaptions(week, jobs) {
    return jobs.filter((j) => j.format === 'post').map((j) => {
        const h = `${DAY_NAMES[j.day]} · ${j.label}`;
        return `${h}\n${'─'.repeat(Math.min(60, h.length + 8))}\n${wrapParagraphs(j.share, 90)}\n`;
    }).join('\n');
}

function readme(week) {
    return [
        `${week.gym.name}: posts for ${week.label}, one a day`,
        `Made with POWR on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}. A new set every Monday.`,
        '',
        'One folder per size. The files are numbered by day: 1 is Monday, 7 is Sunday.',
        `  ${FOLDER.post}: Instagram and Facebook feed (1080×1350).`,
        `  ${FOLDER.story}: Stories, and Reels covers (1080×1920).`,
        `  ${FOLDER.square}: profile grids and WhatsApp (1080×1080).`,
        '',
        'captions.txt has the words to paste with each day’s post.',
        'Names are first name and initial, as on your gym’s screen. Members who hide from leaderboards are never on them.',
        '',
    ].join('\n');
}

/** Every post at every size, zipped. Resolves with { blob, names }. */
export function buildWeekKit({ week, jobs, onProgress, signal, mediaCache }) {
    return buildKit({
        phase: 'week', facts: { name: `${week.gym.name} this week`, venue: week.gym.name }, jobs, onProgress, signal, mediaCache,
        captions: weekCaptions(week, jobs), readme: readme(week),
    });
}
