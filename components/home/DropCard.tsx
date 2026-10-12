import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ComebackWelcome } from '@/components/drop/ComebackWelcome';
import { DropReveal } from '@/components/drop/DropReveal';
import { GOLD, GREEN, kit, MUTED, nextResetIso, outcomeLine, SECONDARY, SectionHeader, StatusChip } from '@/components/drop/cardKit';
import { Countdown } from '@/components/social/Countdown';
import { dropSim, useDropPrototype } from '@/lib/dev/dropPrototype';
import {
    COMEBACK_DOUBLE_UP_TO,
    DROP_TIERS,
    dropProgress,
    dropTier,
    formatSteps,
    nextMove,
    type DropTier,
} from '@/lib/drop';

/**
 * Today's Drop on Home — a TODAY'S DROP section in the same card language as
 * TOGETHER's challenge cards (see components/drop/cardKit):
 *
 *   choose  → three target rows + Set target (Lock In; fixed once set)
 *   locked  → the target, a labelled track, and the one line that opens it
 *   ready   → the track is full; Open your Drop → the hold-to-open reveal
 *   opened  → what was inside, in the challenge card's outcome line
 *
 * Comeback rides the same card: welcome line, Light preselected as the easy
 * start, the doubled start in the footer.
 */
export function DropCard() {
    const drop = useDropPrototype();
    const [revealing, setRevealing] = useState(false);
    const resetAt = useMemo(() => nextResetIso(), []);

    const comeback = drop.comebackDays != null;
    const [choice, setChoice] = useState<DropTier>(comeback ? 'light' : 'steady');
    useEffect(() => {
        setChoice(comeback ? 'light' : 'steady');
    }, [comeback]);

    const tier = drop.tier ? dropTier(drop.tier) : null;
    const progress = tier ? dropProgress(tier, drop.steps, drop.minutes) : 0;
    const phase: 'choose' | 'locked' | 'ready' | 'opened' =
        !tier ? 'choose' : drop.opened ? 'opened' : progress >= 1 ? 'ready' : 'locked';

    const enter = useSharedValue(0);
    useEffect(() => {
        enter.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
    }, [enter]);
    const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ translateY: (1 - enter.value) * 10 }] }));

    const fill = useSharedValue(0);
    useEffect(() => {
        fill.value = withTiming(progress, { duration: 800, easing: Easing.out(Easing.cubic) });
    }, [progress, fill]);
    const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

    const setTarget = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        dropSim.lockIn(choice);
    };

    const openReveal = () => {
        Haptics.selectionAsync().catch(() => {});
        dropSim.prepare();
        setRevealing(true);
    };

    // Which route is ahead decides what the track measures.
    const stepsAhead = tier ? drop.steps / tier.steps >= drop.minutes / tier.minutes : true;

    return (
        <View>
            <SectionHeader label="Today’s Drop" />

            <Animated.View style={[kit.card, phase === 'ready' && kit.cardLit, enterStyle]}>
                {/* Status left, the target's size right — where a challenge
                    card shows who's in and the points. */}
                <View style={kit.header}>
                    {phase === 'choose' && (comeback
                        ? <StatusChip icon="sparkles-outline" text="Comeback" tone="gold" />
                        : <StatusChip icon="ellipse-outline" text="Not set" />)}
                    {phase === 'locked' && <StatusChip icon="lock-closed-outline" text="Sealed" />}
                    {phase === 'ready' && <StatusChip icon="lock-open-outline" text="Ready to open" tone="gold" />}
                    {phase === 'opened' && <StatusChip icon="checkmark-circle" text="Opened" tone="green" />}

                    {phase === 'opened' && drop.reward ? (
                        <View style={kit.points}>
                            <Text style={kit.pointsValue}>{drop.reward.headline}</Text>
                            <Text style={kit.pointsLabel}>{drop.reward.kind === 'points' || drop.reward.kind === 'vault' ? 'POWR' : ''}</Text>
                        </View>
                    ) : tier ? (
                        <View style={kit.points}>
                            <Text style={kit.pointsValue}>{tier.size}</Text>
                            <Text style={kit.pointsLabel}>drop</Text>
                        </View>
                    ) : null}
                </View>

                <View style={kit.titleBlock}>
                    <View style={kit.titleRow}>
                        <Ionicons name="gift-outline" size={18} color={GOLD} />
                        <Text style={kit.title} numberOfLines={1}>
                            {tier ? tier.label : comeback ? 'Welcome back' : 'Set today’s target'}
                        </Text>
                    </View>
                    <Text style={kit.goal}>
                        {tier
                            ? `${formatSteps(tier.steps)} steps or ${tier.minutes} active min`
                            : comeback
                                ? `${drop.comebackDays} days off — it happens. Your first ${COMEBACK_DOUBLE_UP_TO} POWR today count double.`
                                : 'Reach it today and the Drop opens. Fixed once set.'}
                    </Text>
                </View>

                {phase === 'choose' && (
                    <Animated.View entering={FadeIn.duration(250)} style={{ gap: 14 }}>
                        <View accessibilityRole="radiogroup">
                            {DROP_TIERS.map((t, i) => {
                                const on = t.id === choice;
                                return (
                                    <Pressable
                                        key={t.id}
                                        onPress={() => {
                                            if (!on) Haptics.selectionAsync().catch(() => {});
                                            setChoice(t.id);
                                        }}
                                        accessibilityRole="radio"
                                        accessibilityState={{ selected: on }}
                                        accessibilityLabel={t.label}
                                        style={[kit.row, i < DROP_TIERS.length - 1 && kit.rowDivider]}
                                    >
                                        <View style={[kit.rowIcon, on && kit.rowIconOn]}>
                                            <Ionicons
                                                name={on ? 'radio-button-on' : 'radio-button-off'}
                                                size={14}
                                                color={on ? GOLD : SECONDARY}
                                            />
                                        </View>
                                        <Text style={kit.rowTitle}>{t.label}</Text>
                                        <Text style={kit.rowReadout}>
                                            {formatSteps(t.steps)}
                                            <Text style={kit.rowUnit}> steps · {t.minutes} min</Text>
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                        <Pressable
                            onPress={setTarget}
                            accessibilityRole="button"
                            accessibilityLabel="Set target"
                            style={({ pressed }) => [kit.acceptBtn, pressed && { opacity: 0.85 }]}
                        >
                            <Text style={kit.acceptText}>Set target</Text>
                        </Pressable>
                    </Animated.View>
                )}

                {(phase === 'locked' || phase === 'ready') && tier && (() => {
                    const move = nextMove(tier, drop.steps, drop.minutes);
                    return (
                        <Animated.View entering={FadeIn.duration(250)} style={kit.progressBlock}>
                            <View style={kit.progressMeta}>
                                <Text style={kit.progressLabel}>{stepsAhead ? 'Steps' : 'Active minutes'}</Text>
                                <Text style={kit.progressValue}>
                                    {stepsAhead
                                        ? `${formatSteps(Math.min(drop.steps, tier.steps))} / ${formatSteps(tier.steps)}`
                                        : `${Math.min(drop.minutes, tier.minutes)} / ${tier.minutes}`}
                                </Text>
                            </View>
                            <View style={kit.track}>
                                <Animated.View style={[kit.fill, fillStyle]} />
                            </View>
                            {phase === 'locked' && (
                                <Text style={kit.momentumLine} numberOfLines={1}>
                                    <Text style={kit.momentumLabel}>Next </Text>
                                    {move.left}{move.route === 'steps' ? ` · about ${move.minutes} min` : ''}
                                    <Text style={{ color: MUTED }}>{`  ${move.alt}`}</Text>
                                </Text>
                            )}
                        </Animated.View>
                    );
                })()}

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

                {phase !== 'choose' && phase !== 'ready' && (
                    <View style={kit.footer}>
                        {comeback ? (
                            <Text style={kit.footerGold}>2× your first {COMEBACK_DOUBLE_UP_TO} POWR</Text>
                        ) : phase === 'opened' ? (
                            <Text style={kit.footerMuted}>Next Drop</Text>
                        ) : (
                            // The track already says how far; a challenge card leaves
                            // this side empty when there's no bonus to show.
                            <View />
                        )}
                        <Countdown endsAt={resetAt} iconName="time-outline" iconColor={SECONDARY} style={kit.timeText} suffix={phase === 'opened' ? '' : ' left'} />
                    </View>
                )}
            </Animated.View>

            <ComebackWelcome
                visible={comeback && !drop.comebackSeen}
                daysAway={drop.comebackDays ?? 0}
                doubleUpTo={COMEBACK_DOUBLE_UP_TO}
                onDone={dropSim.ackComeback}
            />

            {tier && (
                <DropReveal
                    visible={revealing}
                    kicker={`TODAY’S DROP · ${tier.label.toUpperCase()}`}
                    subtitle={`${tier.size} Drop · opened by moving`}
                    reward={drop.reward}
                    onOpened={dropSim.markOpened}
                    onClose={() => setRevealing(false)}
                />
            )}
        </View>
    );
}
