import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
    Easing,
    cancelAnimation,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DROP_GAP_DEG, DROP_MARK_ASPECT, DropMark } from '@/components/drop/DropMark';
import { colours, fontFamily } from '@/constants/tokens';
import type { DropReward } from '@/lib/drop';

/**
 * The reveal. No wheel, no confetti: the screen goes dark, a thin gold P
 * appears, and holding it fills it. Let go early and it drains — the hold is
 * the commitment, the same gesture as the Vault door. Full, it cracks along
 * its own gap and what's inside comes up where the P was.
 */

const HOLD_MS = 1600;
const TICK_MS = 260;
const MARK_H = 150;
const BG = '#070707';

export interface DropRevealProps {
    visible: boolean;
    /** Top-left line: "TODAY’S DROP · PUSH", "CREW DROP · 4 OF YOU". */
    kicker: string;
    /** Under HOLD TO OPEN: "Drop · opened by moving". */
    subtitle: string;
    /** Decided before the hold starts; the hold only reveals it. */
    reward: DropReward | null;
    /** The hold completed — the caller records the open. */
    onOpened: () => void;
    onClose: () => void;
}

export function DropReveal({ visible, kicker, subtitle, reward, onOpened, onClose }: DropRevealProps) {
    const insets = useSafeAreaInsets();
    const [opened, setOpened] = useState(false);
    const ticks = useRef<ReturnType<typeof setInterval> | null>(null);

    const charge = useSharedValue(0);
    const split = useSharedValue(0);
    const flash = useSharedValue(0);
    const intro = useSharedValue(0);
    const prompt = useSharedValue(0.5);
    const rewardIn = useSharedValue(0);

    const stopTicks = () => {
        if (ticks.current) clearInterval(ticks.current);
        ticks.current = null;
    };

    useEffect(() => {
        if (!visible) return;
        setOpened(false);
        charge.value = 0;
        split.value = 0;
        flash.value = 0;
        rewardIn.value = 0;
        intro.value = 0;
        intro.value = withDelay(250, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
        prompt.value = withRepeat(withSequence(
            withTiming(1, { duration: 1100 }),
            withTiming(0.45, { duration: 1100 }),
        ), -1);
        return stopTicks;
    }, [visible, charge, split, flash, rewardIn, intro, prompt]);

    const crack = useCallback(() => {
        stopTicks();
        setOpened(true);
        onOpened();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        // The light line is gone before the reward lands where it was.
        flash.value = withSequence(
            withTiming(1, { duration: 80 }),
            withTiming(0, { duration: 340 }),
        );
        split.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
        rewardIn.value = withDelay(400, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
    }, [onOpened, flash, split, rewardIn]);

    const startHold = () => {
        if (opened) return;
        Haptics.selectionAsync().catch(() => {});
        stopTicks();
        ticks.current = setInterval(() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }, TICK_MS);
        const remaining = HOLD_MS * (1 - charge.value);
        charge.value = withTiming(1, { duration: remaining, easing: Easing.linear }, finished => {
            if (finished) runOnJS(crack)();
        });
    };

    const endHold = () => {
        if (opened) return;
        stopTicks();
        cancelAnimation(charge);
        charge.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.quad) });
    };

    const markWrap = useAnimatedStyle(() => ({
        opacity: intro.value,
        transform: [{ scale: 0.94 + intro.value * 0.06 + charge.value * 0.04 }],
    }));
    const promptStyle = useAnimatedStyle(() => ({
        opacity: (1 - split.value) * intro.value * prompt.value,
    }));
    const flashStyle = useAnimatedStyle(() => ({
        opacity: flash.value,
        transform: [{ rotate: `${DROP_GAP_DEG}deg` }, { scaleY: 0.6 + flash.value * 0.8 }],
    }));
    const rewardStyle = useAnimatedStyle(() => ({
        opacity: rewardIn.value,
        transform: [{ translateY: (1 - rewardIn.value) * 18 }],
    }));
    const doneStyle = useAnimatedStyle(() => ({ opacity: rewardIn.value }));

    const markW = MARK_H * DROP_MARK_ASPECT;

    return (
        <Modal visible={visible} animationType="fade" transparent={false} statusBarTranslucent onRequestClose={onClose}>
            <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
                <View style={styles.topRow}>
                    <Text style={styles.kicker}>{kicker}</Text>
                    {!opened && (
                        <Pressable onPress={onClose} hitSlop={14} accessibilityRole="button" accessibilityLabel="Close">
                            <Ionicons name="close" size={20} color="rgba(255,255,255,0.35)" />
                        </Pressable>
                    )}
                </View>

                <Pressable
                    style={styles.stage}
                    onPressIn={startHold}
                    onPressOut={endHold}
                    disabled={opened}
                    accessibilityRole="button"
                    accessibilityLabel="Open your Drop"
                    accessibilityHint="Press and hold until the P fills"
                >
                    <Animated.View style={[{ width: markW, height: MARK_H }, markWrap]}>
                        <DropMark height={MARK_H} fill={charge} split={split} stroke={1.2} tint={0.04} />
                        <Animated.View pointerEvents="none" style={[styles.flash, { left: markW * 0.543, height: MARK_H * 1.25, top: -MARK_H * 0.125 }, flashStyle]} />
                    </Animated.View>

                    {/* Under the P, not at the screen's foot — the instruction
                        belongs to the object. Out of flow so the P stays centred. */}
                    <Animated.View pointerEvents="none" style={[styles.promptWrap, { top: '50%', marginTop: MARK_H / 2 + 44 }, promptStyle]}>
                        <Text style={styles.prompt}>HOLD TO OPEN</Text>
                        <Text style={styles.promptSub}>{subtitle}</Text>
                    </Animated.View>

                    {reward && (
                        <Animated.View pointerEvents="none" style={[styles.reward, rewardStyle]}>
                            <Text style={styles.rewardHeadline} adjustsFontSizeToFit numberOfLines={1}>{reward.headline}</Text>
                            <Text style={styles.rewardUnit}>{reward.unit}</Text>
                            <Text style={styles.rewardDetail}>{reward.detail}</Text>
                        </Animated.View>
                    )}
                </Pressable>

                <View style={styles.footer}>
                    {opened && (
                        <Animated.View style={[styles.doneWrap, doneStyle]}>
                            <Text style={styles.earned}>Earned, not given.</Text>
                            <Pressable
                                onPress={onClose}
                                accessibilityRole="button"
                                accessibilityLabel="Done"
                                style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.85 }]}
                            >
                                <Text style={styles.doneText}>DONE</Text>
                            </Pressable>
                        </Animated.View>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: BG, paddingHorizontal: 24 },
    topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 24 },
    kicker: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 2.2, color: 'rgba(255,255,255,0.45)' },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    flash: {
        position: 'absolute',
        width: 2,
        borderRadius: 1,
        backgroundColor: '#FFF6B0',
    },
    reward: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 12 },
    rewardHeadline: {
        fontFamily: fontFamily.extraLight,
        fontSize: 76,
        lineHeight: 84,
        letterSpacing: -2.5,
        color: colours.accent,
        fontVariant: ['tabular-nums'],
    },
    rewardUnit: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 2.4, color: '#F2F2F2', marginTop: 2 },
    rewardDetail: { fontFamily: fontFamily.light, fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 10, textAlign: 'center' },
    footer: { height: 96, alignItems: 'center', justifyContent: 'flex-end' },
    promptWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 6 },
    prompt: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 3, color: colours.accent },
    promptSub: { fontFamily: fontFamily.light, fontSize: 11.5, color: 'rgba(255,255,255,0.35)' },
    doneWrap: { alignItems: 'center', gap: 14 },
    earned: { fontFamily: fontFamily.light, fontSize: 12, color: 'rgba(255,255,255,0.4)' },
    doneBtn: { backgroundColor: colours.accent, borderRadius: 20, paddingHorizontal: 34, paddingVertical: 11 },
    doneText: { fontFamily: fontFamily.bold, fontSize: 12, letterSpacing: 1.5, color: colours.onAccent },
});
