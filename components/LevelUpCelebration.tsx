import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { LevelIcon } from '@/components/LevelIcon';
import { LEVELS, LEVEL_IMAGE, TIER_META, type LevelDef } from '@/constants/levels';
import { fontFamily } from '@/constants/tokens';

// ─── Palette (mirrors SharedChallengeCelebration) ─────────────────────────────
const GOLD = '#E8D200';
const SECONDARY = '#888888';
const MUTED = '#555555';
const BORDER = '#222222';
const CARD_BG = '#080808';

// ─── Choreography (ms from mount) ─────────────────────────────────────────────
const CHARGE_START = 350;   // bar starts filling
const CHARGE_MS = 1050;     // fill duration
const FLASH = CHARGE_START + CHARGE_MS; // 1400 — the level boundary breaks
const REVEAL = FLASH + 480; // number/name/pill sequence begins
const ACTIONS = REVEAL + 700;

const EMBLEM = 148;
const BAR_W = 168;

/**
 * How hard the moment should hit, derived from the jump itself:
 * - standard — an ordinary level within the same tier: the badge dissolves
 *   through, few particles, no overshoot. Frequent, so it stays calm.
 * - tier — first level of a new tier (6 / 11 / 16): the full explosion.
 * - apex — level 20. Everything, in gold.
 */
export type Graduation = 'standard' | 'tier' | 'apex';

export function levelUpGraduation(fromLevel: number, toLevel: number): Graduation {
  const from = LEVELS.find(l => l.level === fromLevel) ?? LEVELS[0];
  const to = LEVELS.find(l => l.level === toLevel) ?? LEVELS[LEVELS.length - 1];
  if (to.level >= LEVELS[LEVELS.length - 1].level) return 'apex';
  return to.tier !== from.tier ? 'tier' : 'standard';
}

// ─── Particles — fired at the flash, tinted to the new level ─────────────────
function Particle({ colors, spread }: { colors: string[]; spread: number }) {
  const progress = useSharedValue(0);
  const { tx, ty, color, size, round, delay, dur } = useMemo(() => {
    const angle = Math.random() * 360;
    const dist = (70 + Math.random() * 140) * spread;
    return {
      tx: Math.cos((angle * Math.PI) / 180) * dist,
      ty: Math.sin((angle * Math.PI) / 180) * dist - 40,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 3.5 + Math.random() * 5,
      round: Math.random() > 0.4,
      delay: FLASH + Math.random() * 200,
      dur: 650 + Math.random() * 550,
    };
  }, [colors, spread]);

  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration: dur, easing: Easing.out(Easing.quad) }));
  }, [progress, delay, dur]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value === 0 ? 0 : 1 - progress.value,
    transform: [
      { translateX: tx * progress.value },
      { translateY: ty * progress.value },
      { rotate: `${progress.value * 540}deg` },
      { scale: 1 - progress.value * 0.85 },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', alignSelf: 'center', top: '34%', width: size, height: size, backgroundColor: color, borderRadius: round ? size / 2 : 1.5 },
        style,
      ]}
    />
  );
}

function BurstRing({ delay, color, opacity }: { delay: number; color: string; opacity: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(FLASH + delay, withTiming(1, { duration: 750, easing: Easing.out(Easing.quad) }));
  }, [progress, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value === 0 ? 0 : (1 - progress.value) * opacity,
    transform: [{ scale: 0.6 + progress.value * 3.2 }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.burstRing, { borderColor: color }, style]} />;
}

/** The level number ticks over inside a masked window at the flash. */
function RollingNumber({ from, to, color }: { from: number; to: number; color: string }) {
  const roll = useSharedValue(0);
  useEffect(() => {
    roll.value = withDelay(REVEAL + 80, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
  }, [roll]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -roll.value * 56 }],
  }));
  return (
    <View style={styles.rollWindow}>
      <Animated.View style={style}>
        <Text style={[styles.rollDigit, { color: 'rgba(255,255,255,0.4)' }]}>{from}</Text>
        <Text style={[styles.rollDigit, { color }]}>{to}</Text>
      </Animated.View>
    </View>
  );
}

export interface LevelUpCelebrationProps {
  fromLevel: number;
  toLevel: number;
  /** Lifetime XP the user was last seen at — sets the charge bar's start. */
  fromXp: number;
  /** Current lifetime XP — shows how far into the next level the user already is. */
  totalEarned?: number;
  onDone: () => void;
  onShare?: () => void;
}

/**
 * Full-screen level-up moment: the old badge charges its last stretch of XP,
 * the boundary breaks with a burst, and the new level artwork lands with its
 * name and tier. One-shot — mount it when useLevelUp reports a pending
 * level-up, unmount via onDone.
 */
