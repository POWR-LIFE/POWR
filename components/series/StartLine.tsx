import { Ionicons } from '@expo/vector-icons';
import MaskedView from '@react-native-masked-view/masked-view';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
    Easing,
    interpolate,
    type SharedValue,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, G, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

import { HomeStats } from '@/components/home/HomeCard';
import { crowdAt, crowdAtGun, type SeriesInviteBoard, seriesNum, seriesOrdinal } from '@/lib/api/series';
import { GOLD, TEXT, TEXT_2, TEXT_3 } from './SeriesLane';
import {
    BOXES, type Cell, fillOrder, glyph, jitter, P_BOWL_CURVES, P_H, P_LEG_CURVES, P_W, seatsFor, SLANT,
} from './pCrowd';
import { BUTTER, hexA, SeriesLockup, useSeason } from './season';

/** The gun, start to board (ms), and the bands the last empty seats come in by. */
const GUN_MS = 2600;
const BANDS = 6;
/** How long arrivals take to come forward from behind the P into their seats. */
const ARRIVE_MS = 1500;
/** How far back arrivals start: their scale where they set off (perspective). */
const FAR = 0.22;
/** Where arrivals set off from, in P units: just outside the P's edges, round the back of it. */
const LAUNCH: [number, number][] = [[150, -50], [430, -70], [690, -50], [60, 240], [740, 330], [560, 480]];
/**
 * The crowd still to come, behind the P: this many small Ps when the P is
 * empty, fewer as it fills (about half are behind the P at any moment). They
 * drift right to left, round the back, each depth taking BACK_CROSS_MS to
 * cross the screen: the far ones slowest.
 */
const BACK_MAX = 190;
const BACK_CROSS_MS = [60000, 44000, 32000];
/** The screen's side margin: the background runs edge to edge, past it. */
const SIDE = 20;
/** The big P's own colour: solid, so whatever is behind it is hidden. */
const P_FILL = '#0b0e0d';
/**
 * The stream through the P: this many single Ps, each on its own lap (LAP_S
 * seconds, give or take LAP_VARY): out from behind the P's left side, forward
 * into a seat, a while there, on to the right and behind the P, round the back,
 * and again, to a different seat each time. Laps run as fractions:
 */
const STREAMERS = 48;
const LAP_S = 10;
const LAP_VARY = 4;
const LAP_EMERGE = 0.05; // sliding out from behind the left side
const LAP_SEAT = 0.17; // arcing forward into the seat
const LAP_LEAVE = 0.6; // up from the seat, on to the right
const LAP_HIDE = 0.72; // slipping behind the right side
const LAP_GONE = 0.77; // round the back until the lap ends
/** How small a streamer is behind the P (it grows to full size as it comes forward into its seat). */
const STREAM_FAR = 0.6;
/** How far a column stands up in the Mexican wave, in rows. */
const STAND = 0.5;
/** Room under the P for the start line and its count. */
const LINE_BLOCK = 40;

/** The clock, every `ms`. */
function useNow(ms: number) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), ms);
        return () => clearInterval(t);
    }, [ms]);
    return now;
}

/**
 * "06 : 14 : 32 : 08": days, hours, minutes, seconds to the gun. On its own
 * second's tick, so the crowd isn't redrawn every second.
 */
function Clock({ to, roundName, onZero }: { to: number; roundName: string; onZero: () => void }) {
    const { t } = useTranslation();
    const now = useNow(1000);
    const ms = Math.max(0, to - now);
    const sec = Math.floor(ms / 1000);
    const parts = [Math.floor(sec / 86_400), Math.floor((sec % 86_400) / 3600), Math.floor((sec % 3600) / 60), sec % 60];
    const zero = useRef(onZero);
    zero.current = onZero;
    useEffect(() => { if (ms === 0) zero.current(); }, [ms]);
    return (
        <>
            <View
                style={s.clock}
                accessibilityRole="timer"
                accessibilityLabel={t('series:start.clockA11y', {
                    days: t('series:start.a11yDays', { count: parts[0] }),
                    hours: t('series:start.a11yHours', { count: parts[1] }),
                    minutes: t('series:start.a11yMinutes', { count: parts[2] }),
                    round: roundName,
                })}
            >
                {parts.map((n, i) => (
                    <React.Fragment key={i}>
                        {i > 0 && <Text style={s.colon}>:</Text>}
                        <View style={s.unit}>
                            <Text style={s.num}>{String(n).padStart(2, '0')}</Text>
                            <Text style={s.unitLabel}>
                                {[t('series:start.unitDays'), t('series:start.unitHours'), t('series:start.unitMinutes'), t('series:start.unitSeconds')][i]}
                            </Text>
                        </View>
                    </React.Fragment>
                ))}
            </View>
            <Text style={s.toWhat}>{t('series:start.toRound', { round: roundName.toUpperCase() })}</Text>
        </>
    );
}

