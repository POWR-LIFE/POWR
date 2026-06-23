import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { fontFamily } from '@/constants/tokens';
import { earnedPoints } from '@/lib/social/bonus';
import type { SharedChallenge } from '@/lib/social/types';
import { Avatar } from './Avatar';

// ─── Palette ──────────────────────────────────────────────────────────────────
const GOLD = '#E8D200';
const GREEN = '#00CC66';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const BORDER = '#222222';
const CARD_BG = '#080808';

// ─── Particles (group-flavoured: greens + golds) ──────────────────────────────
const PARTICLE_COLORS = [GOLD, GREEN, '#F2F2F2', '#ffee44'];

function Particle() {
  const progress = useSharedValue(0);
  const { tx, ty, color, size, round, delay, dur } = useMemo(() => {
    const angle = Math.random() * 360;
    const dist = 60 + Math.random() * 130;
    return {
      tx: Math.cos((angle * Math.PI) / 180) * dist,
      ty: Math.sin((angle * Math.PI) / 180) * dist - 50,
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      size: 4 + Math.random() * 5,
      round: Math.random() > 0.5,
      delay: Math.random() * 180,
      dur: 600 + Math.random() * 500,
    };
  }, []);

  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration: dur, easing: Easing.out(Easing.quad) }));
  }, [progress, delay, dur]);

  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [
      { translateX: tx * progress.value },
      { translateY: ty * progress.value },
      { rotate: `${progress.value * 720}deg` },
      { scale: 1 - progress.value },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: '50%', top: '32%', width: size, height: size, backgroundColor: color, borderRadius: round ? size / 2 : 2 },
        style,
      ]}
    />
  );
}

function BurstRing({ delay, color, opacity }: { delay: number; color: string; opacity: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) }));
  }, [progress, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: (1 - progress.value) * opacity,
    transform: [{ translateX: -45 }, { translateY: -45 }, { scale: progress.value * 3.5 }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: color }, style]} />;
}

export interface SharedChallengeCelebrationProps {
  challenge: SharedChallenge;
  totalBalance?: number;
  onDone: () => void;
  onShare?: () => void;
}

/**
 * Full-screen overlay shown when the user completes their part of a shared
 * challenge. Reveals the group: avatars of everyone who finished + the
 * base + group-bonus = total breakdown (the §6a payoff), with the total
 * counting up. Mirrors the solo ChallengeCard celebration, group-flavoured.
 */
