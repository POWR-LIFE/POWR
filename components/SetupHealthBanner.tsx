import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import PermissionFixScreen from '@/components/PermissionFixScreen';
import { useSetupHealth } from '@/hooks/useSetupHealth';

const GOLD = '#E8D200';
const TEXT_PRIMARY = '#F2F2F2';
const TEXT_MUTED = 'rgba(255,255,255,0.4)';

/**
 * Home-screen card shown ONLY when the device's own background context has
 * recorded that it tried to do the work and was refused — see
 * lib/backgroundHealth.ts for why that is the only trustworthy signal.
 *
 * Deliberately NOT a permanent setup checklist. A resident "Setup: 2 of 4" badge
 * was considered and rejected: it reads as nagware, it scolds people who declined
 * on purpose, and it contradicts the premise that POWR earns for you without
 * being tended. This card is consequence-anchored — it appears only while the
 * user is provably losing every passive check-in, and it retires itself the next
 * time a sweep succeeds.
 *
 * Copy states the LOSS, not the setting. "Your permissions are wrong" is our
 * problem; "you're not earning in your pocket" is theirs.
 */
export function SetupHealthBanner() {
    const { verdict, hasGap, resolved, dismiss } = useSetupHealth();
    const [fixing, setFixing] = useState(false);

    if (!hasGap || !verdict) return null;

    return (
        <>
            <View style={styles.card}>
                <View style={styles.row}>
                    <View style={styles.iconWrap}>
                        <Ionicons name="location-outline" size={16} color={GOLD} />
                    </View>
                    <View style={styles.text}>
                        <Text style={styles.title}>Check-ins aren’t running</Text>
                        <Text style={styles.body}>
                            POWR tried to check you in from your pocket and couldn’t — background
                            location is switched off, so gym trips with the app closed earn nothing.
                        </Text>
                    </View>
                    <Pressable hitSlop={10} onPress={dismiss} style={styles.dismiss}>
                        <Ionicons name="close" size={16} color={TEXT_MUTED} />
                    </Pressable>
                </View>

                <Pressable
                    onPress={() => setFixing(true)}
                    style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
                >
                    <Text style={styles.ctaText}>FIX IT</Text>
                </Pressable>
            </View>

            <PermissionFixScreen
                kind={fixing ? verdict : null}
                onClose={() => {
                    setFixing(false);
                    // PermissionFixScreen self-closes the moment the underlying
                    // permission actually flips, but it also closes on a plain
                    // dismiss — so re-derive rather than assuming success.
                    resolved();
                }}
            />
        </>
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
