// Clash Nights (/venue/clash-nights, Clash Pro): Northpoint's nights with POWR.
// Shapes follow gym_clash_nights / gym_book_clash_night / gym_cancel_clash_night
// in supabase/migrations/20260927120000_gym_clash_nights.sql.
//
// The story (dates relative to the day the shots are taken, London days):
//   This quarter's night isn't booked yet: the calendar opens on the month of
//   the first date the rules allow, with two nights POWR has already
//   confirmed at other gyms marked Taken.
//   Next quarter: Northpoint first asked for its second Friday, which POWR
//   couldn't do (Not possible, with a note), then for its last Friday, which
//   POWR confirmed (with a note). The quarter after: asked, with a backup
//   date and notes, waiting for POWR.
import { reply } from '../mock.mjs';
import { uid } from '../world.mjs';

const TZ = 'Europe/London';
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const toDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(toDay(s).getTime() + n * 864e5));
const dow = (s) => (toDay(s).getUTCDay() + 6) % 7;                // 0 = Monday
const quarterStart = (s) => { const d = toDay(s); return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)); };
const quarterKey = (s) => { const d = toDay(s); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };
/** The nth Friday (1-based; -1 = last) of the month `months` after quarter q's first month. */
function friday(q, months, nth) {
    const first = new Date(Date.UTC(q.getUTCFullYear(), q.getUTCMonth() + months, 1));
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const fridays = Array.from({ length: days }, (_, i) => iso(new Date(first.getTime() + i * 864e5))).filter((s) => dow(s) === 4);
    return nth < 0 ? fridays[fridays.length + nth] : fridays[nth - 1];
}
const nextQuarter = (q, n) => new Date(Date.UTC(q.getUTCFullYear(), q.getUTCMonth() + 3 * n, 1));
const stamp = (s, hh) => new Date(`${s}T${String(hh).padStart(2, '0')}:00:00Z`).toISOString();

export const RULES = { lead_days: 28, horizon_days: 365, per_year: 4 };
const TODAY = ymd(new Date());
const FIRST = addDays(TODAY, RULES.lead_days);
const LAST = addDays(TODAY, RULES.horizon_days);
const Q0 = quarterStart(FIRST);

// The month the calendar opens on (FIRST's), and the night the form shot picks
// in it: its last Friday the rules allow, with a backup a week later.
const MONTH = FIRST.slice(0, 7);
const inMonth = (s) => s.slice(0, 7) === MONTH && s >= FIRST;
const monthDays = Array.from({ length: 31 }, (_, i) => addDays(`${MONTH}-01`, i)).filter(inMonth);
const fridays = monthDays.filter((s) => dow(s) === 4);
export const PICK = fridays[fridays.length - 1] ?? monthDays[monthDays.length - 1];
export const PICK_BACKUP = addDays(PICK, 7);
// Nights POWR has confirmed at other gyms, in that month: never whose.
export const TAKEN = [monthDays.find((s) => dow(s) === 5), fridays[1]].filter((s) => s && s !== PICK);

const Q1 = nextQuarter(Q0, 1);
const Q2 = nextQuarter(Q0, 2);
const night = (n, f) => ({
    id: uid('clash-night', n), start_time: '19:00', backup_date: null, notes: null, admin_note: null, decided_at: null, ...f,
});
const declinedOn = friday(Q1, 0, 2);
const confirmedOn = friday(Q1, 0, -1);
const askedOn = friday(Q2, 0, 3);
export const BOOKINGS = [
    night(3, {
        night_date: askedOn, start_time: '19:30', backup_date: addDays(askedOn, 7), status: 'requested',
        notes: 'Around 70 expected. Our spring strength challenge ends that week, so we’d like to hand the prizes out on the night.',
        created_at: stamp(addDays(TODAY, -3), 11),
    }),
    night(2, {
        night_date: confirmedOn, status: 'confirmed',
        notes: 'Second try for this quarter. Same plan: the DJ by the rig at the back.',
        admin_note: 'You’re booked. The DJ and photographer are confirmed, and we’ll call you the week before to plan the floor.',
        created_at: stamp(addDays(TODAY, -15), 9), decided_at: stamp(addDays(TODAY, -13), 14),
    }),
    night(1, {
        night_date: declinedOn, status: 'declined',
        admin_note: 'Our crew is at another event that weekend. The quarter is still yours: any other Friday works.',
        created_at: stamp(addDays(TODAY, -19), 10), decided_at: stamp(addDays(TODAY, -17), 16),
    }),
];

const ACTIVE = ['requested', 'confirmed'];
const nights = (bookings = BOOKINGS) => ({
    included: true,
    package: 'pro',
    today: TODAY,
    first_date: FIRST,
    last_date: LAST,
    lead_days: RULES.lead_days,
    per_year: RULES.per_year,
    bookings: [...bookings].sort((a, b) => b.night_date.localeCompare(a.night_date)),
    taken: TAKEN,
});
/** The page as a gym without Clash Pro sees it (the shot passes its package). */
export const notIncluded = (pkg) => ({ ...nights([]), included: false, package: pkg, bookings: [] });

const fail = (message) => reply(400, { code: 'P0001', message, details: null, hint: null });
const fmtLong = (s) => toDay(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// The rules as gym_book_clash_night checks them, so a capture that sends a
// request sees what the gym would.
function book({ p_date, p_start_time = '19:00', p_backup_date = null, p_notes = null }) {
    if (!p_date) return fail('Pick a date');
    if (p_date < FIRST) return fail(`Clash Nights need ${RULES.lead_days} days’ notice. The first date you can pick is ${fmtLong(FIRST)}.`);
    if (p_date > LAST) return fail('You can book up to a year ahead.');
    const t = String(p_start_time).slice(0, 5);
    if (t < '06:00' || t > '21:00') return fail('Pick a start time between 6am and 9pm');
    if (p_backup_date && (p_backup_date < FIRST || p_backup_date > LAST || p_backup_date === p_date)) {
        return fail('The backup date needs the same notice, and must be a different day');
    }
    if (BOOKINGS.some((b) => ACTIVE.includes(b.status) && quarterKey(b.night_date) === quarterKey(p_date))) {
        return fail('You already have a Clash Night in that quarter. It’s one per quarter.');
    }
    if (TAKEN.includes(p_date)) return fail('That night is already taken. Pick another date.');
    return nights([...BOOKINGS, night(9, {
        night_date: p_date, start_time: t, backup_date: p_backup_date, notes: p_notes?.trim() || null,
        status: 'requested', created_at: new Date().toISOString(),
    })]);
}

function cancel({ p_id }) {
    const b = BOOKINGS.find((x) => x.id === p_id);
    if (!b) return reply(400, { code: 'P0002', message: 'Not found' });
    if (!ACTIVE.includes(b.status)) return fail('That night isn’t booked');
    return nights(BOOKINGS.map((x) => (x.id === p_id ? { ...x, status: 'cancelled' } : x)));
}

export default {
    rpc: {
        gym_clash_nights: () => nights(),
        gym_book_clash_night: book,
        gym_cancel_clash_night: cancel,
    },
};
