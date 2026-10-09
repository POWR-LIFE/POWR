// The gym portal's shared data: everything the Overview (/venue) reads, and
// every call the layout or two or more gym pages share. One coherent week at
// Northpoint Strength, so any page a shot opens agrees with every other.
//
// The story, as of the day the shots are taken (all dates are relative):
//   142 members have picked Northpoint in the app; about 60 train there in a
//   week (a usual week is ~185 sessions). This week is on course to be the
//   busiest in 8 weeks. 9 people are in right now.
//   Events: The Northpoint Grind (monthly challenge, live, 38 in, day 11 of
//   28), The Canal Street Showdown (monthly, winners out 10 days ago, 44 took
//   part), the Northpoint Weekend Sprint (scheduled, starts on the first
//   Friday 22+ days out, 12 joined) and the Deadlift Weekend (a Friday to
//   Sunday sprint about 11 weeks ago, finished).
//   Gym Clash: 8 gyms within 10 km; Northpoint is 2nd on points, a little
//   behind Ironvale Gym, and 1st per member.
//   Retention: 7 regulars drifting, 11 slipping.
//   Team in the app: Jordan Hale (head coach), Kris Adeyemi (boxing), Tom
//   Reyes (PT), Lena Marsh (classes) and Aisha Benn (physio, hidden).
//
// Shapes follow the SQL (supabase/migrations, the last definition of each
// gym_* function) and the gym-board / gym-league edge functions.
import { BRAND, GYM, OWNER, PEOPLE, photo } from '../world.mjs';
import { REWARD } from './partner-base.mjs';
import { reply } from '../mock.mjs';

// ── Time, in the gym's zone ───────────────────────────────────────────────
const TZ = 'Europe/London';
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** The instant it is hh:mm on London date `iso` (DST-safe). */
function london(iso, hh = 0, mm = 0) {
    const [y, m, d] = iso.split('-').map(Number);
    const want = Date.UTC(y, m - 1, d, hh, mm);
    let t = want;
    for (let i = 0; i < 2; i++) {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
            timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
        t -= Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - want;
    }
    return new Date(t);
}
const TODAY = ymd(new Date());
/** 0 = Monday. */
const DOW = (new Date(`${TODAY}T12:00:00Z`).getUTCDay() + 6) % 7;
const MONDAY = addDays(TODAY, -DOW);
/** ISO instant `n` days from today (London), at hh:mm London. */
const at = (n, hh = 0, mm = 0) => london(addDays(TODAY, n), hh, mm).toISOString();
const weekStartIso = (weeksAgo) => london(addDays(MONDAY, -7 * weeksAgo)).toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

// ── The week at the gym ───────────────────────────────────────────────────
const PER_SESSION_MIN = 57;
const PER_SESSION_POWR = 19;
// A full week, Monday first; today counts about 60% of its usual (the day isn't over).
const THIS_WEEK_FULL = [36, 34, 32, 30, 26, 28, 17];
const LAST_WEEK = [34, 31, 30, 27, 23, 26, 15];                     // 186
const thisWeek = THIS_WEEK_FULL.map((n, i) => (i < DOW ? n : i === DOW ? Math.round(n * 0.6) : 0));
const sum = (a) => a.reduce((s, n) => s + n, 0);
const SO_FAR = sum(thisWeek);
const TODAY_SESSIONS = thisWeek[DOW];
// Distinct people grow slower than sessions: ~60 in a full week.
const peopleFor = (sessions) => Math.round(62 * (1 - Math.exp(-sessions / 68)));
const WEEK = { sessions: SO_FAR, athletes: peopleFor(SO_FAR), minutes: SO_FAR * PER_SESSION_MIN, points: SO_FAR * PER_SESSION_POWR };
const LAST = { sessions: sum(LAST_WEEK), athletes: 59, minutes: sum(LAST_WEEK) * PER_SESSION_MIN, points: sum(LAST_WEEK) * PER_SESSION_POWR };
/** How far into a Thursday-sized week we are (the board's numbers scale with it). */
const P = SO_FAR / 120;

export const MEMBERS = 142;        // picked Northpoint in the app
export const IN_NOW = 9;
export const NEW_FACES = 4;
export const DRIFTING = 7;
export const SLIPPING = 11;

// The last 8 complete weeks, oldest first, then this one.
const PAST_WEEKS = [
    { sessions: 164, athletes: 54, new_athletes: 3 },
    { sessions: 171, athletes: 56, new_athletes: 5 },
    { sessions: 178, athletes: 58, new_athletes: 2 },
    { sessions: 169, athletes: 55, new_athletes: 4 },
    { sessions: 183, athletes: 59, new_athletes: 6 },
    { sessions: 192, athletes: 63, new_athletes: 3 },
    { sessions: 177, athletes: 57, new_athletes: 4 },
    { sessions: LAST.sessions, athletes: LAST.athletes, new_athletes: 5 },
];
const insightWeeks = (n) => [...PAST_WEEKS, { sessions: WEEK.sessions, athletes: WEEK.athletes, new_athletes: NEW_FACES }]
    .slice(-n)
    .map((w, i, all) => ({
        week_start: weekStartIso(all.length - 1 - i),
        sessions: w.sessions,
        athletes: w.athletes,
        new_athletes: w.new_athletes,
        minutes: w.sessions * PER_SESSION_MIN,
        points: w.sessions * PER_SESSION_POWR,
    }));
