import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { ACCENT, ACCENT_DIM, ACCENT_SOFT, POT_BG } from './potTokens';

/**
 * The unlock control: a thumb-sized dial that sits on the vault's lower-right.
 *
 * It replaced a full-width "PRESS & HOLD" card. The card worked but ate a
 * quarter of the screen to host one gesture, and a slab of copy is a poor way
 * to say "hold this". A round target the size of a thumb reads as a physical
 * control on the door, and puts the progress ring right under the finger doing
 * the holding — the feedback and the input end up in the same place.
 *
 * ⚠ The ring is driven by the SAME `progress` value that drives the door's
 * bolts, so the two can never disagree about how far along the hold is. That
 * value must stay JS-driven (useNativeDriver: false) — VaultDoor3D reads it
 * through a listener, and native-driven values do not fire JS listeners.
 */

/**
 * Diameter of the dial itself — the "HOLD" label hangs below this, so the
 * component's full height is larger. Exported so the caller can place the dial
 * by its EDGE against the door rim instead of guessing at its centre.
 */
export const UNLOCK_DIAL_SIZE = 72;
const SIZE = UNLOCK_DIAL_SIZE;
const STROKE = 3;
/**
 * ⚠ Radius is set so the stroke's OUTER edge lands exactly on the disc's edge
 * (SIZE/2). The disc used to carry a border of its own as well, which put a
 * second circle 2.5px outside this one and read as a ring inside a ring. The
 * track IS the button's outline now — don't give the disc a border back.
 */
const R = SIZE / 2 - STROKE / 2;
const CIRC = 2 * Math.PI * R;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface VaultUnlockButtonProps {
  /** Hold charge, 0..1. Fills the ring. */
  progress: Animated.Value;
  /** The claim is in flight — swap the icon for a spinner and stop taking input. */
  claiming: boolean;
  onPressIn: () => void;
  onPressOut: () => void;
}

export function VaultUnlockButton({ progress, claiming, onPressIn, onPressOut }: VaultUnlockButtonProps) {
  return (
    <View style={styles.wrap}>
      <Pressable
        testID="vault-door-hold"
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={claiming}
        // Generous slop: the visible dial is deliberately small, but the target
        // it accepts should not be.
        hitSlop={14}
        // The gesture is invisible to a screen reader without this — the hint
        // has to carry the "keep holding" part, which nothing visual does.
        accessibilityRole="button"
        accessibilityLabel="Unlock your Vault"
        accessibilityHint="Press and hold until the ring fills to release your matured POWR"
        accessibilityState={{ disabled: claiming, busy: claiming }}
        style={({ pressed }) => [styles.button, pressed && styles.buttonHeld]}
      >
        {/* Track + progress, concentric with the button so the fill reads as
            the button charging rather than a separate indicator. */}
        <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
          <Circle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            stroke="rgba(232,210,0,0.18)" strokeWidth={STROKE} fill="none"
          />
          <AnimatedCircle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            stroke={ACCENT} strokeWidth={STROKE} fill="none"
            strokeLinecap="round"
            strokeDasharray={`${CIRC} ${CIRC}`}
            // Unwinds from a full offset to zero, and starts at 12 o'clock
            // rather than 3 — a dial that fills from the side reads as broken.
            strokeDashoffset={progress.interpolate({ inputRange: [0, 1], outputRange: [CIRC, 0] })}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>

        {claiming ? (
          <ActivityIndicator size="small" color={ACCENT} />
        ) : (
          <Ionicons name="lock-open" size={24} color={ACCENT} />
        )}
      </Pressable>

      <Text style={styles.label}>HOLD</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6 },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // Opaque, not translucent: it sits over the door artwork and has to read as
    // a control on top of it rather than a hole in it. No border — the SVG
    // track ring is the outline; see the note on R.
    backgroundColor: POT_BG,
  },
  buttonHeld: { backgroundColor: ACCENT_DIM },
  label: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.6,
    color: ACCENT_SOFT,
  },
});
