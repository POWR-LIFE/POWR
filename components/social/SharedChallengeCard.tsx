import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { fontFamily } from '@/constants/tokens';
import { groupBonus } from '@/lib/social/bonus';
import type { IconSpec, SharedChallenge } from '@/lib/social/types';
import { Avatar } from './Avatar';
import { Countdown } from './Countdown';

// ─── Palette (matches ChallengeCard) ─────────────────────────────────────────
const GOLD = '#E8D200';
const GREEN = '#00CC66';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const FAINT = '#444444';
const CARD_BG = '#111111';
const BORDER = '#222222';

// Every card is the same height so the carousel never jumps between slides — the
// invite card (with its Accept/Decline buttons) is the tallest, so the rest fill
// to match. Content lays out top→bottom (space-between) so the progress/actions
// always sit on the bottom edge.
const CARD_MIN_HEIGHT = 180;

function CatIcon({ spec, size, color }: { spec: IconSpec; size: number; color: string }) {
  if (spec.lib === 'mc') return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
  return <Ionicons name={spec.name as any} size={size} color={color} />;
}

const MAX_VISIBLE_AVATARS = 5;

/** Compact number for pool readouts (12,300 → "12.3k"). */
function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/** "1 / 3" self-progress readout for parallel goals — reconstructs the raw count
 *  from the 0–1 fraction × target, compacting large targets (46k / 70k). */
function countText(progress: number, target: number): string {
  const current = Math.min(Math.round(progress * target), target);
  return `${fmtNum(current)} / ${fmtNum(target)}`;
}

/** "X / Y unit" for a pooled total, converting metres → km/mi for distance pools. */
function poolText(pool: { target: number; total: number; unit: string }): string {
  if (pool.unit === 'km' || pool.unit === 'mi') {
    const div = pool.unit === 'mi' ? 1609.34 : 1000;
    return `${(pool.total / div).toFixed(1)} / ${Math.round(pool.target / div)} ${pool.unit}`;
  }
  if (pool.unit === 'steps') return `${fmtNum(pool.total)} / ${fmtNum(pool.target)} steps`;
  return `${Math.round(pool.total)} / ${Math.round(pool.target)} ${pool.unit}`;
}

export interface SharedChallengeCardProps {
  challenge: SharedChallenge;
  /** Stagger index for the mount entry animation. */
  index?: number;
  /** All challenge slots are full — a pending invite can't be accepted until one frees up. */
  atCap?: boolean;
  onPress?: (challenge: SharedChallenge) => void;
  onAccept?: (challenge: SharedChallenge) => void;
  onDecline?: (challenge: SharedChallenge) => void;
}

/**
 * "Together" card — kept lean: who's in, what it is, your progress, time left.
 * The full picture (everyone's progress, the bonus maths, tier) lives on the
 * detail screen (app/shared-challenge.tsx), one tap away.
 */
