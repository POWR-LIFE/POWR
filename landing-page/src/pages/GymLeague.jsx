import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import geo from '../data/geoEurope.json';
import { activityMeta, boardName, countdownParts, resetLabel, rootFontSize, weekLabel } from '../../../shared/gymBoard.ts';
import {
    boundsOf,
    clusterNodes,
    countryCode,
    haversineKm,
    leagueScenePlan,
    localGyms,
    momentum,
    monogram,
    nodeLabel,
    ordinal,
    placeLabel,
    projector,
    rankByEffort,
    rankGyms,
    rawPerAthlete,
    ranksAtDayStart,
    rivalOf,
    sampleLeague,
    sessionsLastHour,
    sessionsToClose,
    shareOf,
} from '../../../shared/gymLeague.ts';

/**
 * Gym League — powr.life/league/<slug>?k=<display_token>.
 *
 * The gym's second screen: its gym racing every other POWR gym on points
 * earned this week. Same credential as the wall (GymBoard.jsx), the host
 * gym's point of view throughout. Three scenes rotate — LOCAL (gyms within
 * the board's radius), GLOBAL (every gym), EFFORT (points per athlete, the
 * table a small gym can win), then HEAD-TO-HEAD against the gym directly
 * above — with a network map and a live feed on the rail.
 *
 * It moves on real data: every poll is diffed against the last, and each
 * session that landed since flashes its lane, rolls its number, ripples on
 * the map and slides into the feed. ?preview=sample runs a simulated feed
 * on real gym names so an admin can see the motion without waiting.
 */

const GOLD = '#facc15';
const UP = '#4ade80';
const POLL_MS = 15_000;
const STALE_MS = 60_000;
const HIT_MS = 2_400;
const FN_BASE = `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/gym-league`;
const SCENES = ['local', 'global', 'effort', 'duel'];
const DAY_L = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const fmt = (n) => Math.round(n).toLocaleString('en-GB');

// ─── Page ────────────────────────────────────────────────────────

export default function GymLeague() {
    const { slug } = useParams();
    const [params] = useSearchParams();
    const token = params.get('k') ?? '';
    const preview = params.get('preview') === 'sample' ? 'sample' : null;
    const sceneParam = params.get('scene');
    const pinned = SCENES.includes(sceneParam) ? sceneParam : null;

    const [league, setLeague] = useState(null);
    const [invalid, setInvalid] = useState(false);
    const [lastOkAt, setLastOkAt] = useState(0);
    const [now, setNow] = useState(Date.now());
    // Sessions that landed since the previous payload: { [gymKey]: { points, at, key } }
    const [hits, setHits] = useState({});
    const seenRef = useRef(null);
    const ripplesRef = useRef([]);

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
    const absorb = useCallback((data) => {
        const seen = seenRef.current;
        const feed = data.feed ?? [];
        if (seen) {
            const landed = feed.filter((f) => !seen.has(f.key));
            if (landed.length) {
                const at = Date.now();
                setHits((h) => {
                    const next = { ...h };
                    for (const f of landed) next[f.gym_key] = { points: (next[f.gym_key]?.at > at - HIT_MS ? next[f.gym_key].points : 0) + f.points, at, key: f.key };
                    return next;
                });
                for (const f of landed) ripplesRef.current.push({ gymKey: f.gym_key, t: performance.now() });
                setTimeout(() => setHits((h) => Object.fromEntries(Object.entries(h).filter(([, v]) => v.at > Date.now() - HIT_MS))), HIT_MS + 50);
            }
        }
        seenRef.current = new Set(feed.map((f) => f.key));
        setLeague(data);
    }, []);

    // Real data: poll, keep the last good payload through wifi blips.
    useEffect(() => {
        if (preview) return undefined;
        let alive = true;
        const tick = async () => {
            try {
                const res = await fetch(`${FN_BASE}?slug=${encodeURIComponent(slug)}&k=${encodeURIComponent(token)}`);
                if (!alive) return;
                if (res.status === 404 || res.status === 400) { setInvalid(true); setLeague(null); setLastOkAt(0); return; }
                if (!res.ok) return;
                const data = await res.json();
                absorb(data);
                setInvalid(false);
                setLastOkAt(Date.now());
            } catch {
                // transient — retry next tick
            }
        };
        tick();
        const id = setInterval(tick, POLL_MS);
        return () => { alive = false; clearInterval(id); };
    }, [slug, token, preview, absorb]);

    // Sample: a believable league that keeps scoring while you watch.
    useEffect(() => {
        if (!preview) return undefined;
        let data = sampleLeague(Date.now());
        absorb(data);
        setLastOkAt(Date.now());
        let n = 0;
        let timer;
        const types = ['gym', 'hiit', 'yoga', 'swimming', 'cycling', 'sports', 'running'];
        const names = ['Georgie', 'Suzi', 'Kris', 'Amir', 'Tash', 'Leo', 'Priya', 'Jonah', 'Mia', 'Rafa'];
        const step = () => {
            const weights = data.gyms.map((g) => g.athletes_week + (g.key === data.host_key ? 3 : 0));
            let r = Math.random() * weights.reduce((s, v) => s + v, 0);
            let gi = 0;
            for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) { gi = i; break; } }
            const minutes = 25 + Math.floor(Math.random() * 60);
            const points = 8 + Math.round(minutes / 3.5) + Math.floor(Math.random() * 6);
            const gyms = data.gyms.map((g, i) => (i !== gi ? g : {
                ...g,
                points_week: g.points_week + points,
                points_today: g.points_today + points,
                sessions_week: g.sessions_week + 1,
                days: g.days.map((v, d) => (d === 6 ? v + points : v)),
            }));
            const item = {
                key: `sim-${n++}`, gym_key: gyms[gi].key, display_name: names[Math.floor(Math.random() * names.length)], username: null,
                type: types[Math.floor(Math.random() * types.length)], started_at: new Date().toISOString(), minutes, points,
            };
            data = { ...data, gyms, feed: [item, ...data.feed].slice(0, 40), generated_at: new Date().toISOString() };
            absorb(data);
            setLastOkAt(Date.now());
            timer = setTimeout(step, 1800 + Math.random() * 3200);
        };
        timer = setTimeout(step, 1500);
        return () => clearTimeout(timer);
    }, [preview, absorb]);

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const stale = league && lastOkAt > 0 && now - lastOkAt > STALE_MS;

    if (!token) return <Shell><CenterNote big="This link is missing its key" small="Copy the full league URL from the admin — it ends in ?k=…" /></Shell>;
    if (invalid) return <Shell><CenterNote big="This screen link isn’t valid" small="Ask the POWR team for a fresh display URL." /></Shell>;
    if (!league) return <Shell><CenterNote big="POWR" small="Connecting…" pulse /></Shell>;

    return (
        <Shell>
            <Wall league={league} now={now} stale={stale && !preview} pinned={pinned} hits={hits} ripplesRef={ripplesRef} />
            {preview && (
                <div className="pointer-events-none absolute bottom-[0.55rem] left-[2.2rem] rounded-full border border-amber-400/50 bg-amber-400/10 px-[1rem] py-[0.3rem] text-[0.7rem] font-black uppercase tracking-[0.3em] text-amber-300 z-20">
                    Preview — simulated sessions on real gyms
                </div>
            )}
        </Shell>
    );
}

