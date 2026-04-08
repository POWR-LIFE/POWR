import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';

import { ACTIVITIES, type ActivityType } from '@/constants/activities';

const GOLD  = '#E8D200';
const TEXT  = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM   = 'rgba(255,255,255,0.45)';

import { ActivityFeedItem as ItemComponent } from './ActivityFeedItem';

export interface ActivityFeedItem {
  type: ActivityType;
  pointsEarned: number;
  durationMinutes: number;
  /** Override for duration display (e.g. "5.2k steps" for walking) */
  detail?: string;
  timestamp: string;
  verified: boolean;
}

interface ActivityFeedProps {
  items: ActivityFeedItem[];
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <View style={[styles.emptyCard, { height: 200 }]}>
        <Text style={styles.emptyText}>No activity yet this week</Text>
        <Text style={styles.emptyHint}>Tap + to log your first session</Text>
      </View>
    );
  }

  const gridItems = items.slice(0, 4);

  return (
    <View style={styles.grid}>
      {gridItems.map((item, i) => (
        <ItemComponent
          key={i}
          type={item.type}
          pointsEarned={item.pointsEarned}
          durationMinutes={item.durationMinutes}
          detail={item.detail}
          timestamp={item.timestamp}
          verified={item.verified}
          cardHeight={CARD_HEIGHT}
        />
      ))}
    </View>
  );
}

const CARD_HEIGHT = (200 - 8) / 2; // 2 rows + 1 gap → 96px each

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(40,40,40,0.85)',
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '300',
    color: DIM,
  },
  emptyHint: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
  },
});