// Last 28 days at the gym: by local start hour (rush 5pm–7pm), and by weekday (sums to 748, ~187 a week).
const HOURS_28D = [0, 0, 0, 0, 0, 14, 64, 70, 47, 35, 28, 20, 40, 33, 16, 18, 44, 92, 101, 70, 41, 12, 3, 0];
const WEEKDAYS_28D = [132, 124, 118, 112, 92, 104, 66];

// ── People ────────────────────────────────────────────────────────────────
const who = (i) => ({ display_name: PEOPLE[i].name, username: PEOPLE[i].username, avatar_url: null });
const key = (i) => `np${String(i).padStart(4, '0')}a1`;
const LEVELS = [
    [1, 'Touching Grass', 'Recruit', '#999999'], [3, 'Streak Freak', 'Recruit', '#999999'], [5, 'Heavy Hitter', 'Recruit', '#999999'],
    [6, 'Can’t Sit Still', 'Athlete', '#fb923c'], [7, 'Iron Lungs', 'Athlete', '#fb923c'], [8, 'Pavement Predator', 'Athlete', '#fb923c'],
    [9, 'Step Collector', 'Athlete', '#fb923c'], [10, 'Calorie Criminal', 'Athlete', '#fb923c'], [11, 'Mile Muncher', 'Elite', '#E8D200'],
    [12, 'Move Machine', 'Elite', '#E8D200'], [14, 'Certified Weapon', 'Elite', '#E8D200'],
];
const level = (n) => { const l = LEVELS[n]; return { level: l[0], name: l[1], tier: l[2], colour: l[3] }; };

// Who's who in PEOPLE: 0–29 Northpoint regulars, 30–33 this week's new faces,
// 34–39 members of other gyms (they only appear in Gym Clash's feed).
// This week's board as it stands on a Thursday: [PEOPLE index, POWR, sessions, level, streak, last week's POWR].
const BOARD_THU = [
    [0, 128, 5, 9, 12, 141], [2, 117, 5, 10, 41, 122], [7, 109, 5, 7, 9, 96], [3, 101, 4, 8, 6, 118],
    [11, 96, 4, 6, 5, 74], [5, 88, 4, 5, 4, 31], [14, 82, 4, 7, 8, 90], [9, 77, 3, 4, 3, 85],
    [16, 71, 3, 6, 11, 64], [1, 66, 3, 8, 15, 79], [19, 60, 3, 3, 2, 58], [12, 54, 2, 5, 4, 47],
    [6, 49, 2, 2, 3, 52], [22, 45, 2, 4, 2, 30], [17, 41, 2, 1, 1, 0], [20, 38, 2, 3, 2, 41],
    [4, 35, 2, 5, 3, 44], [8, 33, 2, 6, 2, 29], [10, 30, 1, 2, 1, 36], [13, 28, 1, 4, 1, 22],
    [15, 26, 1, 3, 2, 31], [18, 24, 1, 1, 1, 0], [21, 21, 1, 2, 1, 18], [23, 19, 1, 3, 1, 25],
    [24, 17, 1, 1, 1, 0],
];
const scaled = (n) => Math.max(1, Math.round(n * P));
const BOARD = BOARD_THU
    .map(([i, pts, s, lv, streak, last], rank) => ({ i, rank: rank + 1, points: scaled(pts), sessions: Math.max(1, Math.round(s * Math.min(1, P + 0.1))), lv, streak, last }))
    .sort((a, b) => b.points - a.points)
    .map((r, k) => ({ ...r, rank: k + 1 }));

/** gym_insights.top: this week's top ten, exactly as the wall shows them. */
const TOP = BOARD.slice(0, 10).map((r) => ({ rank: r.rank, ...who(r.i), points: r.points, sessions: r.sessions }));

// ── The gym itself ────────────────────────────────────────────────────────
const HOURS = {
    mon: { open: '06:00', close: '22:00' }, tue: { open: '06:00', close: '22:00' }, wed: { open: '06:00', close: '22:00' },
    thu: { open: '06:00', close: '22:00' }, fri: { open: '06:00', close: '21:00' },
    sat: { open: '07:00', close: '19:00' }, sun: { open: '08:00', close: '16:00' },
};
export const PROFILE = {
    id: GYM.id,
    name: GYM.name,
    description: 'Independent strength gym on Canal Street. Open from 6am, coached classes every evening, and a free first session for anyone new to lifting.',
    address: GYM.address,
    phone: '01632 960418',
    website: 'https://northpoint.example',
    logo_url: GYM.logo_url,
    logo_bg: GYM.logo_bg,
    image_url: GYM.photo_url,
    opening_hours: HOURS,
    // No coordinates: with them the phone preview draws real streets (CARTO
    // tiles) and the join link prints them. Gym Clash keeps its own below.
    lat: null,
    lng: null,
    can_edit: true,
    recap_email: true,
    drift_email: true,
};

