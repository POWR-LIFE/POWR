import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Flag, Lock, Sparkles, Trophy, Users } from 'lucide-react';
import { useAuth } from '../../App';
import { Card, Micro, Spinner, Empty, fmtNum, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { fetchGymEvents, fetchGymInsights, fetchGymLeague, fetchGymSummary, fetchMemberActivity } from './venueApi';
import { boardName, ordinal, pctChange, weekLabel } from '../../../../shared/gymBoard.ts';
import { localGyms, rankGyms, rivalOf, sessionsToClose } from '../../../../shared/gymLeague.ts';
import { usePackage, trialDaysLeft } from './packages';
import { statusKey, fmtDay, lastDay } from './eventUi';

// The page a gym opens most, so it fits one screen and answers five things at
// a glance: how busy this week is (and right now), who's on top, where the
// gym stands against the gyms nearby, what needs doing, and whether the
// community is growing. Only what changes day to day lives here; charts,
// rosters and settings are a click away. On a tall desktop window it fills
// the viewport without scrolling (VenueLayout's fill mode); on a phone it
// stacks. The numbers refresh quietly while the page is open.

const REFRESH_MS = 60_000;
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const isoDayIn = (tz, d = new Date()) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const plural = (n, word) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`;

function Head({ icon: Icon, children, to, linkLabel }) {
    return (
        <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
            <div className="flex items-center gap-2.5"><Icon size={14} className="text-[#8a7600]" /><Micro>{children}</Micro></div>
            {to && (
                <Link to={to} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] font-black">
                    <span className="text-[#8a7600]">{linkLabel}</span><ArrowRight size={11} className="text-[#8a7600]" />
                </Link>
            )}
        </div>
    );
}

function Avatar({ row }) {
    const name = boardName(row);
    return row.avatar_url
        ? <img src={row.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover border border-[#E6E6E1] shrink-0" />
        : <div className="w-7 h-7 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/25 flex items-center justify-center text-[10px] font-black text-[#8a7600] uppercase shrink-0">{name?.[0] ?? '?'}</div>;
}

// ── This week: the pulse ───────────────────────────────────────────────────

function NowPill({ n }) {
    const on = n > 0;
    return (
        <div className={`shrink-0 inline-flex items-center gap-2 h-9 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] whitespace-nowrap ${on ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#888]'}`}>
            <span className={`w-2 h-2 rounded-full ${on ? 'bg-[#E8D200] animate-pulse' : 'bg-[#CCCCCC]'}`} />
            {on ? `${n} in the gym now` : 'Nobody in right now'}
        </div>
    );
}

/** Seven columns, Monday to Sunday: this week's sessions in ink (today in gold), last week's same day as a ghost behind. */
function WeekStrip({ days, tz }) {
    if (!days || days.length < 14) return <div className="flex-1" />;
    const last = days.slice(0, 7);
    const week = days.slice(7);
    const today = isoDayIn(tz);
    const max = Math.max(1, ...week.map(d => d.sessions), ...last.map(d => d.sessions));
    const pct = (n) => `${Math.round((n / max) * 100)}%`;
    return (
        <div className="flex-1 min-h-[88px] flex items-end gap-2 sm:gap-3 mt-3 pt-5" role="img" aria-label="Sessions each day this week, with last week behind">
            {week.map((d, i) => {
                const isToday = d.day === today;
                const future = d.day > today;
                return (
                    <div key={d.day} className="flex-1 min-w-0 h-full flex flex-col">
                        <div className="relative flex-1 min-h-0 flex items-end">
                            <div className="absolute inset-x-0 bottom-0 rounded-t-[4px] bg-[#ECECE8]" style={{ height: pct(last[i]?.sessions ?? 0) }} />
                            {!future && (
                                <div className={`relative w-full rounded-t-[4px] ${isToday ? 'bg-[#E8D200]' : 'bg-[#1A1A1A]'}`}
                                    style={{ height: d.sessions ? pct(d.sessions) : '2px' }}>
                                    {d.sessions > 0 && <span className="absolute -top-[18px] inset-x-0 text-center text-[10px] font-black tabular-nums text-[#1A1A1A]">{d.sessions}</span>}
                                </div>
                            )}
                        </div>
                        <div className={`mt-1.5 text-center text-[9px] font-black uppercase tracking-[0.15em] ${isToday ? 'text-[#8a7600]' : future ? 'text-[#D8D8D2]' : 'text-[#AAAAAA]'}`}>{DAY_LETTERS[i]}</div>
                    </div>
                );
            })}
        </div>
    );
}

