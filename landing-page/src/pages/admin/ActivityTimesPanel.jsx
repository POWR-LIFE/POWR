import React, { useMemo, useState } from 'react';
import {
    Clock, Moon, Footprints, Dumbbell, Wind, Bike, Waves, Flame, PersonStanding, Trophy, Music, Activity,
} from 'lucide-react';
import {
    buildActivityTimes,
    resolveTimezone,
    hourLabel,
    hourRange,
    clockLabel,
    durationLabel,
} from '../../../../shared/activityTimes.ts';

// When in the day a member sleeps, walks and works out — in THEIR local time.
// Workouts, gym visits and sleep come from activity_sessions (real start/end
// times). Steps come from daily_step_hours: walking sessions are one row per
// day, so steps per hour is the only record of when a member walks.

const ROW_META = {
    sleep:    { label: 'Sleep',    icon: Moon },
    steps:    { label: 'Steps',    icon: Footprints },
    gym:      { label: 'Gym',      icon: Dumbbell },
    running:  { label: 'Running',  icon: Wind },
    cycling:  { label: 'Cycling',  icon: Bike },
    walking:  { label: 'Walks',    icon: Footprints },
    hiit:     { label: 'HIIT',     icon: Flame },
    yoga:     { label: 'Yoga',     icon: PersonStanding },
    swimming: { label: 'Swimming', icon: Waves },
    sports:   { label: 'Sports',   icon: Trophy },
    dance:    { label: 'Dance',    icon: Music },
};

const RANGES = [
    { key: '30', label: '30 days', days: 30 },
    { key: '90', label: '90 days', days: 90 },
    { key: 'all', label: 'All time', days: null },
];

// One hue, light → dark: more of that row's activity in the hour = darker.
// Each row is scaled to its own busiest hour (minutes and steps don't share a scale).
const RAMP = ['#F3EBB0', '#EDDD72', '#E8D200', '#B5A200', '#7A6B00'];
const EMPTY = '#F4F4F1';
const shade = (share) => (share <= 0 ? EMPTY : RAMP[Math.min(RAMP.length - 1, Math.floor(share * RAMP.length))]);

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function summaryFor(row) {
    if (row.kind === 'sleep') {
        if (row.bedtime == null) return { main: 'Naps only', sub: plural(row.total, 'sleep') };
        return {
            main: `Bed ${clockLabel(row.bedtime)} · Up ${clockLabel(row.wake)}`,
            sub: `typical, over ${plural(row.nights, 'night')}`,
        };
    }
    if (row.kind === 'steps') {
        return {
            main: `Most steps ${hourRange(row.peak.from, row.peak.to)}`,
            sub: `avg ${Math.round(row.values[row.peak.from]).toLocaleString()} in that hour · ${plural(row.total, 'day')}`,
        };
    }
    if (row.total === 1) {
        return { main: `Started ${hourRange(row.peak.from, (row.peak.from + 1) % 24)}`, sub: '1 session' };
    }
    return {
        main: `Usually starts ${hourRange(row.peak.from, row.peak.to)}`,
        sub: `${row.peakCount} of ${plural(row.total, 'session')}`,
    };
}

function cellDetail(row, h) {
    const when = hourRange(h, (h + 1) % 24);
    const label = ROW_META[row.key]?.label ?? row.key;
    if (row.kind === 'steps') {
        if (!row.values[h]) return `${label} · ${when} · none`;
        return `${label} · ${when} · avg ${Math.round(row.values[h]).toLocaleString()} steps · on ${row.counts[h]} of ${plural(row.total, 'day')}`;
    }
    if (!row.counts[h]) return `${label} · ${when} · none`;
    if (row.kind === 'sleep') {
        return `${label} · ${when} · asleep on ${row.counts[h]} of ${plural(row.total, 'sleep')} · ${durationLabel(row.values[h])} in total`;
    }
    return `${label} · ${when} · ${plural(row.counts[h], 'session')} · ${durationLabel(row.values[h])} in total`;
}

const AXIS = [0, 6, 12, 18];

