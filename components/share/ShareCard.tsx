import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef } from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';

import { ACTIVITIES } from '@/constants/activities';
import { fontFamily } from '@/constants/tokens';
import type { ShareReward, ShareSummary } from '@/lib/api/share';

const GOLD = '#E8D200';
const ORANGE = '#FF9944';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';
const MUTED = 'rgba(255,255,255,0.35)';

interface ShareCardProps extends ViewProps {
  summary: ShareSummary;
  /** Width in dp the card will render at. Height is derived 9:16. */
  width: number;
  /**
   * Override the background image. Pass a URI string (gallery pick) or a
   * local require() result. When omitted, falls back to cover_url then gradient.
   */
  backgroundSource?: string | number | null;
  /** When provided, renders a circular avatar in the top portion of the card. */
  avatarUri?: string | null;
  /** When provided, renders a brand image (contained) in the top portion of the card. */
  topImage?: string | number | null;
  /** Hide the POWR logo in the header. */
  hideLogo?: boolean;
}

export const ShareCard = forwardRef<View, ShareCardProps>(({ summary, width, backgroundSource, avatarUri, topImage, hideLogo, style, ...rest }, ref) => {
  const height = (width * 16) / 9;
  // Scale tokens proportionally to width — base sizes designed for ~1080dp.
  const s = width / 1080;

  const todayDow = (() => {
    const d = new Date().getDay();
    return d === 0 ? 6 : d - 1;
  })();

  // backgroundSource prop takes priority; undefined → fall back to cover_url only; null → gradient
  const resolvedBgSource: string | number | null =
    backgroundSource !== undefined
      ? backgroundSource
      : (summary.profile.coverUrl ?? null);

  const heroTitle = renderHeroTitle(summary);
  const heroSubtitle = renderHeroSubtitle(summary);
  const status = renderStatus(summary);
  const heroStat = renderHeroStat(summary);
  const stats = renderStatsRow(summary);
  const rewardSlot = renderRewardSlot(summary);

  return (
    <View ref={ref} collapsable={false} style={[styles.root, { width, height }, style]} {...rest}>
      {/* Background — prop overrides cover_url; null forces gradient fallback */}
      {resolvedBgSource !== null ? (
        <Image
          source={typeof resolvedBgSource === 'string' ? { uri: resolvedBgSource } : resolvedBgSource}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          transition={0}
        />
      ) : (
        <LinearGradient
          colors={['#1f1f1f', '#0d0d0d']}
          style={StyleSheet.absoluteFillObject}
        />
      )}

      {/* Top-to-mid darkening for legibility of header chrome */}
      <LinearGradient
        colors={['rgba(0,0,0,0.65)', 'rgba(0,0,0,0.10)', 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0.95)']}
        locations={[0, 0.35, 0.7, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Circular avatar — My Photo mode */}
      {avatarUri && (
        <View style={[StyleSheet.absoluteFillObject, styles.topSlot, { paddingTop: 260 * s }]} pointerEvents="none">
          <Image
            source={{ uri: avatarUri }}
            style={{
              width: 460 * s,
              height: 460 * s,
              borderRadius: 230 * s,
              borderWidth: 4 * s,
              borderColor: 'rgba(255,255,255,0.3)',
            }}
            contentFit="cover"
            transition={0}
          />
        </View>
      )}

      {/* Brand image (contained) — POWR mode */}
      {topImage != null && (
        <View style={[StyleSheet.absoluteFillObject, styles.topSlot, { paddingTop: 120 * s }]} pointerEvents="none">
          <Image
            source={typeof topImage === 'string' ? { uri: topImage } : topImage}
            style={{ width: width, height: height * 0.45 }}
            contentFit="contain"
            transition={0}
          />
        </View>
      )}

      {/* ── Header row ─────────────────────────────────────────── */}
      <View style={[styles.header, { paddingHorizontal: 56 * s, paddingTop: 56 * s }]}>
        {!hideLogo && (
          <Image
            source={require('@/assets/images/powr_icon_foreground.png')}
            style={{ width: 140 * s, height: 140 * s }}
            contentFit="contain"
            transition={0}
          />
        )}
        {hideLogo && <View style={{ width: 70 * s }} />}
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { width: 14 * s, height: 14 * s, borderRadius: 7 * s, backgroundColor: status.dotColor }]} />
          <Text style={[styles.statusLabel, { fontSize: 28 * s, letterSpacing: 4 * s, marginLeft: 14 * s }]}>
            {status.label.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* ── Body (anchored to lower half) ─────────────────────── */}
      <View style={[styles.body, { paddingHorizontal: 56 * s, paddingBottom: 48 * s }]}>
        {/* Title + subtitle */}
        <Text style={[styles.heroTitle, { fontSize: 60 * s, letterSpacing: 4 * s }]} numberOfLines={1}>
          {heroTitle.toUpperCase()}
        </Text>
        {heroSubtitle && (
          <Text style={[styles.heroSubtitle, { fontSize: 28 * s, marginTop: 10 * s }]} numberOfLines={1}>
            {heroSubtitle}
          </Text>
        )}

        {/* Hero stat */}
        <Text style={[styles.statLabel, { fontSize: 26 * s, letterSpacing: 4 * s, marginTop: 80 * s }]}>
          {heroStat.label.toUpperCase()}
        </Text>
        <View style={[styles.heroStatRow, { marginTop: 4 * s }]}>
          <Text style={[styles.heroStatNum, { fontSize: 280 * s, lineHeight: 280 * s }]}>
            {heroStat.value}
          </Text>
          <Text style={[styles.heroStatUnit, { fontSize: 60 * s, marginLeft: 12 * s, marginBottom: 32 * s }]}>
            {heroStat.unit}
          </Text>
        </View>

        {/* Divider */}
        <View style={[styles.divider, { marginTop: 36 * s, marginBottom: 36 * s }]} />

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatCol scale={s} {...stats[0]} />
          <View style={[styles.statDivider, { height: 90 * s, marginHorizontal: 28 * s }]} />
          <StatCol scale={s} {...stats[1]} />
          <View style={[styles.statDivider, { height: 90 * s, marginHorizontal: 28 * s }]} />
          <StatCol scale={s} {...stats[2]} />
        </View>

        {/* Reward + points card */}
        <View style={[styles.rewardCard, {
          marginTop: 44 * s,
          padding: 36 * s,
          borderRadius: 18 * s,
          borderWidth: 2 * s,
        }]}>
          <View style={styles.rewardCol}>
            <Text style={[styles.rewardHeader, { fontSize: 24 * s, letterSpacing: 3 * s }]}>
              {rewardSlot.label}
            </Text>
            <Text
              style={[styles.rewardValue, { fontSize: 38 * s, marginTop: 12 * s }]}
              numberOfLines={1}
            >
              {rewardSlot.value}
            </Text>
          </View>
          <View style={[styles.rewardDivider, { height: 110 * s }]} />
          <View style={styles.pointsCol}>
            <Text style={[styles.rewardHeader, { fontSize: 24 * s, letterSpacing: 3 * s }]}>
              {rewardSlot.pointsLabel}
            </Text>
            <Text style={[styles.pointsValue, { fontSize: 64 * s, marginTop: 4 * s }]}>
              {rewardSlot.pointsValue}
            </Text>
          </View>
        </View>

        {/* Week dots */}
        <View style={[styles.weekRow, { marginTop: 48 * s }]}>
          <Text style={[styles.weekLabel, { fontSize: 22 * s, letterSpacing: 3 * s }]}>THIS WEEK</Text>
          <View style={styles.weekDots}>
            {summary.weekActiveDays.map((active, i) => {
              const isToday = i === todayDow;
              const isPast = i < todayDow;
              const colour = active
                ? (isToday ? GOLD : ORANGE)
                : isPast ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)';
              return (
                <View
                  key={i}
                  style={{
                    width: 18 * s,
                    height: 18 * s,
                    borderRadius: 9 * s,
                    backgroundColor: colour,
                    marginLeft: i === 0 ? 0 : 14 * s,
                  }}
                />
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
});
ShareCard.displayName = 'ShareCard';

// ─── Mode-aware renderers ───────────────────────────────────────────────────

function renderStatus(summary: ShareSummary): { label: string; dotColor: string } {
  if (summary.mode === 'check-in') {
    return {
      label: summary.type === 'gym' ? 'Checked In' : 'Logged',
      dotColor: GOLD,
    };
  }
  return getStreakStatus(summary.currentStreak);
}

function renderHeroTitle(summary: ShareSummary): string {
  if (summary.mode === 'check-in') {
    const config = ACTIVITIES[summary.type];
    return summary.venue?.name ?? config.label;
  }
  return summary.profile.displayName ?? 'POWR Member';
}

function renderHeroSubtitle(summary: ShareSummary): string {
  if (summary.mode === 'check-in') {
    const startedDate = new Date(summary.startedAt);
    const timeLabel = `${dayLabel(startedDate)} · ${formatTime(startedDate)}`;
    const venueLine = summary.venue?.locationLabel;
    return venueLine ? `${venueLine} · ${timeLabel}` : timeLabel;
  }
  return summary.profile.username ? `@${summary.profile.username}` : '';
}

function renderHeroStat(summary: ShareSummary): { label: string; value: string; unit: string } {
  if (summary.mode === 'check-in') {
    return {
      label: `Time in ${checkInTimeNoun(summary.type)}`,
      value: summary.durationMin.toString(),
      unit: 'min',
    };
  }
  return {
    label: 'Current Streak',
    value: summary.currentStreak.toString(),
    unit: summary.currentStreak === 1 ? 'day' : 'days',
  };
}

function renderStatsRow(summary: ShareSummary): StatColProps[] {
  if (summary.mode === 'check-in') {
    return [
      { label: 'CHECK-INS', value: summary.lifetimeCount.toString(), unit: 'total' },
      { label: 'THIS MONTH', value: summary.monthCount.toString() },
      {
        label: 'STREAK',
        value: summary.currentStreak.toString(),
        unit: 'days',
        valueColor: summary.currentStreak > 0 ? ORANGE : TEXT,
      },
    ];
  }
  return [
    { label: 'CHECK-INS', value: summary.lifetimeCount.toString(), unit: 'total' },
    { label: 'THIS MONTH', value: summary.monthCount.toString() },
    {
      label: 'BEST STREAK',
      value: summary.longestStreak.toString(),
      unit: 'days',
      valueColor: summary.longestStreak > 0 ? ORANGE : TEXT,
    },
  ];
}

function renderRewardSlot(summary: ShareSummary): {
  label: string;
  value: string;
  pointsLabel: string;
  pointsValue: string;
} {
  if (summary.mode === 'check-in') {
    return {
      label: 'REWARD UNLOCKED',
      value: summary.reward ? formatRewardLine(summary.reward) : 'View rewards →',
      pointsLabel: 'POINTS EARNED',
      pointsValue: `+${summary.sessionPoints}`,
    };
  }
  return {
    label: summary.reward ? 'TOP REWARD UNLOCKED' : 'KEEP EARNING',
    value: summary.reward ? formatRewardLine(summary.reward) : 'View rewards →',
    pointsLabel: 'POWR BALANCE',
    pointsValue: summary.pointsBalance.toLocaleString(),
  };
}

function getStreakStatus(streak: number): { label: string; dotColor: string } {
  if (streak === 0) return { label: 'Start Your Streak', dotColor: GOLD };
  if (streak < 3) return { label: 'Warming Up', dotColor: 'rgba(255,255,255,0.55)' };
  if (streak < 7) return { label: 'Building', dotColor: '#4ade80' };
  if (streak < 14) return { label: 'On a Roll', dotColor: '#22c55e' };
  if (streak < 21) return { label: 'On Fire', dotColor: ORANGE };
  if (streak < 30) return { label: 'Unstoppable', dotColor: '#ef4444' };
  return { label: 'Legendary', dotColor: GOLD };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface StatColProps {
  label: string;
  value: string;
  unit?: string;
  valueColor?: string;
}

function StatCol({ scale, label, value, unit, valueColor = TEXT }: StatColProps & { scale: number }) {
  return (
    <View style={styles.statCol}>
      <Text style={[styles.statColLabel, { fontSize: 22 * scale, letterSpacing: 3 * scale }]}>
        {label}
      </Text>
      <View style={[styles.statColValueRow, { marginTop: 16 * scale }]}>
        <Text style={[styles.statColValue, { color: valueColor, fontSize: 76 * scale, lineHeight: 76 * scale }]}>
          {value}
        </Text>
        {unit && (
          <Text style={[styles.statColUnit, { fontSize: 24 * scale, marginLeft: 8 * scale, marginBottom: 8 * scale }]}>
            {unit}
          </Text>
        )}
      </View>
    </View>
  );
}

function checkInTimeNoun(type: string): string {
  switch (type) {
    case 'gym':
    case 'hiit':
      return 'Gym';
    case 'walking':
      return 'Movement';
    case 'running':
      return 'Run';
    case 'cycling':
      return 'Ride';
    case 'swimming':
      return 'Pool';
    case 'sports':
      return 'Game';
    case 'yoga':
      return 'Practice';
    default:
      return 'Activity';
  }
}

function formatRewardLine(r: ShareReward): string {
  const brand = r.brandName ?? r.partnerName;
  const value = r.valueLabel ?? r.offer ?? r.title;
  if (brand && value) return `${value} ${brand}`.trim();
  return value || r.title;
}

function dayLabel(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}

function formatTime(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#0d0d0d',
    overflow: 'hidden',
    position: 'relative',
  },
  topSlot: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    zIndex: 2,
  },
  header: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {},
  statusLabel: {
    fontFamily: fontFamily.medium,
    color: TEXT,
  },
  body: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    zIndex: 2,
  },
  heroTitle: {
    fontFamily: fontFamily.bold,
    color: TEXT,
  },
  heroSubtitle: {
    fontFamily: fontFamily.light,
    color: DIM,
  },
  statLabel: {
    fontFamily: fontFamily.medium,
    color: MUTED,
  },
  heroStatRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  heroStatNum: {
    fontFamily: fontFamily.extraLight,
    color: TEXT,
    letterSpacing: -10,
  },
  heroStatUnit: {
    fontFamily: fontFamily.light,
    color: DIM,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statCol: {
    flex: 1,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center',
  },
  statColLabel: {
    fontFamily: fontFamily.medium,
    color: MUTED,
  },
  statColValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  statColValue: {
    fontFamily: fontFamily.extraLight,
    letterSpacing: -2,
  },
  statColUnit: {
    fontFamily: fontFamily.light,
    color: DIM,
  },
  rewardCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  rewardCol: {
    flex: 1.4,
  },
  pointsCol: {
    flex: 1,
    alignItems: 'flex-start',
  },
  rewardDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: 24,
  },
  rewardHeader: {
    fontFamily: fontFamily.medium,
    color: MUTED,
    textTransform: 'uppercase',
  },
  rewardValue: {
    fontFamily: fontFamily.medium,
    color: GOLD,
  },
  pointsValue: {
    fontFamily: fontFamily.semiBold,
    color: GOLD,
    letterSpacing: -1,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weekLabel: {
    fontFamily: fontFamily.medium,
    color: MUTED,
  },
  weekDots: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
