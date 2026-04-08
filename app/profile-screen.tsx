import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';

import { GeometricBackground } from '@/components/home/GeometricBackground';
import { useAuth } from '@/context/AuthContext';
import { usePoints } from '@/hooks/usePoints';
import { useStreak } from '@/hooks/useStreak';
import { useActivity } from '@/hooks/useActivity';
import { fetchProfile, type Profile } from '@/lib/api/user';
import { getLevelInfo } from '@/constants/levels';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD   = '#E8D200';
const GREEN  = '#4ade80';
const ORANGE = '#f97316';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';

// ─── Level Ring ───────────────────────────────────────────────────────────────

const RING_SIZE = 148;
const CX = RING_SIZE / 2;
const CY = RING_SIZE / 2;
const R  = 58;
const SW = 6;

function circ(r: number) { return 2 * Math.PI * r; }
function dashOff(r: number, pct: number) { return circ(r) - pct * circ(r); }

// ─── Achievements ─────────────────────────────────────────────────────────────

const TEASER_ACHIEVEMENTS = [
  { id: 'c1', code: '7D',  name: 'First Week',   earned: true,  colour: GOLD,      icon: 'flame' },
  { id: 'm2', code: '5K',  name: '5K Club',      earned: true,  colour: GREEN,     icon: 'footsteps' },
  { id: 'm5', code: 'GYM', name: 'Gym Rat',      earned: true,  colour: GREEN,     icon: 'barbell' },
  { id: 'c2', code: '30D', name: 'Month Strong', earned: false, colour: GOLD,      icon: 'calendar' },
  { id: 'l1', code: 'AM',  name: 'Early Bird',   earned: true,  colour: '#38bdf8', icon: 'sunny' },
  { id: 's1', code: 'TOP', name: 'Top 10%',      earned: false, colour: ORANGE,    icon: 'trophy' },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { user } = useAuth();
  const { totalEarned, balance } = usePoints();
  const { currentStreak, longestStreak } = useStreak();
  const { weeklyMetrics } = useActivity();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarError, setAvatarError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setAvatarError(false);
      fetchProfile().then(setProfile);
    }, [])
  );

  const displayName = profile?.display_name
    ?? user?.user_metadata?.full_name
    ?? user?.email?.split('@')[0]
    ?? 'You';
  const handle = profile?.username ? `@${profile.username}` : user?.email ?? '';
  const initials = displayName.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : '';

  const { current: levelInfo, next: nextLevel, xpIntoLevel, xpForLevel } = getLevelInfo(totalEarned);
  const xpPct = Math.min(xpIntoLevel / xpForLevel, 1);
  const pill = levelInfo.pill;
  const earnedCount = TEASER_ACHIEVEMENTS.filter(a => a.earned).length;
  const totalSessions = weeklyMetrics.sessionCount * 4; // rough lifetime approx

  const TICK_R = R + SW / 2 + 3;

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      {/* Header — minimal */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.headerBtn}>
          <Ionicons name="chevron-back" size={20} color={DIM} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.push('/settings-screen')} hitSlop={12} style={s.headerBtn}>
          <Ionicons name="settings-outline" size={18} color={DIM} />
        </Pressable>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Identity Hero ──────────────────────────────────── */}
        <View style={s.hero}>
          {/* Avatar inside level ring */}
          <View style={s.ringWrap}>
            <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
              <Defs>
                <SvgLinearGradient id="pg" x1="0%" y1="0%" x2="100%" y2="100%">
                  <Stop offset="0%"   stopColor={GOLD}   />
                  <Stop offset="50%"  stopColor={ORANGE}  />
                  <Stop offset="100%" stopColor={GREEN}   />
                </SvgLinearGradient>
              </Defs>

              {Array.from({ length: 48 }, (_, i) => {
                const a = (i * 7.5 - 90) * (Math.PI / 180);
                const major = i % 4 === 0;
                const len = major ? 7 : 3;
                const r1 = TICK_R;
                const r2 = r1 + len;
                const within = i / 48 < xpPct;
                return (
                  <Line key={i}
                    x1={CX + r1 * Math.cos(a)} y1={CY + r1 * Math.sin(a)}
                    x2={CX + r2 * Math.cos(a)} y2={CY + r2 * Math.sin(a)}
                    stroke={major ? '#fff' : within ? GOLD : 'rgba(255,255,255,0.08)'}
                    strokeWidth={major ? 1.2 : 0.7} strokeLinecap="round"
                  />
                );
              })}

              <Circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={SW} />
              <Circle cx={CX} cy={CY} r={R} fill="none" stroke="url(#pg)" strokeWidth={SW}
                strokeLinecap="round" strokeDasharray={circ(R)} strokeDashoffset={dashOff(R, xpPct)}
                transform={`rotate(-90 ${CX} ${CY})`}
              />
            </Svg>

            <View style={s.avatarPos}>
              {profile?.avatar_url && !avatarError ? (
                <Image key={profile.avatar_url} source={{ uri: profile.avatar_url }}
                  style={s.avatarImg} contentFit="cover" onError={() => setAvatarError(true)} />
              ) : (
                <View style={s.avatarFallback}>
                  <Text style={s.avatarLetter}>{initials || '?'}</Text>
                </View>
              )}
            </View>

            <Pressable style={s.cameraBadge} onPress={() => router.push('/edit-profile')}>
              <Ionicons name="camera-outline" size={12} color={TEXT} />
            </Pressable>
          </View>

          {/* Name */}
          <View style={s.nameBlock}>
            <Text style={s.displayName}>{displayName}</Text>
            <Pressable onPress={() => router.push('/edit-profile')} hitSlop={8}>
              <Ionicons name="create-outline" size={14} color={MUTED} />
            </Pressable>
          </View>

          <Text style={s.handle}>{handle}</Text>

          {/* Level + member since */}
          <View style={s.tagRow}>
            <View style={[s.levelPill, { backgroundColor: pill.bg, borderColor: pill.border }]}>
              <Text style={[s.levelPillText, { color: pill.text }]}>
                LVL {levelInfo.level} · {levelInfo.name}
              </Text>
            </View>
            {memberSince ? (
              <Text style={s.since}>Member since {memberSince}</Text>
            ) : null}
          </View>

          {/* XP progress */}
          <View style={s.xpRow}>
            <View style={s.xpTrack}>
              <View style={[s.xpFill, { width: `${Math.round(xpPct * 100)}%` as any }]} />
            </View>
            <Text style={s.xpText}>
              {xpIntoLevel.toLocaleString()} / {xpForLevel.toLocaleString()} XP
              {nextLevel ? ` to ${nextLevel.name}` : ''}
            </Text>
          </View>
        </View>

        {/* ── Lifetime Numbers ───────────────────────────────── */}
        <View style={s.numbersRow}>
          <View style={s.numCol}>
            <Text style={[s.numValue, { color: GOLD }]}>{totalEarned.toLocaleString()}</Text>
            <Text style={s.numLabel}>POWR earned</Text>
          </View>
          <View style={s.numDivider} />
          <View style={s.numCol}>
            <Text style={s.numValue}>{totalSessions}</Text>
            <Text style={s.numLabel}>Sessions</Text>
          </View>
          <View style={s.numDivider} />
          <View style={s.numCol}>
            <Text style={s.numValue}>{longestStreak}d</Text>
            <Text style={s.numLabel}>Best streak</Text>
          </View>
        </View>

        {/* ── Current streak callout ─────────────────────────── */}
        {currentStreak > 0 && (
          <View style={s.streakCallout}>
            <Ionicons name="flame" size={18} color={currentStreak >= 7 ? ORANGE : DIM} />
            <Text style={s.streakText}>
              {currentStreak} day streak
            </Text>
            <Text style={s.streakHint}>
              {currentStreak >= 7 ? 'On fire' : currentStreak >= 3 ? 'Building momentum' : 'Keep going'}
            </Text>
          </View>
        )}

        {/* ── Achievements ───────────────────────────────────── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Achievements</Text>
            <Pressable onPress={() => router.push({ pathname: '/(tabs)/league', params: { tab: 'journey' } })}>
              <Text style={s.seeAll}>{earnedCount} earned · See all</Text>
            </Pressable>
          </View>

          <View style={s.badgeRow}>
            {TEASER_ACHIEVEMENTS.map((a) => (
              <Pressable key={a.id} style={[s.badge, !a.earned && s.badgeLocked]}
                onPress={() => router.push({ pathname: '/(tabs)/league', params: { tab: 'journey' } })}
              >
                <Ionicons
                  name={(a.earned ? a.icon : 'lock-closed') as any}
                  size={18}
                  color={a.earned ? a.colour : MUTED}
                />
                <Text style={[s.badgeName, { color: a.earned ? a.colour : MUTED }]}>{a.code}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Balance ────────────────────────────────────────── */}
        <View style={s.balanceRow}>
          <View style={s.balanceLeft}>
            <Ionicons name="wallet-outline" size={16} color={GOLD} />
            <Text style={s.balanceLabel}>Available balance</Text>
          </View>
          <Text style={s.balanceValue}>{balance.toLocaleString()} POWR</Text>
        </View>

        {/* ── Invite ─────────────────────────────────────────── */}
        <Pressable style={({ pressed }) => [s.inviteRow, pressed && { opacity: 0.7 }]}>
          <Ionicons name="gift-outline" size={16} color={GOLD} />
          <View style={s.inviteText}>
            <Text style={s.inviteTitle}>Invite a friend</Text>
            <Text style={s.inviteSub}>Both earn 200 POWR</Text>
          </View>
          <Pressable style={s.inviteBtn}>
            <Text style={s.inviteBtnText}>SHARE</Text>
          </Pressable>
        </Pressable>

        {/* ── Links ──────────────────────────────────────────── */}
        <View style={s.links}>
          <LinkRow icon="create-outline" label="Log workout" onPress={() => router.push('/manual-log')} />
          <LinkRow icon="options-outline" label="Activity preferences" onPress={() => router.push('/activity-preferences')} />
          <LinkRow icon="stats-chart-outline" label="Progress" onPress={() => router.push('/(tabs)/progress')} />
          <LinkRow icon="person-outline" label="Edit profile" onPress={() => router.push('/edit-profile')} />
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LinkRow({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [s.linkRow, pressed && { opacity: 0.6 }]} onPress={onPress}>
      <Ionicons name={icon as any} size={16} color={DIM} />
      <Text style={s.linkLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={14} color={MUTED} />
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 24 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  // ── Hero ────────────────────────────────────────────────────────────────────
  hero: { alignItems: 'center', gap: 8, paddingTop: 8 },

  ringWrap: { width: RING_SIZE, height: RING_SIZE, position: 'relative' },
  avatarPos: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: 92, height: 92, borderRadius: 46 },
  avatarFallback: {
    width: 92, height: 92, borderRadius: 46,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { fontSize: 30, fontWeight: '600', color: '#0a0a0a' },
  cameraBadge: {
    position: 'absolute', bottom: 6, right: 6,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(20,20,20,0.9)', borderWidth: 1.5, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },

  nameBlock: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  displayName: { fontSize: 26, fontWeight: '200', letterSpacing: -0.5, color: TEXT },
  handle: { fontSize: 13, fontWeight: '300', color: MUTED, marginTop: -2 },

  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  levelPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  levelPillText: { fontSize: 9, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  since: { fontSize: 11, fontWeight: '300', color: MUTED },

  xpRow: { alignSelf: 'stretch', gap: 5, marginTop: 4, paddingHorizontal: 20 },
  xpTrack: {
    height: 3, backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 1.5, overflow: 'hidden',
  },
  xpFill: { height: '100%', borderRadius: 1.5, backgroundColor: GOLD },
  xpText: { fontSize: 10, fontWeight: '300', color: MUTED, textAlign: 'center' },

  // ── Lifetime Numbers ────────────────────────────────────────────────────────
  numbersRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 4,
  },
  numCol: { flex: 1, alignItems: 'center', gap: 3 },
  numValue: { fontSize: 28, fontWeight: '100', letterSpacing: -1, color: TEXT },
  numLabel: { fontSize: 9, fontWeight: '400', letterSpacing: 0.5, color: MUTED, textTransform: 'uppercase' },
  numDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.06)' },

  // ── Streak Callout ──────────────────────────────────────────────────────────
  streakCallout: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 4,
  },
  streakText: { fontSize: 16, fontWeight: '200', color: TEXT, letterSpacing: -0.3 },
  streakHint: { fontSize: 11, fontWeight: '300', color: MUTED, marginLeft: 'auto' },

  // ── Achievements ────────────────────────────────────────────────────────────
  section: { gap: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '300', color: TEXT, letterSpacing: -0.2 },
  seeAll: { fontSize: 11, fontWeight: '300', color: GOLD },

  badgeRow: { flexDirection: 'row', gap: 4 },
  badge: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12 },
  badgeLocked: { opacity: 0.3 },
  badgeName: { fontSize: 10, fontWeight: '400', letterSpacing: 0.5 },

  // ── Balance ─────────────────────────────────────────────────────────────────
  balanceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  balanceLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  balanceLabel: { fontSize: 13, fontWeight: '300', color: DIM },
  balanceValue: { fontSize: 15, fontWeight: '200', color: GOLD, letterSpacing: -0.3 },

  // ── Invite ──────────────────────────────────────────────────────────────────
  inviteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 2,
  },
  inviteText: { flex: 1, gap: 1 },
  inviteTitle: { fontSize: 14, fontWeight: '300', color: TEXT },
  inviteSub: { fontSize: 11, fontWeight: '300', color: MUTED },
  inviteBtn: {
    backgroundColor: GOLD, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 7,
  },
  inviteBtnText: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: '#0a0a0a' },

  // ── Links ───────────────────────────────────────────────────────────────────
  links: { gap: 2 },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, paddingHorizontal: 2,
  },
  linkLabel: { flex: 1, fontSize: 14, fontWeight: '300', color: TEXT },
});
