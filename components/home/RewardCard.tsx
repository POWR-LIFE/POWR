import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { Reward } from '@/lib/api/rewards';

const GOLD = '#E8D200';
const TEXT_PRIMARY = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';

function buildDiscountLabel(reward: Reward): string {
  if (reward.discount_type === 'percentage' && reward.discount_value != null)
    return `${reward.discount_value}% OFF`;
  if (reward.discount_type === 'fixed_amount' && reward.discount_value != null)
    return `£${reward.discount_value} OFF`;
  return reward.value_label ?? '';
}

function splitDiscount(label: string): { amount: string; suffix: string } {
  const m = label.match(/^(.+?)\s*(OFF|off)$/);
  return m ? { amount: m[1].trim(), suffix: 'OFF' } : { amount: label, suffix: '' };
}

interface RewardCardProps {
  reward: Reward;
  balance: number;
  challengeTitle?: string;
}

export function RewardCard({ reward, balance, challengeTitle }: RewardCardProps) {
  const pct = Math.min(balance / reward.powr_cost, 1);
  const label = buildDiscountLabel(reward);
  const { amount, suffix } = splitDiscount(label);

  const imageUri = reward.hero_image_url ?? reward.image_url;
  const logoUri = reward.image_url ?? reward.partner?.logo_url;

  return (
    <View style={styles.card}>
      <View style={styles.heroContainer}>
        {imageUri && (
          <Image
            source={{ uri: imageUri }}
            style={styles.heroImage}
            resizeMode="cover"
          />
        )}
        
        {/* Bottom-only gradient */}
        <LinearGradient
          colors={['rgba(10,10,10,0)', 'rgba(10,10,10,0.45)', 'rgba(10,10,10,0.85)']}
          locations={[0.3, 0.65, 1]}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Points - top right */}
        <View style={styles.pointsBlock}>
          <Text style={styles.pointsNumber}>{reward.powr_cost} <Text style={styles.pointsLabel}>points</Text></Text>
        </View>

        {/* Bottom section with logo, discount and progress */}
        <View style={styles.bottomSection}>
          {logoUri && (
            <ExpoImage source={{ uri: logoUri }} style={styles.logoImage} contentFit="contain" />
          )}

          {label && (
            <View style={styles.discountBadge}>
              <Text style={styles.discountAmount}>{amount}</Text>
              {suffix ? <Text style={styles.discountSuffix}> {suffix}</Text> : null}
            </View>
          )}
          
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` as any }]} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  heroContainer: {
    height: 208,
    position: 'relative',
    backgroundColor: 'transparent',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  pointsBlock: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  pointsNumber: {
    fontSize: 30,
    fontWeight: '200',
    color: GOLD,
    letterSpacing: -1,
    lineHeight: 32,
  },
  pointsLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: GOLD,
    opacity: 0.7,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  bottomSection: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
    gap: 8,
  },
  logoImage: {
    width: 72,
    height: 72,
  },
  discountBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    alignSelf: 'flex-start',
  },
  discountAmount: {
    fontSize: 16,
    fontWeight: '200',
    color: GOLD,
    letterSpacing: -0.3,
  },
  discountSuffix: {
    fontSize: 8,
    fontWeight: '600',
    color: GOLD,
    letterSpacing: 1,
    opacity: 0.7,
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: GOLD,
    borderRadius: 2,
  },
});