// ─── Wall ────────────────────────────────────────────────────────

function Wall({ league, now, stale, pinned, hits, ripplesRef }) {
    const gyms = useMemo(() => league.gyms ?? [], [league.gyms]);
    const host = useMemo(() => gyms.find((g) => g.key === league.host_key) ?? null, [gyms, league.host_key]);
    const local = useMemo(() => (host ? localGyms(gyms, host, league.radius_km) : []), [gyms, host, league.radius_km]);
    const localRanked = useMemo(() => rankGyms(local), [local]);
    const globalRanked = useMemo(() => rankGyms(gyms), [gyms]);
    const duelPool = localRanked.length >= 2 ? localRanked : globalRanked;
    const { rival, ahead } = rivalOf(duelPool, league.host_key);
    const effort = useMemo(() => rankByEffort(gyms), [gyms]);

    const plan = useMemo(
        () => leagueScenePlan({ localCount: local.length, globalCount: gyms.length, hasRival: !!(host && rival), effortCount: effort.ranked.length }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [local.length, gyms.length, !!(host && rival), effort.ranked.length],
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
    const scope = scene === 'global' || scene === 'effort' ? 'global' : local.length >= 2 ? 'local' : 'global';

    const hostPlace = host ? placeLabel(host.address, host.name) : '';
    const countries = new Set(gyms.map((g) => countryCode(g.address, g.lat, g.lng)).filter(Boolean)).size;
    const scopeSub = scope === 'local'
        ? `${hostPlace} · within ${league.radius_km} km of ${host.name} · ${local.length} gyms`
        : `Global · ${gyms.length} gyms${countries > 1 ? ` · ${countries} countries` : ''}`;
    const reset = resetLabel(countdownParts(league.week_end_at, now));

    return (
        <div className="gl-wall">
            <header className="gl-head">
                <div className="gl-brand"><span className="gl-powr">POWR</span><span className="gl-title">Gym League</span></div>
                <div className="gl-scope">
                    <div className="gl-lens">
                        <span className={scope === 'local' ? 'on' : ''}>Local</span>
                        <span className={scope === 'global' ? 'on' : ''}>Global</span>
                    </div>
                    <div className="gl-sub">{scopeSub}</div>
                </div>
                <div className="gl-status">
                    <span className="gl-reset">{weekLabel(league.week_start_at, league.week_end_at, league.tz)} · resets in <b>{reset}</b></span>
                    {stale
                        ? <span className="gl-live gl-stale"><i />Reconnecting</span>
                        : <span className="gl-live"><i />Live</span>}
                </div>
            </header>

            <main className="gl-main">
                <div className="gl-stage">
                    <AnimatePresence mode="wait">
                        {scene === 'duel' && host && rival ? (
                            <motion.section key="duel" className="gl-scene" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.45 }}>
                                <DuelScene host={host} rival={rival} ahead={ahead} pool={duelPool} scopeName={localRanked.length >= 2 ? hostPlace : 'POWR'} feed={league.feed ?? []} hits={hits} reset={reset} />
                            </motion.section>
                        ) : scene === 'effort' ? (
                            <motion.section key="effort" className="gl-scene" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.45 }}>
                                <EffortScene effort={effort} host={host} hits={hits} />
                            </motion.section>
                        ) : (
                            <motion.section key={`race-${scope}`} className="gl-scene" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.45 }}>
                                <RaceScene scope={scope} ranked={scope === 'local' ? localRanked : globalRanked} host={host} hits={hits} />
                            </motion.section>
                        )}
                    </AnimatePresence>
                </div>

                <aside className="gl-rail">
                    <div className="gl-card">
                        <h3>Network <span>{scope === 'local' ? `${local.length} gyms in view` : `${gyms.length} gyms${countries > 1 ? ` · ${countries} countries` : ''}`}</span></h3>
                        <div className="gl-mapwrap">
                            <NetworkMap scope={scope} gyms={scope === 'local' ? local : gyms} host={host} radiusKm={league.radius_km} hostKey={league.host_key} ripplesRef={ripplesRef} />
                        </div>
                        <div className="gl-legend">
                            <span><i style={{ background: GOLD }} />This gym</span>
                            <span><i style={{ background: 'rgba(242,242,242,.7)' }} />Scoring this week</span>
                            <span><i style={{ background: 'rgba(242,242,242,.22)' }} />Quiet</span>
                            <span>· a number = gyms in that spot</span>
                        </div>
                    </div>
                    <div className="gl-card gl-feedcard">
                        <h3>Landing now <span>{(() => { const n = sessionsLastHour(league.feed ?? [], now); return `${n} session${n === 1 ? '' : 's'} this hour · across POWR`; })()}</span></h3>
                        <FeedList feed={league.feed ?? []} gyms={gyms} hostKey={league.host_key} now={now} tz={league.tz} />
                    </div>
                </aside>
            </main>

            <Marquee feed={league.feed ?? []} gyms={gyms} ranked={globalRanked} hostKey={league.host_key} radiusKm={league.radius_km} host={host} />
        </div>
    );
}

// ─── Race ────────────────────────────────────────────────────────

