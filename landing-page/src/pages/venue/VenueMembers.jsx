import React, { useEffect, useState } from 'react';
import { Clock, Compass, Dumbbell, Sparkles, Trophy } from 'lucide-react';
import { useAuth } from '../../App';
import { Page, Card, Micro, PageTitle, Spinner, Empty, fmtNum } from '../../components/portal/ui';
import { fetchGymInsights, fetchMemberActivity } from './venueApi';
import { BarRow, Columns, INK, Stacked } from './charts';
import MemberPeople from './MemberPeople';
import { usePackage } from './packages';
import { memberInsights, changeLabel } from '../../../../shared/memberInsights.ts';
import { activityMeta, boardName, hourLabel, weekdayFull } from '../../../../shared/gymBoard.ts';

// The gym's members on POWR, one question per row and nothing shown twice:
// how many, how engaged (active anywhere, trained here, gone quiet, new); what
// the numbers say; what they do, where and how often; when they come here;
// and, on Pro, the members who share their activity by name.
//
// Two sources: gym_insights is sessions AT the gym (anyone who checked in);
// gym_member_activity (Clash+) is what the members who chose this gym do
// ANYWHERE, anonymous and only from 5 members up. Never sleep, heart rate,
// steps or location.

const WEEKS = 12;
const WHERE = [
    { key: 'here',       label: 'At this gym',       color: INK },
    { key: 'other_gyms', label: 'At other gyms',     color: '#1A1A1A' },
    { key: 'elsewhere',  label: 'Not checked in',    color: '#D8D8D2' },
];
const BANDS = [
    { key: 'high', label: '5 or more days', color: '#8a7600' },
    { key: 'mid',  label: '3 to 4 days',    color: '#B8A600' },
    { key: 'low',  label: '1 to 2 days',    color: '#DCCF66' },
    { key: 'none', label: 'Not at all',     color: '#ECECE8' },
];

function Fact({ label, value, note, tone }) {
    const colour = tone === 'amber' ? 'text-[#B45309]' : tone === 'green' ? 'text-[#0B7A57]' : 'text-[#1A1A1A]';
    return (
        <div className="min-w-0">
            <Micro>{label}</Micro>
            <div className={`mt-1.5 text-3xl font-extralight tracking-tighter tabular-nums leading-none ${colour}`}>{fmtNum(value)}</div>
            {note && <div className="text-[10px] text-[#AAAAAA] font-bold mt-1.5 leading-snug">{note}</div>}
        </div>
    );
}

function Head({ icon: Icon, children, sub }) {
    return (
        <div className="mb-5">
            <div className="flex items-center gap-2.5"><Icon size={14} className="text-[#8a7600]" /><Micro>{children}</Micro></div>
            {sub && <p className="text-[11px] text-[#AAAAAA] mt-1.5 leading-relaxed">{sub}</p>}
        </div>
    );
}

function Change({ pct }) {
    const label = changeLabel(pct);
    if (!label) return null;
    const tone = pct > 0 ? 'text-[#0B7A57]' : pct < 0 ? 'text-[#B45309]' : 'text-[#AAAAAA]';
    return <span className={`text-[10px] font-black tabular-nums ${tone}`}>{label}</span>;
}

