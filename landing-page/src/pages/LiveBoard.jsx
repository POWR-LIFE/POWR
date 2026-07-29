import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';

/**
 * Big-screen venue display — powr.life/live/<slug>?k=<display_token>.
 *
 * Runs full-screen on a TV at the event. Chromeless, dark, huge type. The
 * screen simply follows event status via the public event-board edge fn
 * (the ?k token grants display access only — while the board is locked the
 * server sends nothing score-shaped, so there is nothing here to blur).
 *
 * States: countdown → live board (top 10 large + cycling remainder) →
 * locked suspense → staged podium reveal (3rd → 2nd → 1st, admin-triggered
 * by flipping the event to revealed) → settled winners.
 *
 * Degrades gracefully on venue wifi: keeps the last good payload, shows a
 * quiet reconnecting note, and retries on the next tick.
 */

const GOLD = '#E8D200';
const POLL_MS = 12_000;
const STALE_MS = 45_000;
const FN_BASE = `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/event-board`;

const fmtDay = (iso) =>
    new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// The scoring window is half-open — show the last day that counts.
const lastDay = (endIso) => fmtDay(new Date(new Date(endIso).getTime() - 60_000).toISOString());

const nameOf = (row) => row.display_name || row.username || 'POWR member';

export default function LiveBoard() {
    const { slug } = useParams();
    const [params] = useSearchParams();
    const token = params.get('k') ?? '';

    const [board, setBoard] = useState(null);   // last good payload
    const [invalid, setInvalid] = useState(false);
    const [lastOkAt, setLastOkAt] = useState(0);
    const [now, setNow] = useState(Date.now());

    // Poll the edge fn; keep the last good payload on any failure.
    useEffect(() => {
        let alive = true;
        const tick = async () => {
            try {
                const res = await fetch(`${FN_BASE}?slug=${encodeURIComponent(slug)}&k=${encodeURIComponent(token)}`);
                if (!alive) return;
                if (res.status === 404 || res.status === 400) {
                    // Hard invalidation: a regenerated token or archived event
                    // must blank the screen NOW, not leave the last standings
                    // up behind a "reconnecting" note — token rotation is the
                    // access kill-switch. (Polling continues, so a restored
                    // event recovers on its own.)
                    setInvalid(true);
                    setBoard(null);
                    setLastOkAt(0);
                    return;
                }
                if (!res.ok) return; // transient — keep last data
                const data = await res.json();
                setBoard(data);
                setInvalid(false);
                setLastOkAt(Date.now());
            } catch {
                // venue wifi blip — keep last data, retry next tick
            }
        };
        tick();
        const id = setInterval(tick, POLL_MS);
        return () => { alive = false; clearInterval(id); };
    }, [slug, token]);

    // Local clock for countdowns + staleness, 1s resolution.
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const stale = board && lastOkAt > 0 && now - lastOkAt > STALE_MS;

    if (invalid) return <Shell><CenterNote big="This screen link isn’t valid" small="Ask the POWR team for a fresh display URL." /></Shell>;
    if (!board) return <Shell><CenterNote big="POWR" small="Connecting…" pulse /></Shell>;

    return (
        <Shell>
            <Header board={board} stale={stale} />
            <div className="flex-1 min-h-0 flex flex-col">
                {board.state === 'countdown' && <Countdown board={board} now={now} />}
                {board.state === 'live' && <LiveStandings board={board} />}
                {board.state === 'locked' && <LockedSuspense />}
                {board.state === 'revealed' && <Reveal board={board} />}
            </div>
            <Footer />
        </Shell>
    );
}

// ─── Chrome ──────────────────────────────────────────────────────

function Shell({ children }) {
    return (
        <div className="fixed inset-0 bg-[#080808] text-[#F2F2F2] flex flex-col overflow-hidden select-none"
            style={{ fontFamily: "'Poppins', 'Helvetica Neue', sans-serif" }}>
            {/* soft brand glow */}
            <div className="pointer-events-none absolute -top-64 left-1/2 -translate-x-1/2 w-[60vw] h-[50vh] rounded-full opacity-[0.07]"
                style={{ background: `radial-gradient(closest-side, ${GOLD}, transparent)` }} />
            {children}
        </div>
    );
}

