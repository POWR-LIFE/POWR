import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActivityIcon } from '@/components/ActivityIcon';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { colours, spacing, typography } from '@/constants/tokens';

interface ActivityFeedItemProps {
  type: ActivityType;
  pointsEarned: number;
  durationMinutes: number;
  /** Override for duration display (e.g. "5.2k steps") */
  detail?: string;
  /** ISO timestamp string */
  timestamp: string;
  verified?: boolean;
  cardHeight?: number;
}

export function ActivityFeedItem({
  type,
  pointsEarned,
  durationMinutes,
  detail,
  timestamp,
  verified = true,
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
          <Text style={styles.pointsValue}>+{pointsEarned}</Text>
          <Text style={styles.pointsLabel}>POWR</Text>
        </View>
      </View>

      {/* Name + meta */}
      <View style={styles.bottom}>
        <Text style={styles.activityName} numberOfLines={1}>{config.label}</Text>
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
    backgroundColor: 'rgba(40,40,40,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 12,
    gap: 12,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
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