function RaceScene({ scope, ranked, host, hits }) {
    const show = scope === 'local' ? ranked : ranked.slice(0, 12);
    const rest = scope === 'local' ? [] : ranked.slice(12);
    const leader = Math.max(1, ranked[0]?.points_week ?? 1);
    const dayStart = useMemo(() => ranksAtDayStart(ranked), [ranked]);
    const hostRank = ranked.findIndex((g) => g.key === host?.key) + 1;

    if (ranked.length === 0) {
        return <CenterNote big="No gyms scoring yet" small="Lanes fill as members train this week." />;
    }
    return (
        <>
            <div className="gl-eyebrow"><h2>This week · points earned inside the gym</h2><div className="gl-hint">Arrows show movement since midnight</div></div>
            <div className="gl-lanes">
                {show.map((g, i) => {
                    const rank = i + 1;
                    const was = dayStart[g.key] ?? rank;
                    const d = was - rank;
                    const hit = hits[g.key];
                    const w = Math.max(2, (g.points_week / leader) * 100);
                    const isHost = host && g.key === host.key;
                    const place = placeLabel(g.address, '');
                    const meta = scope === 'local'
                        ? `${place ? `${place} · ` : ''}${isHost ? 'this gym' : `${haversineKm(host, g).toFixed(1)} km`}`
                        : `${place || g.name}${countryCode(g.address, g.lat, g.lng) ? ` · ${countryCode(g.address, g.lat, g.lng)}` : ''}`;
                    return (
                        <motion.div
                            key={g.key}
                            layout
                            transition={{ type: 'spring', stiffness: 260, damping: 32 }}
                            className={`gl-lane${isHost ? ' host' : ''}${hit ? ' hit' : ''}`}
                        >
                            <div className="gl-rank">{rank}</div>
                            <div className={`gl-move${d > 0 ? ' up' : d < 0 ? ' down' : ''}`}>{d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : '—'}</div>
                            <div className="gl-mono">{monogram(g.name)}</div>
                            <div className="gl-name">
                                <b>{g.name}</b>
                                <small>{meta} · {g.sessions_week} sessions{rawPerAthlete(g) != null ? ` · ${Math.round(rawPerAthlete(g))} pts/athlete` : ''}{g.in_now ? <> · <span className="in">{g.in_now} in now</span></> : null}<Momentum g={g} /></small>
                            </div>
                            <div className="gl-bar">
                                {hit && hit.points > 0 && (
                                    <i key={hit.key} className="gl-delta" style={{ left: `${Math.max(0, ((g.points_week - hit.points) / leader) * 100)}%`, width: `${(hit.points / leader) * 100}%` }} />
                                )}
                                <div className="gl-fill" style={{ width: `${w}%` }}><i /></div>
                            </div>
                            <div className="gl-pts"><span className="plus">{hit ? `+${hit.points}` : ''}</span><RollNum value={g.points_week} /></div>
                        </motion.div>
                    );
                })}
            </div>
            {rest.length > 0 && (
                <div className="gl-more">
                    <span>and <b>{rest.length} more gyms</b> · {rest.filter((g) => g.points_week > 0).length} scoring this week</span>
                    {host && hostRank > 0 && <span>{host.name} is <b>{ordinal(hostRank)} of {ranked.length}</b></span>}
                </div>
            )}
        </>
    );
}

function Momentum({ g }) {
    const m = momentum(g);
    if (!m) return null;
    return <span className={`gl-mom ${m.up ? 'up' : 'down'}`} title="vs the same stretch of last week">{m.up ? '▲' : '▼'} {m.pct}%</span>;
}

// ─── Effort: points per athlete, the table a small gym can win ───

function EffortScene({ effort, host, hits }) {
    const { ranked, unranked } = effort;
    const show = ranked.slice(0, 10);
    const leader = Math.max(1e-6, ranked[0]?.perAthlete ?? 1);
    const hostRank = ranked.findIndex((r) => r.gym.key === host?.key) + 1;
    return (
        <>
            <div className="gl-eyebrow"><h2>Effort · points per athlete this week</h2><div className="gl-hint">The table a small gym can win · ranked with at least 3 athletes</div></div>
            <div className="gl-lanes">
                {show.map(({ gym: g, perAthlete }, i) => {
                    const hit = hits[g.key];
                    const isHost = host && g.key === host.key;
                    const place = placeLabel(g.address, '');
                    return (
                        <motion.div key={g.key} layout transition={{ type: 'spring', stiffness: 260, damping: 32 }} className={`gl-lane${isHost ? ' host' : ''}${hit ? ' hit' : ''}`}>
                            <div className="gl-rank">{i + 1}</div>
                            <div className="gl-move" />
                            <div className="gl-mono">{monogram(g.name)}</div>
                            <div className="gl-name">
                                <b>{g.name}</b>
                                <small>{place ? `${place} · ` : ''}{g.athletes_week} athletes · {fmt(g.points_week)} pts<Momentum g={g} /></small>
                            </div>
                            <div className="gl-bar"><div className="gl-fill" style={{ width: `${Math.max(2, (perAthlete / leader) * 100)}%` }}><i /></div></div>
                            <div className="gl-pts"><span className="plus">{hit ? `+${hit.points}` : ''}</span><RollNum value={Math.round(perAthlete)} /><span className="unit">per athlete</span></div>
                        </motion.div>
                    );
                })}
            </div>
            {(unranked.length > 0 || ranked.length > 10) && (
                <div className="gl-more">
                    <span>
                        {ranked.length > 10 ? <>and <b>{ranked.length - 10} more</b> ranked · </> : null}
                        {unranked.length > 0 ? `Needs 3 athletes to rank · ${unranked.slice(0, 4).map((g) => `${g.name} (${g.athletes_week})`).join(' · ')}${unranked.length > 4 ? ` · +${unranked.length - 4} more` : ''}` : null}
                    </span>
                    {host && hostRank > 10 && <span>{host.name} is <b>{ordinal(hostRank)} of {ranked.length}</b> on effort</span>}
                </div>
            )}
        </>
    );
}

function RollNum({ value, className }) {
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
    return <span className={className}>{fmt(shown)}</span>;
}

// ─── Head to head ────────────────────────────────────────────────

