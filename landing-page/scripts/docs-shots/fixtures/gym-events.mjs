// What only the Events pages read: the formats (event_templates) and finale
// bonuses (event_point_presets) the builder offers, its live preview of the
// dates and rules (gym_preview_event), each event's people (gym_event_roster)
// and the finale-night door (gym_event_door), plus every write the builder
// and the event page make, so pressing a button in a capture step "works".
//
// The events themselves (gym_list_events, gym_event_detail, gym_event_board,
// gym_event_push_status) are gym-core's. Events only some shots need live here
// as named exports, and a shot adds them with withEvents([...]):
//   FINALE    The Riverton Rumble: a points week whose finale night is tonight
//             at Northpoint. The board is sealed; the door is open.
//   DRAFT     The Northpoint Open: a points week + finale night, still a draft.
//   PENDING / REJECTED   the same draft sent to POWR, and sent back with a note.
// Shapes follow supabase/migrations (the last definition of each function).
import { BRAND, GYM, PEOPLE, photo } from '../world.mjs';
import core, { EVENTS } from './gym-core.mjs';
import { REWARD } from './partner-base.mjs';
import { reply } from '../mock.mjs';

// ── Time, in the gym's zone (as gym-core) ─────────────────────────────────
const TZ = 'Europe/London';
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
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
const DOW = (new Date(`${TODAY}T12:00:00Z`).getUTCDay() + 6) % 7;          // 0 = Monday
const at = (n, hh = 0, mm = 0) => london(addDays(TODAY, n), hh, mm).toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

// ── The formats ───────────────────────────────────────────────────────────
// 20260924200000 (insert), 20260924220000 (push_defaults), 20260925100000 (choices, blurbs).
const tplRow = (f) => ({
    included_activities: null, count_manual: false, count_walking: false, count_streak: false,
    board_size: 20, settle_grace_hours: 12, auto_reveal_after_hours: 72, active: true,
    board_choices: [10, 20, 50], radius_choices: [1, 2, 5], night_hour_choices: [], night_length_choices: [],
    night_start_hour: null, night_hours: null, allowed_presets: ['none'], default_preset: 'none', ...f,
});
export const TEMPLATE_ROWS = [
    tplRow({
        key: 'monthly', name: 'Monthly challenge', sort_order: 0,
        blurb: 'Weeks of sessions at {gym}: whoever trains there most wins. Winners revealed after the last day.',
        duration_days: 28, day_choices: [14, 21, 28, 42], count_venue_only: true,
        default_rules: ['Only sessions at {gym} count. Check in with POWR when you arrive.', 'Manually logged workouts don\'t count.', 'Anyone gaming the board can be removed by {gym} or POWR.'],
        push_defaults: { announce: true, kickoff: true, doors: false, rank_at: null },
    }),
    tplRow({
        key: 'sprint', name: 'Weekend sprint', sort_order: 1,
        blurb: 'A short, sharp few days of verified workouts, anywhere. Fridays make a good start.',
        duration_days: 3, day_choices: [2, 3, 4], count_venue_only: false,
        default_rules: ['Any verified workout counts, wherever you train.', 'Manually logged workouts and walking don\'t count.', 'Anyone gaming the board can be removed by {gym} or POWR.'],
        push_defaults: { announce: true, kickoff: true, doors: false, rank_at: '19:00' },
    }),
    tplRow({
        key: 'finale', name: 'Points week + finale night', sort_order: 2,
        blurb: 'Around a week of verified workouts anywhere, then a night at {gym} where the winners are revealed.',
        duration_days: 7, day_choices: [5, 7, 10], count_venue_only: false,
        night_start_hour: 18, night_hours: 3, night_hour_choices: [17, 18, 19, 20], night_length_choices: [2, 3, 4],
        allowed_presets: ['none', 'attend_25', 'attend_50'], default_preset: 'attend_25',
        default_rules: [],
        push_defaults: { announce: true, kickoff: true, doors: true, rank_at: '19:00' },
    }),
];
const tplOf = (key) => TEMPLATE_ROWS.find((t) => t.key === key);

