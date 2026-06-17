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

import { fontFamily } from '@/constants/tokens';
import type { ChallengeCardData } from '@/hooks/useWeeklyChallenge';

// ─── Palette ───────────────────────────────────────────────────────────────

const GOLD = '#E8D200';
const ORANGE = '#FF5C00';
const GREEN = '#00CC66';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const FAINT = '#444444';
const CARD_BG = '#111111';
const BORDER = '#222222';

/** Tier pill — coloured text + border over a faint tint. */
const TIER_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  easy: { color: GREEN, bg: 'rgba(0,204,102,0.08)', border: 'rgba(0,204,102,0.35)' },
  medium: { color: GOLD, bg: 'rgba(232,210,0,0.08)', border: 'rgba(232,210,0,0.35)' },
  hard: { color: ORANGE, bg: 'rgba(255,92,0,0.08)', border: 'rgba(255,92,0,0.35)' },
};

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// ─── Icons ───────────────────────────────────────────────────────────────────

type IconSpec = { lib: 'ion' | 'mc'; name: string };

function CatIcon({ spec, size, color }: { spec: IconSpec; size: number; color: string }) {
  if (spec.lib === 'mc') {
    return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
  }
  return <Ionicons name={spec.name as any} size={size} color={color} />;
}

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
      <CatIcon spec={challenge.icon} size={13} color={active ? CARD_BG : MUTED} />
      <Text style={[styles.pillText, active && styles.pillTextOn]}>{challenge.categoryLabel}</Text>
      {challenge.completed && (
        <Ionicons name="checkmark-circle" size={12} color={active ? CARD_BG : GREEN} />
      )}
    </Pressable>
  );
}

// ─── Day dashes ───────────────────────────────────────────────────────────────
// Seven dashes (Mon–Sun) for overall weekly activity across ALL challenges;
// gold marks a day the user was active in any category. (The circular dots below
// show the same week filtered to this challenge's category.)

function DayDashes({ streak }: { streak: boolean[] }) {
  return (
    <View style={styles.dashes}>
      {DAYS.map((_, i) => (
        <View key={i} style={[styles.dash, streak[i] && styles.dashDone]} />
      ))}
    </View>
  );
}

// ─── Progress bar with shimmer ────────────────────────────────────────────────