/**
 * The League tab before a round: one screen, no scrolling. The round's lockup,
 * a countdown, and the crowd waiting at the start line as a P made of Ps: one
 * tiny P per person waiting (real members and the pacers who fill it to the
 * board's day-1 size by the gun, crowdAt). Small Ps waiting in the
 * background behind the big P and come forward into its seats, so how full it
 * is says how close the gun is. It never stops: single Ps keep streaming out
 * from behind the P's left side into seats and on behind its right side, and
 * now and then the crowd does a Mexican wave.
 * The P, the line and the count sit together in the middle of the space.
 * Under them, three
 * numbers (your place in the invite race, your friends in, who leads: tap for
 * the whole race) and one button, INVITE A FRIEND. Until you've joined
 * (onJoin): the round's days and the Draw's, and the button is JOIN THE SERIES.
 *
 * At zero, three beats: the line breaks and any empty seats fill in a wave,
 * so the P is whole; every tiny P turns gold and they fuse into one solid
 * gold P (a heavy tap); it holds, swells and `onStarted` opens the board.
 */
export function StartLine({
    startsAt, roundName, invite, onInvite, onRace, onStarted, onCity, dev, days, need, shift = 0, onJoin,
}: {
    startsAt: number;
    roundName: string;
    /**
     * You haven't joined yet: the button is JOIN THE SERIES (it opens the join
     * sheet) and the numbers are the round's. Inviting comes once you're in.
     */
    onJoin?: () => void;
    /** The invite race, while it's on; without it the screen is the countdown and the round's basics. */
    invite: SeriesInviteBoard | null;
    onInvite: () => void;
    /** The whole invite race (a sheet). */
    onRace: () => void;
    /** The gun has gone and the surge has played. */
    onStarted: () => void;
    /** You still have a city to pick: a small link under the button. */
    onCity?: () => void;
    /** Dev controls, top right (sample only). */
    dev?: React.ReactNode;
    days: number;
    need: number;
    /** Dev: how far ahead the crowd's clock runs (ms), to watch it fill. */
    shift?: number;
}) {
    const { t } = useTranslation();
    const { def } = useSeason();
    const [done, setDone] = useState(false);
    useEffect(() => { setDone(false); }, [startsAt]);
    // The crowd moves on a slower tick than the clock: a new arrival is minutes apart.
    const now = useNow(2000);
    const go = useSharedValue(0);
    // The latest handler, so a parent re-render can't restart the gun.
    const started = useRef(onStarted);
    started.current = onStarted;
    useEffect(() => {
        if (!done) { go.value = 0; return undefined; }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        go.value = withTiming(1, { duration: GUN_MS, easing: Easing.linear });
        // The tap lands as the Ps fuse (go 0.58).
        const fuse = setTimeout(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); }, GUN_MS * 0.58);
        const t = setTimeout(() => started.current(), GUN_MS + 100);
        return () => { clearTimeout(fuse); clearTimeout(t); };
    }, [done, go]);

    const me = invite?.me;
    const leader = invite?.rows.find((r) => r.rank === 1);
    const waiting = invite ? crowdAt(invite, now + shift) : 0;
    const atGun = invite ? crowdAtGun(invite) : 0;
    const [stage, setStage] = useState({ w: 0, h: 0 });

    return (
        <View style={s.screen}>
            <View style={s.top}>
                <SeriesLockup height={30} def={def} />
                {dev}
            </View>

            <Clock to={startsAt} roundName={roundName} onZero={() => setDone(true)} />

            {/* The crowd at the start line: the P, the line and the count, centred together. */}
            <View style={s.stage} onLayout={(e) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
                {invite && stage.h > LINE_BLOCK && (
                    <PCrowd
                        box={{ w: stage.w, h: stage.h - LINE_BLOCK }}
                        waiting={waiting}
                        atGun={atGun}
                        go={go}
                        firing={done}
                    />
                )}
                <StartLineBar go={go} />
                <Text style={s.lineLabel}>
                    {done
                        ? t('series:start.roundOn', { round: roundName.toUpperCase() })
                        : invite ? t('series:start.waiting', { n: seriesNum(waiting) }) : t('series:start.basics', { days, need })}
                </Text>
            </View>

            {onJoin ? (
                <>
                    <View style={s.stats}>
                        <HomeStats items={[
                            { value: seriesNum(days), label: t('series:start.roundDays') },
                            { value: seriesNum(need), label: t('series:start.drawDays') },
                        ]} />
                    </View>
                    <Pressable
                        onPress={() => { void Haptics.selectionAsync(); onJoin(); }}
                        style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]}
                        accessibilityRole="button"
                        accessibilityLabel={t('series:join.ctaA11y', { season: def.name })}
                    >
                        <Ionicons name="flag-outline" size={16} color="#0a0a0a" />
                        <Text style={s.btnText}>{t('series:join.cta')}</Text>
                    </Pressable>
                    <Text style={s.fine}>{t('series:join.fineJoin')}</Text>
                </>
            ) : invite && me ? (
                <>
                    <Pressable onPress={onRace} style={({ pressed }) => [s.stats, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={t('series:start.raceA11y')}>
                        {/* Everyone's in. The invite race is an optional extra for
                            Patient Zero: in it, your place and friends; not, the round. */}
                        <HomeStats items={me.rank != null ? [
                            { value: seriesOrdinal(me.rank), label: t('series:start.racePlace'), tone: 'gold' },
                            { value: `${me.friends}`, label: me.joining ? t('series:start.friendsInJoining', { n: me.joining }) : t('series:start.friendsIn') },
                            leader && !leader.you
                                ? { value: `${leader.friends}`, label: t('series:start.leads', { name: leader.name.split(' ')[0] }) }
                                : { value: seriesNum(days), label: t('series:start.roundDays') },
                        ] : [
                            { value: t('series:start.in'), label: t('series:start.youreIn', { round: roundName }), tone: 'green' },
                            { value: seriesNum(days), label: t('series:start.roundDays') },
                            { value: seriesNum(need), label: t('series:start.drawDays') },
                        ]} />
                    </Pressable>
                    <Pressable
                        onPress={() => { void Haptics.selectionAsync(); onInvite(); }}
                        style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]}
                        accessibilityRole="button"
                        accessibilityLabel={t('series:start.inviteA11y')}
                    >
                        <Ionicons name="person-add-outline" size={16} color="#0a0a0a" />
                        <Text style={s.btnText}>{t('series:start.invite')}</Text>
                    </Pressable>
                    <Text style={s.fine}>{t('series:start.fineRace')}</Text>
                </>
            ) : (
                <Text style={s.fine}>{t('series:start.fineBoard')}</Text>
            )}
            {onCity && (
                <Pressable onPress={onCity} hitSlop={8} style={({ pressed }) => [s.city, pressed && { opacity: 0.6 }]} accessibilityRole="button">
                    <Ionicons name="location-outline" size={12} color={TEXT_2} />
                    <Text style={s.cityText}>{t('series:start.city')}</Text>
                    <Ionicons name="chevron-forward" size={12} color={TEXT_2} />
                </Pressable>
            )}
        </View>
    );
}

