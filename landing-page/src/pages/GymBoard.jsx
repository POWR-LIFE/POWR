import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { storageImage } from '../lib/storage';
import {
    activityMeta,
    barFraction,
    boardName,
    countdownParts,
    fmtMinutes,
    initials,
    memberSince,
    resetLabel,
    rootFontSize,
    sampleActivity,
    sampleStandings,
    scenePlan,
    splitStandings,
    spotlightCards,
    weekLabel,
    whenLabel,
} from '../../../shared/gymBoard.ts';

/**
 * The gym's wall — powr.life/gym/<slug>?k=<display_token>.
 *
 * A weekly leaderboard for one gym, designed for a TV on the gym floor and
 * nothing else: chromeless, dark, huge type, reads from across the room.
 * Sibling of LiveBoard (the live-event screen) but with no lifecycle — the
 * wall is always on. Monday it resets; last week's champion stays on the
 * rail so the room remembers who won.
 *
 * Each row carries the member's level (tier-coloured), streak, time trained
 * here this week, points today, and NEW / PB marks. A spotlight card on the
 * rail rotates through the week's biggest session, the most improved member
 * and who trained here for the first time.
 *
 * The wall moves. The main column plays scenes — the board, then the latest
 * sessions members earned on here (what, how long, when, how many points),
 * then the chasing pack past the top ten — and a marquee of that same feed
 * runs along the bottom the whole time. A gym floor is a broadcast, not a
 * spreadsheet.
 *
 * Layout is authored at 1920×1080 in rem and the root font-size is scaled
 * to the actual screen (rootFontSize), so a 4K wall or a 720p bar TV gets
 * the same composition, just bigger or smaller.
 *
 * ?preview=sample | empty — re-renders the last good payload with sample or
 * no standings so the admin can see both screens before a gym has members
 * on the board. Works only past the token gate and is badged PREVIEW.
 */

const GOLD = '#E8D200';
const SILVER = '#C9CCD3';
const BRONZE = '#C98A4B';
const POLL_MS = 12_000;
const STALE_MS = 45_000;
const SPOTLIGHT_MS = 9_000;
const FN_BASE = `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/gym-board`;
const JOIN_URL = 'https://powr.life/app';
const PREVIEW_STATES = ['sample', 'empty'];

const ringColour = (rank) => (rank === 1 ? GOLD : rank === 2 ? SILVER : rank === 3 ? BRONZE : 'rgba(255,255,255,0.12)');

function applyPreview(board, preview) {
    if (preview === 'empty') {
        return {
            ...board,
            standings: [],
            stats: { members: 0, points: 0, sessions: 0, minutes: 0 },
            last_week: { ...board.last_week, podium: [] },
            spotlight: { session: null, improved: null, new_members: [] },
            activity: [],
        };
    }
    const standings = sampleStandings(18);
    const lw = sampleStandings(3).map((r) => ({ ...r, key: `lw-${r.key}`, points: r.points + 96 }));
    return {
        ...board,
        standings,
        stats: {
            members: standings.length,
            points: standings.reduce((a, r) => a + r.points, 0),
            sessions: standings.reduce((a, r) => a + r.sessions, 0),
            minutes: standings.reduce((a, r) => a + (r.minutes ?? 0), 0),
        },
        last_week: { ...board.last_week, podium: lw },
        spotlight: {
            session: { ...standings[3], points: 212, type: 'gym', started_at: new Date(Date.now() - 26 * 3_600_000).toISOString(), minutes: 84 },
            improved: { ...standings[6], this_week: 874, last_week: 610, gain: 264 },
            new_members: [standings[5], standings[11]],
        },
        activity: sampleActivity(Date.now()),
        community: Math.max(board.community ?? 0, 64),
    };
}

