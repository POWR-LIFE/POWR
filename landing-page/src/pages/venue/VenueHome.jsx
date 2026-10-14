import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import {
    ArrowRight, CalendarDays, Flag, Flame, Lock, Megaphone, Package, Send, Sparkles, TrendingUp, Trophy, Tv, UserPlus, Users, Zap,
} from 'lucide-react';
import { useAuth } from '../../App';
import { Card, Micro, Spinner, Empty, fmtNum, BTN_GHOST } from '../../components/portal/ui';
import { useToast } from '../../lib/toast';
import { formatLocale } from '../../lib/i18n';
import { serverErrorText } from '../../lib/serverErrors';
import { fetchGymBoard, fetchGymEvents, fetchGymInsights, fetchGymLeague, fetchGymProfile, fetchGymSummary, fetchGymTeam, fetchMemberActivity, nudgeQuietMembers } from './venueApi';
import { Columns } from './charts';
import { pctChange, weekLabel } from '../../../../shared/gymBoard.ts';
import { localGyms, rankByEffort, rankGyms, ranksAtDayStart, rivalOf, sessionsToClose } from '../../../../shared/gymLeague.ts';
import { gymMoves } from '../../../../shared/gymMoves.ts';
import { weekStory, hourName } from '../../../../shared/gymWeek.ts';
import { ordinalIn } from '../../../../shared/venueHomeText.ts';
import { eventPushCopy } from '../../../../supabase/functions/_shared/eventPushCopy.ts';
import { usePackage, trialDaysLeft, PACKAGE_LABEL } from './packages';
import { statusKey, fmtDay, lastDay } from './eventUi';
import WeekPosts from './WeekPosts';
import { postName } from './PostLightbox';
import GymAppCard from './GymAppCard';
import { markDone, useDone, endOfDay } from './doneStore';

// The page a gym opens most. Every card earns its place:
//   This week    how busy, against the same point last week, and right now
//   Worth doing  up to three moves from the gym's own numbers, each with the
//                button that does it (shared/gymMoves.ts picks them)
//   Posts        this week's posts, made from those numbers and the gym's
//                photo, to look through and download (WeekPosts.jsx)
//   In the app   the gym's page as members see it, on a phone, with every
//                part of it (cover, logo, hours, the team) a tap from
//                changing (GymAppCard.jsx)
//   Your people  who's worth a word this week, by name: the leader, the most
//                improved, the session of the week, the longest streak, the new faces
//   Gym League   the race: the table of gyms nearby, the gap, who's in, per member
//   Since        what POWR has recorded at the gym since it joined, and the
//                last 8 weeks (Clash+): is it growing
// Charts, rosters and settings are a click away. The live numbers refresh
// quietly while the page is open; the slower ones every few minutes.

const REFRESH_MS = 60_000;
const SLOW_EVERY = 5;          // insights (the 8 weeks, the board): every 5th refresh
const WEEKS = 9;               // 8 complete weeks + this one: the last 4 against the 4 before
const DAY_LETTERS = [
    'venueHome:days.letter.mon', 'venueHome:days.letter.tue', 'venueHome:days.letter.wed', 'venueHome:days.letter.thu',
    'venueHome:days.letter.fri', 'venueHome:days.letter.sat', 'venueHome:days.letter.sun',
];
// en-CA only for its YYYY-MM-DD shape: a date key, never shown.
const isoDayIn = (tz, d = new Date()) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const sum = (rows, key) => rows.reduce((s, r) => s + (r[key] ?? 0), 0);

/** "3 people" / "1 person", in the reader's language. */
function peopleText(t, n) {
    return t('venueHome:pulse.people', { count: n ?? 0, n: fmtNum(n) });
}

/** A member's name as the board shows it (gymBoard's boardName, with its stand-in translated). */
function nameOf(t, row) {
    return row.display_name || row.username || t('venueHome:people.member');
}

/** The rush hour's ends: the wall's own "5pm" in English, the 24-hour clock ("17:00") otherwise. */
function hourText(lang, h) {
    if (lang === 'en') return hourName(h);
    return new Intl.DateTimeFormat(formatLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, h % 24));
}

/** A gold link inside a sentence: <Trans> fills in its words. */
function GoldLink({ to, children }) {
    return <Link to={to} className="font-bold"><span className="text-[#8a7600]">{children}</span></Link>;
}

function Head({ icon: Icon, children, to, linkLabel }) {
    return (
        <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0"><Icon size={14} className="text-[#8a7600] shrink-0" /><Micro>{children}</Micro></div>
            {to && (
                <Link to={to} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] font-black shrink-0">
                    <span className="text-[#8a7600]">{linkLabel}</span><ArrowRight size={11} className="text-[#8a7600]" />
                </Link>
            )}
        </div>
    );
}

function Avatar({ row, size = 'w-7 h-7', ring = '' }) {
    const { t } = useTranslation();
    const name = nameOf(t, row);
    return row.avatar_url
        ? <img src={row.avatar_url} alt="" title={name} className={`${size} rounded-full object-cover border border-[#E6E6E1] shrink-0 bg-white ${ring}`} />
        : <div title={name} className={`${size} rounded-full bg-[#FBF8E1] border border-[#E8D200]/40 flex items-center justify-center text-[10px] font-black text-[#8a7600] uppercase shrink-0 ${ring}`}>{name?.[0] ?? '?'}</div>;
}

// ── This week: the pulse ───────────────────────────────────────────────────

function NowPill({ n }) {
    const { t } = useTranslation();
    const on = n > 0;
    return (
        <div className={`shrink-0 inline-flex items-center gap-2 h-9 px-4 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] whitespace-nowrap ${on ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#888]'}`}>
            <span className={`w-2 h-2 rounded-full ${on ? 'bg-[#E8D200] animate-pulse' : 'bg-[#CCCCCC]'}`} />
            {on ? t('venueHome:pulse.nowIn', { n }) : t('venueHome:pulse.nobodyIn')}
        </div>
    );
}

