import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { type WalkingProgressState } from '@/hooks/useWalkingProgress';

const GREEN  = '#4AF2A1';
const GOLD   = '#E8D200';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.45)';
const CARD   = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';

interface Props {
    progress: WalkingProgressState;
}

export function WalkingProgressCard({ progress }: Props) {
    const {
        isAvailable,
        isAuthorized,
        stepsToday,
        pointsEarned,
        pointsAtNext,
        nextThreshold,
        stepsToNext,
        loading,
        requestPermissions,
    } = progress;

    // Don't render on web or if health platform not present
    if (!isAvailable) return null;

    // Prompt to connect health
    if (!isAuthorized) {
        return (
            <Pressable
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
                onPress={requestPermissions}
            >
                <View style={styles.iconWrap}>
                    <Ionicons name="footsteps" size={22} color={GREEN} />
                </View>
                <View style={styles.body}>
                    <Text style={styles.label}>Walking</Text>
                    <Text style={styles.connectHint}>Connect Health to auto-track steps & earn points</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={MUTED} />
            </Pressable>
        );
    }

    if (loading) {
        return (
            <View style={styles.card}>
                <View style={styles.iconWrap}>
                    <Ionicons name="footsteps" size={22} color={GREEN} />
                </View>
                <View style={styles.body}>
                    <Text style={styles.label}>Walking</Text>
                    <ActivityIndicator size="small" color={MUTED} style={{ alignSelf: 'flex-start' }} />
                </View>
            </View>
        );
    }

    // Maximum tier reached — compact "done" state
    if (!nextThreshold) {
        return (
            <View style={[styles.card, styles.cardDone]}>
                <View style={[styles.iconWrap, { backgroundColor: GREEN + '20' }]}>
                    <Ionicons name="footsteps" size={22} color={GREEN} />
                </View>
                <View style={styles.body}>
                    <Text style={styles.label}>Walking</Text>
                    <Text style={styles.stepsText}>{stepsToday.toLocaleString()} steps</Text>
                </View>
                <View style={styles.doneBadge}>
                    <Ionicons name="checkmark-circle" size={14} color={GREEN} />
                    <Text style={styles.donePts}>+{pointsEarned} pts</Text>
                </View>
            </View>
        );
    }

    // Work out progress bar fill
    const tierStart = nextThreshold === 4000 ? 0
        : nextThreshold === 6000 ? 4000
        : nextThreshold === 8000 ? 6000
        : 8000;
    const tierRange  = nextThreshold - tierStart;
    const tierInto   = Math.max(0, stepsToday - tierStart);
    const fillPct    = Math.min(tierInto / tierRange, 1);

    // Status line
    let statusText: string;
    if (stepsToday === 0) {
        statusText = `Start walking · 4,000 steps to earn 2 pts`;
    } else if (pointsEarned === 0) {
        statusText = `${stepsToNext.toLocaleString()} more to earn 2 pts`;
    } else {
        statusText = `+${stepsToNext.toLocaleString()} steps for +${pointsAtNext - pointsEarned} more pts`;
    }

    return (
        <View style={styles.card}>
            <View style={[styles.iconWrap, { backgroundColor: GREEN + '18' }]}>
                <Ionicons name="footsteps" size={22} color={GREEN} />
            </View>
            <View style={styles.body}>
                <View style={styles.topRow}>
                    <Text style={styles.label}>Walking</Text>
                    {pointsEarned > 0 && (
                        <Text style={[styles.earnedBadge, { color: GOLD }]}>+{pointsEarned} pts earned</Text>
                    )}
                </View>
                <Text style={styles.stepsText}>
                    {stepsToday.toLocaleString()} <Text style={styles.stepsGoal}>/ {nextThreshold.toLocaleString()} steps</Text>
                </Text>
                {/* Progress bar */}
                <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.round(fillPct * 100)}%` as any }]} />
                </View>
                <Text style={styles.statusText}>{statusText}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: CARD,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 16,
        padding: 14,
    },
    cardDone: {
        borderColor: GREEN + '30',
    },
    iconWrap: {
        width: 44,
        height: 44,
        borderRadius: 13,
        backgroundColor: 'rgba(74,242,161,0.10)',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    body: {
        flex: 1,
        gap: 4,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    label: {
        fontSize: 13,
        fontWeight: '400',
        color: TEXT,
        letterSpacing: -0.1,
    },
    stepsText: {
        fontSize: 15,
        fontWeight: '200',
        color: GREEN,
        letterSpacing: -0.3,
    },
    stepsGoal: {
        fontSize: 13,
        fontWeight: '300',
        color: DIM,
    },
    track: {
        height: 3,
        backgroundColor: 'rgba(74,242,161,0.12)',
        borderRadius: 1.5,
        overflow: 'hidden',
        marginTop: 2,
    },
    fill: {
        height: '100%',
        backgroundColor: GREEN,
        borderRadius: 1.5,
    },
    statusText: {
        fontSize: 11,
        fontWeight: '300',
        color: MUTED,
        marginTop: 1,
    },
    connectHint: {
        fontSize: 11,
        fontWeight: '300',
        color: MUTED,
    },
    earnedBadge: {
        fontSize: 11,
        fontWeight: '400',
    },
    doneBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
    },
    donePts: {
        fontSize: 13,
        fontWeight: '400',
        color: GREEN,
    },
});