function ProgressBar({ fraction, complete }: { fraction: number; complete: boolean }) {
  const widthPct = useSharedValue(0);
  const [trackW, setTrackW] = useState(0);
  const shimmerX = useSharedValue(-120);

  useEffect(() => {
    widthPct.value = withTiming(fraction, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, [fraction, widthPct]);

  useEffect(() => {
    if (trackW <= 0 || complete) return;
    shimmerX.value = -120;
    shimmerX.value = withRepeat(withTiming(trackW + 120, { duration: 2500, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(shimmerX);
  }, [trackW, complete, shimmerX]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${widthPct.value * 100}%` }));
  const shimmerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shimmerX.value }] }));

  return (
    <View style={styles.barBg} onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.barFill, complete && styles.barFillDone, fillStyle]}>
        {!complete && <Animated.View style={[styles.barShine, shimmerStyle]} />}
      </Animated.View>
    </View>
  );
}

// ─── Day dots (weekly streak) ─────────────────────────────────────────────────
// Circle-per-day with the weekday letter inside, matching the profile screen:
// done → gold border + ✓; today → white border; future → dimmed.

function DayDots({ streak, todayIndex }: { streak: boolean[]; todayIndex: number }) {
  return (
    <View style={styles.daysRow}>
      {DAYS.map((label, i) => {
        const done = streak[i];
        const isToday = i === todayIndex;
        const isFuture = i > todayIndex;
        return (
          <View
            key={i}
            style={[
              styles.dayDot,
              done && styles.dayDotDone,
              isToday && styles.dayDotToday,
              isFuture && styles.dayDotFuture,
            ]}
          >
            {done && !isFuture && <Text style={styles.dayDotCheck}>✓</Text>}
            <Text style={[styles.dayDotLabel, done && styles.dayDotLabelDone]}>{label}</Text>
          </View>
        );
      })}
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
          <Ionicons name="share-outline" size={13} color={MUTED} />
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
  /** Fires from the celebration + footer share controls with the completed challenge. */
  onShare?: (challenge: ChallengeCardData) => void;
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
  const tier = TIER_STYLE[active.tier] ?? TIER_STYLE.medium;
  const complete = active.completed || active.fraction >= 1;

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
        <DayDashes streak={active.overallStreak} />

        {/* Badge row + points */}
        <View style={styles.header}>
          <View style={styles.tags}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>WEEKLY</Text>
            </View>
            <View style={[styles.tag, { borderColor: tier.border, backgroundColor: tier.bg }]}>
              <Text style={[styles.tagText, { color: tier.color }]}>{active.tier.toUpperCase()}</Text>
            </View>
          </View>
          <View style={styles.points}>
            <Text style={styles.pointsValue}>+{active.points}</Text>
            <Text style={styles.pointsLabel}>pts</Text>
          </View>
        </View>

        {/* Title + description */}
        <View style={styles.titleWrap}>
          <Text style={styles.chTitle}>{active.title}</Text>
          <Text style={styles.chDesc}>{active.description}</Text>
        </View>

        {/* Progress */}
        <View style={styles.progSection}>
          <View style={styles.progMeta}>
            <Text style={styles.progLabel}>{active.unit}</Text>
            <Text style={styles.progValue}>
              {active.displayValue.toLocaleString()} / {active.displayGoal.toLocaleString()}
            </Text>
          </View>
          <ProgressBar fraction={active.fraction} complete={complete} />
        </View>

        {/* Weekly streak */}
        <DayDots streak={active.streak} todayIndex={active.todayIndex} />

        {/* Time remaining */}
        <View style={styles.timeRow}>
          <Text style={styles.timeLeft}>{active.expiresIn}</Text>
        </View>

        {/* Share — only once the challenge is complete and there's a card to share */}
        {complete && (
          <Pressable style={styles.btnShare} onPress={() => onShare?.(active)}>
            <Ionicons name="share-social-outline" size={13} color={SECONDARY} />
            <Text style={styles.btnShareText}>Share challenge</Text>
          </Pressable>
        )}

        {celebratingId === active.id && (
          <Celebration
            challenge={active}
            totalBalance={totalBalance}
            onShare={() => onShare?.(active)}
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
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100,
    borderWidth: 1, borderColor: BORDER, backgroundColor: 'transparent',
  },
  pillOn: { backgroundColor: GOLD, borderColor: GOLD },
  pillText: { fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: MUTED },
  pillTextOn: { color: CARD_BG },

  card: { backgroundColor: CARD_BG, borderRadius: 22, borderWidth: 1, borderColor: BORDER, padding: 20, overflow: 'hidden', position: 'relative' },

  // day dashes (overall weekly activity, Mon–Sun)
  dashes: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  dash: { width: 20, height: 3, borderRadius: 2, backgroundColor: BORDER },
  dashDone: { backgroundColor: GOLD },

  // header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tag: { borderWidth: 1, borderColor: BORDER, borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 1.2, color: SECONDARY, textTransform: 'uppercase' },
  points: { alignItems: 'flex-end' },
  pointsValue: { fontFamily: fontFamily.extraLight, fontSize: 30, color: GOLD, lineHeight: 30, letterSpacing: -0.5 },
  pointsLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 2, color: FAINT, textTransform: 'uppercase', marginTop: 3 },

  // title
  titleWrap: { marginBottom: 16 },
  chTitle: { fontFamily: fontFamily.light, fontSize: 28, color: TEXT, letterSpacing: -0.3, lineHeight: 32 },
  chDesc: { fontFamily: fontFamily.light, fontSize: 13, color: SECONDARY, marginTop: 6, lineHeight: 18 },

  // progress
  progSection: { marginBottom: 16 },
  progMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  progLabel: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 2, color: FAINT, textTransform: 'uppercase' },
  progValue: { fontFamily: fontFamily.regular, fontSize: 12, color: SECONDARY },
  barBg: { height: 3, backgroundColor: BORDER, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 3, borderRadius: 3, backgroundColor: GOLD, overflow: 'hidden' },
  barFillDone: { backgroundColor: GREEN },
  barShine: { position: 'absolute', top: 0, width: 60, height: '100%', backgroundColor: 'rgba(255,255,255,0.25)' },

  // day dots (weekday letter inside the circle — matches profile screen)
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 14 },
  dayDot: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    gap: 1,
  },
  dayDotDone: { backgroundColor: 'transparent', borderColor: GOLD },
  dayDotToday: { borderWidth: 1.5, borderColor: '#ffffff' },
  dayDotFuture: { opacity: 0.35 },
  dayDotCheck: { fontSize: 9, color: GOLD, lineHeight: 10 },
  dayDotLabel: { fontSize: 8, color: 'rgba(255,255,255,0.4)', lineHeight: 9 },
  dayDotLabelDone: { color: '#ffffff' },

  // time row
  timeRow: { borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 10, alignItems: 'flex-end', marginBottom: 2 },
  timeLeft: { fontFamily: fontFamily.regular, fontSize: 11, color: FAINT },

  // share
  btnShare: { marginTop: 10, paddingVertical: 12, borderRadius: 100, borderWidth: 1, borderColor: BORDER, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnShareText: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: 1.5, color: SECONDARY, textTransform: 'uppercase' },

  // celebration
  cel: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22, backgroundColor: '#080808', zIndex: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 28, overflow: 'hidden' },
  celGlow: { position: 'absolute', top: '22%', width: 240, height: 240, borderRadius: 120, backgroundColor: GOLD },
  celRing: { position: 'absolute', top: '38%', left: '50%', width: 90, height: 90, borderRadius: 45, borderWidth: 2 },
  celTrophy: { fontSize: 56, marginBottom: 4 },
  celTitle: { fontFamily: fontFamily.bold, fontSize: 24, color: TEXT, marginTop: 14, letterSpacing: -0.5, textAlign: 'center' },
  celSub: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, marginTop: 5, textAlign: 'center', lineHeight: 18 },
  celPtsWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 18 },
  celPts: { fontFamily: fontFamily.extraLight, fontSize: 56, color: GOLD, letterSpacing: -2, lineHeight: 58 },
  celPtsUnit: { fontFamily: fontFamily.semiBold, fontSize: 16, color: GOLD, opacity: 0.7, marginBottom: 6 },
  celPtsLabel: { fontFamily: fontFamily.medium, fontSize: 10, color: MUTED, letterSpacing: 2, textTransform: 'uppercase', marginTop: 4 },
  celDivider: { width: 40, height: 1, backgroundColor: BORDER, marginVertical: 18 },
  celTotal: { fontFamily: fontFamily.regular, fontSize: 13, color: MUTED },
  celTotalNum: { color: SECONDARY, fontFamily: fontFamily.semiBold },
  celActions: { flexDirection: 'row', gap: 8, marginTop: 20, alignSelf: 'stretch' },
  celBtnDone: { flex: 1, paddingVertical: 13, backgroundColor: GOLD, borderRadius: 12, alignItems: 'center' },
  celBtnDoneText: { fontFamily: fontFamily.bold, fontSize: 12, color: CARD_BG, letterSpacing: 0.5 },
  celBtnShare: { paddingVertical: 13, paddingHorizontal: 16, borderWidth: 1, borderColor: BORDER, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  celBtnShareText: { fontFamily: fontFamily.regular, fontSize: 12, color: MUTED },
});
