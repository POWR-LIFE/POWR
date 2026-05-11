import { Ionicons } from '@expo/vector-icons';
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
  const { pill } = current;
  const title = `Level ${current.level} · ${current.name}`;
  const hint = next
    ? `${ptsToNext.toLocaleString()} pts to Level ${next.level} · ${next.name}`
    : "You've reached the top";

  const fillColors: [string, string] = [GOLD, '#FFF27A'];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8, transform: [{ scale: 0.99 }] }]}
    >
      {/* Dark card background */}

      {/* Subtle colour wash from accent */}
      <LinearGradient
        colors={[pill.bg, 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 0.6, y: 0.5 }}
        style={[StyleSheet.absoluteFillObject, { borderRadius: 18 }]}
        pointerEvents="none"
      />

      {/* Ring */}
      <View style={styles.circleWrap}>
        <View style={[styles.ring, { borderColor: pill.border, backgroundColor: 'rgba(0,0,0,0.4)' }]}>
          <Text style={styles.levelNumber}>{current.level}</Text>
        </View>
      </View>

      {/* Progress content */}
      <View style={styles.center}>
        <Text style={styles.nextLabel}>{title}</Text>
        <Text style={styles.ptsHint}>{hint}</Text>
        <View style={styles.track}>
          <LinearGradient
            colors={fillColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.fill, { width: `${Math.round(pct * 100)}%` as any }]}
          />
        </View>
      </View>

      <Ionicons name="chevron-forward" size={15} color="rgba(255,255,255,0.2)" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#111111',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  circleWrap: {
    alignItems: 'center',
    gap: 5,
    width: 52,
  },
  ring: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelNumber: {
    fontSize: 19,
    fontWeight: '400',
    letterSpacing: -0.2,
    lineHeight: 20,
    color: GOLD,
  },
  center: {
    flex: 1,
    gap: 3,
  },
  nextLabel: {
    fontSize: 13,
    fontWeight: '300',
    color: '#F2F2F2',
    letterSpacing: -0.1,
  },
  ptsHint: {
    fontSize: 10,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.35)',
    marginBottom: 4,
  },
  track: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 1,
  },
});

