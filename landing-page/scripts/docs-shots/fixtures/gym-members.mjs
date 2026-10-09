// Members and Retention at Northpoint Strength: the members who share all
// their training with the gym (gym_member_people, Clash Pro) and Retention
// (gym_retention and its reach-out log). Agrees with gym-core: 142 members,
// 23 of them share, 7 drifting and 11 slipping from their usual visits, and
// the dry-run nudge reaches 6 of the 7 (one was nudged inside the fortnight).
//
// Retention is worked out here exactly as the SQL does it
// (_gym_retention_people, migration 20261007120000): each person gets a
// made-up history of visit days, and their usual gap, thresholds, pattern and
// status are computed from it, so every row reads the way the real page would.
// Nobody is ever "location off" or "while using": the page's wording for those
// isn't for the public guides.
import { OWNER, PEOPLE } from '../world.mjs';
import { DRIFTING, MEMBERS, SLIPPING } from './gym-core.mjs';

// ── The gym's calendar (Europe/London) ─────────────────────────────────────
const TZ = 'Europe/London';
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const diff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
const isoDow = (iso) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;    // 1 = Monday
const AS_OF = ymd(new Date());
const MONDAY = addDays(AS_OF, -(isoDow(AS_OF) - 1));
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgoAt = (n, hh) => { const d = new Date(Date.now() - n * 864e5); d.setHours(hh, 12, 0, 0); return d.toISOString(); };

// A small seeded generator, so every run draws the same histories.
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Who's in Retention ─────────────────────────────────────────────────────
// PEOPLE 0–24 are this week's board (in this week, on track); 25–29 regulars
// not on it (Arlo M. and Cal R. are on the live event's board, so they were in
// within ten days); 30–33 this week's new faces. Everyone else in the gym's
// Retention list comes from EXTRA: still made up, never on a board or a screen.
const FIRST = [
    'Aaron', 'Abby', 'Adam', 'Aimee', 'Alfie', 'Alice', 'Amir', 'Anna', 'Asha', 'Ava', 'Beth', 'Billy', 'Caleb', 'Cara',
    'Carl', 'Ciara', 'Dan', 'Daisy', 'Dylan', 'Eden', 'Elsie', 'Emil', 'Erin', 'Evan', 'Faye', 'Felix', 'Freya', 'Gabe',
    'Gemma', 'Harry', 'Hollie', 'Ian', 'Imogen', 'Iris', 'Jack', 'Jess', 'Joel', 'Kai', 'Kara', 'Kieran', 'Laila', 'Liam',
    'Lola', 'Luca', 'Luke', 'Mae', 'Marcus', 'Mia', 'Nadia', 'Nathan', 'Noah', 'Olly', 'Omar', 'Paige', 'Reece', 'Rhys',
    'Ruby', 'Ryan', 'Sara', 'Seb', 'Sophie', 'Theo', 'Toby', 'Uma', 'Wren', 'Yara', 'Zak', 'Owen', 'Hugo', 'Esme',
];
const INITIAL = 'ABCDEFGHJKLMNPRSTW';
const EXTRA = Array.from({ length: 138 }, (_, i) => {
    const first = FIRST[(i * 11) % FIRST.length];
    const display = `${first} ${INITIAL[(i * 5 + Math.floor(i / FIRST.length)) % INITIAL.length]}.`;
    return {
        id: `6f1d2c3b-0000-4000-8000-${String(5000 + i).padStart(12, '0')}`,
        name: display,
        username: `${first.toLowerCase()}${(i * 13) % 97 + 3}`,
        powr_id: `PWR${String(61307 + i * 41).slice(-5)}`,
    };
});
const person = (ref) => (typeof ref === 'number' ? PEOPLE[ref] : EXTRA[ref.x]);

