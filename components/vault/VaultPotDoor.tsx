import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { LevelIcon } from '@/components/LevelIcon';

import { VaultDoor3D } from './VaultDoor3D';
import { VaultPortholeCountdown } from './VaultPortholeCountdown';
import { VaultReadout } from './VaultReadout';
import { VaultRecess } from './VaultRecess';
import { ACCENT, ACCENT_SOFT } from './potTokens';

/**
 * The vault hero: a real-time 3D vault door with the vault's contents
 * composited into the porthole.
 *
 * ── How this got here ───────────────────────────────────────────────────────
 * Two earlier approaches are worth not repeating:
 *
 *  1. A hand-authored SVG door. Read cartoonish beside a render, and its ~40
 *     filter nodes were unusably slow on device. DO NOT rebuild the door with
 *     react-native-svg filters.
 *
 *  2. An AI-rendered raster, sliced into moving parts. Polar measurement showed
 *     its locking arms sat at irregular angles AND radii (left/right at
 *     r≈187–222 against r≈124–168 for the rest), so no parametric slice could
 *     separate arm from plate — every cut produced seams and mismatched fill.
 *
 * The model is procedural 3D, so the mechanism is exactly regular: seven arms
 * on one radius at 45° spacing, each a real object that withdraws inward.
 *
 * The door owns its own countdown RING (`setTimer`) and lock module, so the
 * SVG PortholeClock and the lock overlay that used to live here are both gone.
 * What stays in RN is what the model deliberately does not draw: the porthole
 * READOUT, its glow, and the payoff flash.
 */

/**
 * Porthole centre and sizes as fractions of the GL viewport box.
 *
 * PORTHOLE_FRAC is derived from the scene, not eyeballed: the glass is r=0.52
 * at z=0.02 under a 22° lens at z=7.3, so it covers 0.52 / (7.28·tan 11°) ≈
 * 0.367 of the box. Change the camera and this has to move with it.
 */
const CENTRE = { cx: 0.5, cy: 0.5 };
const PORTHOLE_FRAC = 0.367;
const GLOW_FRAC = 0.46;

export interface VaultPotDoorProps {
  size: number;
  /**
   * POWR behind the glass — the porthole shows the vault's CONTENTS, not a
   * clock. The countdown lives under the door now (VaultTimer).
   */
  amount?: number | null;
  /** A deposit has matured — labels the figure as claimable. */
  ready?: boolean;
  /** Deposits still in flight — the porthole stays blank. */
  loading?: boolean;
  /** Elapsed fraction (0..1) of the soonest deposit's vest window. */
  vestProgress?: number;
  /** The unlock landed: fire the payoff and swing the door. */
  open?: boolean;
  /** What was just released, shown inside the chamber while the door is open. */
  releasedAmount?: number | null;
  /**
   * The user's level. Its artwork sits deep in the chamber behind the payout —
   * NOT in the porthole, where a logo said nothing about the vault and was
   * removed. Here it reads as whose vault this is.
   */
  level?: number;
  /**
   * Hold charge, 0..1. Drives arm retraction in the 3D scene directly, via an
   * Animated listener — the gesture never re-renders React.
   */
  glowAnim?: Animated.Value;
  /**
   * Pre-launch: an ISO instant the doors open. When set, the porthole runs
   * the COMING SOON countdown to it instead of showing contents — the one
   * state where the time IS the contents. `amount`/`ready`/`loading` are
   * ignored while this is set.
   */
  countdownTo?: string | null;
  /**
   * The level floor is in force: the porthole says SEALED and prices the
   * open in POWR-to-level (VaultReadout's sealed branch) instead of showing
   * contents. Ignored while `countdownTo` is set — pre-launch outranks it.
   */
  sealedGap?: { minLevel: number; toGo: number } | null;
}

