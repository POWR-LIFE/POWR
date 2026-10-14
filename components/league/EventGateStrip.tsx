import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

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
    const { t } = useTranslation();
    const have = Math.min(gate.count, gate.required);
    const date = gate.deadline_at ? shortDate(gate.deadline_at) : null;
    const values = { have, required: gate.required, date };
    const text = gate.met
        ? t('events:gateStrip.met', values)
        : gate.mode === 'deadline'
            ? date ? t('events:gateStrip.keepPlaceBy', values) : t('events:gateStrip.keepPlace', values)
            : date ? t('events:gateStrip.unlocksBy', values) : t('events:gateStrip.unlocks', values);

    return (
        <Pressable
            onPress={() => { Haptics.selectionAsync(); onPress(); }}
            style={({ pressed }) => [styles.strip, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={t('events:gateStrip.a11y', { text })}
        >
            <Ionicons
                name={gate.met ? 'checkmark-circle-outline' : 'people-outline'}
                size={14}
                color={GOLD}
            />
            <Text style={styles.text} numberOfLines={1}>{text}</Text>
            <View style={styles.cta}>
                <Text style={styles.ctaText}>{gate.met ? t('events:gateStrip.ticket') : t('events:gateStrip.invite')}</Text>
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
