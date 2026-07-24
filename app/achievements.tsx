import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Dimensions,
  Image as NativeImage,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { LevelIcon } from '@/components/LevelIcon';
import {
  ACHIEVEMENTS,
  CATEGORY_META,
  RARITY_META,
  type AchievementCategory,
  type AchievementWithState,
} from '@/constants/achievements';
import { LEVELS, LEVEL_IMAGE, TIER_META, getLevelInfo, type LevelDef, type LevelTier } from '@/constants/levels';
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

// Solid per-tier accent for earned-level styling (metal progression:
// silver → bronze/orange → gold). Distinct from TIER_META.color, which keeps
// the muted-white recruit header — earned cards deserve a richer hue.
const TIER_ACCENT: Record<LevelTier, string> = {
  recruit: '#C9CED6', // silver
  athlete: '#FB923C', // bronze / orange
  elite:   '#E8D200', // gold
  legend:  '#F2D640', // bright gold
};

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const SCREEN_W = Dimensions.get('window').width;
const COL_GAP  = 10;
const COLS     = 3;
const TILE_W   = Math.floor((SCREEN_W - 32 - COL_GAP * (COLS - 1)) / COLS);

// Level grid: 2 per row
const CARD_W   = Math.floor((SCREEN_W - 32 - COL_GAP) / 2);

// ─── Category filter config ───────────────────────────────────────────────────

const AVAILABLE_CATEGORIES = Array.from(
  new Set(ACHIEVEMENTS.map(a => a.category)),
) as AchievementCategory[];

const ALL_CATEGORIES: (AchievementCategory | 'all')[] = ['all', ...AVAILABLE_CATEGORIES];

const LEVEL_BY_NUMBER = new Map(LEVELS.map(level => [level.level, level]));

const TIER_ORDER: LevelTier[] = ['recruit', 'athlete', 'elite', 'legend'];

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function progressToTarget(totalEarned: number, targetLevel: number): number {
  const target = LEVEL_BY_NUMBER.get(targetLevel);
  if (!target) return 0;
  if (totalEarned >= target.xpMin) return 1;

  const prev = LEVEL_BY_NUMBER.get(targetLevel - 1);
  const fromXp = prev?.xpMin ?? 0;
  const span = Math.max(1, target.xpMin - fromXp);
  return clamp01((totalEarned - fromXp) / span);
}

type MainView = 'levels' | 'badges';

