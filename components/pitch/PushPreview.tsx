import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeOutUp, SlideInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PowrPushBanner from '@/components/onboarding/PowrPushBanner';
import { PITCH_PUSHES, usePitchPrototype } from '@/lib/dev/pitchPrototype';

/**
 * DESIGN SCAFFOLD — the pitch's "live tension" notifications, shown in the
 * app's own push lookalike (the one the permission priming uses) so their
 * copy can be judged on screen; Expo Go can't fire real ones on demand.
 * Triggered from the SIM's NEXT PUSH chip.
 */
export function PushPreview() {
    const { push } = usePitchPrototype();
    const insets = useSafeAreaInsets();
    if (push == null) return null;
    const msg = PITCH_PUSHES[push];

    return (
        <Animated.View
            key={push}
            entering={SlideInUp.duration(260)}
            exiting={FadeOutUp.duration(200)}
            pointerEvents="none"
            style={[styles.wrap, { top: insets.top + 6 }]}
        >
            <PowrPushBanner title={msg.title} body={msg.body} />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    wrap: { position: 'absolute', left: 10, right: 10, zIndex: 50 },
});
