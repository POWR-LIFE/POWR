import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Design tokens (inline, matching homepage component conventions) ──────────

const GOLD    = '#facc15';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_POINTS = 1247;
const MOCK_LEVEL  = { number: 2, name: 'Mover' };

const FEATURED = {
  title:    'Free Class',
  subtitle: 'Third Space · Any London location',
  value:    '£20 value',
  pts:      800,
};

type Category = 'MOVE' | 'EAT' | 'MIND' | 'SLEEP';
const CATEGORIES: Category[] = ['MOVE', 'EAT', 'MIND', 'SLEEP'];

interface Reward {
  id: string;
  category: Category;
  logoText: string;
  logoLight: boolean;
  title: string;
  subtitle: string;
  pts: number;
}

const REWARDS: Reward[] = [
  { id: '1', category: 'MOVE', logoText: 'Hagen',  logoLight: true,  title: 'Free Coffee',            subtitle: 'Any drink · Hagen',          pts: 300 },
  { id: '2', category: 'EAT',  logoText: 'NOTTO',  logoLight: true,  title: '25% off your bill',      subtitle: 'Notto Pasta Bars',            pts: 500 },
  { id: '3', category: 'MOVE', logoText: 'bulk',   logoLight: false, title: '30% off Protein Powder', subtitle: 'bulk® · Any product',         pts: 400 },
  { id: '4', category: 'MIND', logoText: 'calm',   logoLight: false, title: '3 months free',          subtitle: 'Calm · Premium subscription', pts: 600 },
  { id: '5', category: 'SLEEP',logoText: 'eight',  logoLight: false, title: '£50 off mattress',       subtitle: 'Eight Sleep · Any model',     pts: 1200 },
  { id: '6', category: 'EAT',  logoText: 'WH',     logoLight: true,  title: '20% off supplements',    subtitle: 'Whole Health · Any order',    pts: 350 },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SpendScreen() {
  const insets = useSafeAreaInsets();
  const [activeCategory, setActiveCategory] = useState<Category>('MOVE');

  const filtered = REWARDS.filter((r) => r.category === activeCategory);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Rewards</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Balance card ───────────────────────────────────── */}
        <View style={styles.balanceCard}>
          <View>
            <Text style={styles.metaLabel}>AVAILABLE</Text>
            <Text style={styles.balanceNumber}>{MOCK_POINTS.toLocaleString()}</Text>
            <Text style={styles.balanceUnit}>POWR points</Text>
          </View>
          <View style={styles.levelBlock}>
            <Text style={styles.metaLabel}>LEVEL</Text>
            <Text style={styles.levelValue}>
              {MOCK_LEVEL.number} · {MOCK_LEVEL.name}
            </Text>
          </View>
        </View>

        {/* ── Featured weekly reward ──────────────────────────── */}
        <View style={styles.featuredCard}>
          <View style={styles.featuredAccentBar} />
          <View style={styles.featuredInner}>
            {/* Header */}
            <View style={styles.featuredHeaderRow}>
              <Text style={styles.metaLabel}>THIS WEEK'S REWARD</Text>
              <View style={styles.rotatesBadge}>
                <View style={styles.rotateDot} />
                <Text style={styles.rotateBadgeText}>ROTATES WEEKLY</Text>
              </View>
            </View>

            {/* Title block */}
            <Text style={styles.featuredTitle}>{FEATURED.title}</Text>
            <Text style={styles.featuredSubtitle}>{FEATURED.subtitle}</Text>

            {/* Footer */}
            <View style={styles.featuredFooter}>
              <View>
                <Text style={styles.featuredValueLarge}>{FEATURED.value}</Text>
                <Text style={styles.featuredPts}>· {FEATURED.pts} pts</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.redeemPrimary, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.redeemPrimaryText}>REDEEM</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* ── Category tabs ───────────────────────────────────── */}
        <View style={styles.tabsRow}>
          {CATEGORIES.map((cat) => {
            const active = cat === activeCategory;
            return (
              <Pressable
                key={cat}
                style={[styles.tabChip, active && styles.tabChipActive]}
                onPress={() => setActiveCategory(cat)}
              >
                <Text style={[styles.tabChipText, active && styles.tabChipTextActive]}>
                  {cat}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── Reward rows ─────────────────────────────────────── */}
        {filtered.map((reward) => (
          <RewardRow key={reward.id} reward={reward} />
        ))}

        {/* ── Find nearby ─────────────────────────────────────── */}
        <Pressable style={({ pressed }) => [styles.nearbyRow, pressed && { opacity: 0.75 }]}>
          <Text style={styles.nearbyText}>Find nearby fitness partners</Text>
          <Text style={styles.nearbyArrow}>→</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ─── Reward row ───────────────────────────────────────────────────────────────

function RewardRow({ reward }: { reward: Reward }) {
  return (
    <Pressable style={({ pressed }) => [styles.rewardRow, pressed && { opacity: 0.8 }]}>
      {/* Logo */}
      <View style={[styles.logoBox, reward.logoLight && styles.logoBoxLight]}>
        <Text
          style={[styles.logoText, reward.logoLight && styles.logoTextDark]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {reward.logoText}
        </Text>
      </View>

      {/* Info */}
      <View style={styles.rewardInfo}>
        <Text style={styles.rewardTitle}>{reward.title}</Text>
        <Text style={styles.rewardSubtitle}>{reward.subtitle}</Text>
      </View>

      {/* Right */}
      <View style={styles.rewardRight}>
        <Text style={styles.rewardPts}>{reward.pts} pts</Text>
        <Pressable style={({ pressed }) => [styles.redeemGhost, pressed && { opacity: 0.75 }]}>
          <Text style={styles.redeemGhostText}>REDEEM</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  title: {
    fontSize: 32,
    fontWeight: '200',
    letterSpacing: -0.5,
    color: TEXT,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 12,
    gap: 8,
    paddingTop: 4,
  },

  // ── Balance card
  balanceCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 2,
    color: MUTED,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  balanceNumber: {
    fontSize: 52,
    fontWeight: '100',
    letterSpacing: -2,
    lineHeight: 54,
    color: GOLD,
  },
  balanceUnit: {
    fontSize: 11,
    fontWeight: '300',
    color: DIM,
    marginTop: 2,
  },
  levelBlock: {
    alignItems: 'flex-end',
  },
  levelValue: {
    fontSize: 15,
    fontWeight: '300',
    color: TEXT,
  },

  // ── Featured card
  featuredCard: {
    backgroundColor: 'rgba(30,28,8,0.95)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    overflow: 'hidden',
  },
  featuredAccentBar: {
    height: 2,
    backgroundColor: GOLD,
  },
  featuredInner: {
    padding: 14,
  },
  featuredHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  rotatesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  rotateDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: GOLD,
  },
  rotateBadgeText: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: MUTED,
    textTransform: 'uppercase',
  },
  featuredTitle: {
    fontSize: 34,
    fontWeight: '200',
    letterSpacing: -0.5,
    color: TEXT,
    marginBottom: 4,
  },
  featuredSubtitle: {
    fontSize: 13,
    fontWeight: '300',
    color: DIM,
    marginBottom: 28,
  },
  featuredFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  featuredValueLarge: {
    fontSize: 20,
    fontWeight: '300',
    color: TEXT,
  },
  featuredPts: {
    fontSize: 12,
    fontWeight: '300',
    color: DIM,
    marginTop: 2,
  },
  redeemPrimary: {
    backgroundColor: GOLD,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 20,
  },
  redeemPrimaryText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#0a0a0a',
    textTransform: 'uppercase',
  },

  // ── Category tabs
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 4,
    gap: 4,
  },
  tabChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 12,
    alignItems: 'center',
  },
  tabChipActive: {
    backgroundColor: TEXT,
  },
  tabChipText: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: MUTED,
    textTransform: 'uppercase',
  },
  tabChipTextActive: {
    color: BG,
  },

  // ── Reward rows
  rewardRow: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoBox: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  logoBoxLight: {
    backgroundColor: '#F2F2F2',
    borderColor: 'rgba(255,255,255,0.06)',
  },
  logoText: {
    fontSize: 11,
    fontWeight: '600',
    color: DIM,
    textAlign: 'center',
  },
  logoTextDark: {
    color: '#1a1a1a',
  },
  rewardInfo: {
    flex: 1,
    gap: 3,
  },
  rewardTitle: {
    fontSize: 14,
    fontWeight: '300',
    color: TEXT,
  },
  rewardSubtitle: {
    fontSize: 11,
    fontWeight: '300',
    color: DIM,
  },
  rewardRight: {
    alignItems: 'flex-end',
    gap: 6,
    flexShrink: 0,
  },
  rewardPts: {
    fontSize: 12,
    fontWeight: '400',
    color: GOLD,
  },
  redeemGhost: {
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.35)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  redeemGhostText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: GOLD,
    textTransform: 'uppercase',
  },

  // ── Nearby row
  nearbyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 14,
  },
  nearbyText: {
    fontSize: 13,
    fontWeight: '300',
    color: DIM,
  },
  nearbyArrow: {
    fontSize: 15,
    fontWeight: '300',
    color: MUTED,
  },
});
