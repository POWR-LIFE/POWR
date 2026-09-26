/**
 * The week's posts, for a gym's Overview: made from its own numbers and its
 * own photo (the one on its POWR listing), no editor. The last event's
 * results or the next one's ticket, this week's board, who leads it, the week
 * in numbers, the Gym League, the join poster, and one to keep the feed going.
 * Each at Post, Story and Square, in one ZIP with the captions to paste.
 *
 * A post only joins when the week can carry it: no board of one, no "4
 * sessions this week" for the world to see.
 */
import { buildKit, treatmentFor, wordsFor } from './kit';
import { joinFields, joinCaption } from './joinKit';
import { fieldDefaults } from './render';
import { templateById } from './templates';
import { thousands, wrapParagraphs } from './words';

export const WEEK_FORMATS = ['post', 'story', 'square'];
const FOLDER = { post: '01 Post 4x5', story: '02 Story 9x16', square: '03 Square 1x1' };

// A number worth posting: below this a week reads as quiet, not busy.
export const MIN_SESSIONS = 10;
export const MIN_ON_BOARD = 3;

const plural = (n, one, many) => `${thousands(n)} ${n === 1 ? one : many}`;
// A template's own words underneath, so a field left out never draws blank.
const words = (id, fields) => ({ ...fieldDefaults(templateById(id)), ...fields });
const tagOf = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const ORD = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/**
 * Which week the numbers post talks about: this one once it's under way
 * (Wednesday on) and busy enough, else last week, complete, if that was.
 * `now`/`last`: { sessions, athletes, newFaces }; `dayIndex`: 0 = Monday.
 */
export function numbersWeek({ now, last, dayIndex }) {
    if (now && dayIndex >= 2 && now.sessions >= MIN_SESSIONS) return { ...now, when: 'this week', so: 'so far' };
    if (last && last.sessions >= MIN_SESSIONS) return { ...last, when: 'last week', so: '' };
    return null;
}

/**
 * The posts. `week`:
 *   gym      { partner_id, name, address, lat, lng }
 *   photo    the gym's picture as a kit asset, or null (type on black)
 *   eventPhoto  the event's own picture (results or ticket), or null for the gym's
 *   label    "21–27 Sep", this week's dates
 *   now/last { sessions, athletes, newFaces }, dayIndex (0 = Monday)
 *   top      this week's board [{ name, points }], names already shortened
 *   league   { rank, count, radiusKm, rival: { name } | null, ahead, gap } | null
 *   next     eventFacts of the next published event, or null
 *   results  eventFacts of an event revealed in the last fortnight, with standings, or null
 * Returns kit jobs ({ id, label, template, format, kind, folder, file, stem,
 * fields, asset, look, style, free }), every size of a post sharing a stem.
 * `free`: downloadable on any package (the join poster).
 */
export function planWeekKit(week, options = { look: 'mixed', accent: 'vary' }) {
    const { gym, photo = null } = week;
    const jobs = [];
    let n = 0;
    const post = (stem, label, template, fields, { look = {}, free = false, asset = photo } = {}) => {
        const tr = treatmentFor(options, n++, template);
        for (const format of WEEK_FORMATS) {
            const folder = FOLDER[format];
            // JPEG: over a photo a PNG runs to 2–5 MB, and the week's ZIP to 60.
            const file = `${String(n).padStart(2, '0')}-${stem}.jpg`;
            jobs.push({
                id: `${folder}/${file}`, label, template, format, kind: 'jpg', folder, file, stem, fields, asset,
                look: { ...tr.look, ...look }, style: tr.style, free,
            });
        }
    };

    // 1. The last event's results, while they're news; else the next event's
    //    ticket. Over the event's own picture when it has one.
    const eventAsset = week.eventPhoto ?? photo;
    if (week.results?.standings?.length) {
        post('results', 'Results', 'results', wordsFor('results', week.results), { asset: eventAsset });
    } else if (week.next) {
        post('event', week.next.name, 'ticket', wordsFor('ticket', week.next), { asset: eventAsset });
    }

    // 2. This week's board, as the gym's own screen shows it.
    const top = (week.top ?? []).filter((r) => r.points > 0);
    if (top.length >= MIN_ON_BOARD) {
        const shown = Math.min(5, top.length);
        const board = templateById('results').fill.board({ gym: gym.name, week: week.label, standings: top.slice(0, shown) });
        post('board', 'The board', 'results', words('results', {
            ...board, title: `Gym\nfloor top ${shown}`, line: `Top ${['', '', '', 'three', 'four', 'five'][shown]}, ${week.label}.`,
        }));
    }

    // 3. Who leads it.
    if (top.length >= 2) {
        const [lead] = top;
        post('leader', 'Top of the board', 'editorial', words('editorial', {
            tag: 'This week',
            headline: `${lead.name}\n{leads}.`,
            line: `${thousands(lead.points)} POWR at ${gym.name} so far this week.`,
            footer: 'Train · Earn · Repeat',
        }));
    }

    // 4. The week in numbers.
    const nums = numbersWeek(week);
    if (nums) {
        post('numbers', nums.when === 'this week' ? 'This week' : 'Last week', 'grid', words('grid', {
            headline: `${thousands(nums.sessions)}\n_sessions_\n${nums.so || nums.when}`,
            kicker: `${plural(nums.athletes, 'person', 'people')}\ntrained here`,
            footer: nums.newFaces > 0 ? `${plural(nums.newFaces, 'first-timer', 'first-timers')}.\nWelcome.` : 'Every session\ncounts.',
            date: week.label,
        }));
    }

    // 5. The Gym League.
    const l = week.league;
    if (l && l.rival && l.count >= 2) {
        post('league', 'Gym League', 'club', words('club', {
            headline: ORD(l.rank),
            left: 'In the\nGym\nLeague',
            right: `Of ${l.count}\nwithin\n${l.radiusKm} km`,
            line: l.ahead
                ? (l.gap > 0 ? `${thousands(l.gap)} POWR clear of ${l.rival.name}.` : `Level with ${l.rival.name}.`)
                : `${thousands(l.gap)} POWR behind ${l.rival.name}. Every session counts.`,
            signoff: l.rank === 1 ? 'Top of the league.' : 'Earned, not given.',
        }));
    }

    // 6. The join poster: gets members onto POWR, so it's on every package.
    post('join', 'Join poster', 'ticket', joinFields(gym), { free: true, asset: null });

    // 7. One for the feed, any week.
    post('every-move', 'Every move', 'dots', words('dots', { headline: 'Every\nmove\ncounts.', note: gym.name }));

    return jobs;
}

