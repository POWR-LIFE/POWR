import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { Activity, Bike, Dumbbell, Flame, Flower2, Footprints, Gift, Lock, Music, PersonStanding, QrCode, Sparkles, Swords, Trophy, UserPlus, Waves, Zap } from 'lucide-react';
import { storageImage } from '../lib/storage';
import { eventRegisterUrl } from '../lib/eventRegisterUrl';
import { activityMeta, boardName, countdownParts, initials, resetLabel, rootFontSize, weekLabel } from '../../../shared/gymBoard.ts';
import { ordinal, sessionsToClose } from '../../../shared/gymLeague.ts';
import {
    RACE_LANES,
    gateLine,
    liveMode,
    liveScenePlan,
    prizeLine,
    prizeSlots,
    raceThreshold,
    sampleLiveRows,
    simulateLanding,
} from '../../../shared/liveBoard.ts';

/**
 * Big-screen venue display — powr.life/live/<slug>?k=<display_token>.
 *
 * Runs full-screen on a TV at the event, in Gym Clash's clothes: same shell,
 * lanes, feed and ticker. The screen follows event status via the public
 * event-board edge fn (the ?k token grants display access only — while the
 * board is locked the server sends nothing score-shaped).
 *
 * States: countdown → live → sealed → staged podium reveal → winners.
 * Live has two faces (shared/liveBoard.ts):
 *   WARM-UP while fewer than raceThreshold() people have scored — the prizes
 *           lead, each showing who holds it right now, and how to get in;
 *   RACE    once there are enough for a leaderboard to read as one.
 *
 * Every poll is diffed against the last: a workout that landed since flashes
 * its lane, rolls its number and slides into the feed.
 *
 * ?preview=<state> re-renders the real payload (prizes, venue) as any state
 * with obviously-sample people; warmup and live keep scoring while you watch.
 * ?scene=prizes|enter|race|fight|chasing pins a live scene.
 */

const GOLD = '#facc15';
const UP = '#4ade80';
const POLL_MS = 12_000;
const STALE_MS = 45_000;
const HIT_MS = 2_400;
const TZ = 'Europe/London';
const FN_BASE = `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/event-board`;
const PREVIEW_STATES = ['countdown', 'warmup', 'live', 'locked', 'reveal', 'settled'];
const SCENES = ['prizes', 'enter', 'race', 'fight', 'chasing'];
const fmt = (n) => Math.round(n).toLocaleString('en-GB');
const FEED_ROWS = 7;

const nameOf = (row) => boardName(row ?? {});

const fmtWhen = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const fmtDay = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
const fmtTime = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

// When the winners are shown: the planned reveal, else the doors.
const revealTarget = (b) => b.reveal_at ?? b.doors_open_at ?? null;

function applyPreview(board, preview) {
    const withPrize = (row) => ({ ...row, prize_label: board.prizes?.find((p) => p.rank === row.rank)?.label ?? null });
    switch (preview) {
        // A started event has nothing to count down to; show a sample clock.
        case 'countdown': return { ...board, state: 'countdown', starts_at: new Date(board.window_start_at) > new Date() ? board.window_start_at : new Date(Date.now() + 2 * 86_400_000 + 4 * 3_600_000 + 17 * 60_000).toISOString() };
        case 'locked':    return { ...board, state: 'locked' };
        case 'reveal':    return { ...board, state: 'revealed', settled: false, results: sampleLiveRows(10).map(withPrize) };
        case 'settled':   return { ...board, state: 'revealed', settled: true, results: sampleLiveRows(10).map(withPrize) };
        default:          return board;
    }
}

// ─── Page ────────────────────────────────────────────────────────

export default function LiveBoard() {
    const { slug } = useParams();
    const [params] = useSearchParams();
    const token = params.get('k') ?? '';
    const previewParam = params.get('preview');
    const preview = PREVIEW_STATES.includes(previewParam) ? previewParam : null;
    const simulating = preview === 'warmup' || preview === 'live';
    const sceneParam = params.get('scene');
    const pinned = SCENES.includes(sceneParam) ? sceneParam : null;

    const [board, setBoard] = useState(null);   // last good payload
    const [sim, setSim] = useState(null);       // preview standings + feed, when simulating
    const [invalid, setInvalid] = useState(false);
    const [lastOkAt, setLastOkAt] = useState(0);
    const [now, setNow] = useState(Date.now());
    // Workouts that landed since the previous payload: { [rowKey]: { points, at, key } }
    const [hits, setHits] = useState({});
    const seenRef = useRef(null);

    useEffect(() => {
        const html = document.documentElement;
        const prev = html.style.fontSize;
        const fit = () => { html.style.fontSize = `${rootFontSize(window.innerWidth, window.innerHeight, 16)}px`; };
        fit();
        window.addEventListener('resize', fit);
        return () => { window.removeEventListener('resize', fit); html.style.fontSize = prev; };
    }, []);

    // Diff the feed against what the screen has already shown; anything new
    // is a landing. The first payload seeds silently.
    const absorb = useCallback((feed) => {
        const seen = seenRef.current;
        if (seen) {
            const landed = feed.filter((f) => !seen.has(f.key));
            if (landed.length) {
                const at = Date.now();
                setHits((h) => {
                    const next = { ...h };
                    for (const f of landed) next[f.who] = { points: (next[f.who]?.at > at - HIT_MS ? next[f.who].points : 0) + f.points, at, key: f.key };
                    return next;
                });
                setTimeout(() => setHits((h) => Object.fromEntries(Object.entries(h).filter(([, v]) => v.at > Date.now() - HIT_MS))), HIT_MS + 50);
            }
        }
        seenRef.current = new Set(feed.map((f) => f.key));
    }, []);

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
                if (!simulating) absorb(data.feed ?? []);
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
    }, [slug, token, simulating, absorb]);

    // Preview: sample people who keep scoring. Warm-up starts with two on the
    // board and lets a few more trickle in, stopping one short of the race.
    const prizeCount = board?.prizes?.length ?? 0;
    useEffect(() => {
        if (!simulating) return undefined;
        const warm = preview === 'warmup';
        const cap = raceThreshold(prizeCount) - 1;
        let rows = warm
            ? sampleLiveRows(2).map((r, i) => ({ ...r, points: [62, 38][i] }))
            : sampleLiveRows(24);
        const dayStart = new Map(rows.map((r) => [r.key, r.rank]));
        let feed = [];
        let n = 0;
        let timer;
        const pool = sampleLiveRows(24);
        const push = () => {
            const s = { standings: rows, feed, scorers: rows.length, room: { points: rows.reduce((t, r) => t + r.points, 0), sessions: rows.length * 3 + n }, entrants: warm ? 9 + rows.length : 41 };
            absorb(feed);
            setSim(s);
        };
        push();
        const step = () => {
            if (warm && rows.length < cap && Math.random() < 0.3) {
                const fresh = { ...pool[rows.length], points: 0 };
                dayStart.set(fresh.key, rows.length + 1);
                rows = [...rows, fresh];
            }
            const landed = simulateLanding(rows, dayStart, n++);
            rows = landed.rows;
            feed = [landed.item, ...feed].slice(0, 16);
            push();
            timer = setTimeout(step, 1800 + Math.random() * 2600);
        };
        timer = setTimeout(step, 1600);
        return () => clearTimeout(timer);
    }, [simulating, preview, prizeCount, absorb]);

    // Local clock for countdowns + staleness, 1s resolution.
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const stale = board && lastOkAt > 0 && now - lastOkAt > STALE_MS;

    if (invalid) return <Shell><CenterNote big="This screen link isn’t valid" small="Make a new link from the Screens page of your gym portal, or ask the POWR team" /></Shell>;
    if (!board) return <Shell><CenterNote big="POWR" small="Connecting…" pulse /></Shell>;

    const shown = simulating
        ? { ...board, state: 'live', standings: [], feed: [], ...(sim ?? {}) }
        : preview ? applyPreview(board, preview) : board;

    return (
        <Shell>
            <Wall board={shown} now={now} stale={stale && !preview} hits={hits} pinned={pinned} sampled={!!preview} />
            {preview && (
                <div className="lb-badge">Preview — sample people{simulating ? ', simulated workouts' : ''}</div>
            )}
        </Shell>
    );
}

// ─── Wall ────────────────────────────────────────────────────────

function Wall({ board, now, stale, hits, pinned, sampled }) {
    const prizes = useMemo(() => [...(board.prizes ?? [])].sort((a, b) => a.rank - b.rank), [board.prizes]);
    const standings = board.standings ?? [];
    const scorers = board.scorers ?? standings.length;
    const mode = liveMode(scorers, prizes.length);
    const state = board.state;
    const revealed = state === 'revealed';

    return (
        <div className={`lb-wall${revealed ? ' full' : ''}`}>
            <Header board={board} now={now} stale={stale} mode={mode} />
            <main className="lb-main">
                <div className="lb-stage">
                    {state === 'countdown' && <CountdownScene board={board} prizes={prizes} now={now} />}
                    {state === 'live' && <LiveStage board={board} prizes={prizes} mode={mode} scorers={scorers} hits={hits} pinned={pinned} />}
                    {state === 'locked' && <SealedScene board={board} prizes={prizes} now={now} />}
                    {revealed && <Reveal key={sampled ? `p-${board.settled}` : 'real'} board={board} prizes={prizes} />}
                </div>
                {!revealed && (
                    <aside className="lb-rail">
                        <Rail board={board} prizes={prizes} mode={mode} scorers={scorers} />
                    </aside>
                )}
            </main>
            <Marquee board={board} prizes={prizes} mode={mode} />
        </div>
    );
}