export const PRESET_ROWS = [
    { key: 'none', label: 'No bonus', blurb: 'Rank and your prizes only.', attendance_bonus_points: 0, active: true, sort_order: 0 },
    { key: 'attend_25', label: '+25 for turning up', blurb: 'Everyone who comes to the finale night gets 25 POWR.', attendance_bonus_points: 25, active: true, sort_order: 1 },
    { key: 'attend_50', label: '+50 for turning up', blurb: 'Everyone who comes to the finale night gets 50 POWR.', attendance_bonus_points: 50, active: true, sort_order: 2 },
];

// ── The builder's preview: _gym_event_dates and _gym_event_house_rules ─────
const ORDER = ['gym', 'running', 'cycling', 'swimming', 'hiit', 'yoga', 'sports', 'dance'];
const andList = (a) => (a.length <= 1 ? a[0] ?? null : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
export function houseRules(tpl, venueOnly, acts) {
    const walk = !!acts?.includes('walking');
    const l = ORDER.filter((a) => acts?.includes(a)).map((a) => (a === 'hiit' ? 'HIIT' : a));
    const list = andList(l);
    const all = andList([...l, ...(walk ? ['walking'] : [])]);
    const out = [];
    if (venueOnly && all) out.push(`Only ${all} sessions at {gym} count. Check in with POWR when you arrive.`);
    else if (venueOnly) out.push('Only sessions at {gym} count. Check in with POWR when you arrive.');
    else if (acts == null) out.push('Any verified workout counts, wherever you train.');
    else if (!list) out.push('Only walking counts, including your daily steps.');
    else if (walk) out.push(`Only verified ${list} workouts and walking count, including your daily steps.`);
    else out.push(`Only verified ${list} workouts count, wherever you train.`);
    if (tpl.night_start_hour != null) out.push('The board is sealed after the last day and revealed at the finale night at {gym}.');
    out.push(acts == null && !venueOnly ? 'Manually logged workouts and walking don’t count.' : 'Manually logged workouts don’t count.');
    out.push('Anyone gaming the board can be removed by {gym} or POWR.');
    return out.map((r) => r.replaceAll('{gym}', GYM.name).replaceAll('\'', '’'));
}
export function eventDates(tpl, start, days, hour, len) {
    const end = addDays(start, days ?? tpl.duration_days);
    const out = {
        window_start_at: london(start).toISOString(),
        window_end_at: london(end).toISOString(),
        lock_at: london(end).toISOString(),
        doors_open_at: null,
        doors_close_at: null,
    };
    if (tpl.night_start_hour != null) {
        const h = hour ?? tpl.night_start_hour;
        out.doors_open_at = london(end, h).toISOString();
        out.doors_close_at = london(end, h + (len ?? tpl.night_hours)).toISOString();
    }
    return out;
}
function preview({ p_template_key, p_fields = {} }) {
    const tpl = tplOf(p_template_key);
    if (!tpl) return reply(400, { code: 'P0001', message: 'Pick a kind of event' });
    const f = p_fields;
    const acts = Array.isArray(f.included_activities) ? [...f.included_activities].sort()
        : 'included_activities' in f ? null : tpl.included_activities;
    const house = houseRules(tpl, f.count_venue_only ?? tpl.count_venue_only, acts);
    const dates = /^\d{4}-\d{2}-\d{2}$/.test(f.start_date ?? '')
        ? eventDates(tpl, f.start_date, f.duration_days, f.night_start_hour, f.night_hours)
        : { window_start_at: null, window_end_at: null, lock_at: null, doors_open_at: null, doors_close_at: null };
    const own = (f.rules ?? []).map((r) => String(r).trim()).filter(Boolean);
    return { ...dates, house_rules: house, rules: [...house, ...own] };
}

// ── Events only some shots show ───────────────────────────────────────────
const prize = (rank, label, handed) => ({ rank, label, ...(handed ? { handed_at: handed } : {}) });
const PEAK_REWARD = { brand_name: BRAND.name, title: REWARD.title, label: `${BRAND.name} · 25% off`, value: '25% off', image_url: BRAND.logo_url, available: null };
function gymEvent(n, f) {
    const tpl = tplOf(f.template_key);
    const d = eventDates(tpl, addDays(TODAY, f.startIn), f.duration_days, f.night_start_hour, f.night_hours);
    return {
        id: `6f1d2c3b-0000-4000-8000-0000000f${String(n).padStart(4, '0')}`,
        slug: f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + `-${n}a7c`,
        name: f.name, status: f.status, hidden: false, managed_by: 'gym', editable: true,
        review_status: f.review_status ?? 'approved', review_note: f.review_note ?? null,
        submitted_at: f.submitted_at ?? null, published_at: f.published_at ?? null,
        template_key: tpl.key,
        template: { name: tpl.name, duration_days: tpl.duration_days, finale: tpl.night_start_hour != null, allowed_presets: tpl.allowed_presets, radius_choices: tpl.radius_choices },
        ...d,
        reveal_at: f.reveal_at ?? null, revealed_at: null, results_cut_at: null,
        auto_reveal_at: new Date(Date.parse(d.lock_at) + (12 + 72) * 3_600_000).toISOString(),
        prizes: f.prizes,
        rules: [...houseRules(tpl, false, null), ...(f.own_rules ?? [])],
        promo_headline: f.promo_headline ?? null,
        promo_media_url: f.promo_media_url ?? null,
        points_preset_key: f.preset ?? 'none',
        attendance_bonus_points: PRESET_ROWS.find((p) => p.key === (f.preset ?? 'none')).attendance_bonus_points,
        attendance_paid_at: null,
        audience_radius_km: 2,
        display_token: `docs-event-key-${n}`,
        participants: f.participants ?? 0, disqualified: 0,
        board_size: 20, included_activities: null, count_venue_only: false, count_walking: false,
        own_rules: f.own_rules ?? [], booking_url: null, logo_url: null, logo_only: false,
        duration_days: f.duration_days ?? tpl.duration_days,
        night_start_hour: f.night_start_hour ?? tpl.night_start_hour, night_hours: f.night_hours ?? tpl.night_hours,
        partner_reward_id: f.partner ? REWARD.id : null, partner_reward: f.partner ? PEAK_REWARD : null, partner_codes_issued: 0,
    };
}

// Tonight's finale, 6pm to 9pm. The door only opens two hours before, so its
// shots set the page's clock to FINALE_NIGHT (7:30pm tonight) whatever the
// time the capture runs.
export const FINALE = gymEvent(5, {
    name: 'The Riverton Rumble', template_key: 'finale', status: 'locked', startIn: -7, duration_days: 7,
    night_start_hour: 18, night_hours: 3, preset: 'attend_25', participants: 31,
    submitted_at: at(-15, 10), published_at: at(-15, 10, 30),
    prizes: [prize(1, 'A free month of membership'), prize(2, 'Boxing gloves and wraps'), prize(3, 'Peakform Nutrition protein tub')],
    promo_headline: 'A week of training anywhere, then fight night at Northpoint.', promo_media_url: photo('tunnel.jpg'),
    own_rules: ['The finale night is free for everyone who joined. Bring a friend.'],
});

/** 7:30pm on the finale night, as epoch ms: the clock the door's shots run at. */
export const FINALE_NIGHT = Date.parse(FINALE.doors_open_at) + 90 * 60_000;

const OPEN_FIELDS = {
    name: 'The Northpoint Open', template_key: 'finale', startIn: 15 + ((4 - (DOW + 15) % 7) + 7) % 7, duration_days: 7, night_start_hour: 19, night_hours: 3,
    preset: 'attend_25', partner: true,
    prizes: [prize(1, 'A free month of membership'), prize(2, 'Five PT sessions with Jordan'), prize(3, 'Peakform Nutrition protein tub')],
    promo_headline: 'Seven days, any workout. Then a night at Northpoint.', promo_media_url: photo('tunnel.jpg'),
    own_rules: ['The finale night is free for everyone who joined. Bring a friend.'],
};
export const DRAFT = gymEvent(6, { ...OPEN_FIELDS, status: 'draft' });
export const PENDING = gymEvent(6, { ...OPEN_FIELDS, status: 'draft', review_status: 'pending', submitted_at: hoursAgo(3) });
export const REJECTED = gymEvent(6, {
    ...OPEN_FIELDS, status: 'draft', review_status: 'rejected', submitted_at: hoursAgo(26),
    review_note: 'Looks great. One thing: the 2nd prize names a coach, so add “subject to availability” or name the sessions instead. Then send it again.',
});
/** The builder's value for The Northpoint Open (sessionStorage, as the builder keeps it). */
export const OPEN_START = addDays(TODAY, OPEN_FIELDS.startIn);

// ── People ────────────────────────────────────────────────────────────────
const who = (i) => ({ user_id: PEOPLE[i].id, display_name: PEOPLE[i].name, username: PEOPLE[i].username, avatar_url: null, member_id: PEOPLE[i].powr_id });
const INDEX = Object.fromEntries(PEOPLE.map((p, i) => [p.id, i]));

// The finale's sealed board: [PEOPLE index, POWR].
const FINALE_STANDINGS = [[7, 312], [2, 298], [0, 271], [11, 254], [3, 240], [14, 221], [1, 205], [9, 188], [16, 172], [5, 160],
    [19, 147], [12, 133], [22, 119], [6, 104], [17, 96], [20, 81], [8, 73], [24, 60], [26, 48], [28, 35]];
const finaleBoard = () => ({
    frozen: false,
    rows: FINALE_STANDINGS.map(([i, points], k) => ({ rank: k + 1, ...who(i), points, prize: FINALE.prizes.find((p) => p.rank === k + 1)?.label ?? null })),
});

// Who joined each event: everyone on its board, then regulars, then guests
// (people who never picked Northpoint as their gym: PEOPLE 34–39).
const ROSTER = {
    [EVENTS.live.id]: { total: 38, guests: [34, 35, 36, 37], removed: [27], from: -15 },
    [EVENTS.showdown.id]: { total: 44, guests: [34, 35, 38], removed: [], from: -45 },
    [EVENTS.deadlift.id]: { total: 29, guests: [39], removed: [], from: -84 },
    [EVENTS.sprint.id]: { total: 12, guests: [36, 38], removed: [29], from: -3 },
    [FINALE.id]: { total: 31, guests: [35, 39], removed: [], from: -15 },
};
const boardOf = (id) => (id === FINALE.id ? finaleBoard() : core.rpc.gym_event_board({ p_event_id: id }));
function roster(id) {
    const cfg = ROSTER[id];
    if (!cfg) return [];
    const b = boardOf(id);
    const onBoard = (b?.rows ?? []).map((r) => INDEX[r.user_id]);
    const others = Array.from({ length: 34 }, (_, i) => i).filter((i) => !onBoard.includes(i) && !cfg.removed.includes(i));
    const regular = cfg.total - onBoard.length - cfg.guests.length - cfg.removed.length;
    const ids = [...onBoard, ...others.slice(0, Math.max(0, regular)), ...cfg.guests, ...cfg.removed];
    const span = Math.max(1, Math.min(14, -cfg.from - 1));
    // Joined over the fortnight after it was published, most in the first days.
    const joined = ids.map((i, k) => ({ i, at: new Date(Date.parse(at(cfg.from, 9)) + (((k * 7919) % 97) / 97) ** 2 * span * 864e5 + k * 611_000).toISOString() }));
    return joined
        .sort((a, b) => a.at.localeCompare(b.at))
        .map(({ i, at: joinedAt }) => ({ ...who(i), joined_at: joinedAt, disqualified: cfg.removed.includes(i), guest: cfg.guests.includes(i) }))
        .sort((a, b) => Number(a.disqualified) - Number(b.disqualified));
}

// The door tonight: 19 of the 31 seen by POWR, 2 checked in by hand.
const SEEN = new Set([7, 2, 0, 11, 3, 14, 1, 9, 16, 5, 19, 12, 22, 6, 20, 8, 24, 26, 35]);
const BY_HAND = new Set([17, 28]);
const doorPaid = new Map();     // user_id → paid_at, for check-ins made during a capture
function door(id) {
    if (id !== FINALE.id) return reply(400, { code: 'P0002', message: 'Event not found' });
    const rows = roster(id).filter((r) => !r.disqualified).map((r) => {
        const i = INDEX[r.user_id];
        const hand = BY_HAND.has(i) || doorPaid.has(r.user_id);
        return {
            user_id: r.user_id, display_name: r.display_name, username: r.username, avatar_url: null, member_id: r.member_id,
            seen: SEEN.has(i), paid_at: hand ? (doorPaid.get(r.user_id) ?? hoursAgo(0.4 + (i % 3) * 0.2)) : null, paid_source: hand ? 'door' : null,
        };
    }).sort((a, b) => a.display_name.toLowerCase().localeCompare(b.display_name.toLowerCase()));
    const seen = rows.filter((r) => r.seen).length;
    return {
        band: { from: FINALE.doors_open_at, to: FINALE.doors_close_at, source: 'event' },
        points: FINALE.attendance_bonus_points,
        auto_paid_at: null,
        registered: rows.length,
        seen,
        paid: rows.filter((r) => r.paid_at).length,
        by_hand: rows.filter((r) => r.paid_source === 'door').length,
        hand_cap: Math.max(10, seen),
        rows,
    };
}

// ── Shots that add events ─────────────────────────────────────────────────
const fixGym = (ev) => (ev && ev.rules ? { ...ev, rules: ev.rules.map((r) => r.replaceAll('{gym}', GYM.name).replaceAll('\'', '’')) } : ev);
/**
 * Shot-level fixtures: gym-core's events plus `extra` (replacing any with the
 * same id), with the rules written out as the server stores them.
 */
export function withEvents(extra = [], patch = {}) {
    const byId = (id) => extra.find((e) => e.id === id);
    const all = () => {
        const list = [...extra, ...core.rpc.gym_list_events.filter((e) => !byId(e.id))].map(fixGym);
        return list.sort((a, b) => b.window_start_at.localeCompare(a.window_start_at));
    };
    return {
        rpc: {
            gym_list_events: () => all(),
            gym_event_detail: ({ p_event_id }) => {
                const ev = byId(p_event_id) ?? core.rpc.gym_event_detail({ p_event_id });
                return patch[p_event_id] ? { ...fixGym(ev), ...patch[p_event_id] } : fixGym(ev);
            },
            gym_event_board: ({ p_event_id }) => (p_event_id === FINALE.id ? finaleBoard() : byId(p_event_id)?.status === 'draft' ? reply(400, { code: 'P0001', message: 'Not published' }) : core.rpc.gym_event_board({ p_event_id })),
            gym_event_push_status: ({ p_event_id }) => {
                const ev = byId(p_event_id);
                if (!ev) {
                    // The day-one push goes out in the morning, not at midnight.
                    const s = core.rpc.gym_event_push_status({ p_event_id });
                    return s?.sent ? { ...s, sent: s.sent.map((x) => (x.kind === 'kickoff' ? { ...x, at: new Date(Date.parse(x.at) + 8 * 3_600_000).toISOString() } : x)) } : s;
                }
                return {
                    announce: true, kickoff: true, doors: true, rank_at: '19:00', finale: ev.template.finale,
                    editable: true, rank_ready: false,
                    payload: {
                        event_id: ev.id, event_slug: ev.slug, event_name: ev.name, gym_name: GYM.name, prize: ev.prizes[0]?.label ?? null,
                        starts_at: ev.window_start_at, ends_at: ev.window_end_at, doors_open_at: ev.doors_open_at,
                        venue_only: ev.count_venue_only, activities: null, attendance: ev.attendance_bonus_points,
                    },
                    audience: { people: 131, reachable: 118 },
                    registrants: { people: ev.participants, reachable: Math.max(0, ev.participants - 3) },
                    sent: ev.status === 'draft' ? [] : [
                        { kind: 'announce', day: null, source: 'auto', recipients: 118, at: ev.published_at },
                        { kind: 'kickoff', day: null, source: 'auto', recipients: ev.participants - 6, at: ev.window_start_at },
                        { kind: 'doors', day: null, source: 'auto', recipients: ev.participants - 2, at: at(0, 9) },
                    ],
                };
            },
        },
    };
}

// ── The calls ─────────────────────────────────────────────────────────────
const findEvent = (id) => [FINALE, DRAFT].find((e) => e.id === id) ?? core.rpc.gym_event_detail({ p_event_id: id });

export default {
    rest: {
        event_templates: TEMPLATE_ROWS,
        event_point_presets: PRESET_ROWS,
    },
    rpc: {
        gym_preview_event: preview,
        gym_event_roster: ({ p_event_id }) => roster(p_event_id),
        gym_event_door: ({ p_event_id }) => door(p_event_id),
        // Writes: each answers as the server would, nothing is kept between shots.
        gym_create_event: ({ p_template_key, p_fields }) => ({ ...DRAFT, template_key: p_template_key, name: p_fields?.name ?? DRAFT.name }),
        gym_update_event: ({ p_event_id, p_fields }) => ({ ...findEvent(p_event_id), ...p_fields }),
        gym_publish_event: ({ p_event_id }) => ({ ...findEvent(p_event_id), status: 'scheduled', published_at: new Date().toISOString() }),
        gym_withdraw_event: ({ p_event_id }) => ({ ...findEvent(p_event_id), status: 'draft', review_status: 'approved' }),
        gym_delete_event: { ok: true },
        gym_cancel_event: ({ p_event_id }) => ({ ...findEvent(p_event_id), status: 'archived', review_status: 'approved' }),
        gym_reveal_event: ({ p_event_id }) => ({ ...findEvent(p_event_id), status: 'revealed', revealed_at: new Date().toISOString() }),
        gym_set_reveal_at: ({ p_event_id, p_reveal_at }) => ({ ...findEvent(p_event_id), reveal_at: p_reveal_at }),
        gym_event_set_push: ({ p_event_id, p_patch }) => {
            const s = core.rpc.gym_event_push_status({ p_event_id });
            return s && !s.status ? { ...s, ...p_patch } : s;
        },
        gym_event_send_pulse: ({ p_event_id, p_dry_run }) => ({ recipients: Math.max(0, (findEvent(p_event_id)?.participants ?? 1) - 3), sent: !p_dry_run }),
        gym_event_disqualify: ({ p_event_id, p_user_id }) => roster(p_event_id).map((r) => (r.user_id === p_user_id ? { ...r, disqualified: true } : r)),
        gym_event_reinstate: ({ p_event_id, p_user_id }) => roster(p_event_id).map((r) => (r.user_id === p_user_id ? { ...r, disqualified: false } : r)),
        gym_event_checkin: ({ p_event_id, p_user_id }) => { doorPaid.set(p_user_id, new Date().toISOString()); return door(p_event_id); },
        gym_event_prize_handed: ({ p_event_id, p_rank, p_handed }) => (findEvent(p_event_id)?.prizes ?? [])
            .map((p) => (p.rank === p_rank ? (p_handed ? { ...p, handed_at: new Date().toISOString() } : { rank: p.rank, label: p.label }) : p)),
    },
};