/** The words to paste, one block per post. */
export function weekCaptions(week, jobs) {
    const { gym } = week;
    const tags = `#POWR #${tagOf(gym.name) || 'gym'}`;
    const has = (stem) => jobs.some((j) => j.stem === stem);
    const blocks = [];
    const top = (week.top ?? []).filter((r) => r.points > 0);
    if (has('results')) {
        const r = week.results;
        const podium = r.standings.slice(0, 3).map((s, i) => `${['1st', '2nd', '3rd'][i]} ${s.name} · ${thousands(s.points)} POWR`).join('\n');
        blocks.push(['Results', `The results are in. ${r.standings[0].name} took ${r.name} at ${gym.name} with ${thousands(r.standings[0].points)} POWR.\n\n${podium}\n\nThanks to everyone who showed up.\n\n${tags}`]);
    }
    if (has('event')) {
        blocks.push([week.next.name, `${week.next.name} at ${gym.name}. Every verified workout counts, and the board runs itself in the POWR app. Join here: ${week.next.joinUrl}\n\n${tags}`]);
    }
    if (has('board')) {
        const list = top.slice(0, 5).map((r, i) => `${i + 1}. ${r.name} · ${thousands(r.points)} POWR`).join('\n');
        blocks.push(['The board', `This week’s top ${['', '', '', 'three', 'four', 'five'][Math.min(5, top.length)]} at ${gym.name}:\n\n${list}\n\nEvery session here counts. Check in with POWR and get on the board.\n\n${tags}`]);
    }
    if (has('leader')) {
        blocks.push(['Top of the board', `${top[0].name} leads the board at ${gym.name} with ${thousands(top[0].points)} POWR this week. The week’s not over.\n\n${tags}`]);
    }
    if (has('numbers')) {
        const nums = numbersWeek(week);
        blocks.push([nums.when === 'this week' ? 'This week' : 'Last week',
            `${thousands(nums.sessions)} sessions at ${gym.name} ${nums.when}${nums.so ? ' so far' : ''}, from ${plural(nums.athletes, 'person', 'people')}${nums.newFaces > 0 ? `, ${plural(nums.newFaces, 'of them', 'of them')} here for the first time` : ''}. Thanks for showing up.\n\n${tags}`]);
    }
    if (has('league')) {
        const l = week.league;
        const race = l.ahead ? (l.gap > 0 ? ` ${thousands(l.gap)} POWR clear of ${l.rival.name}.` : ` Level with ${l.rival.name}.`) : ` ${thousands(l.gap)} POWR behind ${l.rival.name}, and every session counts.`;
        blocks.push(['Gym League', `${gym.name} is ${ORD(l.rank)} of ${l.count} gyms within ${l.radiusKm} km in the Gym League this week.${race} Check in with POWR and your sessions count for us.\n\n${tags}`]);
    }
    blocks.push(['Join poster', joinCaption(gym)]);
    blocks.push(['Every move', `Every move counts at ${gym.name}. Check in with POWR and every session earns.\n\n${tags}`]);
    return blocks.map(([h, body]) => `${h}\n${'─'.repeat(Math.min(60, h.length + 8))}\n${wrapParagraphs(body, 90)}\n`).join('\n');
}

function readme(week) {
    return [
        `${week.gym.name}: posts for ${week.label}`,
        `Made with POWR on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, from this week’s numbers.`,
        '',
        'One folder per size. The same file name in each folder is the same post at that size.',
        `  ${FOLDER.post}: Instagram and Facebook feed (1080×1350).`,
        `  ${FOLDER.story}: Stories, and Reels covers (1080×1920).`,
        `  ${FOLDER.square}: profile grids and WhatsApp (1080×1080).`,
        '',
        'captions.txt has the words to paste with each post.',
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
