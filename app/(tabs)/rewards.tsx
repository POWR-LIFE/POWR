import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { GeometricBackground } from '@/components/home/GeometricBackground';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileButton } from '@/components/ProfileButton';
import { usePoints } from '@/hooks/usePoints';
import { getLevelInfo } from '@/constants/levels';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#1E1E1E';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

// ─── Data ─────────────────────────────────────────────────────────────────────



const FEATURED = {
  title:    'Free Class',
  subtitle: 'Third Space · Any London location',
  value:    '£20 value',
  pts:      800,
};

type Category = 'ALL' | 'MOVE' | 'EAT' | 'MIND' | 'GEAR';
const CATEGORIES: Category[] = ['ALL', 'MOVE', 'EAT', 'MIND', 'GEAR'];

interface Reward {
  id: string;
  category: Exclude<Category, 'ALL'>;
  logoText: string;
  logoLight: boolean;
  title: string;
  subtitle: string;
  pts: number;
}

const REWARDS: Reward[] = [
  { id: '1', category: 'MOVE', logoText: 'TS',     logoLight: false, title: 'Free gym class',          subtitle: 'Third Space · Any location',  pts: 800  },
  { id: '2', category: 'EAT',  logoText: 'NOTTO',  logoLight: true,  title: '25% off your bill',       subtitle: 'Notto Pasta · Any branch',    pts: 500  },
  { id: '3', category: 'GEAR', logoText: 'bulk',   logoLight: false, title: '30% off protein powder',  subtitle: 'bulk® · Any product',         pts: 400  },
  { id: '4', category: 'MIND', logoText: 'calm',   logoLight: false, title: '3 months free',           subtitle: 'Calm · Premium subscription', pts: 600  },
  { id: '5', category: 'GEAR', logoText: 'eight',  logoLight: false, title: '£50 off mattress',        subtitle: 'Eight Sleep · Any model',     pts: 1200 },
  { id: '6', category: 'EAT',  logoText: 'WH',     logoLight: true,  title: '20% off supplements',     subtitle: 'Whole Health · Any order',    pts: 350  },
  { id: '7', category: 'MOVE', logoText: 'barry',  logoLight: true,  title: 'Single class pass',       subtitle: "Barry's · Any studio",        pts: 650  },
  { id: '8', category: 'MIND', logoText: 'head',   logoLight: false, title: '1 month free',            subtitle: 'Headspace · Plus plan',       pts: 300  },
];

// ─── Affordability helpers ─────────────────────────────────────────────────────

type Afford = 'can' | 'close' | 'locked';

function affordability(balance: number, pts: number): Afford {
  if (balance >= pts) return 'can';
  if (balance >= pts * 0.6) return 'close';
  return 'locked';
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SpendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<Category>('ALL');
  const { balance, todayEarned, totalEarned, loading } = usePoints();
  const levelInfo = getLevelInfo(totalEarned);

  const filtered = activeCategory === 'ALL'
    ? REWARDS
    : REWARDS.filter((r) => r.category === activeCategory);

  // Sort: affordable first, then close, then locked
  const sorted = [...filtered].sort((a, b) => {
    const order = { can: 0, close: 1, locked: 2 };
    return order[affordability(balance, a.pts)] - order[affordability(balance, b.pts)];
  });

  const featuredAfford = affordability(balance, FEATURED.pts);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />
      <View style={styles.header}>
        <Text style={styles.title}>Rewards</Text>
        <ProfileButton />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Balance card ─────────────────────────────────────── */}
        <BalanceCard
          balance={balance}
          todayEarned={todayEarned}
          levelNumber={levelInfo.current.level}
          levelName={levelInfo.current.name}
          loading={loading}
        />

        {/* ── Featured weekly reward ────────────────────────────── */}
        <FeaturedCard
          featured={FEATURED}
          afford={featuredAfford}
          balance={balance}
          onRedeem={() => router.push({ pathname: '/redeem-modal', params: { id: 'featured' } })}
        />

        {/* ── Category tabs ────────────────────────────────────── */}
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

        {/* ── Reward rows ──────────────────────────────────────── */}
        {sorted.map((reward) => (
          <RewardRow
            key={reward.id}
            reward={reward}
            afford={affordability(balance, reward.pts)}
            balance={balance}
            onRedeem={() => router.push({ pathname: '/redeem-modal', params: { id: reward.id } })}
          />
        ))}

        {/* ── Find nearby ──────────────────────────────────────── */}
        <Pressable style={({ pressed }) => [styles.nearbyRow, pressed && { opacity: 0.75 }]}>
          <Text style={styles.nearbyText}>Find nearby fitness partners</Text>
          <Text style={styles.nearbyArrow}>→</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ─── Balance Card ─────────────────────────────────────────────────────────────

