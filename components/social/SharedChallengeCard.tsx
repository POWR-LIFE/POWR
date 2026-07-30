import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { fontFamily } from '@/constants/tokens';
import { challengeBonusConfig, groupBonus } from '@/lib/social/bonus';
import { isTerminal } from '@/lib/social/status';
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

/** "2,567 / 10,000" today-so-far readout for goals with a partial day in play,
 *  converting metres → km for distance goals. Steps get thousands separators. */
function momentumText(m: { current: number; target: number; unit: string }): string {
  if (m.unit === 'distance_m') {
    return `${(m.current / 1000).toFixed(1)} / ${(m.target / 1000).toFixed(1)} km`;
  }
  const sep = (n: number) => Math.round(n).toLocaleString('en-US');
  return `${sep(m.current)} / ${sep(m.target)}`;
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
  /** Clear a settled card off Home (per-user). Renders the (X) only on
   *  completed challenges — live ones use leave/cancel on the detail screen. */
  onDismiss?: (challenge: SharedChallenge) => void;
  /** Recreate this challenge with the same crew — rendered on every terminal
   *  card. A loss is the highest-volume entry point back in (most challenges
   *  fail), so the ending must never be a dead end. */
  onRematch?: (challenge: SharedChallenge) => void;
}

/**
 * "Together" card — kept lean: who's in, what it is, your progress, time left.
 * The full picture (everyone's progress, the bonus maths, tier) lives on the
 * detail screen (app/shared-challenge.tsx), one tap away.
 */