const trainer = (n, fields) => ({
    id: `6f1d2c3b-0000-4000-8000-0000000e${String(n).padStart(4, '0')}`,
    experience: '', specialties: [], bio: '', booking_url: null, profile_url: null, photo_url: null, active: true, sort_order: n, ...fields,
});
export const TEAM = [
    trainer(1, { name: 'Jordan Hale', role: 'Head coach', experience: '9 years', specialties: ['Strength', 'Muscle building', 'Mobility'],
        bio: 'Ran the strength floor at Northpoint since day one. Big on technique, patient with beginners, and keeps a spreadsheet for everything.',
        booking_url: 'https://book.northpoint.example/jordan', profile_url: 'https://northpoint.example/team/jordan', photo_url: photo('headphones.jpg') }),
    trainer(2, { name: 'Kris Adeyemi', role: 'Boxing coach', experience: '6 years', specialties: ['Boxing', 'HIIT', 'Weight loss'],
        bio: 'Former amateur boxer. Runs the Tuesday and Thursday fight classes and one-to-one pad work.',
        booking_url: 'https://book.northpoint.example/kris', photo_url: photo('boxer-dark.jpg') }),
    trainer(3, { name: 'Tom Reyes', role: 'Personal trainer', experience: '4 years', specialties: ['Strength', 'Weight loss'],
        bio: 'Simple programmes that fit a busy week. Early mornings are his.',
        booking_url: 'https://book.northpoint.example/tom', photo_url: photo('runner-pan.jpg') }),
    trainer(4, { name: 'Lena Marsh', role: 'Class instructor', experience: '5 years', specialties: ['Mobility', 'HIIT', 'Pilates'],
        bio: 'Teaches the evening circuits and Sunday mobility. Expect to sweat, then stretch.',
        booking_url: 'https://book.northpoint.example/lena', photo_url: photo('pullup.jpg') }),
    trainer(5, { name: 'Aisha Benn', role: 'Physio', experience: '7 years', specialties: ['Rehab', 'Mobility'],
        bio: 'Sports physio, in on Mondays and Wednesdays.', active: false }),
];

// ── Screens: the board and Gym Clash ──────────────────────────────────────
export const BOARD_ROW = {
    slug: GYM.slug,
    display_token: GYM.board_key,
    enabled: true,
    board_size: 25,
    tz: TZ,
    viewing: 'standard',
    league_enabled: true,
    league_radius_km: 10,
    created_at: at(-131, 10),
};

// Gym Clash: the gyms within 10 km. Points scale with the host's week.
// [name, address, km north, km east, points × host, athletes × host, share of the week today, in now, last week × host]
// Only the host and gyms below 4th show "in now": the Overview's table is narrow and a badge truncates names.
const NEIGHBOURS = [
    ['Ironvale Gym', '3 Foundry Lane, Riverton', 1.2, 0.8, 1.042, 1.53, 0.12, 0, 0.98],
    ['Canalside Barbell Club', '41 Wharf Road, Riverton', -0.6, 1.5, 0.9, 0.98, 0.045, 0, 0.86],
    ['Riverton Leisure Centre', 'Park Avenue, Riverton', 2.0, -1.1, 0.66, 1.1, 0.13, 0, 0.7],
    ['Larkhaven Lift Club', '8 Market Row, Larkhaven', 4.5, 3.0, 0.52, 0.55, 0.11, 3, 0.47],
    ['Kestrel Bay Boxing', '22 Mill Street, Kestrel Bay', -5.2, -2.4, 0.41, 0.45, 0.09, 4, 0.44],
    ['Greenway Fitness', '5 Station Parade, Larkhaven', 4.1, 3.8, 0.29, 0.4, 0.14, 2, 0.31],
    ['Harbourside Yoga Studio', '17 Quay Street, Kestrel Bay', -6.0, -1.0, 0.17, 0.3, 0.1, 0, 0.2],
];
const HOST_KEY = 'a1b2c3d4e5f6';
// Out at sea on purpose: the league screen's Network map draws real map tiles
// (CARTO) around these points, and on land it would print real place names.
const HOST_AT = { lat: 54.62, lng: 1.48 };
const dayPoints = (week, todayShare) => {
    // Earlier days split what's left of the week evenly-ish; today has its share; later days nothing.
    const today = Math.round(week * (DOW === 0 ? 1 : todayShare));      // on a Monday, today is the week
    const before = week - today;
    const shape = [1.12, 1.05, 1.0, 0.96, 0.84, 0.9, 0.6];
    const w = shape.slice(0, DOW);
    const tot = sum(w) || 1;
    const days = shape.map((s, i) => (i < DOW ? Math.round((before * s) / tot) : i === DOW ? today : 0));
    if (DOW > 0) days[DOW - 1] += week - sum(days);      // rounding lands on yesterday
    return days;
};
const host = {
    key: HOST_KEY, name: GYM.name, address: GYM.address, lat: HOST_AT.lat, lng: HOST_AT.lng,
    points_week: WEEK.points,
    points_today: TODAY_SESSIONS * PER_SESSION_POWR,
    points_last_same: Math.round(sum(LAST_WEEK.slice(0, DOW)) * PER_SESSION_POWR + LAST_WEEK[DOW] * 0.6 * PER_SESSION_POWR),
    sessions_week: WEEK.sessions, athletes_week: WEEK.athletes,
    days: thisWeek.map((n) => n * PER_SESSION_POWR),
    in_now: IN_NOW, founding: false, logo_url: GYM.logo_url, logo_bg: GYM.logo_bg,
};
const GYMS = [host, ...NEIGHBOURS.map(([name, address, n, e, f, a, share, inNow, last], i) => {
    const pts = Math.round(WEEK.points * f);
    return {
        key: `b${i}c7d9e1f2a3`.slice(0, 12), name, address,
        lat: +(HOST_AT.lat + n * 0.009).toFixed(6), lng: +(HOST_AT.lng + e * 0.0144).toFixed(6),
        points_week: pts, points_today: Math.round(pts * (DOW === 0 ? 1 : share)), points_last_same: Math.round(host.points_last_same * last),
        sessions_week: Math.round(pts / 18), athletes_week: Math.max(1, Math.round(WEEK.athletes * a)),
        days: dayPoints(pts, share), in_now: inNow, founding: i === 3, logo_url: null, logo_bg: null,
    };
})];
// Other gyms' feed rows: PEOPLE 34–39, never a Northpoint regular.
const OTHER_GYM_PEOPLE = PEOPLE.slice(34);
const TYPES = ['gym', 'gym', 'hiit', 'gym', 'yoga', 'gym', 'sports', 'gym'];
const LEAGUE_FEED = Array.from({ length: 14 }, (_, k) => {
    const gi = [0, 1, 0, 2, 3, 1, 0, 4, 2, 5, 1, 6, 0, 3][k];
    const g = GYMS[gi];
    const p = g === host ? who(BOARD[k % 10].i) : { display_name: OTHER_GYM_PEOPLE[(gi - 1) % OTHER_GYM_PEOPLE.length].name, username: null };
    return {
        key: `lf${String(k).padStart(10, '0')}`, gym_key: g.key, display_name: p.display_name, username: p.username ?? null,
        type: TYPES[k % TYPES.length], started_at: hoursAgo(0.3 + k * 0.45), minutes: 38 + ((k * 17) % 50), points: 12 + ((k * 7) % 22),
    };
});

