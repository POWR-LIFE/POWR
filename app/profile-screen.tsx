import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, Stop, LinearGradient as SvgLinearGradient } from 'react-native-svg';

import { LevelIcon } from '@/components/LevelIcon';
import { ProfileGeometricBackground } from '@/components/ProfileGeometricBackground';
import { ProBadge } from '@/components/ui/ProBadge';
import { getLevelInfo, LEVELS } from '@/constants/levels';
import { useAuth } from '@/context/AuthContext';
import { useAchievements } from '@/hooks/useAchievements';
import { useActivity } from '@/hooks/useActivity';
import { usePoints } from '@/hooks/usePoints';
import { useStreak } from '@/hooks/useStreak';
import { fetchGallery, type GalleryPhoto } from '@/lib/api/pro-gallery';
import { fetchProfile, type Profile } from '@/lib/api/user';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD   = '#E8D200';
const GREEN  = '#4ade80';
const ORANGE = '#f97316';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';
const CARD   = 'rgba(40,40,40,0.85)';

const SCREEN_W = Dimensions.get('window').width;

// ─── Level Ring ───────────────────────────────────────────────────────────────

const RING_SIZE = 140;
const CX = RING_SIZE / 2;
const CY = RING_SIZE / 2;
const R  = 55;
const SW = 5;

function circ(r: number) { return 2 * Math.PI * r; }
function dashOff(r: number, pct: number) { return circ(r) - pct * circ(r); }

// ─── Streak pill helper (from StreakCard) ─────────────────────────────────────

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function getStreakPill(streak: number) {
  if (streak === 0)  return { label: 'JUST STARTING',  dotColor: GOLD };
  if (streak < 3)    return { label: 'SHOWING UP',   dotColor: 'rgba(255,255,255,0.55)' };
  if (streak < 7)    return { label: 'BUILDING',     dotColor: '#4ade80' };
  if (streak < 14)   return { label: 'ON A ROLL',    dotColor: '#22c55e' };
  if (streak < 21)   return { label: 'ON FIRE',      dotColor: ORANGE };
  if (streak < 30)   return { label: 'UNSTOPPABLE',  dotColor: '#ef4444' };
  return               { label: 'LEGENDARY',    dotColor: GOLD };
}

const TILE_GAP = 10;
const TILE_W = Math.floor((SCREEN_W - 32 - TILE_GAP * 2) / 3);