function Avatar({ row }) {
    const name = boardName(row);
    return row.avatar_url
        ? <img src={row.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover border border-[#E6E6E1] shrink-0" />
        : <div className="w-7 h-7 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/25 flex items-center justify-center text-[10px] font-black text-[#8a7600] uppercase shrink-0">{name?.[0] ?? '?'}</div>;
}

export default function VenueMembers() {
    const { gym } = useAuth();
    const { pkg } = usePackage();
    const [venue, setVenue] = useState(null);        // gym_insights: sessions at the gym
    const [activity, setActivity] = useState(null);  // gym_member_activity: members anywhere (Clash+)
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        Promise.all([fetchGymInsights(gym.partner_id, WEEKS), fetchMemberActivity(gym.partner_id, WEEKS).catch(() => null)])
            .then(([v, a]) => { if (alive) { setVenue(v); setActivity(a); } })
            .catch(err => { if (alive) setError(err.message); });
        return () => { alive = false; };
    }, [gym.partner_id]);

    if (error) return <Empty title="Couldn't load your members">{error}</Empty>;
    if (!venue) return <Spinner />;

    const tz = venue.tz ?? 'Europe/London';
    const fmtWeek = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(iso));
    const vWeeks = venue.weeks ?? [];
    const weekCols = vWeeks.map((w, i) => ({
        key: w.week_start,
        tick: i === vWeeks.length - 1 ? 'Now' : fmtWeek(w.week_start),
        tip: i === vWeeks.length - 1 ? 'This week' : `Week of ${fmtWeek(w.week_start)}`,
        value: w.athletes ?? 0,
        partial: i === vWeeks.length - 1,
    }));
    const newThisWeek = vWeeks.length ? (vWeeks[vWeeks.length - 1].new_athletes ?? 0) : 0;
    const quietVenue = vWeeks.every(w => !w.sessions);

    const hours = (venue.hours ?? []).map((n, h) => ({ key: h, tick: hourLabel(h), tip: `${hourLabel(h)}–${hourLabel((h + 1) % 24)}`, value: n }));
    const days = (venue.days ?? []).map((n, i) => ({ key: i, tick: weekdayFull(i + 1).slice(0, 3), tip: weekdayFull(i + 1), value: n }));
    const peakHour = hours.reduce((best, h) => (h.value > (best?.value ?? 0) ? h : best), null);
    const peakDay = days.reduce((best, d) => (d.value > (best?.value ?? 0) ? d : best), null);

    const rich = !!activity && !activity.too_few;
    const insights = rich ? memberInsights(activity, { gymName: gym.name, canSeePeople: !!pkg?.features?.people }).slice(0, 3) : [];
    const mix = rich ? (activity.mix ?? []).slice(0, 6) : [];
    const mixMax = Math.max(1, ...mix.map(r => r.sessions));
    const where = rich ? (activity.gym_sessions ?? {}) : null;
    const bands = rich ? (activity.consistency ?? {}) : null;
    const members = activity?.members ?? venue.members ?? 0;

    return (
        <Page>
            <PageTitle eyebrow="Members" title="Your members" sub={gym.name} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                <Card glow className="p-6 sm:p-8 lg:col-span-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-6xl font-extralight tracking-tighter text-[#1A1A1A] tabular-nums leading-none">{fmtNum(members)}</span>
                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">chose {gym.name} as their gym</span>
                    </div>
                    <div className="mt-7 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5">
                        {rich ? (
                            <>
                                <Fact label="Active" value={activity.active_4w} note={activity.active_prev_4w != null ? `anywhere, last 4 weeks · ${fmtNum(activity.active_prev_4w)} before that` : 'anywhere, last 4 weeks'} />
                                <Fact label="Trained here" value={venue.athletes_28d} note="last 28 days" />
                                <Fact label="Gone quiet" value={activity.quiet ?? 0} note={activity.slowing ? `+${activity.slowing} slowing down` : 'in the last 2 weeks'} tone={(activity.quiet ?? 0) > 0 ? 'amber' : undefined} />
                                <Fact label="New here" value={newThisWeek} note="first session this week" tone={newThisWeek > 0 ? 'green' : undefined} />
                            </>
                        ) : (
                            <>
                                <Fact label="Trained here" value={venue.athletes_28d} note="last 28 days" />
                                <Fact label="New here" value={newThisWeek} note="first session this week" tone={newThisWeek > 0 ? 'green' : undefined} />
                                <div className="col-span-2 self-end text-[11px] text-[#AAAAAA] leading-relaxed">
                                    {activity?.too_few
                                        ? `What your members do anywhere appears at ${activity.min_members ?? 5} members, so nobody can be picked out. Members choose their gym in the POWR app.`
                                        : 'What your members do anywhere isn’t available right now.'}
                                </div>
                            </>
                        )}
                    </div>
                    <div className="mt-8">
                        <Micro className="mb-6">People who trained here each week</Micro>
                        {quietVenue ? (
                            <p className="text-[13px] text-[#888] font-light leading-relaxed">Once members check in at {gym.name}, their weeks show up here.</p>
                        ) : (
                            <Columns data={weekCols} label="People who trained here each week" height={190} tickEvery={2} />
                        )}
                    </div>
                </Card>

                <Card className="p-6 sm:p-8 flex flex-col min-h-0">
                    <Head icon={Trophy} sub={`Points earned at ${gym.name}, as the big screen shows them.`}>On the board this week</Head>
                    {(venue.top ?? []).length === 0 ? (
                        <p className="text-[13px] text-[#888] font-light">Nobody’s scored here yet this week.</p>
                    ) : (
                        <ol className="divide-y divide-[#F0F0EC]">
                            {venue.top.slice(0, 10).map(row => (
                                <li key={row.rank} className="flex items-center gap-3 py-1.5 first:pt-0">
                                    <span className={`w-4 text-[12px] font-black tabular-nums ${row.rank === 1 ? 'text-[#8a7600]' : 'text-[#BBBBBB]'}`}>{row.rank}</span>
                                    <Avatar row={row} />
                                    <span className="flex-1 min-w-0 text-[13px] font-bold text-[#1A1A1A] truncate">{boardName(row)}</span>
                                    <span className="text-[10px] font-bold text-[#AAAAAA] tabular-nums">{row.sessions}×</span>
                                    <span className="w-12 text-right text-[14px] font-light tabular-nums text-[#8a7600]">{fmtNum(row.points)}</span>
                                </li>
                            ))}
                        </ol>
                    )}
                    <p className="text-[10px] text-[#BBBBBB] mt-auto pt-4 leading-relaxed">Members who hide from leaderboards are counted, never named.</p>
                </Card>
            </div>

            {insights.length > 0 && (
                <Card className="p-6 sm:p-8">
                    <Head icon={Sparkles}>What the numbers say</Head>
                    <div className="divide-y divide-[#F0F0EC]">
                        {insights.map(i => (
                            <div key={i.key} className="grid grid-cols-1 md:grid-cols-2 gap-1 md:gap-8 py-3.5 first:pt-0 last:pb-0">
                                <div className="text-[13px] text-[#777] leading-snug">{i.finding}</div>
                                <div className="text-[13px] font-bold text-[#1A1A1A] leading-snug">{i.action}</div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                {rich && (
                    <Card className="p-6 sm:p-8">
                        <Head icon={Dumbbell} sub="Anywhere, last 4 weeks. The change is per active member, against the 4 weeks before.">What they do</Head>
                        {mix.length === 0 ? (
                            <p className="text-[13px] text-[#888] font-light">Nothing yet in the last 4 weeks.</p>
                        ) : (
                            <div className="space-y-3.5">
                                {mix.map(r => (
                                    <BarRow key={r.type} label={activityMeta(r.type).label} sub={`${r.members} members`} value={r.sessions} max={mixMax}
                                        right={<span className="inline-flex items-baseline gap-2"><Change pct={r.change_pct} />{fmtNum(r.sessions)}</span>} />
                                ))}
                            </div>
                        )}
                    </Card>
                )}

                {rich && (
                    <Card className="p-6 sm:p-8">
                        <Head icon={Compass} sub="Where their gym sessions happen (last 8 weeks) and how many days a week they train (last 4).">Where, and how often</Head>
                        <div className="space-y-7">
                            <Stacked label="Where their gym sessions happen" segments={WHERE.map(s => ({ ...s, value: where?.[s.key] ?? 0 }))} />
                            <Stacked label="Days a week they train" segments={BANDS.map(s => ({ ...s, value: bands?.[s.key] ?? 0 }))} />
                        </div>
                        <p className="text-[10px] text-[#BBBBBB] mt-5 leading-relaxed">Other gyms are never named. “Not checked in” is a watch or home workout.</p>
                    </Card>
                )}

                <Card className={`p-6 sm:p-8 ${rich ? '' : 'lg:col-span-3'}`}>
                    <Head icon={Clock} sub={`Sessions at ${gym.name}, last 28 days${peakDay?.value ? ` · busiest ${peakDay.tip}${peakHour?.value ? ` around ${peakHour.tick}` : ''}` : ''}.`}>When they come here</Head>
                    {quietVenue ? (
                        <p className="text-[13px] text-[#888] font-light">No check-ins in the last 28 days.</p>
                    ) : (
                        <div className={`grid gap-8 ${rich ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'}`}>
                            <div>
                                <Micro className="mb-6">By hour</Micro>
                                <Columns data={hours} label="Sessions by hour" tickEvery={6} height={110} />
                            </div>
                            <div>
                                <Micro className="mb-6">By day</Micro>
                                <Columns data={days} label="Sessions by weekday" height={110} />
                            </div>
                        </div>
                    )}
                </Card>
            </div>

            <MemberPeople gym={gym} />

            <p className="text-[11px] text-[#AAAAAA] leading-relaxed max-w-3xl">
                Anonymous numbers for the members who chose {gym.name} as their gym: what they do anywhere, not just here. Never their sleep, heart rate,
                steps or where they are. Activities fewer than 3 members did are left out.
            </p>
        </Page>
    );
}