// A history: visit days on `dows` (ISO weekdays), from `from` days ago up to
// the last visit `gap` days ago, skipping some weeks' sessions (`skip`).
function history({ dows, gap, from = 150, skip = 0.12, seed, extra = [] }) {
    const r = rng(seed);
    const last = addDays(AS_OF, -gap);
    const out = new Set([last, ...extra.map((n) => addDays(AS_OF, -n))]);
    for (let n = from; n > gap; n--) {
        const d = addDays(AS_OF, -n);
        if (dows.includes(isoDow(d)) && r() > skip) out.add(d);
    }
    return [...out].filter((d) => d <= last).sort();
}

// The SQL's own sums on a history (base = the 84 days up to the last visit).
function measure(days) {
    if (!days.length) return { status: 'unseen', first_visit: null, last_visit: null, gap_days: null, visit_days: 0, recent_28: 0, prev_56: 0, visits: [] };
    const first = days[0];
    const last = days[days.length - 1];
    const base = days.filter((d) => d > addDays(last, -84));
    const gaps = base.slice(1).map((d, i) => diff(d, base[i])).sort((a, b) => a - b);
    let p75 = null;
    if (gaps.length) {
        const pos = 0.75 * (gaps.length - 1);
        const lo = Math.floor(pos);
        p75 = gaps[lo] + (gaps[Math.min(lo + 1, gaps.length - 1)] - gaps[lo]) * (pos - lo);
    }
    const n = base.length;
    const spanned = diff(base[n - 1], base[0]) + 1;
    const driftAfter = Math.max(7, Math.min(28, Math.ceil(2.5 * (p75 ?? 7))));
    const slipAfter = Math.max(4, Math.min(driftAfter - 1, Math.ceil(1.5 * (p75 ?? 7))));
    const gap = diff(AS_OF, last);
    const recent = days.filter((d) => d > addDays(AS_OF, -28)).length;
    const prev = days.filter((d) => d <= addDays(AS_OF, -28) && d > addDays(AS_OF, -84)).length;
    // Their weekdays: each at least twice and a fifth of visits; shown when four or fewer cover 60%.
    const counts = {};
    for (const d of base) counts[isoDow(d)] = (counts[isoDow(d)] ?? 0) + 1;
    const dowList = Object.entries(counts).filter(([, c]) => c >= 2 && c >= 0.2 * n).map(([k]) => Number(k)).sort();
    const covered = dowList.reduce((s, k) => s + counts[k], 0);
    const status = n < 4 && first > addDays(AS_OF, -28) ? 'new'
        : n < 4 ? 'occasional'
            : gap > 60 ? 'lapsed'
                : gap >= driftAfter ? 'drifting'
                    : gap >= slipAfter ? 'slipping'
                        : prev >= 6 && recent * 4 < prev ? 'slipping'
                            : 'regular';
    return {
        status,
        first_visit: first,
        last_visit: last,
        gap_days: gap,
        visit_days: n,
        per_week: n >= 4 ? Math.round((n * 7 / Math.max(spanned, 28)) * 10) / 10 : null,
        usual_gap: n >= 4 && p75 != null ? Math.round(p75 * 10) / 10 : null,
        slip_after: n >= 4 ? slipAfter : null,
        drift_after: n >= 4 ? driftAfter : null,
        recent_28: recent,
        prev_56: prev,
        dows: dowList.length && dowList.length <= 4 && covered >= 0.6 * n ? dowList : null,
        visits: days.filter((d) => d > addDays(AS_OF, -84)),
    };
}

// Reach-outs, newest first. by = who on the team logged it.
let outreachN = 0;
const reach = (daysAgo, channel, note, by = OWNER.name) => ({
    id: `6f1d2c3b-0000-4000-8000-0000000c${String(++outreachN).padStart(4, '0')}`,
    // Whole days ago at any time of day, so the row always says "2 days ago".
    at: hoursAgo(daysAgo * 24 + (channel === 'push' ? 3 : 2)), channel, note, by, mine: by === OWNER.name,
});

