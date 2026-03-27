import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { GeometricBackground } from '@/components/home/GeometricBackground';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  withSequence,
} from 'react-native-reanimated';
import { Circle, Svg } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProfileButton } from '@/components/ProfileButton';
import { JourneyFullView } from '@/components/JourneyFullView';
import { formatCountdown, msUntilLeagueReset } from '@/lib/journey';

// ─── Constants ────────────────────────────────────────────────────────────────

const GOLD   = '#E8D200';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const SILVER = '#c0c0c0';
const BRONZE = '#cd7f32';
const BG     = '#1E1E1E';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

const SCREEN_W = Dimensions.get('window').width;
const TAB_W    = SCREEN_W / 2;

// ─── League mock data ─────────────────────────────────────────────────────────

const PROMOTE_ZONE = 3;
const DEMOTE_ZONE  = 3;
const YOU_RANK     = 8;

interface Competitor { name: string; xp: number; isYou: boolean }

const MOCK_COMPETITORS: Competitor[] = [
  { name: 'Chloe R.',  xp: 612, isYou: false },
  { name: 'James M.',  xp: 580, isYou: false },
  { name: 'Priya K.',  xp: 541, isYou: false },
  { name: 'Alex T.',   xp: 498, isYou: false },
  { name: 'Tom W.',    xp: 462, isYou: false },
  { name: 'Fatima A.', xp: 430, isYou: false },
  { name: 'Daniel S.', xp: 395, isYou: false },
  { name: 'You',       xp: 340, isYou: true  },
  { name: 'Kai L.',    xp: 310, isYou: false },
  { name: 'Sofia B.',  xp: 280, isYou: false },
  { name: 'Marcus H.', xp: 255, isYou: false },
  { name: 'Nadia V.',  xp: 240, isYou: false },
  { name: 'Owen C.',   xp: 215, isYou: false },
  { name: 'Lily T.',   xp: 195, isYou: false },
  { name: 'Sam G.',    xp: 178, isYou: false },
  { name: 'Ines P.',   xp: 160, isYou: false },
  { name: 'Ben R.',    xp: 145, isYou: false },
  { name: 'Maya K.',   xp: 120, isYou: false },
  { name: 'Luca D.',   xp:  98, isYou: false },
  { name: 'Hanna F.',  xp:  60, isYou: false },
];

const MOCK_LEAGUE = {
  tier:        'Silver',
  tierColour:  SILVER,
  rank:        YOU_RANK,
  total:       MOCK_COMPETITORS.length,
  xpThisWeek:  340,
  xpToPromote: 541,
  competitors: MOCK_COMPETITORS,
};

// ─── Journey snapshot ─────────────────────────────────────────────────────────

// (Journey specific calculations removed as they are now handled by JourneyFullView)

// ─── Podium rank metadata ─────────────────────────────────────────────────────