export default function ActivityTimesPanel({ sessions, stepHours, timezone }) {
    const [rangeKey, setRangeKey] = useState('30');
    const [hover, setHover] = useState(null); // { key, h }
    const { tz, reported } = useMemo(() => resolveTimezone(timezone), [timezone]);
    const range = RANGES.find(r => r.key === rangeKey);

    const rows = useMemo(() => buildActivityTimes({
        sessions,
        stepHours,
        tz,
        sinceMs: range.days == null ? null : Date.now() - range.days * 86_400_000,
    }), [sessions, stepHours, tz, range.days]);

    // When the step hours start, so "no steps row" reads as "not recorded yet",
    // never as "didn't walk".
    const firstStepDay = stepHours?.length
        ? stepHours.reduce((min, r) => (r.date < min ? r.date : min), stepHours[0].date)
        : null;
    const hasStepsRow = rows.some(r => r.key === 'steps');

    return (
        <section className="bg-white border border-[#E6E6E1] rounded-[2rem] overflow-hidden mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="p-10 border-b border-[#E6E6E1] flex flex-wrap items-center justify-between gap-6">
                <div>
                    <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A] flex items-center gap-3">
                        <Clock size={18} className="text-[#8a7600]" /> Activity Times
                    </h3>
                    <p className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black mt-2">
                        When they’re active · {reported ? `their local time (${tz})` : 'UK time — no timezone reported'}
                    </p>
                </div>
                <div className="flex bg-[#F4F4F1] border border-[#E6E6E1] rounded-full p-1" role="group" aria-label="Time range">
                    {RANGES.map(r => (
                        <button
                            key={r.key}
                            type="button"
                            onClick={() => setRangeKey(r.key)}
                            aria-pressed={rangeKey === r.key}
                            className={`px-4 h-8 rounded-full text-[10px] font-black uppercase tracking-[0.2em] transition-colors ${rangeKey === r.key ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-[#888888] hover:text-[#333333]'}`}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="p-8">
                {rows.length === 0 ? (
                    <div className="py-12 text-center text-[#888888] text-[10px] uppercase tracking-[0.4em] font-black">
                        No timed activity in the last {range.days ? `${range.days} days` : 'period'}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {rows.map(row => {
                            const meta = ROW_META[row.key] ?? { label: row.key, icon: Activity };
                            const Icon = meta.icon;
                            const max = Math.max(...row.values);
                            const sum = summaryFor(row);
                            const hoveredHere = hover?.key === row.key ? hover.h : null;
                            return (
                                <div key={row.key} className="flex items-center gap-4">
                                    <div className="w-28 shrink-0 flex items-center gap-2 text-[#333333]">
                                        <Icon size={14} className="text-[#8a7600] shrink-0" />
                                        <span className="text-[11px] font-black uppercase tracking-[0.15em] truncate">{meta.label}</span>
                                    </div>
                                    <div className="relative flex-1 min-w-0">
                                        <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                                            {row.values.map((v, h) => (
                                                <div
                                                    key={h}
                                                    role="img"
                                                    aria-label={cellDetail(row, h)}
                                                    onMouseEnter={() => setHover({ key: row.key, h })}
                                                    onMouseLeave={() => setHover(null)}
                                                    className={`h-8 rounded-[4px] transition-[outline-color] outline outline-2 -outline-offset-1 ${hoveredHere === h ? 'outline-[#1A1A1A]' : 'outline-transparent'}`}
                                                    style={{ background: shade(max > 0 ? v / max : 0) }}
                                                />
                                            ))}
                                        </div>
                                        {hoveredHere != null && (
                                            <div
                                                className="absolute bottom-full mb-2 z-10 pointer-events-none whitespace-nowrap bg-[#1A1A1A] text-white text-[11px] font-medium px-3 py-2 rounded-lg shadow-lg"
                                                style={hoveredHere < 4
                                                    ? { left: 0 }
                                                    : hoveredHere > 19
                                                        ? { right: 0 }
                                                        : { left: `${((hoveredHere + 0.5) / 24) * 100}%`, transform: 'translateX(-50%)' }}
                                            >
                                                {cellDetail(row, hoveredHere)}
                                            </div>
                                        )}
                                    </div>
                                    <div className="w-52 shrink-0">
                                        <div className="text-[12px] text-[#1A1A1A] font-medium">{sum.main}</div>
                                        <div className="text-[9px] uppercase tracking-[0.25em] text-[#888888] font-black mt-0.5">{sum.sub}</div>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Hour axis, under the cells only */}
                        <div className="flex items-center gap-4 pt-1">
                            <div className="w-28 shrink-0" />
                            <div className="relative flex-1 h-4">
                                {AXIS.map(h => (
                                    <span
                                        key={h}
                                        className="absolute text-[9px] font-black uppercase tracking-[0.15em] text-[#999999]"
                                        style={{ left: `${(h / 24) * 100}%` }}
                                    >
                                        {hourLabel(h)}
                                    </span>
                                ))}
                            </div>
                            <div className="w-52 shrink-0" />
                        </div>
                    </div>
                )}

                <div className="mt-8 pt-6 border-t border-[#E6E6E1] flex flex-wrap items-start justify-between gap-6">
                    <div className="text-[11px] text-[#666666] leading-relaxed max-w-xl space-y-1">
                        {!hasStepsRow && (
                            <p>
                                <span className="font-black text-[#333333]">Steps by hour:</span>{' '}
                                {firstStepDay
                                    ? `none in this range (recorded from ${new Date(firstStepDay + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}).`
                                    : 'not recorded yet. They start arriving once the member is on the app update that records them, with up to 30 days filled in from their phone.'}
                            </p>
                        )}
                        {hasStepsRow && firstStepDay && (
                            <p>
                                <span className="font-black text-[#333333]">Steps by hour</span> recorded from{' '}
                                {new Date(firstStepDay + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}. Before that, walking is a daily total only.
                            </p>
                        )}
                        <p>Each row is shaded against its own busiest hour. Whole-day walking totals have no time, so they’re left out.</p>
                    </div>
                    <div className="flex items-center gap-2" aria-hidden="true">
                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#999999]">Less</span>
                        <span className="w-4 h-4 rounded-[4px]" style={{ background: EMPTY }} />
                        {RAMP.map(c => <span key={c} className="w-4 h-4 rounded-[4px]" style={{ background: c }} />)}
                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#999999]">More</span>
                    </div>
                </div>
            </div>
        </section>
    );
}
