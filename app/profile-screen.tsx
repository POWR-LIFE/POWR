import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#facc15';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

// ─── Mock data ────────────────────────────────────────────────────────────────

const USER = {
  initials:    'AJ',
  name:        'Alex Johnson',
  handle:      '@alexj',
  bio:         'Running, lifting, and earning. London-based.',
  level:       2,
  levelName:   'Mover',
  totalPoints: 8_340,
  sessions:    47,
  bestStreak:  14,
  memberSince: 'Jan 2025',
};

interface Achievement {
  id: string; icon: string; label: string; earned: boolean;
}

const ACHIEVEMENTS: Achievement[] = [
  { id: '1', icon: '🔥', label: 'On Fire',   earned: true  },
  { id: '2', icon: '🏃', label: 'First Run', earned: true  },
  { id: '3', icon: '💪', label: 'Gym Rat',   earned: true  },
  { id: '4', icon: '🌊', label: 'Swimmer',   earned: false },
  { id: '5', icon: '⚡', label: 'Streak 30', earned: false },
  { id: '6', icon: '🏆', label: 'Elite',     earned: false },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* ── Header ──────────────────────────────────────────── */}
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={8}
        >
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
        {/* ── Avatar + identity ────────────────────────────── */}
        <View style={styles.identityCard}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{USER.initials}</Text>
            </View>
            <Pressable style={styles.editAvatarBtn}>
              <Ionicons name="camera-outline" size={13} color={TEXT} />
            </Pressable>
          </View>

          <View style={styles.identityInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{USER.name}</Text>
              <Pressable style={styles.editNameBtn}>
                <Ionicons name="pencil-outline" size={13} color={MUTED} />
              </Pressable>
            </View>
            <Text style={styles.handle}>{USER.handle}</Text>
            {USER.bio ? (
              <Text style={styles.bio}>{USER.bio}</Text>
            ) : null}

            <View style={styles.metaRow}>
              <View style={styles.levelBadge}>
                <Text style={styles.levelBadgeText}>
                  LVL {USER.level} · {USER.levelName}
                </Text>
              </View>
              <Text style={styles.memberSince}>Since {USER.memberSince}</Text>
            </View>
          </View>
        </View>

        {/* ── Stats ────────────────────────────────────────── */}
        <View style={styles.statsRow}>
          <StatBlock value={USER.totalPoints.toLocaleString()} label="TOTAL POWR" gold />
          <View style={styles.statDivider} />
          <StatBlock value={String(USER.sessions)} label="SESSIONS" />
          <View style={styles.statDivider} />
          <StatBlock value={`${USER.bestStreak}d`} label="BEST STREAK" />
        </View>

        {/* ── Achievements ─────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.metaLabel}>ACHIEVEMENTS</Text>
            <Pressable>
              <Text style={styles.seeAll}>See all →</Text>
            </Pressable>
          </View>
          <View style={styles.achievementsGrid}>
            {ACHIEVEMENTS.map((a) => (
              <View
                key={a.id}
                style={[styles.badge, !a.earned && styles.badgeLocked]}
              >
                <Text style={[styles.badgeIcon, !a.earned && styles.badgeIconLocked]}>
                  {a.earned ? a.icon : '?'}
                </Text>
                <Text style={[styles.badgeLabel, !a.earned && styles.badgeLabelLocked]}>
                  {a.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Referral ─────────────────────────────────────── */}
        <View style={styles.referralCard}>
          <View style={styles.referralAccentBar} />
          <View style={styles.referralInner}>
            <Text style={styles.referralTitle}>Invite a friend</Text>
            <Text style={styles.referralSub}>
              You both earn 200 bonus POWR when they complete their first workout.
            </Text>
            <Pressable style={styles.referralBtn}>
              <Text style={styles.referralBtnText}>SHARE INVITE</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Quick links ───────────────────────────────────── */}
        <View style={styles.card}>
          {QUICK_LINKS.map((row, i) => (
            <Pressable
              key={row.label}
              style={({ pressed }) => [
                styles.linkRow,
                i < QUICK_LINKS.length - 1 && styles.linkRowBorder,
                pressed && { opacity: 0.7 },
              ]}
              onPress={row.onPress ? row.onPress(router) : undefined}
            >
              <View style={styles.linkIcon}>
                <Ionicons name={row.icon as any} size={17} color={GOLD} />
              </View>
              <Text style={styles.linkLabel}>{row.label}</Text>
              <Ionicons name="chevron-forward" size={14} color={MUTED} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Quick links config ───────────────────────────────────────────────────────

const QUICK_LINKS = [
  {
    label: 'Settings',
    icon: 'settings-outline',
    onPress: (router: any) => () => router.push('/settings-screen'),
  },
  {
    label: 'Connected Wearables',
    icon: 'watch-outline',
    onPress: null,
  },
  {
    label: 'Help & Support',
    icon: 'help-circle-outline',
    onPress: null,
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatBlock({
  value,
  label,
  gold,
}: {
  value: string;
  label: string;
  gold?: boolean;
}) {
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, gold && styles.statValueGold]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '400',
    letterSpacing: 0.5,
    color: TEXT,
  },
  settingsBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },

  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 12,
    gap: 10,
    paddingTop: 8,
  },

  // Identity card
  identityCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    padding: 18,
    gap: 16,
  },
  avatarWrap: {
    position: 'relative',
    alignSelf: 'center',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 26,
    fontWeight: '600',
    color: '#0a0a0a',
  },
  editAvatarBtn: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1a1a1a',
    borderWidth: 1.5,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityInfo: {
    gap: 6,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 22,
    fontWeight: '300',
    letterSpacing: -0.3,
    color: TEXT,
  },
  editNameBtn: {
    padding: 4,
  },
  handle: {
    fontSize: 13,
    fontWeight: '300',
    color: MUTED,
  },
  bio: {
    fontSize: 13,
    fontWeight: '300',
    color: DIM,
    lineHeight: 19,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  levelBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(250,204,21,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.25)',
  },
  levelBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: GOLD,
    textTransform: 'uppercase',
  },
  memberSince: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
  },

  // Stats
  statsRow: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statBlock: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '100',
    letterSpacing: -1,
    color: TEXT,
  },
  statValueGold: { color: GOLD },
  statLabel: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: MUTED,
    textTransform: 'uppercase',
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: BORDER,
  },

  // Card
  card: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 2,
    color: MUTED,
    textTransform: 'uppercase',
  },
  seeAll: {
    fontSize: 11,
    fontWeight: '300',
    color: GOLD,
  },

  // Achievements
  achievementsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(250,204,21,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.20)',
    minWidth: 64,
  },
  badgeLocked: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: BORDER,
  },
  badgeIcon: { fontSize: 22 },
  badgeIconLocked: { opacity: 0.2 },
  badgeLabel: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: GOLD,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  badgeLabelLocked: { color: MUTED },

  // Referral
  referralCard: {
    backgroundColor: 'rgba(20,18,5,0.95)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  referralAccentBar: {
    width: 2,
    backgroundColor: GOLD,
    opacity: 0.9,
  },
  referralInner: {
    flex: 1,
    padding: 14,
    gap: 8,
  },
  referralTitle: {
    fontSize: 16,
    fontWeight: '300',
    color: TEXT,
  },
  referralSub: {
    fontSize: 12,
    fontWeight: '300',
    color: DIM,
    lineHeight: 18,
  },
  referralBtn: {
    alignSelf: 'flex-start',
    backgroundColor: GOLD,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginTop: 4,
  },
  referralBtnText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#0a0a0a',
    textTransform: 'uppercase',
  },

  // Quick links
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 12,
  },
  linkRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  linkIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(250,204,21,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '300',
    color: TEXT,
  },
});
