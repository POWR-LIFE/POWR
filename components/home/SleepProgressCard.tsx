import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { type SleepSession } from '@/hooks/useHealthData';

const INDIGO = '#6366F1';
const GOLD   = '#E8D200';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.45)';

function sleepPoints(hours: number): number {
    if (hours >= 8) return 5;
    if (hours >= 7) return 4;
    if (hours >= 6) return 3;
    if (hours >= 5) return 2;
    if (hours >= 4) return 1;
    return 0;
}

interface Props {
    sleep: SleepSession | null;
    loading?: boolean;
}

export function SleepProgressCard({ sleep, loading }: Props) {
    if (loading) {
        return (
            <View style={styles.card}>
                <View style={styles.iconWrap}>
                    <Ionicons name="moon" size={20} color={INDIGO} />
                </View>
                <View style={styles.body}>
                    <Text style={styles.label}>Sleep</Text>
                    <ActivityIndicator size="small" color={MUTED} style={{ alignSelf: 'flex-start' }} />
                </View>
            </View>
        );
    }

    if (!sleep) {
        return (
            <View style={styles.card}>
                <View style={styles.iconWrap}>
                    <Ionicons name="moon" size={20} color={INDIGO} />
                </View>
                <View style={styles.body}>
                    <Text style={styles.label}>Sleep</Text>
                    <Text style={styles.hint}>No sleep recorded last night</Text>
                </View>
            </View>
        );
    }

    const pts = sleepPoints(sleep.durationHours);
    const hasStages = (sleep.deepHours ?? 0) + (sleep.remHours ?? 0) > 0;

    // Progress bar: 0–9h, ideal target is 8h
    const TARGET_HOURS = 8;
    const fillPct = Math.min(sleep.durationHours / TARGET_HOURS, 1);

    return (
        <View style={styles.card}>
            <View style={[styles.iconWrap, { backgroundColor: INDIGO + '20' }]}>
                <Ionicons name="moon" size={20} color={INDIGO} />
            </View>
            <View style={styles.body}>
                <View style={styles.topRow}>
                    <Text style={styles.label}>Sleep</Text>
                    {pts > 0 && (
                        <Text style={styles.earnedBadge}>+{pts} pts earned</Text>
                    )}
                </View>
                <Text style={styles.durationText}>
                    {sleep.durationHours}h{' '}
                    <Text style={styles.targetText}>/ {TARGET_HOURS}h target</Text>
                </Text>
                <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.round(fillPct * 100)}%` as any }]} />
                </View>
                {hasStages ? (
                    <View style={styles.stagesRow}>
                        {(sleep.deepHours ?? 0) > 0 && (
                            <Text style={styles.stageText}>
                                <Text style={[styles.stageDot, { color: '#818CF8' }]}>● </Text>
                                {sleep.deepHours}h deep
                            </Text>
                        )}
                        {(sleep.remHours ?? 0) > 0 && (
                            <Text style={styles.stageText}>
                                <Text style={[styles.stageDot, { color: '#A78BFA' }]}>● </Text>
                                {sleep.remHours}h REM
                            </Text>
                        )}
                        {(sleep.lightHours ?? 0) > 0 && (
                            <Text style={styles.stageText}>
                                <Text style={[styles.stageDot, { color: DIM }]}>● </Text>
                                {sleep.lightHours}h light
                            </Text>
                        )}
                    </View>
                ) : (
                    <Text style={styles.hint}>
                        {sleep.durationHours >= 7
                            ? 'Good night — keep it up'
                            : 'Aim for 7–9 hours for full points'}
                    </Text>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    iconWrap: {
        width: 44,
        height: 44,
        borderRadius: 13,
        backgroundColor: INDIGO + '18',
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
    durationText: {
        fontSize: 15,
        fontWeight: '200',
        color: INDIGO,
        letterSpacing: -0.3,
    },
    targetText: {
        fontSize: 13,
        fontWeight: '300',
        color: DIM,
    },
    track: {
        height: 3,
        backgroundColor: INDIGO + '25',
        borderRadius: 1.5,
        overflow: 'hidden',
        marginTop: 2,
    },
    fill: {
        height: '100%',
        backgroundColor: INDIGO,
        borderRadius: 1.5,
    },
    stagesRow: {
        flexDirection: 'row',
        gap: 10,
        flexWrap: 'wrap',
    },
    stageDot: {
        fontSize: 8,
    },
    stageText: {
        fontSize: 11,
        fontWeight: '300',
        color: MUTED,
    },
    hint: {
        fontSize: 11,
        fontWeight: '300',
        color: MUTED,
    },
    earnedBadge: {
        fontSize: 11,
        fontWeight: '400',
        color: GOLD,
    },
});
