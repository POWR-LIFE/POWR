import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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

import type { ChallengeCardData } from '@/hooks/useWeeklyChallenge';

// ─── Palette ───────────────────────────────────────────────────────────────

const GOLD = '#E8D200';
const ORANGE = '#FF5C00';
const GREEN = '#00CC66';
const TEXT = '#F2F2F2';
const CARD_BG = '#111111';
const CARD_BG_DEEP = '#0d0d0d';
const BORDER = '#1e1e1e';

const TIER_COLOR: Record<string, string> = { easy: GREEN, medium: GOLD, hard: ORANGE };

// ─── Icons ───────────────────────────────────────────────────────────────────

type IconSpec = { lib: 'ion' | 'mc'; name: string };

function CatIcon({ spec, size, color }: { spec: IconSpec; size: number; color: string }) {
  if (spec.lib === 'mc') {
    return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
  }
  return <Ionicons name={spec.name as any} size={size} color={color} />;
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// ─── Category pill ────────────────────────────────────────────────────────────

function CategoryPill({
  challenge,
  active,
  onPress,
}: {
  challenge: ChallengeCardData;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && styles.pillOn]}>
      <CatIcon spec={challenge.icon} size={13} color={active ? CARD_BG : '#555'} />
      <Text style={[styles.pillText, active && styles.pillTextOn]}>{challenge.categoryLabel}</Text>
      {challenge.completed && (
        <Ionicons name="checkmark-circle" size={12} color={active ? CARD_BG : GREEN} />
      )}
    </Pressable>
  );
}

// ─── Streak bar ───────────────────────────────────────────────────────────────

function StreakBar({ streak, todayIndex }: { streak: boolean[]; todayIndex: number }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(0.4, { duration: 600 }), withTiming(1, { duration: 600 })),
      -1, false
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);
  const todayStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={styles.streakBar}>
      {Array.from({ length: 7 }).map((_, i) => {
        const hit = streak[i];
        if (i === todayIndex) {
          return <Animated.View key={i} style={[styles.sday, { backgroundColor: hit ? GOLD : ORANGE }, todayStyle]} />;
        }
        return <View key={i} style={[styles.sday, hit && { backgroundColor: GOLD }]} />;
      })}
    </View>
  );
}

// ─── Progress bar with shimmer ────────────────────────────────────────────────