function DuelScene({ host, rival, ahead, pool, scopeName, feed, hits, reset }) {
    const gap = Math.abs(host.points_week - rival.points_week);
    const share = shareOf(host.points_week, rival.points_week);
    const max = Math.max(...host.days, ...rival.days, 1);
    const Side = ({ g, cls }) => {
        const isHost = g.key === host.key;
        const hit = hits[g.key];
        const recent = feed.filter((f) => f.gym_key === g.key).slice(0, 3);
        return (
            <div className={`gl-side ${cls}${isHost ? ' host' : ''}`}>
                <div className="gl-who">
                    <div className="gl-mono">{monogram(g.name)}</div>
                    <div><b>{g.name}</b><small>{ordinal(pool.indexOf(g) + 1)} in {scopeName}{placeLabel(g.address, '') && placeLabel(g.address, '') !== scopeName ? ` · ${placeLabel(g.address, '')}` : ''}</small></div>
                </div>
                <div className="gl-big">
                    <RollNum value={g.points_week} />
                    {hit && <span key={hit.key} className="gl-float">+{hit.points}</span>}
                </div>
                <div className="gl-lower">
                    <div className="gl-days">
                        {g.days.map((v, k) => (
                            <i key={k} className={k === 6 ? 'today' : ''} style={{ height: `${Math.max(4, (v / max) * 100)}%` }}><span>{DAY_L[k]}</span></i>
                        ))}
                    </div>
                    <div className="gl-stat"><b>{g.sessions_week}</b> sessions · <b>{g.athletes_week}</b> athletes · <b>{g.points_today}</b> today</div>
                    <ul className="gl-recent">
                        {recent.length === 0 && <li className="empty">Waiting for the next session here…</li>}
                        {recent.map((f) => (
                            <li key={f.key}><span><b>{boardName(f)}</b> · {activityMeta(f.type).label}<small>{f.minutes} min</small></span><em>+{f.points}</em></li>
                        ))}
                    </ul>
                </div>
            </div>
        );
    };
    return (
        <>
            <div className="gl-eyebrow"><h2>Head to head · {ahead ? 'the gym chasing you' : 'the gym directly above you'}</h2><div className="gl-hint">Points by day this week</div></div>
            <div className="gl-duel">
                <Side g={host} cls="left" />
                <div className="gl-gap">
                    <div className="vs">{ahead ? 'Lead' : 'Gap to close'}</div>
                    <div className="n"><RollNum value={gap} /></div>
                    <div className="ring"><i style={{ height: `${Math.min(100, (host.points_week / Math.max(1, host.points_week, rival.points_week)) * 100)}%` }} /></div>
                    <div className="l">
                        {ahead
                            ? <><b>{rival.name}</b> is chasing · <b>{sessionsToClose(gap)} sessions</b> behind</>
                            : <>about <b>{sessionsToClose(gap)} sessions</b> to overtake</>}
                    </div>
                    <div className="clock">Resets in <b>{reset}</b></div>
                </div>
                <Side g={rival} cls="right" />
                <div className="gl-tug">
                    <span className="cap">Share of the week so far</span>
                    <span className="pct l">{Math.round(share * 100)}%</span>
                    <span className="pct r">{Math.round((1 - share) * 100)}%</span>
                    <div className="a" style={{ width: `calc(${share * 100}% - 0.15rem)` }} />
                    <div className="b" style={{ width: `calc(${(1 - share) * 100}% - 0.15rem)` }} />
                    <div className="mark" style={{ left: `${share * 100}%` }} />
                </div>
            </div>
        </>
    );
}

// ─── Rail ────────────────────────────────────────────────────────

