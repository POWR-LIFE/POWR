import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { Avatar } from '@/components/social/Avatar';
import { fontFamily } from '@/constants/tokens';
import { earnedPoints, groupBonus, maxBonusForGroup } from '@/lib/social/bonus';
import type { IconSpec, Participant, SharedChallenge } from '@/lib/social/types';

// ─── Palette ──────────────────────────────────────────────────────────────────
const GOLD = '#E8D200';
const GREEN = '#00CC66';
const ORANGE = '#FF5C00';
const BG = '#0d0d0d';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const FAINT = '#444444';
const DIM = 'rgba(255,255,255,0.5)';
const CARD_BG = '#141414';
const BORDER = '#222222';

const TIER_COLOR: Record<string, string> = { easy: GREEN, medium: GOLD, hard: ORANGE };

function CatIcon({ spec, size, color }: { spec: IconSpec; size: number; color: string }) {
  if (spec.lib === 'mc') return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
  return <Ionicons name={spec.name as any} size={size} color={color} />;
}

function StatePill({ p }: { p: Participant }) {
  if (p.completed) return <Text style={[styles.statePill, { color: GREEN }]}>Done</Text>;
  if (p.state === 'invited') return <Text style={[styles.statePill, { color: MUTED }]}>Invited</Text>;
  if (p.state === 'declined') return <Text style={[styles.statePill, { color: ORANGE }]}>Declined</Text>;
  return <Text style={[styles.statePill, { color: GOLD }]}>{Math.round(p.progress * 100)}%</Text>;
}

