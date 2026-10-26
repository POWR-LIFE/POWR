import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    type SharedValue,
    useAnimatedProps,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSequence,
    withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

import { ComebackWelcome } from '@/components/drop/ComebackWelcome';
import { DropReveal } from '@/components/drop/DropReveal';
import { BORDER, FAINT, GOLD, GREEN, nextResetIso, TEXT } from '@/components/drop/cardKit';
import { HC, HomeCard, homeCardStyles, HomeNote } from '@/components/home/HomeCard';
import { useSeriesSim } from '@/components/series/useSeriesSim';
import { Countdown } from '@/components/social/Countdown';
import { fontFamily } from '@/constants/tokens';
import { useDrop } from '@/hooks/useDrop';
import { dropInsideLabel, dropRewardFor, type DropWeekDay, type MyDrop, type OpenDropResult } from '@/lib/api/drop';
import { DROP_PROTOTYPE, dropSim, todayTarget, useDropPrototype } from '@/lib/dev/dropPrototype';
import { SERIES_PROTOTYPE } from '@/lib/dev/seriesPrototype';
import {
    COMEBACK_DOUBLE_UP_TO,
    DROP_POOLS,
    DROP_SERIES_POOL,
    dropProgress,
    type DropReward,
    formatSteps,
    type TargetBasis,
} from '@/lib/drop';

type Phase = 'sealed' | 'ready' | 'opened';

/** Everything the card draws — from the server, or from the dev sample. */
interface DropView {
    target: { steps: number; minutes: number; basis: TargetBasis };
    steps: number;
    minutes: number;
    phase: Phase;
    /** An opened Drop that support withdrew. */
    voided: boolean;
    /** Monday to yesterday. */
    week: DropWeekDay[];
    dayIndex: number;
    reward: DropReward | null;
    comebackDays: number | null;
    /** The sample's 2× Comeback offer; the server has none. */
    doubleUpTo: number | null;
    resetAt: string;
    inside: string[];
}

/**
 * Today's Drop on Home. The server's Drop when it's on for this member
 * (supabase: get_my_drop / open_my_drop); in dev builds, the SIM tab's sample
 * when it's off, or when the SIM's DROP chip asks for it. Release builds with
 * the Drop off show nothing.
 */
export function DropCard() {
    const live = useDrop();
    const sim = useDropPrototype();
    if (DROP_PROTOTYPE && (sim.forceSim || (!live.isPending && !live.drop))) return <SimDropCard />;
    if (!live.drop) return null;
    return <LiveDropCard drop={live.drop} settled={live.settled} refresh={live.refresh} open={live.open} />;
}

/** Where today's target came from, when it isn't the usual two weeks. */
const BASIS_KEY: Partial<Record<TargetBasis, string>> = {
    starter: 'home:drop.basis.starter',
    recovery: 'home:drop.basis.recovery',
    comeback: 'home:drop.basis.comeback',
};

