import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LevelIcon } from '@/components/LevelIcon';
import { LEVEL_IMAGE, getLevelInfo } from '@/constants/levels';

const GOLD = '#E8D200';
const TILE = 64;
/** The artwork's glow bleeds to the left and right edges of its canvas, so it must
 *  render at full tile size — any overscale clips the mark's corners. Generated
 *  SVG glyphs are drawn smaller; they carry their own breathing room. */
const GLYPH_SIZE = 34;
/** Level-number chip, overhanging the tile's bottom-right corner. */
const CHIP = 22;
const CHIP_HANG = 6;

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

      {/* Badge: level artwork, with the level number on the bottom-right corner.
          The chip is a sibling of the tile, not a child — the tile clips its own
          overflow to round the artwork, which would cut the overhang off. */}
      <View style={styles.badge}>
        <View style={styles.logoTile}>
          <LevelIcon
            level={current.level}
            size={LEVEL_IMAGE[current.level] ? TILE : GLYPH_SIZE}
            color={GOLD}
            strokeWidth={1.7}
          />
        </View>
        <View style={styles.levelChip}>
          <Text style={styles.levelChipNumber}>{current.level}</Text>
        </View>
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
          <Text style={styles.ptsText}>You&apos;ve reached the top</Text>
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
    gap: 16,
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
    width: TILE,
    height: TILE,
    flexShrink: 0,
  },
  logoTile: {
    width: TILE,
    height: TILE,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  levelChip: {
    position: 'absolute',
    right: -CHIP_HANG,
    bottom: -CHIP_HANG,
    width: CHIP,
    height: CHIP,
    borderRadius: CHIP / 2,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    // Lift the chip clear of the artwork it overlaps, and keep it above the tile
    // on Android, where paint order follows elevation rather than tree order.
    zIndex: 2,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 3,
  },
  levelChipNumber: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: -0.2,
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