function ParticipantRow({ p }: { p: Participant }) {
  return (
    <View style={styles.pRow}>
      <Avatar friend={p.friend} size={40} completed={p.completed} pending={p.state === 'invited'} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={styles.pNameRow}>
          <Text style={styles.pName}>
            {p.isSelf ? 'You' : p.friend.displayName}
          </Text>
          <StatePill p={p} />
        </View>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round(Math.min(p.progress, 1) * 100)}%`, backgroundColor: p.completed ? GREEN : GOLD },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

export default function SharedChallengeDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ challenge?: string }>();

  const challenge = useMemo<SharedChallenge | null>(() => {
    if (!params.challenge) return null;
    try {
      return JSON.parse(params.challenge) as SharedChallenge;
    } catch {
      return null;
    }
  }, [params.challenge]);

  if (!challenge) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <GeometricBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
            <Ionicons name="chevron-back" size={20} color={DIM} />
          </Pressable>
          <Text style={styles.headerTitle}>CHALLENGE</Text>
          <View style={styles.headerBtn} />
        </View>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Challenge not found.</Text>
        </View>
      </View>
    );
  }

  const { template, participants } = challenge;
  const self = participants.find((p) => p.isSelf);
  const others = participants.filter((p) => !p.isSelf);
  const accepted = participants.filter((p) => p.state !== 'invited' && p.state !== 'declined');
  const finished = participants.filter((p) => p.completed);

  // What YOU'RE on track for: bonus scales with OTHER finishers (co-completers).
  const coCompleters = others.filter((p) => p.completed).length;
  const current = earnedPoints(template.basePoints, coCompleters);
  const potential = template.basePoints + maxBonusForGroup(accepted.length);

  // Sort: you first, then done, then in-progress, then invited.
  const order = (p: Participant) =>
    p.isSelf ? 0 : p.completed ? 1 : p.state === 'invited' ? 3 : 2;
  const sorted = [...participants].sort((a, b) => order(a) - order(b));

  const handleShare = async () => {
    const url = `https://powr.life/app?challenge=${challenge.id}`;
    try {
      await Share.share({ message: `Join my POWR challenge "${template.title}" — ${template.goal}. ${url}`, url });
    } catch {
      /* dismissed */
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={20} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>TOGETHER</Text>
        <Pressable onPress={handleShare} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="share-outline" size={18} color={DIM} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <CatIcon spec={template.icon} size={26} color={GOLD} />
          </View>
          <Text style={styles.heroTitle}>{template.title}</Text>
          <Text style={styles.heroGoal}>{template.goal}</Text>
          <View style={styles.heroTags}>
            <View style={styles.tag}>
              <Ionicons name="people" size={11} color={SECONDARY} />
              <Text style={styles.tagText}>{accepted.length} in</Text>
            </View>
            <View style={styles.tag}>
              <Text style={[styles.tagText, { color: TIER_COLOR[template.tier] }]}>{template.tier.toUpperCase()}</Text>
            </View>
            <View style={styles.tag}>
              <Ionicons name="time-outline" size={11} color={SECONDARY} />
              <Text style={styles.tagText}>{challenge.expiresIn}</Text>
            </View>
          </View>
        </View>

        {/* Bonus breakdown */}
        <View style={styles.bonusCard}>
          <Text style={styles.sectionLabel}>YOUR POINTS</Text>
          <View style={styles.bonusMath}>
            <View style={styles.bonusCol}>
              <Text style={styles.bonusNum}>{current.base}</Text>
              <Text style={styles.bonusColLabel}>base</Text>
            </View>
            <Text style={styles.bonusPlus}>+</Text>
            <View style={styles.bonusCol}>
              <Text style={[styles.bonusNum, { color: current.bonus > 0 ? GOLD : MUTED }]}>{current.bonus}</Text>
              <Text style={styles.bonusColLabel}>group bonus</Text>
            </View>
            <Text style={styles.bonusPlus}>=</Text>
            <View style={styles.bonusCol}>
              <Text style={[styles.bonusNum, styles.bonusTotal]}>{current.total}</Text>
              <Text style={styles.bonusColLabel}>so far</Text>
            </View>
          </View>
          <Text style={styles.bonusHint}>
            {coCompleters > 0
              ? `${coCompleters} ${coCompleters === 1 ? 'friend has' : 'friends have'} finished — your bonus grows with each one.`
              : 'Your bonus grows each time a friend finishes.'}
            {potential > current.total ? ` Up to ${potential} if everyone finishes.` : ''}
          </Text>
        </View>

        {/* Participants */}
        <View style={styles.listCard}>
          <View style={styles.listHeader}>
            <Text style={styles.sectionLabel}>PARTICIPANTS</Text>
            <Text style={styles.listCount}>
              <Text style={{ color: GREEN, fontFamily: fontFamily.semiBold }}>{finished.length}</Text>
              <Text> of {accepted.length} done</Text>
            </Text>
          </View>
          <View style={{ gap: 14, marginTop: 12 }}>
            {sorted.map((p) => (
              <ParticipantRow key={p.friend.id} p={p} />
            ))}
          </View>
        </View>

        {/* Invite more */}
        <Pressable style={styles.inviteMore} onPress={handleShare}>
          <Ionicons name="person-add-outline" size={16} color={GOLD} />
          <Text style={styles.inviteMoreText}>Invite more friends</Text>
        </Pressable>

        {/* Leave */}
        <Pressable style={styles.leave} onPress={() => router.back()}>
          <Text style={styles.leaveText}>
            {challenge.creatorId === self?.friend.id ? 'Cancel challenge' : 'Leave challenge'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.semiBold, fontSize: 11, letterSpacing: 2.5, color: TEXT },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: fontFamily.light, fontSize: 14, color: SECONDARY },

  sectionLabel: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 2, color: FAINT, textTransform: 'uppercase' },

  // hero
  hero: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  heroIcon: {
    width: 60, height: 60, borderRadius: 18,
    backgroundColor: 'rgba(232,210,0,0.08)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.18)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  heroTitle: { fontFamily: fontFamily.light, fontSize: 30, color: TEXT, letterSpacing: -0.5, textAlign: 'center' },
  heroGoal: { fontFamily: fontFamily.light, fontSize: 14, color: SECONDARY, textAlign: 'center' },
  heroTags: { flexDirection: 'row', gap: 6, marginTop: 6 },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: BORDER, borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4,
  },
  tagText: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 0.5, color: SECONDARY, textTransform: 'uppercase' },

  // bonus card
  bonusCard: { backgroundColor: CARD_BG, borderRadius: 18, borderWidth: 1, borderColor: BORDER, padding: 18, gap: 14 },
  bonusMath: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bonusCol: { alignItems: 'center', gap: 4, flex: 1 },
  bonusNum: { fontFamily: fontFamily.extraLight, fontSize: 34, color: TEXT, lineHeight: 36 },
  bonusTotal: { color: GOLD },
  bonusColLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1.5, color: FAINT, textTransform: 'uppercase' },
  bonusPlus: { fontFamily: fontFamily.extraLight, fontSize: 22, color: MUTED, paddingHorizontal: 4 },
  bonusHint: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, lineHeight: 18, textAlign: 'center' },

  // participant list
  listCard: { backgroundColor: CARD_BG, borderRadius: 18, borderWidth: 1, borderColor: BORDER, padding: 18 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listCount: { fontFamily: fontFamily.regular, fontSize: 12, color: SECONDARY },
  pRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pName: { fontFamily: fontFamily.regular, fontSize: 14, color: TEXT },
  statePill: { fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: 0.3 },
  track: { height: 4, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },

  // actions
  inviteMore: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.3)', borderRadius: 100, paddingVertical: 14,
  },
  inviteMoreText: { fontFamily: fontFamily.medium, fontSize: 13, color: GOLD, letterSpacing: 0.3 },
  leave: { alignItems: 'center', paddingVertical: 8 },
  leaveText: { fontFamily: fontFamily.regular, fontSize: 13, color: MUTED },
});