const LEAGUE = {
    gym: { name: GYM.name, logo_url: GYM.logo_url, logo_bg: GYM.logo_bg, address: GYM.address },
    slug: GYM.slug,
    host_key: HOST_KEY,
    radius_km: BOARD_ROW.league_radius_km,
    tz: TZ,
    week_start_at: london(MONDAY).toISOString(),
    week_end_at: london(addDays(MONDAY, 7)).toISOString(),
    day_start_at: london(TODAY).toISOString(),
    prev_start_at: london(addDays(MONDAY, -7)).toISOString(),
    prev_now_at: new Date(Date.now() - 7 * 864e5).toISOString(),
    gyms: GYMS,
    feed: LEAGUE_FEED,
    generated_at: new Date().toISOString(),
};

// The wall's own feed (gym-board): this week's standings, the spotlight, the community and beyond blocks.
const spotlightSession = BOARD.find((r) => r.i === 3);
const improved = BOARD.find((r) => r.i === 5);
const NEW_THIS_WEEK = [30, 31, 32, 33];               // Eli T., Fern U., Gus W., Hana X.
const boardRow = (r) => ({
    key: key(r.i), ...who(r.i), rank: r.rank, points: r.points, sessions: r.sessions,
    active_days: Math.min(DOW + 1, r.sessions), rank_delta: [0, 1, -1, 2, 0, 3, -2, 0, 1, -1, 0, 2, -3, 1, 0][r.rank - 1] ?? 0,
    minutes: r.sessions * 61, today_points: r.rank % 3 === 0 ? 0 : Math.round(r.points / Math.max(1, r.sessions)),
    streak: r.streak, is_new: false, is_pb: r.rank === 3 || r.rank === 6, last_week_points: r.last,
    level: level(r.lv), member_since: at(-120 + r.rank * 4),
});
const weekDates = Array.from({ length: 7 }, (_, i) => addDays(MONDAY, i));
const COMMUNITY = {
    tz: TZ,
    week: weekDates.map((date, i) => ({
        date, points: thisWeek[i] * PER_SESSION_POWR, sessions: thisWeek[i],
        minutes: thisWeek[i] * PER_SESSION_MIN, members: Math.round(thisWeek[i] * 0.92),
    })),
    last_week: weekDates.map((date, i) => ({ date: addDays(date, -7), points: LAST_WEEK[i] * PER_SESSION_POWR, sessions: LAST_WEEK[i] })),
    now: { in_gym: IN_NOW, sessions: TODAY_SESSIONS, points: TODAY_SESSIONS * PER_SESSION_POWR, members: Math.round(TODAY_SESSIONS * 0.94), minutes: TODAY_SESSIONS * PER_SESSION_MIN },
    vs_last: { points: WEEK.points, points_last: host.points_last_same, sessions: WEEK.sessions, sessions_last: Math.round(host.points_last_same / PER_SESSION_POWR), members: WEEK.athletes, members_last: Math.round(WEEK.athletes * 0.94) },
    mix: [
        { type: 'gym', sessions: 702, points: 13_400, minutes: 40_300 },
        { type: 'hiit', sessions: 31, points: 610, minutes: 1_400 },
        { type: 'yoga', sessions: 15, points: 240, minutes: 900 },
    ],
    peak: { hour: 18, weekday: 1, by_hour: HOURS_28D.map((sessions, hour) => ({ hour, sessions })).filter((h) => h.sessions > 0) },
    streaks: { on_7plus: 14, on_30plus: 2, longest: { key: key(2), ...who(2), streak: 41 } },
    rank: { rank: 2, of: 8, points: WEEK.points },
    all_time: { sessions: 2_412, minutes: 2_412 * PER_SESSION_MIN, members: 131, points: 2_412 * PER_SESSION_POWR, since: at(-131, 7, 12) },
};
const r7 = (n) => Math.round(n * Math.min(1, (DOW + 0.6) / 7));
const BEYOND = {
    tz: TZ,
    members: MEMBERS,
    week: [
        { type: 'walking', sessions: r7(214), members: 61, minutes: 0, km: r7(905), km_measured: true, steps: r7(1_210_000), here_minutes: 0, longest_km: 12.6, longest_minutes: 0 },
        { type: 'gym', sessions: r7(201), members: 66, minutes: r7(11_800), km: 0, km_measured: false, steps: 0, here_minutes: r7(10_600), longest_km: 0, longest_minutes: 104 },
        { type: 'running', sessions: r7(43), members: 22, minutes: r7(2_300), km: r7(371), km_measured: true, steps: 0, here_minutes: 0, longest_km: 18.2, longest_minutes: 97 },
        { type: 'cycling', sessions: r7(14), members: 8, minutes: r7(1_050), km: r7(420), km_measured: true, steps: 0, here_minutes: 0, longest_km: 64.3, longest_minutes: 171 },
        { type: 'hiit', sessions: r7(16), members: 11, minutes: r7(640), km: 0, km_measured: false, steps: 0, here_minutes: r7(420), longest_km: 0, longest_minutes: 52 },
        { type: 'yoga', sessions: r7(7), members: 5, minutes: r7(390), km: 0, km_measured: false, steps: 0, here_minutes: 0, longest_km: 0, longest_minutes: 70 },
    ],
    month: [
        { type: 'walking', sessions: 890, members: 74, minutes: 0, km: 3_820, steps: 5_100_000 },
        { type: 'gym', sessions: 812, members: 81, minutes: 47_600, km: 0, steps: 0 },
        { type: 'running', sessions: 176, members: 31, minutes: 9_400, km: 1_530, steps: 0 },
        { type: 'cycling', sessions: 58, members: 12, minutes: 4_300, km: 1_740, steps: 0 },
    ],
    days: weekDates.map((date, i) => {
        const on = i <= DOW;
        const by_type = on ? { walking: 31 - i, gym: thisWeek[i], running: 6 + (i % 3), hiit: 2 + (i % 2), cycling: i % 3 } : {};
        const sessions = sum(Object.values(by_type));
        return { date, sessions, km: on ? 150 + i * 11 : 0, minutes: sessions * 46, by_type };
    }),
    totals: {
        week: { sessions: r7(495), members: 78, minutes: r7(16_180), km: r7(1_696), steps: r7(1_210_000) },
        last_week: { sessions: 470, km: 1_610, minutes: 15_400 },
        month: { sessions: 1_936, members: 88, minutes: 61_300, km: 7_090, steps: 5_100_000 },
    },
    longest: {
        running: { key: key(8), ...who(8), km: 18.2, minutes: 97, started_at: hoursAgo(40) },
        cycling: { key: key(13), ...who(13), km: 64.3, minutes: 171, started_at: hoursAgo(70) },
        swimming: null,
        walking: { key: key(18), ...who(18), steps: 27_800, started_at: hoursAgo(30) },
    },
};
const WALL = {
    gym: { name: GYM.name, logo_url: GYM.logo_url, logo_bg: GYM.logo_bg, image_url: GYM.photo_url, address: GYM.address },
    slug: GYM.slug,
    viewing: BOARD_ROW.viewing,
    tz: TZ,
    week_start_at: LEAGUE.week_start_at,
    week_end_at: LEAGUE.week_end_at,
    day_start_at: LEAGUE.day_start_at,
    stats: { members: WEEK.athletes, points: WEEK.points, sessions: WEEK.sessions, minutes: WEEK.minutes },
    spotlight: {
        session: { key: key(3), ...who(3), points: Math.min(41, spotlightSession.points), type: 'gym', started_at: hoursAgo(DOW > 0 ? 30 : 5), minutes: 94 },
        improved: { key: key(5), ...who(5), this_week: improved.points, last_week: 31, gain: Math.max(1, improved.points - 31) },
        new_members: NEW_THIS_WEEK.map((i) => ({ key: key(i), ...who(i) })),
    },
    activity: Array.from({ length: 16 }, (_, k) => {
        const r = BOARD[(k * 4) % BOARD.length];
        const start = hoursAgo(0.5 + k * 1.6);
        const minutes = 42 + ((k * 13) % 48);
        return {
            ...who(r.i), key: `act${String(k).padStart(9, '0')}`, type: k % 6 === 4 ? 'hiit' : 'gym', started_at: start,
            ended_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(), minutes, points: 11 + ((k * 5) % 24), verified: true,
        };
    }),
    community_stats: COMMUNITY,
    beyond: BEYOND,
    community: MEMBERS,
    standings: BOARD.map(boardRow),
    last_week: {
        week_start_at: LEAGUE.prev_start_at,
        week_end_at: LEAGUE.week_start_at,
        podium: [[0, 141], [2, 122], [3, 118]].map(([i, pts], k) => ({ ...boardRow({ ...BOARD.find((r) => r.i === i), rank: k + 1 }), rank: k + 1, points: pts })),
    },
    generated_at: new Date().toISOString(),
};