export function LevelUpCelebration({ fromLevel, toLevel, fromXp, totalEarned, onDone, onShare }: LevelUpCelebrationProps) {
  const fromDef: LevelDef = LEVELS.find(l => l.level === fromLevel) ?? LEVELS[0];
  const toDef: LevelDef = LEVELS.find(l => l.level === toLevel) ?? LEVELS[LEVELS.length - 1];
  const accent = toDef.textColor === '#FFFFFF' ? GOLD : toDef.textColor;
  const tier = TIER_META[toDef.tier];

  const graduation = levelUpGraduation(fromLevel, toLevel);
  const explosive = graduation !== 'standard';
  const kickerText =
    graduation === 'apex' ? 'MAX LEVEL'
    : graduation === 'tier' ? `NEW TIER — ${tier.label}`
    : 'LEVEL UP';
  const particleCount = graduation === 'apex' ? 44 : graduation === 'tier' ? 30 : 12;
  const particleSpread = explosive ? 1 : 0.6;

  // Where the user already stands inside the fresh level — the "keep going" line.
  const nextDef = LEVELS.find(l => l.level === toLevel + 1);
  const ptsToNext = nextDef && typeof totalEarned === 'number'
    ? Math.max(0, nextDef.xpMin - totalEarned)
    : null;
  const nextPct = nextDef && typeof totalEarned === 'number'
    ? Math.min(1, Math.max(0, (totalEarned - toDef.xpMin) / Math.max(1, nextDef.xpMin - toDef.xpMin)))
    : 0;

  // Charge from the user's real position in the old level to its boundary.
  const gateXp = (LEVELS.find(l => l.level === fromLevel + 1) ?? toDef).xpMin;
  const span = Math.max(1, gateXp - fromDef.xpMin);
  const fromPct = Math.min(0.95, Math.max(0.08, (fromXp - fromDef.xpMin) / span));

  const particleColors = useMemo(() => [GOLD, accent, '#F2F2F2'], [accent]);

  const bar = useSharedValue(fromPct);
  const chargeBlock = useSharedValue(1);   // bar + old name, fades at flash
  const sweep = useSharedValue(0);         // shimmer crossing the charging bar
  const oldLogo = useSharedValue(0);       // 0 → in; 1 held; then out via swap
  const swap = useSharedValue(0);          // 0 = old artwork, 1 = new artwork
  const glow = useSharedValue(0);
  const halo = useSharedValue(0);
  const float = useSharedValue(0);
  const kickerA = useSharedValue(0);
  const nameA = useSharedValue(0);
  const pillA = useSharedValue(0);
  const actionsA = useSharedValue(0);

  useEffect(() => {
    // New artwork must be on disk before the swap or the reveal lands empty.
    const nextArt = LEVEL_IMAGE[toLevel];
    if (nextArt) Image.prefetch(nextArt);

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    oldLogo.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) });
    glow.value = withRepeat(withSequence(
      withTiming(0.16, { duration: 1100 }),
      withTiming(0.07, { duration: 1100 }),
    ), -1, false);

    // Charge: ease in — the bar accelerates into the boundary.
    const flashImpact = explosive ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium;
    bar.value = withDelay(CHARGE_START, withTiming(1, { duration: CHARGE_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(Haptics.impactAsync)(flashImpact);
    }));
    sweep.value = withDelay(CHARGE_START, withRepeat(withTiming(1, { duration: 520, easing: Easing.inOut(Easing.quad) }), -1, false));

    // Flash: charge chrome dissolves, then the artwork changes hands.
    // Tier/apex jumps land with a back-eased overshoot; ordinary levels
    // dissolve through — same beat, half the drama.
    chargeBlock.value = withDelay(FLASH, withTiming(0, { duration: 260 }));
    swap.value = withDelay(
      FLASH + 120,
      explosive
        ? withTiming(1, { duration: 620, easing: Easing.out(Easing.back(1.7)) })
        : withTiming(1, { duration: 680, easing: Easing.inOut(Easing.cubic) }),
    );

    // Reveal cascade.
    kickerA.value = withDelay(REVEAL, withTiming(1, { duration: 420 }));
    nameA.value = withDelay(REVEAL + 180, withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(Haptics.notificationAsync)(Haptics.NotificationFeedbackType.Success);
    }));
    pillA.value = withDelay(REVEAL + 380, withTiming(1, { duration: 400 }));
    actionsA.value = withDelay(ACTIONS, withTiming(1, { duration: 420 }));

    // Idle life once landed: soft halo pulse + gentle float.
    halo.value = withDelay(FLASH + 800, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false));
    float.value = withDelay(FLASH + 900, withRepeat(withSequence(
      withTiming(-5, { duration: 1300, easing: Easing.inOut(Easing.quad) }),
      withTiming(0, { duration: 1300, easing: Easing.inOut(Easing.quad) }),
    ), -1, false));

    return () => {
      [bar, chargeBlock, sweep, oldLogo, swap, glow, halo, float, kickerA, nameA, pillA, actionsA]
        .forEach(cancelAnimation);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  const barFillStyle = useAnimatedStyle(() => ({ width: bar.value * BAR_W }));
  const sweepStyle = useAnimatedStyle(() => ({
    opacity: chargeBlock.value,
    transform: [{ translateX: interpolate(sweep.value, [0, 1], [-44, BAR_W]) }],
  }));
  const chargeBlockStyle = useAnimatedStyle(() => ({ opacity: chargeBlock.value }));
  const oldLogoStyle = useAnimatedStyle(() => ({
    // swap overshoots past 1 (back easing), so clamp the fade-out floor
    opacity: (0.4 + oldLogo.value * 0.6) * Math.max(0, 1 - swap.value),
    transform: [
      // Explosive: the old badge blows outward. Standard: it recedes.
      { scale: (0.92 + oldLogo.value * 0.08) * (explosive ? 1 + swap.value * 0.25 : 1 - swap.value * 0.06) },
      { translateY: float.value },
    ],
  }));
  const newLogoStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, swap.value * (explosive ? 1.6 : 1.4)),
    transform: [
      // Explosive: grows in from small with overshoot. Standard: settles down
      // from slightly large, like a breath.
      { scale: explosive ? 0.3 + swap.value * 0.7 : 1.06 - swap.value * 0.06 },
      { translateY: float.value },
    ],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: halo.value === 0 ? 0 : (1 - halo.value) * 0.45,
    transform: [{ scale: 1 + halo.value * 0.55 }, { translateY: float.value }],
  }));
  const kickerStyle = useAnimatedStyle(() => ({
    opacity: kickerA.value,
    transform: [{ translateY: (1 - kickerA.value) * 10 }],
  }));
  const nameStyle = useAnimatedStyle(() => ({
    opacity: nameA.value,
    transform: [{ translateY: (1 - nameA.value) * 14 }],
  }));
  const pillStyle = useAnimatedStyle(() => ({
    opacity: pillA.value,
    transform: [{ translateY: (1 - pillA.value) * 10 }],
  }));
  const actionsStyle = useAnimatedStyle(() => ({
    opacity: actionsA.value,
    transform: [{ translateY: (1 - actionsA.value) * 12 }],
  }));

  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onDone}>
      <View style={styles.overlay}>
        {/* No radial gradients in RN — three stacked discs at falling opacity
            fake the soft falloff; a single circle reads as a hard-edged plate. */}
        <Animated.View style={[styles.glowWrap, glowStyle]}>
          <View style={[styles.glowDisc, { width: 480, height: 480, borderRadius: 240, opacity: 0.28, backgroundColor: accent }]} />
          <View style={[styles.glowDisc, { width: 340, height: 340, borderRadius: 170, opacity: 0.34, backgroundColor: accent }]} />
          <View style={[styles.glowDisc, { width: 210, height: 210, borderRadius: 105, opacity: 0.38, backgroundColor: accent }]} />
        </Animated.View>

        <BurstRing delay={0} color={GOLD} opacity={explosive ? 0.9 : 0.4} />
        {explosive && <BurstRing delay={140} color={accent} opacity={0.55} />}
        {explosive && <BurstRing delay={300} color={GOLD} opacity={0.3} />}
        {graduation === 'apex' && <BurstRing delay={460} color={GOLD} opacity={0.25} />}
        {Array.from({ length: particleCount }).map((_, i) => (
          <Particle key={i} colors={particleColors} spread={particleSpread} />
        ))}

        {/* Kicker sits above the emblem, appearing only after the flash */}
        <Animated.Text style={[styles.kicker, explosive && { color: accent }, kickerStyle]}>
          {kickerText}
        </Animated.Text>

        {/* Emblem: old artwork charges, new artwork lands over it */}
        <View style={styles.emblem}>
          <Animated.View style={[styles.halo, { borderColor: accent }, haloStyle]} />
          <Animated.View style={[StyleSheet.absoluteFillObject, styles.emblemCenter, oldLogoStyle]}>
            <LevelIcon level={fromLevel} size={LEVEL_IMAGE[fromLevel] ? EMBLEM : EMBLEM * 0.56} color={GOLD} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFillObject, styles.emblemCenter, newLogoStyle]}>
            <LevelIcon level={toLevel} size={LEVEL_IMAGE[toLevel] ? EMBLEM : EMBLEM * 0.56} color={GOLD} />
          </Animated.View>
        </View>

        {/* Charge chrome: the last stretch of XP filling to the boundary */}
        <Animated.View style={[styles.chargeBlock, chargeBlockStyle]}>
          <View style={styles.barTrack}>
            <Animated.View style={[styles.barFill, barFillStyle]} />
            <Animated.View style={[styles.barSweep, sweepStyle]}>
              <LinearGradient
                colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFillObject}
              />
            </Animated.View>
          </View>
          <Text style={styles.oldName}>{fromDef.name}</Text>
        </Animated.View>

        {/* Reveal: number roll, new name in its artwork colour, tier pill */}
        <View style={styles.reveal}>
          <Animated.View style={[styles.levelRow, kickerStyle]}>
            <Text style={styles.levelWord}>LEVEL</Text>
            <RollingNumber from={fromLevel} to={toLevel} color={accent} />
          </Animated.View>
          <Animated.Text style={[styles.newName, { color: accent }, nameStyle]}>
            {toDef.name}
          </Animated.Text>
          <Animated.View style={[styles.tierPill, { borderColor: toDef.pill.border, backgroundColor: toDef.pill.bg }, pillStyle]}>
            <Text style={[styles.tierPillText, { color: toDef.pill.text }]}>{tier.label}</Text>
          </Animated.View>

          {/* The road ahead — where this level's journey to the next begins */}
          {nextDef && ptsToNext !== null ? (
            <Animated.View style={[styles.nextBlock, actionsStyle]}>
              <View style={styles.nextTrack}>
                <View style={[styles.nextFill, { width: `${Math.max(2, Math.round(nextPct * 100))}%`, backgroundColor: accent }]} />
              </View>
              <Text style={styles.nextText}>
                <Text style={[styles.nextPts, { color: accent }]}>{ptsToNext.toLocaleString()}</Text>
                {` pts to ${nextDef.name}`}
              </Text>
            </Animated.View>
          ) : graduation === 'apex' ? (
            <Animated.Text style={[styles.nextText, styles.apexText, actionsStyle]}>
              Top of the mountain. Nothing left to unlock.
            </Animated.Text>
          ) : null}
        </View>

        <Animated.View style={[styles.actions, actionsStyle]}>
          <Pressable style={[styles.btnContinue, { backgroundColor: GOLD }]} onPress={onDone}>
            <Text style={styles.btnContinueText}>Continue</Text>
          </Pressable>
          {onShare && (
            <Pressable style={styles.btnShare} onPress={onShare}>
              <Text style={styles.btnShareText}>Share</Text>
            </Pressable>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: CARD_BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    overflow: 'hidden',
  },
  glowWrap: {
    position: 'absolute',
    top: '14%',
    width: 480,
    height: 480,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowDisc: {
    position: 'absolute',
  },
  burstRing: {
    position: 'absolute',
    top: '34%',
    alignSelf: 'center',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1.5,
  },

  kicker: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    letterSpacing: 5,
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 18,
  },
  emblem: {
    width: EMBLEM,
    height: EMBLEM,
  },
  emblemCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    alignSelf: 'center',
    top: (EMBLEM - 120) / 2,
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1,
  },

  chargeBlock: {
    alignItems: 'center',
    marginTop: 20,
    gap: 10,
    // The reveal block renders in the same vertical slot; the charge chrome
    // dissolves as it arrives, so overlap them rather than stacking.
    height: 0,
    overflow: 'visible',
  },
  barTrack: {
    width: BAR_W,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: GOLD,
  },
  barSweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 44,
  },
  oldName: {
    fontFamily: fontFamily.light,
    fontSize: 13,
    color: SECONDARY,
    letterSpacing: 0.3,
  },

  reveal: {
    alignItems: 'center',
    marginTop: 20,
    minHeight: 150,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  levelWord: {
    fontFamily: fontFamily.light,
    fontSize: 16,
    letterSpacing: 4,
    color: 'rgba(255,255,255,0.45)',
  },
  rollWindow: {
    height: 56,
    overflow: 'hidden',
  },
  rollDigit: {
    fontFamily: fontFamily.extraLight,
    fontSize: 48,
    lineHeight: 56,
    letterSpacing: -1,
  },
  newName: {
    fontFamily: fontFamily.light,
    fontSize: 30,
    letterSpacing: -0.5,
    marginTop: 6,
    textAlign: 'center',
  },
  tierPill: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  tierPillText: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    letterSpacing: 2,
  },
  nextBlock: {
    alignItems: 'center',
    marginTop: 22,
    gap: 8,
  },
  nextTrack: {
    width: 130,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  nextFill: {
    height: '100%',
    borderRadius: 1.5,
  },
  nextText: {
    fontFamily: fontFamily.light,
    fontSize: 12,
    color: SECONDARY,
    letterSpacing: 0.3,
  },
  nextPts: {
    fontFamily: fontFamily.medium,
  },
  apexText: {
    marginTop: 22,
  },

  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 26,
    alignSelf: 'stretch',
  },
  btnContinue: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnContinueText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    color: '#0a0a0a',
    letterSpacing: 0.5,
  },
  btnShare: {
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnShareText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: MUTED,
  },
});