type Arrival = { key: string; d: string; to: number; delay: number; from: number };

/**
 * The crowd as a P made of Ps: one tiny P per seat on an italic lattice at the
 * mark's own slope, so the crowd's sides run straight along the P's (pCrowd).
 * The big P is solid. Behind it and around it wait the people still to come:
 * small, faint Ps drifting in the background (fewer as the P fills), never
 * inside it. People come forward from just round the P's edges, partly hidden
 * behind it at first, then in front of it, growing and spreading out into
 * their seats. Seats fill scattered across the whole P, to the share of the
 * crowd at the gun that's here now, so it's full exactly at the gun.
 *
 * It never stops. Most of the crowd stays seated (it comes in when the screen
 * opens, and whoever's new after that); a stream of single Ps keeps flowing
 * through it, one way, on one endless clock (Streamer): out from behind the
 * P's left side, forward into a seat, on to the right and behind the P, round
 * the back and again, each on a lap of its own length, so there's no moment
 * where it starts over. Every few seconds a Mexican wave
 * runs across the seated crowd: each sloping column stands up (lifts along the
 * slope and brightens) as it passes. The seated crowd is masked to the P's shape.
 *
 * At the gun (`firing`) the stream fades, the empty seats come
 * forward, every P turns gold, and they fuse into one solid gold P that swells
 * and opens onto the board. The gun's layers only mount when it fires.
 */