function Pulse({ summary, tz }) {
    const wk = summary.week ?? {};
    const lw = summary.last_week ?? {};
    const change = pctChange(wk.sessions ?? 0, lw.sessions ?? 0);
    const today = summary.days ? summary.days.slice(7).find(d => d.day === isoDayIn(tz)) : null;
    return (
        <Card glow className="flex-1 p-6 flex flex-col min-h-0">
            <div className="flex flex-wrap items-start justify-between gap-3 shrink-0">
                <div>
                    <Micro gold>This week</Micro>
                    <div className="mt-2 flex items-baseline gap-3">
                        <span className="text-5xl lg:text-6xl font-extralight tracking-tighter text-[#1A1A1A] tabular-nums leading-none">{fmtNum(wk.sessions)}</span>
                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">sessions</span>
                    </div>
                    <div className="mt-2 text-[12px] font-bold text-[#666]">
                        {people(wk.athletes ?? 0)}
                        {change
                            ? <> · <span className={change.pct > 0 ? 'text-[#0B7A57]' : change.pct < 0 ? 'text-[#B45309]' : 'text-[#AAAAAA]'}>{change.pct === 0 ? 'same as last week' : `${change.label} vs last week`}</span></>
                            : (wk.sessions ?? 0) > 0 && !(lw.sessions > 0) ? <> · <span className="text-[#AAAAAA]">nothing to compare yet</span></> : null}
                    </div>
                </div>
                {summary.now != null && <NowPill n={summary.now} />}
            </div>
            <WeekStrip days={summary.days} tz={tz} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] font-bold text-[#AAAAAA] shrink-0">
                <span>{today ? `Today: ${plural(today.sessions, 'session')} · ${people(today.athletes)}` : 'Sessions checked in at the gym'}</span>
                {summary.days && (
                    <span className="inline-flex items-center gap-3">
                        <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-[3px] bg-[#1A1A1A]" />This week</span>
                        <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-[3px] bg-[#ECECE8]" />Last week</span>
                    </span>
                )}
            </div>
        </Card>
    );
}

// ── Needs you: the agenda ──────────────────────────────────────────────────

const TONE_ORDER = { gold: 0, amber: 1, green: 2, plain: 3, muted: 4 };
const TONE_DOT = { gold: 'bg-[#E8D200]', amber: 'bg-amber-400', green: 'bg-emerald-500', plain: 'bg-[#1A1A1A]', muted: 'bg-[#CCCCCC]' };

const people = (n) => `${fmtNum(n)} ${n === 1 ? 'person' : 'people'}`;

/** What needs doing or is worth knowing, from the events, the package and the screens. */
function agendaFor({ events, pkg, summary }) {
    const items = [];
    const add = (key, text, to, tone = 'plain') => items.push({ key, text, to, tone });
    const all = events ?? [];
    const mine = all.filter(e => e.managed_by === 'gym');
    const of = (list, k) => list.filter(e => statusKey(e) === k);
    of(mine, 'locked').forEach(e => add(e.id, `Reveal the winners of ${e.name}`, `/venue/events/${e.id}`, 'gold'));
    of(mine, 'rejected').forEach(e => add(e.id, `POWR asked for a change to ${e.name}`, `/venue/events/${e.id}`, 'amber'));
    of(all, 'live').forEach(e => add(e.id, `${e.name} is live · ${plural(e.participants ?? 0, 'in').replace(' ins', ' in')} · seals ${lastDay(e.window_end_at)}`, `/venue/events/${e.id}`, 'green'));
    of(mine, 'draft').forEach(e => add(e.id, `${e.name} is still a draft`, `/venue/events/${e.id}`, 'plain'));
    of(all, 'scheduled').forEach(e => add(e.id, `${e.name} starts ${fmtDay(e.window_start_at)} · ${fmtNum(e.participants ?? 0)} joined`, `/venue/events/${e.id}`, 'plain'));
    mine.filter(e => statusKey(e) === 'revealed' && e.revealed_at && Date.now() - new Date(e.revealed_at).getTime() < 7 * 86_400_000
        && !(Array.isArray(e.prizes) && e.prizes.length > 0 && e.prizes.every(p => p.handed_at || p.issued)))
        .forEach(e => add(e.id, `Winners of ${e.name} are out · hand over the prizes`, `/venue/events/${e.id}`, 'plain'));
    of(mine, 'pending').forEach(e => add(e.id, `${e.name} is with POWR for a quick check`, `/venue/events/${e.id}`, 'muted'));
    if (pkg?.on_trial) {
        const d = trialDaysLeft(pkg);
        if (d <= 14) add('trial', `Your free trial ends in ${plural(d, 'day')}`, '/venue/package', 'amber');
    }
    if (!summary.board) add('screens', 'Put your leaderboard on the gym TV', '/venue/screens', 'plain');
    else if (summary.board.enabled === false) add('paused', 'Your leaderboard screen is paused', '/venue/screens', 'muted');
    // Getting started: the poster that gets members on POWR, and a first event.
    let posterMade = false;
    try { posterMade = !!localStorage.getItem(`powr_join_poster_${summary.gym?.id ?? ''}`); } catch { /* fine */ }
    if (!posterMade && (summary.members ?? 0) < 25) add('poster', 'Print the join poster · it puts members on your board', '/venue/poster', 'plain');
    if (mine.length === 0 && pkg?.features?.events) add('first', 'Run your first event', '/venue/events/new', 'plain');
    return items.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]).slice(0, 4);
}