function Header({ board, now, stale, mode }) {
    const state = board.state;
    const phase = state === 'countdown' ? 0 : state === 'live' ? 1 : state === 'locked' ? 2 : 3;
    const venue = board.venue;
    const sealAt = board.lock_at && new Date(board.lock_at).getTime() > now ? board.lock_at : board.window_end_at;
    const reveal = revealTarget(board);
    const clock = state === 'countdown'
        ? <>Starts in <b>{resetLabel(countdownParts(board.starts_at ?? board.window_start_at, now))}</b></>
        : state === 'live'
            ? <>Scores seal in <b>{resetLabel(countdownParts(sealAt, now))}</b></>
            : state === 'locked'
                ? (reveal && new Date(reveal).getTime() > now ? <>Reveal in <b>{resetLabel(countdownParts(reveal, now))}</b></> : <>Reveal <b>any moment now</b></>)
                : <>Final results</>;
    const entrants = board.entrants;
    return (
        <header className="lb-head">
            <div className="lb-brand">
                <img className="lb-powr" src="/powr-logo-white.png" alt="POWR" />
                <span className="lb-title">{board.name}</span>
                {venue?.logo_url && <VenueMark venue={venue} />}
            </div>
            <div className="lb-scope">
                <div className="lb-lens">
                    {['Starts soon', 'Live', 'Sealed', 'Winners'].map((label, i) => (
                        <span key={label} className={i === phase ? 'on' : ''}>{label}</span>
                    ))}
                </div>
                <div className="lb-sub">
                    {weekLabel(board.window_start_at, board.window_end_at, TZ)}
                    {entrants != null && <> · <b>{fmt(entrants)}</b> entered</>}
                    {state === 'live' && mode === 'warmup' && <> · early days</>}
                </div>
            </div>
            <div className="lb-status">
                <span className="lb-clock">{clock}</span>
                {stale
                    ? <span className="lb-live lb-stale"><i />Reconnecting</span>
                    : state === 'live'
                        ? <span className="lb-live"><i />Live</span>
                        : state === 'locked'
                            ? <span className="lb-live lb-sealpill"><i />Sealed</span>
                            : null}
            </div>
        </header>
    );
}

// ─── Live ────────────────────────────────────────────────────────

