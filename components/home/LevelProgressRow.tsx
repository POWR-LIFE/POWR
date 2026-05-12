import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getLevelInfo } from '@/constants/levels';

const GOLD = '#E8D200';

interface Props {
  totalEarned: number;
  onPress: () => void;
}

export function LevelProgressRow({ totalEarned, onPress }: Props) {
  const { current, next, xpIntoLevel, xpForLevel } = getLevelInfo(totalEarned);
  const pct = xpForLevel > 0 ? Math.min(xpIntoLevel / xpForLevel, 1) : 1;
  const ptsToNext = xpForLevel - xpIntoLevel;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8, transform: [{ scale: 0.99 }] }]}
    >
      <LinearGradient
        colors={['rgba(255,255,255,0.04)', 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 0.6, y: 0.5 }}
        style={[StyleSheet.absoluteFillObject, { borderRadius: 18 }]}
        pointerEvents="none"
      />

      {/* Badge tile */}
      <View style={styles.badge}>
        <Text style={styles.badgeMeta}>LVL</Text>
        <Text style={styles.badgeNumber}>{current.level}</Text>
      </View>

      {/* Right: name + bar + pts */}
      <View style={styles.right}>
        <Text style={styles.levelName}>{current.name}</Text>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
        </View>
        {next ? (
          <Text style={styles.ptsText}>
            <Text style={styles.ptsNum}>{ptsToNext.toLocaleString()}</Text>
            {' pts to next level'}
          </Text>
        ) : (
          <Text style={styles.ptsText}>You've reached the top</Text>
        )}
      </View>

      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#111111',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },

  badge: {
    width: 58,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  badgeMeta: {
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.3)',
  },
  badgeNumber: {
    fontSize: 28,
    fontWeight: '200',
    letterSpacing: -1,
    lineHeight: 30,
    color: '#F2F2F2',
  },

  right: {
    flex: 1,
    gap: 6,
  },
  levelName: {
    fontSize: 15,
    fontWeight: '300',
    color: '#F2F2F2',
    letterSpacing: 0.2,
  },
  barTrack: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: GOLD,
  },
  ptsText: {
    fontSize: 11,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.35)',
  },
  ptsNum: {
    fontSize: 11,
    fontWeight: '500',
    color: GOLD,
  },

  chevron: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.2)',
    lineHeight: 22,
    flexShrink: 0,
  },
});
