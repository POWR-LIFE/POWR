import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { LiveEventGate } from '@/lib/api/liveEvents';
import { shortDate } from '@/lib/liveEventDisplay';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';

/**
 * The entry requirement, kept in view on the LEADERBOARD segment as one line.
 * The full ticket (share code, booking, friend list, rules) lives on the
 * EVENT segment — but the gate is the thing people must still act on all
 * week, and a requirement hidden behind a tab is how a whole board gets
 * dropped at Settle. Tapping it jumps to the ticket.
 */
export function EventGateStrip({ gate, onPress }: { gate: LiveEventGate; onPress: () => void }) {
    const have = Math.min(gate.count, gate.required);
    const deadline = gate.deadline_at ? ` by ${shortDate(gate.deadline_at)}` : '';
    const text = gate.met
        ? `${have}/${gate.required} friends in · your place is secured`
        : gate.mode === 'deadline'
            ? `${have}/${gate.required} friends in · keep your place${deadline}`
            : `${have}/${gate.required} friends in · unlocks the board${deadline}`;

    return (
        <Pressable
            onPress={() => { Haptics.selectionAsync(); onPress(); }}
            style={({ pressed }) => [styles.strip, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={`${text}. Opens your ticket.`}
        >
            <Ionicons
                name={gate.met ? 'checkmark-circle-outline' : 'people-outline'}
                size={14}
                color={GOLD}
            />
            <Text style={styles.text} numberOfLines={1}>{text}</Text>
            <View style={styles.cta}>
                <Text style={styles.ctaText}>{gate.met ? 'TICKET' : 'INVITE'}</Text>
                <Ionicons name="chevron-forward" size={12} color={GOLD} />
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    strip: {
        marginHorizontal: 14,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.25)',
        backgroundColor: 'rgba(232,210,0,0.06)',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    text: { flex: 1, fontSize: 11, fontWeight: '400', color: TEXT },
    cta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    ctaText: { fontSize: 9, fontWeight: '800', color: GOLD, letterSpacing: 1.5 },
});
