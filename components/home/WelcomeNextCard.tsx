import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.45)';
const MUTED = 'rgba(255,255,255,0.25)';

const DISMISS_KEY = 'welcome-next-dismissed';

export type WelcomeStepKey = 'health' | 'discover' | 'log';

interface Step {
    key: WelcomeStepKey;
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    hint: string;
    done: boolean;
    onPress: () => void;
}

interface Props {
    healthConnected: boolean;
    hasActivity: boolean;
    onConnectHealth: () => void;
    onFindGym: () => void;
    onLogWorkout: () => void;
}

export function WelcomeNextCard({
    healthConnected,
    hasActivity,
    onConnectHealth,
    onFindGym,
    onLogWorkout,
}: Props) {
    const [hidden, setHidden] = useState<boolean | null>(null);
    const fade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        (async () => {
            const v = await AsyncStorage.getItem(DISMISS_KEY);
            setHidden(v === '1');
        })();
    }, []);

    useEffect(() => {
        if (hidden === false) {
            Animated.timing(fade, {
                toValue: 1,
                duration: 420,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        }
    }, [hidden]);

    const steps: Step[] = [
        {
            key: 'health',
            icon: 'pulse-outline',
            title: 'Connect your health data',
            hint: 'Sync steps and workouts automatically',
            done: healthConnected,
            onPress: onConnectHealth,
        },
        {
            key: 'discover',
            icon: 'location-outline',
            title: 'Find a partner gym near you',
            hint: 'Earn POWR just for turning up',
            done: false,
            onPress: onFindGym,
        },
        {
            key: 'log',
            icon: 'add-circle-outline',
            title: 'Log your first workout',
            hint: 'Or let auto-tracking catch it for you',
            done: hasActivity,
            onPress: onLogWorkout,
        },
    ];

    const completedCount = steps.filter(s => s.done).length;
    const allDone = completedCount === steps.length;

    useEffect(() => {
        if (allDone && hidden === false) {
            AsyncStorage.setItem(DISMISS_KEY, '1').then(() => {
                Animated.timing(fade, {
                    toValue: 0,
                    duration: 420,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }).start(() => setHidden(true));
            });
        }
    }, [allDone, hidden]);

    const handleDismiss = () => {
        AsyncStorage.setItem(DISMISS_KEY, '1');
        Animated.timing(fade, {
            toValue: 0,
            duration: 300,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
        }).start(() => setHidden(true));
    };

    if (hidden !== false) return null;

    return (
        <Animated.View style={[styles.card, { opacity: fade }]}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.eyebrow}>WELCOME TO POWR</Text>
                    <Text style={styles.title}>Here's what's next</Text>
                </View>
                <Pressable
                    onPress={handleDismiss}
                    hitSlop={14}
                    style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
                >
                    <Ionicons name="close" size={16} color={MUTED} />
                </Pressable>
            </View>

            <View style={styles.progressRow}>
                {steps.map((s, i) => (
                    <View
                        key={s.key}
                        style={[
                            styles.segment,
                            s.done ? styles.segmentDone : styles.segmentIdle,
                            i === 0 && { marginLeft: 0 },
                        ]}
                    />
                ))}
            </View>

            <View style={styles.steps}>
                {steps.map((s) => (
                    <Pressable
                        key={s.key}
                        onPress={s.done ? undefined : s.onPress}
                        style={({ pressed }) => [
                            styles.step,
                            pressed && !s.done && { backgroundColor: 'rgba(255,255,255,0.03)' },
                        ]}
                    >
                        <View style={[styles.stepIcon, s.done && styles.stepIconDone]}>
                            {s.done ? (
                                <Ionicons name="checkmark" size={14} color={GOLD} />
                            ) : (
                                <Ionicons name={s.icon} size={14} color={GOLD} />
                            )}
                        </View>
                        <View style={styles.stepText}>
                            <Text
                                style={[styles.stepTitle, s.done && styles.stepTitleDone]}
                                numberOfLines={1}
                            >
                                {s.title}
                            </Text>
                            <Text style={styles.stepHint} numberOfLines={1}>
                                {s.done ? 'Done' : s.hint}
                            </Text>
                        </View>
                        {!s.done && (
                            <Ionicons name="chevron-forward" size={14} color={MUTED} />
                        )}
                    </Pressable>
                ))}
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 4,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.2)',
        backgroundColor: 'rgba(232,210,0,0.04)',
        padding: 14,
        gap: 12,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    eyebrow: {
        fontSize: 9,
        fontWeight: '600',
        letterSpacing: 2,
        color: GOLD,
        opacity: 0.85,
        marginBottom: 4,
    },
    title: {
        fontSize: 20,
        fontWeight: '300',
        color: TEXT,
        letterSpacing: -0.3,
    },
    close: {
        padding: 2,
        marginTop: -2,
    },
    progressRow: {
        flexDirection: 'row',
        gap: 4,
    },
    segment: {
        flex: 1,
        height: 2,
        borderRadius: 1,
    },
    segmentIdle: {
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    segmentDone: {
        backgroundColor: GOLD,
    },
    steps: {
        gap: 2,
    },
    step: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 4,
        borderRadius: 10,
    },
    stepIcon: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: 'rgba(232,210,0,0.08)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(232,210,0,0.24)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    stepIconDone: {
        backgroundColor: 'rgba(232,210,0,0.16)',
    },
    stepText: {
        flex: 1,
        gap: 2,
    },
    stepTitle: {
        fontSize: 13,
        fontWeight: '400',
        color: TEXT,
        letterSpacing: -0.1,
    },
    stepTitleDone: {
        color: DIM,
        textDecorationLine: 'line-through',
    },
    stepHint: {
        fontSize: 11,
        fontWeight: '300',
        color: DIM,
    },
});
