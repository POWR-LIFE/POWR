import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { fontFamily } from '@/constants/tokens';
import { groupBonus } from '@/lib/social/bonus';
import type { IconSpec, SharedChallenge } from '@/lib/social/types';
import { Avatar } from './Avatar';

// ─── Palette (matches ChallengeCard) ─────────────────────────────────────────
const GOLD = '#E8D200';
const ORANGE = '#FF5C00';
const GREEN = '#00CC66';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const FAINT = '#444444';
const CARD_BG = '#111111';
const BORDER = '#222222';

const TIER_STYLE: Record<string, { color: string }> = {
  easy: { color: GREEN },
  medium: { color: GOLD },
  hard: { color: ORANGE },
};

function CatIcon({ spec, size, color }: { spec: IconSpec; size: number; color: string }) {
  if (spec.lib === 'mc') return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
  return <Ionicons name={spec.name as any} size={size} color={color} />;
}

const MAX_VISIBLE_AVATARS = 5;

export interface SharedChallengeCardProps {
  challenge: SharedChallenge;
  /** Stagger index for the mount entry animation. */
  index?: number;
  onPress?: (challenge: SharedChallenge) => void;
  onAccept?: (challenge: SharedChallenge) => void;
  onDecline?: (challenge: SharedChallenge) => void;
}

export function SharedChallengeCard({ challenge, index = 0, onPress, onAccept, onDecline }: SharedChallengeCardProps) {
  const { template, participants } = challenge;
  const tier = TIER_STYLE[template.tier] ?? TIER_STYLE.medium;

  const self = participants.find((p) => p.isSelf);
  const others = participants.filter((p) => !p.isSelf);
  const accepted = participants.filter((p) => p.state !== 'invited' && p.state !== 'declined');
  const finished = participants.filter((p) => p.completed);

  // Live bonus the signed-in user is on track for: scales with OTHER participants
  // who've individually finished (co-completers). Mirrors §6a server maths.
  const coCompleters = others.filter((p) => p.completed).length;
  const liveBonus = groupBonus(coCompleters);

  const isPendingInvite = self?.state === 'invited';
  const selfPct = Math.round(Math.min(self?.progress ?? 0, 1) * 100);
  const selfDone = !!self?.completed;

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
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.95 }]}
      >
        {/* Header — single TOGETHER tag (tier shown as a colour dot) + points */}
        <View style={styles.header}>
          <View style={styles.tag}>
            <Ionicons name="people" size={11} color={SECONDARY} />
            <Text style={styles.tagText}>TOGETHER</Text>
            <View style={[styles.tierDot, { backgroundColor: tier.color }]} />
          </View>
          <View style={styles.points}>
            <Text style={styles.pointsValue}>+{template.basePoints}</Text>
            <Text style={styles.pointsLabel}>pts</Text>
          </View>
        </View>

        {/* Title + goal */}
        <View style={styles.titleRow}>
          <CatIcon spec={template.icon} size={22} color={GOLD} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{template.title}</Text>
            <Text style={styles.goal}>{template.goal}</Text>
          </View>
        </View>

        {isPendingInvite ? (
          /* Pending-invite variant — Accept / Decline inline */
          <>
            <Text style={styles.inviteLine}>
              <Text style={styles.inviteFrom}>{challenge.pendingInviteFromName ?? 'A friend'}</Text>
              <Text> invited you. Finish together for </Text>
              <Text style={styles.inviteBonus}>up to +{groupBonus(others.length)} bonus</Text>
              <Text>.</Text>
            </Text>
            <View style={styles.inviteActions}>
              <Pressable
                style={styles.acceptBtn}
                onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onAccept?.(challenge); }}
              >
                <Text style={styles.acceptText}>Accept</Text>
              </Pressable>
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
            {/* Your own part */}
            <View style={styles.selfRow}>
              <Text style={styles.selfLabel}>{selfDone ? 'You finished' : 'Your part'}</Text>
              <Text style={[styles.selfPct, selfDone && { color: GREEN }]}>{selfDone ? '✓' : `${selfPct}%`}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${selfPct}%` }, selfDone && { backgroundColor: GREEN }]} />
            </View>

            {/* Participants */}
            <View style={styles.peopleRow}>
              <View style={styles.avatars}>
                {participants.slice(0, MAX_VISIBLE_AVATARS).map((p, i) => (
                  <View key={p.friend.id} style={[styles.avatarWrap, i > 0 && { marginLeft: -10 }]}>
                    <Avatar friend={p.friend} size={28} completed={p.completed} pending={p.state === 'invited'} />
                  </View>
                ))}
                {participants.length > MAX_VISIBLE_AVATARS && (
                  <View style={[styles.avatarWrap, styles.moreBubble, { marginLeft: -10 }]}>
                    <Text style={styles.moreText}>+{participants.length - MAX_VISIBLE_AVATARS}</Text>
                  </View>
                )}
              </View>
              {/* One muted meta line: finishers · bonus · expiry */}
              <Text style={styles.meta} numberOfLines={1}>
                <Text style={styles.metaNum}>{finished.length}</Text>
                <Text>/{accepted.length} done</Text>
                {liveBonus > 0 && <Text style={styles.metaBonus}>{`  ·  +${liveBonus} bonus`}</Text>}
                <Text>{`  ·  ${challenge.expiresIn}`}</Text>
              </Text>
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 14,
  },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: BORDER, borderRadius: 100,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  tagText: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1.2, color: SECONDARY, textTransform: 'uppercase' },
  tierDot: { width: 5, height: 5, borderRadius: 3, marginLeft: 1 },
  points: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  pointsValue: { fontFamily: fontFamily.extraLight, fontSize: 24, color: GOLD, lineHeight: 24 },
  pointsLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1, color: FAINT, textTransform: 'uppercase' },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontFamily: fontFamily.light, fontSize: 20, color: TEXT, letterSpacing: -0.3 },
  goal: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, marginTop: 2 },

  // your own part
  selfRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: -6 },
  selfLabel: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 1.5, color: FAINT, textTransform: 'uppercase' },
  selfPct: { fontFamily: fontFamily.semiBold, fontSize: 12, color: GOLD },
  track: { height: 4, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: GOLD },

  peopleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  avatarWrap: { borderRadius: 16 },
  moreBubble: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#2A2A2A', borderWidth: 1, borderColor: CARD_BG,
    alignItems: 'center', justifyContent: 'center',
  },
  moreText: { fontFamily: fontFamily.semiBold, fontSize: 10, color: SECONDARY },
  meta: { fontFamily: fontFamily.regular, fontSize: 11, color: FAINT },
  metaNum: { fontFamily: fontFamily.semiBold, color: GREEN },
  metaBonus: { fontFamily: fontFamily.semiBold, color: GOLD },

  // pending invite
  inviteLine: { fontFamily: fontFamily.light, fontSize: 13, color: SECONDARY, lineHeight: 19 },
  inviteFrom: { fontFamily: fontFamily.semiBold, color: TEXT },
  inviteBonus: { fontFamily: fontFamily.semiBold, color: GOLD },
  inviteActions: { flexDirection: 'row', gap: 8 },
  acceptBtn: { flex: 1, backgroundColor: GOLD, borderRadius: 100, paddingVertical: 11, alignItems: 'center' },
  acceptText: { fontFamily: fontFamily.bold, fontSize: 12, color: CARD_BG, letterSpacing: 0.5 },
  declineBtn: { paddingHorizontal: 18, borderRadius: 100, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  declineText: { fontFamily: fontFamily.medium, fontSize: 12, color: SECONDARY },
});
