import React, { useEffect, useState } from 'react';
import { useAuth } from '../../App';
import { Page, Card, Micro, PageTitle, Spinner, Empty, fmtNum } from '../../components/portal/ui';
import { fetchGymInsights } from './venueApi';
import { activityMeta, boardName, hourLabel, weekdayFull } from '../../../../shared/gymBoard.ts';

// Who's training at the gym: counts for everyone who trained here, names only
// for members who show on leaderboards (the same rows the big screen shows).
//
// Charts follow the dataviz rules: one series each (so no legend; the card
// title names it), one hue validated against the white card (#8a7600, the
// portal's gold ink, >= 3:1), columns <= 24px with 4px rounded tops and a gap,
// a recessive hairline grid, hover/focus tooltips, and a table behind every
// chart for screen readers.

const INK = '#8a7600';
const WEEKS = 12;

// The top gridline: the smallest clean number at or above the peak, so the
// tallest column fills most of the plot (55 → 60, not 100).
function niceMax(v) {
    if (v <= 0) return 1;
    const mag = 10 ** Math.floor(Math.log10(v));
    const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(s => s * mag >= v) ?? 10;
    return Math.max(1, Math.round(step * mag));
}

/**
 * Columns from one baseline. `data`: [{ key, tick, value, tip, partial }].
 * `partial` (the week still running) is drawn at half strength and says so.
 */