const MWF = [1, 3, 5];
const TT = [2, 4];
const MT = [1, 4];
// [who, status wanted, history, extras]. The status is checked against the rule below.
const SPEC = [
    // Drifting (7). Zoe V. is the row the guide opens.
    [25, 'drifting', { dows: MWF, gap: 19, seed: 25 }, { part: 'evening', shares: true, outreach: [reach(2, 'call', 'Left a voicemail. She mentioned a sore knee last month, so asked how it’s going.')] }],
    [27, 'drifting', { dows: TT, gap: 16, seed: 27 }, { part: 'morning', shares: true, outreach: [reach(1, 'text', 'Sent the new 7am class times.', 'Jordan Hale')] }],
    [{ x: 0 }, 'drifting', { dows: [6], gap: 26, seed: 100, skip: 0.05 }, { part: 'morning' }],
    [{ x: 1 }, 'drifting', { dows: MT, gap: 22, seed: 101 }, { part: 'evening', nudged: 5, outreach: [reach(5, 'push', null)] }],
    [29, 'drifting', { dows: [1, 2, 3, 4, 5, 6], gap: 9, seed: 29, skip: 0.2 }, { part: 'morning', shares: true }],
    [{ x: 2 }, 'drifting', { dows: TT, gap: 13, seed: 102 }, { part: 'evening', member: false }],
    [{ x: 3 }, 'drifting', { dows: [1, 3, 6], gap: 11, seed: 103 }, {}],
    // Slipping (11).
    [26, 'slipping', { dows: [1, 2, 4, 5], gap: 6, seed: 26, extra: [] }, { part: 'evening', shares: true }],
    [28, 'slipping', { dows: MWF, gap: 6, seed: 28 }, { part: 'evening', shares: true }],
    [{ x: 4 }, 'slipping', { dows: TT, gap: 7, seed: 104 }, { part: 'morning' }],
    [{ x: 5 }, 'slipping', { dows: MWF, gap: 5, seed: 105 }, { part: 'midday', outreach: [reach(3, 'in_person', 'Caught up at the desk. Busy month at work, back next week.')] }],
    [{ x: 6 }, 'slipping', { dows: [6], gap: 13, seed: 106, skip: 0.05 }, { part: 'morning' }],
    [{ x: 7 }, 'slipping', { dows: MT, gap: 7, seed: 107 }, {}],
    [{ x: 8 }, 'slipping', { dows: [2, 4, 6], gap: 6, seed: 108 }, { part: 'evening' }],
    [{ x: 9 }, 'slipping', { dows: [3, 7], gap: 8, seed: 109 }, { member: false }],
    [{ x: 10 }, 'slipping', { dows: MWF, gap: 5, seed: 110 }, { part: 'morning' }],
    [{ x: 11 }, 'slipping', { dows: TT, gap: 8, seed: 111 }, {}],
    [{ x: 12 }, 'slipping', { dows: [1, 2, 3, 4], gap: 5, seed: 112 }, { part: 'evening' }],
    // Can't see (2): drifting by the rule, but POWR hasn't heard from their phone.
    [{ x: 13 }, 'drifting', { dows: MWF, gap: 12, seed: 113 }, { signal: 'no_signal' }],
    [{ x: 14 }, 'slipping', { dows: TT, gap: 7, seed: 114 }, { signal: 'no_signal' }],
];
// On track (61): this week's board, then 36 more who were in lately.
for (let i = 0; i <= 24; i++) {
    const gap = [0, 1, 0, 2, 1, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 0, 2, 1, 2, 0, 1, 2, 1, 0][i];
    const dows = [[1, 2, 3, 4, 5], MWF, [1, 2, 3, 4, 5, 6], [1, 2, 4, 5], [1, 3, 4]][i % 5];
    SPEC.push([i, 'regular', { dows: [...new Set([...dows, isoDow(addDays(AS_OF, -gap))])].sort(), gap, seed: 300 + i, skip: 0.08 }, { part: ['evening', 'morning', null, 'evening', 'midday'][i % 5], shares: [0, 1, 2, 3, 5, 7, 8, 9, 11, 12, 13, 14, 16, 18, 19, 22].includes(i) }]);
}
for (let k = 0; k < 36; k++) {
    const gap = k % 4;
    const dows = [[1, 3, 5], [2, 4, 6], [1, 2, 4], [1, 3, 5, 7], [2, 4]][k % 5];
    SPEC.push([{ x: 20 + k }, 'regular', { dows: [...new Set([...dows, isoDow(addDays(AS_OF, -gap))])].sort(), gap, seed: 400 + k, skip: 0.1 }, { part: [null, 'evening', 'morning'][k % 3], member: k < 34 }]);
}
// New (9): this week's four new faces, and five more in the last four weeks.
for (const [i, n] of [[30, 3], [31, 2], [32, 1], [33, 0]]) SPEC.push([i, 'new', { dows: [], gap: n, seed: 500 + i, from: n, extra: n > 1 ? [n - 1] : [] }, {}]);
for (let k = 0; k < 5; k++) SPEC.push([{ x: 60 + k }, 'new', { dows: [], gap: 2 + k * 3, seed: 600 + k, from: 0, extra: k % 2 ? [6 + k * 3] : [] }, { member: k !== 4 }]);
// Lapsed (23): a pattern once, nothing for more than 60 days.
for (let k = 0; k < 23; k++) SPEC.push([{ x: 70 + k }, 'lapsed', { dows: [[1, 3], [2, 4, 6], [1, 5]][k % 3], gap: 62 + k * 2, from: 178, seed: 700 + k }, { member: k > 2 }]);
// Occasional (17): now and then, too few visits for a pattern.
for (let k = 0; k < 17; k++) SPEC.push([{ x: 93 + k }, 'occasional', { dows: [], gap: 9 + k * 5, seed: 800 + k, from: 0, extra: [30 + k * 6, 70 + k * 3].filter((n) => n > 9 + k * 5 && n < 170) }, { member: k > 7 }]);
// Not seen here yet (28): picked Northpoint in the app, no visit yet.
const UNSEEN = Array.from({ length: 28 }, (_, k) => EXTRA[110 + k]);

