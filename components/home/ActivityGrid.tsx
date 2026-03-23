import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ACTIVITIES, type ActivityType } from '@/constants/activities';

const GOLD = '#facc15';

export interface ActivityGridItem {
  type: ActivityType;
  pointsEarned: number;
  detail: string; // e.g. "1h" or "4.2 mi"
}

interface ActivityGridProps {
  items: ActivityGridItem[];
}

export function ActivityGrid({ items }: ActivityGridProps) {
  return (
    <View style={styles.grid}>
      {items.map((item, i) => {
        const config = ACTIVITIES[item.type];
        return (
          <View key={i} style={styles.card}>
            <View style={[styles.iconWrap, { borderColor: config.colour + '50' }]}>
              <Ionicons name={config.iconActive as any} size={18} color={config.colour} />
            </View>
            <View style={styles.textBlock}>
              <Text style={styles.label}>{config.label}</Text>
              <Text style={styles.meta}>
                {`+${item.pointsEarned} pts · ${item.detail}`}
              </Text>
            </View>
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
    gap: 10,
  },
  card: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(50,50,50,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(250,204,21,0.12)',
    borderWidth: 1,
    flexShrink: 0,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: '#F2F2F2',
  },
  meta: {
    fontSize: 10,
    fontWeight: '300',
    color: 'rgba(242,242,242,0.6)',
  },
});
