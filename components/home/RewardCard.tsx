import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Trans } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { RewardHeroMedia } from '@/components/rewards/RewardHeroMedia';
import type { Reward } from '@/lib/api/rewards';
import i18n from '@/lib/i18n';
import { rewardLogoUri } from '@/lib/storageImage';

const GOLD = '#E8D200';
const TEXT_PRIMARY = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';

type Discount = { amount: string; suffix: string };

function buildDiscount(reward: Reward): Discount {
  if (reward.discount_type === 'percentage' && reward.discount_value != null)
    return { amount: i18n.t('home:reward.percent', { value: reward.discount_value }), suffix: i18n.t('home:reward.off') };
  if (reward.discount_type === 'fixed_amount' && reward.discount_value != null)
    return { amount: i18n.t('home:reward.pounds', { value: reward.discount_value }), suffix: i18n.t('home:reward.off') };
  return splitDiscount(reward.value_label ?? '');
}

/** A partner's own label ("10% off") is shown as written, with its "off" in the language on screen. */
function splitDiscount(label: string): Discount {
  const m = label.match(/^(.+?)\s*(OFF|off)$/);
  return m ? { amount: m[1].trim(), suffix: i18n.t('home:reward.off') } : { amount: label, suffix: '' };
}

interface RewardCardProps {
  reward: Reward;
  balance: number;
  challengeTitle?: string;
}

export function RewardCard({ reward, balance, challengeTitle }: RewardCardProps) {
  const pct = Math.min(balance / reward.powr_cost, 1);
  const { amount, suffix } = buildDiscount(reward);

  const imageUri = reward.hero_image_url ?? reward.image_url;
  const logoUri = rewardLogoUri(reward.image_url ?? reward.partner?.logo_url);

  return (
    <View style={styles.card}>
      <View style={styles.heroContainer}>
        <RewardHeroMedia
          videoUrl={reward.hero_video_url}
          imageUrl={imageUri}
          style={styles.heroImage}
          contentFit="cover"
        />

        {/* Bottom-only gradient */}
        <LinearGradient
          colors={['rgba(10,10,10,0)', 'rgba(10,10,10,0.45)', 'rgba(10,10,10,0.85)']}
          locations={[0.3, 0.65, 1]}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Points - top right */}
        <View style={styles.pointsBlock}>
          <Text style={styles.pointsNumber}>
            <Trans i18nKey="home:reward.cost" count={reward.powr_cost} components={{ label: <Text style={styles.pointsLabel} /> }} />
          </Text>
        </View>

        {/* Bottom section with logo, discount and progress */}
        <View style={styles.bottomSection}>
          {logoUri && (
            <ExpoImage source={{ uri: logoUri }} style={styles.logoImage} contentFit="contain" />
          )}

          {(amount || suffix) && (
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