function PCrowd({ box, waiting, atGun, go, firing }: {
    box: { w: number; h: number }; waiting: number; atGun: number; go: SharedValue<number>; firing: boolean;
}) {
    const width = box.w > 0 && box.h > 0 ? Math.min(box.w, (box.h * P_W) / P_H) : 0;
    const height = width * (P_H / P_W);
    const people = Math.max(1, atGun, waiting);
    const { cells, size, pitch } = useMemo(() => (width ? seatsFor(width, people) : { cells: [] as Cell[], size: 0, pitch: 0 }), [width, people]);
    const order = useMemo(() => fillOrder(cells), [cells]);
    // The share of the crowd at the gun that's here now: all seated but the stream's (about half of it is in a seat at a time).
    const target = Math.round(order.length * Math.min(1, waiting / people));
    const base = Math.max(0, target - Math.round(STREAMERS / 2));
    // The stream's seats, up to six each, dealt round so no two streamers share one.
    const poolEnd = base + Math.min(6, Math.floor((order.length - base) / STREAMERS)) * STREAMERS;
    // Each seat's tiny P, built once per layout: every crowd path below is these joined.
    const seatD = useMemo(() => cells.map((c) => glyph(c.x, c.y, size)), [cells, size]);
    const pathOf = useCallback((from: number, to: number) => {
        let d = '';
        for (let i = from; i < to; i += 1) d += seatD[order[i]];
        return d;
    }, [order, seatD]);

    // The seated crowd: `settled` seats are in it; the ones in `arrivals` are still on their way, each group from its own spot round the P.
    const [settled, setSettled] = useState(0);
    const [arrivals, setArrivals] = useState<Arrival[]>([]);
    const covered = useRef({ order, n: 0 });
    const launches = useRef(0);
    useEffect(() => {
        if (!order.length) return;
        // A new layout starts the crowd again.
        if (covered.current.order !== order) {
            covered.current = { order, n: 0 };
            setSettled(0);
            setArrivals([]);
        }
        const from = covered.current.n;
        if (base < from) {
            covered.current.n = base;
            setSettled(base);
            setArrivals([]);
            return;
        }
        if (base === from) return;
        // The opening crowd comes forward in a stream of groups; later arrivals in one or a few.
        const opening = from === 0;
        const count = Math.min(opening ? 9 : 4, Math.ceil((base - from) / 60));
        const per = Math.ceil((base - from) / count);
        const stamp = Date.now();
        const add: Arrival[] = [];
        for (let k = 0; k < count && from + k * per < base; k += 1) {
            const to = Math.min(base, from + (k + 1) * per);
            add.push({ key: `${stamp}-${k}`, d: pathOf(from + k * per, to), to, delay: k * (opening ? 150 : 220), from: launches.current++ % LAUNCH.length });
        }
        covered.current.n = base;
        setArrivals((x) => [...x, ...add]);
    }, [order, base, pathOf]);
    const landed = useCallback((key: string, to: number) => {
        setSettled((n) => Math.max(n, to));
        setArrivals((x) => x.filter((w) => w.key !== key));
    }, []);

    // Where each sloping column is across the P (0–1), for the wave's crest.
    const across = useMemo(() => {
        const sum: number[] = [];
        const n: number[] = [];
        for (const c of cells) {
            const g = columnOf(c);
            sum[g] = (sum[g] ?? 0) + c.u;
            n[g] = (n[g] ?? 0) + 1;
        }
        return Array.from({ length: sum.length }, (_, g) => (n[g] ? sum[g] / n[g] : 0));
    }, [cells]);
    // The seated crowd in those columns.
    const columns = useMemo(() => {
        const out = across.map(() => '');
        for (let i = 0, n = Math.min(settled, base); i < n; i += 1) out[columnOf(cells[order[i]])] += seatD[order[i]];
        return out;
    }, [across, order, cells, seatD, settled, base]);

    // The stream: its seats (shared with the UI thread once, not copied into every streamer), the P's
    // sides it comes out from and goes behind, and one clock in seconds (100,000 s is over a day).
    const pool = useSharedValue<{ xs: number[]; ys: number[] }>({ xs: [], ys: [] });
    useEffect(() => {
        const seats = order.slice(base, poolEnd).map((i) => cells[i]);
        pool.value = { xs: seats.map((c) => c.x), ys: seats.map((c) => c.y) };
    }, [order, cells, base, poolEnd, pool]);
    const sides = useMemo((): Sides => {
        const k = width / P_W;
        return { width, height, pitch, legRight: BOXES[0].u1 * k, bowlRight: BOXES[1].u1 * k, bowlBottom: BOXES[1].y1 * k };
    }, [width, height, pitch]);
    const clock = useSharedValue(0);
    useEffect(() => {
        clock.value = withTiming(100_000, { duration: 100_000_000, easing: Easing.linear });
    }, [clock]);

    // Where the P sits in the stage, so the background can spread round it.
    const [off, setOff] = useState<{ x: number; y: number } | null>(null);
    // The people still to come, behind the P: small faint Ps scattered edge to edge across the screen from
    // the top of the stage to the P's foot, in three depths, nearer ones bigger and brighter, drifting round
    // the back (the solid P hides whoever's behind it). Fewer as the P fills.
    const backCount = Math.round(BACK_MAX * (1 - Math.min(1, waiting / people)));
    const back = useMemo(() => {
        if (!off || !width) return null;
        const w = box.w + 2 * SIDE;
        const h = off.y + height;
        const layers = ['', '', ''];
        for (let i = 0; i < backCount; i += 1) {
            layers[i % 3] += glyph(jitter(2 * i + 1) * w, jitter(2 * i + 2) * h, size * [0.45, 0.65, 0.85][i % 3]);
        }
        return { layers, w, h };
    }, [off, width, height, box.w, backCount, size]);

    // The Mexican wave: a crest runs left to right every few seconds.
    const mw = useSharedValue(0);
    useEffect(() => {
        mw.value = withRepeat(withDelay(3800, withTiming(1, { duration: 2200, easing: Easing.linear })), -1, false);
    }, [mw]);

    // The gun: the seats nobody's in yet (the stream's included) in bands, then every seat in gold.
    const gun = useMemo(() => {
        if (!firing) return null;
        const per = Math.ceil((order.length - base) / BANDS);
        return {
            bands: Array.from({ length: BANDS }, (_, b) => pathOf(base + b * per, Math.min(order.length, base + (b + 1) * per))),
            gold: pathOf(0, order.length),
        };
    }, [firing, order.length, base, pathOf]);
    // Beat 1 also fades the stream.
    const streamFadeBehind = useAnimatedStyle(() => ({ opacity: interpolate(go.value, [0, 0.12], [1, 0], 'clamp') }));
    const streamFadeFront = useAnimatedStyle(() => ({ opacity: interpolate(go.value, [0, 0.12], [1, 0], 'clamp') }));
    // Beat 2: the crowd turns gold (0.30–0.45), then fuses: the Ps go as the solid P comes (0.42–0.62).
    const crowdFade = useAnimatedStyle(() => ({ opacity: interpolate(go.value, [0.5, 0.62], [1, 0], 'clamp') }));
    const goldIn = useAnimatedStyle(() => ({ opacity: interpolate(go.value, [0.3, 0.45], [0, 1], 'clamp') }));
    // Beat 3: the P holds, swells and opens.
    const solid = useAnimatedStyle(() => ({
        opacity: interpolate(go.value, [0.42, 0.58, 0.86, 1], [0, 1, 1, 0], 'clamp'),
        transform: [{ scale: interpolate(go.value, [0.58, 0.82, 1], [1, 1.03, 1.4], 'clamp') }],
    }));

    const spots = useMemo(() => LAUNCH.map(([x, y]): [number, number] => [(x * width) / P_W, (y * width) / P_W]), [width]);
    if (!width) return null;
    return (
        <View
            style={{ width, height, alignSelf: 'center' }}
            onLayout={(e) => setOff({ x: e.nativeEvent.layout.x, y: e.nativeEvent.layout.y })}
        >
            <Animated.View style={[StyleSheet.absoluteFill, crowdFade]}>
                {/* Behind the P: the people still to come, and everyone setting off or slipping back round its edges. */}
                {back && off && (
                    <View
                        pointerEvents="none"
                        style={{ position: 'absolute', left: -(off.x + SIDE), top: -off.y, width: back.w, height: back.h, overflow: 'hidden' }}
                    >
                        {back.layers.map((d, n) => <BackLayer key={n} d={d} depth={n} width={back.w} height={back.h} />)}
                    </View>
                )}
                {arrivals.map((a) => (
                    <Flight key={`${a.key}-behind`} arrival={a} at={spots[a.from]} behind width={width} height={height} />
                ))}
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, streamFadeBehind]}>
                    {Array.from({ length: STREAMERS }, (_, n) => (
                        <Streamer key={n} n={n} clock={clock} pool={pool} sides={sides} size={size} behind />
                    ))}
                </Animated.View>
                {/* The big P: solid, then a touch of butter and its outline. */}
                <Svg width={width} height={height} viewBox={`0 0 ${P_W} ${P_H}`} style={StyleSheet.absoluteFill} pointerEvents="none">
                    <Path d={P_LEG_CURVES} fill={P_FILL} />
                    <Path d={P_BOWL_CURVES} fill={P_FILL} />
                    <Path d={P_LEG_CURVES} fill={hexA(BUTTER, 0.045)} stroke={hexA(BUTTER, 0.32)} strokeWidth={P_W / width} />
                    <Path d={P_BOWL_CURVES} fill={hexA(BUTTER, 0.045)} stroke={hexA(BUTTER, 0.32)} strokeWidth={P_W / width} />
                </Svg>
                <InsideP width={width} height={height}>
                    {columns.map((d, g) => <Column key={g} at={across[g]} d={d} width={width} height={height} lift={pitch * STAND} mw={mw} />)}
                    {gun && (
                        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, goldIn]}>
                            <Svg width={width} height={height}><Path d={gun.gold} fill={GOLD} /></Svg>
                        </Animated.View>
                    )}
                </InsideP>
                {/* In front of the P: everyone coming forward into their seats, or on their way back. */}
                {arrivals.map((a) => (
                    <Flight key={a.key} arrival={a} at={spots[a.from]} width={width} height={height} onLanded={landed} />
                ))}
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, streamFadeFront]}>
                    {Array.from({ length: STREAMERS }, (_, n) => (
                        <Streamer key={n} n={n} clock={clock} pool={pool} sides={sides} size={size} />
                    ))}
                </Animated.View>
                {gun && gun.bands.map((d, b) => <Band key={b} d={d} band={b} at={spots[b % spots.length]} width={width} height={height} go={go} />)}
            </Animated.View>
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, solid]}>
                <Svg width={width} height={height} viewBox={`0 0 ${P_W} ${P_H}`}>
                    <Path d={P_LEG_CURVES} fill={GOLD} />
                    <Path d={P_BOWL_CURVES} fill={GOLD} />
                </Svg>
            </Animated.View>
        </View>
    );
}

