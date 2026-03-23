import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityGrid, type ActivityGridItem } from '@/components/home/ActivityGrid';
import { ChallengeCard } from '@/components/home/ChallengeCard';
import { LevelCard } from '@/components/home/LevelCard';
import { StreakCard } from '@/components/home/StreakCard';

const GOLD = '#facc15';
const TEXT_PRIMARY = '#F2F2F2';
const TEXT_MUTED = 'rgba(255,255,255,0.25)';

// ─── Mock data ───────────────────────────────────────────────────────────────

const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

const MOCK_ACTIVE_DAYS: boolean[] = [true, true, true, false, true, true, false];

const MOCK_LEVEL_METRICS: [any, any, any] = [
  {
    label: 'Gym visits',
    icon: 'barbell',
    value: '4',
    max: '5',
    pct: 0.8,
    colour: GOLD,
    gradId: 'h-gG',
    gradStart: '#facc15',
    gradEnd: '#eab308',
  },
  {
    label: 'Runs',
    icon: 'body',
    value: '3',
    max: '5',
    pct: 0.6,
    colour: '#f97316',
    gradId: 'h-gR',
    gradStart: '#f97316',
    gradEnd: '#ea580c',
  },
  {
    label: 'Steps',
    icon: 'footsteps',
    value: '6.2k',
    max: '10k',
    pct: 0.62,
    colour: '#4ade80',
    gradId: 'h-gS',
    gradStart: '#4ade80',
    gradEnd: '#22c55e',
  },
];

const MOCK_ACTIVITY: ActivityGridItem[] = [
  { type: 'gym', pointsEarned: 40, detail: '1h' },
  { type: 'running', pointsEarned: 35, detail: '4.2 mi' },
  { type: 'walking', pointsEarned: 18, detail: '2.1 mi' },
  { type: 'swimming', pointsEarned: 50, detail: '30 min' },
];

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Status-bar area + header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>Alex</Text>
        <Pressable
          style={styles.avatar}
          onPress={() => router.push('/profile-screen')}
        >
          <Text style={styles.avatarText}>A</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Streak card ──────────────────────────────────────── */}
        <StreakCard
          streak={12}
          multiplier={2.5}
          activeDays={MOCK_ACTIVE_DAYS}
          todayIndex={TODAY_INDEX}
        />

        {/* ── Manual log nudge ─────────────────────────────────── */}
        <View style={styles.nudgeRow}>
          <Text style={styles.nudgeText}>Workout not logged? </Text>
          <Pressable onPress={() => { /* TODO */ }}>
            <Text style={styles.nudgeLink}>Add manually</Text>
          </Pressable>
        </View>

        {/* ── Level / progress card ─────────────────────────────── */}
        <LevelCard
          levelNumber={2}
          levelName="Mover"
          xp={710}
          xpMax={1000}
          metrics={MOCK_LEVEL_METRICS}
          nextLevelHint="1 more gym visit → Level 3"
        />

        {/* ── Challenge ────────────────────────────────────────── */}
        <SectionLabel label="This Week's Challenge" />
        <ChallengeCard
          title="Early Bird"
          description={`Gym or run before 12pm — triple points + 150 XP`}
          bonus="3× BONUS"
          expiresIn="4h 22m"
          onClaim={() => { /* TODO */ }}
        />

        {/* ── Reward row ───────────────────────────────────────── */}
        <SectionLabel label="Reward This Week" />
        <RewardRow
          partnerName="bulk"
          rewardTitle="Bulk Whey Protein — 20% off"
          powrCost={44}
          progress={0.75}
          onPress={() => { /* TODO */ }}
        />

        {/* ── Recent activity ──────────────────────────────────── */}
        <View style={styles.activityHeader}>
          <Text style={styles.activityTitle}>RECENT ACTIVITY</Text>
          <Text style={styles.activitySub}>Points earned</Text>
        </View>
        <ActivityGrid items={MOCK_ACTIVITY} />
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>;
}

interface RewardRowProps {
  partnerName: string;
  rewardTitle: string;
  powrCost: number;
  progress: number;
  onPress?: () => void;
}

function RewardRow({ partnerName, rewardTitle, powrCost, progress, onPress }: RewardRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.rewardRow, pressed && { opacity: 0.8 }]}
    >
      <View style={styles.rewardLogo}>
        <Text style={styles.rewardLogoText}>{partnerName.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.rewardInfo}>
        <Text style={styles.rewardName}>{rewardTitle}</Text>
        <View style={styles.rewardBarWrap}>
          <View style={[styles.rewardBar, { width: `${progress * 100}%` as any }]} />
        </View>
      </View>
      <Text style={styles.rewardPts}>{powrCost} pts</Text>
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  greeting: {
    fontSize: 28,
    fontWeight: '200',
    letterSpacing: -0.4,
    color: TEXT_PRIMARY,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0a0a0a',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 10,
    gap: 8,
    paddingTop: 2,
  },
  nudgeRow: {
    flexDirection: 'row',
    paddingHorizontal: 4,
  },
  nudgeText: {
    fontSize: 11,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.4)',
  },
  nudgeLink: {
    fontSize: 11,
    fontWeight: '400',
    color: GOLD,
    textDecorationLine: 'underline',
  },
  sectionLabel: {
    paddingHorizontal: 4,
    paddingTop: 4,
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: TEXT_MUTED,
    textTransform: 'uppercase',
  },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  activityTitle: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.2,
    color: TEXT_MUTED,
    textTransform: 'uppercase',
  },
  activitySub: {
    fontSize: 9,
    fontWeight: '300',
    color: 'rgba(242,242,242,0.55)',
  },
  // Reward row
  rewardRow: {
    borderRadius: 14,
    backgroundColor: 'rgba(40,40,40,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  rewardLogo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#1e1e1e',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rewardLogoText: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
  },
  rewardInfo: {
    flex: 1,
    gap: 7,
  },
  rewardName: {
    fontSize: 12,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.85)',
  },
  rewardBarWrap: {
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  rewardBar: {
    height: '100%',
    backgroundColor: GOLD,
  },
  rewardPts: {
    fontSize: 12,
    fontWeight: '200',
    color: GOLD,
    flexShrink: 0,
  },
});