function LiveStage({ board, prizes, mode, scorers, hits, pinned }) {
    const standings = board.standings ?? [];
    const plan = useMemo(
        () => liveScenePlan({ mode, prizes: prizes.length, rows: standings.length }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [mode, prizes.length, standings.length > prizes.length, standings.length > RACE_LANES],
    );
    const planKey = plan.map((p) => p.scene).join();
    const [idx, setIdx] = useState(0);
    useEffect(() => {
        if (pinned) return undefined;
        const cur = plan[idx % plan.length];
        const id = setTimeout(() => setIdx((i) => (i + 1) % plan.length), cur.ms);
        return () => clearTimeout(id);
        // Keyed on the plan's shape, never the payload: a fresh object lands
        // every poll and a timer restarted with it would never reach its dwell.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idx, planKey, pinned]);
    const scene = pinned && plan.some((p) => p.scene === pinned) ? pinned : plan[idx % plan.length].scene;

    return (
        <AnimatePresence mode="wait">
            <motion.section key={scene} className="lb-scene" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.45 }}>
                {scene === 'prizes' && <WarmPrizesScene board={board} prizes={prizes} scorers={scorers} hits={hits} />}
                {scene === 'enter' && <EnterScene board={board} prizes={prizes} />}
                {scene === 'race' && <RaceScene standings={standings} prizes={prizes} hits={hits} />}
                {scene === 'fight' && <FightScene standings={standings} prizes={prizes} hits={hits} />}
                {scene === 'chasing' && <ChasingScene standings={standings} />}
            </motion.section>
        </AnimatePresence>
    );
}

// WARM-UP: the prizes lead. Each place shows who holds it right now, or that
// it's there for the taking; under them, the board filling up to the race.
function WarmPrizesScene({ board, prizes, scorers, hits }) {
    const standings = board.standings ?? [];
    const need = raceThreshold(prizes.length);
    return (
        <>
            <div className="lb-eyebrow">
                <h2>{prizes.length ? 'Up for grabs · the prizes and who holds them right now' : 'Early days · first on the board'}</h2>
                <div className="lb-hint">Every workout from {fmtDay(board.window_start_at)} counts</div>
            </div>
            <div className="lb-warm">
                {prizes.length > 0
                    ? <Podium slots={prizeSlots(prizes, standings)} hits={hits} />
                    : <div className="lb-warm-hero">Be on the board<br /><span>before anyone else</span></div>}
                <div className="lb-fill">
                    <div className="lb-fill-slots">
                        {Array.from({ length: need }, (_, i) => {
                            const row = standings[i];
                            return row
                                ? <motion.div key={row.key} layout className={`lb-slot on${hits[row.key] ? ' hit' : ''}`}><Face row={row} size={3.2} /></motion.div>
                                : <div key={`empty-${i}`} className="lb-slot"><span>{i + 1}</span></div>;
                        })}
                    </div>
                    <div className="lb-fill-copy">
                        <div><b>{fmt(scorers)} of {need}</b> on the board</div>
                        <small>The full race board opens at {need} — scan the code and get your name up there</small>
                    </div>
                </div>
            </div>
        </>
    );
}

// WARM-UP, second beat: how to get in, with the code big enough to scan from the floor.
function EnterScene({ board, prizes }) {
    const gate = gateLine(board.gate);
    const reveal = revealTarget(board);
    const top = prizes.length;
    return (
        <>
            <div className="lb-eyebrow"><h2>How to get in</h2><div className="lb-hint">Free · takes a minute</div></div>
            <div className="lb-enter">
                <div className="lb-steps">
                    <div className="lb-step"><i><QrCode size="1.5rem" /></i><div><b>Scan and join {board.name}</b><small>In the POWR app. New to POWR? The code sets you up.</small></div></div>
                    <div className="lb-step"><i><Dumbbell size="1.5rem" /></i><div><b>Train anywhere, any way</b><small>Points you earn from {fmtDay(board.window_start_at)} to {fmtDay(new Date(new Date(board.window_end_at).getTime() - 60_000).toISOString())} count — join late and they still count.</small></div></div>
                    {gate && <div className="lb-step"><i><UserPlus size="1.5rem" /></i><div><b>{gate}</b><small>Share your code from the event page in the app.</small></div></div>}
                    <div className="lb-step"><i><Trophy size="1.5rem" /></i><div><b>{top > 0 ? `Top ${top} win` : 'Top the board'}</b><small>{reveal ? `Revealed live${board.venue?.name ? ` at ${board.venue.name}` : ''} · ${fmtWhen(reveal)}` : 'Revealed live at the final'}</small></div></div>
                </div>
                <div className="lb-bigqr">
                    <div className="qr"><QRCodeSVG value={eventRegisterUrl(board.slug)} size={512} fgColor="#0a0a0a" bgColor="#FFFFFF" style={{ width: '100%', height: '100%' }} /></div>
                    <b>Scan to enter</b>
                    <small>powr.life/app</small>
                </div>
            </div>
        </>
    );
}

// The prize places side by side, 2 | 1 | 3. A holder or "up for grabs" on
// each; past three places the rest run as a strip underneath.
function Podium({ slots, hits, sealed, openNote = 'the next workout takes it' }) {
    const main = slots.slice(0, 3);
    const extra = slots.slice(3);
    const order = main.length === 3 ? [main[1], main[0], main[2]] : main;
    return (
        <div className="lb-podium-wrap">
            <div className={`lb-podium n${order.length}`}>
                {order.map((slot) => {
                    const r = slot.prize.rank;
                    const h = slot.holder;
                    const hit = h ? hits?.[h.key] : null;
                    return (
                        <div key={r} className={`lb-col r${r}`}>
                            <PrizeArt prize={slot.prize} className="lb-col-art" />
                            <div className="lb-col-label">{slot.prize.label?.trim()}</div>
                            {sealed ? (
                                <div className="lb-holder ghost"><span className="lb-face ghost" style={{ width: '2.6rem', height: '2.6rem' }}>?</span><span>Sealed</span></div>
                            ) : h ? (
                                <div className={`lb-holder${hit ? ' hit' : ''}`}>
                                    <Face row={h} size={2.6} ring={r} />
                                    <span className="who"><b>{nameOf(h)}</b><small>holds it · <RollNum value={h.points} /> pts</small></span>
                                    {hit && <em key={hit.key}>+{hit.points}</em>}
                                </div>
                            ) : (
                                <div className="lb-holder open"><span className="lb-face open" style={{ width: '2.6rem', height: '2.6rem' }}><Sparkles size="1.1rem" /></span><span className="who"><b>Up for grabs</b><small>{openNote}</small></span></div>
                            )}
                            <div className="lb-plinth"><span>{ordinal(r)}</span></div>
                        </div>
                    );
                })}
            </div>
            {extra.length > 0 && (
                <div className="lb-extra">
                    {extra.map((slot) => (
                        <span key={slot.prize.rank}><b>{ordinal(slot.prize.rank)}</b> {slot.prize.label?.trim()}{!sealed && <> · {slot.holder ? nameOf(slot.holder) : 'up for grabs'}</>}</span>
                    ))}
                </div>
            )}
        </div>
    );
}

// RACE: Gym Clash lanes with the prize line drawn under the last prize place.
function RaceScene({ standings, prizes, hits }) {
    const show = standings.slice(0, RACE_LANES);
    const leader = Math.max(1, standings[0]?.points ?? 1);
    const prizeByRank = useMemo(() => new Map(prizes.map((p) => [p.rank, p])), [prizes]);
    const cut = prizes.length ? standings[prizes.length - 1] : null;
    const rest = standings.length - show.length;
    return (
        <>
            <div className="lb-eyebrow"><h2>The race · points earned this event</h2><div className="lb-hint">Arrows show movement since this morning</div></div>
            <div className="lb-lanes">
                {show.map((row, i) => {
                    const prize = prizeByRank.get(row.rank);
                    const hit = hits[row.key];
                    const w = Math.max(2, (row.points / leader) * 100);
                    const d = row.rank_delta ?? 0;
                    const lane = (
                        <motion.div
                            key={row.key}
                            layout
                            transition={{ type: 'spring', stiffness: 260, damping: 32 }}
                            className={`lb-lane${prize ? ' prize' : ''}${hit ? ' hit' : ''}${row.rank === 1 ? ' first' : ''}`}
                        >
                            <div className="lb-rank">{row.rank}</div>
                            <div className={`lb-move${d > 0 ? ' up' : d < 0 ? ' down' : ''}`}>{d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : '—'}</div>
                            <Face row={row} size={2.9} ring={prize ? row.rank : null} />
                            <div className="lb-name">
                                <b>{nameOf(row)}</b>
                                <small>
                                    {prize
                                        ? <span className="lb-chip"><Gift size="0.75rem" />{prize.label?.trim()}</span>
                                        : cut
                                            ? <>{fmt(Math.max(1, cut.points - row.points + 1))} pts off a prize</>
                                            : <>{fmt(Math.max(0, leader - row.points))} behind 1st</>}
                                </small>
                            </div>
                            <div className="lb-bar">
                                {hit && hit.points > 0 && (
                                    <i key={hit.key} className="lb-delta" style={{ left: `${Math.max(0, ((row.points - hit.points) / leader) * 100)}%`, width: `${(hit.points / leader) * 100}%` }} />
                                )}
                                <div className="lb-fillbar" style={{ width: `${w}%` }}><i /></div>
                            </div>
                            <div className="lb-pts"><span className="plus">{hit ? `+${hit.points}` : ''}</span><RollNum value={row.points} /></div>
                        </motion.div>
                    );
                    return prizes.length && i === prizes.length - 1 && i < show.length - 1
                        ? [lane, <motion.div layout key="prize-line" className="lb-line"><span>Prize line</span></motion.div>]
                        : lane;
                })}
            </div>
            {rest > 0 && (
                <div className="lb-more"><span>and <b>{fmt(rest)} more</b> chasing</span><span>Scan the code to join them</span></div>
            )}
        </>
    );
}

// RACE, second beat: the fight at the prize line — the last place that wins
// something against the first one that doesn't.
function FightScene({ standings, prizes, hits }) {
    const line = prizeLine(standings, prizes.length);
    if (!line) return null;
    const { lastIn, firstOut, gap } = line;
    const prize = prizes.find((p) => p.rank === lastIn.rank) ?? prizes[prizes.length - 1];
    const behind = standings.slice(prizes.length + 1, prizes.length + 5);
    return (
        <>
            <div className="lb-eyebrow"><h2>On the prize line · {ordinal(lastIn.rank)} place</h2><div className="lb-hint">One workout can swap these two</div></div>
            <div className="lb-fight">
                <FightSide row={lastIn} cls="left" tag={`Holding ${ordinal(lastIn.rank)}`} hit={hits[lastIn.key]} ring={lastIn.rank} />
                <div className="lb-gapcol">
                    <PrizeArt prize={prize} className="lb-gap-art" />
                    <div className="lb-gap-label">{prize.label?.trim()}</div>
                    <div className="vs">Gap</div>
                    <div className="n"><RollNum value={gap} /><span> pts</span></div>
                    <div className="l">about <b>{sessionsToClose(gap + 1)} workout{sessionsToClose(gap + 1) === 1 ? '' : 's'}</b> to take it</div>
                </div>
                <FightSide row={firstOut} cls="right" tag="First outside the prizes" hit={hits[firstOut.key]} />
                {behind.length > 0 && (
                    <div className="lb-behind">
                        <span className="cap">Also closing in</span>
                        {behind.map((row) => (
                            <span key={row.key} className={`who${hits[row.key] ? ' hit' : ''}`}>
                                <Face row={row} size={2.2} />
                                <span><b>{nameOf(row)}</b><small>{ordinal(row.rank)} · {fmt(Math.max(1, lastIn.points - row.points + 1))} pts off</small></span>
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}

// Top level on purpose (see GymLeague's DuelSide): defined inside the scene it
// would remount on every landing and replay its entrance.
function FightSide({ row, cls, tag, hit, ring }) {
    return (
        <div className={`lb-side ${cls}`}>
            <Face row={row} size={7.5} ring={ring} />
            <div className="lb-side-name"><b>{nameOf(row)}</b><small>{tag}</small></div>
            <div className="lb-big"><RollNum value={row.points} />{hit && <span key={hit.key} className="lb-float">+{hit.points}</span>}</div>
        </div>
    );
}

function ChasingScene({ standings }) {
    const rest = standings.slice(RACE_LANES, RACE_LANES + 24);
    const more = standings.length - RACE_LANES - rest.length;
    return (
        <>
            <div className="lb-eyebrow"><h2>The chasing pack · {ordinal(RACE_LANES + 1)} and down</h2><div className="lb-hint">Every one of them a workout or two from moving up</div></div>
            <div className="lb-pack">
                {rest.map((row) => (
                    <div key={row.key} className="lb-packrow">
                        <span className="r">{row.rank}</span>
                        <Face row={row} size={2.2} />
                        <span className="n">{nameOf(row)}</span>
                        <span className="p">{fmt(row.points)}</span>
                    </div>
                ))}
            </div>
            {more > 0 && <div className="lb-more"><span>and <b>{fmt(more)} more</b></span></div>}
        </>
    );
}

// ─── Before and after the race ───────────────────────────────────

function CountdownScene({ board, prizes, now }) {
    const p = countdownParts(board.starts_at ?? board.window_start_at, now);
    const cells = p.days > 0 ? [[p.days, 'days'], [p.hours, 'hours'], [p.minutes, 'min']] : [[p.hours, 'hours'], [p.minutes, 'min'], [p.seconds, 'sec']];
    return (
        <div className="lb-scene">
            <div className="lb-eyebrow"><h2>The race starts in</h2><div className="lb-hint">{fmtWhen(board.window_start_at)}</div></div>
            <div className="lb-count">
                <div className="lb-digits">
                    {cells.map(([v, label], i) => (
                        <React.Fragment key={label}>
                            {i > 0 && <span className="sep">:</span>}
                            <div className="cell"><b>{String(v).padStart(2, '0')}</b><small>{label}</small></div>
                        </React.Fragment>
                    ))}
                </div>
                {prizes.length > 0 && <Podium slots={prizes.map((prize) => ({ prize, holder: null }))} openNote={`from ${fmtDay(board.window_start_at)}`} />}
            </div>
        </div>
    );
}

function SealedScene({ board, prizes, now }) {
    const reveal = revealTarget(board);
    const p = reveal ? countdownParts(reveal, now) : null;
    const pad = (n) => String(n).padStart(2, '0');
    return (
        <div className="lb-scene">
            <div className="lb-eyebrow"><h2>Scores are sealed</h2><div className="lb-hint">The winners are being verified</div></div>
            <div className="lb-sealed">
                <div className="lb-seal">
                    <span className="arc a" /><span className="arc b" />
                    <span className="disc"><Lock size="2.6rem" strokeWidth={2.2} /></span>
                </div>
                <div className="lb-sealed-copy">
                    <b>{p && p.totalMs > 0 ? 'Revealed live in' : 'Revealed live'}</b>
                    {p && p.totalMs > 0
                        ? <div className="lb-sealclock">{p.days > 0 ? `${p.days}d ${pad(p.hours)}:${pad(p.minutes)}` : `${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}`}</div>
                        : <div className="lb-sealclock soon">any moment now</div>}
                    <small>{reveal ? `${board.venue?.name ? `${board.venue.name} · ` : ''}${fmtWhen(reveal)}` : 'Right here, at the final'}</small>
                </div>
                {prizes.length > 0 && <Podium slots={prizes.map((prize) => ({ prize, holder: null }))} sealed />}
            </div>
        </div>
    );
}

// ─── Staged reveal ───────────────────────────────────────────────
// 3rd → 2nd → 1st, then the full winners board. The admin's Reveal action
// flips the event server-side; this screen picks it up on the next poll and
// runs the sequence. Refreshing the page re-runs it — a feature on the night.

const STAGE_HOLD_MS = 4200;

function Reveal({ board, prizes }) {
    const results = useMemo(() => board.results ?? [], [board.results]);
    const podium = useMemo(() => [3, 2, 1].map((r) => results.find((x) => x.rank === r)).filter(Boolean), [results]);
    const [stage, setStage] = useState(board.settled ? podium.length + 1 : 0);
    const timer = useRef(null);
    useEffect(() => {
        if (stage > podium.length) return undefined;
        timer.current = setTimeout(() => setStage((s) => s + 1), stage === 0 ? 1800 : STAGE_HOLD_MS);
        return () => clearTimeout(timer.current);
    }, [stage, podium.length]);
    const shown = podium.slice(0, Math.max(0, Math.min(stage, podium.length)));
    const done = stage > podium.length;
    const prizeOf = (row) => prizes.find((p) => p.rank === row.rank) ?? (row.prize_label ? { rank: row.rank, label: row.prize_label } : null);

    if (results.length === 0) return <CenterNote big="Results are in" small="Standby…" pulse />;

    if (!done) {
        return (
            <div className="lb-scene lb-reveal">
                <motion.div key="eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="lb-reveal-eyebrow">
                    {stage === 0 ? 'And the winners are…' : 'Your podium'}
                </motion.div>
                <div className="lb-stand">
                    {[2, 1, 3].map((rank) => {
                        const row = shown.find((x) => x.rank === rank);
                        const prize = row ? prizeOf(row) : null;
                        return (
                            <div key={rank} className={`lb-stand-col r${rank}`}>
                                <AnimatePresence>
                                    {row && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 60, scale: 0.8 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            transition={{ type: 'spring', stiffness: 90, damping: 14 }}
                                            className="lb-stand-who"
                                        >
                                            <Face row={row} size={rank === 1 ? 9 : 7} ring={rank} />
                                            <b>{nameOf(row)}</b>
                                            <span className="pts">{fmt(row.points)} pts</span>
                                            {prize && <span className="lb-chip big">{prize.image_url && <img src={storageImage(prize.image_url, 128)} alt="" />}{prize.label?.trim()}</span>}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                                <div className="lb-stand-block"><span>{rank}</span></div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    const podiumRows = [2, 1, 3].map((r) => results.find((x) => x.rank === r)).filter(Boolean);
    const others = results.filter((r) => r.rank > 3).slice(0, 7);
    return (
        <motion.div className="lb-scene lb-final" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}>
            <div className="lb-eyebrow"><h2>Winners · final standings</h2><div className="lb-hint">Congratulations to everyone who moved</div></div>
            <div className={`lb-final-grid${others.length ? '' : ' solo'}`}>
                <div className="lb-stand small">
                    {podiumRows.map((row) => {
                        const prize = prizeOf(row);
                        return (
                            <div key={row.rank} className={`lb-stand-col r${row.rank}`}>
                                <div className="lb-stand-who">
                                    {prize?.image_url && <PrizeArt prize={prize} className="lb-stand-art" />}
                                    <Face row={row} size={row.rank === 1 ? 7 : 5.6} ring={row.rank} />
                                    <b>{nameOf(row)}</b>
                                    <span className="pts">{fmt(row.points)} pts</span>
                                    {prize && <span className="lb-chip"><Gift size="0.75rem" />{prize.label?.trim()}</span>}
                                </div>
                                <div className="lb-stand-block"><span>{row.rank}</span></div>
                            </div>
                        );
                    })}
                </div>
                {others.length > 0 && (
                    <div className="lb-final-list">
                        {others.map((row) => {
                            const prize = prizeOf(row);
                            return (
                                <div key={row.key ?? row.rank} className="lb-packrow">
                                    <span className="r">{row.rank}</span>
                                    <Face row={row} size={2.2} ring={prize ? row.rank : null} />
                                    <span className="n">{nameOf(row)}{prize && <small> · {prize.label?.trim()}</small>}</span>
                                    <span className="p">{fmt(row.points)}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </motion.div>
    );
}

// ─── Rail ────────────────────────────────────────────────────────

function Rail({ board, prizes, mode, scorers }) {
    const state = board.state;
    if (state === 'live') {
        return (
            <>
                {mode === 'race' && prizes.length > 0
                    ? <PrizesCard prizes={prizes} standings={board.standings ?? []} slug={board.slug} />
                    : <RoomCard board={board} scorers={scorers} />}
                <div className="lb-card lb-feedcard">
                    <h3>Landing now <span>{board.room ? `${fmt(board.room.sessions)} workouts counted` : ''}</span></h3>
                    <FeedList feed={board.feed ?? []} />
                </div>
            </>
        );
    }
    return (
        <>
            <RoomCard board={board} scorers={null} />
            {state === 'countdown'
                ? <EnterCard slug={board.slug} />
                : prizes.length > 0 && <PrizesCard prizes={prizes} standings={[]} sealed />}
        </>
    );
}

function RoomCard({ board, scorers }) {
    const tiles = [
        board.entrants != null && ['Entered', fmt(board.entrants)],
        scorers != null && ['On the board', fmt(scorers)],
        board.room && ['Points', fmt(board.room.points)],
        // Never a "0" for prizes on a public screen: the tile waits until there are some.
        scorers == null && board.state !== 'live' && board.prizes?.length > 0 && ['Prizes', fmt(board.prizes.length)],
        // The scoring window's length, counted like the header's dates (Fri – Fri = 8).
        board.state === 'countdown' && ['Days of racing', fmt(Math.ceil((new Date(board.window_end_at) - new Date(board.window_start_at)) / 86_400_000))],
    ].filter(Boolean);
    return (
        <div className="lb-card">
            <h3>The room <span>{board.venue?.name ?? 'POWR'}</span></h3>
            <div className={`lb-tiles n${tiles.length}`}>
                {tiles.map(([label, v]) => <div key={label} className="lb-tile"><b>{v}</b><small>{label}</small></div>)}
            </div>
            {board.state === 'live' && (
                <div className="lb-scan">
                    <div className="qr"><QRCodeSVG value={eventRegisterUrl(board.slug)} size={256} fgColor="#0a0a0a" bgColor="#FFFFFF" style={{ width: '100%', height: '100%' }} /></div>
                    <div><b>Not in yet?</b><small>Scan to enter — workouts from {fmtDay(board.window_start_at)} still count</small></div>
                </div>
            )}
        </div>
    );
}

function EnterCard({ slug }) {
    return (
        <div className="lb-card lb-entercard">
            <h3>Get in early <span>Free</span></h3>
            <div className="lb-scan tall">
                <div className="qr"><QRCodeSVG value={eventRegisterUrl(slug)} size={384} fgColor="#0a0a0a" bgColor="#FFFFFF" style={{ width: '100%', height: '100%' }} /></div>
                <div><b>Scan to enter</b><small>Join in the POWR app and you’re on the start line</small></div>
            </div>
        </div>
    );
}

function PrizesCard({ prizes, standings, slug, sealed }) {
    const slots = prizeSlots(prizes, standings);
    return (
        <div className="lb-card">
            <h3>Prizes <span>{sealed ? 'Winners revealed live' : 'Held right now'}</span></h3>
            <div className="lb-prizes">
                {slots.slice(0, 4).map(({ prize, holder }) => (
                    <div key={prize.rank} className="lb-prow">
                        <PrizeArt prize={prize} className="lb-prow-art" />
                        <div className="t"><small>{ordinal(prize.rank)}</small><b>{prize.label?.trim()}</b></div>
                        {!sealed && <div className="h">{holder ? nameOf(holder) : 'Open'}</div>}
                    </div>
                ))}
            </div>
            {slug && (
                <div className="lb-scan small">
                    <div className="qr"><QRCodeSVG value={eventRegisterUrl(slug)} size={192} fgColor="#0a0a0a" bgColor="#FFFFFF" style={{ width: '100%', height: '100%' }} /></div>
                    <div><b>Scan to enter</b><small>Late? Your workouts still count</small></div>
                </div>
            )}
        </div>
    );
}

function FeedList({ feed }) {
    if (feed.length === 0) return <div className="lb-empty">Quiet right now — the next workout lands here.</div>;
    return (
        <Conveyor
            className="lb-feed"
            items={feed.slice(0, FEED_ROWS + 1)}
            visible={FEED_ROWS}
            pitch={3.65}
            render={(f) => (
                <>
                    <Face row={f} size={2.3} />
                    <div className="t"><b>{nameOf(f)}</b><small><TypeIcon type={f.type} />{typeLabel(f.type)} · {fmtTime(f.at)}</small></div>
                    <div className="p">+{f.points}</div>
                </>
            )}
        />
    );
}

// ─── Parts ───────────────────────────────────────────────────────

const ICONS = { gym: Dumbbell, running: Footprints, walking: PersonStanding, cycling: Bike, swimming: Waves, hiit: Zap, yoga: Flower2, sports: Trophy, dance: Music, invite: UserPlus, challenge: Swords, bonus: Sparkles, streak: Flame };
const EXTRA_LABELS = { invite: 'Invite bonus', challenge: 'Challenge', bonus: 'Bonus', streak: 'Streak', adjustment: 'Adjustment' };
const typeLabel = (type) => EXTRA_LABELS[type] ?? activityMeta(type).label;

function TypeIcon({ type }) {
    const Icon = ICONS[type] ?? Activity;
    return <Icon size="0.75rem" strokeWidth={2.25} aria-hidden="true" />;
}

/** A person: their photo in a circle, else initials. `ring` = a prize place (gold, silver, bronze). */
function Face({ row, size, ring }) {
    const [broken, setBroken] = useState(false);
    const style = { width: `${size}rem`, height: `${size}rem`, fontSize: `${size * 0.36}rem` };
    const cls = `lb-face${ring ? ` ring r${Math.min(ring, 4)}` : ''}`;
    if (row?.avatar_url && !broken) {
        return <span className={cls} style={style}><img src={storageImage(row.avatar_url, 192)} alt="" decoding="async" onError={() => setBroken(true)} /></span>;
    }
    return <span className={cls} style={style}>{initials(nameOf(row)) || '·'}</span>;
}

/** A prize's picture; a prize without one gets its place, large, in the same tile. */
function PrizeArt({ prize, className }) {
    return (
        <div className={`lb-art ${className ?? ''}`}>
            {prize.image_url
                ? <img src={storageImage(prize.image_url, 512)} alt="" decoding="async" />
                : <span>{ordinal(prize.rank)}</span>}
        </div>
    );
}

/** partners.logo_bg is 'white' | 'black' | 'dark' (as the admin and Gym Clash read it). */
function VenueMark({ venue }) {
    const [broken, setBroken] = useState(false);
    if (broken) return null;
    const tile = venue.logo_bg === 'white' ? 'light' : venue.logo_bg === 'black' ? 'black' : 'dark';
    return (
        <span className={`lb-venue ${tile}`} title={venue.name}>
            <img src={storageImage(venue.logo_url, 480)} alt={venue.name} decoding="async" onError={() => setBroken(true)} />
        </span>
    );
}

function RollNum({ value }) {
    const [shown, setShown] = useState(value);
    const fromRef = useRef(value);
    useEffect(() => {
        const from = fromRef.current;
        const to = value;
        if (from === to) return undefined;
        const t0 = performance.now();
        let raf = 0;
        const step = () => {
            const k = Math.min(1, (performance.now() - t0) / 900);
            const e = 1 - Math.pow(1 - k, 3);
            const v = Math.round(from + (to - from) * e);
            fromRef.current = v;
            setShown(v);
            if (k < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [value]);
    return <>{fmt(shown)}</>;
}

// A conveyor list (as on Gym Clash): every row sits in a fixed slot `pitch`
// rem apart and glides down one slot when a new row lands; the new row slides
// in from above and the old last row slides out below the clipped box.
function Conveyor({ items, visible, pitch, className, render }) {
    const mounted = useRef(false);
    useEffect(() => { mounted.current = true; }, []);
    return (
        <ul className={className}>
            {items.slice(0, visible + 1).map((f, i) => (
                <motion.li
                    key={f.key}
                    style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
                    initial={mounted.current ? { y: `${-pitch}rem`, opacity: 0 } : false}
                    animate={{ y: `${i * pitch}rem`, opacity: i < visible ? 1 : 0 }}
                    transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    {render(f)}
                </motion.li>
            ))}
        </ul>
    );
}

// The footer ticker. It never restarts: the track moves at a steady speed,
// items that have left on the left are dropped, and fresh ones — built from
// the payload at that moment — join on the right as room opens up.
const MARQUEE_REM_PER_S = 5;

function Marquee(props) {
    const latest = useRef(props);
    latest.current = props;
    const shownRef = useRef(new Set());
    const idRef = useRef(0);
    const [items, setItems] = useState([]);
    const footRef = useRef(null);
    const trackRef = useRef(null);
    const offRef = useRef(0);
    const dropRef = useRef(0);
    const pendingRef = useRef(false);

    // One pass of the story: workouts not yet shown, then the event itself.
    const nextBatch = useCallback(() => {
        const { board, prizes, mode } = latest.current;
        const out = [];
        const push = (node) => out.push({ id: idRef.current++, node });
        const feed = board.feed ?? [];
        feed.filter((f) => !shownRef.current.has(f.key)).slice(0, 4).forEach((f) => {
            shownRef.current.add(f.key);
            push(<><span className="lb-tk-ico"><TypeIcon type={f.type} /></span><b>{nameOf(f)}</b> earned <em>+{f.points}</em> · {typeLabel(f.type)}</>);
        });
        if (shownRef.current.size > 400) shownRef.current = new Set(feed.map((f) => f.key));
        const standings = board.standings ?? [];
        if (board.state === 'live' && mode === 'race') {
            standings.slice(0, 3).forEach((r) => push(<><b>{ordinal(r.rank)}</b> {nameOf(r)} · {fmt(r.points)} pts</>));
        }
        prizes.slice(0, 4).forEach((p) => push(<><Gift size="0.85rem" /><b>{ordinal(p.rank)}</b> wins <em>{p.label?.trim()}</em></>));
        if (board.state === 'countdown' || board.state === 'live') push(<><QrCode size="0.85rem" />Scan the code on screen to enter · <b>free</b></>);
        const gate = gateLine(board.gate);
        if (gate && board.state !== 'revealed') push(<>{gate}</>);
        if (board.lock_at && board.state !== 'revealed') push(<>Scores seal <b>{fmtWhen(board.lock_at)}</b></>);
        const reveal = revealTarget(board);
        if (reveal && board.state !== 'revealed') push(<>Winners revealed live{board.venue?.name ? <> at <b>{board.venue.name}</b></> : null} · {fmtWhen(reveal)}</>);
        return out;
    }, []);

    useEffect(() => {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        let raf = 0;
        let last = performance.now();
        const tick = (t) => {
            raf = requestAnimationFrame(tick);
            const track = trackRef.current;
            const foot = footRef.current;
            if (!track || !foot) return;
            const dt = Math.min(0.1, (t - last) / 1000);
            last = t;
            const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
            if (!reduce) offRef.current += dt * MARQUEE_REM_PER_S * rem;
            track.style.transform = `translate3d(${-offRef.current}px,0,0)`;
            if (pendingRef.current) return;
            const first = track.firstElementChild;
            if (first && offRef.current > first.offsetWidth) {
                dropRef.current = first.offsetWidth;
                pendingRef.current = true;
                setItems((it) => it.slice(1));
            } else if (track.scrollWidth - offRef.current < foot.clientWidth * 1.6) {
                const batch = nextBatch();
                if (batch.length) { pendingRef.current = true; setItems((it) => [...it, ...batch]); }
            }
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [nextBatch]);

    // Before paint: take the dropped item's width off the offset so nothing jumps.
    useLayoutEffect(() => {
        if (dropRef.current) {
            offRef.current -= dropRef.current;
            dropRef.current = 0;
            if (trackRef.current) trackRef.current.style.transform = `translate3d(${-offRef.current}px,0,0)`;
        }
        pendingRef.current = false;
    }, [items]);

    return (
        <footer className="lb-foot" ref={footRef}>
            <div className="lb-track" ref={trackRef}>
                {items.map((it) => <span key={it.id}>{it.node}</span>)}
            </div>
        </footer>
    );
}

// ─── Chrome ──────────────────────────────────────────────────────

function CenterNote({ big, small, pulse }) {
    return (
        <div className="lb-center">
            <div className={`lb-center-big${pulse ? ' pulse' : ''}`}>{big}</div>
            {small && <div className="lb-center-small">{small}</div>}
        </div>
    );
}

function Shell({ children }) {
    return (
        <div className="lb-shell fixed inset-0 overflow-hidden select-none" style={{ fontFamily: "'Outfit', 'Helvetica Neue', sans-serif" }}>
            <style>{CSS}</style>
            {children}
        </div>
    );
}

const CSS = `
.lb-shell { background: #070707; color: #f2f2f2; --gold: ${GOLD}; --up: ${UP}; --down: #f87171; --silver: #d4d4d8; --bronze: #d97706; --line: rgba(255,255,255,0.10); --ink-2: rgba(242,242,242,0.62); --ink-3: rgba(242,242,242,0.38); --bg-2: #0e0e0e; --bg-3: #151515; }
.lb-shell * { box-sizing: border-box; }
.lb-wall { height: 100vh; display: grid; grid-template-rows: auto 1fr auto; padding: 1.6rem 2.2rem 0; gap: 1.2rem; position: relative; }
.lb-wall::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(60rem 30rem at 15% -10%, rgba(250,204,21,0.09), transparent 60%); animation: lbDrift 24s ease-in-out infinite; }
@keyframes lbDrift { 0%,100% { transform: translate(0,0) } 50% { transform: translate(3vw,2vh) } }
.lb-head { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 2rem; z-index: 1; }
.lb-brand { display: flex; align-items: center; gap: 0.9rem; min-width: 0; }
.lb-powr { height: 2.7rem; width: auto; display: block; flex: none; }
.lb-title { font-weight: 300; font-size: 1.6rem; letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 0.9rem; border-left: 1px solid var(--line); }
.lb-venue { width: 5rem; height: 2.4rem; padding: 0.3rem 0.45rem; border-radius: 0.55rem; border: 1px solid var(--line); background: #141414; flex: none; display: block; }
.lb-venue.light { background: #fff; } .lb-venue.black { background: #000; }
.lb-venue img { width: 100%; height: 100%; object-fit: contain; display: block; }
.lb-scope { display: flex; flex-direction: column; align-items: center; gap: 0.45rem; }
.lb-lens { display: flex; gap: 0.3rem; padding: 0.25rem; border: 1px solid var(--line); border-radius: 999px; }
.lb-lens span { padding: 0.35rem 1rem; border-radius: 999px; font-size: 0.8rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-3); transition: color .4s, background .4s; white-space: nowrap; }
.lb-lens span.on { background: var(--gold); color: #0d0d0d; font-weight: 600; }
.lb-sub { font-size: 0.85rem; color: var(--ink-2); } .lb-sub b { color: #f2f2f2; font-weight: 600; }
.lb-status { display: flex; align-items: center; justify-content: flex-end; gap: 1.4rem; font-size: 0.85rem; color: var(--ink-2); }
.lb-clock b { color: #f2f2f2; font-weight: 600; font-variant-numeric: tabular-nums; }
.lb-live { display: flex; align-items: center; gap: 0.5rem; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600; color: #f2f2f2; }
.lb-live i { width: 0.55rem; height: 0.55rem; border-radius: 50%; background: var(--up); animation: lbPulse 1.6s ease-in-out infinite; }
.lb-live.lb-stale { color: var(--ink-3); } .lb-live.lb-stale i { background: #f59e0b; }
.lb-live.lb-sealpill i { background: var(--gold); }
@keyframes lbPulse { 0%,100% { opacity: 1; transform: scale(1) } 50% { opacity: 0.35; transform: scale(0.8) } }
.lb-main { display: grid; grid-template-columns: 1fr 27rem; gap: 1.6rem; min-height: 0; z-index: 1; }
.lb-wall.full .lb-main { grid-template-columns: 1fr; }
.lb-stage { position: relative; min-width: 0; min-height: 0; }
.lb-scene { position: absolute; inset: 0; display: flex; flex-direction: column; min-width: 0; }
.lb-eyebrow { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 0.7rem; }
.lb-eyebrow h2 { margin: 0; font-size: 0.8rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink-3); font-weight: 500; }
.lb-hint { font-size: 0.8rem; color: var(--ink-3); white-space: nowrap; }

/* faces */
.lb-face { flex: none; border-radius: 50%; display: inline-grid; place-items: center; overflow: hidden; background: var(--bg-3); border: 1px solid var(--line); color: var(--ink-2); font-weight: 700; letter-spacing: 0.02em; }
.lb-face img { width: 100%; height: 100%; object-fit: cover; display: block; }
.lb-face.ring { box-shadow: 0 0 0 0.16rem #070707, 0 0 0 0.3rem var(--ink-3); }
.lb-face.ring.r1 { box-shadow: 0 0 0 0.16rem #070707, 0 0 0 0.3rem var(--gold), 0 0 1.2rem rgba(250,204,21,0.35); }
.lb-face.ring.r2 { box-shadow: 0 0 0 0.16rem #070707, 0 0 0 0.3rem var(--silver); }
.lb-face.ring.r3 { box-shadow: 0 0 0 0.16rem #070707, 0 0 0 0.3rem var(--bronze); }
.lb-face.open { border: 1px dashed rgba(250,204,21,0.6); background: rgba(250,204,21,0.06); color: var(--gold); }
.lb-face.ghost { border: 1px dashed var(--line); color: var(--ink-3); font-size: 1.1rem; }

/* prize art: a 4:5 frame (the shape prize cards are made in), the whole picture always shown */
.lb-art { border-radius: 1rem; overflow: hidden; background: #0b0b0b; border: 1px solid rgba(250,204,21,0.3); display: grid; place-items: center; position: relative; }
.lb-art img { width: 100%; height: 100%; object-fit: contain; display: block; }
.lb-art span { color: var(--gold); font-weight: 200; font-size: 3rem; letter-spacing: -0.02em; }

/* warm-up + countdown podium */
.lb-warm { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: center; gap: 2.4rem; }
.lb-warm-hero { text-align: center; font-size: 4.2rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1.05; }
.lb-warm-hero span { color: var(--gold); font-weight: 300; }
.lb-podium-wrap { display: flex; flex-direction: column; align-items: center; gap: 1rem; }
.lb-podium { display: grid; gap: 1.6rem; align-items: end; justify-content: center; }
.lb-podium.n3 { grid-template-columns: 18rem 22rem 18rem; } .lb-podium.n2 { grid-template-columns: repeat(2, 20rem); } .lb-podium.n1 { grid-template-columns: 22rem; }
.lb-col { display: flex; flex-direction: column; align-items: stretch; gap: 0.75rem; }
.lb-col-art { width: 100%; aspect-ratio: 4 / 5; }
.lb-col.r1 .lb-col-art { border-color: rgba(250,204,21,0.6); box-shadow: 0 0 3rem rgba(250,204,21,0.12); }
.lb-col.r1 .lb-col-art::after { content: ''; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.18), transparent 70%); animation: lbSweep 6s ease-in-out infinite; }
.lb-col-label { font-size: 1.15rem; font-weight: 600; letter-spacing: 0.02em; text-align: center; line-height: 1.25; min-height: 2.9rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.lb-holder { display: flex; align-items: center; gap: 0.7rem; padding: 0.55rem 0.8rem; border-radius: 0.8rem; background: rgba(255,255,255,0.04); border: 1px solid var(--line); position: relative; min-width: 0; transition: background .4s, border-color .4s; }
.lb-holder .who { display: flex; flex-direction: column; min-width: 0; }
.lb-holder .who b { font-weight: 600; font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb-holder .who small { font-size: 0.72rem; color: var(--ink-3); letter-spacing: 0.04em; font-variant-numeric: tabular-nums; }
.lb-holder em { position: absolute; right: 0.8rem; top: 50%; font-style: normal; font-weight: 700; color: var(--up); animation: lbFloatY 1.8s ease-out forwards; }
.lb-holder.hit { background: rgba(74,222,128,0.08); border-color: rgba(74,222,128,0.4); }
.lb-holder.open { border-style: dashed; border-color: rgba(250,204,21,0.35); background: rgba(250,204,21,0.03); }
.lb-holder.open .who b { color: var(--gold); }
.lb-holder.ghost { border-style: dashed; color: var(--ink-3); justify-content: center; font-size: 0.8rem; letter-spacing: 0.2em; text-transform: uppercase; }
.lb-plinth { height: 2rem; border-radius: 0.6rem 0.6rem 0 0; border-top: 2px solid var(--gold); background: linear-gradient(180deg, rgba(250,204,21,0.18), transparent); display: grid; place-items: center; position: relative; overflow: hidden; }
.lb-col.r1 .lb-plinth { height: 3.2rem; } .lb-col.r2 .lb-plinth { height: 2.4rem; border-color: var(--silver); background: linear-gradient(180deg, rgba(212,212,216,0.14), transparent); } .lb-col.r3 .lb-plinth { border-color: var(--bronze); background: linear-gradient(180deg, rgba(217,119,6,0.16), transparent); }
.lb-plinth span { font-size: 0.85rem; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ink-2); }
.lb-col.r1 .lb-plinth span { color: var(--gold); font-size: 1rem; }
.lb-count .lb-podium.n3, .lb-sealed .lb-podium.n3 { grid-template-columns: 14rem 17rem 14rem; }
.lb-count .lb-podium.n2, .lb-sealed .lb-podium.n2 { grid-template-columns: repeat(2, 16rem); } .lb-count .lb-podium.n1, .lb-sealed .lb-podium.n1 { grid-template-columns: 17rem; }
.lb-count .lb-col-label, .lb-sealed .lb-col-label { font-size: 1rem; min-height: 2.5rem; }
.lb-extra { display: flex; gap: 2rem; font-size: 0.85rem; color: var(--ink-2); } .lb-extra b { color: var(--gold); font-weight: 600; margin-right: 0.3rem; }
.lb-fill { display: flex; align-items: center; justify-content: center; gap: 1.8rem; }
.lb-fill-slots { display: flex; gap: 0.7rem; }
.lb-slot { width: 3.6rem; height: 3.6rem; border-radius: 50%; border: 1px dashed rgba(242,242,242,0.25); display: grid; place-items: center; color: var(--ink-3); font-size: 0.9rem; font-weight: 600; }
.lb-slot.on { border: none; }
.lb-slot.hit .lb-face { box-shadow: 0 0 0 0.2rem var(--up); }
.lb-fill-copy { display: flex; flex-direction: column; gap: 0.2rem; font-size: 1.3rem; color: var(--ink-2); }
.lb-fill-copy b { color: #f2f2f2; font-weight: 700; font-variant-numeric: tabular-nums; }
.lb-fill-copy small { font-size: 0.85rem; color: var(--ink-3); max-width: 30rem; }

/* how to get in */
.lb-enter { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 22rem; gap: 3rem; align-items: center; padding: 0 1rem; }
.lb-steps { display: flex; flex-direction: column; gap: 2.2rem; }
.lb-step { display: grid; grid-template-columns: 4.4rem 1fr; gap: 1.4rem; align-items: center; }
.lb-step i { width: 4.4rem; height: 4.4rem; border-radius: 50%; display: grid; place-items: center; border: 1px solid rgba(250,204,21,0.55); background: rgba(250,204,21,0.08); color: var(--gold); box-shadow: 0 0 1.2rem rgba(250,204,21,0.12); }
.lb-step b { display: block; font-size: 2.3rem; font-weight: 600; letter-spacing: -0.01em; line-height: 1.15; }
.lb-step small { display: block; font-size: 1.15rem; color: var(--ink-2); margin-top: 0.3rem; }
.lb-bigqr { display: flex; flex-direction: column; align-items: center; gap: 0.6rem; }
.lb-bigqr .qr { width: 19rem; height: 19rem; background: #fff; border-radius: 1.2rem; padding: 1rem; box-shadow: 0 0 0 0.35rem rgba(250,204,21,0.5), 0 0 4rem rgba(250,204,21,0.18); }
.lb-bigqr b { font-size: 1.4rem; font-weight: 700; margin-top: 0.6rem; } .lb-bigqr small { color: var(--ink-3); font-size: 0.9rem; letter-spacing: 0.06em; }

/* race lanes */
.lb-lanes { display: flex; flex-direction: column; gap: 0.45rem; flex: 1; min-height: 0; }
.lb-lane { flex: 1 1 0; max-height: 5.4rem; min-height: 3.4rem; display: grid; grid-template-columns: 2.4rem 2.3rem 2.9rem 19rem 1fr 6.4rem; align-items: center; gap: 0.9rem; padding: 0.55rem 0.9rem; border: 1px solid transparent; border-radius: 0.7rem; position: relative; transition: border-color .4s, background .4s; }
.lb-lane.prize { background: linear-gradient(90deg, rgba(250,204,21,0.06), transparent 55%); }
.lb-lane.first { border-color: rgba(250,204,21,0.45); background: linear-gradient(90deg, rgba(250,204,21,0.1), transparent 60%); }
.lb-lane.hit { background: rgba(255,255,255,0.05); }
.lb-rank { font-size: 1.6rem; font-weight: 700; color: var(--ink-2); font-variant-numeric: tabular-nums; text-align: right; }
.lb-lane.prize .lb-rank { color: var(--gold); }
.lb-move { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.lb-move.up { color: var(--up); } .lb-move.down { color: var(--down); }
.lb-name { min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
.lb-name b { font-weight: 600; font-size: 1.15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb-name small { font-size: 0.72rem; color: var(--ink-3); letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb-chip { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.08rem 0.55rem; border-radius: 999px; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gold); border: 1px solid rgba(250,204,21,0.45); max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.lb-chip.big { font-size: 0.9rem; padding: 0.3rem 0.9rem 0.3rem 0.35rem; gap: 0.6rem; }
.lb-chip.big img { width: 2.2rem; height: 2.2rem; border-radius: 50%; object-fit: cover; }
.lb-bar { height: 0.9rem; border-radius: 999px; background: rgba(255,255,255,0.05); position: relative; overflow: hidden; }
.lb-fillbar { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; min-width: 0.9rem; background: linear-gradient(90deg, rgba(242,242,242,0.12), rgba(242,242,242,0.32) 55%, rgba(242,242,242,0.6)); transition: width 1.2s cubic-bezier(.2,.8,.2,1), filter .3s; }
.lb-lane.prize .lb-fillbar { background: linear-gradient(90deg, rgba(250,204,21,0.22), rgba(250,204,21,0.5) 55%, rgba(253,230,138,0.85)); }
.lb-lane.first .lb-fillbar { background: linear-gradient(90deg, #ca8a04, var(--gold) 65%, #fde68a); }
.lb-lane.hit .lb-fillbar { filter: brightness(1.25); }
.lb-lane.hit .lb-fillbar::before { content: ''; position: absolute; inset: 0; width: 30%; background: linear-gradient(90deg, transparent, rgba(74,222,128,0.55), transparent); animation: lbSweep 1.1s ease-out 1; }
.lb-lane.first .lb-fillbar::after { content: ''; position: absolute; inset: 0; width: 40%; background: linear-gradient(100deg, transparent, rgba(255,255,255,0.35), transparent); animation: lbSweep 6s ease-in-out infinite; }
@keyframes lbSweep { 0% { transform: translateX(-120%) } 40% { transform: translateX(260%) } 100% { transform: translateX(260%) } }
.lb-fillbar i { position: absolute; right: -0.2rem; top: 50%; width: 0.9rem; height: 0.9rem; margin-top: -0.45rem; border-radius: 50%; background: #fff; opacity: 0; transform: scale(0.3); }
.lb-lane.hit .lb-fillbar i { animation: lbSpark .9s ease-out forwards; }
@keyframes lbSpark { 0% { opacity: 1; transform: scale(0.4) } 100% { opacity: 0; transform: scale(3.2) } }
.lb-delta { position: absolute; top: 0; bottom: 0; border-radius: 999px; background: var(--up); min-width: 0.6rem; animation: lbDelta 2.4s ease-out forwards; }
@keyframes lbDelta { 0% { opacity: 1 } 55% { opacity: 1 } 100% { opacity: 0 } }
.lb-pts { text-align: right; font-weight: 700; font-size: 1.45rem; font-variant-numeric: tabular-nums; }
.lb-pts .plus { display: block; font-size: 0.7rem; font-weight: 600; color: var(--up); letter-spacing: 0.06em; height: 0.9rem; }
.lb-line { flex: none; position: relative; height: 0.9rem; display: flex; align-items: center; margin: 0.1rem 0; }
.lb-line::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; border-top: 1px dashed rgba(250,204,21,0.55); }
.lb-line span { position: relative; margin-left: 5.6rem; padding: 0 0.7rem; background: #070707; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.28em; text-transform: uppercase; color: var(--gold); }
.lb-more { margin-top: 0.4rem; padding: 0.6rem 0.9rem; font-size: 0.85rem; color: var(--ink-3); border-top: 1px solid var(--line); display: flex; justify-content: space-between; }
.lb-more b { color: var(--ink-2); font-weight: 500; }

/* prize line fight */
.lb-fight { flex: 1; display: grid; grid-template-columns: 1fr 16rem 1fr; grid-template-rows: auto auto; gap: 1.6rem 2rem; align-content: center; align-items: center; padding: 0 1.5rem; min-height: 0; }
.lb-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; align-items: flex-start; }
.lb-side.left { grid-column: 1; grid-row: 1; } .lb-side.right { grid-column: 3; grid-row: 1; align-items: flex-end; text-align: right; }
.lb-side-name b { display: block; font-size: 2rem; font-weight: 600; line-height: 1.1; }
.lb-side-name small { font-size: 0.85rem; color: var(--ink-3); letter-spacing: 0.14em; text-transform: uppercase; }
.lb-side.left .lb-side-name small { color: var(--gold); }
.lb-big { font-size: 6.4rem; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; position: relative; }
.lb-side.left .lb-big { color: var(--gold); }
.lb-float { position: absolute; top: -0.2em; font-size: 0.32em; font-weight: 700; color: var(--up); letter-spacing: 0.02em; animation: lbFloat 1.8s ease-out forwards; pointer-events: none; }
.lb-side.left .lb-float { left: 0; } .lb-side.right .lb-float { right: 0; }
@keyframes lbFloat { 0% { opacity: 0; transform: translateY(0.6em) } 15% { opacity: 1 } 100% { opacity: 0; transform: translateY(-1.4em) } }
@keyframes lbFloatY { 0% { opacity: 0; transform: translateY(-20%) } 15% { opacity: 1 } 100% { opacity: 0; transform: translateY(-180%) } }
.lb-gapcol { grid-column: 2; grid-row: 1; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.45rem; }
.lb-gap-art { width: 10rem; height: 12.5rem; border-color: rgba(250,204,21,0.6); }
.lb-gap-label { font-size: 0.95rem; font-weight: 600; letter-spacing: 0.04em; max-width: 15rem; }
.lb-gapcol .vs { font-size: 0.75rem; letter-spacing: 0.3em; color: var(--ink-3); text-transform: uppercase; margin-top: 0.6rem; }
.lb-gapcol .n { font-size: 2.8rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
.lb-gapcol .n span { font-size: 0.4em; color: var(--ink-3); font-weight: 600; }
.lb-gapcol .l { font-size: 0.85rem; color: var(--ink-3); } .lb-gapcol .l b { color: #f2f2f2; font-weight: 600; }
.lb-behind { grid-column: 1 / -1; grid-row: 2; display: flex; align-items: center; gap: 1.2rem; margin-top: 1.6rem; padding-top: 1.2rem; border-top: 1px solid var(--line); }
.lb-behind .cap { font-size: 0.72rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-3); white-space: nowrap; margin-right: 0.4rem; }
.lb-behind .who { flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.7rem; padding: 0.55rem 0.8rem; border-radius: 0.8rem; background: rgba(255,255,255,0.03); transition: background .4s; }
.lb-behind .who.hit { background: rgba(74,222,128,0.1); }
.lb-behind .who > span:last-child { display: flex; flex-direction: column; min-width: 0; }
.lb-behind b { font-size: 0.95rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb-behind small { font-size: 0.72rem; color: var(--ink-3); font-variant-numeric: tabular-nums; }

/* chasing pack */
.lb-pack { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 3.4rem; gap: 0.5rem 1rem; align-content: start; }
.lb-packrow { display: grid; grid-template-columns: 2.2rem 2.2rem 1fr auto; gap: 0.8rem; align-items: center; padding: 0 0.9rem; border-radius: 0.7rem; background: rgba(255,255,255,0.03); }
.lb-packrow .r { text-align: right; font-weight: 700; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.lb-packrow .n { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb-packrow .p { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ink-2); }

/* countdown */
.lb-count { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 2.6rem; }
.lb-digits { display: flex; align-items: flex-start; gap: 1.4rem; }
.lb-digits .cell { display: flex; flex-direction: column; align-items: center; min-width: 11rem; }
.lb-digits b { font-size: 8rem; line-height: 0.95; font-weight: 200; color: var(--gold); font-variant-numeric: tabular-nums; letter-spacing: -0.04em; }
.lb-digits small { font-size: 0.85rem; letter-spacing: 0.4em; text-transform: uppercase; color: var(--ink-3); margin-top: 0.6rem; }
.lb-digits .sep { font-size: 6rem; font-weight: 200; color: rgba(250,204,21,0.35); line-height: 1.1; }

/* sealed */
.lb-sealed { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.3rem; }
.lb-seal { position: relative; width: 7rem; height: 7rem; display: grid; place-items: center; }
.lb-seal .disc { width: 4.6rem; height: 4.6rem; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fde68a, var(--gold) 55%, #ca8a04); color: #0d0d0d; display: grid; place-items: center; box-shadow: 0 0 3rem rgba(250,204,21,0.35); }
.lb-seal .arc { position: absolute; inset: 0; border-radius: 50%; border: 2px solid transparent; }
.lb-seal .arc.a { border-top-color: var(--gold); border-right-color: rgba(250,204,21,0.35); animation: lbSpin 6s linear infinite; }
.lb-seal .arc.b { inset: 0.7rem; border-bottom-color: rgba(250,204,21,0.7); border-left-color: rgba(250,204,21,0.2); animation: lbSpin 4s linear infinite reverse; }
@keyframes lbSpin { to { transform: rotate(360deg) } }
.lb-sealed-copy { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; }
.lb-sealed-copy b { font-size: 0.85rem; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ink-3); font-weight: 500; }
.lb-sealclock { font-size: 4.2rem; font-weight: 200; color: var(--gold); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; line-height: 1; }
.lb-sealclock.soon { font-size: 3rem; font-weight: 300; animation: lbPulse 2.4s ease-in-out infinite; }
.lb-sealed-copy small { font-size: 0.95rem; color: var(--ink-2); }

/* reveal */
.lb-reveal { align-items: center; justify-content: center; gap: 2.4rem; }
.lb-reveal-eyebrow { font-size: 1.4rem; letter-spacing: 0.45em; text-transform: uppercase; color: var(--ink-3); font-weight: 500; }
.lb-stand { display: flex; align-items: flex-end; gap: 2.4rem; height: 72%; }
.lb-stand-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 1.2rem; width: 24rem; height: 100%; }
.lb-stand-who { display: flex; flex-direction: column; align-items: center; gap: 0.7rem; text-align: center; }
.lb-stand-who b { font-size: 2.2rem; font-weight: 600; line-height: 1.1; }
.lb-stand-col.r1 .lb-stand-who b { font-size: 3rem; }
.lb-stand-who .pts { font-size: 1.6rem; font-weight: 700; color: var(--gold); font-variant-numeric: tabular-nums; }
.lb-stand-block { width: 100%; border-radius: 1rem 1rem 0 0; border-top: 3px solid var(--gold); background: linear-gradient(180deg, rgba(250,204,21,0.2), transparent); display: grid; place-items: start center; padding-top: 0.8rem; position: relative; overflow: hidden; }
.lb-stand-block span { font-size: 2.4rem; font-weight: 200; color: var(--gold); }
.lb-stand-col.r1 .lb-stand-block { height: 9rem; } .lb-stand-col.r2 .lb-stand-block { height: 6.4rem; border-color: var(--silver); background: linear-gradient(180deg, rgba(212,212,216,0.16), transparent); } .lb-stand-col.r3 .lb-stand-block { height: 4.6rem; border-color: var(--bronze); background: linear-gradient(180deg, rgba(217,119,6,0.18), transparent); }
.lb-stand-col.r2 .lb-stand-block span { color: var(--silver); } .lb-stand-col.r3 .lb-stand-block span { color: var(--bronze); }
.lb-stand-col.r1 .lb-stand-block::after { content: ''; position: absolute; inset: 0; width: 40%; background: linear-gradient(100deg, transparent, rgba(255,255,255,0.25), transparent); animation: lbSweep 5s ease-in-out infinite; }
.lb-final-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 30rem; gap: 3rem; align-items: end; padding-bottom: 0.5rem; }
.lb-final-grid.solo { grid-template-columns: 1fr; justify-items: center; }
.lb-stand.small { height: 100%; gap: 1.6rem; justify-content: center; }
.lb-stand.small .lb-stand-col { width: 20rem; }
.lb-stand.small .lb-stand-who b { font-size: 1.8rem; } .lb-stand.small .lb-stand-col.r1 .lb-stand-who b { font-size: 2.3rem; }
.lb-stand.small .lb-stand-who .pts { font-size: 1.2rem; }
.lb-stand-art { width: 8rem; height: 10rem; margin-bottom: 0.6rem; } .lb-stand-col.r1 .lb-stand-art { width: 10rem; height: 12.5rem; }
.lb-stand.small .lb-stand-col.r1 .lb-stand-block { height: 7rem; } .lb-stand.small .lb-stand-col.r2 .lb-stand-block { height: 5rem; } .lb-stand.small .lb-stand-col.r3 .lb-stand-block { height: 4.4rem; }
.lb-final-list { display: flex; flex-direction: column; gap: 0.5rem; align-self: center; }
.lb-final-list .lb-packrow { height: 3.6rem; }
.lb-final-list .lb-packrow .n small { color: var(--gold); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.06em; }

/* rail */
.lb-rail { display: flex; flex-direction: column; gap: 1rem; min-height: 0; }
.lb-card { background: var(--bg-2); border: 1px solid var(--line); border-radius: 1rem; padding: 1rem 1.1rem; min-height: 0; display: flex; flex-direction: column; }
.lb-card h3 { margin: 0 0 0.7rem; font-size: 0.75rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink-3); font-weight: 500; display: flex; justify-content: space-between; gap: 1rem; }
.lb-card h3 span { letter-spacing: 0.04em; text-transform: none; color: var(--ink-2); text-align: right; }
.lb-feedcard { flex: 1; }
.lb-tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; }
.lb-tiles.n1 { grid-template-columns: 1fr; } .lb-tiles.n3 { grid-template-columns: repeat(3, 1fr); }
.lb-tile { background: rgba(255,255,255,0.03); border-radius: 0.7rem; padding: 0.7rem 0.8rem; }
.lb-tile b { display: block; font-size: 2rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
.lb-tile small { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-3); }
.lb-scan { display: grid; grid-template-columns: 6.4rem 1fr; gap: 1rem; align-items: center; margin-top: 0.9rem; padding-top: 0.9rem; border-top: 1px solid var(--line); }
.lb-scan .qr { background: #fff; border-radius: 0.6rem; padding: 0.4rem; width: 6.4rem; height: 6.4rem; }
.lb-scan b { display: block; font-size: 1.05rem; font-weight: 600; } .lb-scan small { display: block; font-size: 0.78rem; color: var(--ink-3); margin-top: 0.2rem; line-height: 1.35; }
.lb-scan.tall { grid-template-columns: 1fr; justify-items: center; text-align: center; margin-top: 0; padding-top: 0.2rem; border-top: none; }
.lb-scan.tall .qr { width: 15rem; height: 15rem; padding: 0.8rem; box-shadow: 0 0 0 0.3rem rgba(250,204,21,0.45); }
.lb-scan.tall b { font-size: 1.3rem; margin-top: 0.4rem; }
.lb-scan.small { grid-template-columns: 4.6rem 1fr; } .lb-scan.small .qr { width: 4.6rem; height: 4.6rem; padding: 0.3rem; }
.lb-entercard { flex: 1; justify-content: center; }
.lb-prizes { display: flex; flex-direction: column; gap: 0.55rem; }
.lb-prow { display: grid; grid-template-columns: 2.8rem 1fr auto; gap: 0.8rem; align-items: center; }
.lb-prow-art { width: 2.8rem; height: 3.5rem; border-radius: 0.5rem; } .lb-prow-art span { font-size: 0.9rem; font-weight: 600; }
.lb-prow .t { min-width: 0; } .lb-prow .t small { display: block; font-size: 0.65rem; letter-spacing: 0.24em; text-transform: uppercase; color: var(--gold); font-weight: 700; }
.lb-prow .t b { display: block; font-size: 0.92rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb-prow .h { font-size: 0.8rem; color: var(--ink-2); max-width: 8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb-feed { position: relative; list-style: none; margin: 0; padding: 0; overflow: hidden; flex: 1; min-height: 0; }
.lb-feed li { display: grid; grid-template-columns: 2.3rem 1fr auto; gap: 0.8rem; align-items: center; height: 3.2rem; padding: 0 0.7rem; border-radius: 0.6rem; background: rgba(255,255,255,0.03); }
.lb-feed .t { min-width: 0; } .lb-feed .t b { display: block; font-weight: 600; font-size: 0.92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb-feed .t small { display: flex; align-items: center; gap: 0.35rem; font-size: 0.72rem; color: var(--ink-3); white-space: nowrap; }
.lb-feed .t small svg { color: var(--gold); }
.lb-feed .p { font-weight: 700; font-size: 1rem; color: var(--up); font-variant-numeric: tabular-nums; white-space: nowrap; }
.lb-empty { color: var(--ink-3); font-size: 0.85rem; padding: 1rem 0; }

/* ticker */
.lb-foot { border-top: 1px solid var(--line); margin: 0 -2.2rem; padding: 1.1rem 0 1.1rem; overflow: hidden; z-index: 1; }
.lb-track { display: flex; white-space: nowrap; width: max-content; will-change: transform; }
.lb-track > span { font-size: 0.85rem; color: var(--ink-2); padding-right: 3rem; flex: none; display: inline-flex; align-items: center; gap: 0.4em; }
.lb-track > span svg { color: var(--gold); }
.lb-tk-ico { display: inline-grid; place-items: center; width: 1.45rem; height: 1.45rem; border-radius: 50%; border: 1px solid rgba(250,204,21,0.55); background: rgba(250,204,21,0.1); color: var(--gold); }
.lb-track span b { color: #f2f2f2; font-weight: 600; }
.lb-track span em { font-style: normal; color: var(--gold); font-weight: 600; }

.lb-badge { pointer-events: none; position: absolute; top: 0.6rem; right: 2.2rem; border-radius: 999px; border: 1px solid rgba(251,191,36,0.5); background: rgba(251,191,36,0.1); padding: 0.25rem 0.9rem; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.3em; color: #fcd34d; z-index: 20; }
.lb-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.8rem; text-align: center; padding: 2rem; }
.lb-center-big { font-size: 2.4rem; font-weight: 700; letter-spacing: -0.01em; }
.lb-center-big.pulse { animation: lbPulse 1.8s ease-in-out infinite; color: var(--gold); }
.lb-center-small { font-size: 0.95rem; color: var(--ink-2); max-width: 30rem; }
@media (prefers-reduced-motion: reduce) {
  .lb-wall::before, .lb-live i, .lb-lane.first .lb-fillbar::after, .lb-lane.hit .lb-fillbar::before, .lb-col.r1 .lb-col-art::after, .lb-seal .arc, .lb-stand-col.r1 .lb-stand-block::after, .lb-sealclock.soon { animation: none; }
  .lb-delta { animation: none; opacity: 0.8; }
}
`;
