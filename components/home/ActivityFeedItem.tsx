import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActivityIcon } from '@/components/ActivityIcon';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { colours, typography } from '@/constants/tokens';

interface ActivityFeedItemProps {
  type: ActivityType;
  pointsEarned: number;
  durationMinutes: number;
  /** Override for duration display (e.g. "5.2k steps") */
  detail?: string;
  /** ISO timestamp string */
  timestamp: string;
  verified?: boolean;
  /** Display-ready provider activity name (e.g. "Strength Training"), when it adds info. */
  rawName?: string;
  /** A real session that earned nothing — under the dwell threshold, or the day's
   *  points were already banked. Shows an em dash rather than "+0", which reads
   *  as a failure rather than as a session that simply didn't qualify. */
  unrewarded?: boolean;
  cardHeight?: number;
}

export function ActivityFeedItem({
  type,
  pointsEarned,
  durationMinutes,
  detail,
  timestamp,
  verified = true,
  rawName,
  unrewarded = false,
  cardHeight,
}: ActivityFeedItemProps) {
  const config = ACTIVITIES[type];
  const timeAgo = formatTimeAgo(timestamp);
  const duration = detail ?? formatDuration(durationMinutes);

  return (
    <View style={[styles.card, cardHeight != null && { height: cardHeight }]}>
      {/* Icon + points row */}
      <View style={styles.topRow}>
        <View style={[styles.iconWrap, { backgroundColor: config.colour + '18' }]}>
          <ActivityIcon activity={config} size={18} color={config.colour} />
        </View>
        <View style={styles.pointsBadge}>
          <Text style={[styles.pointsValue, unrewarded && styles.pointsValueMuted]}>
            {unrewarded ? '—' : `+${pointsEarned}`}
          </Text>
          <Text style={styles.pointsLabel}>POWR</Text>
        </View>
      </View>

      {/* Name + meta */}
      <View style={styles.bottom}>
        <Text style={styles.activityName} numberOfLines={1}>
          {config.label}
          {rawName ? <Text style={styles.rawName}> · {rawName}</Text> : null}
        </Text>
        <Text style={styles.meta}>
          {duration}
          <Text style={styles.separator}> · </Text>
          {timeAgo}
        </Text>
        {!verified && <Text style={styles.manual}>Manual</Text>}
      </View>
    </View>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  card: {
    width: '47.5%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 14,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointsBadge: {
    alignItems: 'flex-end',
  },
  pointsValue: {
    fontFamily: typography.stat.fontFamily,
    fontSize: 18,
    letterSpacing: -0.5,
    lineHeight: 20,
    color: colours.accent,
  },
  pointsValueMuted: {
    color: colours.textMuted,
  },
  pointsLabel: {
    fontFamily: typography.label.fontFamily,
    fontSize: 7,
    letterSpacing: 1.5,
    color: colours.textMuted,
    textTransform: 'uppercase',
  },
  bottom: {
    gap: 2,
  },
  activityName: {
    fontFamily: typography.h3.fontFamily,
    fontSize: 13,
    color: colours.textPrimary,
  },
  rawName: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 11,
    color: colours.textSecondary,
  },
  meta: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 10,
    color: colours.textMuted,
  },
  separator: {
    color: colours.border,
  },
  manual: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 10,
    color: colours.warning,
  },
});