function Header({ board, stale }) {
    return (
        <div className="flex items-end justify-between px-14 pt-10 pb-6 shrink-0">
            <div>
                <div className="flex items-center gap-4 mb-2">
                    <span className="text-[13px] font-black uppercase tracking-[0.6em]" style={{ color: GOLD }}>POWR · Live event</span>
                    {board.state === 'live' && (
                        <span className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.3em] text-emerald-400">
                            <motion.span
                                className="w-2.5 h-2.5 rounded-full bg-emerald-400"
                                animate={{ opacity: [1, 0.2, 1] }}
                                transition={{ duration: 1.6, repeat: Infinity }}
                            />
                            Live
                        </span>
                    )}
                </div>
                <h1 className="text-7xl font-light tracking-tighter leading-none">{board.name}</h1>
            </div>
            <div className="text-right pb-1">
                <div className="text-[15px] text-white/50 font-light">
                    {fmtDay(board.window_start_at)} → {lastDay(board.window_end_at)}
                </div>
                <div className="text-[12px] uppercase tracking-[0.35em] text-white/30 font-bold mt-1">
                    Only points earned this week count
                </div>
                {stale && (
                    <div className="text-[11px] uppercase tracking-[0.3em] text-amber-400/80 font-bold mt-2">
                        Reconnecting — showing last scores
                    </div>
                )}
            </div>
        </div>
    );
}

function Footer() {
    return (
        <div className="flex items-center justify-between px-14 pb-8 pt-4 shrink-0">
            <span className="text-[12px] uppercase tracking-[0.5em] text-white/25 font-black">Train. Earn. Repeat.</span>
            <div className="flex items-center gap-4">
                <div className="text-right">
                    <div className="text-[13px] font-semibold text-white/80">Get POWR</div>
                    <div className="text-[11px] text-white/40">Scan to join the next one</div>
                </div>
                <div className="bg-white rounded-xl p-2">
                    <QRCodeSVG value="https://powr.life/app" size={72} fgColor="#0a0a0a" bgColor="#FFFFFF" />
                </div>
            </div>
        </div>
    );
}

function CenterNote({ big, small, pulse }) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <motion.div
                className="text-7xl font-light tracking-tighter"
                animate={pulse ? { opacity: [0.4, 1, 0.4] } : undefined}
                transition={pulse ? { duration: 2.2, repeat: Infinity } : undefined}
            >
                {big}
            </motion.div>
            <div className="text-xl text-white/40 font-light">{small}</div>
        </div>
    );
}

// ─── Countdown (pre-week) ────────────────────────────────────────

function Countdown({ board, now }) {
    const target = new Date(board.window_start_at).getTime();
    const dt = Math.max(0, target - now);
    const d = Math.floor(dt / 86_400_000);
    const h = Math.floor((dt % 86_400_000) / 3_600_000);
    const m = Math.floor((dt % 3_600_000) / 60_000);
    const s = Math.floor((dt % 60_000) / 1000);
    const cells = d > 0 ? [[d, 'days'], [h, 'hours'], [m, 'min']] : [[h, 'hours'], [m, 'min'], [s, 'sec']];

    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-14">
            <div className="text-2xl uppercase tracking-[0.5em] text-white/40 font-bold">The week starts in</div>
            <div className="flex items-baseline gap-12">
                {cells.map(([v, label]) => (
                    <div key={label} className="text-center">
                        <div className="text-[11rem] leading-none font-extralight tabular-nums tracking-tighter" style={{ color: GOLD }}>
                            {String(v).padStart(2, '0')}
                        </div>
                        <div className="text-lg uppercase tracking-[0.5em] text-white/35 font-bold mt-3">{label}</div>
                    </div>
                ))}
            </div>
            {board.prizes?.length > 0 && <PrizeStrip prizes={board.prizes} />}
        </div>
    );
}

function PrizeStrip({ prizes }) {
    return (
        <div className="flex items-center gap-10">
            {prizes.slice(0, 3).map((p) => (
                <div key={p.rank} className="flex items-center gap-3">
                    <span className="text-2xl font-light" style={{ color: GOLD }}>{medal(p.rank)}</span>
                    <span className="text-xl text-white/70 font-light">{p.label}</span>
                </div>
            ))}
        </div>
    );
}