const RANK_META = {
  1: { colour: GOLD,   platformH: 74, avatarSize: 52 },
  2: { colour: SILVER, platformH: 52, avatarSize: 44 },
  3: { colour: BRONZE, platformH: 36, avatarSize: 40 },
} as const;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LeagueScreen() {
  const insets    = useSafeAreaInsets();
  const router    = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const [activeTab, setActiveTab] = useState(0);
  const indicatorX = useSharedValue(0);

  const { tab } = useLocalSearchParams<{ tab?: string }>();

  const [countdown, setCountdown] = useState(formatCountdown(msUntilLeagueReset()));
  const urgentReset = msUntilLeagueReset() < 86_400_000;

  useEffect(() => {
    const id = setInterval(() => setCountdown(formatCountdown(msUntilLeagueReset())), 60_000);
    return () => clearInterval(id);
  }, []);

  // Handle deep-linking to specific tab
  useEffect(() => {
    if (tab === 'journey') {
      goToTab(1);
    } else if (tab === 'leaderboard') {
      goToTab(0);
    }
  }, [tab]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
  }));

  function goToTab(index: number) {
    setActiveTab(index);
    scrollRef.current?.scrollTo({ x: index * SCREEN_W, animated: true });
    indicatorX.value = withTiming(index * TAB_W, { duration: 220 });
  }

  function onMomentumScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    setActiveTab(index);
    indicatorX.value = withTiming(index * TAB_W, { duration: 220 });
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />
      {/* ── Screen header ─────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.title}>League</Text>
        <ProfileButton />
      </View>

      {/* ── Top tab bar ───────────────────────────── */}
      <View style={styles.topTabBar}>
        <Pressable style={styles.topTab} onPress={() => goToTab(0)}>
          <Text style={[styles.topTabText, activeTab === 0 && styles.topTabTextActive]}>
            Leaderboard
          </Text>
        </Pressable>
        <Pressable style={styles.topTab} onPress={() => goToTab(1)}>
          <Text style={[styles.topTabText, activeTab === 1 && styles.topTabTextActive]}>
            Journey
          </Text>
        </Pressable>
        {/* Animated gold underline */}
        <Animated.View style={[styles.tabIndicator, indicatorStyle]} />
      </View>

      {/* ── Paged content ─────────────────────────── */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        {/* Page 0 — Leaderboard */}
        <ScrollView
          style={styles.page}
          contentContainerStyle={[styles.pageContent, { paddingBottom: insets.bottom + 88 }]}
          showsVerticalScrollIndicator={false}
        >
          <LeagueCard
            league={MOCK_LEAGUE}
            countdown={countdown}
            urgent={urgentReset}
          />
        </ScrollView>

        {/* Page 1 — Journey */}
        <ScrollView
          style={styles.page}
          contentContainerStyle={[styles.pageContent, { paddingBottom: insets.bottom + 88 }]}
          showsVerticalScrollIndicator={false}
        >
          <JourneyFullView />
        </ScrollView>
      </ScrollView>
    </View>
  );
}

// ─── League Card ──────────────────────────────────────────────────────────────

interface LeagueCardProps {
  league: typeof MOCK_LEAGUE;
  countdown: string;
  urgent: boolean;
}

