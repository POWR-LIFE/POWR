import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Tv, Trophy, CalendarDays, ArrowRight } from 'lucide-react';
import { useAuth } from '../../App';
import { Page, Card, Micro, PageTitle, Spinner, Empty, fmtNum } from '../../components/portal/ui';
import { fetchGymSummary, fetchGymInsights } from './venueApi';
import { boardName, pctChange, weekLabel } from '../../../../shared/gymBoard.ts';

function Stat({ label, now, before, unit }) {
    const change = pctChange(now ?? 0, before ?? 0);
    return (
        <Card className="p-5 sm:p-6">
            <Micro>{label}</Micro>
            <div className="mt-3 flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl font-extralight tracking-tighter text-[#1A1A1A]">{fmtNum(now)}</span>
                {unit && <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">{unit}</span>}
            </div>
            <div className="mt-2 text-[11px] font-bold">
                {change
                    ? <span className={change.pct >= 0 ? 'text-[#0B7A57]' : 'text-[#B45309]'}>{change.label} vs last week</span>
                    : <span className="text-[#BBBBBB]">Last week: {fmtNum(before)}</span>}
            </div>
        </Card>
    );
}

function Avatar({ row }) {
    const name = boardName(row);
    return row.avatar_url ? (
        <img src={row.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-[#E6E6E1] shrink-0" />
    ) : (
        <div className="w-9 h-9 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/25 flex items-center justify-center text-[11px] font-black text-[#8a7600] uppercase shrink-0">
            {name?.[0] ?? '?'}
        </div>
    );
}

export default function VenueHome() {
    const { gym } = useAuth();
    const [summary, setSummary] = useState(null);
    const [top, setTop] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        Promise.all([fetchGymSummary(gym.partner_id), fetchGymInsights(gym.partner_id, 2)])
            .then(([s, i]) => { if (alive) { setSummary(s); setTop(i?.top ?? []); } })
            .catch(err => { if (alive) setError(err.message); });
        return () => { alive = false; };
    }, [gym.partner_id]);

    if (error) return <Empty title="Couldn't load your gym">{error}</Empty>;
    if (!summary) return <Spinner />;

    const tz = summary.board?.tz ?? 'Europe/London';
    const board = summary.board;
    const events = summary.events ?? {};

    return (
        <Page>
            <PageTitle
                eyebrow="This week"
                title={summary.gym?.name ?? gym.name}
                sub={weekLabel(summary.week_start_at, summary.week_end_at, tz)}
            />

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Stat label="Athletes" now={summary.week?.athletes} before={summary.last_week?.athletes} />
                <Stat label="Sessions" now={summary.week?.sessions} before={summary.last_week?.sessions} />
                <Stat label="Earned here" now={summary.week?.points} before={summary.last_week?.points} unit="POWR" />
                <Stat label="Minutes" now={summary.week?.minutes} before={summary.last_week?.minutes} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                <Card className="p-6 sm:p-8 lg:col-span-2">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <Trophy size={15} className="text-[#8a7600]" />
                            <Micro>Top this week</Micro>
                        </div>
                        <Link to="/venue/members" className="text-[10px] uppercase tracking-[0.25em] font-black">
                            <span className="text-[#8a7600] hover:underline">All members</span>
                        </Link>
                    </div>
                    {top === null ? <Spinner className="py-10" /> : top.length === 0 ? (
                        <p className="text-sm text-[#888] font-light leading-relaxed">
                            Nobody’s earned at {summary.gym?.name ?? 'the gym'} yet this week. The board fills up as members check in.
                        </p>
                    ) : (
                        <div className="divide-y divide-[#F0F0EC]">
                            {top.slice(0, 5).map(row => (
                                <div key={row.rank} className="flex items-center gap-4 py-3">
                                    <span className="w-6 text-[13px] font-black text-[#BBBBBB] tabular-nums">{row.rank}</span>
                                    <Avatar row={row} />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[13px] font-bold text-[#1A1A1A] truncate">{boardName(row)}</div>
                                        <div className="text-[10px] text-[#AAAAAA] font-bold">{row.sessions} session{row.sessions === 1 ? '' : 's'}</div>
                                    </div>
                                    <span className="text-lg font-light tabular-nums text-[#8a7600]">{fmtNum(row.points)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    <p className="text-[11px] text-[#BBBBBB] mt-4 leading-relaxed">
                        Points earned at your gym, the same list the big screen shows. Members who hide themselves from leaderboards never appear by name.
                    </p>
                </Card>

                <div className="space-y-4 sm:space-y-6">
                    <Card className="p-6 sm:p-8" glow={!board}>
                        <div className="flex items-center gap-3 mb-4">
                            <Tv size={15} className="text-[#8a7600]" />
                            <Micro>Your screens</Micro>
                        </div>
                        {board ? (
                            <>
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${board.enabled ? 'bg-emerald-500' : 'bg-[#BBBBBB]'}`} />
                                    <span className="text-[13px] font-bold">{board.enabled ? 'Leaderboard live' : 'Leaderboard paused'}</span>
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                    <span className={`w-2 h-2 rounded-full ${board.league_enabled ? 'bg-emerald-500' : 'bg-[#BBBBBB]'}`} />
                                    <span className="text-[13px] font-bold">{board.league_enabled ? 'Gym League live' : 'Gym League paused'}</span>
                                </div>
                            </>
                        ) : (
                            <p className="text-sm text-[#888] font-light leading-relaxed">
                                Put your weekly leaderboard on the gym TV. It runs itself and resets every Monday.
                            </p>
                        )}
                        <Link to="/venue/screens" className="inline-flex items-center gap-2 mt-5 text-[10px] uppercase tracking-[0.25em] font-black">
                            <span className="text-[#8a7600]">{board ? 'Manage screens' : 'Set up screens'}</span>
                            <ArrowRight size={12} className="text-[#8a7600]" />
                        </Link>
                    </Card>

                    <Card className="p-6 sm:p-8">
                        <div className="flex items-center gap-3 mb-4">
                            <CalendarDays size={15} className="text-[#8a7600]" />
                            <Micro>Events</Micro>
                        </div>
                        {(events.live ?? 0) + (events.upcoming ?? 0) > 0 ? (
                            <p className="text-[13px] font-bold leading-relaxed">
                                {events.live ? `${events.live} live` : ''}{events.live && events.upcoming ? ' · ' : ''}{events.upcoming ? `${events.upcoming} coming up` : ''}
                            </p>
                        ) : (
                            <p className="text-sm text-[#888] font-light leading-relaxed">
                                Nothing on at {summary.gym?.name ?? 'your gym'} right now. A month-long challenge is the easiest place to start.
                            </p>
                        )}
                        <Link to="/venue/events" className="inline-flex items-center gap-2 mt-5 text-[10px] uppercase tracking-[0.25em] font-black">
                            <span className="text-[#8a7600]">{(events.live ?? 0) + (events.upcoming ?? 0) > 0 ? 'Your events' : 'Run an event'}</span>
                            <ArrowRight size={12} className="text-[#8a7600]" />
                        </Link>
                    </Card>

                    <Card className="p-6 sm:p-8">
                        <Micro>Members</Micro>
                        <div className="mt-3 text-4xl font-extralight tracking-tighter">{fmtNum(summary.members)}</div>
                        <p className="text-[12px] text-[#888] font-light leading-relaxed mt-2">
                            POWR members who’ve picked {summary.gym?.name ?? 'your gym'} as their gym.
                        </p>
                    </Card>
                </div>
            </div>
        </Page>
    );
}
