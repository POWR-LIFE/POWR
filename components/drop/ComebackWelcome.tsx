import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DropMark } from '@/components/drop/DropMark';
import { colours, fontFamily } from '@/constants/tokens';

/**
 * Comeback — the first open after days away is an event, not a verdict.
 * Instead of meeting a dead streak, the member meets a doubled start. Shown
 * once per lapse, then the Drop card carries it (COMEBACK badge, LIGHT as the
 * easy start). Same dark stage as the Drop reveal so the two feel like one
 * family, but a tap, not a hold: there's nothing to earn yet.
 */

const BG = '#070707';
const MARK_H = 64;

export interface ComebackWelcomeProps {
    visible: boolean;
    daysAway: number;
    doubleUpTo: number;
    onDone: () => void;
}

export function ComebackWelcome({ visible, daysAway, doubleUpTo, onDone }: ComebackWelcomeProps) {
    const insets = useSafeAreaInsets();
    const fill = useSharedValue(0);
    const textIn = useSharedValue(0);

    useEffect(() => {
        if (!visible) return;
        fill.value = 0;
        textIn.value = 0;
        fill.value = withDelay(300, withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.cubic) }));
        textIn.value = withDelay(1100, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
        const t = setTimeout(() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }, 1250);
        return () => clearTimeout(t);
    }, [visible, fill, textIn]);

    const textStyle = useAnimatedStyle(() => ({
        opacity: textIn.value,
        transform: [{ translateY: (1 - textIn.value) * 14 }],
    }));

    return (
        <Modal visible={visible} animationType="fade" transparent={false} statusBarTranslucent onRequestClose={onDone}>
            <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
                <Text style={styles.kicker}>COMEBACK</Text>

                <View style={styles.stage}>
                    <DropMark height={MARK_H} fill={fill} stroke={1.2} tint={0.04} />

                    <Animated.View style={[styles.copy, textStyle]}>
                        <Text style={styles.big}>2×</Text>
                        <Text style={styles.unit}>YOUR FIRST {doubleUpTo} POWR TODAY</Text>
                        <Text style={styles.body}>
                            {daysAway} days off. It happens.{'\n'}Move today and it counts double.
                        </Text>
                    </Animated.View>
                </View>

                <Animated.View style={[styles.footer, textStyle]}>
                    <Pressable
                        onPress={onDone}
                        accessibilityRole="button"
                        accessibilityLabel="Let’s go"
                        style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
                    >
                        <Text style={styles.btnText}>LET’S GO</Text>
                    </Pressable>
                    <Text style={styles.fine}>Start with an easy target today.</Text>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: BG, paddingHorizontal: 24 },
    kicker: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 2.2, color: colours.accent, minHeight: 24, lineHeight: 24 },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 36 },
    copy: { alignItems: 'center' },
    big: {
        fontFamily: fontFamily.extraLight,
        fontSize: 96,
        lineHeight: 104,
        letterSpacing: -3,
        color: colours.accent,
    },
    unit: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 2.4, color: '#F2F2F2' },
    body: {
        fontFamily: fontFamily.light,
        fontSize: 14,
        lineHeight: 21,
        color: 'rgba(255,255,255,0.5)',
        textAlign: 'center',
        marginTop: 14,
    },
    footer: { alignItems: 'center', gap: 14 },
    btn: { backgroundColor: colours.accent, borderRadius: 20, paddingHorizontal: 34, paddingVertical: 11 },
    btnText: { fontFamily: fontFamily.bold, fontSize: 12, letterSpacing: 1.5, color: colours.onAccent },
    fine: { fontFamily: fontFamily.light, fontSize: 11.5, color: 'rgba(255,255,255,0.35)' },
});
