import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
const MUTED = '#555555';
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
  onPress?: (challenge: SharedChallenge) => void;
  onAccept?: (challenge: SharedChallenge) => void;
  onDecline?: (challenge: SharedChallenge) => void;
}

export function SharedChallengeCard({ challenge, onPress, onAccept, onDecline }: SharedChallengeCardProps) {
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

  return (
    <Pressable
      onPress={() => onPress?.(challenge)}
      style={({ pressed }) => [styles.card, pressed && !isPendingInvite && { opacity: 0.95 }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.tags}>
          <View style={styles.tag}>
            <Ionicons name="people" size={11} color={SECONDARY} />
            <Text style={styles.tagText}>TOGETHER</Text>
          </View>
          <View style={styles.tag}>
            <Text style={[styles.tagText, { color: tier.color }]}>{template.tier.toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.points}>
          <Text style={styles.pointsValue}>+{template.basePoints}</Text>
          <Text style={styles.pointsLabel}>base</Text>
        </View>
      </View>

      {/* Title + goal */}
      <View style={styles.titleRow}>
        <View style={styles.catBubble}>
          <CatIcon spec={template.icon} size={16} color={GOLD} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{template.title}</Text>
          <Text style={styles.goal}>{template.goal}</Text>
        </View>
      </View>

      {/* Participants */}
      <View style={styles.peopleRow}>
        <View style={styles.avatars}>
          {participants.slice(0, MAX_VISIBLE_AVATARS).map((p, i) => (
            <View key={p.friend.id} style={[styles.avatarWrap, i > 0 && { marginLeft: -10 }]}>
              <Avatar
                friend={p.friend}
                size={32}
                completed={p.completed}
                pending={p.state === 'invited'}
              />
            </View>
          ))}
          {participants.length > MAX_VISIBLE_AVATARS && (
            <View style={[styles.avatarWrap, styles.moreBubble, { marginLeft: -10 }]}>
              <Text style={styles.moreText}>+{participants.length - MAX_VISIBLE_AVATARS}</Text>
            </View>
          )}
        </View>
        <Text style={styles.finishedLabel}>
          <Text style={styles.finishedNum}>{finished.length}</Text>
          <Text> of {accepted.length} done</Text>
        </Text>
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
            <Pressable style={styles.acceptBtn} onPress={() => onAccept?.(challenge)}>
              <Text style={styles.acceptText}>Accept</Text>
            </Pressable>
            <Pressable style={styles.declineBtn} onPress={() => onDecline?.(challenge)}>
              <Text style={styles.declineText}>Decline</Text>
            </Pressable>
          </View>
        </>
      ) : (
        /* Active variant — live bonus + expiry */
        <View style={styles.footer}>
          <View style={styles.bonusPill}>
            <Ionicons name="flash" size={11} color={liveBonus > 0 ? GOLD : MUTED} />
            <Text style={[styles.bonusText, liveBonus > 0 && { color: GOLD }]}>
              {liveBonus > 0 ? `+${liveBonus} group bonus` : 'bonus grows as friends finish'}
            </Text>
          </View>
          <Text style={styles.expiry}>{challenge.expiresIn}</Text>
        </View>
      )}
    </Pressable>
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

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: BORDER, borderRadius: 100,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  tagText: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1.2, color: SECONDARY, textTransform: 'uppercase' },
  points: { alignItems: 'flex-end' },
  pointsValue: { fontFamily: fontFamily.extraLight, fontSize: 24, color: GOLD, lineHeight: 24 },
  pointsLabel: { fontFamily: fontFamily.medium, fontSize: 8, letterSpacing: 2, color: FAINT, textTransform: 'uppercase', marginTop: 2 },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  catBubble: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(232,210,0,0.08)',
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontFamily: fontFamily.light, fontSize: 20, color: TEXT, letterSpacing: -0.3 },
  goal: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, marginTop: 2 },

  peopleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  avatarWrap: { borderRadius: 18 },
  moreBubble: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#2A2A2A', borderWidth: 1, borderColor: CARD_BG,
    alignItems: 'center', justifyContent: 'center',
  },
  moreText: { fontFamily: fontFamily.semiBold, fontSize: 11, color: SECONDARY },
  finishedLabel: { fontFamily: fontFamily.regular, fontSize: 12, color: SECONDARY },
  finishedNum: { fontFamily: fontFamily.semiBold, color: GREEN },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 12,
  },
  bonusPill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bonusText: { fontFamily: fontFamily.medium, fontSize: 11, color: MUTED, letterSpacing: 0.2 },
  expiry: { fontFamily: fontFamily.regular, fontSize: 11, color: FAINT },

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