function LiveDropCard({ drop, settled, refresh, open }: {
    drop: MyDrop;
    /** Today's target has settled from backfilled history (useDrop). */
    settled: boolean;
    refresh: () => Promise<void>;
    open: () => Promise<OpenDropResult>;
}) {
    const { t } = useTranslation();
    const router = useRouter();
    const [revealing, setRevealing] = useState(false);
    const [revealReward, setRevealReward] = useState<DropReward | null>(null);
    const [revealError, setRevealError] = useState<string | null>(null);
    const [comebackSeen, setComebackSeen] = useState(true);

    // Back on Home: sync and read again, so the numbers follow the walk. The
    // first focus is the mount, which the query already covers.
    const mounted = useRef(false);
    useFocusEffect(useCallback(() => {
        if (mounted.current) refresh().catch(() => {});
        mounted.current = true;
    }, [refresh]));

    // The welcome shows once per comeback day, on this phone.
    const seenKey = `powr.drop.comebackSeen.${drop.day}`;
    useEffect(() => {
        if (!drop.comeback) return;
        AsyncStorage.getItem(seenKey).then(v => setComebackSeen(v === '1')).catch(() => setComebackSeen(true));
    }, [drop.comeback, seenKey]);
    const ackComeback = useCallback(() => {
        setComebackSeen(true);
        AsyncStorage.setItem(seenKey, '1').catch(() => {});
    }, [seenKey]);

    const met = drop.steps >= drop.target.steps || drop.minutes >= drop.target.minutes;
    const view: DropView = {
        target: drop.target,
        steps: drop.steps,
        minutes: drop.minutes,
        phase: drop.status === 'sealed' ? (met ? 'ready' : 'sealed') : 'opened',
        voided: drop.status === 'void',
        week: drop.week,
        dayIndex: drop.day_index,
        reward: drop.prize ? dropRewardFor(drop.prize) : null,
        comebackDays: drop.comeback?.days_away ?? null,
        doubleUpTo: null,
        resetAt: drop.resets_at,
        // Partner codes lead: something to use today is the strongest pull.
        inside: [...drop.could_be_inside]
            .sort((a, b) => Number(b.kind === 'partner') - Number(a.kind === 'partner'))
            .map(dropInsideLabel),
    };

    // Only the latest open's answer lands: close and reopen fires a second one.
    const openSeq = useRef(0);
    const startOpen = async () => {
        const seq = ++openSeq.current;
        setRevealReward(null);
        setRevealError(null);
        setRevealing(true);
        const res = await open();
        if (seq !== openSeq.current) return;
        if (res.ok) {
            setRevealReward(dropRewardFor(res.prize));
            return;
        }
        setRevealError(t(`home:drop.error.${res.reason === 'not_yet' || res.reason === 'empty' || res.reason === 'error' ? res.reason : 'off'}`));
    };

    const partner = revealReward?.kind === 'partner';
    return (
        <DropCardBody
            view={view}
            onOpen={startOpen}
            // Not before the backfill: someone whose walks were still syncing isn't back.
            comeback={settled && view.comebackDays != null && !comebackSeen ? { onDone: ackComeback } : null}
            reveal={{
                visible: revealing,
                reward: revealReward,
                error: revealError,
                action: partner ? {
                    label: t('home:drop.reveal.wallet'),
                    onPress: () => {
                        setRevealing(false);
                        router.push('/wallet');
                    },
                } : null,
                // The server opened it before the hold; the hold only reveals it.
                onOpened: () => {},
                onClose: () => setRevealing(false),
            }}
        />
    );
}

/** The dev sample, driven from the SIM tab (lib/dev/dropPrototype). */
function SimDropCard() {
    const drop = useDropPrototype();
    // The Series (sample): during a round the Drop can hold Series prizes.
    const series = useSeriesSim(false);
    const inRound = SERIES_PROTOTYPE && series.inRound;
    const [revealing, setRevealing] = useState(false);
    const resetAt = useMemo(() => nextResetIso(), []);

    const comeback = drop.comebackDays != null;
    const target = todayTarget(drop);
    const progress = dropProgress(target, drop.steps, drop.minutes);
    const pool = [...DROP_POOLS.steady, ...(inRound ? DROP_SERIES_POOL : [])];
    const view: DropView = {
        target,
        steps: drop.steps,
        minutes: drop.minutes,
        phase: drop.opened ? 'opened' : progress >= 1 ? 'ready' : 'sealed',
        voided: false,
        week: drop.week,
        dayIndex: drop.dayIndex,
        reward: drop.reward,
        comebackDays: drop.comebackDays,
        doubleUpTo: COMEBACK_DOUBLE_UP_TO,
        resetAt,
        inside: pool.map(r => `${r.headline} ${r.unit}`),
    };

    return (
        <DropCardBody
            view={view}
            onOpen={() => {
                dropSim.prepare(inRound ? DROP_SERIES_POOL : undefined);
                setRevealing(true);
            }}
            comeback={comeback && !drop.comebackSeen ? { onDone: dropSim.ackComeback } : null}
            reveal={{
                visible: revealing,
                reward: drop.reward,
                error: null,
                action: null,
                onOpened: dropSim.markOpened,
                onClose: () => setRevealing(false),
            }}
        />
    );
}