export function SharedChallengeCelebration({
  challenge,
  totalBalance = 0,
  onDone,
  onShare,
}: SharedChallengeCelebrationProps) {
  const { template, participants } = challenge;
  const finishers = participants.filter((p) => p.completed || p.isSelf);
  const coCompleters = participants.filter((p) => !p.isSelf && p.completed).length;
  const breakdown = earnedPoints(template.basePoints, coCompleters);

  const glow = useSharedValue(0.08);
  const trophyScale = useSharedValue(0);
  const trophyRot = useSharedValue(-20);
  const floatY = useSharedValue(0);
  const titleA = useSharedValue(0);
  const avatarsA = useSharedValue(0);
  const ptsA = useSharedValue(0);
  const actionsA = useSharedValue(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    glow.value = withRepeat(withSequence(withTiming(0.2, { duration: 1000 }), withTiming(0.08, { duration: 1000 })), -1, false);
    trophyScale.value = withDelay(150, withSequence(
      withTiming(1.2, { duration: 360, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 240 }),
    ));
    trophyRot.value = withDelay(150, withTiming(0, { duration: 600, easing: Easing.out(Easing.back(1.5)) }));
    floatY.value = withDelay(800, withRepeat(withSequence(withTiming(-6, { duration: 1250 }), withTiming(0, { duration: 1250 })), -1, false));
    titleA.value = withDelay(450, withTiming(1, { duration: 400 }));
    avatarsA.value = withDelay(650, withTiming(1, { duration: 400 }));
    ptsA.value = withDelay(850, withTiming(1, { duration: 500, easing: Easing.out(Easing.back(2)) }));
    actionsA.value = withDelay(1200, withTiming(1, { duration: 400 }));

    const start = Date.now();
    const dur = 1000;
    let raf: number;
    const tick = () => {
      const p = Math.min((Date.now() - start) / dur, 1);
      setCount(Math.round(breakdown.total * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    const startTimer = setTimeout(() => { raf = requestAnimationFrame(tick); }, 850);
    return () => {
      cancelAnimation(glow); cancelAnimation(floatY);
      clearTimeout(startTimer); if (raf) cancelAnimationFrame(raf);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  const trophyStyle = useAnimatedStyle(() => ({ transform: [{ scale: trophyScale.value }, { rotate: `${trophyRot.value}deg` }, { translateY: floatY.value }] }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: titleA.value, transform: [{ translateY: (1 - titleA.value) * 12 }] }));
  const avatarsStyle = useAnimatedStyle(() => ({ opacity: avatarsA.value, transform: [{ translateY: (1 - avatarsA.value) * 12 }] }));
  const ptsStyle = useAnimatedStyle(() => ({ opacity: ptsA.value, transform: [{ translateY: (1 - ptsA.value) * 12 }] }));
  const actionsStyle = useAnimatedStyle(() => ({ opacity: actionsA.value, transform: [{ translateY: (1 - actionsA.value) * 12 }] }));

  const others = coCompleters;
  const subtitle =
    others > 0
      ? `You + ${others} ${others === 1 ? 'friend' : 'friends'} finished together`
      : 'You finished — bonus grows as friends finish';

  return (
    <View style={styles.overlay}>
      <Animated.View style={[styles.glow, glowStyle]} />
      <BurstRing delay={50} color={GOLD} opacity={1} />
      <BurstRing delay={200} color={GREEN} opacity={0.6} />
      <BurstRing delay={350} color={GOLD} opacity={0.3} />
      {Array.from({ length: 26 }).map((_, i) => <Particle key={i} />)}

      <Animated.Text style={[styles.trophy, trophyStyle]}>🏆</Animated.Text>
      <Animated.Text style={[styles.title, titleStyle]}>{template.title} — done together.</Animated.Text>
      <Animated.Text style={[styles.subtitle, titleStyle]}>{subtitle}</Animated.Text>

      {/* Finisher avatars */}
      <Animated.View style={[styles.avatarRow, avatarsStyle]}>
        {finishers.slice(0, 6).map((p, i) => (
          <View key={p.friend.id} style={i > 0 ? { marginLeft: -8 } : undefined}>
            <Avatar friend={p.friend} size={40} completed />
          </View>
        ))}
        {finishers.length > 6 && (
          <View style={[styles.moreBubble, { marginLeft: -8 }]}>
            <Text style={styles.moreText}>+{finishers.length - 6}</Text>
          </View>
        )}
      </Animated.View>

      {/* Points: base + bonus = total */}
      <Animated.View style={[styles.ptsBlock, ptsStyle]}>
        <View style={styles.ptsWrap}>
          <Text style={styles.ptsValue}>{count.toLocaleString()}</Text>
          <Text style={styles.ptsUnit}>pts</Text>
        </View>
        <Text style={styles.ptsBreakdown}>
          {breakdown.base} base
          {breakdown.bonus > 0 && (
            <Text style={styles.ptsBonus}>{`  +${breakdown.bonus} group bonus`}</Text>
          )}
        </Text>
      </Animated.View>

      <Animated.View style={[styles.divider, actionsStyle]} />
      <Animated.Text style={[styles.total, actionsStyle]}>
        Total balance <Text style={styles.totalNum}>{(totalBalance + breakdown.total).toLocaleString()} pts</Text>
      </Animated.Text>

      <Animated.View style={[styles.actions, actionsStyle]}>
        <Pressable style={styles.btnDone} onPress={onDone}>
          <Text style={styles.btnDoneText}>Done</Text>
        </Pressable>
        <Pressable style={styles.btnShare} onPress={onShare}>
          <Ionicons name="share-outline" size={14} color={MUTED} />
          <Text style={styles.btnShareText}>Share</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CARD_BG,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    overflow: 'hidden',
  },
  glow: { position: 'absolute', top: '20%', width: 280, height: 280, borderRadius: 140, backgroundColor: GOLD },
  ring: { position: 'absolute', top: '32%', left: '50%', width: 90, height: 90, borderRadius: 45, borderWidth: 2 },

  trophy: { fontSize: 60, marginBottom: 6 },
  title: { fontFamily: fontFamily.bold, fontSize: 26, color: TEXT, marginTop: 14, letterSpacing: -0.5, textAlign: 'center' },
  subtitle: { fontFamily: fontFamily.light, fontSize: 13, color: SECONDARY, marginTop: 6, textAlign: 'center' },

  avatarRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20 },
  moreBubble: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2A2A2A', borderWidth: 2, borderColor: CARD_BG, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontFamily: fontFamily.semiBold, fontSize: 12, color: SECONDARY },

  ptsBlock: { alignItems: 'center', marginTop: 22 },
  ptsWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  ptsValue: { fontFamily: fontFamily.extraLight, fontSize: 60, color: GOLD, letterSpacing: -2, lineHeight: 62 },
  ptsUnit: { fontFamily: fontFamily.semiBold, fontSize: 16, color: GOLD, opacity: 0.7, marginBottom: 8 },
  ptsBreakdown: { fontFamily: fontFamily.medium, fontSize: 12, color: SECONDARY, marginTop: 8, letterSpacing: 0.3 },
  ptsBonus: { color: GOLD, fontFamily: fontFamily.semiBold },

  divider: { width: 40, height: 1, backgroundColor: BORDER, marginVertical: 20 },
  total: { fontFamily: fontFamily.regular, fontSize: 13, color: MUTED },
  totalNum: { color: SECONDARY, fontFamily: fontFamily.semiBold },

  actions: { flexDirection: 'row', gap: 8, marginTop: 22, alignSelf: 'stretch' },
  btnDone: { flex: 1, paddingVertical: 14, backgroundColor: GOLD, borderRadius: 12, alignItems: 'center' },
  btnDoneText: { fontFamily: fontFamily.bold, fontSize: 13, color: '#0a0a0a', letterSpacing: 0.5 },
  btnShare: { paddingVertical: 14, paddingHorizontal: 18, borderWidth: 1, borderColor: BORDER, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  btnShareText: { fontFamily: fontFamily.regular, fontSize: 13, color: MUTED },
});