// ── Events ────────────────────────────────────────────────────────────────
const RULES_MONTHLY = [
    `Only sessions at ${GYM.name} count. Check in with POWR when you arrive.`,
    'Manually logged workouts don’t count.',
    `Anyone gaming the board can be removed by ${GYM.name} or POWR.`,
];
const RULES_SPRINT = [
    'Any verified workout counts, wherever you train.',
    'Manually logged workouts and walking don’t count.',
    `Anyone gaming the board can be removed by ${GYM.name} or POWR.`,
];
const TEMPLATES = {
    monthly: { name: 'Monthly challenge', duration_days: 28, finale: false, allowed_presets: ['none'], radius_choices: [1, 2, 5] },
    sprint: { name: 'Weekend sprint', duration_days: 3, finale: false, allowed_presets: ['none'], radius_choices: [1, 2, 5] },
};
const PEAK_REWARD = {
    brand_name: BRAND.name, title: REWARD.title, label: `${BRAND.name} · 25% off`, value: '25% off', image_url: BRAND.logo_url, available: null,
};
/** Days from today to the nearest Friday at or after (dir 1) / before (dir -1) `from`. */
const friday = (from, dir) => { let d = from; while ((DOW + d + 700) % 7 !== 4) d += dir; return d; };
function event(n, f) {
    const tpl = TEMPLATES[f.template_key];
    const start = london(addDays(TODAY, f.startIn));
    const end = london(addDays(TODAY, f.startIn + tpl.duration_days));
    const lock = end.toISOString();
    return {
        id: `6f1d2c3b-0000-4000-8000-0000000f${String(n).padStart(4, '0')}`,
        slug: f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + `-${n}a7c`,
        name: f.name,
        status: f.status,
        hidden: false,
        managed_by: 'gym',
        editable: true,
        review_status: 'approved',
        review_note: null,
        // Always in the past, even for an event that starts weeks from now.
        submitted_at: at(Math.min(f.startIn - 6, -3), 11),
        published_at: at(Math.min(f.startIn - 5, -2), 9),
        template_key: f.template_key,
        template: tpl,
        window_start_at: start.toISOString(),
        window_end_at: end.toISOString(),
        lock_at: lock,
        doors_open_at: null,
        doors_close_at: null,
        reveal_at: null,
        revealed_at: f.revealed_at ?? null,
        results_cut_at: f.revealed_at ? lock : null,
        auto_reveal_at: new Date(Date.parse(lock) + (12 + 72) * 3_600_000).toISOString(),
        prizes: f.prizes,
        rules: f.template_key === 'monthly' ? RULES_MONTHLY : RULES_SPRINT,
        promo_headline: f.promo_headline ?? null,
        promo_media_url: f.promo_media_url ?? null,
        points_preset_key: 'none',
        attendance_bonus_points: 0,
        attendance_paid_at: null,
        audience_radius_km: 2,
        display_token: `docs-event-key-${n}`,
        participants: f.participants,
        disqualified: f.disqualified ?? 0,
        board_size: 20,
        included_activities: null,
        count_venue_only: f.template_key === 'monthly',
        count_walking: false,
        own_rules: [],
        booking_url: null,
        logo_url: null,
        logo_only: false,
        duration_days: tpl.duration_days,
        night_start_hour: null,
        night_hours: null,
        partner_reward_id: f.partner ? REWARD.id : null,
        partner_reward: f.partner ? PEAK_REWARD : null,
        partner_codes_issued: f.codes ?? 0,
    };
}
const prize = (rank, label, handed) => ({ rank, label, ...(handed ? { handed_at: handed } : {}) });
export const EVENTS = {
    sprint: event(4, {
        name: 'Northpoint Weekend Sprint', template_key: 'sprint', status: 'scheduled', startIn: friday(22, 1), participants: 12,
        prizes: [prize(1, 'A free month of membership'), prize(2, 'Northpoint hoodie'), prize(3, 'Peakform Nutrition protein tub')],
        promo_headline: 'Three days. Any workout, anywhere.',
    }),
    live: event(3, {
        name: 'The Northpoint Grind', template_key: 'monthly', status: 'live', startIn: -10, participants: 38, disqualified: 1, partner: true,
        prizes: [prize(1, 'Three months free membership'), prize(2, 'Five PT sessions with Jordan'), prize(3, 'Peakform Nutrition recovery bundle')],
        promo_headline: 'Four weeks. Every session here counts.', promo_media_url: photo('pullup.jpg'),
    }),
    showdown: event(2, {
        name: 'The Canal Street Showdown', template_key: 'monthly', status: 'revealed', startIn: -40, participants: 44, partner: true, codes: 41,
        revealed_at: at(-10, 19, 30),
        prizes: [prize(1, 'Three months free membership', at(-8, 17)), prize(2, 'Northpoint hoodie', at(-8, 17)), prize(3, 'Peakform Nutrition protein tub', at(-7, 9))],
        promo_headline: 'A month on Canal Street. Who trains the most?', promo_media_url: photo('rope.jpg'),
    }),
    deadlift: event(1, {
        name: 'Deadlift Weekend', template_key: 'sprint', status: 'settled', startIn: friday(-75, -1), participants: 29,
        revealed_at: at(friday(-75, -1) + 4, 18),
        prizes: [prize(1, 'Northpoint hoodie', at(friday(-75, -1) + 6, 12)), prize(2, 'Free PT session', at(friday(-75, -1) + 6, 12))],
    }),
};
const EVENT_LIST = Object.values(EVENTS).sort((a, b) => b.window_start_at.localeCompare(a.window_start_at));