// The Badges tab currently only holds level-milestone achievements, which
// duplicate the Levels view. Hidden until the badge library gains real variety
// (streaks, per-activity, distance, steps…) alongside the leaderboard work.
// Flip to true to bring the tab back — all badge code is left intact.
const SHOW_BADGES = false;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AchievementsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { totalEarned } = usePoints();
  const { all, earnedCount, totalCount, loading } = useAchievements(totalEarned);

  const [mainView, setMainView] = useState<MainView>('levels');
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

  const { current: currentLevel } = getLevelInfo(totalEarned);

  // Levels-view summary: how many of the 20 levels the user has reached.
  const levelsUnlocked = LEVELS.filter(l => totalEarned >= l.xpMin).length;
  const levelsTotal = LEVELS.length;
  const levelPct = Math.round((levelsUnlocked / levelsTotal) * 100);

  // Badges-view summary (only used when SHOW_BADGES is on).
  const pct = totalCount > 0 ? Math.round((earnedCount / totalCount) * 100) : 0;

  // Active summary numbers depend on which view is shown.
  const summaryEarned = SHOW_BADGES && mainView === 'badges' ? earnedCount : levelsUnlocked;
  const summaryTotal  = SHOW_BADGES && mainView === 'badges' ? totalCount : levelsTotal;
  const summaryPct    = SHOW_BADGES && mainView === 'badges' ? pct : levelPct;
  const summaryLabel  = SHOW_BADGES && mainView === 'badges' ? 'earned' : 'levels';

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
          <Text style={styles.summaryEarned}>{summaryEarned}</Text>
          <Text style={styles.summaryOf}>/ {summaryTotal}</Text>
          <Text style={styles.summaryLabel}>  {summaryLabel}</Text>
        </View>
        <View style={styles.summaryRight}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${summaryPct}%` as any }]} />
          </View>
          <Text style={styles.progressPct}>{summaryPct}%</Text>
        </View>
      </View>

      {/* Main view toggle — hidden while Badges is parked (single Levels view) */}
      {SHOW_BADGES && (
        <View style={styles.viewToggle}>
          {(['levels', 'badges'] as MainView[]).map(v => (
            <Pressable
              key={v}
              style={[styles.viewTab, mainView === v && styles.viewTabActive]}
              onPress={() => setMainView(v)}
            >
              <Text style={[styles.viewTabText, mainView === v && styles.viewTabTextActive]}>
                {v === 'levels' ? 'LEVELS' : 'BADGES'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {!SHOW_BADGES || mainView === 'levels' ? (
        /* ── Levels grid ──────────────────────────────────────────────── */
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.levelsContent, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {TIER_ORDER.map(tier => {
            const meta = TIER_META[tier];
            const tierLevels = LEVELS.filter(l => l.tier === tier);
            return (
              <View key={tier} style={styles.tierSection}>
                <Text style={[styles.tierHeader, { color: meta.color }]}>
                  {meta.label} — {meta.range}
                </Text>
                <View style={styles.levelGrid}>
                  {tierLevels.map(levelDef => (
                    <LevelCard
                      key={levelDef.level}
                      levelDef={levelDef}
                      isUnlocked={totalEarned >= levelDef.xpMin}
                      isCurrent={levelDef.level === currentLevel.level}
                      isNext={levelDef.level === currentLevel.level + 1}
                      totalEarned={totalEarned}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        /* ── Badges grid ──────────────────────────────────────────────── */
        <>
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
                    <Ionicons name={meta.icon as any} size={11} color={isActive ? colour : MUTED} />
                  )}
                  <Text style={[styles.filterPillText, isActive && { color: colour }]}>
                    {cat === 'all' ? 'All' : meta!.label}
                  </Text>
                </Pressable>
              );
            })}

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

          <View style={styles.catProgress}>
            <Text style={styles.catProgressText}>
              {earnedInCategory} / {totalInCategory}
              {activeCategory !== 'all' ? `  ·  ${CATEGORY_META[activeCategory].label}` : '  ·  All categories'}
            </Text>
          </View>

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
                  <AchievementTile key={a.id} achievement={a} width={TILE_W} totalEarned={totalEarned} />
                ))}
              </View>
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

// ─── Level Card ───────────────────────────────────────────────────────────────

function LevelCard({ levelDef, isUnlocked, isCurrent, isNext, totalEarned }: {
  levelDef: LevelDef;
  isUnlocked: boolean;
  isCurrent: boolean;
  isNext: boolean;
  totalEarned: number;
}) {
  // Four states: locked (named, artwork concealed), next (locked + XP-to-unlock
  // counter), earned (tier-accent premium), current (gold hero).
  const accent = isCurrent ? GOLD : TIER_ACCENT[levelDef.tier];
  const iconColor = isUnlocked ? accent : 'rgba(255,255,255,0.18)';
  // Level name uses the artwork's per-level accent colour when unlocked.
  const nameColor = isUnlocked ? levelDef.textColor : 'rgba(255,255,255,0.3)';
  const xpLabel = levelDef.level === 20
    ? '∞'
    : levelDef.xpMin.toLocaleString();

  // Progress toward this (locked) level, for the "next to unlock" counter.
  const xpToGo = Math.max(0, levelDef.xpMin - totalEarned);
  const nextProgress = isNext ? progressToTarget(totalEarned, levelDef.level) : 0;

  const cardShell = [
    styles.levelCard,
    { width: CARD_W },
    isUnlocked && {
      shadowColor: accent,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: isCurrent ? 0.5 : 0.28,
      shadowRadius: isCurrent ? 10 : 7,
      elevation: isCurrent ? 7 : 4,
    },
  ];

  // ── Locked variant ───────────────────────────────────────────────────────────
  // Locked levels show their name but keep the artwork concealed — you can see
  // what's coming, but not what it looks like. The next level to unlock also
  // shows how much XP remains.
  if (!isUnlocked) {
    return (
      <View style={[cardShell, styles.levelCardLocked, isNext && styles.levelCardNext]}>
        <View style={styles.levelLockBadge}>
          <Ionicons name="lock-closed" size={9} color="rgba(255,255,255,0.7)" />
        </View>

        <Text style={[styles.levelNum, styles.levelNumLocked]}>LVL {levelDef.level}</Text>

        {/* Concealed artwork — a faded POWR mark stands in for it, the same
            placeholder the onboarding avatar uses before a photo is picked. */}
        <View style={styles.levelLockIconWrap}>
          <Image
            source={require('@/assets/images/powr_transparent.png')}
            style={[styles.levelLockLogo, { opacity: isNext ? 0.5 : 0.18 }]}
            contentFit="contain"
          />
        </View>

        <Text style={[styles.levelName, styles.levelNameLocked]}>
          {levelDef.name.toUpperCase()}
        </Text>

        {isNext ? (
          <NextLevelCounter
            xpToGo={xpToGo}
            progress={nextProgress}
            totalEarned={totalEarned}
            target={levelDef.xpMin}
            accent={GOLD}
          />
        ) : (
          <Text style={[styles.levelXp, { color: 'rgba(255,255,255,0.25)' }]}>
            Unlock at {xpLabel} pts
          </Text>
        )}
      </View>
    );
  }

  // ── Full-bleed artwork variant (unlocked) ───────────────────────────────────
  const imageUri = LEVEL_IMAGE[levelDef.level];
  if (imageUri) {
    return (
      <View style={[cardShell, styles.levelCardImage]}>
        <NativeImage
          source={{ uri: imageUri }}
          style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]}
          resizeMode="cover"
        />

        {/* Earned seal */}
        <View style={[styles.levelSeal, { backgroundColor: accent }]}>
          <Text style={styles.levelSealCheck}>✓</Text>
        </View>

        <Text style={[styles.levelNum, styles.levelNumOverlay]}>LVL {levelDef.level}</Text>

        {/* Name + XP pinned to the bottom */}
        <View style={styles.levelImageFooter}>
          <Text style={[styles.levelName, styles.levelNameOverlay, { color: levelDef.textColor }]}>
            {levelDef.name.toUpperCase()}
          </Text>
          <Text style={[styles.levelXp, { color: accent }]}>
            {xpLabel} pts
          </Text>
        </View>
      </View>
    );
  }

  // ── Generated-SVG variant (unlocked levels without artwork yet) ─────────────
  return (
    <View style={cardShell}>
      {/* Premium tier wash — lit from the top for earned levels */}
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(accent, isCurrent ? 0.24 : 0.16), withAlpha(accent, 0.04), 'transparent']}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Earned seal */}
      <View style={[styles.levelSeal, { backgroundColor: accent }]}>
        <Text style={styles.levelSealCheck}>✓</Text>
      </View>

      {/* Level number */}
      <Text style={[styles.levelNum, styles.levelNumEarned]}>
        LVL {levelDef.level}
      </Text>

      {/* Premium icon */}
      <View style={styles.levelIconWrap}>
        <LevelIcon level={levelDef.level} size={42} color={iconColor} strokeWidth={1.7} unlocked={isUnlocked} />
      </View>

      {/* Level name */}
      <Text style={[styles.levelName, { color: nameColor }]}>
        {levelDef.name.toUpperCase()}
      </Text>

      {/* XP threshold */}
      <Text style={[styles.levelXp, { color: accent }]}>
        {xpLabel} pts
      </Text>
    </View>
  );
}

// ─── Next-Level XP Counter ──────────────────────────────────────────────────────
// Shown on the single "next to unlock" level card: how much XP the user has of
// the amount needed, a progress bar, and the remaining XP to go.

function NextLevelCounter({ xpToGo, progress, totalEarned, target, accent }: {
  xpToGo: number;
  progress: number;
  totalEarned: number;
  target: number;
  accent: string;
}) {
  return (
    <View style={styles.nextCounter}>
      <View style={styles.nextTrack}>
        <View
          style={[
            styles.nextFill,
            { width: `${Math.round(clamp01(progress) * 100)}%` as any, backgroundColor: accent },
          ]}
        />
      </View>
      <Text style={[styles.nextToGo, { color: accent }]}>
        {xpToGo.toLocaleString()} pts to go
      </Text>
      <Text style={styles.nextOf}>
        {totalEarned.toLocaleString()} / {target.toLocaleString()}
      </Text>
    </View>
  );
}

// ─── Achievement Tile ─────────────────────────────────────────────────────────

function AchievementTile({
  achievement: a,
  width,
  totalEarned,
}: {
  achievement: AchievementWithState;
  width: number;
  totalEarned: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const rarity = RARITY_META[a.rarity];
  const targetLevel = a.unlock.type === 'level' ? a.unlock.level : undefined;
  const levelDef = targetLevel ? LEVEL_BY_NUMBER.get(targetLevel) : undefined;
  const levelProgress = targetLevel ? progressToTarget(totalEarned, targetLevel) : 0;
  const { current: currentLevel } = getLevelInfo(totalEarned);

  const borderColor = 'rgba(255,255,255,0.1)';
  const iconColor = a.earned
    ? levelDef?.pill.text ?? '#E8D200'
    : 'rgba(255,255,255,0.2)';
  const levelWash = a.earned ? 0.22 : 0.12;
  const accentAlpha = a.earned ? 0.9 : 0.1 + levelProgress * 0.7;
  const accentBorder = `rgba(232,210,0,${accentAlpha.toFixed(3)})`;
  const progressLabel = a.earned
    ? 'COMPLETE'
    : `${Math.round(levelProgress * 100)}% to LV${targetLevel}`;
  const isCurrentTarget = Boolean(targetLevel && currentLevel.level + 1 === targetLevel);

  return (
    <Pressable
      style={[styles.tile, { width, borderColor, backgroundColor: CARD }]}
      onPress={() => setExpanded(v => !v)}
    >
      <View pointerEvents="none" style={[styles.tileProgressAccent, { borderColor: accentBorder }]} />
      {!!levelDef && (
        <View
          pointerEvents="none"
          style={[styles.levelWash, { backgroundColor: levelDef.pill.bg, opacity: levelWash }]}
        />
      )}

      {a.earned && a.rarity === 'legendary' && (
        <View style={[styles.rarityGlow, { backgroundColor: 'rgba(232,210,0,0.08)' }]} />
      )}

      {/* Medallion */}
      <View style={[
        styles.medallion,
        { borderColor: a.earned ? GOLD : borderColor },
      ]}>
        <View style={styles.medallionInner}>
          {levelDef ? (
            <LevelIcon level={levelDef.level} size={32} color={iconColor} strokeWidth={1.6} unlocked={a.earned} />
          ) : (
            <Ionicons name={a.icon as any} size={24} color={iconColor} />
          )}
        </View>

        {a.earned && (
          <View style={styles.checkBadge}>
            <Text style={styles.checkMark}>✓</Text>
          </View>
        )}
      </View>

      <Text style={[styles.tileCode, { color: a.earned ? 'rgba(255,255,255,0.78)' : MUTED }]}>
        {a.code}
      </Text>

      <Text style={[styles.tileName, !a.earned && { opacity: 0.5 }]} numberOfLines={2}>
        {a.name}
      </Text>

      <Text style={[styles.progressHint, isCurrentTarget && !a.earned && { color: GOLD }]}>
        {progressLabel}
      </Text>

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
  summaryLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  summaryEarned: { fontSize: 28, fontWeight: '200', color: GOLD, letterSpacing: -1 },
  summaryOf:    { fontSize: 16, fontWeight: '200', color: DIM, letterSpacing: -0.5 },
  summaryLabel: { fontSize: 11, fontWeight: '300', color: MUTED },
  summaryRight: { alignItems: 'flex-end', gap: 4 },
  progressTrack: {
    width: 120, height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: GOLD },
  progressPct: { fontSize: 10, fontWeight: '400', color: MUTED },

  // ── View toggle ────────────────────────────────────────────────────────────
  viewToggle: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  viewTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  viewTabActive: {
    borderBottomWidth: 1.5,
    borderBottomColor: GOLD,
  },
  viewTabText: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 2,
    color: MUTED,
  },
  viewTabTextActive: { color: GOLD },

  scroll: { flex: 1 },

  // ── Levels grid ────────────────────────────────────────────────────────────
  levelsContent: { paddingHorizontal: 16, paddingTop: 20, gap: 28 },

  tierSection: { gap: 12 },
  tierHeader: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  levelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: COL_GAP,
  },
  levelCard: {
    borderRadius: 16,
    paddingTop: 14,
    paddingBottom: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 6,
    position: 'relative',
    overflow: 'hidden',
  },
  // Locked card: same fixed height as the artwork cards so grid rows stay
  // even, with contents centred around the placeholder mark.
  levelCardLocked: {
    height: Math.round(CARD_W * 1.2),
    justifyContent: 'center',
  },
  levelLockIconWrap: {
    marginVertical: 8,
  },
  // The mark is landscape (roughly 1.43:1), so the box is sized to give it the
  // same visual height the lock glyph had.
  levelLockLogo: {
    width: 46,
    height: 34,
  },
  // Level number pinned top-left on the locked card (matches the artwork cards).
  levelNumLocked: {
    position: 'absolute',
    top: 10,
    left: 12,
    marginLeft: 0,
  },
  // The next level to unlock: a faint gold hint so it stands out from the
  // plain locked cards.
  levelCardNext: {
  },
  // Full-bleed image variant: fixed portrait height, no padding, text overlaid.
  levelCardImage: {
    height: Math.round(CARD_W * 1.2),
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
    gap: 0,
    justifyContent: 'flex-end',
    alignItems: 'stretch',
    backgroundColor: 'transparent',
  },
  levelNumOverlay: {
    position: 'absolute',
    top: 10,
    left: 12,
    marginLeft: 0,
    color: 'rgba(255,255,255,0.9)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  levelImageFooter: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 3,
  },
  levelNameOverlay: {
    textAlign: 'left',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  levelLockBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  levelSeal: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  levelSealCheck: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0a0a0a',
    lineHeight: 11,
  },
  levelNum: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.35)',
    alignSelf: 'flex-start',
    marginLeft: 2,
  },
  levelNumEarned: {
    color: 'rgba(255,255,255,0.55)',
  },
  levelIconWrap: {
    marginTop: 4,
    marginBottom: 2,
  },
  levelName: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: TEXT,
    textAlign: 'center',
  },
  levelNameLocked: {
    color: 'rgba(255,255,255,0.45)',
  },
  levelXp: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 0.3,
    color: GOLD,
  },

  // ── Next-level XP counter ────────────────────────────────────────────────────
  nextCounter: {
    alignSelf: 'stretch',
    marginTop: 3,
    gap: 3,
  },
  nextTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  nextFill: {
    height: '100%',
    borderRadius: 2,
  },
  nextToGo: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  nextOf: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 0.2,
    color: 'rgba(255,255,255,0.5)',
  },

  // ── Badges grid ────────────────────────────────────────────────────────────
  // flexShrink:0, not just flexGrow:0. RNW gives every horizontal ScrollView
  // flexShrink:1 AND overflow-y:hidden, so a shrinkable row gets squeezed until
  // its own hidden edge shears the descenders off the pill labels. Nothing here
  // is shrinking it today only because the grid below declares flex:1; this
  // stops that from being load-bearing.
  filterScroll: { flexGrow: 0, flexShrink: 0 },
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
  filterPillText: { fontSize: 10, fontWeight: '500', letterSpacing: 0.3, color: MUTED },

  catProgress: { paddingHorizontal: 16, paddingBottom: 10 },
  catProgressText: { fontSize: 10, fontWeight: '300', color: MUTED, letterSpacing: 0.5 },

  grid: { paddingHorizontal: 16 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: COL_GAP },

  emptyState: { paddingTop: 80, alignItems: 'center', gap: 12 },
  emptyText:  { fontSize: 14, fontWeight: '300', color: MUTED },

  // ── Achievement tile ───────────────────────────────────────────────────────
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
  tileProgressAccent: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    borderWidth: 0.5,
  },
  levelWash: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 72,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
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
  medallionInner: { alignItems: 'center', justifyContent: 'center' },
  checkBadge: {
    position: 'absolute',
    bottom: -2, right: -2,
    width: 18, height: 18,
    borderRadius: 9,
    backgroundColor: GOLD,
    borderWidth: 2,
    borderColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { fontSize: 9, fontWeight: '700', color: '#0a0a0a', lineHeight: 11 },

  tileCode: { fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  tileName:  { fontSize: 11, fontWeight: '300', color: TEXT, textAlign: 'center', lineHeight: 15 },

  progressHint: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 0.7,
    color: 'rgba(255,255,255,0.42)',
    textTransform: 'uppercase',
  },
  tileDesc: {
    fontSize: 9, fontWeight: '300', color: MUTED,
    textAlign: 'center', lineHeight: 13, marginTop: 2,
  },
});
