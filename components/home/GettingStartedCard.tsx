import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM = 'rgba(255,255,255,0.45)';

interface Props {
    /** Number of activities completed this week */
    completedCount: number;
    /** Target to complete (default 3) */
    targetCount?: number;
    onFindGym: () => void;
    onLogWorkout: () => void;
}

export function GettingStartedCard({
    completedCount,
    targetCount = 3,
    onFindGym,
    onLogWorkout,
}: Props) {
    const progressAnim = useRef(new Animated.Value(0)).current;
    const pct = Math.min(completedCount / targetCount, 1);

    useEffect(() => {
        Animated.timing(progressAnim, {
            toValue: pct,
            duration: 800,
            useNativeDriver: false,
        }).start();
    }, [pct]);

    const remaining = Math.max(targetCount - completedCount, 0);
    const isComplete = remaining === 0;

    return (
        <View style={styles.card}>
            {/* Gradient background */}
            <LinearGradient
                colors={['rgba(232,210,0,0.06)', 'rgba(232,210,0,0.02)', 'transparent']}
                locations={[0, 0.5, 1]}
                style={StyleSheet.absoluteFillObject}
            />

            <View style={styles.accentBar} />

            <View style={styles.inner}>
                {/* Top badge */}
                <View style={styles.topRow}>
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>GETTING STARTED</Text>
                    </View>
                    <View style={styles.rewardBadge}>
                        <Ionicons name="flash" size={9} color={GOLD} />
                        <Text style={styles.rewardText}>3× BONUS</Text>
                    </View>
                </View>

                {/* Title */}
                <Text style={styles.title}>
                    {isComplete ? 'Challenge complete!' : 'Your first week'}
                </Text>
                <Text style={styles.description}>
                    {isComplete
                        ? 'Great start — you\'ve unlocked your first-week bonus!'
                        : `Complete ${targetCount} activities this week to unlock a 3× point bonus on everything you do.`
                    }
                </Text>

                {/* Progress */}
                <View style={styles.progressSection}>
                    <View style={styles.progressHeader}>
                        <Text style={styles.progressLabel}>
                            {completedCount}/{targetCount} activities
                        </Text>
                        {isComplete && (
                            <View style={styles.completeBadge}>
                                <Ionicons name="checkmark-circle" size={12} color={GOLD} />
                                <Text style={styles.completeText}>UNLOCKED</Text>
                            </View>
                        )}
                    </View>
                    <View style={styles.track}>
                        <Animated.View style={[
                            styles.fill,
                            {
                                width: progressAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: ['0%', '100%'],
                                }),
                            },
                        ]} />
                        {/* Milestone markers */}
                        {Array.from({ length: targetCount }).map((_, i) => (
                            <View
                                key={i}
                                style={[
                                    styles.milestone,
                                    { left: `${((i + 1) / targetCount) * 100}%` as any },
                                    i < completedCount && styles.milestoneDone,
                                ]}
                            />
                        ))}
                    </View>
                    {!isComplete && (
                        <Text style={styles.hint}>
                            {remaining === 1
                                ? 'Just 1 more to go — gym visit, walk, or manual log all count!'
                                : `${remaining} more to go — any activity counts!`
                            }
                        </Text>
                    )}
                </View>

                {/* Quick actions */}
                {!isComplete && (
                    <View style={styles.actions}>
                        <Pressable
                            style={({ pressed }) => [styles.actionBtn, styles.actionPrimary, pressed && { opacity: 0.8 }]}
                            onPress={onFindGym}
                        >
                            <Ionicons name="location" size={14} color="#0a0a0a" />
                            <Text style={styles.actionPrimaryText}>FIND A GYM</Text>
                        </Pressable>
                        <Pressable
                            style={({ pressed }) => [styles.actionBtn, styles.actionSecondary, pressed && { opacity: 0.8 }]}
                            onPress={onLogWorkout}
                        >
                            <Ionicons name="add-circle-outline" size={14} color={TEXT} />
                            <Text style={styles.actionSecondaryText}>LOG WORKOUT</Text>
                        </Pressable>
                    </View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        overflow: 'hidden',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.15)',
        backgroundColor: 'rgba(40,40,40,0.85)',
    },
    accentBar: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 2,
        backgroundColor: GOLD,
        opacity: 0.9,
    },
    inner: {
        padding: 14,
        gap: 10,
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    badge: {
        backgroundColor: 'rgba(232,210,0,0.12)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.28)',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    badgeText: {
        fontSize: 8,
        fontWeight: '700',
        letterSpacing: 1.5,
        color: GOLD,
        opacity: 0.85,
    },
    rewardBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: 'rgba(232,210,0,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.2)',
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 3,
    },
    rewardText: {
        fontSize: 8,
        fontWeight: '600',
        letterSpacing: 1,
        color: GOLD,
    },
    title: {
        fontSize: 24,
        fontWeight: '200',
        color: TEXT,
        letterSpacing: -0.5,
    },
    description: {
        fontSize: 12,
        fontWeight: '300',
        color: DIM,
        lineHeight: 18,
    },
    progressSection: {
        gap: 6,
    },
    progressHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    progressLabel: {
        fontSize: 11,
        fontWeight: '500',
        color: GOLD,
        letterSpacing: 0.3,
    },
    completeBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    completeText: {
        fontSize: 9,
        fontWeight: '600',
        letterSpacing: 1,
        color: GOLD,
    },
    track: {
        height: 4,
        backgroundColor: 'rgba(232,210,0,0.12)',
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative',
    },
    fill: {
        height: '100%',
        backgroundColor: GOLD,
        borderRadius: 2,
    },
    milestone: {
        position: 'absolute',
        top: -1,
        width: 2,
        height: 6,
        marginLeft: -1,
        backgroundColor: 'rgba(255,255,255,0.15)',
        borderRadius: 1,
    },
    milestoneDone: {
        backgroundColor: 'rgba(232,210,0,0.4)',
    },
    hint: {
        fontSize: 10,
        fontWeight: '300',
        color: MUTED,
    },
    actions: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 2,
    },
    actionBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 36,
        borderRadius: 18,
    },
    actionPrimary: {
        backgroundColor: GOLD,
    },
    actionPrimaryText: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1.2,
        color: '#0a0a0a',
    },
    actionSecondary: {
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)',
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    actionSecondaryText: {
        fontSize: 10,
        fontWeight: '600',
        letterSpacing: 1.2,
        color: TEXT,
    },
});