/** Seven columns, Monday to Sunday: this week's sessions in ink (today in gold), last week's same day as a ghost behind. */
function WeekStrip({ days, tz }) {
    const { t } = useTranslation();
    if (!days || days.length < 14) return <div className="flex-1" />;
    const last = days.slice(0, 7);
    const week = days.slice(7);
    const today = isoDayIn(tz);
    const max = Math.max(1, ...week.map(d => d.sessions), ...last.map(d => d.sessions));
    const pct = (n) => `${Math.round((n / max) * 100)}%`;
    return (
        <div className="flex-1 min-h-[80px] flex items-end gap-2 sm:gap-3 mt-4 pt-5" role="img" aria-label={t('venueHome:pulse.stripLabel')}>
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
                        <div className={`mt-1.5 text-center text-[9px] font-black uppercase tracking-[0.15em] ${isToday ? 'text-[#8a7600]' : future ? 'text-[#D8D8D2]' : 'text-[#AAAAAA]'}`}>{t(DAY_LETTERS[i])}</div>
                    </div>
                );
            })}
        </div>
    );
}

const TONE_INK = { up: 'text-[#0B7A57]', down: 'text-[#B45309]', even: 'text-[#1A1A1A]', new: 'text-[#1A1A1A]' };

/**
 * The week as a bullet: sessions so far (solid), where the week is heading
 * (dashed), and ticks for a usual week and the best of the last eight. The
 * key underneath carries the numbers, so nothing is colour alone.
 */