export function SharedChallengeCard({ challenge, index = 0, atCap = false, onPress, onAccept, onDecline }: SharedChallengeCardProps) {
  const { template, participants } = challenge;

  const self = participants.find((p) => p.isSelf);
  const others = participants.filter((p) => !p.isSelf);

  // Live bonus you're on track for — scales with OTHER finishers (co-completers).
  const coCompleters = others.filter((p) => p.completed).length;
  const liveBonus = groupBonus(coCompleters);

  const isPendingInvite = self?.state === 'invited';
  const selfPct = Math.round(Math.min(self?.progress ?? 0, 1) * 100);
  const selfDone = !!self?.completed;
  // Prefer a concrete "1 / 3" count (goal has a numeric target); fall back to "%".
  const selfReadout = challenge.goalTarget
    ? countText(self?.progress ?? 0, challenge.goalTarget)
    : `${selfPct}%`;
  // Pooled (type B): the bar shows the SHARED pool fraction (server sets every
  // participant's progress to it), and the readout is the combined total.
  const pooled = !!challenge.pool;

  // Timer rule: the clock only runs once EVERYONE has accepted. While anyone's
  // invite is outstanding the challenge is "forming" — no countdown yet.
  const invitedOthers = others.filter((p) => p.state === 'invited');
  const forming = invitedOthers.length > 0;
  const running = !forming && !!challenge.endsAt;
  const waitingLabel =
    invitedOthers.length === 1
      ? `Waiting on ${invitedOthers[0].friend.displayName.split(' ')[0]}`
      : `Waiting on ${invitedOthers.length} to accept`;

  // Mount entry — fade + rise, staggered by index (matches the solo card feel).
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withDelay(index * 80, withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) }));
  }, [enter, index]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 10 }],
  }));

  return (
    <Animated.View style={enterStyle}>
      <Pressable
        onPress={() => onPress?.(challenge)}
        style={({ pressed }) => [styles.card, isPendingInvite && styles.cardInvite, pressed && { opacity: 0.95 }]}
      >
        {/* Who's in + the reward */}
        <View style={styles.header}>
          <View style={styles.avatars}>
            {participants.slice(0, MAX_VISIBLE_AVATARS).map((p, i) => (
              <View key={p.friend.id} style={[styles.avatarWrap, i > 0 && { marginLeft: -10 }]}>
                <Avatar friend={p.friend} size={30} completed={p.completed} pending={p.state === 'invited'} />
              </View>
            ))}
            {participants.length > MAX_VISIBLE_AVATARS && (
              <View style={[styles.avatarWrap, styles.moreBubble, { marginLeft: -10 }]}>
                <Text style={styles.moreText}>+{participants.length - MAX_VISIBLE_AVATARS}</Text>
              </View>
            )}
          </View>
          <View style={styles.points}>
            <Text style={styles.pointsValue}>+{template.basePoints}</Text>
            <Text style={styles.pointsLabel}>pts</Text>
          </View>
        </View>

        {/* What it is */}
        <View style={styles.titleBlock}>
          <View style={styles.titleRow}>
            <CatIcon spec={template.icon} size={18} color={GOLD} />
            <Text style={styles.title} numberOfLines={1}>{template.title}</Text>
          </View>
          <Text style={styles.goal} numberOfLines={1}>{template.goal}</Text>
        </View>

        {isPendingInvite ? (
          <>
            <Text style={styles.inviteLine} numberOfLines={1}>
              <Text style={styles.inviteFrom}>{challenge.pendingInviteFromName ?? 'A friend'}</Text>
              <Text> invited you</Text>
              <Text style={styles.inviteBonus}>{`  ·  +${groupBonus(others.length)} bonus`}</Text>
            </Text>
            <View style={styles.inviteActions}>
              {atCap ? (
                <View style={styles.acceptLocked}>
                  <Ionicons name="lock-closed" size={12} color={MUTED} />
                  <Text style={styles.acceptLockedText}>Free a slot to join</Text>
                </View>
              ) : (
                <Pressable
                  style={styles.acceptBtn}
                  onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onAccept?.(challenge); }}
                >
                  <Text style={styles.acceptText}>Accept</Text>
                </Pressable>
              )}
              <Pressable
                style={styles.declineBtn}
                onPress={() => { Haptics.selectionAsync(); onDecline?.(challenge); }}
              >
                <Text style={styles.declineText}>Decline</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            {/* Your progress */}
            <View style={styles.progressBlock}>
              <View style={styles.progressMeta}>
                <Text style={styles.progressLabel} numberOfLines={1}>
                  {forming ? waitingLabel : pooled ? 'Group total' : selfDone ? 'You finished' : 'Your part'}
                </Text>
                {!forming && (
                  <Text style={[styles.progressPct, selfDone && { color: GREEN }]}>
                    {pooled ? poolText(challenge.pool!) : selfDone ? '✓' : selfReadout}
                  </Text>
                )}
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${selfPct}%` }, selfDone && { backgroundColor: GREEN }]} />
              </View>
            </View>

            {/* Bonus + the timer (live countdown once running, else "waiting on N") */}
            <View style={styles.footer}>
              {liveBonus > 0 ? <Text style={styles.footerBonus}>+{liveBonus} bonus</Text> : <View />}
              {running ? (
                <Countdown
                  endsAt={challenge.endsAt!}
                  iconName="time-outline"
                  iconColor={SECONDARY}
                  style={styles.timeText}
                />
              ) : forming ? (
                <View style={styles.timeChip}>
                  <Ionicons name="hourglass-outline" size={11} color={MUTED} />
                  {challenge.acceptBy ? (
                    <Countdown
                      endsAt={challenge.acceptBy}
                      suffix=" to accept"
                      style={[styles.timeText, { color: MUTED }]}
                    />
                  ) : (
                    <Text style={[styles.timeText, { color: MUTED }]}>Not started</Text>
                  )}
                </View>
              ) : (
                <Text style={[styles.timeText, { color: MUTED }]}>{challenge.expiresIn}</Text>
              )}
            </View>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    minHeight: CARD_MIN_HEIGHT,
    justifyContent: 'space-between',
  },
  // Pending invites need a response — a brighter neutral border lifts them.
  cardInvite: { borderColor: '#3A3A3A' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  avatarWrap: { borderRadius: 18 },
  moreBubble: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#2A2A2A', borderWidth: 1, borderColor: CARD_BG,
    alignItems: 'center', justifyContent: 'center',
  },
  moreText: { fontFamily: fontFamily.semiBold, fontSize: 10, color: SECONDARY },
  points: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  pointsValue: { fontFamily: fontFamily.extraLight, fontSize: 24, color: GOLD, lineHeight: 24 },
  pointsLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1, color: FAINT, textTransform: 'uppercase' },

  titleBlock: { gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontFamily: fontFamily.light, fontSize: 22, color: TEXT, letterSpacing: -0.3 },
  goal: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY },

  // your progress
  progressBlock: { gap: 8 },
  progressMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressLabel: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 1.5, color: FAINT, textTransform: 'uppercase' },
  progressPct: { fontFamily: fontFamily.semiBold, fontSize: 12, color: GOLD },
  track: { height: 4, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: GOLD },

  // footer
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerBonus: { fontFamily: fontFamily.semiBold, fontSize: 11, color: GOLD },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeText: { fontFamily: fontFamily.regular, fontSize: 11, color: SECONDARY },

  // pending invite
  inviteLine: { fontFamily: fontFamily.light, fontSize: 13, color: SECONDARY },
  inviteFrom: { fontFamily: fontFamily.semiBold, color: TEXT },
  inviteBonus: { fontFamily: fontFamily.semiBold, color: GOLD },
  inviteActions: { flexDirection: 'row', gap: 8 },
  acceptBtn: { flex: 1, backgroundColor: GOLD, borderRadius: 100, paddingVertical: 11, alignItems: 'center' },
  acceptText: { fontFamily: fontFamily.bold, fontSize: 12, color: CARD_BG, letterSpacing: 0.5 },
  acceptLocked: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 100, paddingVertical: 11,
    borderWidth: 1, borderColor: BORDER, backgroundColor: 'rgba(255,255,255,0.03)',
  },
  acceptLockedText: { fontFamily: fontFamily.medium, fontSize: 12, color: MUTED, letterSpacing: 0.3 },
  declineBtn: { paddingHorizontal: 18, borderRadius: 100, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  declineText: { fontFamily: fontFamily.medium, fontSize: 12, color: SECONDARY },
});