// Each event's standings: [PEOPLE index, POWR].
const STANDINGS = {
    [EVENTS.live.id]: [[2, 236], [0, 221], [7, 198], [3, 187], [11, 172], [1, 161], [14, 150], [9, 139], [16, 126], [5, 118], [19, 104], [12, 97], [6, 88], [22, 74], [17, 61], [20, 52], [8, 44], [24, 37], [26, 29], [28, 21]],
    [EVENTS.showdown.id]: [[0, 612], [3, 587], [2, 554], [7, 521], [1, 498], [11, 463], [9, 431], [14, 402], [5, 377], [16, 350], [12, 318], [6, 291], [19, 264], [22, 230], [8, 201], [20, 177], [17, 150], [13, 122], [26, 96], [28, 71]],
    [EVENTS.deadlift.id]: [[3, 164], [7, 151], [0, 139], [11, 126], [2, 118], [9, 104], [14, 93], [1, 85], [5, 71], [12, 60]],
};
function eventBoard(id) {
    const ev = EVENT_LIST.find((e) => e.id === id);
    if (!ev) return reply(400, { code: 'P0002', message: 'Event not found' });
    const frozen = ['revealed', 'settled'].includes(ev.status);
    const rows = (STANDINGS[id] ?? []).map(([i, points], k) => ({
        rank: k + 1, user_id: PEOPLE[i].id, ...who(i), points, prize: ev.prizes.find((p) => p.rank === k + 1)?.label ?? null,
    }));
    return { frozen, rows };
}

