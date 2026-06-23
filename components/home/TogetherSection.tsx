import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontFamily } from '@/constants/tokens';
import { useSharedChallenges } from '@/hooks/useSharedChallenges';
import type { SharedChallenge } from '@/lib/social/types';
import { CreateChallengeSheet } from '@/components/social/CreateChallengeSheet';
import { SharedChallengeCard } from '@/components/social/SharedChallengeCard';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const BORDER = '#222222';
const CARD_BG = '#111111';

export interface TogetherSectionProps {
  onOpenChallenge?: (challenge: SharedChallenge) => void;
}

/**
 * Home "Together" section: pending invites + active shared challenges, plus the
 * entry point into the create flow. Reads from useSharedChallenges (mock-backed
 * for now). See docs/shared-challenges-scope.md.
 */
export function TogetherSection({ onOpenChallenge }: TogetherSectionProps) {
  const router = useRouter();
  const { active, pendingInvites, friends, templates, createChallenge, acceptInvite, declineInvite } =
    useSharedChallenges();
  const [sheetVisible, setSheetVisible] = useState(false);

  const openChallenge = (challenge: SharedChallenge) => {
    if (onOpenChallenge) return onOpenChallenge(challenge);
    router.push({
      pathname: '/shared-challenge',
      params: { challenge: JSON.stringify(challenge) },
    });
  };

  // Pending invites first (they need a response), then the user's active ones.
  const inviteIds = new Set(pendingInvites.map((c) => c.id));
  const ordered = [...pendingInvites, ...active.filter((c) => !inviteIds.has(c.id))];

  return (
    <View>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>TOGETHER</Text>
        <View style={styles.headerActions}>
          <Pressable hitSlop={8} style={styles.friendsBtn} onPress={() => router.push('/friends')}>
            <Ionicons name="people" size={15} color={SECONDARY} />
          </Pressable>
          <Pressable hitSlop={8} style={styles.newBtn} onPress={() => setSheetVisible(true)}>
            <Ionicons name="add" size={14} color={GOLD} />
            <Text style={styles.newBtnText}>Challenge friends</Text>
          </Pressable>
        </View>
      </View>

      {ordered.length === 0 ? (
        <Pressable style={styles.empty} onPress={() => setSheetVisible(true)}>
          <Ionicons name="people-outline" size={28} color={GOLD} style={styles.emptyIcon} />
          <Text style={styles.emptyTitle}>Take on a challenge together</Text>
          <Text style={styles.emptyBody}>
            Invite friends and everyone earns a bonus that grows the more of you finish.
          </Text>
          <View style={styles.emptyCta}>
            <Text style={styles.emptyCtaText}>Challenge friends</Text>
            <Ionicons name="arrow-forward" size={14} color="#0a0a0a" />
          </View>
        </Pressable>
      ) : (
        <View style={{ gap: 10 }}>
          {ordered.map((c, i) => (
            <SharedChallengeCard
              key={c.id}
              challenge={c}
              index={i}
              onPress={openChallenge}
              onAccept={(ch) => acceptInvite(ch.id)}
              onDecline={(ch) => declineInvite(ch.id)}
            />
          ))}
        </View>
      )}

      <CreateChallengeSheet
        visible={sheetVisible}
        templates={templates}
        friends={friends}
        onClose={() => setSheetVisible(false)}
        onCreate={createChallenge}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
  sectionLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 9,
    letterSpacing: 2,
    color: TEXT,
    textTransform: 'uppercase',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  friendsBtn: { flexDirection: 'row', alignItems: 'center' },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  newBtnText: { fontFamily: fontFamily.medium, fontSize: 11, color: GOLD, letterSpacing: 0.2 },

  empty: {
    backgroundColor: CARD_BG,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  emptyIcon: { marginBottom: 6 },
  emptyTitle: { fontFamily: fontFamily.regular, fontSize: 16, color: TEXT },
  emptyBody: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, textAlign: 'center', lineHeight: 18, maxWidth: 260 },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: GOLD, borderRadius: 100, paddingHorizontal: 18, paddingVertical: 10, marginTop: 6,
  },
  emptyCtaText: { fontFamily: fontFamily.bold, fontSize: 12, color: '#0a0a0a', letterSpacing: 0.5 },
});