export function SharedChallengeCard({ challenge, index = 0, atCap = false, onPress, onAccept, onDecline, onDismiss, onRematch }: SharedChallengeCardProps) {
  const { template, participants } = challenge;
  // The settled card's job (show the outcome, share it) is done once you've
  // seen it — the (X) lets you clear it before the 3-day auto-expiry. Losses
  // linger the same 3 days as wins, so they get the same (X): a bad ending you
  // can't clear off Home is worse than one that never appeared.
  const dismissible = isTerminal(challenge.status) && !!onDismiss;

  const self = participants.find((p) => p.isSelf);
  const others = participants.filter((p) => !p.isSelf);

  // Live bonus you're on track for — scales with OTHER finishers (co-completers).
  // Read from the challenge's own snapshot: the server settles from that, not
  // from the live global config.
  const coCompleters = others.filter((p) => p.completed).length;
  const liveBonus = groupBonus(coCompleters, challengeBonusConfig(challenge));

  const isPendingInvite = self?.state === 'invited';
  // Terminal cards now linger on Home for 3 days whatever the ending, so the
  // card needs a face for a loss. Without one it keeps rendering a progress
  // track and a "+N bonus" for something that already ended badly.
  const terminal = isTerminal(challenge.status);
  const selfPaid = !!self?.completed;
  const wonIt = challenge.status === 'completed' && selfPaid;
  const selfPct = Math.round(Math.min(self?.progress ?? 0, 1) * 100);
  const selfDone = !!self?.completed;
  // Prefer a concrete "1 / 3" count (goal has a numeric target); fall back to "%".
  const selfReadout = challenge.goalTarget
    ? countText(self?.progress ?? 0, challenge.goalTarget)
    : `${selfPct}%`;
  // Pooled (type B): the bar shows the SHARED pool fraction (server sets every
  // participant's progress to it), and the readout is the combined total.
  const pooled = !!challenge.pool;
  // "So far today" momentum — only worth a line while you're mid-goal and have
  // actually moved (>0). Hidden when done/pooled/forming, or when today's a
  // zero (a bare "0 / 10,000" reads as dead as the day-count already does).
  const mom = self?.momentum;
  const showMomentum =
    !pooled && !selfDone && !!mom && mom.current > 0 && mom.current < mom.target;

  const outcomeLine = !terminal
    ? null
    : challenge.status === 'cancelled'
      ? 'Cancelled before it finished'
      : challenge.status === 'expired'
        ? (pooled
          ? 'Time ran out — target missed'
          /* A solo run has no "nobody" — it was only ever you. */
          : participants.length === 1 ? 'Time ran out — you didn’t finish' : 'Time ran out — nobody finished')
        : wonIt
          ? `You finished  ·  +${template.basePoints + liveBonus} earned`
          : pooled
            /* Pooled settles the instant the group hits target, often with time
               still on the clock, so "time's up" would be wrong here. */
            ? 'The group hit the target without you'
            : 'Time’s up — you didn’t finish this one';

  // Timer rule: read "has it started?" off the CLOCK, not the roster. A
  // challenge can now go active with unanswered invites still on it (the accept
  // window elapsed and it started with whoever was in), so deriving this from
  // "is anyone still invited?" left a running challenge showing "Not started"
  // with no countdown for its entire run. endsAt is null while forming and set
  // exactly when the clock starts, which is the authoritative signal.
  const invitedOthers = others.filter((p) => p.state === 'invited');
  const running = !!challenge.endsAt;
  const forming = !running;
  const waitingLabel =
    invitedOthers.length === 0
      ? 'Waiting to start'
      : invitedOthers.length === 1
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
          <View style={styles.headerRight}>
            {/* The reward chip is an advert for what's on offer. On a challenge
                that ended without paying you, it's advertising something you
                didn't get, right above a line saying so. */}
            {!(terminal && !selfPaid) && (
              <View style={styles.points}>
                <Text style={styles.pointsValue}>+{template.basePoints}</Text>
                <Text style={styles.pointsLabel}>pts</Text>
              </View>
            )}
            {dismissible && (
              <Pressable
                hitSlop={10}
                style={styles.dismissBtn}
                onPress={() => { Haptics.selectionAsync(); onDismiss?.(challenge); }}
                accessibilityRole="button"
                accessibilityLabel={`Clear ${template.title} from home`}
              >
                <Ionicons name="close" size={14} color={MUTED} />
              </Pressable>
            )}
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

        {/* Terminal wins over the invite branch: an unanswered invite to a
            challenge that has since ended must never render Accept/Decline,
            which the server now rejects outright. */}
        {isPendingInvite && !terminal ? (
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
        ) : terminal ? (
          /* Finished, one way or the other — the verdict replaces the progress
             track and the bonus/timer footer, both of which read as live. */
          <View style={styles.outcomeArea}>
            <View style={styles.outcomeBlock}>
              <Ionicons
                name={wonIt ? 'checkmark-circle' : 'close-circle-outline'}
                size={15}
                color={wonIt ? GREEN : MUTED}
              />
              <Text
                style={[styles.outcomeText, wonIt && { color: GREEN }]}
                numberOfLines={2}
              >
                {outcomeLine}
              </Text>
            </View>
            {!!onRematch && (
              <Pressable
                style={styles.rematchBtn}
                onPress={() => { Haptics.selectionAsync(); onRematch(challenge); }}
                accessibilityRole="button"
                accessibilityLabel={`Run ${template.title} back`}
              >
                <Ionicons name="refresh" size={13} color={GOLD} />
                <Text style={styles.rematchText}>Run it back</Text>
              </Pressable>
            )}
          </View>
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
              {!forming && showMomentum && (
                <Text style={styles.momentumLine} numberOfLines={1}>
                  <Text style={styles.momentumLabel}>Today </Text>
                  {momentumText(mom!)}
                </Text>
              )}
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  points: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  dismissBtn: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  pointsValue: { fontFamily: fontFamily.extraLight, fontSize: 24, color: GOLD, lineHeight: 24 },
  pointsLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1, color: FAINT, textTransform: 'uppercase' },

  titleBlock: { gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontFamily: fontFamily.light, fontSize: 22, color: TEXT, letterSpacing: -0.3 },
  goal: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY },

  // your progress
  // terminal verdict — replaces the progress track + footer on a finished card
  outcomeArea: { gap: 10 },
  outcomeBlock: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 2 },
  outcomeText: { flex: 1, fontFamily: fontFamily.regular, fontSize: 12.5, color: SECONDARY, lineHeight: 17 },
  rematchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 100, paddingVertical: 9,
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.35)', backgroundColor: 'rgba(232,210,0,0.06)',
  },
  rematchText: { fontFamily: fontFamily.semiBold, fontSize: 12, color: GOLD, letterSpacing: 0.3 },

  progressBlock: { gap: 8 },
  progressMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressLabel: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 1.5, color: FAINT, textTransform: 'uppercase' },
  progressPct: { fontFamily: fontFamily.semiBold, fontSize: 12, color: GOLD },
  momentumLine: { fontFamily: fontFamily.regular, fontSize: 11, color: SECONDARY },
  momentumLabel: { fontFamily: fontFamily.medium, color: FAINT, textTransform: 'uppercase', letterSpacing: 1, fontSize: 9 },
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