// ── Members' activity anywhere (Clash+): what the Overview's moves and Members read ──
function memberActivity(weeks = 12) {
    const n = Math.min(26, Math.max(4, weeks ?? 12));
    const anyWeekly = [262, 270, 268, 281, 276, 290, 284, 301, 296, 305, 312, 298, 309, 318, 322, 315, 330, 327, 338, 331, 344, 352, 341, 356, 349, 362];
    const active = [61, 63, 62, 66, 64, 67, 66, 70, 69, 71, 72, 70, 72, 74, 75, 73, 76, 75, 78, 76, 79, 81, 78, 82, 80, 83];
    // ago = 1 is last week (the last entry); this week is a share of a usual one.
    const past = (arr, ago) => arr[Math.max(0, arr.length - ago)];
    const list = Array.from({ length: n }, (_, k) => {
        const ago = n - 1 - k;
        const thisOne = ago === 0;
        const sessions = thisOne ? Math.round(past(anyWeekly, 1) * Math.min(1, (DOW + 0.6) / 7)) : past(anyWeekly, ago);
        return {
            week_start: weekStartIso(ago),
            active_members: thisOne ? Math.round(past(active, 1) * Math.min(1, 0.55 + DOW * 0.07)) : past(active, ago),
            sessions,
            minutes: sessions * 48,
        };
    });
    const months = Array.from({ length: 12 }, (_, k) => {
        const [y, m] = TODAY.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1 - (11 - k), 1));
        const ramp = [9, 12, 14, 19, 26, 34, 47, 63, 76, 84, 88, Math.round(88 * Math.min(1, +TODAY.slice(8) / 30 + 0.1))];
        return { month: d.toISOString().slice(0, 7), active_members: ramp[k], sessions: ramp[k] * 13 };
    });
    return {
        members: MEMBERS,
        min_members: 5,
        tz: TZ,
        week_start: london(MONDAY).toISOString(),
        active_4w: 84,
        sharing: 23,
        weeks: list,
        active_prev_4w: 79,
        mix: [
            { type: 'gym', members: 78, sessions: 702, minutes: 40_300, km: 0, prev_sessions: 655, change_pct: 2 },
            { type: 'walking', members: 44, sessions: 210, minutes: 9_900, km: 846.2, prev_sessions: 199, change_pct: 0 },
            { type: 'running', members: 31, sessions: 148, minutes: 7_950, km: 1_214.6, prev_sessions: 104, change_pct: 34 },
            { type: 'hiit', members: 18, sessions: 52, minutes: 2_200, km: 0, prev_sessions: 49, change_pct: 0 },
            { type: 'cycling', members: 12, sessions: 41, minutes: 3_050, km: 1_120.4, prev_sessions: 47, change_pct: -18 },
            { type: 'yoga', members: 9, sessions: 27, minutes: 1_620, km: 0, prev_sessions: 22, change_pct: 16 },
        ],
        other_sessions: 11,
        segments: [{ type: 'gym', members: 64 }, { type: 'running', members: 11 }, { type: 'walking', members: 6 }, { type: 'hiit', members: 4 }],
        segments_other: 3,
        inactive_8w: MEMBERS - 88,
        consistency: { none: MEMBERS - 84, low: 41, mid: 30, high: 13 },
        weekdays: [262, 248, 236, 224, 184, 208, 132],
        hours: [0, 0, 0, 0, 2, 31, 128, 140, 96, 72, 58, 44, 82, 68, 34, 38, 90, 186, 204, 142, 84, 26, 7, 1],
        months,
        gym_sessions: { here: 1_302, other_gyms: 96, elsewhere: 141 },
        quiet: DRIFTING,
        slowing: SLIPPING,
    };
}

// ── Partner discounts (Clash+): what Discounts and the event builder's partner code read ──
const PEAK_DISCOUNT = {
    reward_id: REWARD.id,
    brand_name: BRAND.name,
    title: REWARD.title,
    label: PEAK_REWARD.label,
    value: '25% off',
    offer: REWARD.offer,
    terms: REWARD.terms,
    image_url: BRAND.logo_url,
    hero_image_url: BRAND.hero_url,
    brand_color: '#1F6F4A',
    kind: 'shared',
    available: null,
    in_stock: true,
    event_ok: true,
    claim: null,
};

// ── Event pushes (Events detail and the builder) ──
function pushStatus(id) {
    const ev = EVENT_LIST.find((e) => e.id === id);
    if (!ev) return reply(400, { code: 'P0002', message: 'Event not found' });
    const over = ['revealed', 'settled', 'archived', 'cancelled'].includes(ev.status);
    const sent = [];
    if (ev.status !== 'scheduled') {
        sent.push({ kind: 'announce', day: null, source: 'auto', recipients: 118, at: ev.published_at });
        sent.push({ kind: 'kickoff', day: null, source: 'auto', recipients: Math.max(1, ev.participants - 6), at: ev.window_start_at });
        const lastRank = ev.status === 'live' ? at(-1, 18) : new Date(Date.parse(ev.window_end_at) - 6 * 3_600_000).toISOString();
        sent.push({ kind: 'rank', day: 1, source: 'auto', recipients: ev.participants - 3, at: lastRank });
    } else {
        sent.push({ kind: 'announce', day: null, source: 'auto', recipients: 118, at: ev.published_at });
    }
    return {
        announce: true,
        kickoff: true,
        doors: false,
        rank_at: '18:00',
        finale: false,
        editable: !over,
        rank_ready: ev.status === 'live',
        payload: {
            event_id: ev.id, event_slug: ev.slug, event_name: ev.name, gym_name: GYM.name,
            prize: ev.prizes[0]?.label ?? null, starts_at: ev.window_start_at, ends_at: ev.window_end_at,
            doors_open_at: null, venue_only: ev.count_venue_only, activities: null, attendance: 0,
        },
        audience: { people: 131, reachable: 118 },
        registrants: { people: ev.participants, reachable: Math.max(0, ev.participants - 3) },
        sent: sent.sort((a, b) => String(b.at).localeCompare(String(a.at))),
    };
}