const RETENTION_PEOPLE = [];
for (const [ref, want, hist, more] of SPEC) {
    const p = person(ref);
    // The gap asked for, or the nearest one that lands in the wanted status
    // (their usual gap moves a little with the skipped sessions).
    // A last visit on one of their usual days reads truer, so those gaps go first.
    const near = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, 7, 8, 9, 10].map((d) => hist.gap + d).filter((g) => g >= 0 && g < 120);
    const onDay = (g) => !hist.dows.length || hist.dows.includes(isoDow(addDays(AS_OF, -g)));
    const tries = [...near.filter(onDay), ...near.filter((g) => !onDay(g))];
    // Never throws: a fixture that fails to import is skipped, and every gym shot with it.
    let m = tries.map((gap) => measure(history({ ...hist, gap }))).find((r) => r.status === want);
    if (!m) {
        m = measure(history(hist));
        console.warn(`  ! gym-members: no gap near ${hist.gap} makes ${p.name} ${want} today (${m.status})`);
    }
    RETENTION_PEOPLE.push({
        user_id: p.id,
        display_name: p.name,
        username: p.username ?? null,
        avatar_url: null,
        member_id: p.powr_id,
        is_member: more.member ?? true,
        status: m.status,
        signal: more.signal ?? 'ok',
        location: null,
        ...m,
        part: m.visit_days >= 3 ? (more.part ?? null) : null,
        shares_all: !!more.shares,
        // The morning the daily check first saw them drifting: their last visit plus their drifting-after.
        drifting_since: m.status === 'drifting' && (more.signal ?? 'ok') === 'ok' ? addDays(m.last_visit, m.drift_after) : null,
        nudged_at: more.nudged != null ? hoursAgo(more.nudged * 24 + 3) : null,
        outreach: more.outreach ?? [],
    });
}
for (const p of UNSEEN) {
    RETENTION_PEOPLE.push({
        user_id: p.id, display_name: p.name, username: p.username, avatar_url: null, member_id: p.powr_id,
        is_member: true, signal: 'ok', location: null, ...measure([]), per_week: null, usual_gap: null, slip_after: null,
        drift_after: null, part: null, dows: null, shares_all: false, drifting_since: null, nudged_at: null, outreach: [],
    });
}
// The SQL's order: drifting, slipping, lapsed, new, on track, occasional, can't see, not seen; furthest past their usual first.
const RANK = { drifting: 0, slipping: 1, lapsed: 2, new: 3, regular: 4, occasional: 5, unseen: 7 };
const rank = (p) => (['slipping', 'drifting', 'lapsed'].includes(p.status) && p.signal !== 'ok' ? 6 : RANK[p.status]);
RETENTION_PEOPLE.sort((a, b) => rank(a) - rank(b)
    || ((b.drift_after ? b.gap_days / b.drift_after : -1) - (a.drift_after ? a.gap_days / a.drift_after : -1))
    || String(b.last_visit ?? '').localeCompare(String(a.last_visit ?? '')));

