import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { storageImage } from '../lib/storage';
import {
    barFraction,
    boardName,
    countdownParts,
    initials,
    resetLabel,
    rootFontSize,
    sampleStandings,
    splitStandings,
    weekLabel,
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
const FN_BASE = `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/gym-board`;
const JOIN_URL = 'https://powr.life/app';
const PREVIEW_STATES = ['sample', 'empty'];

const ringColour = (rank) => (rank === 1 ? GOLD : rank === 2 ? SILVER : rank === 3 ? BRONZE : 'rgba(255,255,255,0.12)');

function applyPreview(board, preview) {
    if (preview === 'empty') {
        return { ...board, standings: [], stats: { members: 0, points: 0, sessions: 0 }, last_week: { ...board.last_week, podium: [] } };
    }
    const standings = sampleStandings(18);
    return {
        ...board,
        standings,
        stats: {
            members: standings.length,
            points: standings.reduce((a, r) => a + r.points, 0),
            sessions: standings.reduce((a, r) => a + r.sessions, 0),
        },
        last_week: { ...board.last_week, podium: sampleStandings(3).map((r) => ({ ...r, key: `lw-${r.key}`, points: r.points + 96 })) },
        community: Math.max(board.community ?? 0, 64),
    };
}

export default function GymBoard() {
    const { slug } = useParams();
    const [params] = useSearchParams();
    const token = params.get('k') ?? '';
    const previewParam = params.get('preview');
    const preview = PREVIEW_STATES.includes(previewParam) ? previewParam : null;

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
            <div className="relative h-full grid grid-cols-[29rem_1fr] gap-[4rem] px-[4rem] py-[2.75rem]">
                <Rail board={shown} now={now} />
                <Main board={shown} stale={stale && !preview} />
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

// ─── Left rail ───────────────────────────────────────────────────

function Rail({ board, now }) {
    const champ = board.last_week?.podium?.[0] ?? null;
    const runners = (board.last_week?.podium ?? []).slice(1, 3);
    const parts = countdownParts(board.week_end_at, now);
    const span = new Date(board.week_end_at) - new Date(board.week_start_at);
    const elapsed = span > 0 ? Math.min(1, Math.max(0, (now - new Date(board.week_start_at)) / span)) : 0;
    const logoDark = board.gym.logo_bg !== 'light';

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
                <div className="mt-[1.6rem] flex items-center gap-[0.9rem]">
                    <span className="text-[1.05rem] text-white/60 font-light">{weekLabel(board.week_start_at, board.week_end_at, board.tz)}</span>
                    <span className="flex items-center gap-[0.45rem] text-[0.7rem] font-black uppercase tracking-[0.3em] text-emerald-400">
                        <span className="w-[0.55rem] h-[0.55rem] rounded-full bg-emerald-400" style={{ animation: 'gbPulse 1.6s ease-in-out infinite' }} />
                        Live
                    </span>
                </div>
                <div className="text-[0.7rem] uppercase tracking-[0.3em] text-white/30 font-bold mt-[0.5rem]">
                    Only points earned here, this week
                </div>
            </div>

            {/* The week in numbers */}
            <div className="grid grid-cols-3 gap-[1rem]">
                <Stat label="Members" value={board.stats.members} />
                <Stat label="Points" value={board.stats.points} gold />
                <Stat label="Sessions" value={board.stats.sessions} />
            </div>

            {/* Reset clock */}
            <div>
                <div className="flex items-end justify-between">
                    <Eyebrow>Week resets in</Eyebrow>
                    <span className="text-[0.7rem] uppercase tracking-[0.3em] text-white/30 font-bold">Monday 00:00</span>
                </div>
                <div className="text-[2.6rem] font-extralight tracking-tight tabular-nums leading-none mt-[0.5rem]">{resetLabel(parts)}</div>
                <div className="mt-[0.9rem] h-[2px] w-full bg-white/10 rounded-full overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ background: GOLD }} animate={{ width: `${elapsed * 100}%` }} transition={{ duration: 1 }} />
                </div>
            </div>

            {/* Last week */}
            <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-[1.4rem]">
                <Eyebrow colour={GOLD}>Last week’s champion</Eyebrow>
                {champ ? (
                    <div className="mt-[1rem] flex items-center gap-[1rem]">
                        <Avatar row={champ} size={3.8} ring={GOLD} ringWidth={0.15} />
                        <div className="min-w-0 flex-1">
                            <div className="text-[1.55rem] font-light leading-tight truncate">{boardName(champ)}</div>
                            <div className="text-[1rem] tabular-nums font-light" style={{ color: GOLD }}>
                                {champ.points.toLocaleString()} <span className="text-[0.6em] uppercase tracking-[0.25em] text-white/35 font-bold">pts</span>
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

function Stat({ label, value, gold }) {
    return (
        <div className="rounded-[1.1rem] border border-white/10 bg-white/[0.03] px-[1rem] py-[0.9rem] min-w-0">
            <Num value={value} className="block text-[2.2rem] leading-none font-extralight tracking-tight" style={{ color: gold ? GOLD : '#F2F2F2' }} />
            <div className="text-[0.62rem] uppercase tracking-[0.3em] text-white/35 font-black mt-[0.55rem] truncate">{label}</div>
        </div>
    );
}

// ─── Main ────────────────────────────────────────────────────────

function Main({ board, stale }) {
    const { podium, list, rest } = useMemo(() => splitStandings(board.standings, 7), [board.standings]);
    const leader = podium[0]?.points ?? 0;

    return (
        <section className="min-h-0 flex flex-col">
            <div className="flex items-center justify-between shrink-0">
                <div className="text-[0.9rem] font-black tracking-[0.5em] uppercase">POWR</div>
                <div className="flex items-center gap-[1.5rem]">
                    {stale && (
                        <span className="text-[0.7rem] uppercase tracking-[0.3em] text-amber-400/80 font-bold">Reconnecting — showing last scores</span>
                    )}
                    <span className="text-[0.7rem] uppercase tracking-[0.35em] text-white/30 font-bold">Train · Earn · Repeat</span>
                </div>
            </div>

            {board.standings.length === 0 ? (
                <EmptyBoard />
            ) : (
                <>
                    <Podium rows={podium} />
                    <div className="flex-1 min-h-0 flex flex-col justify-evenly mt-[1.2rem]">
                        {list.map((row) => <Row key={row.key} row={row} leader={leader} />)}
                    </div>
                    {rest.length > 0 && <Ticker rows={rest} />}
                </>
            )}
        </section>
    );
}

const PODIUM_ORDER = [2, 1, 3];

function Podium({ rows }) {
    const byRank = (r) => rows.find((x) => x.rank === r);
    return (
        <div className="shrink-0 grid grid-cols-3 gap-[1.5rem] items-end mt-[1.5rem]">
            {PODIUM_ORDER.map((rank) => {
                const row = byRank(rank);
                const first = rank === 1;
                const platform = first ? 6.5 : rank === 2 ? 4.6 : 3.6;
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
                                    <Avatar row={row} size={first ? 7.2 : 5.4} ring={ringColour(rank)} />
                                    <div className="mt-[0.9rem] flex items-center gap-[0.6rem] max-w-full">
                                        <span className={`truncate font-light leading-tight ${first ? 'text-[2.1rem]' : 'text-[1.6rem] text-white/90'}`}>{boardName(row)}</span>
                                        <Move delta={row.rank_delta} size={first ? 'lg' : 'sm'} />
                                    </div>
                                    <div className="mt-[0.2rem] flex items-baseline gap-[0.5rem]">
                                        <Num value={row.points} className={`font-extralight tracking-tight ${first ? 'text-[2.7rem]' : 'text-[2rem]'}`} style={{ color: ringColour(rank) }} />
                                        <span className="text-[0.7rem] uppercase tracking-[0.3em] text-white/35 font-black">pts</span>
                                    </div>
                                    <div className="text-[0.75rem] uppercase tracking-[0.25em] text-white/35 font-bold mt-[0.1rem]">
                                        {row.sessions} {row.sessions === 1 ? 'session' : 'sessions'}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                        {!row && <GhostSeat size={first ? 7.2 : 5.4} />}
                        <div
                            className={`relative w-full mt-[1rem] rounded-t-[1.1rem] overflow-hidden border-t ${first ? 'gb-sweep' : ''}`}
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
            className="relative grid grid-cols-[3rem_3.2rem_3.2rem_1fr_auto_9rem] items-center gap-[1rem] px-[1rem] py-[0.55rem] rounded-[0.9rem]"
        >
            <span className="text-right text-[1.7rem] font-extralight tabular-nums text-white/40">{row.rank}</span>
            <span className="flex justify-center"><Move delta={row.rank_delta} /></span>
            <Avatar row={row} size={2.8} />
            <span className="truncate text-[1.5rem] font-light text-white/90">{boardName(row)}</span>
            <span className="text-[0.7rem] uppercase tracking-[0.25em] text-white/30 font-bold whitespace-nowrap">
                {row.sessions} {row.sessions === 1 ? 'session' : 'sessions'}
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

// Ranks beyond the list, a page at a time — rank 19 gets its moment.
function Ticker({ rows }) {
    const PAGE = 5;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    const [page, setPage] = useState(0);
    useEffect(() => {
        if (pages <= 1) return;
        const id = setInterval(() => setPage((p) => (p + 1) % pages), 7000);
        return () => clearInterval(id);
    }, [pages]);
    const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
    return (
        <div className="shrink-0 mt-[1rem] pt-[0.9rem] border-t border-white/[0.07] flex items-center gap-[1.2rem]">
            <Eyebrow className="shrink-0">Chasing · {rows.length} more</Eyebrow>
            <div className="flex-1 min-w-0 flex items-center gap-[0.8rem] overflow-hidden">
                <AnimatePresence mode="popLayout">
                    {shown.map((row) => (
                        <motion.span
                            key={row.key}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.35 }}
                            className="flex items-center gap-[0.6rem] rounded-full border border-white/10 bg-white/[0.03] pl-[0.35rem] pr-[0.9rem] py-[0.3rem] min-w-0"
                        >
                            <Avatar row={row} size={1.8} />
                            <span className="text-[0.85rem] tabular-nums text-white/35">{row.rank}</span>
                            <span className="text-[1rem] text-white/75 font-light truncate max-w-[10rem]">{boardName(row)}</span>
                            <span className="text-[1rem] tabular-nums text-white/50 font-light">{row.points.toLocaleString()}</span>
                        </motion.span>
                    ))}
                </AnimatePresence>
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
