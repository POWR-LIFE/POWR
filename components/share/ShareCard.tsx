import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef } from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';

import { LevelIcon } from '@/components/LevelIcon';
import { ACTIVITIES } from '@/constants/activities';
import { LEVEL_IMAGE, getLevelInfo } from '@/constants/levels';
import { fontFamily } from '@/constants/tokens';
import type { ShareSummary } from '@/lib/api/share';

const GOLD   = '#E8D200';
const ORANGE = '#FF9944';
const GREEN  = '#00CC66';
const TEXT   = '#F2F2F2';
const DIM    = 'rgba(255,255,255,0.55)';
const MUTED  = 'rgba(255,255,255,0.32)';

interface ShareCardProps extends ViewProps {
  summary: ShareSummary;
  /** Width in dp the card will render at. Height is derived 9:16. */
  width: number;
  /**
   * Override the background image. Pass a URI string (gallery pick) or a
   * local require() result. When omitted, falls back to cover_url then gradient.
   */
  backgroundSource?: string | number | null;
  /** When provided, renders a circular avatar in the upper half of the card. */
  avatarUri?: string | null;
  /** Renders the member's current level mark centred in the upper half of the card. */
  showLevel?: boolean;
}

export const ShareCard = forwardRef<View, ShareCardProps>(({ summary, width, backgroundSource, avatarUri, showLevel, style, ...rest }, ref) => {
  const height = (width * 16) / 9;
  // Scale tokens proportionally to width — base sizes designed for ~1080dp.
  const s = width / 1080;

  const { current: level } = getLevelInfo(summary.totalEarned);

  // backgroundSource prop takes priority; undefined → fall back to cover_url only; null → gradient
  const resolvedBgSource: string | number | null =
    backgroundSource !== undefined
      ? backgroundSource
      : (summary.profile.coverUrl ?? null);

  const heroTitle = renderHeroTitle(summary);
  const heroSubtitle = renderHeroSubtitle(summary);
  const status = renderStatus(summary);
  const stats = renderStatsRow(summary);

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
          colors={['#181818', '#0d0d0d']}
          style={StyleSheet.absoluteFillObject}
        />
      )}

      {/* Gradient overlay — heavy at top and bottom, transparent in middle */}
      <LinearGradient
        colors={['rgba(0,0,0,0.72)', 'rgba(0,0,0,0.0)', 'rgba(0,0,0,0.82)', 'rgba(0,0,0,0.96)']}
        locations={[0, 0.3, 0.62, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Level mark — centred in upper half. The artwork is painted onto its own
          opaque black plate, so it sits on a black tile; on any other backing the
          plate would read as a dark square pasted over the card. */}
      {showLevel && (
        <View style={[StyleSheet.absoluteFillObject, styles.centreSlot]} pointerEvents="none">
          <View style={[styles.levelTile, {
            width: 520 * s,
            height: 520 * s,
            borderRadius: 130 * s,
            borderWidth: 3 * s,
          }]}>
            <LevelIcon
              level={level.level}
              size={LEVEL_IMAGE[level.level] ? 520 * s : 300 * s}
              color={GOLD}
              strokeWidth={1.7}
            />
          </View>
          <Text style={[styles.levelEyebrow, { fontSize: 26 * s, letterSpacing: 5 * s, marginTop: 44 * s }]}>
            {`LEVEL ${level.level}`}
          </Text>
          <Text style={[styles.levelName, { color: level.textColor, fontSize: 52 * s, letterSpacing: 2 * s, marginTop: 16 * s }]}>
            {level.name.toUpperCase()}
          </Text>
        </View>
      )}

      {/* Circular avatar — My Photo mode */}
      {avatarUri ? (
        <View style={[StyleSheet.absoluteFillObject, styles.centreSlot]} pointerEvents="none">
          <Image
            source={{ uri: avatarUri }}
            style={{
              width: 520 * s,
              height: 520 * s,
              borderRadius: 260 * s,
              borderWidth: 3 * s,
              borderColor: 'rgba(255,255,255,0.25)',
            }}
            contentFit="cover"
            transition={0}
          />
        </View>
      ) : null}

      {/* ── Header ─────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingHorizontal: 60 * s, paddingTop: 60 * s }]}>
        <Image
          source={require('@/assets/images/powrlogotext.png')}
          style={{ width: 400 * s, height: 120 * s, marginLeft: -50 * s }}
          contentFit="contain"
          transition={0}
        />
        <View style={{ flex: 1 }} />
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, {
            width: 16 * s,
            height: 16 * s,
            borderRadius: 8 * s,
            backgroundColor: status.dotColor,
          }]} />
          <Text style={[styles.statusLabel, { fontSize: 26 * s, letterSpacing: 5 * s, marginLeft: 16 * s }]}>
            {status.label.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* ── Body (pinned to bottom) ─────────────────────────────── */}
      <View style={[styles.body, { paddingHorizontal: 60 * s, paddingBottom: 72 * s }]}>
        {/* Venue / name */}
        <Text style={[styles.heroTitle, { fontSize: 80 * s, letterSpacing: 2 * s, lineHeight: 88 * s }]} numberOfLines={2}>
          {heroTitle.toUpperCase()}
        </Text>
        {heroSubtitle ? (
          <Text style={[styles.heroSubtitle, { fontSize: 30 * s, marginTop: 14 * s }]} numberOfLines={1}>
            {heroSubtitle}
          </Text>
        ) : null}

        {/* Divider */}
        <View style={[styles.divider, { marginTop: 56 * s, marginBottom: 44 * s }]} />

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatCol scale={s} {...stats[0]} />
          <View style={[styles.statDivider, { height: 100 * s }]} />
          <StatCol scale={s} {...stats[1]} />
          <View style={[styles.statDivider, { height: 100 * s }]} />
          <StatCol scale={s} {...stats[2]} />
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
  if (summary.mode === 'challenge') {
    return { label: 'Challenge Complete', dotColor: GREEN };
  }
  return getStreakStatus(summary.currentStreak);
}

