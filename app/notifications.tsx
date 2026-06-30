import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { Avatar } from '@/components/social/Avatar';
import { useNotifications } from '@/context/NotificationsContext';
import { fontFamily } from '@/constants/tokens';
import { useFriends } from '@/hooks/useFriends';
import { useSharedChallenges } from '@/hooks/useSharedChallenges';
import { fetchActivityFeed, type ActivityItem } from '@/lib/api/notifications';
import type { Friend, IconSpec, SharedChallenge } from '@/lib/social/types';

// ─── Palette ──────────────────────────────────────────────────────────────────
const GOLD = '#E8D200';
const BG = '#0d0d0d';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
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

// ─── Activity feed ("Recent") ──────────────────────────────────────────────────

/** Icon per activity type, falling back to a category default. */
function iconForActivity(item: ActivityItem): IconSpec {
  switch (item.type) {
    case 'challenge_completed': return { lib: 'mc', name: 'trophy' };
    case 'challenge_expiring': return { lib: 'ion', name: 'time-outline' };
    case 'challenge_friend_finished': return { lib: 'mc', name: 'flag-checkered' };
    case 'challenge_pool_milestone': return { lib: 'ion', name: 'trending-up' };
    case 'challenge_started': return { lib: 'ion', name: 'flame' };
    case 'challenge_accepted': return { lib: 'ion', name: 'hand-left' };
    case 'friend_accepted': return { lib: 'ion', name: 'people' };
    case 'reward_unlocked': return { lib: 'ion', name: 'gift' };
    case 'points_milestone': return { lib: 'ion', name: 'sparkles' };
    case 'session_completed': return { lib: 'ion', name: 'flame' };
    case 'sleep_target_met': return { lib: 'ion', name: 'moon' };
    case 'announcement': return { lib: 'ion', name: 'megaphone' };
  }
  switch (item.category) {
    case 'social': return { lib: 'ion', name: 'people' };
    case 'rewards': return { lib: 'ion', name: 'gift' };
    case 'activity': return { lib: 'ion', name: 'flame' };
    default: return { lib: 'ion', name: 'notifications' };
  }
}

/** Compact relative time, e.g. "now", "12m", "3h", "2d", "5w", "4mo". */
function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return `${Math.floor(days / 30)}mo`;
}

function FeedItem({ item, onPress }: { item: ActivityItem; onPress: () => void }) {
  const unread = item.readAt === null;
  const icon = iconForActivity(item);
  const tappable = !!item.route;

  return (
    <Pressable
      onPress={tappable ? onPress : undefined}
      disabled={!tappable}
      style={({ pressed }) => [styles.feedRow, pressed && tappable && { opacity: 0.6 }]}
      accessibilityRole={tappable ? 'button' : 'text'}
      accessibilityLabel={`${item.title}. ${item.body}`}
    >
      <View style={styles.feedIcon}>
        <CatIcon spec={icon} size={20} color={GOLD} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.feedTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.feedBody} numberOfLines={2}>{item.body}</Text>
      </View>
      <View style={styles.feedMeta}>
        <Text style={styles.feedTime}>{timeAgo(item.createdAt)}</Text>
        {unread && <View style={styles.unreadDot} />}
      </View>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { incoming, acceptRequest, declineRequest, refresh: refreshFriends } = useFriends();
  const { pendingInvites, acceptInvite, declineInvite, refresh: refreshChallenges } = useSharedChallenges();
  const { refreshPendingActions, markActivityRead } = useNotifications();

  const [feed, setFeed] = useState<ActivityItem[]>([]);

  // Re-pull every source on focus. The feed is loaded *before* marking it read so
  // this visit still shows what was new (unread dots), while the badge clears.
  useFocusEffect(
    useCallback(() => {
      refreshFriends();
      refreshChallenges();
      let active = true;
      (async () => {
        const items = await fetchActivityFeed();
        if (active) setFeed(items);
        await markActivityRead();
      })();
      return () => { active = false; };
    }, [refreshFriends, refreshChallenges, markActivityRead]),
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

  const hasNeedsYou = incoming.length > 0 || pendingInvites.length > 0;
  const hasRecent = feed.length > 0;
  const isEmpty = !hasNeedsYou && !hasRecent;

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
            <Text style={styles.emptyTitle}>You’re all caught up</Text>
            <Text style={styles.emptyBody}>Friend requests, challenge invites and your recent activity will show up here.</Text>
          </View>
        ) : (
          <>
            {hasNeedsYou && (
              <>
                <Text style={styles.sectionLabel}>NEEDS YOU</Text>
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

            {hasRecent && (
              <>
                <Text style={[styles.sectionLabel, hasNeedsYou && { marginTop: 12 }]}>RECENT</Text>
                <View style={styles.feedCard}>
                  {feed.map((item, i) => (
                    <View key={item.id}>
                      {i > 0 && <View style={styles.feedDivider} />}
                      <FeedItem
                        item={item}
                        onPress={() => {
                          if (item.route) router.push(item.route as Parameters<typeof router.push>[0]);
                        }}
                      />
                    </View>
                  ))}
                </View>
              </>
            )}
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

  sectionLabel: { fontFamily: fontFamily.semiBold, fontSize: 10, letterSpacing: 2, color: MUTED, marginBottom: 2, marginLeft: 4 },

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

  // Recent feed — one card, hairline-divided rows.
  feedCard: { backgroundColor: CARD_BG, borderRadius: 16, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  feedDivider: { height: 1, backgroundColor: BORDER, marginLeft: 62 },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  feedIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(232,210,0,0.10)', alignItems: 'center', justifyContent: 'center',
  },
  feedTitle: { fontFamily: fontFamily.medium, fontSize: 14, color: TEXT },
  feedBody: { fontFamily: fontFamily.light, fontSize: 12.5, color: SECONDARY, marginTop: 2, lineHeight: 17 },
  feedMeta: { alignItems: 'flex-end', gap: 6, paddingLeft: 4 },
  feedTime: { fontFamily: fontFamily.regular, fontSize: 11, color: MUTED },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: GOLD },

  empty: { alignItems: 'center', gap: 10, paddingTop: 80, paddingHorizontal: 24 },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(232,210,0,0.10)', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontFamily: fontFamily.regular, fontSize: 17, color: TEXT },
  emptyBody: { fontFamily: fontFamily.light, fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 19 },
});