export default function GymBoard() {
    const { slug } = useParams();
    const [params] = useSearchParams();
    const token = params.get('k') ?? '';
    const previewParam = params.get('preview');
    const preview = PREVIEW_STATES.includes(previewParam) ? previewParam : null;
    // ?scene=activity|chasing|board pins the main column — for the admin's
    // preview links and for checking a scene without waiting for the rotation.
    const sceneParam = params.get('scene');
    const pinnedScene = ['board', 'activity', 'chasing'].includes(sceneParam) ? sceneParam : null;

    const [board, setBoard] = useState(null);
    const [invalid, setInvalid] = useState(false);
    const [lastOkAt, setLastOkAt] = useState(0);
    const [now, setNow] = useState(Date.now());

    // Scale the whole composition to the screen.
    useEffect(() => {
        const html = document.documentElement;
        const prev = html.style.fontSize;
        const fit = () => { html.style.fontSize = `${rootFontSize(window.innerWidth, window.innerHeight)}px`; };
        fit();
        window.addEventListener('resize', fit);
        return () => { window.removeEventListener('resize', fit); html.style.fontSize = prev; };
    }, []);

    // Poll; keep the last good payload through venue wifi blips.
    useEffect(() => {
        let alive = true;
        const tick = async () => {
            try {
                const res = await fetch(`${FN_BASE}?slug=${encodeURIComponent(slug)}&k=${encodeURIComponent(token)}`);
                if (!alive) return;
                if (res.status === 404 || res.status === 400) {
                    // Regenerated token / paused board: blank the wall now.
                    setInvalid(true);
                    setBoard(null);
                    setLastOkAt(0);
                    return;
                }
                if (!res.ok) return;
                const data = await res.json();
                setBoard(data);
                setInvalid(false);
                setLastOkAt(Date.now());
            } catch {
                // transient — retry next tick
            }
        };
        tick();
        const id = setInterval(tick, POLL_MS);
        return () => { alive = false; clearInterval(id); };
    }, [slug, token]);

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const stale = board && lastOkAt > 0 && now - lastOkAt > STALE_MS;

    if (!token) return <Shell><CenterNote big="This link is missing its key" small="Copy the full big-screen URL from the admin — it ends in ?k=…" /></Shell>;
    if (invalid) return <Shell><CenterNote big="This screen link isn’t valid" small="Ask the POWR team for a fresh display URL." /></Shell>;
    if (!board) return <Shell><CenterNote big="POWR" small="Connecting…" pulse /></Shell>;

    const shown = preview ? applyPreview(board, preview) : board;

    return (
        <Shell>
            <div className="relative h-full flex flex-col">
                <div className="flex-1 min-h-0 grid grid-cols-[29rem_1fr] gap-[4rem] px-[4rem] pt-[2.5rem] pb-[1.5rem]">
                    <Rail board={shown} now={now} />
                    <Main board={shown} now={now} stale={stale && !preview} pinned={pinnedScene} />
                </div>
                <Marquee feed={shown.activity ?? []} now={now} tz={shown.tz} />
            </div>
            {preview && (
                <div className="pointer-events-none absolute top-[1.25rem] left-1/2 -translate-x-1/2 rounded-full border border-amber-400/50 bg-amber-400/10 px-[1rem] py-[0.3rem] text-[0.7rem] font-black uppercase tracking-[0.3em] text-amber-300">
                    Preview — {preview === 'empty' ? 'empty board' : 'sample data'}
                </div>
            )}
        </Shell>
    );
}

// ─── Chrome ──────────────────────────────────────────────────────

function Shell({ children }) {
    return (
        <div
            className="fixed inset-0 bg-[#070707] text-[#F2F2F2] overflow-hidden select-none"
            style={{ fontFamily: "'Outfit', 'Helvetica Neue', sans-serif" }}
        >
            <style>{`
                @keyframes gbSweep { 0% { transform: translateX(-120%); } 35% { transform: translateX(220%); } 100% { transform: translateX(220%); } }
                @keyframes gbDrift { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(4vw, -3vh) scale(1.08); } }
                @keyframes gbPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
                @keyframes gbMarquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
                .gb-sweep::after { content: ''; position: absolute; inset: 0; width: 40%; background: linear-gradient(100deg, transparent, rgba(255,255,255,0.16), transparent); animation: gbSweep 7s ease-in-out infinite; }
            `}</style>
            {/* ambient light — a warm source low-right, a cooler one top-left */}
            <div
                className="pointer-events-none absolute -bottom-[30vh] -right-[10vw] w-[70vw] h-[80vh] rounded-full opacity-[0.09]"
                style={{ background: `radial-gradient(closest-side, ${GOLD}, transparent)`, animation: 'gbDrift 24s ease-in-out infinite' }}
            />
            <div
                className="pointer-events-none absolute -top-[30vh] -left-[15vw] w-[55vw] h-[60vh] rounded-full opacity-[0.05]"
                style={{ background: 'radial-gradient(closest-side, #ffffff, transparent)' }}
            />
            {/* hairline grid — the faint structure behind a scoreboard */}
            <div
                className="pointer-events-none absolute inset-0 opacity-[0.035]"
                style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '6rem 6rem' }}
            />
            {children}
        </div>
    );
}

function CenterNote({ big, small, pulse }) {
    return (
        <div className="h-full flex flex-col items-center justify-center gap-[1rem]">
            <motion.div
                className="text-[4.5rem] font-extralight tracking-tighter"
                animate={pulse ? { opacity: [0.4, 1, 0.4] } : undefined}
                transition={pulse ? { duration: 2.2, repeat: Infinity } : undefined}
            >
                {big}
            </motion.div>
            <div className="text-[1.25rem] text-white/40 font-light">{small}</div>
        </div>
    );
}

const Eyebrow = ({ children, colour = 'rgba(255,255,255,0.35)', className = '' }) => (
    <div className={`text-[0.7rem] font-black uppercase tracking-[0.45em] ${className}`} style={{ color: colour }}>{children}</div>
);

// Tweens between values so a score landing on the wall counts up, not snaps.
function Num({ value, className, style }) {
    const mv = useMotionValue(value);
    const [shown, setShown] = useState(value);
    useEffect(() => {
        const controls = animate(mv, value, { duration: 0.9, ease: 'easeOut', onUpdate: (v) => setShown(Math.round(v)) });
        return () => controls.stop();
    }, [value, mv]);
    return <span className={`tabular-nums ${className ?? ''}`} style={style}>{shown.toLocaleString()}</span>;
}