// ── Help: what the team has asked POWR ──
const TICKETS = [
    {
        id: '6f1d2c3b-0000-4000-8000-0000000d0003', category: 'gym_help', subject: 'Can our logo go on the event posters too?',
        message: 'We’ve just had new artwork done. Is there a way to get it on the event posters as well as the weekly ones?',
        status: 'open', reply: null, email: OWNER.email, created_at: hoursAgo(20), updated_at: hoursAgo(20),
    },
    {
        id: '6f1d2c3b-0000-4000-8000-0000000d0002', category: 'gym_help', subject: 'The board on our reception TV stopped updating',
        message: 'Since this morning the leaderboard on the front desk TV has shown the same names. The one on the gym floor is fine.',
        status: 'resolved', reply: 'Thanks Sam. That TV had lost its connection overnight. A refresh brings it back, and it now reconnects on its own if it ever drops again.',
        email: OWNER.email, created_at: at(-9, 9, 40), updated_at: at(-9, 13, 5),
    },
    {
        id: '6f1d2c3b-0000-4000-8000-0000000d0001', category: 'gym_event_review', subject: 'First event check: The Canal Street Showdown',
        message: 'Our first challenge, ready for POWR to look over.',
        status: 'closed', reply: 'All good, it’s live in the app. Good luck with it.',
        email: OWNER.email, created_at: at(-46, 15), updated_at: at(-45, 10),
    },
];

// ── The calls ─────────────────────────────────────────────────────────────
const SUMMARY = {
    role: 'owner',
    gym: { id: GYM.id, name: GYM.name, logo_url: GYM.logo_url, logo_bg: GYM.logo_bg, address: GYM.address, image_url: GYM.photo_url },
    portal: { enabled: true, trusted: true, suspended: false, max_active_events: 3 },
    board: BOARD_ROW,
    week_start_at: LEAGUE.week_start_at,
    week_end_at: LEAGUE.week_end_at,
    week: WEEK,
    last_week: LAST,
    members: MEMBERS,
    events: { live: 1, upcoming: 1, finished: 1 },
    days: [
        ...LAST_WEEK.map((sessions, i) => ({ day: addDays(MONDAY, i - 7), sessions, athletes: Math.round(sessions * 0.92) })),
        ...thisWeek.map((sessions, i) => ({ day: addDays(MONDAY, i), sessions, athletes: Math.round(sessions * 0.92) })),
    ],
    now: IN_NOW,
    new_faces: NEW_FACES,
};

const insights = ({ p_weeks } = {}) => {
    const weeks = Math.min(26, Math.max(2, p_weeks ?? 8));
    return {
        tz: TZ,
        weeks: insightWeeks(Math.min(weeks, PAST_WEEKS.length + 1)),
        hours: HOURS_28D,
        days: WEEKDAYS_28D,
        activities: [{ type: 'gym', sessions: 702 }, { type: 'hiit', sessions: 31 }, { type: 'yoga', sessions: 15 }],
        athletes_28d: 81,
        members: MEMBERS,
        top: TOP,
    };
};

const screensOnly = (fn) => (b) => (b.query?.slug === GYM.slug && b.query?.k === GYM.board_key ? fn() : reply(404, { error: 'not_found' }));

export default {
    rest: {
        // Who else the signed-in owner is (App.jsx asks on every load): no brand, no creator, no flags.
        reward_brand_users: [],
        creator_users: [],
        system_config: [],
    },
    rpc: {
        gym_portal_summary: SUMMARY,
        gym_insights: insights,
        gym_profile: PROFILE,
        gym_team: { can_edit: true, members: TEAM },
        gym_list_events: EVENT_LIST,
        gym_event_detail: ({ p_event_id }) => EVENT_LIST.find((e) => e.id === p_event_id) ?? reply(400, { code: 'P0002', message: 'Event not found' }),
        gym_event_board: ({ p_event_id }) => eventBoard(p_event_id),
        gym_event_push_status: ({ p_event_id }) => pushStatus(p_event_id),
        gym_member_activity: ({ p_weeks }) => memberActivity(p_weeks),
        // The drifting nudge: a dry run counts who'd get it; one was nudged inside the fortnight.
        gym_nudge_quiet: ({ p_dry_run, p_user_id }) => (p_user_id
            ? { recipients: 1, cooling: 0, sent: !p_dry_run }
            : { recipients: DRIFTING - 1, cooling: 1, sent: !p_dry_run }),
        gym_partner_discounts: [PEAK_DISCOUNT],
        gym_tickets: TICKETS,
    },
    fn: {
        'gym-board': screensOnly(() => ({ ...WALL, generated_at: new Date().toISOString() })),
        'gym-league': screensOnly(() => ({ ...LEAGUE, generated_at: new Date().toISOString() })),
    },
};