/** Which sloping column of the crowd a seat is in, for the Mexican wave: two of the lattice's columns each. */
const columnOf = (c: Cell) => Math.floor(c.lane / 2);

/** The crowd masked to the P's shape (on the web, where MaskedView doesn't mask, a CSS clip-path of the same shape). */
function InsideP({ width, height, children }: { width: number; height: number; children: React.ReactNode }) {
    if (Platform.OS === 'web') {
        const k = width / P_W;
        const d = `${P_LEG_CURVES}${P_BOWL_CURVES}`.replace(/\d+(\.\d+)?/g, (n) => (Number(n) * k).toFixed(2));
        const clip = { clipPath: `path('${d}')` } as unknown as ViewStyle;
        return <View pointerEvents="none" style={[StyleSheet.absoluteFill, clip]}>{children}</View>;
    }
    return (
        <MaskedView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            maskElement={(
                <Svg width={width} height={height} viewBox={`0 0 ${P_W} ${P_H}`}>
                    <Path d={P_LEG_CURVES} fill="#000" />
                    <Path d={P_BOWL_CURVES} fill="#000" />
                </Svg>
            )}
        >
            {children}
        </MaskedView>
    );
}

/** Tiny Ps as one path, brighter at the front. */
function CrowdPath({ d, width, height }: { d: string; width: number; height: number }) {
    return (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
                <SvgGradient id="crowd" gradientUnits="userSpaceOnUse" x1="0" y1={height} x2="0" y2="0">
                    <Stop offset="0" stopColor={TEXT} stopOpacity="0.9" />
                    <Stop offset="1" stopColor={TEXT} stopOpacity="0.44" />
                </SvgGradient>
            </Defs>
            {d ? <Path d={d} fill="url(#crowd)" /> : null}
        </Svg>
    );
}