function Move({ delta, size = 'sm' }) {
    if (delta == null || delta === 0) return null;
    const up = delta > 0;
    const colour = up ? '#4ade80' : '#f87171';
    const cls = size === 'lg' ? 'px-[0.6rem] py-[0.15rem] text-[1.1rem]' : 'px-[0.45rem] py-[0.1rem] text-[0.8rem]';
    return (
        <span className={`inline-flex items-center gap-[0.2rem] rounded-md tabular-nums font-bold ${cls}`} style={{ color: colour, background: `${colour}1f` }}>
            <span style={{ fontSize: '0.7em' }}>{up ? '▲' : '▼'}</span>{Math.abs(delta)}
        </span>
    );
}

function Avatar({ row, size, ring, ringWidth = 0.2 }) {
    const name = boardName(row);
    const img = row.avatar_url ? storageImage(row.avatar_url, 256) : null;
    return (
        <div
            className="relative rounded-full shrink-0 flex items-center justify-center"
            style={{
                width: `${size}rem`, height: `${size}rem`,
                boxShadow: ring ? `0 0 0 ${ringWidth}rem #070707, 0 0 0 ${ringWidth * 2}rem ${ring}` : undefined,
                background: 'rgba(255,255,255,0.08)',
            }}
        >
            {img ? (
                <img src={img} alt="" className="w-full h-full rounded-full object-cover" decoding="async" />
            ) : (
                <span className="font-medium text-white/60" style={{ fontSize: `${size * 0.36}rem` }}>{initials(name)}</span>
            )}
        </div>
    );
}

// ─── Member marks ────────────────────────────────────────────────
// Everything a row says about the member beyond rank and points. Each mark
// renders nothing when it has nothing to say, so a quiet row stays quiet.

function LevelPill({ level, size = 'sm' }) {
    if (!level) return null;
    const cls = size === 'lg' ? 'text-[0.8rem] px-[0.6rem] py-[0.2rem]' : 'text-[0.65rem] px-[0.45rem] py-[0.12rem]';
    return (
        <span
            className={`inline-flex items-center rounded-md font-black uppercase tracking-[0.18em] tabular-nums shrink-0 ${cls}`}
            style={{ color: level.colour, background: `${level.colour}1f`, border: `1px solid ${level.colour}44` }}
            title={level.name}
        >
            Lvl {level.level}
        </span>
    );
}

function Streak({ streak, size = 'sm' }) {
    if (!streak || streak < 2) return null;
    const cls = size === 'lg' ? 'text-[1rem]' : 'text-[0.8rem]';
    return (
        <span className={`inline-flex items-center gap-[0.25rem] tabular-nums font-bold text-white/70 shrink-0 ${cls}`} title={`${streak}-day streak`}>
            <span style={{ fontSize: '0.95em' }}>🔥</span>{streak}
        </span>
    );
}

function Tag({ children, colour = GOLD }) {
    return (
        <span
            className="inline-flex items-center rounded-md px-[0.45rem] py-[0.12rem] text-[0.62rem] font-black uppercase tracking-[0.25em] shrink-0"
            style={{ color: '#070707', background: colour }}
        >
            {children}
        </span>
    );
}

function Marks({ row, size = 'sm' }) {
    return (
        <span className="inline-flex items-center gap-[0.5rem] min-w-0">
            <LevelPill level={row.level} size={size} />
            <Streak streak={row.streak} size={size} />
            {row.is_new && <Tag>New</Tag>}
            {row.is_pb && <Tag colour="#4ade80">PB</Tag>}
        </span>
    );
}

function Today({ points, size = 'sm' }) {
    if (!points || points <= 0) return null;
    const cls = size === 'lg' ? 'text-[0.85rem] px-[0.6rem] py-[0.2rem]' : 'text-[0.68rem] px-[0.5rem] py-[0.15rem]';
    return (
        <span className={`inline-flex items-center rounded-full font-black uppercase tracking-[0.2em] tabular-nums shrink-0 ${cls}`} style={{ color: '#4ade80', background: 'rgba(74,222,128,0.12)' }}>
            +{points.toLocaleString()} today
        </span>
    );
}

// ─── Left rail ───────────────────────────────────────────────────