export function VaultPotDoor({
  size,
  amount = null,
  ready = false,
  loading = false,
  vestProgress = 0,
  open = false,
  releasedAmount = null,
  level,
  glowAnim,
  countdownTo = null,
  sealedGap = null,
}: VaultPotDoorProps) {
  const portholeSize = size * PORTHOLE_FRAC;
  const glowSize = size * GLOW_FRAC;
  const cx = size * CENTRE.cx;
  const cy = size * CENTRE.cy;

  const fallbackHold = useRef(new Animated.Value(0)).current;
  const hold = glowAnim ?? fallbackHold;

  // ⚠ EVERY animation in this component must stay useNativeDriver: FALSE.
  // `hold` cannot be native-driven: native values do not fire JS listeners, and
  // VaultDoor3D listens to it to drive the arm retraction. Anything combined
  // with `hold` in an Animated graph would promote it to native, after which
  // the JS-driven timing that owns it in vault.tsx throws "Attempting to run JS
  // driven animation on animated node that has been moved to native".

  // A ready door used to breathe on a loop. Removed: a heavy steel door
  // gently throbbing read as a UI effect stuck on top of the render rather
  // than anything the vault was doing. The READY state is already carried by
  // the porthole text and the card below. Don't reintroduce it.

  // ── Unlock payoff ──
  // The door does a ROUND TRIP: it swings open, holds just long enough to read
  // as opened, then reseals. A vault left hanging open says the payout is still
  // sitting there; sealing it says the POWR has left and the vault is secure
  // again — which is what actually happened. The porthole is the other half of
  // that: it fades out as the door turns away and returns on the reseal now
  // showing the NEXT countdown, so the screen lands somewhere truthful.
  const openSeq = useRef(new Animated.Value(0)).current;
  const swing = useRef(new Animated.Value(0)).current;
  // Flips once the reseal lands, so the countdown ring can hand back to the
  // NEXT pot's fraction — one re-render, after the whole sequence is over.
  const [resealed, setResealed] = useState(false);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setResealed(false);
      openSeq.setValue(0);
      Animated.timing(openSeq, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      Animated.sequence([
        // Slower than the flash, so the flash reads as the trigger and the
        // swing as the consequence.
        Animated.timing(swing, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.delay(1400),
        Animated.timing(swing, { toValue: 0, duration: 950, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
        // Throw the bolts home LAST. `hold` is left at 1 by the gesture that
        // drew them, and a door that shuts with its bolts still withdrawn is
        // just a closed door, not a locked one.
        Animated.timing(hold, { toValue: 0, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      ]).start(({ finished }) => {
        if (finished) setResealed(true);
      });
    }
    if (!open) {
      openSeq.setValue(0);
      swing.setValue(0);
      setResealed(false);
    }
    wasOpen.current = open;
  }, [open, openSeq, swing, hold]);

  // The hold used to raise a big gold disc over the porthole as "charge"
  // feedback. It sat on top of the render as a flat wash of colour and was cut.
  // The hold is already legible on the door itself — bolts withdrawing, padlock
  // springing — and on the card's own progress bar. Don't add a tint back.

  const flashOpacity = openSeq.interpolate({ inputRange: [0, 0.12, 0.45, 1], outputRange: [0, 0.5, 0, 0] });

  const readoutScale = open
    ? openSeq.interpolate({ inputRange: [0, 0.25, 0.55, 1], outputRange: [1, 1.16, 0.97, 1] })
    : hold.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });

  // ⚠ The glow, the digits and the flash are all painted BY RN, on top of a GL
  // view that knows nothing about them — so when the leaf swings away they
  // would otherwise sit there hanging in the open doorway as a bright disc
  // over the chamber. They belong to the porthole, so they turn away with it:
  // one shared fade on the whole layer, driven off `swing` rather than a
  // one-way timeline so it simply plays backwards on the reseal and the digits
  // come back with the door. Anything else added over the porthole goes in
  // here too.
  const portholeFacing = swing.interpolate({
    inputRange: [0, 0.18, 0.4, 1],
    outputRange: [1, 1, 0, 0],
  });

  // ── What is inside ──
  // The chamber is a black void by design, so the payout is what fills it. It
  // is the inverse of the porthole layer: hidden while the door faces us,
  // revealed once the leaf has turned far enough to show the inside, and gone
  // again on the reseal. Rises slightly as it fades, so the POWR reads as
  // leaving the vault rather than being left behind in it.
  const chamberOpacity = swing.interpolate({
    inputRange: [0, 0.42, 0.72, 1],
    outputRange: [0, 0, 1, 1],
  });
  const chamberLift = swing.interpolate({
    inputRange: [0, 0.72, 1],
    outputRange: [size * 0.05, 0, 0],
  });

  // A matured deposit has run its window out, so the ring reads FULL. Passing
  // the raw fraction left a gap of unlit ticks on a door that was ready to
  // open — the ring is the countdown, and the countdown has finished. But only
  // until the RESEAL: the shut door faces us showing the NEXT countdown in the
  // porthole, and a ring still pinned full against digits that are counting
  // contradicts them — so it re-arms to the next pot's fraction.
  const ringProgress = ready || (open && !resealed) ? 1 : vestProgress;

  return (
    <View style={{ width: size, height: size }}>
      {/* Behind the GL view: the door has to sit IN this shadow, not on it. */}
      <VaultRecess size={size} />

      <VaultDoor3D holdAnim={hold} vestProgress={ringProgress} swingAnim={swing} />

      {releasedAmount != null && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.chamber,
            { opacity: chamberOpacity, transform: [{ translateY: chamberLift }] },
          ]}
        >
          {/* Declared FIRST and absolutely positioned, so it paints behind the
              figure rather than stacking above it. Faded hard: it is what the
              payout is sitting in front of, not a thing to read. */}
          {level ? (
            <View style={styles.chamberMark}>
              <LevelIcon level={level} size={size * 0.42} color={ACCENT} />
            </View>
          ) : null}

          <Text style={[styles.chamberValue, { fontSize: size * 0.13 }]}>
            +{releasedAmount.toLocaleString()}
          </Text>
          <Text style={[styles.chamberUnit, { fontSize: size * 0.035 }]}>POINTS RELEASED</Text>
        </Animated.View>
      )}

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity: portholeFacing }]}
      >
        <Animated.View
          style={[
            styles.abs,
            styles.readout,
            {
              width: portholeSize,
              height: portholeSize,
              left: cx - portholeSize / 2,
              top: cy - portholeSize / 2,
              transform: [{ scale: readoutScale }],
            },
          ]}
        >
          {countdownTo ? (
            <VaultPortholeCountdown diameter={portholeSize} target={countdownTo} />
          ) : (
            <VaultReadout
              diameter={portholeSize}
              amount={amount}
              ready={ready}
              loading={loading}
              sealed={sealedGap}
            />
          )}
        </Animated.View>

        {/* Payout flash over the porthole */}
        <Animated.View
          style={[
            styles.flash,
            {
              width: glowSize,
              height: glowSize,
              borderRadius: glowSize / 2,
              left: cx - glowSize / 2,
              top: cy - glowSize / 2,
              opacity: flashOpacity,
            },
          ]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  readout: { alignItems: 'center', justifyContent: 'center' },

  // Sits behind the door leaf in paint order — it must be declared BEFORE the
  // porthole layer in JSX so the swinging leaf's artwork covers it until the
  // chamber is actually exposed.
  chamber: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  chamberValue: {
    fontWeight: '200',
    letterSpacing: -1,
    color: ACCENT,
    fontVariant: ['tabular-nums'],
  },
  chamberUnit: { fontWeight: '700', letterSpacing: 2, color: ACCENT_SOFT },
  // Deep enough behind the payout that it reads as depth, not as a second
  // thing competing for attention. Some levels use pre-rendered artwork with
  // its own colours, so the fade lives on the WRAPPER and works either way.
  chamberMark: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.2,
  },
  // Warm white-gold, not pure white — the flash belongs to the gold accent
  // world. The icy #D8F6FF it replaced was a leftover of the abandoned cyan
  // palette.
  flash: { position: 'absolute', backgroundColor: '#FFF4C6' },
});
