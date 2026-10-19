import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
    Easing,
    FadeIn,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { ComebackWelcome } from '@/components/drop/ComebackWelcome';
import { DropReveal } from '@/components/drop/DropReveal';
import { DropWeek, openedThisWeek } from '@/components/drop/DropWeek';
import { GOLD, GREEN, kit, MUTED, nextResetIso, outcomeLine, SECONDARY, SectionHeader, StatusChip } from '@/components/drop/cardKit';
import { Countdown } from '@/components/social/Countdown';
import { dropSim, todayTarget, useDropPrototype } from '@/lib/dev/dropPrototype';
import {
    COMEBACK_DOUBLE_UP_TO,
    dropProgress,
    formatSteps,
    nextMove,
    type TargetBasis,
} from '@/lib/drop';

/** Where today's target came from, in one plain phrase. */
const BASIS_LINE: Record<TargetBasis, string> = {
    history: 'set from your last two weeks',
    starter: 'a starter target while we learn your week',
    recovery: 'easier today after yesterday’s big one',
    comeback: 'an easy start back',
};

/**
 * Today's Drop on Home — a TODAY'S DROP section in the same card language as
 * TOGETHER's challenge cards (see components/drop/cardKit).
 *
 * Nothing to pick: the target is set for the member from their own last two
 * weeks (lib/drop autoTarget), so the card opens each morning already sealed.
 *
 *   sealed  → today's target, the labelled track, the next move
 *   ready   → the track is full; Open your Drop → the hold-to-open reveal
 *   opened  → what was inside, in the outcome line
 *
 * Every state ends on this week's Drops, the reason to come back tomorrow.
 * Comeback rides the same card: welcome line, an easy target, the doubled
 * start in the footer.
 */