function renderHeroTitle(summary: ShareSummary): string {
  if (summary.mode === 'check-in') {
    const config = ACTIVITIES[summary.type];
    return summary.venue?.name ?? config.label;
  }
  if (summary.mode === 'challenge') {
    return summary.challengeTitle;
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
  if (summary.mode === 'challenge') {
    return summary.challengeDescription;
  }
  return summary.profile.username ? `@${summary.profile.username}` : '';
}

function renderStatsRow(summary: ShareSummary): StatColProps[] {
  if (summary.mode === 'check-in') {
    return [
      { label: 'SESSION', value: summary.durationMin.toString(), unit: 'min' },
      { label: 'TOTAL', value: summary.lifetimeCount.toString(), unit: 'visits' },
      {
        label: 'STREAK',
        value: summary.currentStreak.toString(),
        unit: 'days',
        valueColor: summary.currentStreak > 0 ? GOLD : TEXT,
      },
    ];
  }
  if (summary.mode === 'challenge') {
    return [
      {
        label: 'Earned',
        value: `+${summary.points.toLocaleString()}`,
        unit: 'pts',
        valueColor: GOLD,
      },
      {
        label: summary.categoryLabel,
        value: summary.displayGoal.toLocaleString(),
        unit: summary.unit,
      },
      {
        label: 'Streak',
        value: summary.currentStreak.toString(),
        unit: 'days',
        valueColor: summary.currentStreak > 0 ? GOLD : TEXT,
      },
    ];
  }
  return [
    { label: 'TOTAL', value: summary.lifetimeCount.toString(), unit: 'visits' },
    { label: 'THIS MONTH', value: summary.monthCount.toString() },
    {
      label: 'STREAK',
      value: summary.currentStreak.toString(),
      unit: 'days',
      valueColor: summary.currentStreak > 0 ? GOLD : TEXT,
    },
  ];
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
      <View style={styles.statColValueRow}>
        <Text style={[styles.statColValue, { color: valueColor, fontSize: 84 * scale, lineHeight: 84 * scale }]}>
          {value}
        </Text>
        {unit && (
          <Text style={[styles.statColUnit, { fontSize: 28 * scale, marginLeft: 10 * scale, marginBottom: 10 * scale }]}>
            {unit}
          </Text>
        )}
      </View>
      <Text style={[styles.statColLabel, { fontSize: 22 * scale, letterSpacing: 4 * scale, marginTop: 14 * scale }]}>
        {label}
      </Text>
    </View>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function dayLabel(d: Date): string {
  const month = d.toLocaleDateString(undefined, { month: 'long' });
  const year  = d.getFullYear();
  return `${ordinal(d.getDate())} ${month} ${year}`;
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
  centreSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: '30%', // shift up slightly from true centre
    zIndex: 2,
  },
  levelTile: {
    backgroundColor: '#000',
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  levelEyebrow: {
    fontFamily: fontFamily.medium,
    color: DIM,
  },
  levelName: {
    fontFamily: fontFamily.regular,
  },
  header: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {},
  statusLabel: {
    fontFamily: fontFamily.light,
    color: TEXT,
  },
  body: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    zIndex: 2,
  },
  heroTitle: {
    fontFamily: fontFamily.regular,
    color: TEXT,
  },
  heroSubtitle: {
    fontFamily: fontFamily.light,
    color: DIM,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  statCol: {
    flex: 1,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'stretch',
    marginHorizontal: 32,
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
  statColLabel: {
    fontFamily: fontFamily.medium,
    color: MUTED,
    textTransform: 'uppercase',
  },
});