function NeedsYou({ items, canRun, pkg }) {
    const quiet = items.length === 0;
    return (
        <Card className="flex-1 p-6 flex flex-col min-h-0" glow={items[0]?.tone === 'gold'}>
            <Head icon={Sparkles}>{quiet ? 'What’s next' : 'Needs you'}</Head>
            {quiet ? (
                <div className="flex-1 min-h-0 flex flex-col justify-center">
                    <div className="text-2xl font-light tracking-tight text-[#1A1A1A]">All quiet.</div>
                    <p className="text-[13px] text-[#888] leading-relaxed mt-2 max-w-sm">
                        {canRun
                            ? 'An event gets the gym moving: your members see it in the app, the board runs itself, you reveal the winners.'
                            : pkg && !pkg.unknown
                                ? 'Your own challenges, the members dashboard and Studio come with Clash+ and Pro.'
                                : 'Nothing needs your attention right now.'}
                    </p>
                    <div className="mt-5">
                        {canRun
                            ? <Link to="/venue/events/new" className={`${BTN_GOLD} h-11 px-6`} style={{ color: '#080808' }}>Run an event</Link>
                            : pkg && !pkg.unknown ? <Link to="/venue/package" className={`${BTN_GHOST} h-11`}>See packages</Link> : null}
                    </div>
                </div>
            ) : (
                <ul className="flex-1 min-h-0 divide-y divide-[#F0F0EC]">
                    {items.map(it => (
                        <li key={it.key}>
                            <Link to={it.to} className="group flex items-center gap-3 py-3 first:pt-0">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${TONE_DOT[it.tone]}`} />
                                <span className={`flex-1 min-w-0 text-[13px] leading-snug truncate ${it.tone === 'muted' ? 'text-[#888]' : 'font-bold text-[#1A1A1A]'} group-hover:text-[#8a7600]`}>{it.text}</span>
                                <ArrowRight size={13} className="text-[#CCCCCC] group-hover:text-[#8a7600] shrink-0" />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}

// ── The three small cards ──────────────────────────────────────────────────

function TopThisWeek({ top, gymName }) {
    return (
        <Card className="flex-1 p-6 flex flex-col min-h-0">
            <Head icon={Trophy} to="/venue/members" linkLabel="Everyone">Top this week</Head>
            {top === null ? <Spinner className="py-6" /> : top.length === 0 ? (
                <p className="text-[13px] text-[#888] font-light leading-relaxed">Nobody’s scored at {gymName} yet this week. The board fills as members check in.</p>
            ) : (
                <ol className="flex-1 min-h-0 divide-y divide-[#F0F0EC]">
                    {top.slice(0, 5).map(row => (
                        <li key={row.rank} className="flex items-center gap-3 py-1.5 first:pt-0">
                            <span className={`w-4 text-[12px] font-black tabular-nums ${row.rank === 1 ? 'text-[#8a7600]' : 'text-[#BBBBBB]'}`}>{row.rank}</span>
                            <Avatar row={row} />
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-bold text-[#1A1A1A] truncate">{boardName(row)}</div>
                                <div className="text-[10px] font-bold text-[#AAAAAA]">{plural(row.sessions ?? 0, 'session')}</div>
                            </div>
                            <span className="text-[15px] font-light tabular-nums text-[#8a7600]">{fmtNum(row.points)}</span>
                        </li>
                    ))}
                </ol>
            )}
        </Card>
    );
}

function League({ summary, data, error }) {
    const board = summary.board;
    const { pkg } = usePackage();
    const founding = pkg?.package === 'founding';
    const standing = useMemo(() => {
        if (!data?.gyms) return null;
        const host = data.gyms.find(g => g.key === data.host_key) ?? null;
        const local = rankGyms(localGyms(data.gyms, host, data.radius_km));
        const rank = local.findIndex(g => g.key === data.host_key) + 1;
        return { host, local, rank, ...rivalOf(local, data.host_key), radius: data.radius_km };
    }, [data]);

    let body;
    if (!board) {
        body = (
            <div className="flex-1 min-h-0 flex flex-col justify-center">
                <div className="text-2xl font-light tracking-tight text-[#1A1A1A]">Join the Gym League</div>
                <p className="text-[13px] text-[#888] leading-relaxed mt-2">Put your screens up and your gym goes in the Gym League: gym against gym, every week.</p>
            </div>
        );
    } else if (error) {
        body = <p className="text-[13px] text-[#888] font-light">The league isn’t answering right now. Try again in a minute.</p>;
    } else if (!standing) {
        body = <Spinner className="py-6" />;
    } else if (standing.local.length < 2 || !standing.host) {
        body = (
            <div className="flex-1 min-h-0 flex flex-col justify-center">
                <div className="text-2xl font-light tracking-tight text-[#1A1A1A]">Only you within {standing.radius} km</div>
                <p className="text-[13px] text-[#888] leading-relaxed mt-2">No other gym on POWR nearby yet. Widen the radius on Screens to race further afield.</p>
            </div>
        );
    } else {
        const { host, local, rank, rival, ahead } = standing;
        const gap = rival ? Math.abs(host.points_week - rival.points_week) : 0;
        body = (
            <div className="flex-1 min-h-0 flex flex-col justify-center">
                <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-extralight tracking-tighter text-[#1A1A1A] tabular-nums leading-none">{ordinal(rank)}</span>
                    <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">of {local.length} within {standing.radius} km</span>
                </div>
                <div className="mt-2 text-[12px] font-bold text-[#666]">{fmtNum(host.points_week)} POWR this week{founding && <span className="ml-2 inline-flex items-center h-5 px-2 rounded-full bg-[#E8D200]/15 border border-[#E8D200]/50 text-[8px] font-black uppercase tracking-[0.2em] text-[#8a7600] align-middle">Founding gym</span>}</div>
                {rival && (
                    <div className={`mt-1 text-[12px] font-bold ${ahead ? 'text-[#0B7A57]' : 'text-[#B45309]'}`}>
                        {ahead
                            ? (gap > 0 ? `Leading ${rival.name} by ${fmtNum(gap)}` : `Level with ${rival.name}`)
                            : (gap > 0 ? `${fmtNum(gap)} behind ${rival.name} · about ${plural(sessionsToClose(gap), 'session')}` : `Level with ${rival.name}`)}
                    </div>
                )}
            </div>
        );
    }
    return (
        <Card className="flex-1 p-6 flex flex-col min-h-0" glow={!board}>
            <Head icon={Flag} to="/venue/screens" linkLabel={board ? 'Screens' : 'Set up'}>Gym League</Head>
            {body}
        </Card>
    );
}

function Members({ summary, activity, insightsAllowed, gymName }) {
    const quiet = activity && !activity.too_few ? (activity.quiet ?? 0) : null;
    return (
        <Card className="flex-1 p-6 flex flex-col min-h-0">
            <Head icon={Users} to="/venue/members" linkLabel="Members">Members</Head>
            <div className="flex-1 min-h-0 flex flex-col justify-center">
                <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-extralight tracking-tighter text-[#1A1A1A] tabular-nums leading-none">{fmtNum(summary.members)}</span>
                    <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">chose your gym</span>
                </div>
                {summary.new_faces != null && (
                    <div className={`mt-2 text-[12px] font-bold ${summary.new_faces > 0 ? 'text-[#0B7A57]' : 'text-[#666]'}`}>
                        {summary.new_faces > 0 ? `${plural(summary.new_faces, 'new face')} this week` : 'No new faces yet this week'}
                    </div>
                )}
                {quiet != null ? (
                    <div className={`mt-1 text-[12px] font-bold ${quiet > 0 ? 'text-[#B45309]' : 'text-[#666]'}`}>
                        {quiet > 0 ? `${quiet} gone quiet in the last 2 weeks` : 'Nobody’s gone quiet'}
                    </div>
                ) : insightsAllowed === false ? (
                    <div className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-bold text-[#AAAAAA]"><Lock size={11} />Clash Pro names who’s gone quiet</div>
                ) : null}
            </div>
        </Card>
    );
}

// ── The page ───────────────────────────────────────────────────────────────

export default function VenueHome() {
    const { gym } = useAuth();
    const { pkg } = usePackage();
    const canRun = !!pkg?.features?.events;
    const insightsAllowed = pkg && !pkg.unknown ? !!pkg.features?.insights : null;

    const [summary, setSummary] = useState(null);
    const [top, setTop] = useState(null);
    const [events, setEvents] = useState(null);
    const [league, setLeague] = useState(null);
    const [leagueError, setLeagueError] = useState(false);
    const [activity, setActivity] = useState(null);
    const [error, setError] = useState(null);

    const load = useCallback(async (first) => {
        try {
            const [s, i, e] = await Promise.all([
                fetchGymSummary(gym.partner_id),
                fetchGymInsights(gym.partner_id, 2).catch(() => null),
                fetchGymEvents(gym.partner_id).catch(() => null),
            ]);
            setSummary(s);
            setTop(i?.top ?? []);
            if (e) setEvents(e);
            if (s?.board?.slug && s.board.display_token) {
                fetchGymLeague(s.board.slug, s.board.display_token)
                    .then(d => { setLeague(d); setLeagueError(false); })
                    .catch(() => setLeagueError(true));
            }
        } catch (err) {
            if (first) setError(err.message);
        }
    }, [gym.partner_id]);

    useEffect(() => {
        load(true);
        const t = setInterval(() => { if (document.visibilityState === 'visible') load(false); }, REFRESH_MS);
        return () => clearInterval(t);
    }, [load]);

    // Who's gone quiet needs Clash+; the count is the only thing shown here.
    useEffect(() => {
        if (!insightsAllowed) return undefined;
        let alive = true;
        fetchMemberActivity(gym.partner_id, 4).then(a => { if (alive) setActivity(a); }).catch(() => {});
        return () => { alive = false; };
    }, [gym.partner_id, insightsAllowed]);

    if (error) return <Empty title="Couldn’t load your gym" action={<button type="button" onClick={() => window.location.reload()} className={BTN_GHOST}>Try again</button>}>{error}</Empty>;
    if (!summary) return <Spinner />;

    const tz = summary.board?.tz ?? 'Europe/London';
    const name = summary.gym?.name ?? gym.name;
    const board = summary.board;
    const agenda = agendaFor({ events, pkg, summary });

    return (
        <div className="venue-fill-page">
            <div className="creator-rise flex flex-wrap items-end justify-between gap-x-6 gap-y-2 mb-5 lg:mb-6 shrink-0">
                <div className="min-w-0">
                    <Micro gold>Overview</Micro>
                    <h1 className="text-3xl sm:text-4xl font-light tracking-tighter text-[#1A1A1A] leading-none mt-2 truncate">{name}</h1>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.25em] font-black text-[#BBBBBB]">
                    <span>{weekLabel(summary.week_start_at, summary.week_end_at, tz)}</span>
                    {board && (
                        <Link to="/venue/screens" className="inline-flex items-center gap-4">
                            <span className="inline-flex items-center gap-1.5"><i className={`w-1.5 h-1.5 rounded-full ${board.enabled ? 'bg-emerald-500' : 'bg-[#CCCCCC]'}`} /><span className="text-[#888]">Leaderboard {board.enabled ? 'live' : 'paused'}</span></span>
                            <span className="inline-flex items-center gap-1.5"><i className={`w-1.5 h-1.5 rounded-full ${board.league_enabled !== false ? 'bg-emerald-500' : 'bg-[#CCCCCC]'}`} /><span className="text-[#888]">League {board.league_enabled !== false ? 'live' : 'paused'}</span></span>
                        </Link>
                    )}
                </div>
            </div>

            <div className="venue-fill-grid grid gap-4 lg:gap-5 lg:grid-cols-12">
                <div className="creator-rise lg:col-span-7 flex flex-col min-h-0" style={{ animationDelay: '60ms' }}><Pulse summary={summary} tz={tz} /></div>
                <div className="creator-rise lg:col-span-5 flex flex-col min-h-0" style={{ animationDelay: '120ms' }}><NeedsYou items={agenda} canRun={canRun} pkg={pkg} /></div>
                <div className="creator-rise lg:col-span-4 flex flex-col min-h-0" style={{ animationDelay: '180ms' }}><TopThisWeek top={top} gymName={name} /></div>
                <div className="creator-rise lg:col-span-4 flex flex-col min-h-0" style={{ animationDelay: '240ms' }}><League summary={summary} data={league} error={leagueError} /></div>
                <div className="creator-rise lg:col-span-4 flex flex-col min-h-0" style={{ animationDelay: '300ms' }}><Members summary={summary} activity={activity} insightsAllowed={insightsAllowed} gymName={name} /></div>
            </div>
        </div>
    );
}
