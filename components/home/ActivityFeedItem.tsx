import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { colours, spacing, typography } from '@/constants/tokens';

interface ActivityFeedItemProps {
  type: ActivityType;
  pointsEarned: number;
  durationMinutes: number;
  /** ISO timestamp string */
  timestamp: string;
  verified?: boolean;
}

export function ActivityFeedItem({
  type,
  pointsEarned,
  durationMinutes,
  timestamp,
  verified = true,
}: ActivityFeedItemProps) {
  const config = ACTIVITIES[type];
  const timeAgo = formatTimeAgo(timestamp);
  const duration = formatDuration(durationMinutes);

  return (
    <View style={styles.row}>
      {/* Activity icon */}
      <View style={[styles.iconWrap, { backgroundColor: config.colour + '18' }]}>
        <Ionicons name={config.iconActive as any} size={20} color={config.colour} />
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.activityName}>{config.label}</Text>
        <Text style={styles.meta}>
          {duration}
          <Text style={styles.separator}> · </Text>
          {timeAgo}
          {!verified && (
            <Text style={styles.manual}> · Manual</Text>
          )}
        </Text>
      </View>

      {/* Points earned */}
      <View style={styles.points}>
        <Text style={styles.pointsValue}>+{pointsEarned}</Text>
        <Text style={styles.pointsLabel}>POWR</Text>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colours.border,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  activityName: {
    fontFamily: typography.h3.fontFamily,
    fontSize: 14,
    color: colours.textPrimary,
  },
  meta: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 11,
    color: colours.textMuted,
  },
  separator: {
    color: colours.border,
  },
  manual: {
    color: colours.warning,
  },
  points: {
    alignItems: 'flex-end',
    gap: 1,
  },
  pointsValue: {
    fontFamily: typography.stat.fontFamily,
    fontSize: 22,
    letterSpacing: -1,
    lineHeight: 22,
    color: colours.accent,
  },
  pointsLabel: {
    fontFamily: typography.label.fontFamily,
    fontSize: 8,
    letterSpacing: 1.5,
    color: colours.textMuted,
    textTransform: 'uppercase',
  },
});