interface RevealProps {
    visible: boolean;
    reward: DropReward | null;
    error: string | null;
    action: { label: string; onPress: () => void } | null;
    onOpened: () => void;
    onClose: () => void;
}

/**
 * Today's Drop in Home's one layout (components/home/HomeCard): the title and
 * the clock, one big number with its ring, a strip of three (both ways to open
 * it, and this week), and the one button when it's ready. Nothing to pick: the
 * target is set from the member's own last two weeks, so it opens each day
 * sealed. The ring says the state (lock, open lock, gift).
 *
 *   sealed  → what's left on the quicker route, the ring filling as you move,
 *             and what could be inside
 *   ready   → the ring full and breathing; OPEN YOUR DROP → the hold-to-open reveal
 *   opened  → what was inside, big, and when the next one comes
 */
function DropCardBody({ view, onOpen, comeback, reveal }: {
    view: DropView;
    onOpen: () => void;
    comeback: { onDone: () => void } | null;
    reveal: RevealProps;
}) {
    const { t } = useTranslation();
    const { phase, target, reward } = view;

    const enter = useSharedValue(0);
    useEffect(() => {
        enter.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
    }, [enter]);
    const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ translateY: (1 - enter.value) * 10 }] }));

    // One value drives the ring and today's dot in the week.
    const progress = dropProgress(target, view.steps, view.minutes);
    const fill = useSharedValue(0);
    useEffect(() => {
        fill.value = withTiming(phase === 'opened' ? 1 : progress, { duration: 900, easing: Easing.out(Easing.cubic) });
    }, [progress, phase, fill]);

    const openReveal = () => {
        Haptics.selectionAsync().catch(() => {});
        onOpen();
    };

    // The quicker route leads (100 steps ≈ a minute's walk); the other is the "or".
    const stepsLeft = Math.max(0, target.steps - view.steps);
    const minsLeft = Math.max(0, target.minutes - view.minutes);
    const byWalk = Math.ceil(stepsLeft / 100) <= minsLeft;
    const opened = view.week.filter(r => r === 'opened').length + (phase === 'opened' && !view.voided ? 1 : 0);
    const basisKey = BASIS_KEY[view.comebackDays != null ? 'comeback' : target.basis];
    const note = basisKey ? t(basisKey) : null;

    return (
        <View>
            <Animated.View style={enterStyle}>
                <HomeCard
                    title={t('home:drop.title')}
                    right={phase === 'opened' ? (
                        <View style={s.clock}>
                            <Text style={homeCardStyles.rightText}>{t('home:drop.nextIn')} </Text>
                            <Countdown endsAt={view.resetAt} style={homeCardStyles.rightText} suffix="" />
                        </View>
                    ) : (
                        <Countdown endsAt={view.resetAt} iconName="time-outline" iconColor={HC.label} style={homeCardStyles.rightText} />
                    )}
                    lit={phase === 'ready'}
                    action={phase === 'ready' ? { icon: 'lock-open', label: t('home:drop.open'), onPress: openReveal, primary: true } : undefined}
                >
                    {/* The one number, and the ring that fills as you move. */}
                    <View style={s.hero}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            {phase === 'sealed' && (
                                <>
                                    <Text style={s.heroNum}>{byWalk ? formatSteps(stepsLeft) : minsLeft}</Text>
                                    <Text style={s.heroUnit}>{byWalk ? t('home:drop.stepsToGo') : t('home:drop.minutesToGo')}{note ? `  ·  ${note}` : ''}</Text>
                                </>
                            )}
                            {phase === 'ready' && (
                                <>
                                    <Text style={s.heroNum}>{t('home:drop.yours')}</Text>
                                    <Text style={s.heroUnit}>{t('home:drop.targetHit')}</Text>
                                </>
                            )}
                            {phase === 'opened' && reward && (
                                <>
                                    <Text style={s.heroNum} numberOfLines={1} adjustsFontSizeToFit>{reward.headline}</Text>
                                    <Text style={[s.heroUnit, { color: GREEN }]} numberOfLines={1}>{reward.unit}</Text>
                                </>
                            )}
                            {phase === 'opened' && !reward && view.voided && (
                                <>
                                    <Text style={s.heroNum}>{t('home:drop.voided')}</Text>
                                    <Text style={s.heroUnit}>{t('home:drop.voidedSub')}</Text>
                                </>
                            )}
                        </View>
                        <DropRing fill={fill} phase={phase} onOpen={phase === 'ready' ? openReveal : undefined} a11y={t('home:drop.a11yRing')} />
                    </View>

                    {/* Both ways to open it, and this week's Drops. */}
                    <View style={s.strip}>
                        <Stat
                            label={t('home:drop.steps')}
                            value={formatSteps(Math.min(view.steps, target.steps))}
                            sub={t('home:drop.of', { value: formatSteps(target.steps) })}
                            p={view.steps / target.steps}
                            lead={phase === 'sealed' && byWalk}
                        />
                        <View style={s.rule} />
                        <Stat
                            label={t('home:drop.minutes')}
                            value={String(Math.min(view.minutes, target.minutes))}
                            sub={t('home:drop.of', { value: target.minutes })}
                            p={view.minutes / target.minutes}
                            lead={phase === 'sealed' && !byWalk}
                        />
                        <View style={s.rule} />
                        <View style={s.stat}>
                            <Text style={s.label}>{t('home:drop.thisWeek')}</Text>
                            <WeekDots week={view.week} dayIndex={view.dayIndex} todayOpened={phase === 'opened' && !view.voided} fill={fill} a11y={t('home:drop.a11yWeek', { count: opened })} />
                            <Text style={s.statSub}>{t('home:drop.opened', { count: opened })}</Text>
                        </View>
                    </View>

                    {phase === 'sealed' && view.comebackDays != null && view.doubleUpTo != null && (
                        <HomeNote icon="sparkles-outline" lead={t('home:drop.comeback.kicker')} text={t('home:drop.comeback.doubleNote', { amount: view.doubleUpTo })} tone="gold" />
                    )}
                    {phase === 'sealed' && view.inside.length > 0 && (view.comebackDays == null || view.doubleUpTo == null) && (
                        <InsideTicker lead={t('home:drop.insideLead')} items={view.inside} />
                    )}
                </HomeCard>
            </Animated.View>

            {comeback && (
                <ComebackWelcome
                    visible
                    daysAway={view.comebackDays ?? 0}
                    doubleUpTo={view.doubleUpTo ?? undefined}
                    onDone={comeback.onDone}
                />
            )}

            <DropReveal
                visible={reveal.visible}
                kicker={t('home:drop.reveal.kicker').toUpperCase()}
                subtitle={t('home:drop.reveal.subtitle')}
                reward={reveal.reward}
                error={reveal.error}
                action={reveal.action}
                onOpened={reveal.onOpened}
                onClose={reveal.onClose}
            />
        </View>
    );
}

