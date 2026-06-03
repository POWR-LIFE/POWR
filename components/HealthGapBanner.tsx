import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useHealthGap } from '@/hooks/useHealthGap';

const GOLD = '#E8D200';
const TEXT_PRIMARY = '#F2F2F2';
const TEXT_MUTED = 'rgba(255,255,255,0.4)';

/**
 * Self-contained home banner that nudges the user to fix a workout-tracking gap
 * (Android Health Connect workout permission, or a wearable whose workouts aren't
 * coming through). Renders nothing when there's no gap, so it's safe to always
 * mount. One-tap CTA fixes it in place; the "×" hides it for the day.
 */
export function HealthGapBanner() {
    const { hasGap, copy, resolve, dismiss } = useHealthGap();
    const [busy, setBusy] = useState(false);

    if (!hasGap || !copy) return null;

    const onResolve = async () => {
        setBusy(true);
        try { await resolve(); } finally { setBusy(false); }
    };

    return (
        <View style={styles.card}>
            <View style={styles.row}>
                <View style={styles.iconWrap}>
                    <Ionicons name="pulse" size={16} color={GOLD} />
                </View>
                <View style={styles.text}>
                    <Text style={styles.title}>{copy.title}</Text>
                    <Text style={styles.body}>{copy.body}</Text>
                </View>
                <Pressable hitSlop={10} onPress={dismiss} style={styles.dismiss}>
                    <Ionicons name="close" size={16} color={TEXT_MUTED} />
                </Pressable>
            </View>

            <Pressable
                onPress={onResolve}
                disabled={busy}
                style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
            >
                {busy
                    ? <ActivityIndicator size="small" color="#0a0a0a" />
                    : <Text style={styles.ctaText}>{copy.cta}</Text>}
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: 'rgba(232,210,0,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.15)',
        borderRadius: 14,
        padding: 14,
        gap: 12,
    },
    row: {
        flexDirection: 'row',
        gap: 12,
    },
    iconWrap: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: 'rgba(232,210,0,0.12)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        flex: 1,
        gap: 3,
    },
    title: {
        fontSize: 14,
        fontWeight: '500',
        color: TEXT_PRIMARY,
        letterSpacing: -0.2,
    },
    body: {
        fontSize: 12,
        fontWeight: '300',
        lineHeight: 17,
        color: 'rgba(255,255,255,0.55)',
    },
    dismiss: {
        alignSelf: 'flex-start',
    },
    cta: {
        backgroundColor: GOLD,
        borderRadius: 10,
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 38,
    },
    ctaText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#0a0a0a',
        letterSpacing: 0.2,
    },
});