interface BalanceCardProps {
  balance: number;
  todayEarned: number;
  levelNumber: number;
  levelName: string;
  loading: boolean;
}

function BalanceCard({ balance, todayEarned, levelNumber, levelName, loading }: BalanceCardProps) {
  return (
    <View style={styles.balanceCard}>
      <View>
        <Text style={styles.metaLabel}>Available</Text>
        <Text style={[styles.balanceNumber, loading && { opacity: 0.4 }]}>
          {balance.toLocaleString()}
        </Text>
        <Text style={styles.balanceUnit}>POWR points</Text>
      </View>

      <View style={styles.balanceRight}>
        {todayEarned > 0 && (
          <View style={styles.todayBadge}>
            <Text style={styles.todayBadgeText}>+{todayEarned} today</Text>
          </View>
        )}
        <View style={styles.levelBlock}>
          <Text style={styles.metaLabel}>Level</Text>
          <Text style={styles.levelValue}>{levelNumber} · {levelName}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Featured Card ────────────────────────────────────────────────────────────

interface FeaturedProps {
  featured: typeof FEATURED;
  afford: Afford;
  balance: number;
  onRedeem: () => void;
}

function FeaturedCard({ featured, afford, balance, onRedeem }: FeaturedProps) {
  const ptsNeeded = featured.pts - balance;
  const progress = Math.min(balance / featured.pts, 1);

  return (
    <View style={styles.featuredCard}>
      <View style={styles.featuredAccentBar} />
      <View style={styles.featuredInner}>
        <View style={styles.featuredHeaderRow}>
          <Text style={styles.metaLabel}>This week's reward</Text>
          <View style={styles.rotatesBadge}>
            <View style={styles.rotateDot} />
            <Text style={styles.rotateBadgeText}>Rotates weekly</Text>
          </View>
        </View>

        <Text style={styles.featuredTitle}>{featured.title}</Text>
        <Text style={styles.featuredSubtitle}>{featured.subtitle}</Text>

        {/* Progress bar — always visible */}
        {afford !== 'can' && (
          <View style={styles.featuredProgressWrap}>
            <View style={[styles.featuredProgressBar, { width: `${progress * 100}%` as any }]} />
          </View>
        )}

        <View style={styles.featuredFooter}>
          <View>
            <Text style={styles.featuredValueLarge}>{featured.value}</Text>
            <Text style={styles.featuredPts}>· {featured.pts} pts</Text>
          </View>

          {afford === 'can' ? (
            <Pressable style={({ pressed }) => [styles.redeemPrimary, pressed && { opacity: 0.85 }]} onPress={onRedeem}>
              <Text style={styles.redeemPrimaryText}>Redeem</Text>
            </Pressable>
          ) : afford === 'close' ? (
            <View style={styles.closeBlock}>
              <Text style={styles.closeText}>{ptsNeeded} pts away</Text>
              <Text style={styles.closeHint}>Keep moving</Text>
            </View>
          ) : (
            <View style={styles.lockedBlock}>
              <Text style={styles.lockedText}>{ptsNeeded.toLocaleString()} pts needed</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Reward Row ───────────────────────────────────────────────────────────────

interface RewardRowProps {
  reward: Reward;
  afford: Afford;
  balance: number;
  onRedeem: () => void;
}

function RewardRow({ reward, afford, balance, onRedeem }: RewardRowProps) {
  const ptsNeeded = reward.pts - balance;
  const progress = Math.min(balance / reward.pts, 1);
  const isLocked = afford === 'locked';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.rewardRow,
        isLocked && styles.rewardRowLocked,
        pressed && !isLocked && { opacity: 0.8 },
      ]}
    >
      {/* Logo */}
      <View style={[styles.logoBox, reward.logoLight && styles.logoBoxLight, isLocked && styles.logoBoxLocked]}>
        <Text
          style={[styles.logoText, reward.logoLight && styles.logoTextDark, isLocked && styles.logoTextLocked]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {reward.logoText}
        </Text>
      </View>

      {/* Info */}
      <View style={styles.rewardInfo}>
        <Text style={[styles.rewardTitle, isLocked && styles.rewardTitleLocked]}>{reward.title}</Text>
        <Text style={styles.rewardSubtitle}>{reward.subtitle}</Text>

        {/* Progress bar for "close" state */}
        {afford === 'close' && (
          <View style={styles.progressWrap}>
            <View style={[styles.progressBar, { width: `${progress * 100}%` as any }]} />
          </View>
        )}
      </View>

      {/* Right */}
      <View style={styles.rewardRight}>
        <Text style={[styles.rewardPts, isLocked && styles.rewardPtsLocked]}>
          {reward.pts} pts
        </Text>

        {afford === 'can' ? (
          <Pressable style={({ pressed }) => [styles.redeemGhost, pressed && { opacity: 0.75 }]} onPress={onRedeem}>
            <Text style={styles.redeemGhostText}>Redeem</Text>
          </Pressable>
        ) : afford === 'close' ? (
          <Text style={styles.closeHintSm}>{ptsNeeded} away</Text>
        ) : (
          <Text style={styles.lockedHint}>Locked</Text>
        )}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '200',
    letterSpacing: -0.4,
    color: TEXT,
  },
  scroll: { flex: 1 },
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
  balanceRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  todayBadge: {
    backgroundColor: 'rgba(232,210,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.25)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  todayBadgeText: {
    fontSize: 10,
    fontWeight: '400',
    color: GOLD,
    letterSpacing: 0.3,
  },
  levelBlock: {
    alignItems: 'flex-end',
  },
  levelValue: {
    fontSize: 14,
    fontWeight: '300',
    color: TEXT,
  },

  // ── Featured card
  featuredCard: {
    backgroundColor: 'rgba(28,26,6,0.98)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.15)',
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
    marginBottom: 16,
  },
  rotatesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
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
    letterSpacing: 1.2,
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
    marginBottom: 20,
  },
  featuredProgressWrap: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 1,
    overflow: 'hidden',
    marginBottom: 16,
  },
  featuredProgressBar: {
    height: '100%',
    backgroundColor: GOLD,
    borderRadius: 1,
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
  closeBlock: {
    alignItems: 'flex-end',
  },
  closeText: {
    fontSize: 13,
    fontWeight: '300',
    color: GOLD,
  },
  closeHint: {
    fontSize: 10,
    fontWeight: '300',
    color: MUTED,
    marginTop: 2,
  },
  lockedBlock: {
    alignItems: 'flex-end',
  },
  lockedText: {
    fontSize: 12,
    fontWeight: '300',
    color: MUTED,
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
    fontSize: 9,
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
  rewardRowLocked: {
    opacity: 0.45,
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
  logoBoxLocked: {
    backgroundColor: 'rgba(255,255,255,0.03)',
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
  logoTextLocked: {
    color: MUTED,
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
  rewardTitleLocked: {
    color: DIM,
  },
  rewardSubtitle: {
    fontSize: 11,
    fontWeight: '300',
    color: DIM,
  },
  progressWrap: {
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 1,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressBar: {
    height: '100%',
    backgroundColor: GOLD,
    borderRadius: 1,
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
  rewardPtsLocked: {
    color: MUTED,
  },
  redeemGhost: {
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.35)',
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
  closeHintSm: {
    fontSize: 10,
    fontWeight: '300',
    color: GOLD,
    opacity: 0.8,
  },
  lockedHint: {
    fontSize: 10,
    fontWeight: '300',
    color: MUTED,
    letterSpacing: 0.5,
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