const ok = (s) => RETENTION_PEOPLE.filter((p) => p.status === s && p.signal === 'ok').length;
const COUNTS = {
    population: RETENTION_PEOPLE.length,
    regular: ok('regular'),
    slipping: ok('slipping'),
    drifting: ok('drifting'),
    lapsed: ok('lapsed'),
    new: ok('new'),
    occasional: ok('occasional'),
    unseen: ok('unseen'),
    cant_see: RETENTION_PEOPLE.filter((p) => ['slipping', 'drifting', 'lapsed'].includes(p.status) && p.signal !== 'ok').length,
};
if (COUNTS.drifting !== DRIFTING || COUNTS.slipping !== SLIPPING) console.warn(`  ! gym-members: ${COUNTS.drifting} drifting / ${COUNTS.slipping} slipping, core says ${DRIFTING} / ${SLIPPING}`);
if (RETENTION_PEOPLE.filter((p) => p.is_member).length !== MEMBERS) console.warn(`  ! gym-members: ${RETENTION_PEOPLE.filter((p) => p.is_member).length} members in Retention, core says ${MEMBERS}`);

// Each Sunday of the last 12 weeks, as it stood (Can't see left out, as the SQL does).
const TREND = [
    [58, 15, 12, 19], [57, 14, 11, 19], [55, 16, 13, 20], [56, 15, 12, 20], [54, 17, 13, 21], [55, 15, 11, 21],
    [57, 14, 10, 22], [58, 13, 10, 22], [59, 12, 9, 22], [60, 12, 8, 23], [60, 11, 8, 23], [61, 12, 6, 23],
].map(([regular, slipping, drifting, lapsed], i) => ({ week_end: addDays(MONDAY, -1 - 7 * (11 - i)), regular, slipping, drifting, lapsed }));

export const RETENTION = {
    tz: TZ,
    as_of: AS_OF,
    named: true,
    population: COUNTS.population,
    counts: COUNTS,
    trend: TREND,
    winback: { reached: 14, back: 6, waiting: 4 },
    people: RETENTION_PEOPLE,
};