export function DropCard() {
    const drop = useDropPrototype();
    const [revealing, setRevealing] = useState(false);
    const resetAt = useMemo(() => nextResetIso(), []);

    const comeback = drop.comebackDays != null;
    const target = todayTarget(drop);
    const progress = dropProgress(target, drop.steps, drop.minutes);
    const phase: 'sealed' | 'ready' | 'opened' = drop.opened ? 'opened' : progress >= 1 ? 'ready' : 'sealed';

    const enter = useSharedValue(0);
    useEffect(() => {
        enter.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
    }, [enter]);
    const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ translateY: (1 - enter.value) * 10 }] }));

    // One value drives the track and today's dot in the week strip.
    const fill = useSharedValue(0);
    useEffect(() => {
        fill.value = withTiming(phase === 'opened' ? 1 : progress, { duration: 900, easing: Easing.out(Easing.cubic) });
    }, [progress, phase, fill]);
    const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

    const openReveal = () => {
        Haptics.selectionAsync().catch(() => {});
        dropSim.prepare();
        setRevealing(true);
    };

    // Which route is ahead decides what the track measures.
    const stepsAhead = drop.steps / target.steps >= drop.minutes / target.minutes;
    const opened = openedThisWeek(drop.week, phase === 'opened');
    const move = nextMove(target, drop.steps, drop.minutes);

    return (
        <View>
            <SectionHeader label="Today’s Drop" />

            <Animated.View style={[kit.card, phase === 'ready' && kit.cardLit, enterStyle]}>
                {/* Status left, how far along right — where a challenge card
                    shows who's in and the points. */}
                <View style={kit.header}>
                    {phase === 'sealed' && (comeback
                        ? <StatusChip icon="sparkles-outline" text="Comeback" tone="gold" />
                        : <StatusChip icon="lock-closed-outline" text="Sealed" />)}
                    {phase === 'ready' && <StatusChip icon="lock-open-outline" text="Ready to open" tone="gold" />}
                    {phase === 'opened' && <StatusChip icon="checkmark-circle" text="Opened" tone="green" />}

                    {phase === 'opened' && drop.reward ? (
                        <View style={kit.points}>
                            <Text style={kit.pointsValue}>{drop.reward.headline}</Text>
                            <Text style={kit.pointsLabel}>{drop.reward.kind === 'points' || drop.reward.kind === 'vault' ? 'POWR' : ''}</Text>
                        </View>
                    ) : phase === 'sealed' ? (
                        <View style={kit.points}>
                            <Text style={kit.pointsValue}>{Math.floor(progress * 100)}%</Text>
                            <Text style={kit.pointsLabel}>there</Text>
                        </View>
                    ) : null}
                </View>

                {/* Same title row as every other card on Home. The P is kept for
                    the reveal, where it cracks open. */}
                <View style={kit.titleBlock}>
                    <View style={kit.titleRow}>
                        <Ionicons name="gift-outline" size={18} color={GOLD} />
                        <Text style={kit.title} numberOfLines={1}>
                            {comeback ? 'Welcome back' : `${formatSteps(target.steps)} steps`}
                        </Text>
                    </View>
                    <Text style={kit.goal}>
                        {comeback
                            ? `${formatSteps(target.steps)} steps or ${target.minutes} active min opens it — ${BASIS_LINE.comeback}.`
                            : `or ${target.minutes} active min · ${BASIS_LINE[target.basis]}`}
                    </Text>
                </View>

                {phase !== 'opened' && (
                    <Animated.View entering={FadeIn.duration(250)} style={kit.progressBlock}>
                        <View style={kit.progressMeta}>
                            <Text style={kit.progressLabel}>{stepsAhead ? 'Steps' : 'Active minutes'}</Text>
                            <Text style={kit.progressValue}>
                                {stepsAhead
                                    ? `${formatSteps(Math.min(drop.steps, target.steps))} / ${formatSteps(target.steps)}`
                                    : `${Math.min(drop.minutes, target.minutes)} / ${target.minutes}`}
                            </Text>
                        </View>
                        <View style={kit.track}>
                            <Animated.View style={[kit.fill, fillStyle]} />
                        </View>
                        {phase === 'sealed' && (
                            <Text style={kit.momentumLine} numberOfLines={1}>
                                <Text style={kit.momentumLabel}>Next </Text>
                                {move.left}{move.route === 'steps' ? ` · about ${move.minutes} min` : ''}
                                <Text style={{ color: MUTED }}>{`  ${move.alt}`}</Text>
                            </Text>
                        )}
                    </Animated.View>
                )}

                {phase === 'ready' && (
                    <Pressable
                        onPress={openReveal}
                        accessibilityRole="button"
                        accessibilityLabel="Open today’s Drop"
                        style={({ pressed }) => [kit.acceptBtn, pressed && { opacity: 0.85 }]}
                    >
                        <Text style={kit.acceptText}>Open your Drop</Text>
                    </Pressable>
                )}

                {phase === 'opened' && drop.reward && (
                    <View style={kit.outcomeBlock}>
                        <Ionicons name="checkmark-circle" size={15} color={GREEN} />
                        <Text style={kit.outcomeText} numberOfLines={2}>
                            {outcomeLine(drop.reward)}
                        </Text>
                    </View>
                )}

                {/* This week's Drops — the card's last word in every state. */}
                <View style={s.weekBlock}>
                    <DropWeek
                        week={drop.week}
                        dayIndex={drop.dayIndex}
                        today={phase === 'opened' ? 'opened' : 'sealed'}
                        fill={fill}
                    />
                    <View style={kit.footer}>
                        {comeback ? (
                            <Text style={kit.footerGold}>2× your first {COMEBACK_DOUBLE_UP_TO} POWR</Text>
                        ) : (
                            <Text style={kit.footerMuted}>
                                {opened === 0 ? 'Open your first Drop this week' : `${opened} opened this week`}
                            </Text>
                        )}
                        {phase === 'opened' ? (
                            <View style={s.nextRow}>
                                <Text style={kit.timeText}>Next Drop in </Text>
                                <Countdown endsAt={resetAt} style={kit.timeText} suffix="" />
                            </View>
                        ) : (
                            <Countdown endsAt={resetAt} iconName="time-outline" iconColor={SECONDARY} style={kit.timeText} />
                        )}
                    </View>
                </View>
            </Animated.View>

            <ComebackWelcome
                visible={comeback && !drop.comebackSeen}
                daysAway={drop.comebackDays ?? 0}
                doubleUpTo={COMEBACK_DOUBLE_UP_TO}
                onDone={dropSim.ackComeback}
            />

            <DropReveal
                visible={revealing}
                kicker="TODAY’S DROP"
                subtitle="Opened by moving"
                reward={drop.reward}
                onOpened={dropSim.markOpened}
                onClose={() => setRevealing(false)}
            />
        </View>
    );
}

const s = StyleSheet.create({
    nextRow: { flexDirection: 'row', alignItems: 'center' },
    weekBlock: {
        gap: 14,
        paddingTop: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(255,255,255,0.07)',
    },
});