/** One sloping column of the crowd: as the wave's crest passes it stands up, along the slope, and brightens. */
function Column({ at, d, width, height, lift, mw }: {
    at: number; d: string; width: number; height: number; lift: number; mw: SharedValue<number>;
}) {
    const st = useAnimatedStyle(() => {
        // The crest starts just left of the P and finishes just right of it.
        const t = Math.max(0, 1 - Math.abs(-0.15 + mw.value * 1.3 - at) / 0.11);
        const up = t * t * (3 - 2 * t);
        return { opacity: 0.8 + 0.2 * up, transform: [{ translateX: up * lift * SLANT }, { translateY: -up * lift }] };
    });
    if (!d) return null;
    return (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st]}>
            <CrowdPath d={d} width={width} height={height} />
        </Animated.View>
    );
}

/** One depth of the people waiting behind the P: drifting slowly, the nearer depths further and faster. */
/**
 * One depth of the people behind the P, drifting right to left round the back
 * and bobbing a little. Drawn twice side by side and slid one screen-width
 * each crossing, so it wraps with no seam and never stops.
 */
function BackLayer({ d, depth, width, height }: { d: string; depth: number; width: number; height: number }) {
    const t = useSharedValue(0);
    const bob = useSharedValue(0);
    useEffect(() => {
        t.value = withRepeat(withTiming(1, { duration: BACK_CROSS_MS[depth], easing: Easing.linear }), -1, false);
        bob.value = withRepeat(withTiming(1, { duration: 9000 - depth * 1500, easing: Easing.linear }), -1, false);
    }, [t, bob, depth]);
    const reach = 2 + depth * 2;
    const st = useAnimatedStyle(() => ({
        transform: [{ translateX: -t.value * width }, { translateY: Math.sin(bob.value * 2 * Math.PI) * reach }],
    }));
    if (!d) return null;
    const fill = [0.14, 0.22, 0.3][depth];
    return (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: 2 * width, height }, st]}>
            <Svg width={2 * width} height={height}>
                <Path d={d} fill={TEXT} fillOpacity={fill} />
                <G transform={`translate(${width}, 0)`}><Path d={d} fill={TEXT} fillOpacity={fill} /></G>
            </Svg>
        </Animated.View>
    );
}

/**
 * Where a group of arrivals is on its way in, `e` 0–1: at 0 a small cluster
 * (scale FAR) round `at`, at 1 in their seats. Scaling about the P's centre
 * while closing in on it is perspective: they grow and spread out as they come.
 */
function flight(e: number, at: [number, number], width: number, height: number) {
    'worklet';
    const s = FAR + (1 - FAR) * e;
    return [{ translateX: (1 - e) * (at[0] - width / 2) }, { translateY: (1 - e) * (at[1] - height / 2) }, { scale: s }];
}

/**
 * A group of arrivals coming forward from behind the P into their seats. Drawn
 * twice: `behind` (under the big P, so it sets off partly hidden) for the
 * start, then in front of the P for the rest; the front copy says when it's landed.
 */
function Flight({ arrival, at, behind, width, height, onLanded }: {
    arrival: Arrival; at: [number, number]; behind?: boolean; width: number; height: number; onLanded?: (key: string, to: number) => void;
}) {
    const p = useSharedValue(0);
    const landed = useRef(onLanded);
    landed.current = onLanded;
    useEffect(() => {
        p.value = withDelay(arrival.delay, withTiming(1, { duration: ARRIVE_MS, easing: Easing.inOut(Easing.cubic) }));
        if (!landed.current) return undefined;
        const t = setTimeout(() => landed.current?.(arrival.key, arrival.to), arrival.delay + ARRIVE_MS + 40);
        return () => clearTimeout(t);
    }, [arrival, p]);
    const st = useAnimatedStyle(() => ({
        opacity: behind
            ? interpolate(p.value, [0, 0.1, 0.28, 0.4], [0, 0.75, 0.75, 0], 'clamp')
            : interpolate(p.value, [0.28, 0.4], [0, 0.8], 'clamp'),
        transform: flight(p.value, at, width, height),
    }));
    return (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st]}>
            <CrowdPath d={arrival.d} width={width} height={height} />
        </Animated.View>
    );
}

