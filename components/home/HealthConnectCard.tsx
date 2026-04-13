import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM = 'rgba(255,255,255,0.45)';
const CARD = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';

interface Props {
    onConnect: () => void;
    onDismiss?: () => void;
    requesting?: boolean;
}

export function HealthConnectCard({ onConnect, onDismiss, requesting }: Props) {
    const pulseAnim = useRef(new Animated.Value(0.6)).current;

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
                Animated.timing(pulseAnim, { toValue: 0.6, duration: 1200, useNativeDriver: true }),
            ])
        ).start();
    }, [pulseAnim]);

    const platformName = Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect';
    const platformIcon = Platform.OS === 'ios' ? 'apple' : 'heart-pulse';

    return (
        <View style={styles.card}>
            {/* Gold accent */}
            <View style={styles.accentBar} />

            <View style={styles.content}>
                {/* Header */}
                <View style={styles.header}>
                    <View style={styles.headerLeft}>
                        <Animated.View style={[styles.iconWrap, { opacity: pulseAnim }]}>
                            {Platform.OS === 'ios' ? (
                                <Ionicons name="heart" size={18} color="#FF3B30" />
                            ) : (
                                <MaterialCommunityIcons name="heart-pulse" size={18} color="#4285F4" />
                            )}
                        </Animated.View>
                        <Text style={styles.title}>Connect {platformName}</Text>
                    </View>
                    {onDismiss && (
                        <Pressable onPress={onDismiss} hitSlop={12} style={styles.dismissBtn}>
                            <Ionicons name="close" size={14} color={MUTED} />
                        </Pressable>
                    )}
                </View>

                {/* Benefits */}
                <View style={styles.benefits}>
                    <View style={styles.benefitRow}>
                        <Ionicons name="footsteps" size={13} color={GOLD} />
                        <Text style={styles.benefitText}>Auto-track steps & earn points passively</Text>
                    </View>
                    <View style={styles.benefitRow}>
                        <Ionicons name="shield-checkmark" size={13} color={GOLD} />
                        <Text style={styles.benefitText}>Verified workouts earn <Text style={styles.goldText}>2x points</Text></Text>
                    </View>
                    <View style={styles.benefitRow}>
                        <Ionicons name="trending-up" size={13} color={GOLD} />
                        <Text style={styles.benefitText}>Track sleep, heart rate & calories</Text>
                    </View>
                </View>

                {/* CTA */}
                <Pressable
                    style={({ pressed }) => [styles.connectBtn, pressed && { opacity: 0.8 }]}
                    onPress={onConnect}
                    disabled={requesting}
                >
                    <Text style={styles.connectText}>
                        {requesting ? 'CONNECTING...' : 'CONNECT NOW'}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        backgroundColor: CARD,
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.15)',
        borderRadius: 16,
        overflow: 'hidden',
    },
    accentBar: {
        width: 3,
        backgroundColor: GOLD,
        opacity: 0.7,
    },
    content: {
        flex: 1,
        padding: 14,
        gap: 12,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    iconWrap: {
        width: 32,
        height: 32,
        borderRadius: 10,
        backgroundColor: 'rgba(255,255,255,0.06)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: 14,
        fontWeight: '500',
        color: TEXT,
        letterSpacing: -0.2,
    },
    dismissBtn: {
        padding: 4,
    },
    benefits: {
        gap: 6,
    },
    benefitRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    benefitText: {
        fontSize: 11,
        fontWeight: '300',
        color: DIM,
    },
    goldText: {
        color: GOLD,
        fontWeight: '500',
    },
    connectBtn: {
        height: 40,
        borderRadius: 20,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
    },
    connectText: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1.5,
        color: '#0a0a0a',
    },
});
