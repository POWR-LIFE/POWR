import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { fontFamily } from '@/constants/tokens';
import type { RecapData } from '@/hooks/useWeeklyRecap';

const GOLD = '#E8D200';
const GREEN = '#4ade80';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const FAINT = '#444444';

const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * "Your Week" — the recap doorway that takes the top of the This Week slot for
 * the first days of a new week. Headline numbers only; the full story lives in
 * WeeklyRecapSheet, one tap in. Compact on purpose: the new week's challenges
 * render directly beneath, and this must not bury them. Borderless on the same
 * dark ground as the other home cards — the gold numeral carries the moment.
 */
export function WeeklyRecapCard({
    data,
    onOpen,
    onDismiss,
}: {
    data: RecapData;
    onOpen: () => void;
    onDismiss: () => void;
}) {
    const enter = useSharedValue(0);
    useEffect(() => {
        enter.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
    }, [enter]);
    const enterStyle = useAnimatedStyle(() => ({
        opacity: enter.value,
        transform: [{ translateY: (1 - enter.value) * 10 }],
    }));

    const activeDayCount = data.activeDays.filter(Boolean).length;
    const challengeTotal = data.challenges.length;
    const delta = data.pointsWeekBefore != null ? data.pointsEarned - data.pointsWeekBefore : null;

    return (
        <View>
            <View style={styles.sectionRow}>
                <View style={styles.sectionTitleRow}>
                    <Text style={styles.sectionLabel}>YOUR WEEK</Text>
                    <Text style={styles.sectionCount}>{data.weekLabel}</Text>
                </View>
                <Pressable hitSlop={10} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss weekly recap">
                    <Ionicons name="close" size={14} color={FAINT} />
                </Pressable>
            </View>

            <Animated.View style={enterStyle}>
                <Pressable
                    onPress={onOpen}
                    accessibilityRole="button"
                    accessibilityLabel="See your full week"
                    style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
                >
                    <View style={styles.headline}>
                        <View style={styles.ptsWrap}>
                            <Text style={styles.pts}>{data.pointsEarned.toLocaleString()}</Text>
                            <Text style={styles.ptsUnit}>pts</Text>
                        </View>
                        <Text style={styles.ptsLabel}>EARNED LAST WEEK</Text>
                        {delta != null && delta > 0 && (
                            <View style={styles.deltaRow}>
                                <Ionicons name="trending-up" size={11} color={GREEN} />
                                <Text style={styles.deltaText}>up {delta.toLocaleString()} on the week before</Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.statsRow}>
                        <View style={styles.stat}>
                            <Text style={styles.statValue}>
                                {data.challengesCompleted}
                                <Text style={styles.statDenom}>/{challengeTotal}</Text>
                            </Text>
                            <Text style={styles.statLabel}>CHALLENGES</Text>
                        </View>
                        <View style={styles.stat}>
                            <Text style={styles.statValue}>
                                {activeDayCount}
                                <Text style={styles.statDenom}>/7</Text>
                            </Text>
                            <Text style={styles.statLabel}>ACTIVE DAYS</Text>
                        </View>
                        <View style={styles.dayStrip}>
                            {data.activeDays.map((on, i) => (
                                <View key={i} style={styles.dayCol}>
                                    <View style={[styles.dayDash, on && styles.dayDashOn]} />
                                    <Text style={[styles.dayInitial, on && styles.dayInitialOn]}>{DAY_INITIALS[i]}</Text>
                                </View>
                            ))}
                        </View>
                    </View>

                    <View style={styles.ctaRow}>
                        <Text style={styles.ctaText}>SEE YOUR FULL WEEK</Text>
                        <Ionicons name="chevron-forward" size={11} color={GOLD} />
                    </View>
                </Pressable>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    // section header — sibling of THIS WEEK's, so the two bands read as kin
    sectionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingTop: 16,
        marginTop: 8,
        marginBottom: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(255,255,255,0.07)',
    },
    sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sectionLabel: {
        fontFamily: fontFamily.medium,
        fontSize: 9,
        letterSpacing: 2,
        color: GOLD,
        textTransform: 'uppercase',
    },
    sectionCount: { fontFamily: fontFamily.regular, fontSize: 10, color: MUTED },

    card: {
        backgroundColor: '#111111',
        borderRadius: 22,
        paddingHorizontal: 18,
        paddingTop: 22,
        overflow: 'hidden',
    },

    headline: { alignItems: 'center', gap: 3 },
    ptsWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
    pts: { fontFamily: fontFamily.extraLight, fontSize: 52, color: GOLD, letterSpacing: -2, lineHeight: 54 },
    ptsUnit: { fontFamily: fontFamily.semiBold, fontSize: 14, color: GOLD, opacity: 0.7, marginBottom: 7 },
    ptsLabel: {
        fontFamily: fontFamily.regular,
        fontSize: 8.5,
        color: SECONDARY,
        letterSpacing: 2.5,
        marginTop: 2,
    },
    deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
    deltaText: { fontFamily: fontFamily.regular, fontSize: 10.5, color: GREEN },

    statsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 22,
        marginTop: 20,
    },
    stat: { alignItems: 'center', gap: 3 },
    statValue: { fontFamily: fontFamily.light, fontSize: 19, color: TEXT, letterSpacing: -0.3 },
    statDenom: { fontSize: 12, color: MUTED },
    statLabel: { fontFamily: fontFamily.regular, fontSize: 7.5, color: MUTED, letterSpacing: 1.5 },

    dayStrip: { flexDirection: 'row', gap: 4, marginLeft: 2 },
    dayCol: { alignItems: 'center', gap: 4 },
    dayDash: { width: 10, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.1)' },
    dayDashOn: { backgroundColor: GREEN },
    dayInitial: { fontFamily: fontFamily.regular, fontSize: 7, color: FAINT },
    dayInitialOn: { color: SECONDARY },

    ctaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingVertical: 13,
        marginTop: 18,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(255,255,255,0.07)',
    },
    ctaText: { fontFamily: fontFamily.medium, fontSize: 9.5, color: GOLD, letterSpacing: 1.8 },
});