/** Smooth start and finish, 0–1. */
function easeInOut(t: number) {
    'worklet';
    return t < 0.5 ? 4 * t * t * t : 1 - ((2 - 2 * t) ** 3) / 2;
}

type Sides = { width: number; height: number; pitch: number; legRight: number; bowlRight: number; bowlBottom: number };

/** A point on the curve from `a` to `b` bowed through `m`, `t` 0–1. */
function bow(a: number, m: number, b: number, t: number) {
    'worklet';
    return (1 - t) * (1 - t) * a + 2 * (1 - t) * t * m + t * t * b;
}

/** A fixed pseudo-random number in 0–1 for `i`, on the UI thread (pCrowd's jitter). */
function rnd(i: number) {
    'worklet';
    const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
}

/**
 * One P in the stream, round and round on the shared clock, on a lap of its
 * own length so the stream never falls into step: it slides out from just
 * inside the P's left side (hidden by the solid P until it clears the edge),
 * arcs forward into its seat growing to full size, sits a while, gets up and
 * arcs on to the right, shrinks back and slips behind the P's right side, then
 * goes round the back. Each lap it takes the next of its own seats (streamer n
 * has seats n, n + STREAMERS, …, so no two share one). It starts at a random
 * point in its first lap's wait, so the stream eases in when the screen opens.
 * Drawn twice: `behind` the solid P for sliding out and slipping back, in
 * front of it from seat to seat; they hand over outside the P, where they look
 * the same.
 */
function Streamer({ n, clock, pool, sides, size, behind }: {
    n: number; clock: SharedValue<number>; pool: SharedValue<{ xs: number[]; ys: number[] }>; sides: Sides; size: number; behind?: boolean;
}) {
    const h = size * (P_H / P_W);
    const st = useAnimatedStyle(() => {
        const { xs, ys } = pool.value;
        const { width, height, pitch, legRight, bowlRight, bowlBottom } = sides;
        const lapLen = LAP_S + LAP_VARY * rnd(n + 1);
        const c = clock.value / lapLen - rnd(n + 51);
        if (!xs.length || c < 0) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
        const lap = Math.floor(c);
        const ph = c - lap;
        const seat = (n + lap * STREAMERS) % xs.length;
        const sx = xs[seat];
        const sy = ys[seat];
        // Out from the leg's left side, near the seat's height; in behind the right side (the bowl's, or the leg's below it).
        const inY = Math.min(0.88 * height, Math.max(0.12 * height, sy + (rnd(n * 31 + lap) - 0.5) * 0.3 * height));
        let outY = Math.min(0.88 * height, Math.max(0.12 * height, sy + (rnd(n * 17 + lap + 7) - 0.5) * 0.3 * height));
        if (Math.abs(outY - bowlBottom) < 0.08 * height) outY = bowlBottom - 0.08 * height;
        const leftX = (height - inY) * SLANT;
        const rightX = (outY < bowlBottom ? bowlRight : legRight) + (height - outY) * SLANT;
        const reach = 0.05 * width;
        let x = 0;
        let y = 0;
        let s = STREAM_FAR;
        let front = false;
        let shown = true;
        // Brighter on the move (so the stream reads), the crowd's own brightness once seated.
        let moving = 1;
        if (ph < LAP_EMERGE) {
            const t = easeInOut(ph / LAP_EMERGE);
            x = leftX + 1.5 * pitch - t * (1.5 * pitch + reach);
            y = inY;
        } else if (ph < LAP_SEAT) {
            const t = easeInOut((ph - LAP_EMERGE) / (LAP_SEAT - LAP_EMERGE));
            const ax = leftX - reach;
            x = bow(ax, (ax + sx) / 2, sx, t);
            y = bow(inY, Math.min(inY, sy) - 0.08 * height, sy, t);
            s = STREAM_FAR + (1 - STREAM_FAR) * t;
            moving = 1 - t;
            front = true;
        } else if (ph < LAP_LEAVE) {
            x = sx;
            y = sy;
            s = 1;
            moving = 0;
            front = true;
        } else if (ph < LAP_HIDE) {
            const t = easeInOut((ph - LAP_LEAVE) / (LAP_HIDE - LAP_LEAVE));
            const bx = rightX + reach;
            x = bow(sx, (sx + bx) / 2, bx, t);
            y = bow(sy, Math.min(sy, outY) - 0.08 * height, outY, t);
            s = 1 - (1 - STREAM_FAR) * t;
            moving = t;
            front = true;
        } else if (ph < LAP_GONE) {
            const t = easeInOut((ph - LAP_HIDE) / (LAP_GONE - LAP_HIDE));
            x = rightX + reach - t * (reach + 1.5 * pitch);
            y = outY;
        } else {
            shown = false;
        }
        const seated = 0.35 + 0.37 * Math.min(1, Math.max(0, y / height));
        const o = seated + (0.92 - seated) * moving;
        return {
            opacity: shown && front !== !!behind ? o : 0,
            transform: [{ translateX: x - (size + 4) / 2 }, { translateY: y - (h + 4) / 2 }, { scale: s }],
        };
    });
    return (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: size + 4, height: h + 4 }, st]}>
            <Svg width={size + 4} height={h + 4}><Path d={glyph(size / 2 + 2, h / 2 + 2, size)} fill={TEXT} /></Svg>
        </Animated.View>
    );
}

