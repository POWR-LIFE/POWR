import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import {
  ACHIEVEMENTS,
  CATEGORY_META,
  RARITY_META,
  type AchievementCategory,
  type AchievementWithState,
} from '@/constants/achievements';
import { useAchievements } from '@/hooks/useAchievements';
import { usePoints } from '@/hooks/usePoints';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD   = '#E8D200';
const BG     = '#0d0d0d';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';
const CARD   = 'rgba(28,28,28,0.9)';

const SCREEN_W = Dimensions.get('window').width;
const COL_GAP  = 10;
const COLS     = 3;
const TILE_W   = Math.floor((SCREEN_W - 32 - COL_GAP * (COLS - 1)) / COLS);

// ─── Category filter config ───────────────────────────────────────────────────

const ALL_CATEGORIES: (AchievementCategory | 'all')[] = [
  'all',
  'habit',
  'sessions',
  'points',
  'level',
  'running',
  'gym',
  'cycling',
  'swimming',
  'hiit',
  'yoga',
  'sports',
  'walking',
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AchievementsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { totalEarned } = usePoints();
  const { all, earnedCount, totalCount, loading } = useAchievements(totalEarned);

  const [activeCategory, setActiveCategory] = useState<AchievementCategory | 'all'>('all');
  const [showEarnedOnly, setShowEarnedOnly] = useState(false);

  const filtered = all.filter(a => {
    if (activeCategory !== 'all' && a.category !== activeCategory) return false;
    if (showEarnedOnly && !a.earned) return false;
    return true;
  });

  const earnedInCategory = activeCategory === 'all'
    ? earnedCount
    : all.filter(a => a.category === activeCategory && a.earned).length;

  const totalInCategory = activeCategory === 'all'
    ? totalCount
    : ACHIEVEMENTS.filter(a => a.category === activeCategory).length;

  const pct = totalCount > 0 ? Math.round((earnedCount / totalCount) * 100) : 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={20} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>ACHIEVEMENTS</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Progress summary */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryLeft}>
          <Text style={styles.summaryEarned}>{earnedCount}</Text>
          <Text style={styles.summaryOf}>/ {totalCount}</Text>
          <Text style={styles.summaryLabel}>  earned</Text>
        </View>
        <View style={styles.summaryRight}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
          </View>
          <Text style={styles.progressPct}>{pct}%</Text>
        </View>
      </View>

      {/* Category filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterContent}
      >
        {ALL_CATEGORIES.map(cat => {
          const isActive = cat === activeCategory;
          const meta = cat === 'all' ? null : CATEGORY_META[cat];
          const colour = meta?.colour ?? GOLD;
          return (
            <Pressable
              key={cat}
              style={[
                styles.filterPill,
                isActive && { backgroundColor: colour + '22', borderColor: colour + '66' },
              ]}
              onPress={() => setActiveCategory(cat)}
            >
              {meta && (
                <Ionicons
                  name={meta.icon as any}
                  size={11}
                  color={isActive ? colour : MUTED}
                />
              )}
              <Text style={[styles.filterPillText, isActive && { color: colour }]}>
                {cat === 'all' ? 'All' : meta!.label}
              </Text>
            </Pressable>
          );
        })}

        {/* Earned-only toggle */}
        <Pressable
          style={[
            styles.filterPill,
            showEarnedOnly && { backgroundColor: GOLD + '22', borderColor: GOLD + '66' },
          ]}
          onPress={() => setShowEarnedOnly(v => !v)}
        >
          <Ionicons name="checkmark-circle-outline" size={11} color={showEarnedOnly ? GOLD : MUTED} />
          <Text style={[styles.filterPillText, showEarnedOnly && { color: GOLD }]}>Earned</Text>
        </Pressable>
      </ScrollView>

      {/* Category progress line */}
      <View style={styles.catProgress}>
        <Text style={styles.catProgressText}>
          {earnedInCategory} / {totalInCategory}
          {activeCategory !== 'all' ? `  ·  ${CATEGORY_META[activeCategory].label}` : '  ·  All categories'}
        </Text>
      </View>

      {/* Grid */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Loading…</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="trophy-outline" size={40} color={MUTED} />
            <Text style={styles.emptyText}>No achievements here yet</Text>
          </View>
        ) : (
          <View style={styles.tileGrid}>
            {filtered.map(a => (
              <AchievementTile key={a.id} achievement={a} width={TILE_W} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Achievement Tile ─────────────────────────────────────────────────────────

function AchievementTile({
  achievement: a,
  width,
}: {
  achievement: AchievementWithState;
  width: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const rarity = RARITY_META[a.rarity];

  const borderColor = a.earned ? a.colour : 'rgba(255,255,255,0.08)';
  const iconColor   = a.earned ? a.colour : 'rgba(255,255,255,0.2)';

  return (
    <Pressable
      style={[styles.tile, { width }]}
      onPress={() => setExpanded(v => !v)}
    >
      {/* Rarity glow ring */}
      {a.earned && a.rarity !== 'common' && (
        <View style={[styles.rarityGlow, { backgroundColor: rarity.glow }]} />
      )}

      {/* Medallion */}
      <View style={[
        styles.medallion,
        { borderColor },
        a.earned && a.rarity !== 'common' && { borderColor: rarity.border },
        !a.earned && { opacity: 0.45 },
      ]}>
        <View style={styles.medallionInner}>
          <Ionicons
            name={(a.earned ? a.icon : 'lock-closed') as any}
            size={24}
            color={iconColor}
          />
        </View>

        {/* Earned check badge */}
        {a.earned && (
          <View style={styles.checkBadge}>
            <Text style={styles.checkMark}>✓</Text>
          </View>
        )}
      </View>

      {/* Code label */}
      <Text style={[styles.tileCode, { color: a.earned ? a.colour : MUTED }]}>
        {a.code}
      </Text>

      {/* Name */}
      <Text style={[styles.tileName, !a.earned && { opacity: 0.5 }]} numberOfLines={2}>
        {a.name}
      </Text>

      {/* Rarity badge */}
      {a.rarity !== 'common' && (
        <View style={[
          styles.rarityBadge,
          a.earned && { borderColor: rarity.border + '99' },
        ]}>
          <Text style={[
            styles.rarityBadgeText,
            { color: a.earned ? rarity.border.replace('0.5)', '0.9)').replace('0.6)', '0.9)').replace('0.7)', '1)') : MUTED },
          ]}>
            {a.rarity.toUpperCase()}
          </Text>
        </View>
      )}

      {/* Expanded description */}
      {expanded && (
        <Text style={styles.tileDesc}>{a.description}</Text>
      )}
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2.5,
    color: TEXT,
  },

  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  summaryLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  summaryEarned: { fontSize: 28, fontWeight: '200', color: GOLD, letterSpacing: -1 },
  summaryOf:    { fontSize: 16, fontWeight: '200', color: DIM, letterSpacing: -0.5 },
  summaryLabel: { fontSize: 11, fontWeight: '300', color: MUTED },
  summaryRight: { alignItems: 'flex-end', gap: 4 },
  progressTrack: {
    width: 120,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: GOLD,
  },
  progressPct: { fontSize: 10, fontWeight: '400', color: MUTED },

  filterScroll: { flexGrow: 0 },
  filterContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 6,
    flexDirection: 'row',
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  filterPillText: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.3,
    color: MUTED,
  },

  catProgress: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  catProgressText: {
    fontSize: 10,
    fontWeight: '300',
    color: MUTED,
    letterSpacing: 0.5,
  },

  scroll: { flex: 1 },
  grid: { paddingHorizontal: 16 },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: COL_GAP,
  },

  emptyState: {
    paddingTop: 80,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '300',
    color: MUTED,
  },

  // ── Tile ──────────────────────────────────────────────────────────────────

  tile: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    gap: 6,
    borderRadius: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: COL_GAP,
    position: 'relative',
    overflow: 'hidden',
  },

  rarityGlow: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 60,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },

  medallion: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  medallionInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: GOLD,
    borderWidth: 2,
    borderColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { fontSize: 9, fontWeight: '700', color: '#0a0a0a', lineHeight: 11 },

  tileCode: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tileName: {
    fontSize: 11,
    fontWeight: '300',
    color: TEXT,
    textAlign: 'center',
    lineHeight: 15,
  },

  rarityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  rarityBadgeText: {
    fontSize: 7,
    fontWeight: '600',
    letterSpacing: 1,
  },

  tileDesc: {
    fontSize: 9,
    fontWeight: '300',
    color: MUTED,
    textAlign: 'center',
    lineHeight: 13,
    marginTop: 2,
  },
});