const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`);

// ─── Live board ──────────────────────────────────────────────────

function LiveStandings({ board }) {
    const top10 = board.standings.slice(0, 10);
    const rest = board.standings.slice(10);

    // Auto-cycle the remainder in pages so rank 37 gets its moment.
    const PAGE = 8;
    const pages = Math.max(1, Math.ceil(rest.length / PAGE));
    const [page, setPage] = useState(0);
    useEffect(() => {
        if (pages <= 1) return;
        const id = setInterval(() => setPage((p) => (p + 1) % pages), 8000);
        return () => clearInterval(id);
    }, [pages]);
    const restPage = rest.slice(page * PAGE, page * PAGE + PAGE);

    if (board.standings.length === 0) {
        return <CenterNote big="No scores yet" small="First workouts land here the moment they're verified." />;
    }

    return (
        <div className="flex-1 min-h-0 flex gap-12 px-14">
            {/* Top 10 — the main event */}
            <div className="flex-[2] min-w-0 flex flex-col justify-center gap-1.5">
                {top10.map((row) => (
                    <motion.div
                        key={row.key ?? nameOf(row) + row.rank}
                        layout
                        transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                        className={`flex items-center gap-6 rounded-2xl px-7 ${row.rank === 1 ? 'py-4 bg-white/[0.06] border border-[#E8D200]/30' : 'py-2.5 bg-white/[0.02]'}`}
                    >
                        <span
                            className={`w-16 text-right tabular-nums font-extralight ${row.rank === 1 ? 'text-6xl' : 'text-3xl'}`}
                            style={{ color: row.rank <= 3 ? GOLD : 'rgba(255,255,255,0.35)' }}
                        >
                            {row.rank}
                        </span>
                        <Avatar row={row} size={row.rank === 1 ? 64 : 44} />
                        <span className={`flex-1 truncate font-light ${row.rank === 1 ? 'text-5xl' : 'text-2xl text-white/85'}`}>
                            {nameOf(row)}
                        </span>
                        <span
                            className={`tabular-nums font-light ${row.rank === 1 ? 'text-5xl' : 'text-2xl'}`}
                            style={{ color: row.rank <= 3 ? GOLD : 'rgba(255,255,255,0.6)' }}
                        >
                            {row.points.toLocaleString()}
                            <span className="text-[0.45em] uppercase tracking-[0.25em] text-white/30 font-bold ml-2">pts</span>
                        </span>
                    </motion.div>
                ))}
            </div>

            {/* Right rail: prizes + cycling remainder */}
            <div className="flex-1 min-w-0 flex flex-col justify-center gap-8">
                {board.prizes?.length > 0 && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-3">
                        <div className="text-[11px] uppercase tracking-[0.4em] text-white/35 font-black">This week's prizes</div>
                        {board.prizes.slice(0, 3).map((p) => (
                            <div key={p.rank} className="flex items-center gap-3">
                                <span className="text-xl">{medal(p.rank)}</span>
                                <span className="text-lg text-white/75 font-light truncate">{p.label}</span>
                            </div>
                        ))}
                    </div>
                )}
                {rest.length > 0 && (
                    <div className="space-y-1">
                        <div className="text-[11px] uppercase tracking-[0.4em] text-white/35 font-black mb-2">
                            Chasing — {rest.length} more
                        </div>
                        <AnimatePresence mode="popLayout">
                            {restPage.map((row) => (
                                <motion.div
                                    key={row.key ?? nameOf(row) + row.rank}
                                    initial={{ opacity: 0, x: 24 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -24 }}
                                    transition={{ duration: 0.35 }}
                                    className="flex items-center gap-4 py-1.5"
                                >
                                    <span className="w-10 text-right text-lg tabular-nums text-white/30 font-light">{row.rank}</span>
                                    <span className="flex-1 truncate text-lg text-white/60 font-light">{nameOf(row)}</span>
                                    <span className="text-lg tabular-nums text-white/40 font-light">{row.points.toLocaleString()}</span>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        </div>
    );
}

function Avatar({ row, size }) {
    const initials = nameOf(row).split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    return row.avatar_url ? (
        <img
            src={row.avatar_url}
            alt=""
            width={size}
            height={size}
            className="rounded-full object-cover shrink-0"
            style={{ width: size, height: size }}
        />
    ) : (
        <div
            className="rounded-full bg-white/10 flex items-center justify-center shrink-0"
            style={{ width: size, height: size }}
        >
            <span className="font-medium text-white/60" style={{ fontSize: size * 0.34 }}>{initials}</span>
        </div>
    );
}

// ─── Locked suspense ─────────────────────────────────────────────

function LockedSuspense() {
    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-8">
            <motion.div
                className="text-[7rem] leading-none"
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
            >
                🔒
            </motion.div>
            <div className="text-6xl font-light tracking-tight text-center">Scores are locked</div>
            <div className="text-2xl text-white/45 font-light text-center max-w-3xl">
                The winners are being verified — revealed live, right here, tonight.
            </div>
        </div>
    );
}

// ─── Staged reveal ───────────────────────────────────────────────
// 3rd → 2nd → 1st, then the full winners board. The admin's Reveal action
// flips the event server-side; this screen picks it up on the next poll and
// runs the sequence. Refreshing the page re-runs it — a feature on the night.

const STAGE_HOLD_MS = 4200;

function Reveal({ board }) {
    const podium = useMemo(
        () => [3, 2, 1].map((r) => board.results.find((x) => x.rank === r)).filter(Boolean),
        [board.results],
    );
    // stage: 0 = suspense beat, then podium.length steps, then full board
    const [stage, setStage] = useState(board.settled ? podium.length + 1 : 0);
    const timer = useRef(null);

    useEffect(() => {
        if (stage > podium.length) return;
        timer.current = setTimeout(() => setStage((s) => s + 1), stage === 0 ? 1800 : STAGE_HOLD_MS);
        return () => clearTimeout(timer.current);
    }, [stage, podium.length]);

    const shown = podium.slice(0, Math.max(0, Math.min(stage, podium.length)));
    const done = stage > podium.length;

    if (board.results.length === 0) {
        return <CenterNote big="Results are in" small="Standby…" pulse />;
    }

    return (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-10 px-14">
            {!done && (
                <motion.div
                    key="eyebrow"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-2xl uppercase tracking-[0.5em] text-white/40 font-bold"
                >
                    {stage === 0 ? 'And the winners are…' : 'Your podium'}
                </motion.div>
            )}

            {/* Podium columns — always 3rd | 1st | 2nd visual order */}
            {!done && (
                <div className="flex items-end gap-10 h-[46vh]">
                    {[2, 1, 3].map((rank) => {
                        const row = shown.find((x) => x.rank === rank);
                        const height = rank === 1 ? '100%' : rank === 2 ? '72%' : '54%';
                        return (
                            <div key={rank} className="flex flex-col items-center justify-end gap-5" style={{ height }}>
                                <AnimatePresence>
                                    {row && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 60, scale: 0.8 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            transition={{ type: 'spring', stiffness: 90, damping: 14 }}
                                            className="flex flex-col items-center gap-4"
                                        >
                                            <div className="text-5xl">{medal(rank)}</div>
                                            <Avatar row={row} size={rank === 1 ? 128 : 96} />
                                            <div className={`font-light text-center ${rank === 1 ? 'text-6xl' : 'text-4xl'}`}>
                                                {nameOf(row)}
                                            </div>
                                            <div className="text-3xl tabular-nums font-light" style={{ color: GOLD }}>
                                                {row.points.toLocaleString()} pts
                                            </div>
                                            {row.prize_label && (
                                                <div className="text-xl text-white/60 font-light text-center max-w-xs">{row.prize_label}</div>
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                                <div
                                    className="w-56 rounded-t-2xl border-t-2 flex items-start justify-center pt-4"
                                    style={{
                                        height: rank === 1 ? 130 : rank === 2 ? 92 : 64,
                                        borderColor: GOLD,
                                        background: `linear-gradient(180deg, ${GOLD}22, transparent)`,
                                    }}
                                >
                                    <span className="text-3xl font-extralight" style={{ color: GOLD }}>{rank}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Full winners board after the staging */}
            {done && (
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full max-w-5xl flex flex-col gap-2"
                >
                    <div className="text-2xl uppercase tracking-[0.5em] text-white/40 font-bold text-center mb-6">Final standings</div>
                    {board.results.slice(0, 10).map((row) => (
                        <div
                            key={row.rank}
                            className={`flex items-center gap-6 rounded-2xl px-7 ${row.rank === 1 ? 'py-4 bg-white/[0.06] border border-[#E8D200]/30' : 'py-2.5 bg-white/[0.02]'}`}
                        >
                            <span className="w-16 text-right text-3xl tabular-nums font-extralight" style={{ color: row.rank <= 3 ? GOLD : 'rgba(255,255,255,0.35)' }}>
                                {medal(row.rank)}
                            </span>
                            <Avatar row={row} size={44} />
                            <span className="flex-1 truncate text-2xl text-white/85 font-light">{nameOf(row)}</span>
                            {row.prize_label && <span className="text-lg text-white/45 font-light truncate max-w-xs">{row.prize_label}</span>}
                            <span className="text-2xl tabular-nums font-light" style={{ color: row.rank <= 3 ? GOLD : 'rgba(255,255,255,0.6)' }}>
                                {row.points.toLocaleString()}
                            </span>
                        </div>
                    ))}
                </motion.div>
            )}
        </div>
    );
}
