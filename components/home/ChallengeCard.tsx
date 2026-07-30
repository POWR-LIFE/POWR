import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
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

import AsyncStorage from '@react-native-async-storage/async-storage';

import { fontFamily } from '@/constants/tokens';
import type { ChallengeCardData } from '@/hooks/useWeeklyChallenge';
import { selectWeeklyBoard } from '@/lib/weeklyChallengeSelection';

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

/** Tier → accent for the points figure (difficulty at a glance, no pill). */
const TIER_COLOR: Record<string, string> = { easy: GREEN, medium: GOLD, hard: ORANGE };

// ─── Icons ───────────────────────────────────────────────────────────────────

type IconSpec = { lib: 'ion' | 'mc'; name: string };

function CatIcon({ spec, size, color }: { spec: IconSpec; size: number; color: string }) {
  if (spec.lib === 'mc') {
    return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
  }
  return <Ionicons name={spec.name as any} size={size} color={color} />;
}

// ─── Row bits ─────────────────────────────────────────────────────────────────

/** Compact figure for row readouts (35,000 → "35k"); small values verbatim. */
function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function RowBar({ fraction, complete }: { fraction: number; complete: boolean }) {
  const widthPct = useSharedValue(0);
  useEffect(() => {
    widthPct.value = withTiming(fraction, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, [fraction, widthPct]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${widthPct.value * 100}%` }));
  return (
    <View style={styles.rowBarBg}>
      <Animated.View style={[styles.rowBarFill, complete && styles.rowBarFillDone, fillStyle]} />
    </View>
  );
}

function ChallengeRow({
  challenge,
  index,
  last,
  onShare,
}: {
  challenge: ChallengeCardData;
  index: number;
  last: boolean;
  onShare?: (challenge: ChallengeCardData) => void;
}) {
  const complete = challenge.completed || challenge.fraction >= 1;
  const tierColor = TIER_COLOR[challenge.tier] ?? GOLD;

  // Mount entry — fade + rise. A freshly revealed challenge (slot refill after
  // a clear) mounts new and slides in; rows that merely re-order stay put.
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withDelay(index * 70, withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }));
  }, [enter, index]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 8 }],
  }));

  return (
    <Animated.View style={[styles.row, !last && styles.rowDivider, enterStyle]}>
      <View style={[styles.rowIcon, complete && styles.rowIconDone]}>
        <CatIcon spec={challenge.icon} size={14} color={complete ? GREEN : SECONDARY} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle} numberOfLines={1}>{challenge.title}</Text>
          <View style={styles.rowRight}>
            {complete ? (
              <>
                <Ionicons name="checkmark-circle" size={14} color={GREEN} />
                {!!onShare && (
                  <Pressable
                    hitSlop={10}
                    onPress={() => onShare(challenge)}
                    accessibilityRole="button"
                    accessibilityLabel={`Share ${challenge.title}`}
                  >
                    <Ionicons name="share-outline" size={14} color={MUTED} />
                  </Pressable>
                )}
              </>
            ) : (
              <Text style={styles.rowReadout}>
                {fmtNum(challenge.displayValue)}/{fmtNum(challenge.displayGoal)}
                <Text style={styles.rowUnit}> {challenge.unit}</Text>
              </Text>
            )}
            <Text style={[styles.rowPts, { color: complete ? GREEN : tierColor }]}>+{challenge.points}</Text>
          </View>
        </View>
        <RowBar fraction={challenge.fraction} complete={complete} />
      </View>
    </Animated.View>
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
  const emblemScale = useSharedValue(0);
  const emblemRot = useSharedValue(-15);
  const ringPulse = useSharedValue(0);
  const floatY = useSharedValue(0);
  const titleA = useSharedValue(0);
  const subA = useSharedValue(0);
  const ptsA = useSharedValue(0);
  const actionsA = useSharedValue(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    emblemScale.value = withDelay(150, withSequence(
      withTiming(1.12, { duration: 420, easing: Easing.out(Easing.back(1.8)) }),
      withTiming(1, { duration: 260 }),
    ));
    emblemRot.value = withDelay(150, withTiming(0, { duration: 600, easing: Easing.out(Easing.back(1.5)) }));
    ringPulse.value = withDelay(700, withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1, false));
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
      cancelAnimation(floatY); cancelAnimation(ringPulse);
      clearTimeout(startTimer); if (raf) cancelAnimationFrame(raf);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const emblemStyle = useAnimatedStyle(() => ({ transform: [{ scale: emblemScale.value }, { rotate: `${emblemRot.value}deg` }, { translateY: floatY.value }] }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: (1 - ringPulse.value) * 0.5,
    transform: [{ scale: 1 + ringPulse.value * 0.6 }],
  }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: titleA.value, transform: [{ translateY: (1 - titleA.value) * 12 }] }));
  const subStyle = useAnimatedStyle(() => ({ opacity: subA.value, transform: [{ translateY: (1 - subA.value) * 12 }] }));
  const ptsStyle = useAnimatedStyle(() => ({ opacity: ptsA.value, transform: [{ translateY: (1 - ptsA.value) * 12 }] }));
  const actionsStyle = useAnimatedStyle(() => ({ opacity: actionsA.value, transform: [{ translateY: (1 - actionsA.value) * 12 }] }));

  return (
    <View style={styles.cel}>
      <BurstRing delay={50} color={GOLD} opacity={1} />
      <BurstRing delay={200} color={ORANGE} opacity={0.6} />
      <BurstRing delay={350} color={GOLD} opacity={0.3} />
      <ParticleBurst />

      <Animated.View style={[styles.celEmblem, emblemStyle]}>
        <Animated.View style={[styles.celHalo, haloStyle]} />
        <Ionicons name="trophy" size={36} color={GOLD} />
      </Animated.View>
      <Animated.Text style={[styles.celTitle, titleStyle]}>{challenge.title} complete.</Animated.Text>
      <Animated.Text style={[styles.celSub, subStyle]}>{challenge.completeSubtitle}</Animated.Text>

      <Animated.View style={[styles.celPtsSection, ptsStyle]}>
        <View style={styles.celPtsAccent} />
        <View style={styles.celPtsWrap}>
          <Text style={styles.celPts}>{count.toLocaleString()}</Text>
          <Text style={styles.celPtsUnit}>pts</Text>
        </View>
        <Text style={styles.celPtsLabel}>POWR points earned</Text>
      </Animated.View>

      <Animated.View style={[styles.celDivider, actionsStyle]} />
      <Animated.Text style={[styles.celTotal, actionsStyle]}>
        Total balance <Text style={styles.celTotalNum}>{(totalBalance + challenge.points).toLocaleString()} pts</Text>
      </Animated.Text>

      <Animated.View style={[styles.celActions, actionsStyle]}>
        <Pressable style={styles.celBtnDone} onPress={onDone}>
          <Text style={styles.celBtnDoneText}>Done</Text>
        </Pressable>
        <Pressable style={styles.celBtnShare} onPress={onShare}>
          <Ionicons name="share-outline" size={13} color={SECONDARY} />
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
  /** Fires from the celebration + completed-row share controls with the challenge. */
  onShare?: (challenge: ChallengeCardData) => void;
  /** When set, plays the completion celebration for that challenge once. */
  celebrateId?: string | null;
}

/** Last-known category relevance — read on mount, written whenever this week
 *  has signal. Bridges the Monday reset, when every score is zero and the
 *  slots would otherwise open on arbitrary catalog order. */
const ORDER_KEY = '@powr/weekly_category_order';

/**
 * "This week" board — the auto weekly challenges as one compact card, run as
 * two SLOTS + a hidden queue: nobody has ever cleared all five, and a wall of
 * unfinished bars reads as failure. Clearing a slot reveals the next
 * challenge (the refill beat is the hook), finished ones stack below as
 * receipts. Display-only — all five still evaluate and award server-side, so
 * a hidden challenge finished through normal activity pops in already-done.
 * Deliberately quieter than the Together band above: no avatars, no per-row
 * day tracking, just goal → progress → points. Completion swaps the rows for
 * the celebration in-flow, so the card grows to fit it.
 */
export function ChallengeCard({ challenges, totalBalance = 0, onShare, celebrateId }: ChallengeCardProps) {
  const [celebratingId, setCelebratingId] = useState<string | null>(null);
  const dismissed = useRef<Set<string>>(new Set());

  // When a fresh completion arrives, play the celebration once.
  useEffect(() => {
    if (!celebrateId || dismissed.current.has(celebrateId)) return;
    if (challenges.some((c) => c.id === celebrateId)) setCelebratingId(celebrateId);
  }, [celebrateId, challenges]);

  // Stored relevance is loaded once and NOT live-updated from this session's
  // derived order — feeding it back would let a mid-session score change
  // silently swap a visible slot. This session ranks on live momentum; the
  // persisted order only seats next Monday's empty board.
  const [storedOrder, setStoredOrder] = useState<string[] | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(ORDER_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) {
            setStoredOrder(parsed);
          }
        } catch {
          /* corrupt = ignore */
        }
      })
      .catch(() => {});
  }, []);

  const board = useMemo(() => selectWeeklyBoard(challenges, storedOrder), [challenges, storedOrder]);

  const persistedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!board.derivedOrder) return;
    const s = JSON.stringify(board.derivedOrder);
    if (persistedRef.current === s) return;
    persistedRef.current = s;
    AsyncStorage.setItem(ORDER_KEY, s).catch(() => {});
  }, [board.derivedOrder]);

  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
  }, [enter]);
  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ translateY: (1 - enter.value) * 10 }] }));

  if (!challenges.length) return null;
  const celebrating = celebratingId ? challenges.find((c) => c.id === celebratingId) : undefined;

  // Goals on top, receipts underneath.
  const rows = [...board.active, ...board.done];
  const allClear = board.done.length === challenges.length;
  const weekPts = challenges.reduce((sum, c) => sum + c.points, 0);
  const hasFooter = board.hiddenCount > 0 || allClear;

  return (
    <View>
      {/* Section header — sibling of TOGETHER's, with the shared weekly clock
          (every row resets at the same moment, so it's said once up here). */}
      <View style={styles.sectionRow}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionLabel}>THIS WEEK</Text>
          {board.done.length > 0 && (
            <Text style={styles.sectionCount}>{board.done.length}/{challenges.length}</Text>
          )}
        </View>
        <Text style={styles.sectionMeta}>{challenges[0].expiresIn}</Text>
      </View>

      <Animated.View style={[styles.card, !!celebrating && styles.cardCelebrating, enterStyle]}>
        {celebrating ? (
          <Celebration
            challenge={celebrating}
            totalBalance={totalBalance}
            onShare={() => onShare?.(celebrating)}
            onDone={() => { dismissed.current.add(celebrating.id); setCelebratingId(null); }}
          />
        ) : (
          <>
            {rows.map((c, i) => (
              <ChallengeRow key={c.id} challenge={c} index={i} last={i === rows.length - 1 && !hasFooter} onShare={onShare} />
            ))}
            {board.hiddenCount > 0 ? (
              <Text style={styles.queueHint}>
                {board.hiddenCount} more unlock{board.hiddenCount === 1 ? 's' : ''} as you clear these
              </Text>
            ) : allClear ? (
              <Text style={styles.clearedLine}>Week cleared · {weekPts} pts banked</Text>
            ) : null}
          </>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // section header — mirrors TogetherSection's sectionRow so the two bands read
  // as siblings
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 16,
    marginTop: 8,
    marginBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 9,
    letterSpacing: 2,
    color: TEXT,
    textTransform: 'uppercase',
  },
  sectionCount: { fontFamily: fontFamily.semiBold, fontSize: 10, color: SECONDARY },
  sectionMeta: { fontFamily: fontFamily.regular, fontSize: 11, color: FAINT },

  card: { backgroundColor: CARD_BG, borderRadius: 22, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, overflow: 'hidden', position: 'relative' },
  cardCelebrating: { paddingHorizontal: 0, backgroundColor: '#080808' },

  // rows
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.07)' },
  rowIcon: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center', justifyContent: 'center',
  },
  rowIconDone: { backgroundColor: 'rgba(0,204,102,0.08)' },
  rowBody: { flex: 1, gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowTitle: { flex: 1, fontFamily: fontFamily.regular, fontSize: 14, color: TEXT, letterSpacing: -0.2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowReadout: { fontFamily: fontFamily.regular, fontSize: 11, color: SECONDARY },
  rowUnit: { color: MUTED, fontSize: 10 },
  rowPts: { fontFamily: fontFamily.semiBold, fontSize: 12, letterSpacing: 0.2, minWidth: 34, textAlign: 'right' },
  rowBarBg: { height: 3, backgroundColor: BORDER, borderRadius: 3, overflow: 'hidden' },
  rowBarFill: { height: 3, borderRadius: 3, backgroundColor: GOLD },
  rowBarFillDone: { backgroundColor: GREEN },

  // queue footer — the chain's promise of more, or the completionist payoff
  queueHint: {
    fontFamily: fontFamily.regular, fontSize: 10.5, color: MUTED,
    textAlign: 'center', paddingVertical: 11, letterSpacing: 0.3,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.07)',
  },
  clearedLine: {
    fontFamily: fontFamily.semiBold, fontSize: 11.5, color: GOLD,
    textAlign: 'center', paddingVertical: 12, letterSpacing: 0.4,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.07)',
  },

  // celebration
  cel: { alignSelf: 'stretch', borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32, overflow: 'hidden' },
  celRing: { position: 'absolute', top: '26%', left: '50%', width: 90, height: 90, borderRadius: 45, borderWidth: 2 },
  celEmblem: { width: 88, height: 88, borderRadius: 44, borderWidth: 1.5, borderColor: 'rgba(232,210,0,0.55)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  celHalo: { position: 'absolute', width: 88, height: 88, borderRadius: 44, borderWidth: 1, borderColor: GOLD },
  celTitle: { fontFamily: fontFamily.light, fontSize: 26, color: TEXT, marginTop: 18, letterSpacing: -0.5, textAlign: 'center' },
  celSub: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, marginTop: 6, textAlign: 'center', lineHeight: 18 },
  celPtsSection: { alignItems: 'center', marginTop: 24 },
  celPtsAccent: { width: 28, height: 1, backgroundColor: 'rgba(232,210,0,0.4)', marginBottom: 10 },
  celPtsWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  celPts: { fontFamily: fontFamily.extraLight, fontSize: 60, color: GOLD, letterSpacing: -2, lineHeight: 62 },
  celPtsUnit: { fontFamily: fontFamily.semiBold, fontSize: 16, color: GOLD, opacity: 0.7, marginBottom: 8 },
  celPtsLabel: { fontFamily: fontFamily.regular, fontSize: 9, color: SECONDARY, letterSpacing: 2.5, textTransform: 'uppercase', marginTop: 6 },
  celDivider: { width: 40, height: 1, backgroundColor: BORDER, marginVertical: 18 },
  celTotal: { fontFamily: fontFamily.regular, fontSize: 13, color: MUTED },
  celTotalNum: { color: SECONDARY, fontFamily: fontFamily.semiBold },
  celActions: { flexDirection: 'row', gap: 8, marginTop: 22, alignSelf: 'stretch' },
  celBtnDone: { flex: 1, paddingVertical: 14, backgroundColor: GOLD, borderRadius: 12, alignItems: 'center' },
  celBtnDoneText: { fontFamily: fontFamily.bold, fontSize: 13, color: CARD_BG, letterSpacing: 0.5 },
  celBtnShare: { paddingVertical: 14, paddingHorizontal: 18, borderWidth: 1, borderColor: BORDER, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  celBtnShareText: { fontFamily: fontFamily.regular, fontSize: 13, color: SECONDARY },
});