/**
 * Beat 1: one share of the empty seats coming forward from round the P, the
 * next a beat later (go 0.04–0.37); they hand over to the gold layer under them.
 */
function Band({ d, band, at, width, height, go }: {
    d: string; band: number; at: [number, number]; width: number; height: number; go: SharedValue<number>;
}) {
    const from = 0.04 + band * 0.045;
    const st = useAnimatedStyle(() => {
        const t = 1 - (1 - interpolate(go.value, [from, from + 0.12], [0, 1], 'clamp')) ** 3;
        return {
            opacity: interpolate(go.value, [from, from + 0.04, 0.38, 0.45], [0, 0.8, 0.8, 0], 'clamp'),
            transform: flight(t, at, width, height),
        };
    });
    return (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st]}>
            <CrowdPath d={d} width={width} height={height} />
        </Animated.View>
    );
}

/** The start line: a light runs along it now and then; at the gun it breaks from the middle. */
function StartLineBar({ go }: { go: SharedValue<number> }) {
    const [w, setW] = useState(0);
    const sweep = useSharedValue(0);
    useEffect(() => {
        sweep.value = withRepeat(withDelay(2200, withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.cubic) })), -1, false);
    }, [sweep]);
    const light = useAnimatedStyle(() => ({
        opacity: interpolate(go.value, [0, 0.05], [1, 0], 'clamp'),
        transform: [{ translateX: interpolate(sweep.value, [0, 1], [-120, w]) }],
    }));
    const halfL = useAnimatedStyle(() => ({ transform: [{ scaleX: interpolate(go.value, [0, 0.18], [1, 0], 'clamp') }] }));
    return (
        <View style={s.line} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
            <Animated.View style={[s.lineHalf, { transformOrigin: 'left' }, halfL]} />
            <Animated.View style={[s.lineHalf, { transformOrigin: 'right' }, halfL]} />
            <Animated.View pointerEvents="none" style={[s.light, light]}>
                <LinearGradient colors={['rgba(255,239,179,0)', 'rgba(255,239,179,0.9)', 'rgba(255,239,179,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
        </View>
    );
}

const s = StyleSheet.create({
    screen: { flex: 1, paddingHorizontal: SIDE, paddingTop: 6, paddingBottom: 14, gap: 12 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

    clock: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', marginTop: 10 },
    unit: { alignItems: 'center', minWidth: 64 },
    num: { fontSize: 46, lineHeight: 52, fontWeight: '200', color: TEXT, letterSpacing: -1, fontVariant: ['tabular-nums'] },
    colon: { fontSize: 34, lineHeight: 48, fontWeight: '200', color: hexA(BUTTER, 0.5), marginHorizontal: 2 },
    unitLabel: { marginTop: 2, fontSize: 8, fontWeight: '600', letterSpacing: 1.6, color: TEXT_3 },
    toWhat: { marginTop: -6, textAlign: 'center', fontSize: 9, fontWeight: '600', letterSpacing: 2.4, color: hexA(BUTTER, 0.75) },

    stage: { flex: 1, justifyContent: 'center', gap: 8 },
    more: { position: 'absolute', right: 0, top: 0, fontSize: 9, fontWeight: '600', letterSpacing: 1.2, color: TEXT_3 },

    line: { height: 2, flexDirection: 'row', overflow: 'hidden', borderRadius: 1 },
    lineHalf: { flex: 1, height: 2, backgroundColor: hexA(BUTTER, 0.55) },
    light: { position: 'absolute', top: 0, bottom: 0, width: 120 },
    lineLabel: { textAlign: 'center', fontSize: 9, fontWeight: '600', letterSpacing: 2, color: TEXT_2 },

    stats: { marginTop: 6 },
    btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, height: 50, borderRadius: 25, backgroundColor: GOLD },
    btnText: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5, color: '#0a0a0a' },
    city: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: -4 },
    cityText: { fontSize: 11, fontWeight: '500', color: TEXT_2 },
    fine: { textAlign: 'center', fontSize: 10, fontWeight: '400', letterSpacing: 0.3, color: TEXT_3 },
});
