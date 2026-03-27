import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';

import { ACTIVITIES, type ActivityType } from '@/constants/activities';

const GOLD  = '#E8D200';
const TEXT  = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM   = 'rgba(255,255,255,0.45)';

const { width: SCREEN_W } = Dimensions.get('window');
// Account for outer paddingHorizontal:10 on the ScrollView content, so usable = SCREEN_W - 20
// Each tile is (usable - gap) / 2
const TILE_W = (SCREEN_W - 20 - 8) / 2;

export interface ActivityFeedItem {
  type: ActivityType;
  pointsEarned: number;
  detail: string;
}

interface ActivityFeedProps {
  items: ActivityFeedItem[];
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>No activity yet this week</Text>
        <Text style={styles.emptyHint}>Tap + to log your first session</Text>
      </View>
    );
  }

  // Show at most 4 items in a 2×2 grid
  const gridItems = items.slice(0, 4);

  return (
    <View style={styles.grid}>
      {gridItems.map((item, i) => {
        const config = ACTIVITIES[item.type];
        return (
          <View key={i} style={styles.tile}>
            {/* Icon */}
            <View style={[styles.iconWrap, { backgroundColor: config.colour + '20' }]}>
              <Ionicons name={config.iconActive as any} size={22} color={config.colour} />
            </View>

            {/* Name */}
            <Text style={styles.tileName} numberOfLines={1}>{config.label}</Text>

            {/* Points */}
            <Text style={styles.tilePoints}>+{item.pointsEarned} pts</Text>

            {/* Detail */}
            <Text style={styles.tileDetail} numberOfLines={1}>{item.detail}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tile: {
    width: TILE_W,
    backgroundColor: 'rgba(40,40,40,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  tileName: {
    fontSize: 13,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.1,
  },
  tilePoints: {
    fontSize: 15,
    fontWeight: '200',
    color: GOLD,
    letterSpacing: -0.3,
    marginTop: 2,
  },
  tileDetail: {
    fontSize: 11,
    fontWeight: '300',
    color: DIM,
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