/** Pixels a second the could-be-inside line slides: slow enough to read. */
const TICKER_PX_S = 28;

/**
 * COULD BE INSIDE, then every prize in one line that slides right to left on
 * a loop, so none is cut off. It only moves when the line is wider than the
 * card; with Reduce Motion on it stays still and wraps instead.
 */
function InsideTicker({ lead, items }: { lead: string; items: string[] }) {
    const [reduce, setReduce] = useState(false);
    const [windowW, setWindowW] = useState(0);
    const [copyW, setCopyW] = useState(0);
    const x = useSharedValue(0);
    useEffect(() => {
        AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
        const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
        return () => sub.remove();
    }, []);
    const loop = !reduce && windowW > 0 && copyW > windowW;
    useEffect(() => {
        cancelAnimation(x);
        x.value = 0;
        if (!loop) return undefined;
        x.value = withRepeat(withTiming(-copyW, { duration: (copyW / TICKER_PX_S) * 1000, easing: Easing.linear }), -1, false);
        return () => cancelAnimation(x);
    }, [loop, copyW, x]);
    const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
    const line = items.map((i) => i.toUpperCase()).join('  ·  ');
    return (
        <View style={s.ticker} accessible accessibilityLabel={`${lead}: ${items.join(', ')}`}>
            <Ionicons name="gift-outline" size={12} color={HC.label} />
            <Text style={[s.tickerText, { color: HC.label }]}>{lead.toUpperCase()}</Text>
            <View style={s.tickerWindow} onLayout={(e) => setWindowW(e.nativeEvent.layout.width)}>
                {reduce ? (
                    <Text style={s.tickerText}>{line}</Text>
                ) : (
                    <Animated.View style={[s.tickerRow, slide]}>
                        {/* One copy, measured; a second follows it so the loop has no gap. */}
                        <Text style={s.tickerText} numberOfLines={1} onLayout={(e) => setCopyW(e.nativeEvent.layout.width)}>
                            {loop ? `${line}  ·  ` : line}
                        </Text>
                        {loop && <Text style={s.tickerText} numberOfLines={1}>{`${line}  ·  `}</Text>}
                    </Animated.View>
                )}
            </View>
        </View>
    );
}

