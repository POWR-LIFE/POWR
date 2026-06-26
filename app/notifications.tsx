import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { Avatar } from '@/components/social/Avatar';
import { useNotifications } from '@/context/NotificationsContext';
import { fontFamily } from '@/constants/tokens';
import { useFriends } from '@/hooks/useFriends';
import { useSharedChallenges } from '@/hooks/useSharedChallenges';
import type { Friend, IconSpec, SharedChallenge } from '@/lib/social/types';

// ─── Palette ──────────────────────────────────────────────────────────────────
const GOLD = '#E8D200';
const BG = '#0d0d0d';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const FAINT = '#444444';
const DIM = 'rgba(255,255,255,0.5)';
const CARD_BG = '#141414';
const BORDER = '#222222';

function CatIcon({ spec, size, color }: { spec: IconSpec; size: number; color: string }) {
  if (spec.lib === 'mc') return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
  return <Ionicons name={spec.name as any} size={size} color={color} />;
}

/** A single actionable item — leading visual, copy, then Ignore / primary CTA. */
function ActionCard({
  leading,
  title,
  subtitle,
  primaryLabel,
  onAccept,
  onDecline,
}: {
  leading: React.ReactNode;
  title: string;
  subtitle: string;
  primaryLabel: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {leading}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.ignoreBtn} onPress={onDecline} accessibilityRole="button" accessibilityLabel={`Ignore: ${title}`}>
          <Text style={styles.ignoreText}>Ignore</Text>
        </Pressable>
        <Pressable style={styles.acceptBtn} onPress={onAccept} accessibilityRole="button" accessibilityLabel={`${primaryLabel}: ${title}`}>
          <Text style={styles.acceptText}>{primaryLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { incoming, acceptRequest, declineRequest, refresh: refreshFriends } = useFriends();
  const { pendingInvites, acceptInvite, declineInvite, refresh: refreshChallenges } = useSharedChallenges();
  const { refreshPendingActions } = useNotifications();

  // Re-pull both sources whenever this screen is focused so the list is current.
  useFocusEffect(
    useCallback(() => {
      refreshFriends();
      refreshChallenges();
    }, [refreshFriends, refreshChallenges]),
  );

  // The acting hook reloads its own list (the row disappears); the avatar-bell
  // badge re-reads its count when a tab regains focus on the way back.
  const acceptFriend = (f: Friend) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    acceptRequest(f.id);
  };
  const declineFriend = (f: Friend) => {
    Haptics.selectionAsync();
    declineRequest(f.id);
  };
  const acceptChallenge = (c: SharedChallenge) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void acceptInvite(c.id).then(refreshPendingActions);
  };
  const declineChallenge = (c: SharedChallenge) => {
    Haptics.selectionAsync();
    void declineInvite(c.id).then(refreshPendingActions);
  };

  const isEmpty = incoming.length === 0 && pendingInvites.length === 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={20} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>ACTIVITY</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: insets.bottom + 32, gap: 12 }}
      >
        {isEmpty ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="checkmark-done" size={26} color={GOLD} />
            </View>
            <Text style={styles.emptyTitle}>You're all caught up</Text>
            <Text style={styles.emptyBody}>Friend requests and challenge invites will show up here.</Text>
          </View>
        ) : (
          <>
            {incoming.map((f) => (
              <ActionCard
                key={`friend-${f.id}`}
                leading={<Avatar friend={f} size={44} />}
                title={f.displayName}
                subtitle={`@${f.username} · sent you a friend request`}
                primaryLabel="Accept"
                onAccept={() => acceptFriend(f)}
                onDecline={() => declineFriend(f)}
              />
            ))}

            {pendingInvites.map((c) => (
              <ActionCard
                key={`invite-${c.id}`}
                leading={
                  <View style={styles.challengeIcon}>
                    <CatIcon spec={c.template.icon} size={22} color={GOLD} />
                  </View>
                }
                title={c.template.title}
                subtitle={`${c.pendingInviteFromName ?? 'A friend'} invited you · ${c.template.goal}`}
                primaryLabel="Join"
                onAccept={() => acceptChallenge(c)}
                onDecline={() => declineChallenge(c)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.semiBold, fontSize: 11, letterSpacing: 2.5, color: TEXT },

  card: { backgroundColor: CARD_BG, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 14, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  challengeIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(232,210,0,0.10)', alignItems: 'center', justifyContent: 'center',
  },
  title: { fontFamily: fontFamily.medium, fontSize: 15, color: TEXT },
  subtitle: { fontFamily: fontFamily.light, fontSize: 12.5, color: SECONDARY, marginTop: 2, lineHeight: 17 },

  actions: { flexDirection: 'row', gap: 10 },
  ignoreBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRadius: 100, borderWidth: 1, borderColor: BORDER, paddingVertical: 11,
  },
  ignoreText: { fontFamily: fontFamily.medium, fontSize: 13, color: SECONDARY },
  acceptBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRadius: 100, backgroundColor: GOLD, paddingVertical: 11,
  },
  acceptText: { fontFamily: fontFamily.bold, fontSize: 13, color: '#0a0a0a', letterSpacing: 0.3 },

  empty: { alignItems: 'center', gap: 10, paddingTop: 80, paddingHorizontal: 24 },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(232,210,0,0.10)', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontFamily: fontFamily.regular, fontSize: 17, color: TEXT },
  emptyBody: { fontFamily: fontFamily.light, fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 19 },
});
