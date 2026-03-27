import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import GeometricBackground from '@/components/GeometricBackground';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { usePoints } from '@/hooks/usePoints';
import { useStreak } from '@/hooks/useStreak';
import { useActivity } from '@/hooks/useActivity';
import { fetchProfile, type Profile } from '@/lib/api/user';
import { getLevelInfo } from '@/constants/levels';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';



// ─── Teaser achievements (shown on profile — tap to see full screen) ──────────

const TEASER_ACHIEVEMENTS = [
  { id: 'c1', code: '7D',   name: 'First Week',  earned: true,  colour: '#E8D200' },
  { id: 'm2', code: '5K',   name: '5K Club',     earned: true,  colour: '#4ade80' },
  { id: 'm5', code: 'GYM',  name: 'Gym Rat',     earned: true,  colour: '#4ade80' },
  { id: 'c2', code: '30D',  name: 'Month Strong', earned: false, colour: '#E8D200' },
  { id: 'l1', code: 'AM',   name: 'Early Bird',  earned: true,  colour: '#38bdf8' },
  { id: 's1', code: 'TOP',  name: 'Top 10%',     earned: false, colour: '#fb923c' },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { user, signOut } = useAuth();
  const { totalEarned, balance } = usePoints();
  const { currentStreak, longestStreak } = useStreak();
  const { weeklyMetrics } = useActivity();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    fetchProfile().then(setProfile);
  }, []);

  // Derive display values
  const displayName = profile?.display_name
    ?? user?.user_metadata?.full_name
    ?? user?.email?.split('@')[0]
    ?? 'You';
  const handle = profile?.username ? `@${profile.username}` : user?.email ?? '';
  const initials = displayName.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    : '—';

  const { current: levelInfo } = getLevelInfo(totalEarned);
  const earnedCount = TEASER_ACHIEVEMENTS.filter(a => a.earned).length;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
        <Pressable
          style={styles.settingsBtn}
          onPress={() => router.push('/settings-screen')}
          hitSlop={8}
        >
          <Ionicons name="settings-outline" size={20} color={DIM} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Identity ─────────────────────────────────────────── */}
        <View style={styles.identityCard}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials || '?'}</Text>
            </View>
            <Pressable style={styles.editAvatarBtn}>
              <Ionicons name="camera-outline" size={13} color={TEXT} />
            </Pressable>
          </View>

          <View style={styles.identityInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{displayName}</Text>
              <Pressable style={styles.editNameBtn}>
                <Ionicons name="pencil-outline" size={13} color={MUTED} />
              </Pressable>
            </View>
            <Text style={styles.handle}>{handle}</Text>

            <View style={styles.metaRow}>
              <View style={styles.levelBadge}>
                <Text style={styles.levelBadgeText}>
                  LVL {levelInfo.level} · {levelInfo.name}
                </Text>
              </View>
              <Text style={styles.memberSince}>Since {memberSince}</Text>
            </View>
          </View>
        </View>

        {/* ── Stats ────────────────────────────────────────────── */}
        <View style={styles.statsRow}>
          <StatBlock value={totalEarned.toLocaleString()} label="Total POWR" gold />
          <View style={styles.statDivider} />
          <StatBlock value={String(weeklyMetrics.sessionCount * 4)} label="Sessions" />
          <View style={styles.statDivider} />
          <StatBlock value={`${longestStreak}d`} label="Best Streak" />
        </View>

        {/* ── Achievements ─────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.metaLabel}>Achievements</Text>
            <Pressable onPress={() => router.push({ pathname: '/(tabs)/league', params: { tab: 'journey' } })}>
              <Text style={styles.seeAll}>{earnedCount} unlocked · See all →</Text>
            </Pressable>
          </View>
          <View style={styles.achievementsGrid}>
            {TEASER_ACHIEVEMENTS.map((a) => (
              <Pressable
                key={a.id}
                style={[styles.badge, !a.earned && styles.badgeLocked]}
                onPress={() => router.push({ pathname: '/(tabs)/league', params: { tab: 'journey' } })}
              >
                <Text style={[styles.badgeCode, !a.earned && styles.badgeCodeLocked, { color: a.earned ? a.colour : MUTED }]}>
                  {a.earned ? a.code : '—'}
                </Text>
                <Text style={[styles.badgeLabel, !a.earned && styles.badgeLabelLocked]}>
                  {a.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Referral ─────────────────────────────────────────── */}
        <View style={styles.referralCard}>
          <View style={styles.referralAccentBar} />
          <View style={styles.referralInner}>
            <Text style={styles.referralTitle}>Invite a friend</Text>
            <Text style={styles.referralSub}>
              You both earn 200 bonus POWR when they complete their first workout.
            </Text>
            <Pressable style={styles.referralBtn}>
              <Text style={styles.referralBtnText}>Share invite</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Quick links ───────────────────────────────────────── */}
        <View style={styles.card}>
          {[
            { label: 'Settings',             icon: 'settings-outline',      onPress: () => router.push('/settings-screen') },
            { label: 'Connected Wearables',  icon: 'watch-outline',         onPress: () => {} },
            { label: 'Help & Support',       icon: 'help-circle-outline',   onPress: () => {} },
          ].map((row, i, arr) => (
            <Pressable
              key={row.label}
              style={({ pressed }) => [
                styles.linkRow,
                i < arr.length - 1 && styles.linkRowBorder,
                pressed && { opacity: 0.7 },
              ]}
              onPress={row.onPress}
            >
              <View style={styles.linkIcon}>
                <Ionicons name={row.icon as any} size={17} color={GOLD} />
              </View>
              <Text style={styles.linkLabel}>{row.label}</Text>
              <Ionicons name="chevron-forward" size={14} color={MUTED} />
            </Pressable>
          ))}
        </View>

        {/* ── Sign out ──────────────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [styles.signOutBtn, pressed && { opacity: 0.7 }]}
          onPress={signOut}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatBlock({ value, label, gold }: { value: string; label: string; gold?: boolean }) {
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, gold && styles.statValueGold]}>{value}</Text>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
  },
  headerTitle: { fontSize: 16, fontWeight: '400', letterSpacing: 0.5, color: TEXT },
  settingsBtn: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
  },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 12, gap: 10, paddingTop: 8 },

  // Identity
  identityCard: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    borderRadius: 20, padding: 18, gap: 16,
  },
  avatarWrap: { position: 'relative', alignSelf: 'center' },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 26, fontWeight: '600', color: '#0a0a0a' },
  editAvatarBtn: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#1a1a1a', borderWidth: 1.5, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  identityInfo: { gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 22, fontWeight: '300', letterSpacing: -0.3, color: TEXT },
  editNameBtn: { padding: 4 },
  handle: { fontSize: 13, fontWeight: '300', color: MUTED },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  levelBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
    backgroundColor: 'rgba(232,210,0,0.10)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.25)',
  },
  levelBadgeText: {
    fontSize: 10, fontWeight: '600', letterSpacing: 0.5, color: GOLD, textTransform: 'uppercase',
  },
  memberSince: { fontSize: 11, fontWeight: '300', color: MUTED },

  // Stats
  statsRow: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center',
  },
  statBlock: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { fontSize: 22, fontWeight: '100', letterSpacing: -1, color: TEXT },
  statValueGold: { color: GOLD },
  statLabel: { fontSize: 8, fontWeight: '500', letterSpacing: 1.5, color: MUTED, textTransform: 'uppercase' },
  statDivider: { width: 1, height: 32, backgroundColor: BORDER },

  // Card
  card: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    borderRadius: 16, padding: 14, gap: 12,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaLabel: { fontSize: 9, fontWeight: '500', letterSpacing: 2, color: MUTED, textTransform: 'uppercase' },
  seeAll: { fontSize: 11, fontWeight: '300', color: GOLD },

  // Achievements
  achievementsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: {
    alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 10,
    borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', minWidth: 60,
  },
  badgeLocked: { opacity: 0.35 },
  badgeCode: { fontSize: 16, fontWeight: '200', letterSpacing: -0.5 },
  badgeCodeLocked: { color: MUTED },
  badgeLabel: {
    fontSize: 8, fontWeight: '500', letterSpacing: 0.5, color: DIM,
    textTransform: 'uppercase', textAlign: 'center',
  },
  badgeLabelLocked: { color: MUTED },

  // Referral
  referralCard: {
    backgroundColor: 'rgba(20,18,5,0.95)', borderWidth: 1, borderColor: BORDER,
    borderRadius: 16, overflow: 'hidden', flexDirection: 'row',
  },
  referralAccentBar: { width: 2, backgroundColor: GOLD, opacity: 0.9 },
  referralInner: { flex: 1, padding: 14, gap: 8 },
  referralTitle: { fontSize: 16, fontWeight: '300', color: TEXT },
  referralSub: { fontSize: 12, fontWeight: '300', color: DIM, lineHeight: 18 },
  referralBtn: {
    alignSelf: 'flex-start', backgroundColor: GOLD, borderRadius: 20,
    paddingHorizontal: 18, paddingVertical: 8, marginTop: 4,
  },
  referralBtnText: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: '#0a0a0a', textTransform: 'uppercase',
  },

  // Quick links
  linkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 12 },
  linkRowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  linkIcon: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: 'rgba(232,210,0,0.08)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  linkLabel: { flex: 1, fontSize: 14, fontWeight: '300', color: TEXT },

  // Sign out
  signOutBtn: {
    paddingVertical: 14, alignItems: 'center',
    borderRadius: 16, borderWidth: 1, borderColor: BORDER,
  },
  signOutText: { fontSize: 13, fontWeight: '300', color: MUTED },
});