const RING = 68;
const STROKE = 4;
const R = (RING - STROKE) / 2;
const C = 2 * Math.PI * R;
const ACircle = Animated.createAnimatedComponent(Circle);

/**
 * The Drop itself: a ring that fills as you move, around a lock. Full, the lock
 * opens and the ring breathes (tap it to open); opened, it holds the gift.
 */
function DropRing({ fill, phase, onOpen, a11y }: { fill: SharedValue<number>; phase: Phase; onOpen?: () => void; a11y: string }) {
    const arc = useAnimatedProps(() => ({ strokeDashoffset: C * (1 - Math.max(0, Math.min(1, fill.value))) }));
    const breath = useSharedValue(1);
    useEffect(() => {
        breath.value = phase === 'ready'
            ? withRepeat(withSequence(withTiming(1.08, { duration: 900 }), withTiming(1, { duration: 900 })), -1, false)
            : withTiming(1, { duration: 200 });
    }, [phase, breath]);
    const breathe = useAnimatedStyle(() => ({ transform: [{ scale: breath.value }] }));
    const icon = phase === 'opened' ? 'gift' : phase === 'ready' ? 'lock-open' : 'lock-closed';
    const ring = (
        <Animated.View style={[s.ring, breathe, phase === 'ready' && s.ringGlow]}>
            <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
                <Circle cx={RING / 2} cy={RING / 2} r={R} stroke={BORDER} strokeWidth={STROKE} fill="none" />
                <ACircle
                    cx={RING / 2}
                    cy={RING / 2}
                    r={R}
                    stroke={phase === 'opened' ? GREEN : GOLD}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={`${C} ${C}`}
                    animatedProps={arc}
                    transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
                />
            </Svg>
            <Ionicons name={icon} size={22} color={phase === 'sealed' ? 'rgba(255,255,255,0.7)' : GOLD} />
        </Animated.View>
    );
    if (!onOpen) return ring;
    return (
        <Pressable onPress={onOpen} hitSlop={8} accessibilityRole="button" accessibilityLabel={a11y}>
            {ring}
        </Pressable>
    );
}

