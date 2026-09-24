import React, { useEffect, useState } from 'react';
import { Card, Micro, Spinner, fmtNum } from '../../components/portal/ui';
import { fetchMemberActivity } from './venueApi';
import { Columns, INK } from './charts';
import { usePackage } from './packages';
import { memberInsights, changeLabel } from '../../../../shared/memberInsights.ts';
import { activityMeta, weekdayFull } from '../../../../shared/gymBoard.ts';

// What a gym's members do everywhere (Clash+): anonymous numbers across the
// members who picked the gym, from gym_member_activity(). Never sleep, heart
// rate or steps; nothing at all under 5 members, no activity row under 3.
// The findings ("The data") come from shared/memberInsights.ts, under jest.

const WEEKS = 12;

function Headline({ label, value, note }) {
    return (
        <div>
            <Micro>{label}</Micro>
            <div className="mt-2 text-4xl font-extralight tracking-tighter text-[#1A1A1A] tabular-nums">{value}</div>
            {note && <div className="text-[11px] text-[#AAAAAA] font-bold mt-1">{note}</div>}
        </div>
    );
}

/** One labelled bar: the label and value in text ink, the bar in the gold ink. */
function BarRow({ label, value, max, right, sub }) {
    return (
        <div>
            <div className="flex items-baseline justify-between gap-3 text-[12px] font-bold mb-1.5">
                <span className="text-[#1A1A1A] min-w-0 truncate">{label}{sub && <span className="font-normal text-[#AAAAAA]"> · {sub}</span>}</span>
                <span className="text-[#888] tabular-nums shrink-0">{right ?? fmtNum(value)}</span>
            </div>
            <div className="h-2 rounded-full bg-[#F4F4F1]">
                <div className="h-full rounded-full" style={{ width: `${max ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0}%`, background: INK }} />
            </div>
        </div>
    );
}

function Change({ pct }) {
    const label = changeLabel(pct);
    if (!label) return null;
    const tone = pct > 0 ? 'text-[#0B7A57]' : pct < 0 ? 'text-[#B45309]' : 'text-[#AAAAAA]';
    return <span className={`text-[10px] font-black tabular-nums ${tone}`}>{label}</span>;
}