// ── Members who share with you (gym_member_people) ─────────────────────────
// [who, status, last active (hours ago), active days last 2 weeks, the 6 weeks before, sessions in 4 weeks, streak, top]
const STREAK = { 0: 12, 1: 15, 2: 41, 3: 6, 5: 4, 7: 9, 8: 2, 9: 3, 11: 5, 12: 4, 13: 1, 14: 8, 16: 11, 18: 1, 19: 2, 22: 2 };
const top = (...pairs) => pairs.map(([type, sessions]) => ({ type, sessions }));
const SHARING = [
    [25, 'quiet', 19 * 24 + 4, 0, 21, 2, 0, top(['gym', 2])],
    [27, 'quiet', 15 * 24 + 7, 0, 14, 1, 0, top(['running', 1])],
    [29, 'slowing', 4 * 24 + 2, 3, 27, 7, 0, top(['walking', 4], ['gym', 3])],
    [26, 'slowing', 6 * 24 + 5, 2, 19, 6, 0, top(['gym', 5], ['cycling', 1])],
    [28, 'slowing', 3 * 24 + 1, 3, 22, 7, 0, top(['running', 4], ['gym', 3])],
    [0, 'active', 3, 9, 26, 24, 12, top(['gym', 17], ['running', 5], ['walking', 2])],
    [2, 'active', 5, 12, 36, 31, 41, top(['gym', 18], ['walking', 9], ['yoga', 4])],
    [7, 'active', 9, 8, 25, 19, 9, top(['gym', 15], ['hiit', 4])],
    [3, 'active', 20, 8, 23, 20, 6, top(['gym', 14], ['cycling', 4], ['walking', 2])],
    [11, 'active', 26, 7, 20, 17, 5, top(['gym', 13], ['running', 4])],
    [5, 'active', 27, 7, 15, 16, 4, top(['gym', 12], ['walking', 4])],
    [14, 'active', 30, 8, 22, 18, 8, top(['gym', 13], ['yoga', 3], ['walking', 2])],
    [9, 'active', 32, 6, 18, 14, 3, top(['gym', 10], ['running', 4])],
    [16, 'active', 34, 7, 21, 16, 11, top(['gym', 11], ['hiit', 3], ['walking', 2])],
    [1, 'active', 40, 6, 19, 15, 15, top(['gym', 10], ['running', 3], ['cycling', 2])],
    [19, 'active', 45, 5, 14, 11, 2, top(['gym', 8], ['walking', 3])],
    [12, 'active', 48, 5, 16, 12, 4, top(['gym', 8], ['running', 2], ['swimming', 2])],
    [22, 'active', 52, 4, 12, 10, 2, top(['gym', 7], ['walking', 3])],
    [13, 'active', 60, 4, 13, 9, 1, top(['gym', 6], ['cycling', 3])],
    [18, 'active', 64, 4, 11, 9, 1, top(['walking', 5], ['gym', 4])],
    [8, 'active', 70, 5, 15, 12, 2, top(['running', 7], ['gym', 5])],
    [30, 'active', 50, 4, 9, 9, 0, top(['gym', 4], ['running', 3], ['walking', 2])],
];
const notYet = UNSEEN[3];
export const MEMBER_PEOPLE = {
    members: MEMBERS,
    sharing: SHARING.length + 1,
    people: [
        ...SHARING.map(([i, status, h, recent, base, sessions, streak, types], k) => ({
            user_id: PEOPLE[i].id,
            display_name: PEOPLE[i].name,
            username: PEOPLE[i].username,
            avatar_url: null,
            member_id: PEOPLE[i].powr_id,
            since: daysAgoAt(30 + k * 6, 10),
            status,
            last_active: hoursAgo(h),
            recent_days: recent,
            usual_days: Math.round((base / 3) * 10) / 10,
            sessions_4w: sessions,
            minutes_4w: sessions * 52,
            streak: STREAK[i] ?? streak,
            top: types,
        })),
        {
            user_id: notYet.id, display_name: notYet.name, username: notYet.username, avatar_url: null, member_id: notYet.powr_id,
            since: daysAgoAt(9, 10), status: 'inactive', last_active: null, recent_days: 0, usual_days: 0, sessions_4w: 0, minutes_4w: 0, streak: 0, top: [],
        },
    ],
};
if (MEMBER_PEOPLE.sharing !== 23) console.warn(`  ! gym-members: ${MEMBER_PEOPLE.sharing} share, core says 23`);

export default {
    rpc: {
        gym_member_people: MEMBER_PEOPLE,
        gym_retention: RETENTION,
        gym_log_outreach: ({ p_channel, p_note }) => ({ id: '6f1d2c3b-0000-4000-8000-0000000c0999', at: new Date().toISOString(), channel: p_channel, note: p_note ?? null, mine: true }),
        gym_delete_outreach: null,
    },
};
