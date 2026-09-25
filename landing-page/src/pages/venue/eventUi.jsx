import React from 'react';

// How a gym-run event reads in the portal. Times are shown in UK time — every
// gym on POWR is in the UK today, and the server builds the dates in the
// gym's own zone (Europe/London unless its board says otherwise).

const TZ = 'Europe/London';

export const STATUS = {
    draft:     { label: 'Draft',            tone: 'grey'   },
    pending:   { label: 'Waiting for POWR', tone: 'amber'  },
    rejected:  { label: 'Changes needed',   tone: 'red'    },
    scheduled: { label: 'Scheduled',        tone: 'blue'   },
    live:      { label: 'Live',             tone: 'green'  },
    locked:    { label: 'Board sealed',     tone: 'purple' },
    revealed:  { label: 'Winners out',      tone: 'gold'   },
    settled:   { label: 'Finished',         tone: 'grey'   },
    cancelled: { label: 'Cancelled',        tone: 'grey'   },
    pulled:    { label: 'Pulled by POWR',   tone: 'red'    },
};

/** One key for everything the status pill and the page copy switch on. */
export function statusKey(ev) {
    if (ev.status === 'draft') {
        if (ev.review_status === 'pending') return 'pending';
        if (ev.review_status === 'rejected') return 'rejected';
        return 'draft';
    }
    if (ev.status === 'archived') return ev.review_status === 'pulled' ? 'pulled' : 'cancelled';
    return ev.status;
}

const TONES = {
    grey:   'bg-[#F4F4F1] text-[#888] border-[#E6E6E1]',
    amber:  'bg-amber-50 text-amber-700 border-amber-200',
    red:    'bg-red-50 text-red-600 border-red-200',
    blue:   'bg-sky-50 text-sky-700 border-sky-200',
    green:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    purple: 'bg-violet-50 text-violet-700 border-violet-200',
    gold:   'bg-[#E8D200]/15 text-[#8a7600] border-[#E8D200]/40',
};

export function StatusPill({ ev }) {
    const s = STATUS[statusKey(ev)] ?? STATUS.draft;
    return (
        <span className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-[9px] font-black uppercase tracking-[0.2em] whitespace-nowrap ${TONES[s.tone]}`}>
            {s.tone === 'green' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
            {s.label}
        </span>
    );
}

export const fmtDay = (iso) => iso
    ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso))
    : '—';

export const fmtDayTime = (iso) => iso
    ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
    : '—';

/** The last day that counts: the window is half-open, so a minute before it closes. */
export const lastDay = (iso) => iso ? fmtDay(new Date(new Date(iso).getTime() - 60_000).toISOString()) : '—';

/** "Wed 2 Oct → Tue 29 Oct" */
export const scoringRange = (ev) => `${fmtDay(ev.window_start_at)} → ${lastDay(ev.window_end_at)}`;

export const withGym = (text, gymName) => String(text ?? '').replaceAll('{gym}', gymName || 'your gym');

/** What a gym can make count, in the order the builder shows them (the
 *  server's _gym_event_fields accepts exactly these; sleep never counts). */
// [key, chip label, word in a sentence]
export const ACTIVITIES = [
    ['gym', 'Gym', 'gym sessions'], ['running', 'Running', 'running'], ['cycling', 'Cycling', 'cycling'],
    ['swimming', 'Swimming', 'swimming'], ['hiit', 'HIIT', 'HIIT'], ['yoga', 'Yoga', 'yoga'],
    ['sports', 'Sports', 'sports'], ['dance', 'Dance', 'dance'], ['walking', 'Walking and steps', 'walking'],
];
const ACTIVITY_LABEL = Object.fromEntries(ACTIVITIES.map(([k, label]) => [k, label]));

/** "gym sessions, running and walking" */
export function activityList(keys) {
    const words = ACTIVITIES.filter(([k]) => keys?.includes(k)).map(([, , word]) => word);
    if (words.length <= 1) return words[0] ?? '';
    return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** One line for what an event counts, from its row (or the builder's fields). */
export function whatCounts({ count_venue_only, included_activities }, gymName) {
    if (count_venue_only) return `Only sessions at ${gymName || 'your gym'}`;
    if (included_activities?.length) {
        const list = activityList(included_activities);
        return `Only ${list}${included_activities.includes('walking') ? ' (daily steps count as walking)' : ''}`;
    }
    return 'Every verified workout, anywhere';
}
export const activityLabel = (key) => ACTIVITY_LABEL[key] ?? key;

/** "3 days" / "4 weeks" */
export const lengthLabel = (days) => (days >= 14 && days % 7 === 0 ? `${days / 7} weeks` : `${days} day${days === 1 ? '' : 's'}`);

/** Promo media can be a picture or a short video; the file name says which. */
export const isVideo = (url) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url ?? '');

/** "2026-10-02" in UK time, for date inputs. */
export const isoDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Local "YYYY-MM-DDTHH:mm" for a datetime-local input showing UK time. */
export function toLocalInput(iso) {
    if (!iso) return '';
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(iso));
    const get = (t) => parts.find(p => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Back from a UK-time datetime-local value to an ISO instant (DST-safe). */
export function fromLocalInput(value) {
    if (!value) return null;
    const [d, t] = value.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [hh, mm] = t.split(':').map(Number);
    // Start from the same wall time read as UTC, then correct by the zone's
    // offset at that instant (twice, to settle across a clock change).
    let guess = Date.UTC(y, m - 1, day, hh, mm);
    for (let i = 0; i < 2; i++) {
        const shown = toLocalInput(new Date(guess).toISOString());
        const [sd, st] = shown.split('T');
        const [sy, sm, sdd] = sd.split('-').map(Number);
        const [sh, smm] = st.split(':').map(Number);
        guess -= Date.UTC(sy, sm - 1, sdd, sh, smm) - Date.UTC(y, m - 1, day, hh, mm);
    }
    return new Date(guess).toISOString();
}