function NetworkMap({ scope, gyms, host, hostKey, radiusKm, ripplesRef }) {
    const canvasRef = useRef(null);
    const stateRef = useRef({ scope, gyms, host, hostKey, radiusKm, target: null, cur: null });
    stateRef.current = { ...stateRef.current, scope, gyms, host, hostKey, radiusKm };

    useEffect(() => {
        const s = stateRef.current;
        s.target = boundsOf(gyms.length ? gyms : (host ? [host] : []));
        if (!s.cur) s.cur = { ...s.target };
    }, [scope, gyms, host]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const ctx = canvas.getContext('2d');
        let raf = 0;
        const draw = () => {
            raf = requestAnimationFrame(draw);
            const s = stateRef.current;
            if (!s.target) return;
            const t = performance.now();
            const dpr = window.devicePixelRatio || 1;
            const r = canvas.getBoundingClientRect();
            if (r.width === 0) return;
            if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const W = r.width;
            const H = r.height;
            ctx.clearRect(0, 0, W, H);
            if (!s.cur) s.cur = { ...s.target };
            for (const k of ['n', 's', 'e', 'w']) s.cur[k] += (s.target[k] - s.cur[k]) * 0.06;
            const b = s.cur;
            const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
            const p = projector(b, W, H);
            const wide = (b.n - b.s) > 2;

            // land — sea is the card, land a shade lighter
            ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
            ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.lineJoin = 'round';
            ctx.beginPath();
            for (const ring of geo.land) { ring.forEach(([lng, lat], i) => { const [x, y] = p(lat, lng); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); }
            ctx.fill('evenodd'); if (wide) ctx.stroke();
            if (!wide) {
                const a = Math.min(1, (2 - (b.n - b.s)) / 1.5);
                ctx.strokeStyle = `rgba(255,255,255,${0.16 * a})`; ctx.lineWidth = Math.max(1.5, 0.0009 * p.sc); ctx.lineCap = 'round';
                ctx.beginPath(); for (const line of geo.thames) line.forEach(([lng, lat], i) => { const [x, y] = p(lat, lng); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
                if (s.host && s.scope === 'local') {
                    const [hx, hy] = p(s.host.lat, s.host.lng);
                    const [ex] = p(s.host.lat, s.host.lng + s.radiusKm / (111 * Math.cos((s.host.lat * Math.PI) / 180)));
                    ctx.strokeStyle = `rgba(250,204,21,${0.22 * a})`; ctx.setLineDash([4, 6]); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hx, hy, Math.max(0, ex - hx), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
                }
            }
            ctx.restore();

            const nodes = clusterNodes(s.gyms, p, wide ? 0.7 * rem : 1.5 * rem, rem, s.hostKey);
            const ranked = rankGyms(s.gyms);
            const hostNode = nodes.find((n) => n.host);
            if (hostNode) {
                const rivals = nodes.filter((n) => n !== hostNode && n.points > 0).sort((x, y) => y.points - x.points).slice(0, 3);
                ctx.strokeStyle = 'rgba(250,204,21,0.22)'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]); ctx.lineDashOffset = -(t / 60) % 8;
                for (const n of rivals) {
                    const mx = (hostNode.x + n.x) / 2, my = (hostNode.y + n.y) / 2, dx = n.x - hostNode.x, dy = n.y - hostNode.y, k = 0.18;
                    ctx.beginPath(); ctx.moveTo(hostNode.x, hostNode.y); ctx.quadraticCurveTo(mx - dy * k, my + dx * k, n.x, n.y); ctx.stroke();
                }
                ctx.setLineDash([]);
            }
            ripplesRef.current = ripplesRef.current.filter((rp) => t - rp.t >= 0 && t - rp.t < 1600);
            for (const rp of ripplesRef.current) {
                const n = nodes.find((x) => x.gyms.some((g) => g.key === rp.gymKey));
                if (!n) continue;
                const k = (t - rp.t) / 1600;
                ctx.strokeStyle = `rgba(${n.host ? '250,204,21' : '242,242,242'},${(1 - k) * 0.7})`; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(0, 0.3 * rem + k * 2.2 * rem), 0, Math.PI * 2); ctx.stroke();
            }
            ctx.textBaseline = 'middle';
            let labels = [];
            for (const n of [...nodes].sort((x, y) => x.host - y.host)) {
                const count = n.gyms.length;
                const rr = n.r;
                if (Math.hypot(n.x - n.ox, n.y - n.oy) > 1) { ctx.strokeStyle = 'rgba(242,242,242,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(n.ox, n.oy); ctx.lineTo(n.x, n.y); ctx.stroke(); }
                const lit = n.points > 0;
                ctx.fillStyle = n.host ? GOLD : lit ? 'rgba(242,242,242,0.78)' : 'rgba(242,242,242,0.22)';
                ctx.beginPath(); ctx.arc(n.x, n.y, rr, 0, Math.PI * 2); ctx.fill();
                if (n.host) { ctx.strokeStyle = 'rgba(250,204,21,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(0, rr + 0.25 * rem + Math.sin(t / 500) * 0.06 * rem), 0, Math.PI * 2); ctx.stroke(); }
                if (count > 1) { ctx.fillStyle = '#0d0d0d'; ctx.font = `700 ${0.62 * rem}px Outfit, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(String(count), n.x, n.y + 0.02 * rem); ctx.textAlign = 'left'; }
                let text = '';
                let sub = '';
                if (wide) {
                    if (lit || n.host) { text = nodeLabel(n, s.hostKey); sub = fmt(n.points); }
                } else {
                    const rk = ranked.indexOf(n.lead) + 1;
                    text = count > 1 ? n.gyms.map((g) => ranked.indexOf(g) + 1).join(' · ') : `${rk}`;
                    if (n.host || rk === 1) text += `  ${n.lead.name}`;
                }
                if (text) labels.push({ n, rr, text, sub, gold: n.host });
            }
            ctx.font = `500 ${0.66 * rem}px Outfit, sans-serif`;
            const hitsNode = (x0, y0, w, self) => nodes.some((o) => o !== self && o.x + o.r > x0 && o.x - o.r < x0 + w && Math.abs(o.y - y0) < o.r + 0.45 * rem);
            labels.forEach((l) => {
                const w = ctx.measureText(l.text).width + (l.sub ? ctx.measureText(` ${l.sub}`).width : 0);
                l.w = w; l.y = l.n.y;
                const rx = l.n.x + l.rr + 0.35 * rem;
                const lx = l.n.x - l.rr - 0.35 * rem - w;
                const rOk = rx + w < W - 0.3 * rem && !hitsNode(rx, l.y, w, l.n);
                const lOk = lx > 0.3 * rem && !hitsNode(lx, l.y, w, l.n);
                l.right = rOk || (!lOk && rx + w < W - 0.3 * rem);
                l.drop = !rOk && !lOk && !l.n.host && l.n.gyms.length === 1;
            });
            labels = labels.filter((l) => !l.drop).sort((x, y) => x.y - y.y);
            for (let i = 0; i < labels.length; i++) {
                for (let j = 0; j < i; j++) {
                    const a = labels[j], c = labels[i];
                    const ax0 = a.right ? a.n.x : a.n.x - a.w, cx0 = c.right ? c.n.x : c.n.x - c.w;
                    if (Math.abs(c.y - a.y) < 1.0 * rem && ax0 < cx0 + c.w + 0.4 * rem && cx0 < ax0 + a.w + 0.4 * rem) c.y = a.y + 1.0 * rem;
                }
            }
            for (const l of labels) {
                const x = l.right ? l.n.x + l.rr + 0.35 * rem : l.n.x - l.rr - 0.35 * rem - l.w;
                ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(14,14,14,0.9)'; ctx.lineWidth = 3; ctx.strokeText(l.text + (l.sub ? ` ${l.sub}` : ''), x, l.y);
                ctx.fillStyle = l.gold ? GOLD : 'rgba(242,242,242,0.7)'; ctx.fillText(l.text, x, l.y);
                if (l.sub) { const tw = ctx.measureText(l.text).width; ctx.fillStyle = l.gold ? 'rgba(250,204,21,0.7)' : 'rgba(242,242,242,0.4)'; ctx.fillText(` ${l.sub}`, x + tw, l.y); }
            }
        };
        raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, [ripplesRef]);

    return <canvas ref={canvasRef} className="gl-canvas" />;
}

function FeedList({ feed, gyms, hostKey, now, tz }) {
    const byKey = useMemo(() => new Map(gyms.map((g) => [g.key, g])), [gyms]);
    const time = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
    const items = feed.slice(0, 7);
    if (items.length === 0) return <div className="gl-empty">Quiet right now — the next session lands here.</div>;
    return (
        <ul className="gl-feed">
            {items.map((f) => {
                const g = byKey.get(f.gym_key);
                return (
                    <li key={f.key} className={f.gym_key === hostKey ? 'host' : ''}>
                        <div className="g">{g ? monogram(g.name) : '··'}</div>
                        <div className="t"><b>{boardName(f)} · {activityMeta(f.type).label}</b><small>{g?.name ?? 'POWR gym'} · {f.minutes} min · {time(f.started_at)}</small></div>
                        <div className="p">+{f.points}</div>
                    </li>
                );
            })}
            {/* keep `now` in the tree so relative labels could refresh; unused today */}
            <li hidden>{now}</li>
        </ul>
    );
}

function Marquee({ feed, gyms, ranked, hostKey, radiusKm, host }) {
    const byKey = new Map(gyms.map((g) => [g.key, g]));
    const items = [];
    feed.slice(0, 4).forEach((f) => items.push(<><b>{boardName(f)}</b> earned <em>+{f.points}</em> at {byKey.get(f.gym_key)?.name ?? 'a POWR gym'}</>));
    ranked.slice(0, 5).forEach((g, i) => items.push(<><b>{ordinal(i + 1)}</b> {g.name} · {fmt(g.points_week)} pts</>));
    const inNow = gyms.reduce((s, g) => s + (g.in_now ?? 0), 0);
    if (inNow > 0) items.push(<><b>{inNow}</b> athletes in a POWR gym right now</>);
    if (host) items.push(<>Local lens · <b>{radiusKm} km</b> around {host.name}</>);
    const hostRank = ranked.findIndex((g) => g.key === hostKey) + 1;
    if (hostRank > 0) items.push(<>{host?.name} is <b>{ordinal(hostRank)} of {ranked.length}</b> on POWR this week</>);
    if (items.length === 0) return null;
    const track = [...items, ...items];
    return (
        <footer className="gl-foot">
            <div className="gl-track" style={{ animationDuration: `${Math.max(30, track.length * 5)}s` }}>
                {track.map((it, i) => <span key={i}>{it}</span>)}
            </div>
        </footer>
    );
}

// ─── Chrome ──────────────────────────────────────────────────────

function CenterNote({ big, small, pulse }) {
    return (
        <div className="gl-center">
            <div className={`gl-center-big${pulse ? ' pulse' : ''}`}>{big}</div>
            {small && <div className="gl-center-small">{small}</div>}
        </div>
    );
}

function Shell({ children }) {
    return (
        <div className="gl-shell fixed inset-0 overflow-hidden select-none" style={{ fontFamily: "'Outfit', 'Helvetica Neue', sans-serif" }}>
            <style>{CSS}</style>
            {children}
        </div>
    );
}

const CSS = `
.gl-shell { background: #070707; color: #f2f2f2; --gold: ${GOLD}; --up: ${UP}; --down: #f87171; --line: rgba(255,255,255,0.10); --ink-2: rgba(242,242,242,0.62); --ink-3: rgba(242,242,242,0.38); --bg-2: #0e0e0e; --bg-3: #151515; }
.gl-shell * { box-sizing: border-box; }
.gl-wall { height: 100vh; display: grid; grid-template-rows: auto 1fr auto; padding: 1.6rem 2.2rem 0; gap: 1.2rem; position: relative; }
.gl-wall::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(60rem 30rem at 15% -10%, rgba(250,204,21,0.09), transparent 60%); animation: glDrift 24s ease-in-out infinite; }
@keyframes glDrift { 0%,100% { transform: translate(0,0) } 50% { transform: translate(3vw,2vh) } }
.gl-head { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 2rem; z-index: 1; }
.gl-brand { display: flex; align-items: baseline; gap: 0.9rem; }
.gl-powr { font-weight: 800; font-size: 1.6rem; letter-spacing: 0.02em; color: var(--gold); }
.gl-title { font-weight: 300; font-size: 1.6rem; letter-spacing: 0.04em; }
.gl-scope { display: flex; align-items: center; gap: 0.7rem; justify-self: center; }
.gl-lens { display: flex; gap: 0.3rem; padding: 0.25rem; border: 1px solid var(--line); border-radius: 999px; }
.gl-lens span { padding: 0.35rem 1rem; border-radius: 999px; font-size: 0.85rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-3); transition: color .4s, background .4s; }
.gl-lens span.on { background: var(--gold); color: #0d0d0d; font-weight: 600; }
.gl-sub { font-size: 0.9rem; color: var(--ink-2); min-width: 18rem; }
.gl-status { display: flex; align-items: center; gap: 1.4rem; font-size: 0.85rem; color: var(--ink-2); }
.gl-reset b { color: #f2f2f2; font-weight: 600; font-variant-numeric: tabular-nums; }
.gl-live { display: flex; align-items: center; gap: 0.5rem; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600; color: #f2f2f2; }
.gl-live i { width: 0.55rem; height: 0.55rem; border-radius: 50%; background: var(--up); animation: glPulse 1.6s ease-in-out infinite; }
.gl-live.gl-stale { color: var(--ink-3); } .gl-live.gl-stale i { background: #f59e0b; }
@keyframes glPulse { 0%,100% { opacity: 1; transform: scale(1) } 50% { opacity: 0.35; transform: scale(0.8) } }
.gl-main { display: grid; grid-template-columns: 1fr 27rem; gap: 1.6rem; min-height: 0; z-index: 1; }
.gl-stage { position: relative; min-width: 0; min-height: 0; }
.gl-scene { position: absolute; inset: 0; display: flex; flex-direction: column; }
.gl-eyebrow { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.7rem; }
.gl-eyebrow h2 { margin: 0; font-size: 0.8rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink-3); font-weight: 500; }
.gl-hint { font-size: 0.8rem; color: var(--ink-3); }
.gl-lanes { display: flex; flex-direction: column; gap: 0.45rem; flex: 1; min-height: 0; }
.gl-lane { flex: 1 1 0; max-height: 5.4rem; min-height: 3.4rem; display: grid; grid-template-columns: 2.4rem 2.3rem 2.6rem 15rem 1fr 6.4rem; align-items: center; gap: 0.9rem; padding: 0.55rem 0.9rem; border: 1px solid transparent; border-radius: 0.7rem; position: relative; transition: border-color .4s, background .4s; }
.gl-lane.host { border-color: rgba(250,204,21,0.45); background: linear-gradient(90deg, rgba(250,204,21,0.07), transparent 60%); }
.gl-lane.hit { background: rgba(255,255,255,0.05); }
.gl-rank { font-size: 1.6rem; font-weight: 700; color: var(--ink-2); font-variant-numeric: tabular-nums; text-align: right; }
.gl-lane:first-child .gl-rank { color: var(--gold); }
.gl-move { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.gl-move.up { color: var(--up); } .gl-move.down { color: var(--down); }
.gl-mono { width: 2.4rem; height: 2.4rem; border-radius: 0.6rem; display: grid; place-items: center; background: var(--bg-3); border: 1px solid var(--line); font-weight: 700; font-size: 0.85rem; letter-spacing: 0.02em; color: var(--ink-2); flex: none; }
.gl-lane.host .gl-mono, .gl-side.host .gl-mono, .gl-feed li.host .g { background: var(--gold); color: #0d0d0d; border-color: var(--gold); }
.gl-name { min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.gl-name b { font-weight: 600; font-size: 1.05rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gl-name small { font-size: 0.72rem; color: var(--ink-3); letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gl-name small .in { color: var(--up); }
.gl-bar { height: 0.9rem; border-radius: 999px; background: rgba(255,255,255,0.05); position: relative; overflow: hidden; }
.gl-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; min-width: 0.9rem; background: linear-gradient(90deg, rgba(250,204,21,0.22), rgba(250,204,21,0.5) 55%, rgba(253,230,138,0.85)); transition: width 1.2s cubic-bezier(.2,.8,.2,1), filter .3s; }
.gl-lane.host .gl-fill { background: linear-gradient(90deg, #ca8a04, var(--gold) 65%, #fde68a); }
.gl-lane.hit .gl-fill { filter: brightness(1.25); }
.gl-lane.hit .gl-fill::before { content: ''; position: absolute; inset: 0; width: 30%; background: linear-gradient(90deg, transparent, rgba(74,222,128,0.55), transparent); animation: glSweep 1.1s ease-out 1; }
.gl-lane:first-child .gl-fill::after { content: ''; position: absolute; inset: 0; width: 40%; background: linear-gradient(100deg, transparent, rgba(255,255,255,0.35), transparent); animation: glSweep 6s ease-in-out infinite; }
@keyframes glSweep { 0% { transform: translateX(-120%) } 40% { transform: translateX(260%) } 100% { transform: translateX(260%) } }
.gl-fill i { position: absolute; right: -0.2rem; top: 50%; width: 0.9rem; height: 0.9rem; margin-top: -0.45rem; border-radius: 50%; background: #fff; opacity: 0; transform: scale(0.3); }
.gl-lane.hit .gl-fill i { animation: glSpark .9s ease-out forwards; }
@keyframes glSpark { 0% { opacity: 1; transform: scale(0.4) } 100% { opacity: 0; transform: scale(3.2) } }
.gl-delta { position: absolute; top: 0; bottom: 0; border-radius: 999px; background: var(--up); min-width: 0.6rem; animation: glDelta 2.4s ease-out forwards; }
@keyframes glDelta { 0% { opacity: 1 } 55% { opacity: 1 } 100% { opacity: 0 } }
.gl-pts { text-align: right; font-weight: 700; font-size: 1.45rem; font-variant-numeric: tabular-nums; }
.gl-pts .plus { display: block; font-size: 0.7rem; font-weight: 600; color: var(--up); letter-spacing: 0.06em; height: 0.9rem; }
.gl-pts .unit { display: block; font-size: 0.6rem; font-weight: 500; color: var(--ink-3); letter-spacing: 0.12em; text-transform: uppercase; margin-top: -0.1rem; }
.gl-mom { display: inline-block; margin-left: 0.5rem; padding: 0 0.4rem; border-radius: 999px; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.06em; border: 1px solid var(--line); color: var(--ink-2); vertical-align: 0.05rem; }
.gl-mom.up { color: var(--up); border-color: rgba(74,222,128,0.35); } .gl-mom.down { color: var(--down); border-color: rgba(248,113,113,0.35); }
.gl-more { margin-top: 0.4rem; padding: 0.6rem 0.9rem; font-size: 0.85rem; color: var(--ink-3); border-top: 1px solid var(--line); display: flex; justify-content: space-between; }
.gl-more b { color: var(--ink-2); font-weight: 500; }
.gl-duel { flex: 1; display: grid; grid-template-columns: 1fr 13rem 1fr; grid-template-rows: auto auto; gap: 1.2rem 2rem; align-content: center; align-items: center; padding: 0 1.5rem; min-height: 0; }
.gl-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.gl-side.left { grid-column: 1; grid-row: 1; }
.gl-side.right { grid-column: 3; grid-row: 1; align-items: flex-end; }
.gl-who { display: flex; align-items: center; gap: 0.9rem; }
.gl-side.right .gl-who { flex-direction: row-reverse; text-align: right; }
.gl-who .gl-mono { width: 3.2rem; height: 3.2rem; border-radius: 0.8rem; font-size: 1.1rem; }
.gl-who b { font-size: 1.7rem; font-weight: 600; display: block; line-height: 1.1; }
.gl-who small { font-size: 0.85rem; color: var(--ink-3); letter-spacing: 0.04em; }
.gl-big { font-size: 6.4rem; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; position: relative; }
.gl-side.right .gl-big { text-align: right; }
.gl-side.host .gl-big { color: var(--gold); }
.gl-float { position: absolute; top: -0.2em; font-size: 0.32em; font-weight: 700; color: var(--up); letter-spacing: 0.02em; animation: glFloat 1.8s ease-out forwards; pointer-events: none; }
.gl-side.left .gl-float { left: 0; } .gl-side.right .gl-float { right: 0; }
@keyframes glFloat { 0% { opacity: 0; transform: translateY(0.6em) } 15% { opacity: 1 } 100% { opacity: 0; transform: translateY(-1.4em) } }
.gl-lower { display: flex; flex-direction: column; gap: 0.9rem; min-width: 0; width: 100%; }
.gl-side.right .gl-lower { align-items: flex-end; text-align: right; }
.gl-days { display: flex; gap: 0.4rem; align-items: flex-end; height: 7rem; width: 100%; max-width: 26rem; }
.gl-days i { flex: 1; background: rgba(250,204,21,0.22); border-radius: 0.25rem 0.25rem 0 0; min-height: 0.2rem; transition: height 1s cubic-bezier(.2,.8,.2,1); position: relative; }
.gl-days i.today { background: rgba(242,242,242,0.85); }
.gl-side.host .gl-days i.today { background: var(--gold); }
.gl-days i.today::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(255,255,255,0.35), transparent 60%); animation: glPulse 2.4s ease-in-out infinite; }
.gl-days i span { position: absolute; top: 100%; left: 0; right: 0; text-align: center; font-size: 0.65rem; color: var(--ink-3); margin-top: 0.3rem; letter-spacing: 0.1em; font-style: normal; }
.gl-stat { font-size: 0.9rem; color: var(--ink-2); margin-top: 0.8rem; }
.gl-stat b { color: #f2f2f2; font-weight: 600; font-variant-numeric: tabular-nums; }
.gl-recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; width: 100%; max-width: 26rem; }
.gl-recent li { display: flex; justify-content: space-between; gap: 1rem; padding: 0.45rem 0.7rem; border-radius: 0.5rem; background: rgba(255,255,255,0.04); font-size: 0.85rem; animation: glSlide .5s cubic-bezier(.2,.8,.2,1); }
.gl-recent li b { font-weight: 600; } .gl-recent li small { color: var(--ink-3); font-family: ui-monospace, Menlo, monospace; font-size: 0.7rem; margin-left: 0.5rem; }
.gl-recent li em { font-style: normal; color: var(--up); font-weight: 700; font-variant-numeric: tabular-nums; }
.gl-recent .empty { color: var(--ink-3); font-size: 0.8rem; background: none; padding: 0.45rem 0; animation: none; }
.gl-gap { grid-column: 2; grid-row: 1; text-align: center; display: flex; flex-direction: column; gap: 0.4rem; align-items: center; justify-content: center; }
.gl-gap .vs { font-size: 0.8rem; letter-spacing: 0.3em; color: var(--ink-3); text-transform: uppercase; }
.gl-gap .n { font-size: 2.8rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
.gl-gap .l { font-size: 0.8rem; color: var(--ink-3); max-width: 11rem; text-wrap: balance; line-height: 1.35; }
.gl-gap .l b { color: #f2f2f2; font-weight: 600; }
.gl-gap .ring { width: 0.5rem; height: 5rem; border-radius: 999px; background: var(--line); position: relative; margin: 0.5rem 0; overflow: hidden; }
.gl-gap .ring i { position: absolute; left: 0; right: 0; bottom: 0; background: var(--gold); border-radius: 999px; transition: height 1s ease; }
.gl-gap .clock { font-size: 0.72rem; color: var(--ink-3); letter-spacing: 0.12em; text-transform: uppercase; margin-top: 0.4rem; }
.gl-gap .clock b { color: var(--ink-2); font-variant-numeric: tabular-nums; font-weight: 600; }
.gl-tug { grid-column: 1 / -1; grid-row: 2; position: relative; height: 1.2rem; border-radius: 999px; background: rgba(255,255,255,0.05); margin: 0.6rem 0 1.2rem; }
.gl-tug .a, .gl-tug .b { position: absolute; top: 0; bottom: 0; border-radius: 999px; transition: width 1.2s cubic-bezier(.2,.8,.2,1); }
.gl-tug .a { left: 0; background: linear-gradient(90deg, #ca8a04, var(--gold)); overflow: hidden; }
.gl-tug .b { right: 0; background: linear-gradient(270deg, rgba(242,242,242,0.35), rgba(242,242,242,0.75)); }
.gl-tug .a::after { content: ''; position: absolute; inset: 0; width: 30%; background: linear-gradient(100deg, transparent, rgba(255,255,255,0.35), transparent); animation: glSweep 5s ease-in-out infinite; }
.gl-tug .mark { position: absolute; top: -0.5rem; bottom: -0.5rem; width: 0.32rem; margin-left: -0.16rem; background: #fff; border-radius: 999px; transition: left 1.2s cubic-bezier(.2,.8,.2,1); }
.gl-tug .mark::after { content: ''; position: absolute; inset: -0.35rem -0.6rem; border-radius: 999px; border: 1px solid rgba(255,255,255,0.35); animation: glPulse 2s ease-in-out infinite; }
.gl-tug .pct { position: absolute; top: -1.6rem; font-size: 0.8rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.gl-tug .pct.l { left: 0; color: var(--gold); } .gl-tug .pct.r { right: 0; color: var(--ink-2); }
.gl-tug .cap { position: absolute; top: -1.6rem; left: 50%; transform: translateX(-50%); font-size: 0.72rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-3); }
.gl-rail { display: grid; grid-template-rows: auto 1fr; gap: 1rem; min-height: 0; }
.gl-card { background: var(--bg-2); border: 1px solid var(--line); border-radius: 1rem; padding: 1rem 1.1rem; min-height: 0; display: flex; flex-direction: column; }
.gl-card h3 { margin: 0 0 0.6rem; font-size: 0.75rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink-3); font-weight: 500; display: flex; justify-content: space-between; gap: 1rem; }
.gl-card h3 span { letter-spacing: 0.04em; text-transform: none; color: var(--ink-2); text-align: right; }
.gl-mapwrap { position: relative; aspect-ratio: 1 / 0.82; width: 100%; }
.gl-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.gl-legend { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; margin-top: 0.7rem; font-size: 0.72rem; color: var(--ink-3); }
.gl-legend span { white-space: nowrap; }
.gl-legend i { display: inline-block; width: 0.55rem; height: 0.55rem; border-radius: 50%; margin-right: 0.35rem; vertical-align: middle; }
.gl-feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; overflow: hidden; flex: 1; min-height: 0; }
.gl-feed li { display: grid; grid-template-columns: 2.1rem 1fr auto; gap: 0.7rem; align-items: center; padding: 0.55rem 0.7rem; border-radius: 0.6rem; background: rgba(255,255,255,0.03); animation: glSlide .5s cubic-bezier(.2,.8,.2,1); }
@keyframes glSlide { from { opacity: 0; transform: translateY(-0.6rem) } to { opacity: 1; transform: none } }
.gl-feed .g { width: 2.1rem; height: 2.1rem; border-radius: 0.5rem; display: grid; place-items: center; font-weight: 700; font-size: 0.75rem; background: var(--bg-3); border: 1px solid var(--line); color: var(--ink-2); }
.gl-feed .t { min-width: 0; } .gl-feed .t b { display: block; font-weight: 600; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gl-feed .t small { font-size: 0.72rem; color: var(--ink-3); font-family: ui-monospace, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.gl-feed .p { font-weight: 700; font-size: 1rem; color: var(--up); font-variant-numeric: tabular-nums; white-space: nowrap; }
.gl-empty { color: var(--ink-3); font-size: 0.85rem; padding: 1rem 0; }
.gl-foot { border-top: 1px solid var(--line); margin: 0 -2.2rem; padding: 0.7rem 0; overflow: hidden; z-index: 1; }
.gl-track { display: flex; gap: 3rem; white-space: nowrap; width: max-content; animation: glMarquee 60s linear infinite; }
.gl-track span { font-size: 0.85rem; color: var(--ink-2); }
.gl-track span b { color: #f2f2f2; font-weight: 600; }
.gl-track span em { font-style: normal; color: var(--gold); font-weight: 600; }
@keyframes glMarquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }
.gl-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.8rem; text-align: center; padding: 2rem; }
.gl-center-big { font-size: 2.4rem; font-weight: 700; letter-spacing: -0.01em; }
.gl-center-big.pulse { animation: glPulse 1.8s ease-in-out infinite; color: var(--gold); }
.gl-center-small { font-size: 0.95rem; color: var(--ink-2); max-width: 30rem; }
@media (prefers-reduced-motion: reduce) {
  .gl-wall::before, .gl-live i, .gl-lane:first-child .gl-fill::after, .gl-lane.hit .gl-fill::before, .gl-track, .gl-tug .a::after, .gl-days i.today::after { animation: none; }
  .gl-delta { animation: none; opacity: 0.8; }
}
`;