const LEVEL_BY_NUMBER = new Map(LEVELS.map(l => [l.level, l]));

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { user } = useAuth();
  const { totalEarned, refresh: refreshPoints } = usePoints();
  const { currentStreak, longestStreak, multiplier } = useStreak();
  const { weekActiveDays, weeklyMetrics } = useActivity();
  const { earned: earnedAchievements, locked: lockedAchievements, earnedCount, totalCount } = useAchievements(totalEarned);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [gallery, setGallery] = useState<GalleryPhoto[]>([]);
  const [codeCopied, setCodeCopied] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setAvatarError(false);
      refreshPoints();
      fetchProfile().then(p => {
        setProfile(p);
        if (p?.is_pro) fetchGallery(p.id).then(setGallery);
      });
    }, [refreshPoints])
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

  const handleInvite = async () => {
    const code = profile?.referral_code;
    if (!code) return;
    const url = `https://powr.life/?ref=${code}`;
    const message = `Join me on POWR – the app that rewards you for every workout! 💪\n\nUse my invite code ${code} when you sign up and we both earn 20 POWR points free:\n${url}`;
    try {
      await Share.share({ message, url });
    } catch (_) {
      // user dismissed – no-op
    }
  };

  const handleCopyCode = async () => {
    const code = profile?.referral_code;
    if (!code) return;
    await Clipboard.setStringAsync(code);
    Haptics.selectionAsync();
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };
  const pill = levelInfo.pill;
  const totalSessions = weeklyMetrics.sessionCount * 4; // rough lifetime approx

  // Teaser: show up to 4 earned (highest rarity first) + 2 nearest locked
  const teaserAchievements = [
    ...earnedAchievements.slice(0, 4),
    ...lockedAchievements.slice(0, 2),
  ].slice(0, 6);

  const TICK_R = R + SW / 2 + 3;
  const todayIndex = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  const streakPill = getStreakPill(currentStreak);

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <ProfileGeometricBackground />

      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.headerBtn}>
          <Ionicons name="chevron-back" size={20} color={DIM} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.push({ pathname: '/share-stats', params: { mode: 'streak' } })} hitSlop={12} style={s.headerBtn}>
          <Ionicons name="share-outline" size={18} color={DIM} />
        </Pressable>
        <Pressable onPress={() => router.push('/settings-screen')} hitSlop={12} style={s.headerBtn}>
          <Ionicons name="settings-outline" size={18} color={DIM} />
        </Pressable>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero Card ─────────────────────────────────────── */}
        <View style={s.heroCard}>

          {/* Cover photo banner (pro users only) */}
          {profile?.cover_url ? (
            <Image
              source={{ uri: profile.cover_url }}
              style={s.coverPhoto}
              contentFit="cover"
            />
          ) : null}

          {/* Avatar + Ring — centered */}
          <View style={s.heroAvatarWrap}>
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
                  const len = major ? 6 : 2.5;
                  const r1 = TICK_R;
                  const r2 = r1 + len;
                  const within = i / 48 < xpPct;
                  return (
                    <Line key={i}
                      x1={CX + r1 * Math.cos(a)} y1={CY + r1 * Math.sin(a)}
                      x2={CX + r2 * Math.cos(a)} y2={CY + r2 * Math.sin(a)}
                      stroke={major ? '#fff' : within ? GOLD : 'rgba(255,255,255,0.08)'}
                      strokeWidth={major ? 1 : 0.6} strokeLinecap="round"
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
                <Ionicons name="camera-outline" size={11} color={TEXT} />
              </Pressable>

              {/* Your scannable code — sits just right of the avatar ring. */}
              <Pressable
                style={s.qrBadge}
                onPress={() => router.push('/my-qr')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Show my QR code"
              >
                <Ionicons name="qr-code-outline" size={19} color={GOLD} />
              </Pressable>
            </View>
          </View>

          {/* Identity — centered below ring */}
          <View style={s.identity}>
            <View style={s.nameBlock}>
              <Text style={s.displayName} numberOfLines={1}>{displayName}</Text>
              <Pressable onPress={() => router.push('/edit-profile')} hitSlop={8}>
                <Ionicons name="create-outline" size={13} color={MUTED} />
              </Pressable>
            </View>

            <Text style={s.handle} numberOfLines={1}>{handle}</Text>

            {profile?.is_pro && (
              <View style={{ marginTop: 6, marginBottom: 2 }}>
                <ProBadge />
              </View>
            )}

            <View style={s.levelPill}>
              <View style={[s.levelPillInner, { backgroundColor: pill.bg, borderColor: pill.border }]}>
                <Text style={[s.levelPillText, { color: pill.text }]}>
                  LVL {levelInfo.level} · {levelInfo.name}
                </Text>
              </View>
            </View>

            {memberSince ? (
              <Text style={s.since}>Member since {memberSince}</Text>
            ) : null}

            {profile?.bio ? (
              <Text style={s.bio}>{profile.bio}</Text>
            ) : null}
          </View>

          {/* POWR Points — featured hero stat */}
          <View style={s.heroDivider} />

          <View style={s.heroStatBlock}>
            <Text style={s.heroStatNumber}>{totalEarned.toLocaleString()}</Text>
            <Text style={s.heroStatLabel}>TOTAL XP</Text>
          </View>

          {/* XP bar */}
          <View style={s.xpRow}>
            <View style={s.xpTrack}>
              <View style={[s.xpFill, { width: `${Math.round(xpPct * 100)}%` as any }]} />
            </View>
            <Text style={s.xpText}>
              {xpIntoLevel.toLocaleString()} / {xpForLevel.toLocaleString()} XP
              {nextLevel ? ` · ${nextLevel.name} next` : ' · MAX LEVEL'}
            </Text>
          </View>
        </View>

        {/* ── Stats Strip ───────────────────────────────────── */}
        <View style={s.statsRow}>
          <StatCard value={`${currentStreak}d`}   label="Streak"      icon="flame"           color={currentStreak >= 7 ? ORANGE : TEXT} />
          <StatCard value={`${longestStreak}d`}   label="Best streak" icon="trophy-outline"   color={GOLD} />
          <StatCard value={String(totalSessions)} label="Sessions"    icon="barbell-outline"  color={TEXT} />
        </View>

        {/* ── Streak Week ───────────────────────────────────── */}
        <View style={s.glassCard}>
          <View style={s.streakHeader}>
            <View style={s.streakLeft}>
              <Ionicons name="flame" size={22} color={currentStreak >= 7 ? ORANGE : DIM} />
              <Text style={s.streakNumber}>{currentStreak}</Text>
              <View style={s.streakUnitCol}>
                <Text style={s.streakUnit}>day{currentStreak !== 1 ? 's' : ''}</Text>
                {multiplier && multiplier > 1 && (
                  <Text style={s.streakMultiplier}>{multiplier}x</Text>
                )}
              </View>
            </View>
            <View style={s.streakPillBadge}>
              <View style={[s.streakPillDot, { backgroundColor: streakPill.dotColor }]} />
              <Text style={s.streakPillText}>{streakPill.label}</Text>
            </View>
          </View>

          <View style={s.dayDotsRow}>
            {DAYS.map((day, i) => {
              const done = weekActiveDays[i] ?? false;
              const isToday = i === todayIndex;
              const isFuture = i > todayIndex;
              return (
                <View key={i} style={[
                  s.dayDot,
                  done && s.dayDotDone,
                  isToday && s.dayDotToday,
                  isFuture && s.dayDotFuture,
                ]}>
                  {done && !isFuture && (
                    <Text style={s.dayDotCheck}>✓</Text>
                  )}
                  <Text style={[s.dayDotLabel, done && s.dayDotLabelDone]}>{day}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Achievements ───────────────────────────────────── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Achievements</Text>
            <Pressable onPress={() => router.push('/achievements')}>
              <Text style={s.seeAll}>{earnedCount} / {totalCount} · See all</Text>
            </Pressable>
          </View>

          <View style={s.achieveGrid}>
            {teaserAchievements.map((a) => (
              <Pressable
                key={a.id}
                style={[s.achieveTile, { width: TILE_W }, !a.earned && { opacity: 0.4 }]}
                onPress={() => router.push('/achievements')}
              >
                <View style={[s.achieveMedallion, {
                  borderColor: a.earned ? a.colour : 'rgba(255,255,255,0.10)',
                }]}>
                  <View style={s.achieveMedallionInner}>
                    {(() => {
                      if (!a.earned) {
                        return <Ionicons name="lock-closed" size={24} color="rgba(255,255,255,0.25)" />;
                      }
                      if (a.unlock.type === 'level') {
                        const levelDef = LEVEL_BY_NUMBER.get(a.unlock.level);
                        if (levelDef) {
                          return <LevelIcon level={levelDef.level} size={28} color={a.colour} strokeWidth={1.6} />;
                        }
                      }
                      return <Ionicons name={a.icon as any} size={24} color={a.colour} />;
                    })()}
                  </View>
                  {a.earned && (
                    <View style={s.achieveCheckBadge}>
                      <Text style={s.achieveCheckMark}>✓</Text>
                    </View>
                  )}
                </View>
                <Text style={s.achieveName} numberOfLines={2}>
                  {a.unlock.type === 'level'
                    ? (LEVEL_BY_NUMBER.get(a.unlock.level)?.name ?? a.name)
                    : a.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Invite Card ─────────────────────────────────────── */}
        {profile?.referral_code && (
          <View style={[s.glassCard, s.inviteCard]}>
            <View style={s.inviteHeader}>
              <Ionicons name="gift-outline" size={20} color={GOLD} />
              <View style={s.inviteText}>
                <Text style={s.inviteTitle}>Invite a friend</Text>
                <Text style={s.inviteSub}>You both earn 20 POWR</Text>
              </View>
            </View>
            <View style={s.inviteCodeRow}>
              <Pressable
                onPress={handleCopyCode}
                style={({ pressed }) => [s.codeChip, pressed && { opacity: 0.7 }]}
              >
                <Text style={s.codeChipText}>{profile.referral_code}</Text>
                <Ionicons
                  name={codeCopied ? 'checkmark' : 'copy-outline'}
                  size={16}
                  color={codeCopied ? GREEN : DIM}
                />
              </Pressable>
              <Pressable
                onPress={handleInvite}
                style={({ pressed }) => [s.inviteBtn, pressed && { opacity: 0.86 }]}
              >
                <Text style={s.inviteBtnText}>SHARE</Text>
              </Pressable>
            </View>
            <Text style={[s.copiedHint, !codeCopied && { opacity: 0 }]}>
              Code copied to clipboard
            </Text>
          </View>
        )}

        {/* ── Gallery (Pro only) ─────────────────────────────── */}
        {profile?.is_pro && gallery.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Gallery</Text>
            <View style={s.galleryGrid}>
              {gallery.map((photo) => (
                <Image
                  key={photo.id}
                  source={{ uri: photo.url }}
                  style={s.galleryThumb}
                  contentFit="cover"
                />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ value, label, icon, color }: {
  value: string; label: string; icon: string; color: string;
}) {
  return (
    <View style={s.statCard}>
      <View style={s.statIconCircle}>
        <Ionicons name={icon as any} size={14} color={color} />
      </View>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 16 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  // ── Hero Card ──────────────────────────────────────────────────────────────
  heroCard: {
    borderRadius: 20,
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 14,
  },
  heroAvatarWrap: { alignItems: 'center' },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, position: 'relative' },
  avatarPos: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: 88, height: 88, borderRadius: 44 },
  avatarFallback: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { fontSize: 28, fontWeight: '600', color: '#0a0a0a' },
  cameraBadge: {
    position: 'absolute', bottom: 4, right: 4,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(20,20,20,0.9)', borderWidth: 1.5, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  qrBadge: {
    position: 'absolute', right: -46, top: RING_SIZE / 2 - 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(20,20,20,0.9)', borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },

  identity: { alignItems: 'center', gap: 5 },
  nameBlock: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  displayName: { fontSize: 24, fontWeight: '200', letterSpacing: -0.5, color: TEXT },
  handle: { fontSize: 12, fontWeight: '300', color: MUTED },
  levelPill: { flexDirection: 'row', marginTop: 2 },
  levelPillInner: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  levelPillText: { fontSize: 9, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  since: { fontSize: 10, fontWeight: '300', color: MUTED, marginTop: 1 },

  heroDivider: {
    width: '100%',
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 2,
  },
  heroStatBlock: { alignItems: 'center', gap: 3 },
  heroStatNumber: { fontSize: 48, fontWeight: '100', letterSpacing: -2, color: GOLD },
  heroStatLabel: {
    fontSize: 9, fontWeight: '500', letterSpacing: 2,
    color: MUTED, textTransform: 'uppercase',
  },

  xpRow: { gap: 6, width: '100%' },
  xpTrack: {
    height: 4, backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2, overflow: 'hidden',
  },
  xpFill: {
    height: '100%', borderRadius: 2, backgroundColor: GOLD,
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  xpText: { fontSize: 10, fontWeight: '300', color: MUTED, textAlign: 'center' },

  // ── Stats Strip ────────────────────────────────────────────────────────────
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 8,
  },
  statIconCircle: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  statValue: { fontSize: 22, fontWeight: '200', letterSpacing: -0.5 },
  statLabel: {
    fontSize: 8, fontWeight: '500', letterSpacing: 1.5,
    color: MUTED, textTransform: 'uppercase',
    textAlign: 'center',
  },

  // ── Glass Card (shared) ────────────────────────────────────────────────────
  glassCard: {
    borderRadius: 16,
    padding: 16,
  },

  // ── Streak Card ────────────────────────────────────────────────────────────
  streakHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  streakLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  streakNumber: { fontSize: 40, fontWeight: '100', letterSpacing: -1.5, color: GOLD },
  streakUnitCol: { gap: 0 },
  streakUnit: { fontSize: 11, fontWeight: '300', color: TEXT, letterSpacing: 0.5 },
  streakMultiplier: { fontSize: 9, fontWeight: '600', color: GOLD, marginTop: -1 },

  streakPillBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  streakPillDot: { width: 5, height: 5, borderRadius: 999 },
  streakPillText: {
    fontSize: 8, fontWeight: '500', letterSpacing: 1.5,
    color: '#ffffff', textTransform: 'uppercase',
  },

  dayDotsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  dayDot: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    gap: 1,
  },
  dayDotDone: { backgroundColor: 'transparent', borderColor: GOLD },
  dayDotToday: { borderWidth: 1.5, borderColor: '#ffffff' },
  dayDotFuture: { opacity: 0.35 },
  dayDotCheck: { fontSize: 9, color: GOLD, lineHeight: 10 },
  dayDotLabel: { fontSize: 8, color: 'rgba(255,255,255,0.4)', lineHeight: 9 },
  dayDotLabelDone: { color: '#ffffff' },

  // ── Achievements ───────────────────────────────────────────────────────────
  section: { gap: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '300', color: TEXT, letterSpacing: -0.2 },
  seeAll: { fontSize: 11, fontWeight: '300', color: GOLD },

  achieveGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: TILE_GAP },
  achieveTile: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 10,
  },
  achieveMedallion: {
    width: 60, height: 60, borderRadius: 30,
    borderWidth: 1.5,
    position: 'relative',
    backgroundColor: 'transparent',
  },
  achieveMedallionInner: {
    width: '100%', height: '100%', borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  achieveCheckBadge: {
    position: 'absolute', bottom: -1, right: -1,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#0a0a0a',
  },
  achieveCheckMark: { fontSize: 9, fontWeight: '700', color: '#0a0a0a', lineHeight: 11 },
  achieveName: { fontSize: 11, fontWeight: '300', color: TEXT, textAlign: 'center', lineHeight: 15 },

  // ── Invite Card ────────────────────────────────────────────────────────────
  inviteCard: { gap: 14 },
  inviteHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inviteText: { gap: 2 },
  inviteTitle: { fontSize: 14, fontWeight: '300', color: TEXT },
  inviteSub: { fontSize: 11, fontWeight: '300', color: MUTED },
  inviteCodeRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  codeChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  codeChipText: { fontSize: 16, fontWeight: '600', letterSpacing: 3, color: TEXT },
  inviteBtn: {
    justifyContent: 'center',
    backgroundColor: GOLD, borderRadius: 12,
    paddingHorizontal: 20,
  },
  inviteBtnText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: '#0a0a0a' },
  copiedHint: { fontSize: 11, fontWeight: '300', color: GREEN, textAlign: 'center' },

  // ── Cover photo ────────────────────────────────────────────────────────────
  coverPhoto: {
    width: '100%', height: 140, borderRadius: 0,
    marginBottom: -20,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
  },

  // ── Bio ────────────────────────────────────────────────────────────────────
  bio: {
    fontSize: 13, fontWeight: '300', color: DIM,
    textAlign: 'center', lineHeight: 19,
    marginTop: 8, paddingHorizontal: 16,
  },

  // ── Gallery ────────────────────────────────────────────────────────────────
  galleryGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8,
  },
  galleryThumb: {
    width: (SCREEN_W - 32 - 8) / 3, height: (SCREEN_W - 32 - 8) / 3,
    borderRadius: 8,
  },
});
