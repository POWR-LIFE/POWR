import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
    Easing, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming, ZoomIn,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

import { ActivityIcon } from '@/components/ActivityIcon';
import { HonourIcon, TIER_COLOUR, TIER_STOPS } from '@/components/honours/HonourIcon';
import { Avatar } from '@/components/social/Avatar';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { type Honour, type HonourKind, honourLine, honourName, type HonourTier, tierName } from '@/constants/honours';
import { fontFamily } from '@/constants/tokens';
import { seriesNum } from '@/lib/api/series';
import { firstName, fmt } from '@/lib/dev/seriesPrototype';
import {
    activeDaysTo, type Climb, climbWindow, cumulative, moveKey, OTHER, planPlaces, pointsMix, racePace, racePlan, raceRows, rankAfter, type SeriesPath, spreadClimb, tallyTo,
} from '@/lib/seriesPath';
import { cabinet, nextHonour } from '@/lib/seriesShareCard';
import { GOLD, GREEN, RED, RollNumber, TEXT } from './SeriesLane';
import { Sheet, type SheetLook } from './SeriesSheets';
import { BUTTER, hexA, mixHex, useSeason } from './season';

/*
 * The drawer wears the Series' own materials (the How to win rings, the
 * lockup) in the brand's yellow: the same yellow as your place on the board
 * behind it, never the trophies' warmer gold (Jamie, 20 Nov: "it still needs
 * to be the brand yellow"). Butter for small caps, gradient rings, hairlines
 * instead of boxes and one-colour glyphs. Colour means a person (you = the
 * yellow, them = their medal's metal), never an activity.
 *
 * And it reads at a glance (Jamie, 20 Nov: "as little text as possible …
 * memorable at a glance"): each part is one big number or picture with one
 * short line of caps. The sentences live in the screen-reader labels.
 */
const SOFT = 'rgba(255,255,255,0.64)';
const FAINT = 'rgba(255,255,255,0.4)';
const HAIR = 'rgba(255,255,255,0.09)';
const TRACK = 'rgba(255,255,255,0.07)';
const CREAM = hexA(BUTTER, 0.9);
/** The brand yellow as a ring's gradient: light at the top left, deep at the lower right. */
const YELLOW_STOPS: [string, string, string, string] = ['#FFF4A3', GOLD, '#A89700', '#F1E356'];
type RingTone = HonourTier | 'you';
const stopsOf = (tone: RingTone) => (tone === 'you' ? YELLOW_STOPS : TIER_STOPS[tone]);
/** Their metal beside your yellow: silver, bronze, and platinum for the leader. */
const rivalTier = (rank: number | null): HonourTier => (rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'platinum');
const rivalColour = (rank: number | null) => TIER_COLOUR[rivalTier(rank)];
/** The shares of a ring, biggest first: the yellow, then butter and greys, not a colour per activity. */
const MIX_TONES = [GOLD, '#D9D2BC', 'rgba(255,255,255,0.42)', 'rgba(255,255,255,0.2)'];
/** Activities the copy has words for; anything else reads as "other". */
const known = moveKey;
/** The most one session of each pays (claim-points calcBasePoints' top tier): the "ways to earn" row. */
const TOP_PTS: Record<string, number> = { gym: 20, hiit: 20, running: 10, cycling: 10, swimming: 10, sports: 10, dance: 8, yoga: 6, walking: 5 };
const EARN_DEFAULT = ['gym', 'walking', 'running', 'cycling'];
/** The trophies, in the order the cabinet lists them down the card. */
const TROPHY_ORDER: HonourKind[] = ['king', 'on_fire', 'power', 'diamond', 'wings', 'hive', 'strength'];
/** The plan as tokens: two rows of seven before a "+n". */
const MAX_TOKENS = 14;
const PLAN_AT = 600;

const cfgOf = (type: string) => (type in ACTIVITIES ? ACTIVITIES[type as ActivityType] : null);

/** An activity's glyph, drawn as a fine outline in one colour. */
function ActGlyph({ type, size, colour = CREAM }: { type: string; size: number; colour?: string }) {
    const cfg = cfgOf(type);
    if (!cfg) return <Ionicons name="ellipsis-horizontal" size={size} color={colour} />;
    return <ActivityIcon activity={cfg} size={size} color={colour} active={false} />;
}

let ringSeq = 0;
/** A gradient ring (the How to win places wear the same): yours in the brand yellow, theirs in their metal. */
function MetalRing({ size, tier, stroke = 1.6, dim = false, wash = false, children }: {
    size: number; tier: RingTone; stroke?: number; dim?: boolean; wash?: boolean; children?: React.ReactNode;
}) {
    const id = useRef(`pr${++ringSeq}`).current;
    const [a, b, c, d] = stopsOf(tier);
    const r = size / 2 - stroke;
    return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={size} height={size} style={[StyleSheet.absoluteFill, dim && { opacity: 0.32 }]}>
                <Defs>
                    <SvgGradient id={id} x1="0" y1="0" x2={String(size)} y2={String(size)} gradientUnits="userSpaceOnUse">
                        <Stop offset="0" stopColor={a} />
                        <Stop offset="0.38" stopColor={b} />
                        <Stop offset="0.7" stopColor={c} />
                        <Stop offset="1" stopColor={d} />
                    </SvgGradient>
                </Defs>
                {wash && <Circle cx={size / 2} cy={size / 2} r={r} fill={b} opacity={0.13} />}
                <Circle cx={size / 2} cy={size / 2} r={r} stroke={`url(#${id})`} strokeWidth={stroke} fill="none" />
            </Svg>
            {children}
        </View>
    );
}

/** A number that counts up from zero when its part of the card comes up. */
function CountUp({ value, style }: { value: number; style: object }) {
    const [v, setV] = useState(0);
    useEffect(() => {
        const tm = setTimeout(() => setV(value), 150);
        return () => clearTimeout(tm);
    }, [value]);
    return <RollNumber value={v} style={style} />;
}