function ProgressBar({ fraction }: { fraction: number }) {
  const widthPct = useSharedValue(0);
  const [trackW, setTrackW] = useState(0);
  const shimmerX = useSharedValue(-120);

  useEffect(() => {
    widthPct.value = withTiming(fraction, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, [fraction, widthPct]);

  useEffect(() => {
    if (trackW <= 0) return;
    shimmerX.value = -120;
    shimmerX.value = withRepeat(withTiming(trackW + 120, { duration: 2500, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(shimmerX);
  }, [trackW, shimmerX]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${widthPct.value * 100}%` }));
  const shimmerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shimmerX.value }] }));

  return (
    <View style={styles.barBg} onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.barFill, fillStyle]}>
        <Animated.View style={[styles.barShine, shimmerStyle]} />
      </Animated.View>
    </View>
  );
}

// ─── Step dot ─────────────────────────────────────────────────────────────────

function StepDot({ done, label }: { done: boolean; label: string }) {
  return (
    <View style={[styles.stepDot, done && styles.stepDotDone]}>
      <Ionicons name={done ? 'checkmark' : 'ellipse-outline'} size={14} color={done ? GOLD : '#333'} />
      <Text style={[styles.slabel, done && styles.slabelDone]}>{label}</Text>
    </View>
  );
}

// ─── Particle burst ───────────────────────────────────────────────────────────

const PARTICLE_COLORS = [GOLD, ORANGE, '#F2F2F2', '#ffee44'];

function Particle() {
  const progress = useSharedValue(0);
  const { tx, ty, color, size, round, delay, dur } = useMemo(() => {
    const angle = Math.random() * 360;
    const dist = 50 + Math.random() * 120;
    return {
      tx: Math.cos((angle * Math.PI) / 180) * dist,
      ty: Math.sin((angle * Math.PI) / 180) * dist - 60,
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      size: 4 + Math.random() * 5,
      round: Math.random() > 0.5,
      delay: Math.random() * 150,
      dur: 500 + Math.random() * 500,
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
      style={[{ position: 'absolute', left: '50%', top: '45%', width: size, height: size, backgroundColor: color, borderRadius: round ? size / 2 : 2 }, style]}
    />
  );
}

function ParticleBurst() {
  return (
    <>
      {Array.from({ length: 24 }).map((_, i) => (
        <Particle key={i} />
      ))}
    </>
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
  return <Animated.View pointerEvents="none" style={[styles.celRing, { borderColor: color }, style]} />;
}

// ─── Celebration overlay ──────────────────────────────────────────────────────

function Celebration({
  challenge,
  totalBalance,
  onDone,
  onShare,
}: {
  challenge: ChallengeCardData;
  totalBalance: number;
  onDone: () => void;
  onShare?: () => void;
}) {
  const trophyScale = useSharedValue(0);
  const trophyRot = useSharedValue(-20);
  const floatY = useSharedValue(0);
  const titleA = useSharedValue(0);
  const subA = useSharedValue(0);
  const ptsA = useSharedValue(0);
  const actionsA = useSharedValue(0);
  const glowOpacity = useSharedValue(0.07);
  const [count, setCount] = useState(0);

  useEffect(() => {
    glowOpacity.value = withRepeat(withSequence(withTiming(0.18, { duration: 1000 }), withTiming(0.07, { duration: 1000 })), -1, false);
    trophyScale.value = withDelay(150, withSequence(
      withTiming(1.2, { duration: 360, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 240 })
    ));
    trophyRot.value = withDelay(150, withTiming(0, { duration: 600, easing: Easing.out(Easing.back(1.5)) }));
    floatY.value = withDelay(800, withRepeat(withSequence(withTiming(-6, { duration: 1250 }), withTiming(0, { duration: 1250 })), -1, false));
    titleA.value = withDelay(450, withTiming(1, { duration: 400 }));
    subA.value = withDelay(550, withTiming(1, { duration: 400 }));
    ptsA.value = withDelay(700, withTiming(1, { duration: 500, easing: Easing.out(Easing.back(2)) }));
    actionsA.value = withDelay(1050, withTiming(1, { duration: 400 }));

    const start = Date.now();
    const dur = 900;
    let raf: number;
    const tick = () => {
      const p = Math.min((Date.now() - start) / dur, 1);
      setCount(Math.round(challenge.points * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    const startTimer = setTimeout(() => { raf = requestAnimationFrame(tick); }, 700);
    return () => {
      cancelAnimation(glowOpacity); cancelAnimation(floatY);
      clearTimeout(startTimer); if (raf) cancelAnimationFrame(raf);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const glowStyle = useAnimatedStyle(() => ({ opacity: glowOpacity.value }));
  const trophyStyle = useAnimatedStyle(() => ({ transform: [{ scale: trophyScale.value }, { rotate: `${trophyRot.value}deg` }, { translateY: floatY.value }] }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: titleA.value, transform: [{ translateY: (1 - titleA.value) * 12 }] }));
  const subStyle = useAnimatedStyle(() => ({ opacity: subA.value, transform: [{ translateY: (1 - subA.value) * 12 }] }));
  const ptsStyle = useAnimatedStyle(() => ({ opacity: ptsA.value, transform: [{ translateY: (1 - ptsA.value) * 12 }] }));
  const actionsStyle = useAnimatedStyle(() => ({ opacity: actionsA.value, transform: [{ translateY: (1 - actionsA.value) * 12 }] }));

  return (
    <View style={styles.cel}>
      <Animated.View style={[styles.celGlow, glowStyle]} />
      <BurstRing delay={50} color={GOLD} opacity={1} />
      <BurstRing delay={200} color={ORANGE} opacity={0.6} />
      <BurstRing delay={350} color={GOLD} opacity={0.3} />
      <ParticleBurst />

      <Animated.Text style={[styles.celTrophy, trophyStyle]}>🏆</Animated.Text>
      <Animated.Text style={[styles.celTitle, titleStyle]}>{challenge.title} complete.</Animated.Text>
      <Animated.Text style={[styles.celSub, subStyle]}>{challenge.completeSubtitle}</Animated.Text>

      <Animated.View style={[styles.celPtsWrap, ptsStyle]}>
        <Text style={styles.celPts}>{count.toLocaleString()}</Text>
        <Text style={styles.celPtsUnit}>pts</Text>
      </Animated.View>
      <Animated.Text style={[styles.celPtsLabel, ptsStyle]}>POWR points earned</Animated.Text>

      <Animated.View style={[styles.celDivider, actionsStyle]} />
      <Animated.Text style={[styles.celTotal, actionsStyle]}>
        Total balance <Text style={styles.celTotalNum}>{(totalBalance + challenge.points).toLocaleString()} pts</Text>
      </Animated.Text>

      <Animated.View style={[styles.celActions, actionsStyle]}>
        <Pressable style={styles.celBtnDone} onPress={onDone}>
          <Text style={styles.celBtnDoneText}>Done</Text>
        </Pressable>
        <Pressable style={styles.celBtnShare} onPress={onShare}>
          <Ionicons name="share-outline" size={13} color="#555" />
          <Text style={styles.celBtnShareText}>Share</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ─── Main card ───────────────────────────────────────────────────────────────

interface ChallengeCardProps {
  challenges: ChallengeCardData[];
  totalBalance?: number;
  onShare?: () => void;
  /** When set, auto-selects that challenge and plays the celebration once. */
  celebrateId?: string | null;
}

export function ChallengeCard({ challenges, totalBalance = 0, onShare, celebrateId }: ChallengeCardProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [celebratingId, setCelebratingId] = useState<string | null>(null);
  const dismissed = useRef<Set<string>>(new Set());

  // When a fresh completion arrives, jump to it and play the celebration once.
  useEffect(() => {
    if (!celebrateId || dismissed.current.has(celebrateId)) return;
    const idx = challenges.findIndex((c) => c.id === celebrateId);
    if (idx >= 0) {
      setActiveIdx(idx);
      setCelebratingId(celebrateId);
    }
  }, [celebrateId, challenges]);

  const cardA = useSharedValue(1);
  useEffect(() => {
    cardA.value = 0;
    cardA.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
  }, [activeIdx, cardA]);
  const cardStyle = useAnimatedStyle(() => ({ opacity: cardA.value, transform: [{ translateY: (1 - cardA.value) * 10 }] }));

  if (!challenges.length) return null;
  const active = challenges[Math.min(activeIdx, challenges.length - 1)];
  const dotCount = Math.min(active.displayGoal, 7);

  return (
    <View>
      {/* Category pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catScroll}>
        {challenges.map((c, i) => (
          <CategoryPill key={c.id} challenge={c} active={i === activeIdx} onPress={() => setActiveIdx(i)} />
        ))}
      </ScrollView>

      {/* Card */}
      <Animated.View style={[styles.card, cardStyle]}>
        <StreakBar streak={active.streak} todayIndex={active.todayIndex} />

        {/* Badge row + points */}
        <View style={styles.chTop}>
          <View style={styles.badgeRow}>
            <View style={styles.chBadge}><Text style={styles.chBadgeText}>WEEKLY</Text></View>
            <View style={[styles.tierPill, { borderColor: TIER_COLOR[active.tier] }]}>
              <Text style={[styles.tierText, { color: TIER_COLOR[active.tier] }]}>{active.tier.toUpperCase()}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.points}>+{active.points}</Text>
            <Text style={styles.pointsLabel}>points</Text>
          </View>
        </View>

        <Text style={styles.chTitle}>{active.title}</Text>
        <Text style={styles.chDesc}>{active.description}</Text>

        {/* Progress */}
        <View style={styles.progRow}>
          <Text style={styles.progTxt}>{active.completed ? 'Completed' : active.unit}</Text>
          <Text style={styles.progNum}>{active.displayValue.toLocaleString()} / {active.displayGoal.toLocaleString()}</Text>
        </View>
        <ProgressBar fraction={active.fraction} />

        {/* Step dots (count/day goals only) */}
        {active.showDots && (
          <View style={styles.stepsRow}>
            {Array.from({ length: dotCount }).map((_, i) => (
              <StepDot key={i} done={i < active.displayValue} label={DAYS[i] ?? String(i + 1)} />
            ))}
          </View>
        )}

        {/* Reward pill */}
        <View style={styles.rewardPill}>
          <View style={styles.ricon}>
            <Ionicons name="trophy" size={17} color={active.completed ? GREEN : GOLD} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rlabel}>{active.completed ? 'EARNED' : 'COMPLETE TO EARN'}</Text>
            <Text style={styles.rname}>{active.points} POWR points</Text>
          </View>
          <Text style={styles.rpts}>{active.expiresIn}</Text>
        </View>

        {/* Share */}
        <Pressable style={styles.btnShare} onPress={onShare}>
          <Ionicons name="share-outline" size={13} color={CARD_BG} />
          <Text style={styles.btnShareText}>Share streak</Text>
        </Pressable>

        {celebratingId === active.id && (
          <Celebration
            challenge={active}
            totalBalance={totalBalance}
            onShare={onShare}
            onDone={() => { dismissed.current.add(active.id); setCelebratingId(null); }}
          />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  catScroll: { gap: 8, paddingBottom: 14, paddingRight: 16 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: '#222', backgroundColor: 'transparent',
  },
  pillOn: { backgroundColor: GOLD, borderColor: GOLD },
  pillText: { fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', color: '#555' },
  pillTextOn: { color: CARD_BG },

  card: { backgroundColor: CARD_BG, borderRadius: 22, borderWidth: 1, borderColor: BORDER, padding: 20, overflow: 'hidden', position: 'relative' },

  streakBar: { flexDirection: 'row', gap: 4, marginBottom: 16 },
  sday: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#1a1a1a' },

  chTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chBadge: { backgroundColor: GOLD, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  chBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: CARD_BG },
  tierPill: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  tierText: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  points: { fontSize: 22, fontWeight: '700', color: GOLD, lineHeight: 24 },
  pointsLabel: { fontSize: 9, color: '#555', letterSpacing: 1, textTransform: 'uppercase' },

  chTitle: { fontSize: 30, fontWeight: '200', color: TEXT, letterSpacing: -0.5, marginBottom: 5, lineHeight: 34 },
  chDesc: { fontSize: 12, color: '#666', marginBottom: 16, lineHeight: 19 },

  progRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 },
  progTxt: { fontSize: 11, color: '#555', textTransform: 'capitalize' },
  progNum: { fontSize: 13, fontWeight: '600', color: GOLD },
  barBg: { height: 6, backgroundColor: '#1a1a1a', borderRadius: 6, overflow: 'hidden', marginBottom: 14 },
  barFill: { height: 6, borderRadius: 6, backgroundColor: GOLD, overflow: 'hidden' },
  barShine: { position: 'absolute', top: 0, width: 60, height: '100%', backgroundColor: 'rgba(255,255,255,0.25)' },

  stepsRow: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  stepDot: { flex: 1, height: 42, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: CARD_BG_DEEP },
  stepDotDone: { backgroundColor: '#0f1a00', borderColor: GOLD },
  slabel: { fontSize: 8, color: '#333', letterSpacing: 0.5, textTransform: 'uppercase' },
  slabelDone: { color: '#5a5000' },

  rewardPill: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CARD_BG_DEEP, borderWidth: 1, borderColor: BORDER, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 10 },
  ricon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#1a1a00', borderWidth: 1, borderColor: '#2a2a00', alignItems: 'center', justifyContent: 'center' },
  rlabel: { fontSize: 9, color: '#444', letterSpacing: 1.2, textTransform: 'uppercase' },
  rname: { fontSize: 12, fontWeight: '500', color: TEXT },
  rpts: { fontSize: 11, color: GOLD, fontWeight: '600' },

  btnShare: { paddingVertical: 12, backgroundColor: GOLD, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  btnShareText: { fontSize: 11, fontWeight: '700', color: CARD_BG, letterSpacing: 0.5 },

  cel: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22, backgroundColor: '#080808', zIndex: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 28, overflow: 'hidden' },
  celGlow: { position: 'absolute', top: '22%', width: 240, height: 240, borderRadius: 120, backgroundColor: GOLD },
  celRing: { position: 'absolute', top: '38%', left: '50%', width: 90, height: 90, borderRadius: 45, borderWidth: 2 },
  celTrophy: { fontSize: 56, marginBottom: 4 },
  celTitle: { fontSize: 24, fontWeight: '700', color: TEXT, marginTop: 14, letterSpacing: -0.5, textAlign: 'center' },
  celSub: { fontSize: 12, color: '#666', marginTop: 5, textAlign: 'center', lineHeight: 18 },
  celPtsWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 18 },
  celPts: { fontSize: 56, fontWeight: '800', color: GOLD, letterSpacing: -2, lineHeight: 58 },
  celPtsUnit: { fontSize: 16, fontWeight: '600', color: GOLD, opacity: 0.7, marginBottom: 6 },
  celPtsLabel: { fontSize: 10, color: '#555', letterSpacing: 2, textTransform: 'uppercase', marginTop: 4 },
  celDivider: { width: 40, height: 1, backgroundColor: BORDER, marginVertical: 18 },
  celTotal: { fontSize: 13, color: '#555' },
  celTotalNum: { color: '#888', fontWeight: '600' },
  celActions: { flexDirection: 'row', gap: 8, marginTop: 20, alignSelf: 'stretch' },
  celBtnDone: { flex: 1, paddingVertical: 13, backgroundColor: GOLD, borderRadius: 12, alignItems: 'center' },
  celBtnDoneText: { fontSize: 12, fontWeight: '700', color: CARD_BG, letterSpacing: 0.5 },
  celBtnShare: { paddingVertical: 13, paddingHorizontal: 16, borderWidth: 1, borderColor: '#222', borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  celBtnShareText: { fontSize: 12, color: '#555' },
});