function Columns({ data, label, unit, height = 160, tickEvery = 1 }) {
    const [hover, setHover] = useState(null);
    const max = niceMax(Math.max(0, ...data.map(d => d.value)));
    const active = hover == null ? null : data[hover];
    return (
        <figure className="m-0" aria-label={label}>
            <div className="relative" style={{ height }}>
                {/* Hairline grid: baseline + the clean max, labelled. */}
                <div className="absolute inset-x-0 bottom-0 border-t border-[#E6E6E1]" />
                <div className="absolute inset-x-0 top-0 border-t border-[#F0F0EC]" />
                <span className="absolute right-0 -top-5 text-[10px] font-bold text-[#BBBBBB] tabular-nums">{fmtNum(max)}{unit ? ` ${unit}` : ''}</span>

                <div className="absolute inset-0 flex items-end justify-between gap-[2px]" onMouseLeave={() => setHover(null)}>
                    {data.map((d, i) => (
                        <button
                            key={d.key}
                            type="button"
                            className="relative flex-1 h-full flex items-end justify-center outline-none group"
                            onMouseEnter={() => setHover(i)}
                            onFocus={() => setHover(i)}
                            onBlur={() => setHover(null)}
                            aria-label={`${d.tip}: ${fmtNum(d.value)}${unit ? ` ${unit}` : ''}`}
                        >
                            <span
                                className="block w-full rounded-t-[4px] transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-[#1A1A1A]"
                                style={{
                                    maxWidth: 24,
                                    height: d.value > 0 ? `${Math.max(2, (d.value / max) * 100)}%` : 0,
                                    background: INK,
                                    opacity: d.partial ? 0.45 : hover === i ? 0.8 : 1,
                                }}
                            />
                        </button>
                    ))}
                </div>

                {active && (
                    <div
                        className="absolute -top-2 z-10 -translate-x-1/2 -translate-y-full pointer-events-none bg-[#1A1A1A] text-white rounded-xl px-3 py-2 shadow-lg whitespace-nowrap"
                        style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
                    >
                        <div className="text-[14px] font-bold tabular-nums">{fmtNum(active.value)}{unit ? ` ${unit}` : ''}</div>
                        <div className="text-[10px] text-white/60 font-bold">{active.tip}{active.partial ? ' (so far)' : ''}</div>
                    </div>
                )}
            </div>

            {/* Ticks sit on their column's centre and may be wider than it; they
                count back from the newest column so "Now" always shows. */}
            <div className="relative h-4 mt-2">
                {data.map((d, i) => ((data.length - 1 - i) % tickEvery === 0 ? (
                    <span
                        key={d.key}
                        className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[9px] font-black uppercase tracking-[0.1em] text-[#BBBBBB]"
                        style={{ left: `${((i + 0.5) / data.length) * 100}%` }}
                    >
                        {d.tick}
                    </span>
                ) : null))}
            </div>

            <table className="sr-only">
                <caption>{label}</caption>
                <tbody>
                    {data.map(d => <tr key={d.key}><th scope="row">{d.tip}</th><td>{d.value}</td></tr>)}
                </tbody>
            </table>
        </figure>
    );
}

function Headline({ label, value, note }) {
    return (
        <div>
            <Micro>{label}</Micro>
            <div className="mt-2 text-4xl font-extralight tracking-tighter text-[#1A1A1A] tabular-nums">{fmtNum(value)}</div>
            {note && <div className="text-[11px] text-[#AAAAAA] font-bold mt-1">{note}</div>}
        </div>
    );
}

export default function VenueMembers() {
    const { gym } = useAuth();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        fetchGymInsights(gym.partner_id, WEEKS)
            .then(d => { if (alive) setData(d); })
            .catch(err => { if (alive) setError(err.message); });
        return () => { alive = false; };
    }, [gym.partner_id]);

    if (error) return <Empty title="Couldn't load your members">{error}</Empty>;
    if (!data) return <Spinner />;

    const tz = data.tz ?? 'Europe/London';
    const weeks = data.weeks ?? [];
    const fmtWeek = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(iso));
    const weekCols = (field) => weeks.map((w, i) => ({
        key: w.week_start,
        tick: i === weeks.length - 1 ? 'Now' : fmtWeek(w.week_start),
        tip: i === weeks.length - 1 ? 'This week' : `Week of ${fmtWeek(w.week_start)}`,
        value: w[field] ?? 0,
        partial: i === weeks.length - 1,
    }));

    const hours = (data.hours ?? []).map((n, h) => ({ key: h, tick: hourLabel(h), tip: `${hourLabel(h)}–${hourLabel((h + 1) % 24)}`, value: n }));
    const days = (data.days ?? []).map((n, i) => ({ key: i, tick: weekdayFull(i + 1).slice(0, 3), tip: weekdayFull(i + 1), value: n }));
    const peakHour = hours.reduce((best, h) => (h.value > (best?.value ?? 0) ? h : best), null);
    const peakDay = days.reduce((best, d) => (d.value > (best?.value ?? 0) ? d : best), null);

    const acts = data.activities ?? [];
    const actMax = Math.max(1, ...acts.map(a => a.sessions));
    const lastFull = weeks.length >= 2 ? weeks[weeks.length - 2] : null;
    const newThisWeek = weeks.length ? weeks[weeks.length - 1].new_athletes : 0;
    const quiet = weeks.every(w => !w.sessions);

    return (
        <Page>
            <PageTitle eyebrow="Members" title="Who's training" sub={`Last ${WEEKS} weeks`} />

            <Card className="p-6 sm:p-8">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                    <Headline label="Members" value={data.members} note="picked your gym" />
                    <Headline label="Trained here" value={data.athletes_28d} note="last 28 days" />
                    <Headline label="Last full week" value={lastFull?.athletes ?? 0} note={lastFull ? `${fmtNum(lastFull.sessions)} sessions` : null} />
                    <Headline label="New this week" value={newThisWeek} note="first session here" />
                </div>
            </Card>

            {quiet ? (
                <Card><Empty title="No sessions yet">Once members check in at {gym.name}, their weeks, busiest hours and favourite activities show up here.</Empty></Card>
            ) : (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                        <Card className="p-6 sm:p-8">
                            <Micro className="mb-1">Athletes per week</Micro>
                            <p className="text-[12px] text-[#AAAAAA] mb-8">Different people who trained here. This week is still running.</p>
                            <Columns data={weekCols('athletes')} label="Athletes per week" tickEvery={2} />
                        </Card>
                        <Card className="p-6 sm:p-8">
                            <Micro className="mb-1">Sessions per week</Micro>
                            <p className="text-[12px] text-[#AAAAAA] mb-8">Every check-in and verified workout at your gym.</p>
                            <Columns data={weekCols('sessions')} label="Sessions per week" tickEvery={2} />
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                        <Card className="p-6 sm:p-8 lg:col-span-2">
                            <Micro className="mb-1">Busiest hours</Micro>
                            <p className="text-[12px] text-[#AAAAAA] mb-8">
                                Sessions by start time, last 28 days{peakHour?.value ? `. Peak: ${peakHour.tip}.` : '.'}
                            </p>
                            <Columns data={hours} label="Sessions by hour, last 28 days" tickEvery={3} height={140} />
                        </Card>
                        <Card className="p-6 sm:p-8">
                            <Micro className="mb-1">Busiest days</Micro>
                            <p className="text-[12px] text-[#AAAAAA] mb-8">
                                Last 28 days{peakDay?.value ? `. Peak: ${peakDay.tip}.` : '.'}
                            </p>
                            <Columns data={days} label="Sessions by weekday, last 28 days" height={140} />
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                        <Card className="p-6 sm:p-8">
                            <Micro className="mb-6">What they do here</Micro>
                            {acts.length === 0 ? (
                                <p className="text-sm text-[#888] font-light">Nothing in the last 28 days.</p>
                            ) : (
                                <div className="space-y-4">
                                    {acts.map(a => (
                                        <div key={a.type}>
                                            <div className="flex items-baseline justify-between text-[12px] font-bold mb-1.5">
                                                <span className="text-[#1A1A1A]">{activityMeta(a.type).label}</span>
                                                <span className="text-[#888] tabular-nums">{fmtNum(a.sessions)}</span>
                                            </div>
                                            <div className="h-2 rounded-full bg-[#F4F4F1]">
                                                <div className="h-full rounded-full" style={{ width: `${(a.sessions / actMax) * 100}%`, background: INK }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>

                        <Card className="p-6 sm:p-8 lg:col-span-2">
                            <Micro className="mb-6">Top 10 this week</Micro>
                            {(data.top ?? []).length === 0 ? (
                                <p className="text-sm text-[#888] font-light">Nobody’s earned here yet this week.</p>
                            ) : (
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                                            <th className="pb-3 w-10 font-black">#</th>
                                            <th className="pb-3 font-black">Member</th>
                                            <th className="pb-3 text-right font-black">Sessions</th>
                                            <th className="pb-3 text-right font-black">POWR</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#F0F0EC]">
                                        {data.top.map(row => (
                                            <tr key={row.rank} className="text-[13px]">
                                                <td className="py-3 font-black text-[#BBBBBB] tabular-nums">{row.rank}</td>
                                                <td className="py-3">
                                                    <div className="font-bold text-[#1A1A1A] truncate max-w-[14rem]">{boardName(row)}</div>
                                                    {row.username && row.display_name && <div className="text-[10px] text-[#AAAAAA] font-bold">@{row.username}</div>}
                                                </td>
                                                <td className="py-3 text-right tabular-nums text-[#888]">{row.sessions}</td>
                                                <td className="py-3 text-right tabular-nums font-bold">{fmtNum(row.points)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                            <p className="text-[11px] text-[#BBBBBB] mt-4 leading-relaxed">
                                Members who hide themselves from leaderboards are counted above but never named.
                            </p>
                        </Card>
                    </div>
                </>
            )}
        </Page>
    );
}