/** Something that wipes in from the left: a chart drawing, a bar filling. */
function Reveal({ width, height, delay = 0, ms = 1300, children }: { width: number; height: number; delay?: number; ms?: number; children: React.ReactNode }) {
    const w = useSharedValue(0);
    useEffect(() => {
        w.value = 0;
        w.value = withDelay(delay, withTiming(width, { duration: ms, easing: Easing.out(Easing.cubic) }));
    }, [w, width, delay, ms]);
    const st = useAnimatedStyle(() => ({ width: w.value }));
    return <Animated.View style={[{ height, overflow: 'hidden' }, st]}>{children}</Animated.View>;
}

/** Where a day sits across the chart: shared by the lines and the active-day dots under them. */
const chartX = (width: number, days: number, gap: boolean) => {
    const padX = 6;
    const padR = gap ? 30 : 6;
    return { padX, padR, x: (i: number) => padX + (i / Math.max(1, days)) * (width - padX - padR) };
};

/**
 * Your points and theirs through the round, day by day: where the gap opened.
 * Each line carries a soft wash under it; the dashed drop at today's edge is
 * the gap, with its number on it.
 */
function GapChart({ a, b, aColour, bColour, width, height, gap, ground }: {
    a: number[]; b: number[] | null; aColour: string; bColour: string; width: number; height: number;
    /** Theirs minus yours today; null draws no gap mark. */
    gap: number | null;
    /** The sheet's colour, so the gap's label sits cleanly over the lines. */
    ground: string;
}) {
    const days = a.length - 1;
    const max = Math.max(1, ...a, ...(b ?? []));
    const { padX, padR, x } = chartX(width, days, gap != null && gap !== 0);
    const top = 10;
    const base = height - 6;
    const y = (v: number) => base - (v / max) * (base - top);
    const line = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = (arr: number[]) => `${line(arr)} L${x(days).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`;
    if (width <= 0) return <View style={{ height }} />;
    const ya = y(a[days]);
    const yb = b ? y(b[days]) : ya;
    const showGap = gap != null && gap !== 0 && Math.abs(ya - yb) > 18;
    return (
        <View style={{ width, height }}>
            {/* The days: a faint rule each, and the ground line. */}
            <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
                {Array.from({ length: days }, (_, i) => (
                    <Line key={i} x1={x(i + 1)} x2={x(i + 1)} y1={top} y2={base} stroke="rgba(255,255,255,0.045)" strokeWidth={1} />
                ))}
                <Line x1={padX} x2={width - padR} y1={base} y2={base} stroke={HAIR} strokeWidth={1} />
            </Svg>
            <Reveal width={width} height={height} delay={250} ms={1400}>
                <Svg width={width} height={height}>
                    <Defs>
                        <SvgGradient id="washA" x1="0" y1="0" x2="0" y2="1">
                            <Stop offset="0" stopColor={aColour} stopOpacity={0.24} />
                            <Stop offset="1" stopColor={aColour} stopOpacity={0} />
                        </SvgGradient>
                        <SvgGradient id="washB" x1="0" y1="0" x2="0" y2="1">
                            <Stop offset="0" stopColor={bColour} stopOpacity={0.16} />
                            <Stop offset="1" stopColor={bColour} stopOpacity={0} />
                        </SvgGradient>
                    </Defs>
                    {b && <Path d={area(b)} fill="url(#washB)" />}
                    <Path d={area(a)} fill="url(#washA)" />
                    {b && <Path d={line(b)} stroke={bColour} strokeWidth={1.8} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
                    <Path d={line(a)} stroke={aColour} strokeWidth={1.8} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                    {showGap && (
                        <Line x1={x(days)} x2={x(days)} y1={Math.min(ya, yb) + 7} y2={Math.max(ya, yb) - 7} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="2 3" />
                    )}
                    {b && <Circle cx={x(days)} cy={yb} r={6.5} fill={bColour} opacity={0.2} />}
                    {b && <Circle cx={x(days)} cy={yb} r={3} fill={bColour} />}
                    <Circle cx={x(days)} cy={ya} r={6.5} fill={aColour} opacity={0.2} />
                    <Circle cx={x(days)} cy={ya} r={3} fill={aColour} />
                </Svg>
            </Reveal>
            {showGap && gap != null && (
                <Animated.View
                    entering={FadeIn.duration(300).delay(1500)}
                    style={[s.gapPill, { top: (ya + yb) / 2 - 10, backgroundColor: ground }]}
                >
                    <Ionicons name={gap > 0 ? 'caret-down' : 'caret-up'} size={8} color={gap > 0 ? RED : GREEN} />
                    <Text style={[s.gapPillText, { color: gap > 0 ? RED : GREEN }]}>{fmt(Math.abs(gap))}</Text>
                </Animated.View>
            )}
        </View>
    );
}

/** Where their points came from, as a fine ring: the biggest share named in the middle. */
function MixRing({ mix, size, label }: { mix: { type: string; pts: number; pct: number }[]; size: number; label: (type: string) => string }) {
    const stroke = 6;
    const r = (size - stroke) / 2;
    const c = size / 2;
    const circ = 2 * Math.PI * r;
    const total = mix.reduce((n, m) => n + m.pts, 0) || 1;
    let at = 0;
    const lead = mix[0];
    return (
        <View style={{ width: size, height: size }}>
            <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
                <Circle cx={c} cy={c} r={r} stroke={TRACK} strokeWidth={stroke} fill="none" />
            </Svg>
            {mix.map((m, i) => {
                const len = Math.max(0, (m.pts / total) * circ - (mix.length > 1 ? 4 : 0));
                const start = at;
                at += (m.pts / total) * circ;
                return (
                    <Animated.View key={m.type} entering={FadeIn.duration(320).delay(200 + i * 190)} style={StyleSheet.absoluteFill}>
                        <Svg width={size} height={size}>
                            <Circle
                                cx={c} cy={c} r={r} fill="none" stroke={MIX_TONES[Math.min(i, MIX_TONES.length - 1)]} strokeWidth={stroke} strokeLinecap="round"
                                strokeDasharray={`${Math.max(0.1, len - stroke)} ${circ - Math.max(0.1, len - stroke)}`} strokeDashoffset={-(start + stroke / 2)}
                                transform={`rotate(-90 ${c} ${c})`}
                            />
                        </Svg>
                    </Animated.View>
                );
            })}
            {lead && (
                <Animated.View entering={ZoomIn.duration(320).delay(300)} style={s.ringMid}>
                    <ActGlyph type={lead.type} size={18} colour={GOLD} />
                    <Text style={s.ringPct}>{lead.pct}<Text style={s.ringPctSign}>%</Text></Text>
                    <Text style={s.ringLabel} numberOfLines={1}>{label(lead.type)}</Text>
                </Animated.View>
            )}
        </View>
    );
}

/**
 * The climb: the board as a line, the top at the right. Your dot steps up it
 * a session at a time, from where you are to where three would put you. The
 * line is the whole board unless the climb would be too small to see on it
 * (climbWindow).
 */
function ClimbTrack({ width, from, to, total, stepMs }: { width: number; from: number; to: number[]; total: number; stepMs: number }) {
    const { t } = useTranslation();
    const pad = 8;
    const end = to[to.length - 1] ?? from;
    // Near the top a climb is a sliver of the whole board: close in until it shows.
    const low = climbWindow(from, end, total);
    const x = (r: number) => pad + (1 - (Math.min(low, Math.max(1, r)) - 1) / Math.max(1, low - 1)) * (width - pad * 2);
    // ...and never draw the two dots on top of each other.
    const { x0, xs } = spreadClimb(x(from), to.map(x), width - pad);
    const at = useSharedValue(x0);
    useEffect(() => {
        at.value = x0;
        if (xs.length === 0) return;
        at.value = withDelay(PLAN_AT, withSequence(
            ...xs.map((px, k) => withDelay(k ? Math.max(0, stepMs - 360) : 0, withTiming(px, { duration: 360, easing: Easing.out(Easing.cubic) }))),
        ));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [at, x0, xs.join(','), width, low]);
    const dot = useAnimatedStyle(() => ({ transform: [{ translateX: at.value - 7 }] }));
    const trail = useAnimatedStyle(() => ({ left: x0, width: Math.max(0, at.value - x0) }));
    return (
        <View style={{ width, marginTop: 22 }}>
            <View style={s.climbTop}>
                <Text style={s.climbTopText}>{t('series:path.top3')}</Text>
            </View>
            <View style={s.climbLine}>
                <View style={s.climbRail} />
                <Animated.View style={[s.climbTrail, trail]} />
                <View style={s.climbEnd} />
                <View style={[s.climbStart, { left: x0 - 3 }]} />
                <Animated.View style={[s.climbDot, dot]} />
            </View>
            <View style={s.climbLabels}>
                <Text style={s.caps}>#{fmt(from)}</Text>
                <Animated.Text entering={FadeIn.duration(300).delay(PLAN_AT + to.length * stepMs)} style={[s.caps, { color: GOLD }]}>
                    #{fmt(end)}
                </Animated.Text>
            </View>
        </View>
    );
}

/** A trophy's pieces for one of you, bronze to platinum: lit in their metal once held, ghosted before. */
function Pieces({ kind, slots, delay }: { kind: HonourKind; slots: ({ tier: Honour['tier']; earned: boolean } | null)[]; delay: number }) {
    // The cabinet lists a column top to bottom, platinum first: here it reads left to right, bronze first.
    const row = slots.filter((x): x is { tier: Honour['tier']; earned: boolean } => !!x).reverse();
    return (
        <View style={s.pieces}>
            {row.map((p, i) => (
                p.earned
                    ? <Animated.View key={p.tier} entering={ZoomIn.duration(260).delay(delay + i * 70)}><HonourIcon kind={kind} tier={p.tier} size={19} /></Animated.View>
                    : <HonourIcon key={p.tier} kind={kind} tier={p.tier} size={19} color="rgba(255,255,255,0.11)" />
            ))}
        </View>
    );
}

export type PathSide = {
    path: SeriesPath | null;
    name: string;
    flag?: string;
    avatarUrl?: string | null;
    /** Their place on the board; null hides it (Blind Mode). */
    rank: number | null;
    /** The trophies they hold (the board's rows carry them). */
    honours?: Honour[];
};

export type PathSection = 'catch' | 'difference' | 'trophies';
const SECTIONS: PathSection[] = ['catch', 'difference', 'trophies'];

/**
 * You against one member of the podium, in one drawer you read down at a
 * glance: 01 the move (one big number: the extra sessions that finish you
 * ahead at both your paces, or the places one session climbs when that's out
 * of reach), you and them on one bar, and what earns; 02 the difference
 * (where their points come from, your sessions beside theirs, how the gap
 * opened and who moved each day); 03 the trophies you each hold and your
 * next. Each part plays as it comes into view. Almost no sentences: they're
 * in the screen-reader labels. Nothing on it leads elsewhere. Once the round
 * is over there's no move to make: the first part is where you finished.
 */
export function SeriesPathSheet({
    visible, onClose, you, rival, rivals, onRival, day, daysLeft, climb, boardTotal, ended, onSeen,
}: {
    visible: boolean;
    onClose: () => void;
    /** You, when you're in the round. */
    you: PathSide | null;
    /** Who you're comparing with (a podium member). */
    rival: PathSide | null;
    /** The podium you can switch to, by rank. */
    rivals: { id: string; rank: number; name: string }[];
    onRival: (id: string) => void;
    /** Days of the round so far (the chart's last day). */
    day: number;
    /** Days still to play, today included: paces the plan. */
    daysLeft: number;
    /** Where more points would put you on the board (null: unknown, or Blind Mode). */
    climb: Climb | null;
    /** How many are on the board (the climb's line runs from last to first). */
    boardTotal: number;
    /** The round is over: no move left to make. */
    ended: boolean;
    /** A part of the card came into view for the first time since it opened. */
    onSeen?: (section: PathSection) => void;
}) {
    const { t } = useTranslation();
    const { tint } = useSeason();
    const look: SheetLook | undefined = tint
        ? { bg: mixHex(tint.ground, '#101010', 0.34), glow: mixHex(tint.ground, '#FFFFFF', 0.3), glowOpacity: 0.3, radius: 30, tall: true }
        : undefined;
    const ground = look?.bg ?? '#141414';

    const them = rival ?? null;
    const mine = useMemo(() => tallyTo(you?.path, Infinity), [you?.path]);
    const theirs = useMemo(() => tallyTo(them?.path, Infinity), [them?.path]);
    const race = !!you && !!them;
    const rows = useMemo(() => raceRows(mine, theirs).filter((r) => r.type !== OTHER).slice(0, 3), [mine, theirs]);
    const mix = useMemo(() => pointsMix(theirs), [theirs]);
    const name = them ? firstName(them.name) : '';
    const rTier = rivalTier(them?.rank ?? null);
    const rColour = rivalColour(them?.rank ?? null);
    const days = Math.max(1, day);
    const lineA = useMemo(() => cumulative(you?.path, days), [you?.path, days]);
    const lineB = useMemo(() => cumulative(them?.path, days), [them?.path, days]);
    const plan = race && !ended ? racePlan(mine, theirs, days, daysLeft) : null;

    // ── each part plays when it comes into view ──
    const [w, setW] = useState(0);
    const [visit, setVisit] = useState(0);
    const view = useRef({ y: 0, h: 0 });
    const tops = useRef<Record<PathSection, number>>({ catch: 0, difference: Number.POSITIVE_INFINITY, trophies: Number.POSITIVE_INFINITY });
    const [shown, setShown] = useState<Record<PathSection, boolean>>({ catch: true, difference: false, trophies: false });
    const check = useCallback(() => {
        const { y, h } = view.current;
        if (h <= 0) return;
        const edge = y + h - 90;
        setShown((was) => {
            let next = was;
            for (const k of SECTIONS) if (!was[k] && tops.current[k] < edge) next = { ...next, [k]: true };
            return next;
        });
    }, []);
    const onScrollY = useCallback((y: number, h: number) => { view.current = { y, h }; check(); }, [check]);
    // A fresh start whenever it opens or the rival changes.
    const who = `${you?.path?.user_id ?? ''}|${them?.path?.user_id ?? ''}`;
    const seen = useRef(new Set<PathSection>());
    useEffect(() => {
        if (!visible) return;
        seen.current = new Set();
        view.current = { y: 0, h: view.current.h };
        setShown({ catch: true, difference: false, trophies: false });
        setVisit((v) => v + 1);
        // What already fits on screen plays straight away.
        const tm = setTimeout(check, 350);
        return () => clearTimeout(tm);
    }, [visible, who, check]);
    useEffect(() => {
        if (!visible) return;
        for (const k of SECTIONS) {
            if (shown[k] && !seen.current.has(k)) { seen.current.add(k); onSeen?.(k); }
        }
    }, [visible, shown, onSeen]);
    const place = (k: PathSection) => (e: { nativeEvent: { layout: { y: number } } }) => { tops.current[k] = e.nativeEvent.layout.y; check(); };
    const keyOf = (k: PathSection) => `${k}-${visit}-${shown[k] ? 1 : 0}`;

    // ── the words: few on screen, the full sentences for a screen reader ──
    const plain = (key: string, vals: Record<string, unknown>) => t(`series:path.${key}`, vals).replace(/<\/?g>/g, '');
    const shortLabel = (type: string) => (type === OTHER ? t('series:path.rows.other') : cfgOf(type)?.labelShort ?? type).toUpperCase();
    const sessionsText = (type: string, n: number) => t(`series:path.moves.${known(type)}`, { count: n });
    /** "gym visits" / "gym visit": the sessions line without its number. */
    const noun = (type: string, n: number) => sessionsText(type, n).replace(/^[\d\s.,  ]+/, '');
    const gapNow = race ? theirs.total - mine.total : 0;
    const gapKey = !race ? 'has' : `${gapNow > 0 ? 'behind' : gapNow < 0 ? 'ahead' : 'level'}${ended ? 'End' : ''}`;
    const gapSentence = plain(gapKey, { name, n: fmt(race ? Math.abs(gapNow) : theirs.total) });

    const planType = plan && plan.kind !== 'ahead' ? plan.type : null;
    const per = plan && plan.kind !== 'ahead' ? Math.round(plan.per) : 0;
    const stepPlaces = planPlaces(plan, climb);
    const climbing = plan?.kind === 'climb' && stepPlaces > 0;
    const pace = plan?.kind === 'finish' ? racePace(plan.sessions, daysLeft, plan.type) : null;
    const left = t('series:path.daysLeftCount', { count: Math.max(1, daysLeft) });
    const paceText = !pace || pace.kind === 'tooMany' ? ''
        : pace.kind === 'every' ? `${t('series:path.pace.every', { n: pace.days })} · ${left}`
            : pace.kind === 'daily' ? `${t('series:path.pace.daily')} · ${left}`
                : `${t('series:path.pace.perDay', { n: pace.n })} · ${left}`;

    // The part's one big number, and its line of caps.
    const hero: { glyph: string | null; mark: 'about' | 'up' | 'plus' | null; n: number; caps: string; tone: string } = plan?.kind === 'finish'
        ? { glyph: plan.type, mark: 'about', n: plan.sessions, caps: t('series:path.heroFinish', { what: noun(plan.type, plan.sessions), name }), tone: GOLD }
        : climbing && plan?.kind === 'climb'
            ? { glyph: plan.type, mark: 'up', n: stepPlaces, caps: t('series:path.heroClimb', { what: noun(plan.type, 1) }), tone: GOLD }
            : plan?.kind === 'ahead'
                ? { glyph: null, mark: 'plus', n: plan.lead, caps: t('series:path.heroAhead', { name }), tone: GREEN }
                : { glyph: null, mark: null, n: Math.abs(gapNow) || theirs.total, caps: t(`series:path.${gapNow > 0 ? 'endBehind' : gapNow < 0 ? 'heroAhead' : race ? 'endLevel' : 'heroHas'}`, { name }), tone: gapNow < 0 ? GREEN : GOLD };
    const finishKey = them?.rank === 1 ? 'finish1' : them?.rank === 2 ? 'finish2' : them?.rank === 3 ? 'finish3' : 'finish';
    const moveSentence = plan?.kind === 'finish' ? `${sessionsText(plan.type, plan.sessions)} ${t(`series:path.${finishKey}`, { name })}. ${t('series:path.projNote')}`
        : climbing && plan?.kind === 'climb' ? `${sessionsText(plan.type, 1)} ${plain('climbTail', { count: stepPlaces, n: fmt(stepPlaces) })}`
            : plan?.kind === 'ahead' ? `${t('series:path.keepUp')}. ${t('series:path.lead', { name, n: fmt(plan.lead) })}`
                : gapSentence;

    // The plan as tokens: one per session, lighting in turn.
    const tokens = plan?.kind === 'finish' ? Math.min(plan.sessions, MAX_TOKENS) : 0;
    const stepMs = tokens > 8 ? 190 : tokens > 4 ? 300 : 460;
    const climbSteps = climbing && climb ? [1, 2, 3].map((k) => rankAfter(climb, per * k)) : [];

    // Ways to earn: the move's activity first, then what they do, then the everyday ones.
    const earn = useMemo(() => {
        const theirTypes = Object.entries(theirs.pts).sort((a, b) => b[1] - a[1]).map(([k]) => k);
        const list = [...(planType ? [planType] : []), ...theirTypes, ...EARN_DEFAULT].filter((k) => k in TOP_PTS);
        return [...new Set(list)].slice(0, 4);
    }, [theirs, planType]);

    // A tick in the hand as each token lights (every other one when there are many).
    useEffect(() => {
        if (!visible || tokens === 0 || Platform.OS === 'web') return undefined;
        const every = tokens > 8 ? 2 : 1;
        const tms = Array.from({ length: Math.ceil(tokens / every) }, (_, k) => setTimeout(() => { void Haptics.selectionAsync().catch(() => undefined); }, PLAN_AT + k * every * stepMs));
        return () => tms.forEach(clearTimeout);
    }, [visible, visit, tokens, stepMs]);

    const person = (side: PathSide, id: string) => ({ id, username: '', displayName: side.name, status: 'accepted' as const, avatarUrl: side.avatarUrl ?? null });
    const aDays = activeDaysTo(you?.path, days);
    const bDays = activeDaysTo(them?.path, days);
    const activeOn = (side: PathSide | null, d: number) => !!side?.path?.days.some((x) => x.day === d && x.pts > 0);

    // You and them on one bar: the longer total fills it, the other marks how far along they are.
    const vsMax = Math.max(1, mine.total, theirs.total);
    const barW = Math.max(0, w - 2 * 58);
    const geo = chartX(w, days, race && gapNow !== 0);

    // ── trophies ──
    const cabA = useMemo(() => cabinet(you?.honours ?? []), [you?.honours]);
    const cabB = useMemo(() => cabinet(them?.honours ?? []), [them?.honours]);
    const next = you ? nextHonour(you.honours ?? []) : null;
    const nextLine = !next ? ''
        : next.unit === 'top' ? t('series:shareCard.progress.top')
            : next.have == null || next.have <= 0 || !next.unit ? honourLine(next.kind)
                : t(`series:shareCard.progress.${next.unit}`, { have: seriesNum(next.have), need: seriesNum(next.need) });
    // A part's heading: its number, its name, and a hairline running out to the edge.
    const kick = (n: string, text: string) => (
        <View style={s.kickRow}>
            <Text style={s.kickNo}>{n}</Text>
            <Text style={s.kicker} numberOfLines={1}>{text}</Text>
            <View style={s.kickRule} />
        </View>
    );
    const end = (side: PathSide, tier: RingTone, colour: string, isYou: boolean) => (
        <View style={s.vsEnd}>
            <MetalRing size={38} tier={tier} stroke={1.5}>
                <Avatar friend={person(side, isYou ? 'you' : side.path?.user_id ?? side.name)} size={30} />
            </MetalRing>
            <Text style={[s.vsName, { color: colour }]} numberOfLines={1}>{isYou ? t('series:path.you') : firstName(side.name).toUpperCase()}</Text>
        </View>
    );
    const dots = (side: PathSide, colour: string, n: number) => (
        <View style={s.dotRow}>
            {Array.from({ length: days }, (_, i) => (
                <View key={i} style={[s.dayDot, { left: geo.x(i + 1) - 3.5 }, activeOn(side, i + 1) ? { backgroundColor: colour } : s.dayDotOff]} />
            ))}
            {/* Yours shows once there's a day to count: never 0/5. */}
            {n > 0 && <Text style={[s.dotCount, { color: colour }]}>{n}<Text style={{ color: FAINT }}>/{days}</Text></Text>}
        </View>
    );

    return (
        <Sheet visible={visible} onClose={onClose} look={look} onScrollY={onScrollY}>
            {/* Who you're set against: anyone on the podium. */}
            <View style={s.top} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
                <View style={s.chips}>
                    {race && rivals.length > 1 && rivals.map((r) => {
                        const on = r.rank === them?.rank;
                        return (
                            <Pressable
                                key={r.id}
                                onPress={() => { if (on) return; void Haptics.selectionAsync(); onRival(r.id); }}
                                hitSlop={4}
                                style={[s.chip, on && s.chipOn]}
                                accessibilityRole="button"
                                accessibilityState={{ selected: on }}
                                accessibilityLabel={t('series:path.open', { name: firstName(r.name) })}
                            >
                                <Text style={[s.chipNo, on && { color: GOLD }]}>#{r.rank}</Text>
                                <Text style={[s.chipText, on && { color: TEXT }]} numberOfLines={1}>{firstName(r.name)}</Text>
                            </Pressable>
                        );
                    })}
                </View>
                <Pressable
                    onPress={onClose}
                    hitSlop={8}
                    style={({ pressed }) => [s.close, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('series:sheets.close')}
                >
                    <Ionicons name="close" size={18} color={TEXT} />
                </Pressable>
            </View>

            {/* 01 · The move: one number, you and them on a bar, what earns. */}
            <View key={keyOf('catch')} style={s.section} onLayout={place('catch')}>
                {kick('01', t(`series:path.kicker.${ended ? 'ended' : plan?.kind === 'ahead' ? 'ahead' : 'catch'}`, { name: name.toUpperCase() }))}

                <View accessible accessibilityRole="header" accessibilityLabel={moveSentence}>
                    <View style={s.hero}>
                        {hero.glyph && (
                            <MetalRing size={38} tier="you" stroke={1.4} wash>
                                <ActGlyph type={hero.glyph} size={17} colour={GOLD} />
                            </MetalRing>
                        )}
                        <View style={s.heroFigure}>
                            {hero.mark === 'about' && <Text style={[s.heroMark, { color: hexA(GOLD, 0.6) }]}>≈</Text>}
                            {hero.mark === 'up' && <Ionicons name="caret-up" size={12} color={GOLD} style={{ marginBottom: 8, marginRight: 2 }} />}
                            {hero.mark === 'plus' && <Text style={[s.heroMark, { color: hero.tone }]}>+</Text>}
                            <CountUp value={hero.n} style={[s.heroNum, { color: hero.tone }]} />
                        </View>
                    </View>
                    <Text style={s.heroCaps}>{hero.caps}</Text>
                </View>

                {/* You and them on one bar. */}
                {you && them && (
                    <View style={s.vs} accessible accessibilityLabel={gapSentence}>
                        {end(you, 'you', GOLD, true)}
                        <View style={s.vsMid}>
                            <View style={s.vsNums}>
                                {/* Never a 0: your number shows from your first points. */}
                                {mine.total > 0 ? <CountUp value={mine.total} style={[s.vsNum, { color: GOLD }]} /> : <View />}
                                <CountUp value={theirs.total} style={[s.vsNum, { color: rColour }]} />
                            </View>
                            <View style={s.vsTrack}>
                                <View style={[s.vsThem, { width: (theirs.total / vsMax) * barW, backgroundColor: hexA(rColour, 0.28) }]} />
                                <Reveal width={(mine.total / vsMax) * barW} height={6} delay={200} ms={900}>
                                    <LinearGradient colors={[YELLOW_STOPS[2], GOLD, YELLOW_STOPS[3]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: (mine.total / vsMax) * barW, height: 6, borderRadius: 3 }} />
                                </Reveal>
                            </View>
                        </View>
                        {end(them, rTier, rColour, false)}
                    </View>
                )}

                {/* The plan, a token a session, lighting in turn. */}
                {plan?.kind === 'finish' && tokens > 0 && (
                    <View style={s.tokens} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                        {Array.from({ length: tokens }, (_, k) => (
                            <View key={k} style={s.token}>
                                <MetalRing size={34} tier="you" stroke={1.1} dim>
                                    <ActGlyph type={plan.type} size={14} colour="rgba(255,255,255,0.26)" />
                                </MetalRing>
                                <Animated.View entering={ZoomIn.duration(240).delay(PLAN_AT + k * stepMs)} style={StyleSheet.absoluteFill}>
                                    <MetalRing size={34} tier="you" stroke={1.4} wash>
                                        <ActGlyph type={plan.type} size={14} colour={GOLD} />
                                    </MetalRing>
                                </Animated.View>
                            </View>
                        ))}
                        {plan.sessions > tokens && <Text style={s.tokenMore}>+{plan.sessions - tokens}</Text>}
                    </View>
                )}

                {/* The climb: your dot stepping up the board. */}
                {climbing && climb && w > 0 && (
                    <ClimbTrack width={w} from={climb.rank} to={climbSteps} total={Math.max(boardTotal, climb.rank)} stepMs={520} />
                )}

                {/* Two facts, said in a glance: how often, and what each one is worth in places. */}
                {plan && plan.kind !== 'ahead' && (
                    <Animated.View entering={FadeIn.duration(320).delay(PLAN_AT + tokens * stepMs + 150)} style={s.pills}>
                        {plan.kind === 'finish' && !!paceText && (
                            <View style={s.pill}>
                                <Ionicons name="calendar-outline" size={12} color={GOLD} />
                                <Text style={s.caps}>{paceText}</Text>
                            </View>
                        )}
                        {plan.kind === 'finish' && stepPlaces > 0 && (
                            <View style={s.pill}>
                                <Ionicons name="trending-up-outline" size={13} color={GOLD} />
                                <Text style={s.caps}>{t('series:path.eachUp', { n: fmt(stepPlaces) })}</Text>
                            </View>
                        )}
                        {plan.kind === 'climb' && (
                            <View style={s.pill}>
                                <Ionicons name="speedometer-outline" size={12} color={rColour} />
                                <Text style={s.caps}>{t('series:path.themPerDay', { name, n: fmt(plan.themRate) })}</Text>
                            </View>
                        )}
                    </Animated.View>
                )}

                {/* What earns: the most a session of each pays, the move's own lit. */}
                {!ended && (
                    <View style={s.earn}>
                        <Text style={s.label}>{t('series:path.earnLabel')}</Text>
                        <View style={s.earnRow}>
                            {earn.map((type, i) => {
                                const lit = type === planType;
                                return (
                                    <Animated.View
                                        key={type}
                                        entering={FadeInDown.duration(260).delay(200 + i * 110)}
                                        style={s.earnCol}
                                        accessible
                                        accessibilityLabel={`${cfgOf(type)?.label ?? type}: +${TOP_PTS[type]}`}
                                    >
                                        <MetalRing size={50} tier="you" stroke={lit ? 1.6 : 1} dim={!lit} wash={lit}>
                                            <ActGlyph type={type} size={20} colour={lit ? GOLD : SOFT} />
                                        </MetalRing>
                                        <Text style={[s.earnPts, lit && { color: GOLD }]}>+{TOP_PTS[type]}</Text>
                                        <Text style={s.earnName} numberOfLines={1}>{(cfgOf(type)?.labelShort ?? type).toUpperCase()}</Text>
                                    </Animated.View>
                                );
                            })}
                        </View>
                    </View>
                )}
            </View>

            {/* 02 · The difference: where their points come from, your sessions beside theirs, how the gap opened. */}
            <View key={keyOf('difference')} style={[s.section, s.sectionGap]} onLayout={place('difference')}>
                {kick('02', t('series:path.kicker.difference'))}

                <View style={s.mix}>
                    <View accessible accessibilityLabel={`${name}: ${mix.map((m) => `${shortLabel(m.type)} ${m.pct}%`).join(', ')}`}>
                        <MixRing mix={mix} size={124} label={shortLabel} />
                    </View>
                    <View style={s.cmp}>
                        <View style={s.cmpHead}>
                            <View style={{ flex: 1 }} />
                            {race && <Text style={[s.cmpColHead, { color: GOLD }]}>{t('series:path.you')}</Text>}
                            <Text style={[s.cmpColHead, { color: rColour }]} numberOfLines={1}>{name.toUpperCase()}</Text>
                        </View>
                        {rows.map((r, i) => {
                            const focus = planType === r.type;
                            return (
                                <Animated.View
                                    key={r.type}
                                    entering={FadeInDown.duration(280).delay(400 + i * 150)}
                                    style={[s.cmpRow, s.rowRule]}
                                    accessible
                                    accessibilityLabel={`${t(`series:path.rows.${known(r.type)}`)}: ${race ? `${t('series:path.you')} ${r.a.n}, ` : ''}${name} ${r.b.n}`}
                                >
                                    <ActGlyph type={r.type} size={17} colour={focus ? GOLD : SOFT} />
                                    <Text style={[s.cmpLabel, focus && { color: TEXT }]} numberOfLines={1}>{shortLabel(r.type)}</Text>
                                    {race && (
                                        <View style={s.cmpCol}>
                                            {/* Where you do more than them, a green mark: it isn't all catching up. */}
                                            {r.a.n > r.b.n && <Ionicons name="caret-up" size={9} color={GREEN} />}
                                            <Text style={[s.cmpNum, { color: r.a.n ? GOLD : FAINT }]}>{r.a.n ? fmt(r.a.n) : '·'}</Text>
                                        </View>
                                    )}
                                    <View style={s.cmpCol}>
                                        <Text style={[s.cmpNum, { color: r.b.n ? rColour : FAINT }]}>{r.b.n ? fmt(r.b.n) : '·'}</Text>
                                    </View>
                                </Animated.View>
                            );
                        })}
                    </View>
                </View>

                {/* How the gap opened, and who moved each day under it. */}
                <View
                    style={s.block}
                    accessible
                    accessibilityLabel={race && aDays > 0
                        ? `${gapSentence}. ${t('series:path.activeLabel')}: ${t('series:path.activeYou', { n: aDays, of: days })}, ${t('series:path.activeThem', { name, n: bDays, of: days })}`
                        : gapSentence}
                >
                    <GapChart
                        a={lineA} b={them && race ? lineB : null} aColour={race ? GOLD : rColour} bColour={rColour}
                        width={w} height={104} gap={race ? gapNow : null} ground={ground}
                    />
                    {race && you && them && (
                        <View style={s.dotsBlock}>
                            {dots(you, GOLD, aDays)}
                            {dots(them, rColour, bDays)}
                        </View>
                    )}
                </View>
            </View>

            {/* 03 · Trophies: what each of you holds, piece by piece, and the next one for you. */}
            {race && you && them && (
                <View key={keyOf('trophies')} style={[s.section, s.sectionGap]} onLayout={place('trophies')}>
                    {kick('03', t('series:path.kicker.trophies'))}
                    <View style={s.cab}>
                        <View style={s.cabHead}>
                            <View style={{ flex: 1 }} />
                            <Text style={[s.cabCol, s.cabColHead, { color: GOLD }]} numberOfLines={1}>
                                {/* Never 0/25: your count shows once you hold a piece. */}
                                {cabA.earned > 0 ? t('series:path.trophyCount', { name: t('series:path.you'), n: cabA.earned, of: cabA.total }) : t('series:path.you')}
                            </Text>
                            <Text style={[s.cabCol, s.cabColHead, { color: rColour }]} numberOfLines={1}>
                                {cabB.earned > 0 ? t('series:path.trophyCount', { name: name.toUpperCase(), n: cabB.earned, of: cabB.total }) : name.toUpperCase()}
                            </Text>
                        </View>
                        {TROPHY_ORDER.map((kind, i) => {
                            const a = cabA.columns.find((c) => c.kind === kind);
                            const b = cabB.columns.find((c) => c.kind === kind);
                            if (!a || !b) return null;
                            return (
                                <View key={kind} style={[s.cabRow, s.rowRule]}>
                                    <Text style={[s.cabName, (a.any || b.any) && { color: TEXT }]} numberOfLines={1}>{honourName(kind)}</Text>
                                    <View style={s.cabCol}><Pieces kind={kind} slots={a.slots} delay={200 + i * 90} /></View>
                                    <View style={s.cabCol}><Pieces kind={kind} slots={b.slots} delay={260 + i * 90} /></View>
                                </View>
                            );
                        })}
                    </View>
                    {next && (
                        <View style={s.next}>
                            <HonourIcon kind={next.kind} tier={next.tier} size={22} />
                            <View style={{ flex: 1 }}>
                                <Text style={s.label}>{t('series:path.next')}</Text>
                                <Text style={s.nextLine} numberOfLines={1}>
                                    <Text style={{ color: TEXT, fontFamily: fontFamily.regular }}>{honourName(next.kind)}</Text>
                                    <Text style={{ color: TIER_COLOUR[next.tier] }}>{` ${tierName(next.tier)}`}</Text>
                                    <Text style={{ color: FAINT }}>{'  ·  '}</Text>{nextLine}
                                </Text>
                            </View>
                        </View>
                    )}
                </View>
            )}

            {(you?.path?.sample || them?.path?.sample) && (
                <Text style={s.dev}>DEV · sample numbers</Text>
            )}
        </Sheet>
    );
}

const s = StyleSheet.create({
    top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    chips: { flex: 1, flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 100, borderWidth: 1, borderColor: HAIR },
    chipOn: { borderColor: hexA(GOLD, 0.55), backgroundColor: hexA(GOLD, 0.08) },
    chipNo: { fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: 0.6, color: FAINT, fontVariant: ['tabular-nums'] },
    chipText: { fontFamily: fontFamily.regular, fontSize: 13, color: SOFT },
    close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' },

    section: { paddingTop: 26 },
    sectionGap: { marginTop: 16 },
    kickRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    kickNo: { fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: 2.4, color: GOLD, fontVariant: ['tabular-nums'] },
    kicker: { flexShrink: 1, fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: 3.2, color: CREAM },
    kickRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.18)', marginLeft: 4 },
    label: { fontFamily: fontFamily.medium, fontSize: 9.5, letterSpacing: 2.2, color: FAINT, textTransform: 'uppercase' },
    caps: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 1.6, color: SOFT, textTransform: 'uppercase', fontVariant: ['tabular-nums'] },
    rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.13)' },

    // The one thing to remember: a ringed glyph and a very large number.
    hero: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
    heroFigure: { flexDirection: 'row', alignItems: 'flex-end' },
    heroMark: { fontFamily: fontFamily.extraLight, fontSize: 18, lineHeight: 33, marginRight: 2 },
    heroNum: { fontFamily: fontFamily.extraLight, fontSize: 43, lineHeight: 46, letterSpacing: -1.6, fontVariant: ['tabular-nums'] },
    heroCaps: { fontFamily: fontFamily.medium, fontSize: 11.5, lineHeight: 17, letterSpacing: 2.2, color: CREAM, textTransform: 'uppercase', marginTop: 6 },

    vs: { flexDirection: 'row', alignItems: 'center', marginTop: 24 },
    vsEnd: { width: 58, alignItems: 'center', gap: 5 },
    vsName: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1.8 },
    vsMid: { flex: 1, paddingBottom: 14 },
    vsNums: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 7 },
    vsNum: { fontFamily: fontFamily.light, fontSize: 26, lineHeight: 30, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
    vsTrack: { height: 6, borderRadius: 3, backgroundColor: TRACK, justifyContent: 'center' },
    vsThem: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },

    tokens: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9, marginTop: 24 },
    token: { width: 34, height: 34 },
    tokenMore: { fontFamily: fontFamily.regular, fontSize: 13, color: SOFT, marginLeft: 2 },

    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 },
    pill: {
        flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, height: 30, borderRadius: 15,
        borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.03)',
    },

    climbTop: { height: 16, alignItems: 'flex-end' },
    climbTopText: { fontFamily: fontFamily.medium, fontSize: 9.5, letterSpacing: 2, color: GOLD },
    climbLine: { height: 14, justifyContent: 'center', marginTop: 4 },
    climbRail: { height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
    climbTrail: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: GOLD },
    climbEnd: { position: 'absolute', right: 0, width: 1.5, height: 12, backgroundColor: hexA(GOLD, 0.7) },
    climbStart: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
    climbDot: { position: 'absolute', left: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: GOLD, borderWidth: 3, borderColor: hexA(GOLD, 0.3) },
    climbLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },

    earn: { marginTop: 28 },
    earnRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
    earnCol: { flex: 1, alignItems: 'center' },
    earnPts: { fontFamily: fontFamily.light, fontSize: 19, color: TEXT, marginTop: 9, fontVariant: ['tabular-nums'] },
    earnName: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 2, color: FAINT, marginTop: 2 },

    mix: { flexDirection: 'row', alignItems: 'center', gap: 22, marginTop: 22 },
    ringMid: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    ringPct: { fontFamily: fontFamily.extraLight, fontSize: 38, lineHeight: 42, letterSpacing: -1.4, color: TEXT, fontVariant: ['tabular-nums'], marginTop: 2 },
    ringPctSign: { fontFamily: fontFamily.light, fontSize: 15, color: SOFT },
    ringLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 2.2, color: FAINT },
    cmp: { flex: 1, minWidth: 0 },
    cmpHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8 },
    cmpColHead: { width: 46, fontFamily: fontFamily.medium, fontSize: 9.5, letterSpacing: 1.8, textAlign: 'right' },
    cmpRow: { flexDirection: 'row', alignItems: 'center', height: 40, gap: 10 },
    cmpLabel: { flex: 1, fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 1.8, color: SOFT },
    cmpCol: { width: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
    cmpNum: { fontFamily: fontFamily.light, fontSize: 22, lineHeight: 26, fontVariant: ['tabular-nums'] },

    block: { marginTop: 26 },
    // Centred on the dashed drop at today's edge (the chart keeps 30pt clear on the right for it).
    gapPill: {
        position: 'absolute', right: 0, minWidth: 60, height: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3,
        paddingHorizontal: 7, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)',
    },
    gapPillText: { fontFamily: fontFamily.medium, fontSize: 11, fontVariant: ['tabular-nums'] },
    // A dot under each day of the chart for each of you: lit on the days you moved.
    dotsBlock: { marginTop: 8, gap: 2 },
    dotRow: { height: 18, justifyContent: 'center' },
    dayDot: { position: 'absolute', width: 7, height: 7, borderRadius: 3.5 },
    dayDotOff: { backgroundColor: 'rgba(255,255,255,0.1)' },
    dotCount: { position: 'absolute', right: 0, fontFamily: fontFamily.regular, fontSize: 11, fontVariant: ['tabular-nums'] },

    cab: { marginTop: 18 },
    cabHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 10, gap: 10 },
    cabCol: { width: 96, alignItems: 'center' },
    cabColHead: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 1.8, textAlign: 'center' },
    cabRow: { flexDirection: 'row', alignItems: 'center', height: 44, gap: 10 },
    cabName: { flex: 1, fontFamily: fontFamily.light, fontSize: 16, color: SOFT },
    pieces: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    next: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.13)' },
    nextLine: { fontFamily: fontFamily.light, fontSize: 14, lineHeight: 20, color: SOFT, marginTop: 3 },

    dev: { fontFamily: fontFamily.regular, fontSize: 10.5, letterSpacing: 0.4, color: FAINT, marginTop: 24, textAlign: 'center' },
});