/** One way to open it: how far along, a thin bar, and the target. The quicker route is lit. */
function Stat({ label, value, sub, p, lead }: { label: string; value: string; sub: string; p: number; lead: boolean }) {
    const pct = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%` as `${number}%`;
    return (
        <View style={s.stat}>
            <Text style={[s.label, lead && { color: TEXT }]}>{label}</Text>
            <Text style={s.statVal}>{value}</Text>
            <View style={s.bar}><View style={[s.barFill, { width: pct }, !lead && { backgroundColor: 'rgba(232,210,0,0.45)' }]} /></View>
            <Text style={s.statSub}>{sub}</Text>
        </View>
    );
}

/** This week's Drops in a row: opened = gold, missed = grey ring, today fills as you move. */
function WeekDots({ week, dayIndex, todayOpened, fill, a11y }: { week: DropWeekDay[]; dayIndex: number; todayOpened: boolean; fill: SharedValue<number>; a11y: string }) {
    const inner = useAnimatedStyle(() => ({ transform: [{ scale: Math.max(0, Math.min(1, fill.value)) }] }));
    return (
        <View style={s.dots} accessibilityLabel={a11y}>
            {Array.from({ length: 7 }, (_, i) => {
                if (i === dayIndex) {
                    return todayOpened
                        ? <View key={i} style={[s.dot, s.dotOn]} />
                        : <View key={i} style={[s.dot, { borderColor: GOLD, alignItems: 'center', justifyContent: 'center' }]}><Animated.View style={[s.dotInner, inner]} /></View>;
                }
                // Days to come, and days before their first Drop, are faint.
                if (i > dayIndex || week[i] === 'none' || week[i] == null) return <View key={i} style={[s.dot, { borderColor: '#262626' }]} />;
                return week[i] === 'opened'
                    ? <View key={i} style={[s.dot, s.dotOn]} />
                    : <View key={i} style={[s.dot, { borderColor: '#4A4A4A' }]} />;
            })}
        </View>
    );
}

const s = StyleSheet.create({
    clock: { flexDirection: 'row', alignItems: 'center' },

    hero: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    heroNum: { fontFamily: fontFamily.extraLight, fontSize: 44, lineHeight: 48, color: GOLD, letterSpacing: -1.5 },
    heroUnit: { marginTop: 2, fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1.4, color: HC.label, textTransform: 'uppercase' },
    ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
    ringGlow: { borderRadius: RING / 2, backgroundColor: 'rgba(232,210,0,0.08)' },

    strip: {
        flexDirection: 'row', alignItems: 'stretch', gap: 12, paddingTop: 14,
        borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HC.hair,
    },
    rule: { width: StyleSheet.hairlineWidth, backgroundColor: HC.hair },
    stat: { flex: 1, gap: 5, minWidth: 0 },
    label: { fontFamily: fontFamily.medium, fontSize: 8.5, letterSpacing: 1.2, color: HC.label, textTransform: 'uppercase' },
    statVal: { fontFamily: fontFamily.light, fontSize: 18, lineHeight: 22, color: TEXT, fontVariant: ['tabular-nums'] },
    statSub: { fontFamily: fontFamily.regular, fontSize: 10, color: FAINT },
    bar: { height: 3, borderRadius: 2, backgroundColor: BORDER, overflow: 'hidden' },
    barFill: { height: 3, borderRadius: 2, backgroundColor: GOLD },
    dots: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 22 + 8 },
    dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
    dotOn: { backgroundColor: GOLD, borderColor: GOLD },
    dotInner: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: GOLD },

    ticker: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: -4 },
    tickerWindow: { flex: 1, overflow: 'hidden' },
    tickerRow: { flexDirection: 'row', alignSelf: 'flex-start' },
    tickerText: { flexShrink: 0, fontFamily: fontFamily.medium, fontSize: 9.5, letterSpacing: 1.1, color: HC.text },
});