function LeagueCard({ league, countdown, urgent }: LeagueCardProps) {
  const progress = Math.min(league.xpThisWeek / league.xpToPromote, 1);
  const xpBehind = league.xpToPromote - league.xpThisWeek;
  const restList = league.competitors.slice(PROMOTE_ZONE);
  const tc       = league.tierColour;

  return (
    <View style={[styles.leagueCard, { borderColor: `${tc}25` }]}>
      <LinearGradient
        colors={[`${tc}1A`, `${tc}07`, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Hero rank */}
      <View style={styles.leagueHeroRow}>
        <View style={styles.leagueHeroLeft}>
          <Text style={[styles.leagueHeroRank, { color: tc }]}>#{league.rank}</Text>
          <View style={styles.leagueHeroMeta}>
            <Text style={styles.leagueHeroLabel}>{league.tier.toUpperCase()} LEAGUE</Text>
            <Text style={styles.leagueHeroSub}>of {league.total} competitors</Text>
          </View>
        </View>
        <CountdownBadge label={countdown} urgent={urgent} />
      </View>

      {/* To-promotion bar */}
      <View style={styles.promoBlock}>
        <View style={styles.promoLabelRow}>
          <Text style={styles.promoLabel}>TO PROMOTION</Text>
          <Text style={styles.promoXpFraction}>
            {league.xpThisWeek} <Text style={styles.promoXpDim}>/ {league.xpToPromote} pts</Text>
          </Text>
        </View>
        <View style={styles.promoBarTrack}>
          <LinearGradient
            colors={[tc, GOLD]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.promoBarFill, { width: `${progress * 100}%` as any }]}
          />
        </View>
        <Text style={styles.promoHint}>
          {xpBehind > 0
            ? `${xpBehind} pts to top ${PROMOTE_ZONE} · top ${PROMOTE_ZONE} advance`
            : 'In promotion zone! Keep going.'}
        </Text>
      </View>

      {/* Podium */}
      <Podium competitors={league.competitors} />

      {/* Standings divider */}
      <View style={styles.standingsSep}>
        <View style={styles.standingsSepLine} />
        <Text style={styles.standingsSepLabel}>STANDINGS</Text>
        <View style={styles.standingsSepLine} />
      </View>

      {/* Leaderboard list (rank 4+) */}
      <View style={styles.leaderboard}>
        {restList.map((c, i) => {
          const rank          = i + 1 + PROMOTE_ZONE;
          const isDemote      = rank > league.total - DEMOTE_ZONE;
          const showDemoteSep = rank === league.total - DEMOTE_ZONE + 1;
          return (
            <React.Fragment key={i}>
              {showDemoteSep && <ZoneSeparator label="demotion zone" colour={RED} />}
              <LeaderRow rank={rank} competitor={c} isDemote={isDemote} />
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

// ─── Countdown Badge ──────────────────────────────────────────────────────────

function CountdownBadge({ label, urgent }: { label: string; urgent: boolean }) {
  const dotOpacity = useSharedValue(1);
  useEffect(() => {
    if (!urgent) return;
    dotOpacity.value = withRepeat(
      withSequence(withTiming(0.2, { duration: 600 }), withTiming(1, { duration: 600 })),
      -1, false,
    );
  }, [urgent]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  return (
    <View style={[styles.countdownBadge, urgent && styles.countdownBadgeUrgent]}>
      {urgent && <Animated.View style={[styles.countdownDot, dotStyle]} />}
      <Text style={[styles.countdownText, urgent && { color: '#fb923c' }]}>{label}</Text>
    </View>
  );
}

// ─── Podium ───────────────────────────────────────────────────────────────────

function Podium({ competitors }: { competitors: Competitor[] }) {
  return (
    <View style={styles.podiumRow}>
      <PodiumSlot rank={2} competitor={competitors[1]} />
      <PodiumSlot rank={1} competitor={competitors[0]} />
      <PodiumSlot rank={3} competitor={competitors[2]} />
    </View>
  );
}

function PodiumSlot({ rank, competitor }: { rank: 1 | 2 | 3; competitor: Competitor }) {
  const meta    = RANK_META[rank];
  const isFirst = rank === 1;
  return (
    <View style={styles.podiumSlot}>
      {isFirst && <Ionicons name="trophy" size={14} color={GOLD} style={{ marginBottom: 5 }} />}
      <InitialAvatar name={competitor.name} colour={meta.colour} size={meta.avatarSize} />
      <Text style={[styles.podiumName, competitor.isYou && { color: GOLD }]} numberOfLines={1}>
        {competitor.name}
      </Text>
      <Text style={styles.podiumXp}>{competitor.xp} pts</Text>
      <View style={[
        styles.podiumPlatform,
        { height: meta.platformH, backgroundColor: `${meta.colour}12`, borderColor: `${meta.colour}30` },
      ]}>
        <Text style={[styles.podiumRankNum, { color: `${meta.colour}90` }]}>{rank}</Text>
      </View>
    </View>
  );
}

function InitialAvatar({ name, colour, size }: { name: string; colour: string; size: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <View style={[
      styles.avatarCircle,
      { width: size, height: size, borderRadius: size / 2, borderColor: `${colour}55`, backgroundColor: `${colour}15` },
    ]}>
      <Text style={[styles.avatarInitials, { color: colour, fontSize: size * 0.34 }]}>{initials}</Text>
    </View>
  );
}

// ─── Leader Row ───────────────────────────────────────────────────────────────

function LeaderRow({ rank, competitor, isDemote }: { rank: number; competitor: Competitor; isDemote: boolean }) {
  const { isYou } = competitor;
  return (
    <View style={[styles.leaderRow, isYou && styles.leaderRowYou, isDemote && styles.leaderRowDemote]}>
      <Text style={[styles.leaderRank, isYou && { color: GOLD }, isDemote && { color: RED }]}>
        {String(rank).padStart(2, '0')}
      </Text>
      <Text style={[styles.leaderName, isYou && styles.leaderNameYou]}>{competitor.name}</Text>
      <View style={styles.leaderRight}>
        <Text style={[styles.leaderXp, isYou && { color: GOLD }]}>{competitor.xp}</Text>
        <Text style={styles.leaderXpUnit}> pts</Text>
      </View>
    </View>
  );
}

// ─── Zone Separator ───────────────────────────────────────────────────────────

function ZoneSeparator({ label, colour }: { label: string; colour: string }) {
  return (
    <View style={styles.zoneSep}>
      <View style={[styles.zoneLine, { backgroundColor: colour }]} />
      <Text style={[styles.zoneLabel, { color: colour }]}>{label.toUpperCase()}</Text>
      <View style={[styles.zoneLine, { backgroundColor: colour, flex: 1 }]} />
    </View>
  );
}

// (JourneyTeaser component removed)

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: BG },
  header: {
    paddingHorizontal: 16, paddingVertical: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  title: { fontSize: 28, fontWeight: '200', letterSpacing: -0.4, color: TEXT },

  // ── Top tab bar
  topTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    position: 'relative',
  },
  topTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  topTabText: {
    fontSize: 13,
    fontWeight: '400',
    color: MUTED,
    letterSpacing: 0.2,
  },
  topTabTextActive: {
    color: TEXT,
    fontWeight: '500',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: TAB_W,
    height: 2,
    backgroundColor: GOLD,
    borderRadius: 1,
  },

  // ── Paged content
  pager: { flex: 1 },
  page:  { width: SCREEN_W },
  pageContent: { paddingHorizontal: 10, paddingTop: 10, gap: 8 },

  // ── League card
  leagueCard: {
    borderRadius: 16, backgroundColor: CARD_BG,
    borderWidth: 1, borderColor: BORDER,
    padding: 14, gap: 16, overflow: 'hidden',
  },
  leagueHeroRow:   { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  leagueHeroLeft:  { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  leagueHeroRank:  { fontSize: 56, fontWeight: '100', letterSpacing: -2, lineHeight: 54 },
  leagueHeroMeta:  { paddingBottom: 4, gap: 2 },
  leagueHeroLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 2, color: MUTED, textTransform: 'uppercase' },
  leagueHeroSub:   { fontSize: 12, fontWeight: '300', color: DIM },

  // ── Countdown badge
  countdownBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
  },
  countdownBadgeUrgent: { borderColor: 'rgba(251,146,60,0.35)', backgroundColor: 'rgba(251,146,60,0.08)' },
  countdownDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: '#fb923c' },
  countdownText: { fontSize: 11, fontWeight: '400', color: DIM, letterSpacing: 0.2 },

  // ── Promo bar
  promoBlock:      { gap: 6 },
  promoLabelRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  promoLabel:      { fontSize: 8, fontWeight: '600', letterSpacing: 1.5, color: MUTED },
  promoXpFraction: { fontSize: 12, fontWeight: '300', color: GOLD },
  promoXpDim:      { fontSize: 10, fontWeight: '300', color: DIM },
  promoBarTrack:   { height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  promoBarFill:    { height: '100%', borderRadius: 2 },
  promoHint:       { fontSize: 10, fontWeight: '300', color: MUTED },

  // ── Podium
  podiumRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 4 },
  podiumSlot:     { flex: 1, alignItems: 'center', gap: 5 },
  avatarCircle:   { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontWeight: '500', letterSpacing: 0.5 },
  podiumName:     { fontSize: 11, fontWeight: '400', color: TEXT, textAlign: 'center', letterSpacing: -0.2 },
  podiumXp:       { fontSize: 10, fontWeight: '300', color: MUTED, textAlign: 'center' },
  podiumPlatform: { width: '100%', borderRadius: 8, borderWidth: 1, borderTopWidth: 2, alignItems: 'center', justifyContent: 'center' },
  podiumRankNum:  { fontSize: 20, fontWeight: '100', letterSpacing: -1 },

  // ── Standings
  standingsSep:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  standingsSepLine:  { flex: 1, height: 1, backgroundColor: BORDER },
  standingsSepLabel: { fontSize: 7, fontWeight: '600', letterSpacing: 2.5, color: MUTED },
  leaderboard:       { gap: 1 },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: 8, gap: 10,
  },
  leaderRowYou:    { backgroundColor: 'rgba(232,210,0,0.05)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.18)', paddingHorizontal: 8, marginHorizontal: -4 },
  leaderRowDemote: { borderLeftWidth: 2, borderLeftColor: `${RED}60`, paddingLeft: 8 },
  leaderRank:      { fontSize: 10, fontWeight: '500', letterSpacing: 0.5, color: MUTED, width: 22 },
  leaderName:      { flex: 1, fontSize: 13, fontWeight: '300', color: DIM },
  leaderNameYou:   { color: TEXT, fontWeight: '400' },
  leaderRight:     { flexDirection: 'row', alignItems: 'baseline' },
  leaderXp:        { fontSize: 12, fontWeight: '300', color: MUTED },
  leaderXpUnit:    { fontSize: 10, fontWeight: '300', color: MUTED },

  // ── Zone separator
  zoneSep:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  zoneLine:  { height: 1, width: 16 },
  zoneLabel: { fontSize: 7, fontWeight: '600', letterSpacing: 2 },

});