function Rail({ board, now }) {
    const champ = board.last_week?.podium?.[0] ?? null;
    const runners = (board.last_week?.podium ?? []).slice(1, 3);
    const parts = countdownParts(board.week_end_at, now);
    const span = new Date(board.week_end_at) - new Date(board.week_start_at);
    const elapsed = span > 0 ? Math.min(1, Math.max(0, (now - new Date(board.week_start_at)) / span)) : 0;
    const logoDark = board.gym.logo_bg !== 'light';
    const since = champ ? memberSince(champ.member_since, board.tz) : null;

    return (
        <aside className="min-h-0 flex flex-col justify-between">
            {/* Identity */}
            <div>
                <div className="flex items-center gap-[1rem]">
                    {board.gym.logo_url && (
                        <div
                            className={`w-[4.5rem] h-[4.5rem] rounded-[1.1rem] border flex items-center justify-center overflow-hidden shrink-0 ${logoDark ? 'bg-white/[0.06] border-white/10' : 'bg-white border-white/60'}`}
                        >
                            <img src={storageImage(board.gym.logo_url, 256)} alt="" className="w-[80%] h-[80%] object-contain" decoding="async" />
                        </div>
                    )}
                    <div className="min-w-0">
                        <Eyebrow colour={GOLD}>Weekly leaderboard</Eyebrow>
                        <h1 className="text-[2.9rem] leading-[0.95] font-light tracking-tighter mt-[0.35rem] truncate">{board.gym.name}</h1>
                    </div>
                </div>
                <div className="mt-[1.4rem] flex items-center gap-[0.9rem]">
                    <span className="text-[1.05rem] text-white/60 font-light">{weekLabel(board.week_start_at, board.week_end_at, board.tz)}</span>
                    <span className="flex items-center gap-[0.45rem] text-[0.7rem] font-black uppercase tracking-[0.3em] text-emerald-400">
                        <span className="w-[0.55rem] h-[0.55rem] rounded-full bg-emerald-400" style={{ animation: 'gbPulse 1.6s ease-in-out infinite' }} />
                        Live
                    </span>
                </div>
                {/* Reset clock, folded into the identity block */}
                <div className="mt-[0.7rem] flex items-baseline justify-between">
                    <span className="text-[0.7rem] uppercase tracking-[0.3em] text-white/30 font-bold">Only points earned here · resets Monday</span>
                    <span className="text-[1.15rem] font-light tabular-nums text-white/80">{resetLabel(parts)}</span>
                </div>
                <div className="mt-[0.5rem] h-[2px] w-full bg-white/10 rounded-full overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ background: GOLD }} animate={{ width: `${elapsed * 100}%` }} transition={{ duration: 1 }} />
                </div>
            </div>

            {/* The week in numbers */}
            <div className="grid grid-cols-3 gap-[1rem]">
                <Stat label="Members" value={board.stats.members} />
                <Stat label="Points" value={board.stats.points} gold />
                <Stat label="Time trained" text={fmtMinutes(board.stats.minutes ?? 0, { compact: true })} />
            </div>

            {/* Spotlight — rotates through the week's stories */}
            <Spotlight spot={board.spotlight} tz={board.tz} />

            {/* Last week */}
            <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-[1.4rem]">
                <Eyebrow colour={GOLD}>Last week’s champion</Eyebrow>
                {champ ? (
                    <div className="mt-[1rem] flex items-center gap-[1rem]">
                        <Avatar row={champ} size={3.8} ring={GOLD} ringWidth={0.15} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-[0.6rem] min-w-0">
                                <span className="text-[1.55rem] font-light leading-tight truncate">{boardName(champ)}</span>
                                <LevelPill level={champ.level} />
                            </div>
                            <div className="text-[1rem] tabular-nums font-light" style={{ color: GOLD }}>
                                {champ.points.toLocaleString()} <span className="text-[0.6em] uppercase tracking-[0.25em] text-white/35 font-bold">pts</span>
                                {since && <span className="text-[0.6em] uppercase tracking-[0.25em] text-white/35 font-bold ml-[0.8rem]">Member since {since}</span>}
                            </div>
                        </div>
                        <span className="text-[2.4rem] leading-none">🏆</span>
                    </div>
                ) : (
                    <div className="mt-[0.9rem] text-[1.15rem] text-white/55 font-light leading-snug">
                        No champion yet. Win this week and your name lives here.
                    </div>
                )}
                {runners.length > 0 && (
                    <div className="mt-[1rem] pt-[0.9rem] border-t border-white/[0.07] flex items-center gap-[1.25rem] text-[0.9rem] text-white/50 font-light">
                        {runners.map((r) => (
                            <span key={r.key} className="flex items-center gap-[0.5rem] min-w-0">
                                <span className="font-bold tabular-nums" style={{ color: ringColour(r.rank) }}>{r.rank === 2 ? '2nd' : '3rd'}</span>
                                <span className="truncate">{boardName(r)}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Join */}
            <div className="flex items-center gap-[1.2rem]">
                <div className="bg-white rounded-[1rem] p-[0.6rem] shrink-0">
                    <QRCodeSVG value={JOIN_URL} size={96} fgColor="#0a0a0a" bgColor="#FFFFFF" style={{ width: '6rem', height: '6rem' }} />
                </div>
                <div className="min-w-0">
                    <div className="text-[1.35rem] font-light leading-tight">Get on the board</div>
                    <div className="text-[0.85rem] text-white/45 font-light mt-[0.3rem] leading-snug">
                        Scan, get POWR, train here. Every verified session earns points.
                    </div>
                    {board.community > 0 && (
                        <div className="text-[0.7rem] uppercase tracking-[0.3em] text-white/30 font-bold mt-[0.6rem]">
                            {board.community.toLocaleString()} {board.community === 1 ? 'member trains' : 'members train'} here on POWR
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
}

function Stat({ label, value, text, gold }) {
    return (
        <div className="rounded-[1.1rem] border border-white/10 bg-white/[0.03] px-[1rem] py-[0.9rem] min-w-0">
            {text != null ? (
                <span className="block text-[2.2rem] leading-none font-extralight tracking-tight tabular-nums truncate" style={{ color: gold ? GOLD : '#F2F2F2' }}>{text}</span>
            ) : (
                <Num value={value} className="block text-[2.2rem] leading-none font-extralight tracking-tight" style={{ color: gold ? GOLD : '#F2F2F2' }} />
            )}
            <div className="text-[0.62rem] uppercase tracking-[0.3em] text-white/35 font-black mt-[0.55rem] truncate">{label}</div>
        </div>
    );
}

const ACTIVITY_LABEL = { gym: 'Gym session', running: 'Run', cycling: 'Ride', swimming: 'Swim', hiit: 'HIIT', yoga: 'Yoga', sports: 'Sport', dance: 'Dance', walking: 'Walk' };

function Spotlight({ spot, tz }) {
    const cards = useMemo(() => spotlightCards(spot), [spot]);
    const [i, setI] = useState(0);
    useEffect(() => {
        if (cards.length <= 1) return;
        const id = setInterval(() => setI((x) => x + 1), SPOTLIGHT_MS);
        return () => clearInterval(id);
    }, [cards.length]);
    const kind = cards.length ? cards[i % cards.length] : null;

    const dayOf = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(new Date(iso));

    let eyebrow = 'This week';
    let body = null;
    if (kind === 'session' && spot.session) {
        const s = spot.session;
        eyebrow = 'Session of the week';
        body = (
            <div className="flex items-center gap-[1rem]">
                <Avatar row={s} size={3.2} ring="rgba(255,255,255,0.18)" ringWidth={0.1} />
                <div className="min-w-0 flex-1">
                    <div className="text-[1.4rem] font-light leading-tight truncate">{boardName(s)}</div>
                    <div className="text-[0.85rem] text-white/50 font-light truncate">
                        {ACTIVITY_LABEL[s.type] ?? 'Session'} · {dayOf(s.started_at)}{s.minutes > 0 ? ` · ${fmtMinutes(s.minutes)}` : ''}
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <div className="text-[1.9rem] leading-none font-extralight tabular-nums" style={{ color: GOLD }}>{s.points.toLocaleString()}</div>
                    <div className="text-[0.6rem] uppercase tracking-[0.3em] text-white/35 font-black mt-[0.2rem]">pts · one session</div>
                </div>
            </div>
        );
    } else if (kind === 'improved' && spot.improved) {
        const s = spot.improved;
        eyebrow = 'Most improved';
        body = (
            <div className="flex items-center gap-[1rem]">
                <Avatar row={s} size={3.2} ring="rgba(255,255,255,0.18)" ringWidth={0.1} />
                <div className="min-w-0 flex-1">
                    <div className="text-[1.4rem] font-light leading-tight truncate">{boardName(s)}</div>
                    <div className="text-[0.85rem] text-white/50 font-light truncate">
                        {s.last_week.toLocaleString()} last week → {s.this_week.toLocaleString()} so far
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <div className="text-[1.9rem] leading-none font-extralight tabular-nums text-[#4ade80]">+{s.gain.toLocaleString()}</div>
                    <div className="text-[0.6rem] uppercase tracking-[0.3em] text-white/35 font-black mt-[0.2rem]">on last week</div>
                </div>
            </div>
        );
    } else if (kind === 'new') {
        const list = spot.new_members;
        eyebrow = list.length === 1 ? 'New on the wall this week' : `New on the wall this week · ${list.length}`;
        body = (
            <div className="flex items-center gap-[0.9rem] min-w-0">
                <div className="flex -space-x-[0.6rem] shrink-0">
                    {list.slice(0, 4).map((m) => <Avatar key={m.key} row={m} size={2.6} ring="#070707" ringWidth={0.08} />)}
                </div>
                <div className="min-w-0">
                    <div className="text-[1.25rem] font-light leading-tight truncate">
                        {list.slice(0, 3).map(boardName).join(', ')}{list.length > 3 ? ` +${list.length - 3}` : ''}
                    </div>
                    <div className="text-[0.85rem] text-white/50 font-light">First session here. Welcome to the board.</div>
                </div>
            </div>
        );
    } else {
        body = <div className="text-[1.15rem] text-white/55 font-light leading-snug">The week’s stories appear here — biggest session, most improved, new faces.</div>;
    }

    return (
        <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-[1.4rem] overflow-hidden">
            <div className="flex items-center justify-between">
                <Eyebrow colour={GOLD}>{eyebrow}</Eyebrow>
                {cards.length > 1 && (
                    <span className="flex items-center gap-[0.35rem]">
                        {cards.map((c, idx) => (
                            <span key={c} className="w-[0.35rem] h-[0.35rem] rounded-full" style={{ background: idx === i % cards.length ? GOLD : 'rgba(255,255,255,0.18)' }} />
                        ))}
                    </span>
                )}
            </div>
            <div className="mt-[1rem] min-h-[3.4rem]">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={kind ?? 'none'}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.4 }}
                    >
                        {body}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
}

// ─── Main ────────────────────────────────────────────────────────

function Main({ board, now, stale, pinned }) {
    const { podium, list, rest } = useMemo(() => splitStandings(board.standings, 7), [board.standings]);
    const leader = podium[0]?.points ?? 0;
    const feed = board.activity ?? [];
    const plan = useMemo(() => scenePlan({ feed: feed.length, rest: rest.length }), [feed.length, rest.length]);

    // Scene rotation — board, activity, chasing — each for its own dwell.
    const [step, setStep] = useState(0);
    useEffect(() => {
        if (plan.length <= 1 || pinned) return;
        const id = setTimeout(() => setStep((x) => x + 1), plan[step % plan.length].ms);
        return () => clearTimeout(id);
    }, [step, plan, pinned]);
    const rotating = plan[step % plan.length].scene;
    const scene = board.standings.length === 0 ? 'empty' : (pinned && plan.some((p) => p.scene === pinned) ? pinned : rotating);

    const SCENE_LABEL = { board: 'Leaderboard', activity: 'Latest activity', chasing: 'The chasing pack', empty: 'Leaderboard' };

    return (
        <section className="min-h-0 flex flex-col">
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-[1.4rem]">
                    <div className="text-[0.9rem] font-black tracking-[0.5em] uppercase">POWR</div>
                    <AnimatePresence mode="wait">
                        <motion.span
                            key={scene}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 8 }}
                            transition={{ duration: 0.35 }}
                            className="text-[0.7rem] uppercase tracking-[0.4em] text-white/45 font-black"
                        >
                            {SCENE_LABEL[scene]}
                        </motion.span>
                    </AnimatePresence>
                    {plan.length > 1 && scene !== 'empty' && (
                        <span className="flex items-center gap-[0.35rem]">
                            {plan.map((p, idx) => (
                                <span key={p.scene} className="w-[0.35rem] h-[0.35rem] rounded-full" style={{ background: p.scene === scene ? GOLD : 'rgba(255,255,255,0.18)' }} />
                            ))}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-[1.5rem]">
                    {stale && (
                        <span className="text-[0.7rem] uppercase tracking-[0.3em] text-amber-400/80 font-bold">Reconnecting — showing last scores</span>
                    )}
                    <span className="text-[0.7rem] uppercase tracking-[0.35em] text-white/30 font-bold">Train · Earn · Repeat</span>
                </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={scene}
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.45, ease: 'easeOut' }}
                        className="flex-1 min-h-0 flex flex-col"
                    >
                        {scene === 'empty' && <EmptyBoard />}
                        {scene === 'board' && (
                            <>
                                <Podium rows={podium} />
                                <div className="flex-1 min-h-0 flex flex-col justify-evenly mt-[1rem]">
                                    {list.map((row) => <Row key={row.key} row={row} leader={leader} />)}
                                </div>
                            </>
                        )}
                        {scene === 'activity' && <ActivityScene feed={feed} now={now} tz={board.tz} gym={board.gym.name} />}
                        {scene === 'chasing' && <ChasingScene rows={rest} leader={leader} />}
                    </motion.div>
                </AnimatePresence>
            </div>
        </section>
    );
}

const PODIUM_ORDER = [2, 1, 3];

function Podium({ rows }) {
    const byRank = (r) => rows.find((x) => x.rank === r);
    return (
        <div className="shrink-0 grid grid-cols-3 gap-[1.5rem] items-end mt-[1.2rem]">
            {PODIUM_ORDER.map((rank) => {
                const row = byRank(rank);
                const first = rank === 1;
                const platform = first ? 6 : rank === 2 ? 4.3 : 3.4;
                return (
                    <div key={rank} className="flex flex-col items-center">
                        <AnimatePresence mode="popLayout">
                            {row && (
                                <motion.div
                                    key={row.key}
                                    layout
                                    initial={{ opacity: 0, y: 24 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -16 }}
                                    transition={{ type: 'spring', stiffness: 110, damping: 16 }}
                                    className="flex flex-col items-center text-center w-full"
                                >
                                    <Avatar row={row} size={first ? 6.8 : 5.2} ring={ringColour(rank)} />
                                    <div className="mt-[0.8rem] flex items-center gap-[0.6rem] max-w-full">
                                        <span className={`truncate font-light leading-tight ${first ? 'text-[2.1rem]' : 'text-[1.6rem] text-white/90'}`}>{boardName(row)}</span>
                                        <Move delta={row.rank_delta} size={first ? 'lg' : 'sm'} />
                                    </div>
                                    <div className="mt-[0.35rem] flex items-center justify-center gap-[0.6rem] max-w-full">
                                        <Marks row={row} size={first ? 'lg' : 'sm'} />
                                    </div>
                                    <div className="mt-[0.25rem] flex items-baseline gap-[0.5rem]">
                                        <Num value={row.points} className={`font-extralight tracking-tight ${first ? 'text-[2.7rem]' : 'text-[2rem]'}`} style={{ color: ringColour(rank) }} />
                                        <span className="text-[0.7rem] uppercase tracking-[0.3em] text-white/35 font-black">pts</span>
                                    </div>
                                    <div className="flex items-center gap-[0.7rem]">
                                        <span className="text-[0.75rem] uppercase tracking-[0.25em] text-white/35 font-bold">
                                            {row.sessions} {row.sessions === 1 ? 'session' : 'sessions'}{row.minutes > 0 ? ` · ${fmtMinutes(row.minutes)}` : ''}
                                        </span>
                                        <Today points={row.today_points} />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                        {!row && <GhostSeat size={first ? 6.8 : 5.2} />}
                        <div
                            className={`relative w-full mt-[0.9rem] rounded-t-[1.1rem] overflow-hidden border-t ${first ? 'gb-sweep' : ''}`}
                            style={{
                                height: `${platform}rem`,
                                borderColor: ringColour(rank),
                                background: `linear-gradient(180deg, ${ringColour(rank)}${first ? '33' : '1f'}, transparent)`,
                            }}
                        >
                            <span
                                className="absolute left-1/2 -translate-x-1/2 top-[0.4rem] font-extralight leading-none tabular-nums"
                                style={{ color: ringColour(rank), fontSize: first ? '3.2rem' : '2.2rem', opacity: 0.9 }}
                            >
                                {rank}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function GhostSeat({ size }) {
    return (
        <div className="flex flex-col items-center text-center w-full">
            <div className="rounded-full border border-dashed border-white/15" style={{ width: `${size}rem`, height: `${size}rem` }} />
            <div className="mt-[0.9rem] text-[1.3rem] text-white/25 font-light">Open</div>
            <div className="text-[1.6rem] text-white/15 font-extralight">—</div>
        </div>
    );
}

function Row({ row, leader }) {
    const frac = barFraction(row.points, leader);
    return (
        <motion.div
            layout
            transition={{ type: 'spring', stiffness: 120, damping: 18 }}
            className="relative grid grid-cols-[3rem_3.2rem_3.2rem_1fr_auto_auto_9rem] items-center gap-[1rem] px-[1rem] py-[0.5rem] rounded-[0.9rem]"
        >
            <span className="text-right text-[1.7rem] font-extralight tabular-nums text-white/40">{row.rank}</span>
            <span className="flex justify-center"><Move delta={row.rank_delta} /></span>
            <Avatar row={row} size={2.8} />
            <span className="flex items-center gap-[0.7rem] min-w-0 overflow-hidden">
                <span className="truncate text-[1.5rem] font-light text-white/90">{boardName(row)}</span>
                <Marks row={row} />
            </span>
            {/* always a cell, even when empty — a null child would shift every column after it */}
            <span className="flex justify-end"><Today points={row.today_points} /></span>
            <span className="text-[0.7rem] uppercase tracking-[0.25em] text-white/30 font-bold whitespace-nowrap">
                {row.sessions} {row.sessions === 1 ? 'session' : 'sessions'}{row.minutes > 0 ? ` · ${fmtMinutes(row.minutes)}` : ''}
            </span>
            <span className="text-right">
                <Num value={row.points} className="text-[1.6rem] font-light text-white/85" />
                <span className="text-[0.65rem] uppercase tracking-[0.25em] text-white/30 font-bold ml-[0.45rem]">pts</span>
            </span>
            {/* the bar — how far behind the leader */}
            <div className="absolute left-[1rem] right-[1rem] bottom-0 h-[2px] bg-white/[0.06] rounded-full overflow-hidden">
                <motion.div
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(90deg, ${GOLD}, ${GOLD}55)` }}
                    initial={false}
                    animate={{ width: `${frac * 100}%` }}
                    transition={{ duration: 0.9, ease: 'easeOut' }}
                />
            </div>
        </motion.div>
    );
}

// ─── Activity scene ──────────────────────────────────────────────
// The latest sessions members earned on here: nine cards, newest first,
// each one saying who, what, how long, when and what it paid.

const FEED_MAX_MINUTES = 360; // past six hours a duration is a data glitch, not a workout

function ActivityScene({ feed, now, tz, gym }) {
    const cards = feed.slice(0, 12);
    const top = Math.max(1, ...cards.map((c) => c.points));
    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <div className="mt-[1.4rem] flex items-baseline justify-between shrink-0">
                <div className="text-[2.2rem] font-light tracking-tighter leading-none">Latest at {gym}</div>
                <div className="text-[0.7rem] uppercase tracking-[0.35em] text-white/30 font-bold">What members earned on · last 7 days</div>
            </div>
            <div className="flex-1 min-h-0 grid grid-cols-3 grid-rows-4 gap-[0.9rem] mt-[1.2rem]">
                {cards.map((item, i) => {
                    const meta = activityMeta(item.type);
                    const dur = item.minutes > 0 && item.minutes <= FEED_MAX_MINUTES ? fmtMinutes(item.minutes) : null;
                    const frac = Math.max(0.06, Math.min(1, item.points / top));
                    return (
                        <motion.div
                            key={item.key}
                            initial={{ opacity: 0, y: 18, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ delay: 0.06 * i, duration: 0.45, ease: 'easeOut' }}
                            className={`relative min-h-0 rounded-[1.1rem] border bg-white/[0.03] px-[1.1rem] py-[0.9rem] flex flex-col justify-center overflow-hidden ${i === 0 ? 'border-[#E8D200]/35' : 'border-white/10'}`}
                        >
                            {/* watermark: the activity, big and quiet */}
                            <span className="pointer-events-none absolute -right-[0.6rem] -bottom-[0.9rem] text-[5.2rem] leading-none opacity-[0.07] select-none">{meta.glyph}</span>
                            {i === 0 && (
                                <span className="absolute top-[0.7rem] right-[0.9rem] text-[0.6rem] uppercase tracking-[0.3em] font-black" style={{ color: GOLD }}>Latest</span>
                            )}
                            <div className="flex items-center gap-[0.8rem] min-w-0">
                                <Avatar row={item} size={2.7} ring="rgba(255,255,255,0.14)" ringWidth={0.08} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline gap-[0.6rem] min-w-0">
                                        <span className="text-[1.3rem] font-light leading-tight truncate">{boardName(item)}</span>
                                        <span className="text-[0.72rem] text-white/40 font-light shrink-0">{whenLabel(item.ended_at, now, tz)}</span>
                                    </div>
                                    <div className="text-[0.95rem] text-white/70 font-light truncate mt-[0.1rem]">
                                        {meta.label}{dur ? ` · ${dur}` : ''}
                                        <span className="text-[0.6rem] uppercase tracking-[0.3em] text-white/30 font-black ml-[0.6rem]">{item.verified ? 'Verified' : 'Logged'}</span>
                                    </div>
                                </div>
                                <div className="text-right shrink-0 pl-[0.4rem]">
                                    <span className="text-[1.9rem] leading-none font-extralight tabular-nums" style={{ color: GOLD }}>+{item.points.toLocaleString()}</span>
                                    <span className="text-[0.58rem] uppercase tracking-[0.3em] text-white/35 font-black ml-[0.3rem]">pts</span>
                                </div>
                            </div>
                            <div className="absolute left-[1.1rem] right-[1.1rem] bottom-0 h-[2px] bg-white/[0.06] rounded-full overflow-hidden">
                                <motion.div
                                    className="h-full rounded-full"
                                    style={{ background: `linear-gradient(90deg, ${GOLD}, ${GOLD}55)` }}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${frac * 100}%` }}
                                    transition={{ delay: 0.06 * i + 0.3, duration: 0.8, ease: 'easeOut' }}
                                />
                            </div>
                        </motion.div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Chasing scene ───────────────────────────────────────────────
// Ranks past the list, as full rows — rank 19 gets its moment.

function ChasingScene({ rows, leader }) {
    const shown = rows.slice(0, 10);
    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <div className="mt-[1.4rem] flex items-baseline justify-between shrink-0">
                <div className="text-[2.2rem] font-light tracking-tighter leading-none">The chasing pack</div>
                <div className="text-[0.7rem] uppercase tracking-[0.35em] text-white/30 font-bold">{rows.length} more on the board this week</div>
            </div>
            <div className="flex-1 min-h-0 flex flex-col justify-evenly mt-[0.6rem]">
                {shown.map((row) => <Row key={row.key} row={row} leader={leader} />)}
            </div>
        </div>
    );
}

// ─── Marquee ─────────────────────────────────────────────────────
// The feed, always moving, along the bottom of the wall. The track holds the
// list twice and slides half its width, so the loop is seamless.

function Marquee({ feed, now, tz }) {
    const items = feed.slice(0, 16);
    const sig = items.map((x) => x.key).join('|');
    const list = useMemo(() => items, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
    if (list.length === 0) return null;
    const seconds = Math.max(30, list.length * 6);
    return (
        <div className="shrink-0 border-t border-white/[0.07] bg-black/30 h-[3.2rem] flex items-center overflow-hidden">
            <div className="shrink-0 h-full flex items-center gap-[0.6rem] pl-[4rem] pr-[1.4rem] bg-[#070707] z-10" style={{ boxShadow: '1rem 0 1.5rem #070707' }}>
                <span className="w-[0.5rem] h-[0.5rem] rounded-full bg-emerald-400" style={{ animation: 'gbPulse 1.6s ease-in-out infinite' }} />
                <span className="text-[0.65rem] uppercase tracking-[0.4em] text-white/45 font-black">Live feed</span>
            </div>
            <div className="flex-1 min-w-0 h-full overflow-hidden">
                <div className="h-full flex items-center whitespace-nowrap will-change-transform" style={{ animation: `gbMarquee ${seconds}s linear infinite` }}>
                    {[0, 1].map((dup) => (
                        <span key={dup} className="flex items-center" aria-hidden={dup === 1}>
                            {list.map((item) => {
                                const meta = activityMeta(item.type);
                                const dur = item.minutes > 0 && item.minutes <= FEED_MAX_MINUTES ? fmtMinutes(item.minutes) : null;
                                return (
                                    <span key={`${dup}-${item.key}`} className="inline-flex items-center gap-[0.55rem] pr-[2.6rem] text-[0.95rem]">
                                        <span>{meta.glyph}</span>
                                        <span className="text-white/90 font-medium">{boardName(item)}</span>
                                        <span className="text-white/45 font-light">{meta.label}{dur ? ` · ${dur}` : ''}</span>
                                        <span className="tabular-nums font-semibold" style={{ color: GOLD }}>+{item.points}</span>
                                        <span className="text-white/30 font-light text-[0.8rem]">{whenLabel(item.ended_at, now, tz)}</span>
                                        <span className="text-white/15 pl-[1.2rem]">●</span>
                                    </span>
                                );
                            })}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

function EmptyBoard() {
    return (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center gap-[2rem]">
            <div className="grid grid-cols-3 gap-[1.5rem] items-end w-full max-w-[52rem]">
                {PODIUM_ORDER.map((rank) => (
                    <div key={rank} className="flex flex-col items-center">
                        <GhostSeat size={rank === 1 ? 7.2 : 5.4} />
                        <div
                            className="w-full mt-[1rem] rounded-t-[1.1rem] border-t"
                            style={{ height: `${rank === 1 ? 5 : rank === 2 ? 3.6 : 2.8}rem`, borderColor: ringColour(rank), background: `linear-gradient(180deg, ${ringColour(rank)}1a, transparent)` }}
                        />
                    </div>
                ))}
            </div>
            <div>
                <div className="text-[3.4rem] font-light tracking-tighter leading-none">The board is open.</div>
                <div className="text-[1.35rem] text-white/50 font-light mt-[0.8rem]">First verified session here this week takes the top spot.</div>
            </div>
        </div>
    );
}