export default function MemberActivity({ gym }) {
    const { pkg } = usePackage();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        fetchMemberActivity(gym.partner_id, WEEKS)
            .then((d) => { if (alive) setData(d); })
            .catch((err) => { if (alive) setError(err.message); });
        return () => { alive = false; };
    }, [gym.partner_id]);

    if (error) return <Card className="p-6 sm:p-8"><Micro>What your members do</Micro><p className="text-sm text-[#888] mt-3">{error}</p></Card>;
    if (!data) return <Spinner className="py-12" />;

    if (data.too_few) {
        return (
            <Card className="p-6 sm:p-8">
                <Micro gold>What your members do</Micro>
                <div className="text-2xl font-light tracking-tight mt-3">Not enough members yet</div>
                <p className="text-[13px] text-[#777] leading-relaxed mt-2 max-w-2xl">
                    {data.members} member{data.members === 1 ? ' has' : 's have'} picked {gym.name} as their gym. These numbers
                    appear at {data.min_members}, so nobody can be picked out. Members choose their gym in the POWR app.
                </p>
            </Card>
        );
    }

    const insights = memberInsights(data, { gymName: gym.name, canSeePeople: !!pkg?.features?.people });
    const mix = data.mix ?? [];
    const sessions4w = mix.reduce((s, r) => s + r.sessions, 0) + (data.other_sessions ?? 0);
    const perWeek = data.active_4w ? (sessions4w / data.active_4w / 4) : 0;
    const mixMax = Math.max(1, ...mix.map((r) => r.sessions));
    const c = data.consistency ?? { none: 0, low: 0, mid: 0, high: 0 };
    const g = data.gym_sessions ?? { here: 0, other_gyms: 0, elsewhere: 0 };
    const gTotal = g.here + g.other_gyms + g.elsewhere;
    const tz = data.tz ?? 'Europe/London';
    const fmtWeek = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(iso));
    const weeks = (data.weeks ?? []).map((w, i, all) => ({
        key: w.week_start,
        tick: i === all.length - 1 ? 'Now' : fmtWeek(w.week_start),
        tip: i === all.length - 1 ? 'This week' : `Week of ${fmtWeek(w.week_start)}`,
        value: w.active_members ?? 0,
        partial: i === all.length - 1,
    }));
    const days = (data.weekdays ?? []).map((n, i) => ({ key: i, tick: weekdayFull(i + 1).slice(0, 3), tip: weekdayFull(i + 1), value: n }));

    return (
        <>
            {/* The data: findings and what to do, as on the Gym Clash sheet. */}
            <Card className="p-6 sm:p-10">
                <Micro gold>The data</Micro>
                <h2 className="text-3xl sm:text-4xl font-light tracking-tighter text-[#1A1A1A] leading-[1.05] mt-3">What your members are telling you</h2>
                {insights.length === 0 ? (
                    <p className="text-[13px] text-[#888] leading-relaxed mt-6 max-w-2xl">
                        Nothing stands out yet. The more your members train, the more this finds.
                    </p>
                ) : (
                    <div className="mt-6 border-t border-[#F0F0EC] divide-y divide-[#F0F0EC]">
                        {insights.map((i) => (
                            <div key={i.key} className="grid grid-cols-1 sm:grid-cols-2 gap-1 sm:gap-8 py-5">
                                <div className="text-[14px] text-[#777] leading-snug">{i.finding}</div>
                                <div className="text-[14px] font-bold text-[#1A1A1A] leading-snug">{i.action}</div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            <Card className="p-6 sm:p-8">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                    <Headline label="Members" value={fmtNum(data.members)} note="picked your gym" />
                    <Headline label="Active" value={fmtNum(data.active_4w)}
                        note={data.active_prev_4w != null ? `last 4 weeks · ${fmtNum(data.active_prev_4w)} the 4 before` : 'last 4 weeks'} />
                    <Headline label="Sessions" value={perWeek ? perWeek.toFixed(1) : '0'} note="a week, per active member" />
                    <Headline label="Gone quiet" value={fmtNum(data.quiet ?? 0)} note={data.slowing ? `+${data.slowing} slowing down` : 'in the last 2 weeks'} />
                </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                <Card className="p-6 sm:p-8">
                    <Micro className="mb-1">What they do, anywhere</Micro>
                    <p className="text-[11px] text-[#AAAAAA] mb-6">Last 4 weeks. The change is per active member, against the 4 weeks before.</p>
                    {mix.length === 0 ? (
                        <p className="text-sm text-[#888] font-light">Nothing yet in the last 4 weeks.</p>
                    ) : (
                        <div className="space-y-4">
                            {mix.map((r) => (
                                <BarRow key={r.type} label={activityMeta(r.type).label} sub={`${r.members} members`} value={r.sessions} max={mixMax}
                                    right={<span className="inline-flex items-baseline gap-2"><Change pct={r.change_pct} />{fmtNum(r.sessions)}</span>} />
                            ))}
                        </div>
                    )}
                </Card>

                <div className="space-y-4 sm:space-y-6">
                    <Card className="p-6 sm:p-8">
                        <Micro className="mb-1">Days a week they train</Micro>
                        <p className="text-[11px] text-[#AAAAAA] mb-6">Averaged over the last 4 weeks.</p>
                        <div className="space-y-4">
                            <BarRow label="5 or more" value={c.high} max={data.members} />
                            <BarRow label="3 to 4" value={c.mid} max={data.members} />
                            <BarRow label="1 to 2" value={c.low} max={data.members} />
                            <BarRow label="Not at all" value={c.none} max={data.members} />
                        </div>
                    </Card>

                    <Card className="p-6 sm:p-8">
                        <Micro className="mb-1">Where their gym sessions happen</Micro>
                        <p className="text-[11px] text-[#AAAAAA] mb-6">Last 8 weeks. Other gyms are never named.</p>
                        <div className="space-y-4">
                            <BarRow label={`At ${gym.name}`} value={g.here} max={gTotal} />
                            <BarRow label="At other gyms" value={g.other_gyms} max={gTotal} />
                            <BarRow label="Not checked in" sub="home, or a watch workout" value={g.elsewhere} max={gTotal} />
                        </div>
                    </Card>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                <Card className="p-6 sm:p-8">
                    <Micro className="mb-1">Active members per week</Micro>
                    <p className="text-[11px] text-[#AAAAAA] mb-6">Members who did anything, anywhere.</p>
                    <Columns data={weeks} label="Active members per week" tickEvery={2} />
                </Card>
                <Card className="p-6 sm:p-8">
                    <Micro className="mb-1">Their busiest days</Micro>
                    <p className="text-[11px] text-[#AAAAAA] mb-6">Sessions by weekday, last 8 weeks.</p>
                    <Columns data={days} label="Sessions by weekday" unit="sessions" />
                </Card>
            </div>

            <p className="text-[11px] text-[#AAAAAA] leading-relaxed max-w-3xl">
                Anonymous numbers for the {data.members} members who picked {gym.name} as their gym: what they do anywhere, not just
                here. Never their sleep, heart rate, steps or where they are. Activities fewer than 3 members did are left out.
            </p>
        </>
    );
}