function PaceBar({ story }) {
    const { t } = useTranslation();
    const { soFar, projected, usual, best } = story;
    const heading = projected != null && projected > soFar && story.dayIndex < 6 ? projected : null;
    if (!usual && !best && heading == null) return null;
    const max = Math.max(1, soFar, heading ?? 0, usual ?? 0, best ?? 0) * 1.06;
    const pct = (n) => `${Math.min(100, (n / max) * 100)}%`;
    const said = [
        t('venueHome:pace.saidSoFar', { count: soFar, n: fmtNum(soFar) }),
        heading != null && t('venueHome:pace.saidHeading', { n: fmtNum(heading) }),
        usual && t('venueHome:pace.saidUsual', { n: fmtNum(usual) }),
        best && t('venueHome:pace.saidBest', { weeks: story.bestOf, n: fmtNum(best) }),
    ].filter(Boolean).join(', ');
    return (
        <figure className="m-0 mt-4 shrink-0" aria-label={said}>
            <div className="relative h-3">
                <div className="absolute inset-0 rounded-full bg-[#F4F4F1]" />
                {heading != null && <div className="absolute inset-y-0 left-0 rounded-full border-2 border-dashed border-[#E8D200] bg-[#E8D200]/15" style={{ width: pct(heading) }} />}
                <div className="absolute inset-y-0 left-0 rounded-full bg-[#E8D200]" style={{ width: pct(soFar) }} />
                {usual ? <span className="absolute -top-1 -bottom-1 w-[2px] -ml-px rounded-full bg-[#1A1A1A]" style={{ left: pct(usual) }} title={t('venueHome:pace.usualTip', { n: fmtNum(usual) })} /> : null}
                {best && best !== usual ? <span className="absolute -top-1 -bottom-1 w-[2px] -ml-px rounded-full bg-[#8a7600]" style={{ left: pct(best) }} title={t('venueHome:pace.bestTip', { weeks: story.bestOf, n: fmtNum(best) })} /> : null}
            </div>
            <figcaption className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-bold text-[#888]">
                <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-[3px] bg-[#E8D200]" />{t('venueHome:pace.soFar', { n: fmtNum(soFar) })}</span>
                {heading != null && <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-[3px] border-2 border-dashed border-[#E8D200]" />{t('venueHome:pace.bySunday', { n: fmtNum(heading) })}</span>}
                {usual ? <span className="inline-flex items-center gap-1.5"><i className="w-[2px] h-3 rounded-full bg-[#1A1A1A]" />{t('venueHome:pace.usual', { n: fmtNum(usual) })}</span> : null}
                {best && best !== usual ? <span className="inline-flex items-center gap-1.5"><i className="w-[2px] h-3 rounded-full bg-[#8a7600]" />{t('venueHome:pace.best', { n: fmtNum(best) })}</span> : null}
            </figcaption>
        </figure>
    );
}

/**
 * Is this a good week, where is it heading, and is there still time to do
 * something about it (shared/gymWeek.ts reads it): the sentence, the pace
 * against a usual week and the best, the days, who's in, and the rush.
 */
function Pulse({ summary, insights, tz }) {
    const { t, i18n } = useTranslation();
    const wk = summary.week ?? {};
    const todayIso = isoDayIn(tz);
    const story = weekStory({
        days: summary.days, todayIso, soFar: wk.sessions ?? 0, lastWeek: summary.last_week?.sessions ?? 0,
        weeks: insights?.weeks ?? null, weekdays: insights?.days ?? null, hours: insights?.hours ?? null,
    }, t);
    const today = summary.days ? summary.days.slice(7).find(d => d.day === todayIso) : null;
    return (
        <Card glow className="flex-1 p-6 flex flex-col min-h-0">
            <div className="flex flex-wrap items-start justify-between gap-3 shrink-0">
                <div>
                    <Micro gold>{t('venueHome:pulse.title')}</Micro>
                    <div className="mt-2 flex items-baseline gap-3">
                        <span className="text-5xl lg:text-6xl font-extralight tracking-tighter text-[#1A1A1A] tabular-nums leading-none">{fmtNum(wk.sessions)}</span>
                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">{t('venueHome:pulse.sessionsPeople', { count: wk.athletes ?? 0, n: fmtNum(wk.athletes ?? 0) })}</span>
                    </div>
                </div>
                {summary.now != null && <NowPill n={summary.now} />}
            </div>
            <p className={`mt-3 text-[15px] font-bold leading-snug shrink-0 ${TONE_INK[story.tone]}`}>{story.headline}</p>
            <PaceBar story={story} />
            <WeekStrip days={summary.days} tz={tz} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] font-bold text-[#AAAAAA] shrink-0">
                <span>
                    {today
                        ? t('venueHome:pulse.today', { sessions: t('venueHome:pulse.sessions', { count: today.sessions ?? 0, n: fmtNum(today.sessions) }), people: peopleText(t, today.athletes) })
                        : t('venueHome:pulse.checkedIn')}
                    {story.rush && <> · <span className="text-[#666]">{t('venueHome:pulse.busiest', { from: hourText(i18n.language, story.rush.from), to: hourText(i18n.language, story.rush.to) })}</span></>}
                </span>
                {summary.days && (
                    <span className="inline-flex items-center gap-3">
                        <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-[3px] bg-[#1A1A1A]" />{t('venueHome:pulse.thisWeek')}</span>
                        <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-[3px] bg-[#ECECE8]" />{t('venueHome:pulse.lastWeek')}</span>
                    </span>
                )}
            </div>
        </Card>
    );
}

// ── Worth doing: the moves ─────────────────────────────────────────────────

const KIND_ICON = { event: CalendarDays, members: Users, league: Flag, growth: UserPlus, programme: Sparkles, screens: Tv, package: Package };
const LOCK_LABEL = { clash_plus: 'Clash+', pro: PACKAGE_LABEL.pro };
const PILL = 'inline-flex items-center justify-center gap-2 h-9 px-4 rounded-full text-[10px] font-black uppercase tracking-[0.12em] whitespace-nowrap transition-all disabled:opacity-50';
const PILL_GOLD = `${PILL} bg-[#E8D200] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(232,210,0,0.25)]`;
const PILL_GHOST = `${PILL} bg-[#F4F4F1] border border-[#E6E6E1] hover:border-[#E8D200]/50`;

function ActionLink({ action, primary }) {
    const { t } = useTranslation();
    if (action.lock) {
        return (
            <Link to={action.to} className={PILL_GHOST} title={t('venueHome:moves.comesWith', { pkg: LOCK_LABEL[action.lock] })}>
                <Lock size={11} className="text-[#8a7600]" /><span className="text-[#8a7600]">{LOCK_LABEL[action.lock]}</span>
            </Link>
        );
    }
    return (
        <Link to={action.to} className={primary ? PILL_GOLD : PILL_GHOST}>
            <span style={{ color: primary ? '#080808' : '#1A1A1A' }}>{action.label}</span>
            <ArrowRight size={11} style={{ color: primary ? '#080808' : '#8a7600' }} />
        </Link>
    );
}

/**
 * The drifting nudge, sent from here (Clash Pro): the same one push, in
 * POWR's words, as the Retention page. It reaches everyone drifting from
 * their usual visits whose phone POWR can still hear, and who hasn't had
 * one in the last fortnight.
 */
function NudgeAction({ gym, quiet, primary }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [plan, setPlan] = useState(null);     // { recipients, cooling } | { unavailable }
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(null);
    useEffect(() => {
        let alive = true;
        nudgeQuietMembers(gym.partner_id, true)
            .then((r) => { if (alive) setPlan(r); })
            .catch(() => { if (alive) setPlan({ unavailable: true }); });
        return () => { alive = false; };
    }, [gym.partner_id, quiet]);

    if (sent != null) return <span className="inline-flex items-center h-9 text-[11px] font-bold text-[#0B7A57] whitespace-nowrap">{t('venueHome:nudge.sentTo', { n: sent })}</span>;
    if (!plan) return <span className={`${PILL_GHOST} text-[#AAAAAA]`}>{t('venueHome:nudge.counting')}</span>;
    if (!plan.recipients) {
        return plan.cooling
            ? <span className="inline-flex items-center h-9 text-[11px] font-bold text-[#888] whitespace-nowrap">{t('venueHome:nudge.cooling')}</span>
            : <ActionLink action={{ label: t('venueHome:nudge.seeWho'), to: '/venue/retention' }} primary={false} />;
    }
    const send = async () => {
        // The push itself (title and body) previews what members get: English
        // until push previews follow the member's language.
        const copy = eventPushCopy('gym_quiet_nudge', { gym_name: gym.name, weeks: 2 });
        const values = { n: plan.recipients, title: copy.title, body: copy.body };
        const ask = plan.recipients !== quiet ? t('venueHome:nudge.confirmSome', values)
            : plan.recipients === 1 ? t('venueHome:nudge.confirmThem', values)
            : t('venueHome:nudge.confirmAll', values);
        if (!window.confirm(ask)) return;
        setBusy(true);
        try {
            const r = await nudgeQuietMembers(gym.partner_id, false);
            setSent(r.recipients);
            toast.success(t('venueHome:nudge.sentTo', { n: r.recipients }));
        } catch (e) { toast.error(serverErrorText(e)); }
        finally { setBusy(false); }
    };
    return (
        <button type="button" onClick={send} disabled={busy} className={primary ? PILL_GOLD : PILL_GHOST}>
            <Send size={11} style={{ color: primary ? '#080808' : '#8a7600' }} />
            <span style={{ color: primary ? '#080808' : '#1A1A1A' }}>{busy ? t('venueHome:nudge.sending') : t('venueHome:nudge.send', { n: plan.recipients })}</span>
        </button>
    );
}

function Moves({ moves, gym, quiet, onLater }) {
    const { t } = useTranslation();
    return (
        <Card className="flex-1 p-6 flex flex-col min-h-0" glow={!!moves?.[0]?.urgent}>
            <Head icon={Megaphone}>{t('venueHome:moves.title')}</Head>
            {moves == null ? <Spinner className="py-6" /> : moves.length === 0 ? (
                <div className="flex-1 min-h-0 flex flex-col justify-center">
                    <div className="text-2xl font-light tracking-tight text-[#1A1A1A]">{t('venueHome:moves.caughtUp')}</div>
                    <p className="text-[13px] text-[#888] leading-relaxed mt-2 max-w-sm">{t('venueHome:moves.caughtUpBody')}</p>
                </div>
            ) : (
                <ol className="flex-1 min-h-0 flex flex-col divide-y divide-[#F0F0EC]">
                    {moves.map((m, i) => {
                        const Icon = KIND_ICON[m.kind] ?? Sparkles;
                        return (
                            <li key={m.key} className="py-3 first:pt-0 last:pb-0 flex gap-3.5">
                                <span className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.urgent ? 'bg-[#E8D200]' : 'bg-[#F4F4F1] border border-[#E6E6E1]'}`}>
                                    <Icon size={14} className={m.urgent ? 'text-[#080808]' : 'text-[#8a7600]'} />
                                </span>
                                <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-2.5">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[14px] font-bold text-[#1A1A1A] leading-snug">{m.title}</div>
                                        <p className="text-[12px] text-[#888] leading-snug mt-1">{m.detail}</p>
                                        {m.snooze && (
                                            <button type="button" onClick={() => onLater(m)} className="mt-1.5 text-[9px] uppercase tracking-[0.2em] font-black text-[#BBBBBB] hover:text-[#1A1A1A]"
                                                title={m.snooze === 'day' ? t('venueHome:moves.hideDay') : t('venueHome:moves.hideWeek')}>
                                                {t('venueHome:moves.notNow')}
                                            </button>
                                        )}
                                    </div>
                                    <div className="shrink-0">
                                        {m.nudge
                                            ? <NudgeAction gym={gym} quiet={quiet} primary={i === 0} />
                                            : <ActionLink action={m.action} primary={i === 0} />}
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </Card>
    );
}

// ── Your people ────────────────────────────────────────────────────────────

/** "Leo P." / "Leo P. and Priya S." / "Leo P. and 2 more" */
function namesOf(t, rows) {
    const n = rows.map((r) => nameOf(t, r));
    if (n.length > 2) return t('venueHome:people.andMore', { count: n.length - 1, name: n[0], n: n.length - 1 });
    return n.length === 2 ? t('venueHome:people.two', { a: n[0], b: n[1] }) : n.join('');
}

function Shoutout({ icon: Icon, row, what, note }) {
    const { t } = useTranslation();
    return (
        <li className="flex items-center gap-3 py-2 first:pt-0 last:pb-0 min-w-0">
            <Avatar row={row} size="w-8 h-8" />
            <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-[#1A1A1A] truncate">{nameOf(t, row)}</div>
                <div className="text-[11px] text-[#888] truncate">
                    <Icon size={11} className="inline -mt-0.5 mr-1 text-[#8a7600]" /><span className="font-bold text-[#666]">{what}</span>{note && <> · {note}</>}
                </div>
            </div>
        </li>
    );
}

/**
 * Who's worth a word this week, by name: the leader, the most improved, the
 * session of the week, the longest streak and the new faces, straight from
 * the gym's own big-screen feed (so only names the wall already shows;
 * members who hide from leaderboards never appear). Without screens, the
 * board's leader from the insights stands in. The counts sit underneath.
 */
function People({ wall, top, failed, summary, activity }) {
    const { t } = useTranslation();
    const spot = wall?.spotlight ?? null;
    const leader = wall?.standings?.[0] ?? top?.[0] ?? null;
    const shouts = [];
    if (leader && (leader.points ?? 0) > 0) shouts.push({ key: 'lead', icon: Trophy, row: leader, what: t('venueHome:people.leads'), note: t('venueHome:people.points', { n: fmtNum(leader.points) }) });
    if (spot?.improved) shouts.push({ key: 'improved', icon: TrendingUp, row: spot.improved, what: t('venueHome:people.improved'), note: t('venueHome:people.gain', { n: fmtNum(spot.improved.gain) }) });
    if (spot?.session) {
        shouts.push({ key: 'session', icon: Zap, row: spot.session, what: t('venueHome:people.session'), note: t('venueHome:people.sessionNote', { points: fmtNum(spot.session.points), minutes: spot.session.minutes }) });
    }
    const longest = wall?.community_stats?.streaks?.longest;
    if (longest && (longest.streak ?? 0) >= 3) shouts.push({ key: 'streak', icon: Flame, row: longest, what: t('venueHome:people.streak'), note: t('venueHome:people.streakDays', { count: longest.streak, n: longest.streak }) });
    const fresh = spot?.new_members ?? [];
    const quiet = activity && !activity.too_few ? (activity.quiet ?? 0) : null;
    const counts = [
        t('venueHome:people.members', { count: summary.members ?? 0, n: fmtNum(summary.members ?? 0) }),
        quiet != null && t('venueHome:people.drifting', { n: fmtNum(quiet) }),
        summary.new_faces ? t('venueHome:people.newFaces', { count: summary.new_faces, n: fmtNum(summary.new_faces) }) : null,
    ].filter(Boolean).join(' · ');
    return (
        <Card className="flex-1 p-6 flex flex-col min-h-0">
            <Head icon={Users} to="/venue/members" linkLabel={t('venueHome:people.link')}>{t('venueHome:people.title')}</Head>
            {top === null && !wall ? <Spinner className="py-6" /> : shouts.length === 0 && fresh.length === 0 ? (
                <div className="flex-1 min-h-0 flex flex-col justify-center">
                    <div className="text-xl font-light tracking-tight text-[#1A1A1A]">{failed ? t('venueHome:people.failed') : t('venueHome:people.empty')}</div>
                    <p className="text-[13px] text-[#888] leading-relaxed mt-1.5">{failed ? t('venueHome:people.failedBody') : t('venueHome:people.emptyBody')}</p>
                </div>
            ) : (
                <>
                    <ul className="divide-y divide-[#F0F0EC]">
                        {shouts.slice(0, 4).map(({ key, ...x }) => <Shoutout key={key} {...x} />)}
                    </ul>
                    {fresh.length > 0 && (
                        <div className="mt-3 flex items-center gap-2.5 min-w-0">
                            <div className="flex -space-x-2 shrink-0">{fresh.slice(0, 4).map((r) => <Avatar key={r.key ?? nameOf(t, r)} row={r} size="w-7 h-7" ring="ring-2 ring-white" />)}</div>
                            <span className="min-w-0 truncate text-[11px] text-[#666]"><span className="font-bold text-[#0B7A57]">{t('venueHome:people.newThisWeek')}</span> {namesOf(t, fresh)}</span>
                        </div>
                    )}
                    {shouts.length + (fresh.length ? 1 : 0) < 3 && (
                        <p className="mt-3 text-[11px] text-[#AAAAAA] leading-relaxed">{t('venueHome:people.more')}</p>
                    )}
                </>
            )}
            <div className="mt-auto pt-3 border-t border-[#F0F0EC] text-[11px] font-bold text-[#AAAAAA] truncate" style={{ marginTop: 'auto' }}>{counts}</div>
        </Card>
    );
}

// ── Gym League ─────────────────────────────────────────────────────────────

/** Where the gym stands in its local table, from the gym-league payload. */
function standingOf(data) {
    if (!data?.gyms) return null;
    const host = data.gyms.find(g => g.key === data.host_key) ?? null;
    const local = rankGyms(localGyms(data.gyms, host, data.radius_km));
    const rank = local.findIndex(g => g.key === data.host_key) + 1;
    const { rival, ahead } = rivalOf(local, data.host_key);
    const was = ranksAtDayStart(local)[data.host_key];
    const effort = rankByEffort(local).ranked;
    const effortRank = effort.findIndex(r => r.gym.key === data.host_key) + 1;
    return {
        host, local, rank, rival, ahead, radius: data.radius_km,
        gap: rival && host ? Math.abs(host.points_week - rival.points_week) : 0,
        moved: was && rank ? was - rank : 0,
        effortRank, effortOf: effort.length,
    };
}

/**
 * The race, as the league screen runs it: the table of gyms nearby with
 * the gym among them, the gap to the one above (or the lead), who's in
 * each right now, and the per-member table, where size doesn't win.
 */
function League({ board, standing, error, founding }) {
    const { t } = useTranslation();
    const ordinal = (n) => ordinalIn(t, formatLocale(), n);
    let body;
    if (!board) {
        body = (
            <div className="flex-1 min-h-0 flex flex-col justify-center">
                <div className="text-2xl font-light tracking-tight text-[#1A1A1A]">{t('venueHome:league.join')}</div>
                <p className="text-[13px] text-[#888] leading-relaxed mt-2">{t('venueHome:league.joinBody')}</p>
            </div>
        );
    } else if (error) {
        body = <p className="text-[13px] text-[#888] font-light">{t('venueHome:league.error')}</p>;
    } else if (!standing) {
        body = <Spinner className="py-6" />;
    } else if (standing.local.length < 2 || !standing.host) {
        body = (
            <div className="flex-1 min-h-0 flex flex-col justify-center">
                <div className="text-2xl font-light tracking-tight text-[#1A1A1A]">{t('venueHome:league.alone', { km: standing.radius })}</div>
                <p className="text-[13px] text-[#888] leading-relaxed mt-2">{t('venueHome:league.aloneBody')}</p>
            </div>
        );
    } else {
        const { host, local, rank, rival, ahead, gap, moved, effortRank, effortOf } = standing;
        // The top four, and the gym itself underneath when it's lower down.
        const shown = local.slice(0, 4).map((g, i) => ({ g, r: i + 1 }));
        if (rank > 4) shown.push({ g: host, r: rank });
        body = (
            <>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 shrink-0">
                    <span className="text-4xl font-extralight tracking-tighter text-[#1A1A1A] tabular-nums leading-none">{ordinal(rank)}</span>
                    <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">{t('venueHome:league.of', { total: local.length, km: standing.radius })}</span>
                    {moved !== 0 && (
                        <span className={`inline-flex items-center h-5 px-2 rounded-full text-[9px] font-black uppercase tracking-[0.15em] ${moved > 0 ? 'bg-emerald-50 text-[#0B7A57]' : 'bg-amber-50 text-[#B45309]'}`}>
                            {moved > 0 ? '▲' : '▼'} {t('venueHome:league.moved', { n: Math.abs(moved) })}
                        </span>
                    )}
                </div>
                <ol className="mt-3 space-y-1 shrink-0" aria-label={t('venueHome:league.tableLabel')}>
                    {shown.map(({ g, r }) => {
                        const me = g.key === host.key;
                        return (
                            <li key={g.key} className={`flex items-center gap-2.5 h-8 px-2.5 rounded-lg ${me ? 'bg-[#FBF8E1] border border-[#E8D200]/50' : ''}`}>
                                <span className={`w-4 text-[11px] font-black tabular-nums ${r === 1 ? 'text-[#8a7600]' : 'text-[#AAAAAA]'}`}>{r}</span>
                                <span className={`flex-1 min-w-0 truncate text-[12px] ${me ? 'font-black text-[#1A1A1A]' : 'font-bold text-[#666]'}`}>
                                    {/* "Founding": the package's name, like PACKAGE_LABEL's */}
                                    {g.name}{me && founding ? <span className="ml-1.5 text-[8px] font-black uppercase tracking-[0.2em] text-[#8a7600]">Founding</span> : null}
                                </span>
                                {g.in_now > 0 && <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-[#0B7A57]"><i className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{t('venueHome:league.inNow', { n: g.in_now })}</span>}
                                <span className="w-14 shrink-0 text-right text-[12px] font-bold tabular-nums text-[#1A1A1A]">{fmtNum(g.points_week)}</span>
                            </li>
                        );
                    })}
                </ol>
                <div className="mt-auto pt-3 space-y-0.5 shrink-0">
                    {rival && (
                        <div className={`text-[12px] font-bold ${ahead ? 'text-[#0B7A57]' : 'text-[#B45309]'}`}>
                            {ahead
                                ? (gap > 0 ? t('venueHome:league.leading', { rival: rival.name, gap: fmtNum(gap) }) : t('venueHome:league.level', { rival: rival.name }))
                                : (gap > 0
                                    ? t('venueHome:league.behind', { count: sessionsToClose(gap), n: fmtNum(sessionsToClose(gap)), gap: fmtNum(gap), rival: rival.name })
                                    : t('venueHome:league.level', { rival: rival.name }))}
                        </div>
                    )}
                    <div className="text-[11px] text-[#888]">
                        {effortRank > 0 && effortOf >= 2
                            ? <Trans i18nKey="venueHome:league.perMember" values={{ rank: ordinal(effortRank), total: effortOf }}
                                components={{ strong: <span className="font-bold text-[#1A1A1A]" /> }} />
                            : t('venueHome:league.resets')}
                    </div>
                </div>
            </>
        );
    }
    return (
        <Card className="flex-1 p-6 flex flex-col min-h-0" glow={!board}>
            <Head icon={Flag} to="/venue/screens" linkLabel={board ? t('venueHome:league.screens') : t('venueHome:league.setUp')}>Gym Clash</Head>
            {body}
        </Card>
    );
}

// ── Since joining, and the last 8 weeks ────────────────────────────────────

/**
 * What POWR has recorded at the gym since it joined (the wall's all-time
 * block: sessions, people, hours, POWR earned, members who hide from
 * leaderboards left out), with the last 8 weeks underneath on Clash+:
 * whether it's growing, and the first-timers.
 */
function Since({ wall, insights, tz, gymName, locked }) {
    const { t } = useTranslation();
    const all = wall?.community_stats?.all_time;
    const since = all?.since && (all.sessions ?? 0) > 0
        ? new Intl.DateTimeFormat(formatLocale(), { timeZone: tz, month: 'long', year: 'numeric' }).format(new Date(all.since))
        : null;
    const weeks = !locked && insights && !insights.failed ? (insights.weeks ?? []) : null;
    const done = weeks ? weeks.slice(0, -1) : [];
    const last4 = done.slice(-4);
    const prev4 = done.slice(-8, -4);
    const now4 = sum(last4, 'sessions');
    const change = prev4.length === 4 ? pctChange(now4, sum(prev4, 'sessions')) : null;
    const firsts = sum(last4, 'new_athletes');
    const fmtWeek = (iso) => new Intl.DateTimeFormat(formatLocale(), { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(iso)).replace('Sept', 'Sep');
    const shown = weeks ? weeks.slice(-8) : [];
    const cols = shown.map((w, i) => ({
        key: w.week_start,
        tick: i === shown.length - 1 ? t('venueHome:since.now') : fmtWeek(w.week_start),
        tip: i === shown.length - 1 ? t('venueHome:since.thisWeek') : t('venueHome:since.weekOf', { date: fmtWeek(w.week_start) }),
        value: w.sessions ?? 0,
        partial: i === shown.length - 1,
    }));
    const hasWeeks = weeks && weeks.some((w) => w.sessions);
    const loading = !locked && insights == null && !wall;
    return (
        <Card className="flex-1 p-6 flex flex-col min-h-0">
            <Head icon={TrendingUp} to={locked ? null : '/venue/members'} linkLabel={t('venueHome:since.more')}>{since ? t('venueHome:since.since', { date: since }) : t('venueHome:since.lastWeeks')}</Head>
            {loading ? <Spinner className="py-6" /> : (
                <>
                    {since ? (
                        <div className="shrink-0">
                            <div className="flex items-baseline gap-2">
                                <span className="text-4xl font-extralight tracking-tighter text-[#1A1A1A] tabular-nums leading-none">{fmtNum(all.sessions)}</span>
                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">{t('venueHome:since.sessionsHere')}</span>
                            </div>
                            <div className="mt-1.5 text-[12px] font-bold text-[#666]">
                                {t('venueHome:since.allTime', {
                                    count: Math.round((all.minutes ?? 0) / 60),
                                    people: peopleText(t, all.members ?? 0),
                                    hours: fmtNum(Math.round((all.minutes ?? 0) / 60)),
                                    points: fmtNum(all.points ?? 0),
                                })}
                            </div>
                        </div>
                    ) : hasWeeks ? (
                        <div className="shrink-0">
                            <div className="flex items-baseline gap-2">
                                <span className="text-4xl font-extralight tracking-tighter text-[#1A1A1A] tabular-nums leading-none">{fmtNum(now4)}</span>
                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">{t('venueHome:since.inFourWeeks')}</span>
                            </div>
                        </div>
                    ) : (
                        <p className="text-[13px] text-[#888] font-light leading-relaxed">{t('venueHome:since.empty', { gym: gymName })}</p>
                    )}
                    {hasWeeks ? (
                        <div className="flex-1 min-h-0 flex flex-col justify-end">
                            <div className="mt-3 text-[11px] font-bold text-[#666]">
                                {change
                                    ? <span className={change.pct > 0 ? 'text-[#0B7A57]' : change.pct < 0 ? 'text-[#B45309]' : 'text-[#888]'}>{change.pct === 0 ? t('venueHome:since.level') : t('venueHome:since.change', { change: change.label })}</span>
                                    : <span className="text-[#AAAAAA]">{t('venueHome:since.nothingYet')}</span>}
                                {' · '}{t('venueHome:since.firsts', { count: firsts, n: fmtNum(firsts) })}
                            </div>
                            <div className="pt-6">
                                <Columns data={cols} label={t('venueHome:since.chartLabel')} height={56} tickEvery={2} />
                            </div>
                        </div>
                    ) : locked ? (
                        <p className="mt-auto pt-4 text-[11px] text-[#AAAAAA] leading-relaxed">
                            <Trans i18nKey="venueHome:since.locked" components={{ packages: <GoldLink to="/venue/package" /> }} />
                        </p>
                    ) : null}
                </>
            )}
        </Card>
    );
}

// ── The page ───────────────────────────────────────────────────────────────

export default function VenueHome() {
    const { t } = useTranslation();
    const locale = formatLocale();
    const { gym } = useAuth();
    const { pkg } = usePackage();
    const insightsAllowed = pkg && !pkg.unknown ? !!pkg.features?.insights : null;
    const canInsights = !!pkg?.features?.insights;   // true on the unknown-package stand-in too

    const [summary, setSummary] = useState(null);
    const [insights, setInsights] = useState(null);
    const [events, setEvents] = useState(null);
    const [league, setLeague] = useState(null);
    const [leagueError, setLeagueError] = useState(false);
    const [wall, setWall] = useState(null);               // the gym's big-screen feed: spotlight, streaks, all-time
    const [activity, setActivity] = useState(null);
    const [activityDone, setActivityDone] = useState(false);
    const [profile, setProfile] = useState(null);         // gym_profile: where it is (the join QR), the recap switch, the app page
    const [team, setTeam] = useState(null);               // gym_team: who's on the gym's page in the app; { failed } if it didn't load
    const [todayPost, setTodayPost] = useState(undefined); // from the posts row; undefined until it reports
    const [error, setError] = useState(null);
    const ticks = useRef(0);
    const done = useDone(gym.partner_id);

    useEffect(() => {
        let alive = true;
        setProfile(null);
        fetchGymProfile(gym.partner_id)
            .then((p) => { if (alive) setProfile(p ?? {}); })
            .catch(() => { if (alive) setProfile({}); });
        setTeam(null);
        fetchGymTeam(gym.partner_id)
            .then((t) => { if (alive) setTeam(t ?? { failed: true }); })
            .catch(() => { if (alive) setTeam({ failed: true }); });
        return () => { alive = false; };
    }, [gym.partner_id]);

    // /venue#app (or #app-team, #app-cover…, from a move): down to the phone, that part open.
    const { hash } = useLocation();
    const appFocus = hash.startsWith('#app') ? (hash.slice(5) || null) : null;
    useEffect(() => {
        if (!summary || !hash.startsWith('#app')) return;
        setTimeout(() => document.getElementById('app')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    }, [hash, !!summary]); // eslint-disable-line react-hooks/exhaustive-deps

    const load = useCallback(async (first) => {
        const slow = first || ticks.current % SLOW_EVERY === 0;
        ticks.current += 1;
        try {
            const [s, i, e] = await Promise.all([
                fetchGymSummary(gym.partner_id),
                slow ? fetchGymInsights(gym.partner_id, WEEKS).catch(() => ({ failed: true })) : Promise.resolve(undefined),
                fetchGymEvents(gym.partner_id).catch(() => null),
            ]);
            setSummary(s);
            // A failed refresh keeps what's on screen; only a failed first load says so.
            if (i !== undefined) setInsights((prev) => (i.failed && prev && !prev.failed ? prev : i));
            if (e) setEvents(e);
            if (s?.board?.slug && s.board.display_token) {
                fetchGymLeague(s.board.slug, s.board.display_token)
                    .then(d => { setLeague(d); setLeagueError(false); })
                    .catch(() => setLeagueError(true));
                // The wall's own feed changes slowly: with the insights, every few minutes.
                if (slow) fetchGymBoard(s.board.slug, s.board.display_token).then(setWall).catch(() => {});
            }
        } catch (err) {
            if (first) setError(serverErrorText(err));
        }
    }, [gym.partner_id]);

    useEffect(() => {
        ticks.current = 0;
        load(true);
        const t = setInterval(() => { if (document.visibilityState === 'visible') load(false); }, REFRESH_MS);
        return () => clearInterval(t);
    }, [load]);

    // What members do anywhere (Clash+): who's gone quiet, and what's rising.
    useEffect(() => {
        if (!pkg) return undefined;
        if (!canInsights) { setActivityDone(true); return undefined; }
        let alive = true;
        fetchMemberActivity(gym.partner_id, 4)
            .then(a => { if (alive) setActivity(a); })
            .catch(() => {})
            .finally(() => { if (alive) setActivityDone(true); });
        return () => { alive = false; };
    }, [gym.partner_id, !!pkg, canInsights]); // eslint-disable-line react-hooks/exhaustive-deps

    const standing = useMemo(() => standingOf(league), [league]);
    const tz = summary?.board?.tz ?? 'Europe/London';
    const name = summary?.gym?.name ?? gym.name;
    const top = useMemo(() => (insights == null ? null : insights.failed ? [] : (insights.top ?? [])), [insights]);

    // Wait for the package, the insights, the league (when there are screens),
    // the profile, today's post and on Clash+ the members' activity, so the
    // moves don't reshuffle as each arrives.
    const leagueSettled = !summary?.board?.slug || !summary.board.display_token || league != null || leagueError;
    const moves = useMemo(() => {
        if (!summary || !pkg || insights == null || !activityDone || !leagueSettled || !profile || !team || todayPost === undefined) return null;
        let posterMade = false;
        try { posterMade = !!localStorage.getItem(`powr_join_poster_${summary.gym?.id ?? ''}`); } catch { /* fine */ }
        return gymMoves({
            nowMs: Date.now(),
            gymName: name,
            features: pkg.features ?? null,
            trialDaysLeft: pkg.on_trial ? trialDaysLeft(pkg) : null,
            members: summary.members ?? 0,
            board: summary.board ? { enabled: summary.board.enabled } : null,
            events: events ? events.map(e => ({ ...e, state: statusKey(e) })) : null,
            league: standing?.host && standing.local.length >= 2
                ? { rank: standing.rank, count: standing.local.length, radiusKm: standing.radius, rival: standing.rival ? { name: standing.rival.name } : null, ahead: standing.ahead, gap: standing.gap }
                : null,
            activity: activity && !activity.locked ? activity : null,
            weekdays: Array.isArray(insights.days) ? insights.days : null,
            posterMade,
            // Today's post by its name in the reader's language (WeekPosts reports it in English).
            todayPost: todayPost && { ...todayPost, label: postName(t, todayPost.label) },
            hasPhoto: profile && 'image_url' in profile ? !!profile.image_url : !!summary.gym?.image_url,
            teamCount: team.members ? team.members.filter((m) => m.active).length : null,
            recapOn: typeof profile.recap_email === 'boolean' ? profile.recap_email : null,
            lastWeekSessions: summary.last_week?.sessions ?? null,
            done,
            fmtDay,
            lastDay,
            t,
            locale,
        });
    }, [summary, pkg, insights, activityDone, leagueSettled, profile, team, todayPost, done, activity, events, standing, name, t, locale]);
    const later = useCallback((m) => markDone(gym.partner_id, m.key, m.snooze === 'day' ? endOfDay(tz) : new Date(Date.now() + 7 * 86_400_000)), [gym.partner_id, tz]);

    if (error) return <Empty title={t('venueHome:page.loadFailed')} action={<button type="button" onClick={() => window.location.reload()} className={BTN_GHOST}>{t('common:actions.retry')}</button>}>{error}</Empty>;
    if (!summary) return <Spinner />;

    const board = summary.board;
    const quiet = activity && !activity.too_few ? (activity.quiet ?? 0) : 0;

    return (
        <div>
            <div className="creator-rise flex flex-wrap items-end justify-between gap-x-6 gap-y-2 mb-5 lg:mb-6">
                <div className="min-w-0">
                    <Micro gold>{t('venueHome:page.overview')}</Micro>
                    <h1 className="text-3xl sm:text-4xl font-light tracking-tighter text-[#1A1A1A] leading-none mt-2 truncate">{name}</h1>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.25em] font-black text-[#BBBBBB]">
                    <span>{weekLabel(summary.week_start_at, summary.week_end_at, tz, locale)}</span>
                    {board && (
                        <Link to="/venue/screens" className="inline-flex items-center gap-4">
                            <span className="inline-flex items-center gap-1.5"><i className={`w-1.5 h-1.5 rounded-full ${board.enabled ? 'bg-emerald-500' : 'bg-[#CCCCCC]'}`} /><span className="text-[#888]">{board.enabled ? t('venueHome:page.leaderboardLive') : t('venueHome:page.leaderboardPaused')}</span></span>
                            <span className="inline-flex items-center gap-1.5"><i className={`w-1.5 h-1.5 rounded-full ${board.league_enabled !== false ? 'bg-emerald-500' : 'bg-[#CCCCCC]'}`} /><span className="text-[#888]">{board.league_enabled !== false ? t('venueHome:page.leagueLive') : t('venueHome:page.leaguePaused')}</span></span>
                        </Link>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:gap-5 lg:grid-cols-12">
                <div className="creator-rise lg:col-span-6 flex flex-col min-h-0" style={{ animationDelay: '60ms' }}><Pulse summary={summary} insights={insights} tz={tz} /></div>
                <div className="creator-rise lg:col-span-6 flex flex-col min-h-0" style={{ animationDelay: '120ms' }}><Moves moves={moves} gym={{ ...gym, name }} quiet={quiet} onLater={later} /></div>
                <div className="creator-rise lg:col-span-12 min-w-0" style={{ animationDelay: '180ms' }}>
                    <WeekPosts gym={gym} name={name} summary={summary} insights={insights} standing={standing} events={events} pkg={pkg} tz={tz} profile={profile} onToday={setTodayPost} />
                </div>
                <div className="creator-rise lg:col-span-12 min-w-0" style={{ animationDelay: '220ms' }}>
                    <GymAppCard gym={gym} profile={profile} onProfile={setProfile} team={team} onTeam={setTeam} focus={appFocus} />
                </div>
                <div className="creator-rise lg:col-span-4 flex flex-col min-h-0" style={{ animationDelay: '240ms' }}><People wall={wall} top={top} failed={!!insights?.failed} summary={summary} activity={activity} /></div>
                <div className="creator-rise lg:col-span-4 flex flex-col min-h-0" style={{ animationDelay: '300ms' }}><League board={board} standing={standing} error={leagueError} founding={pkg?.package === 'founding'} /></div>
                <div className="creator-rise lg:col-span-4 flex flex-col min-h-0" style={{ animationDelay: '360ms' }}><Since wall={wall} insights={insights} tz={tz} gymName={name} locked={insightsAllowed === false || !!insights?.locked} /></div>
            </div>
        </div>
    );
}
