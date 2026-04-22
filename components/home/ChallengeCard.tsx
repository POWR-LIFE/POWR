import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';

const GOLD_RGB = [232, 210, 0] as const;
const ORANGE_RGB = [249, 115, 22] as const;
const TEXT_PRIMARY = '#F2F2F2';

/** Lerp between gold and orange, return hex + rgba helpers. */
function accentFromUrgency(u: number) {
  const t = Math.max(0, Math.min(1, u));
  const r = Math.round(GOLD_RGB[0] + (ORANGE_RGB[0] - GOLD_RGB[0]) * t);
  const g = Math.round(GOLD_RGB[1] + (ORANGE_RGB[1] - GOLD_RGB[1]) * t);
  const b = Math.round(GOLD_RGB[2] + (ORANGE_RGB[2] - GOLD_RGB[2]) * t);
  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  const rgba = (a: number) => `rgba(${r},${g},${b},${a})`;
  return { hex, rgba };
}

interface ChallengeCardProps {
  title: string;
  description: string;
  bonus: string;
  expiresIn: string;
  imageUri?: string;
  imageOffsetY?: number;
  hint?: string;
  xpReward?: number;
  powrRewardText?: string;
  /** 0 = relaxed (gold), 1 = urgent (orange). Defaults to 0. */
  urgency?: number;
}

export function ChallengeCard({ title, description, bonus, expiresIn, imageUri, imageOffsetY = 0, hint, xpReward = 150, powrRewardText = '3× POWR', urgency = 0 }: ChallengeCardProps) {
  const dotAnim = useRef(new Animated.Value(0.4)).current;
  const accent = useMemo(() => accentFromUrgency(urgency), [urgency]);
  const imageInset = Math.abs(imageOffsetY);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(dotAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(dotAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [dotAnim]);

  return (
    <View style={styles.card}>
      {/* Background image with the same overlay fade treatment as rewards hero */}
      {imageUri ? (
        <View style={styles.maskedImage}>
          <Image
            source={{ uri: imageUri }}
            style={[
              styles.maskedImageContent,
              imageInset ? { top: -imageInset, bottom: -imageInset } : null,
              { transform: [{ translateY: imageOffsetY }] },
            ]}
            resizeMode="cover"
          />
          <LinearGradient
            colors={['rgba(10,10,10,0.85)', 'rgba(10,10,10,0.35)', 'rgba(10,10,10,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            colors={['rgba(10,10,10,0)', 'rgba(10,10,10,0.6)', 'rgba(10,10,10,0.95)']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFillObject}
          />
        </View>
      ) : null}

      {/* Content layer */}
      <View style={styles.inner}>
        {/* Top: eyebrow badge + timer */}
        <View style={styles.topRow}>
          <View style={[styles.challengeBadge, { backgroundColor: accent.rgba(0.10), borderColor: accent.rgba(0.25) }]}>
            <Text style={[styles.challengeBadgeText, { color: accent.hex }]}>WEEKLY CHALLENGE</Text>
          </View>
          <View style={styles.timerBadge}>
            <Animated.View style={[styles.timerDot, { opacity: dotAnim, backgroundColor: accent.hex }]} />
            <Text style={styles.timerText}>{expiresIn}</Text>
          </View>
        </View>

        {/* Title + description */}
        <View style={styles.bottom}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>

          {/* Reward line — inline with dot separators */}
          <View style={styles.rewardRow}>
            <View style={[styles.bonusBadge, { backgroundColor: accent.rgba(0.10), borderColor: accent.rgba(0.22) }]}>
              <Text style={[styles.bonusText, { color: accent.hex }]}>{bonus}</Text>
            </View>
            <Text style={styles.rewardSep}>·</Text>
            <Text style={styles.rewardDetail}>+{xpReward} XP</Text>
            <Text style={styles.rewardSep}>·</Text>
            <Text style={styles.rewardDetail}>{powrRewardText}</Text>
          </View>

          {hint && <Text style={styles.hint}>{hint}</Text>}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 200,
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  maskedImage: {
    ...StyleSheet.absoluteFillObject,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  maskedImageContent: {
    ...StyleSheet.absoluteFillObject,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  inner: {
    flex: 1,
    padding: 16,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 10,
  },
  challengeBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  challengeBadgeText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  timerDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  timerText: {
    fontSize: 9,
    fontWeight: '400',
    color: TEXT_PRIMARY,
  },
  bottom: {
    gap: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: '300',
    color: TEXT_PRIMARY,
    letterSpacing: -0.3,
  },
  description: {
    fontSize: 11,
    fontWeight: '300',
    color: TEXT_PRIMARY,
    lineHeight: 16,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  bonusBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  bonusText: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  rewardSep: {
    fontSize: 10,
    color: TEXT_PRIMARY,
  },
  rewardDetail: {
    fontSize: 9,
    fontWeight: '400',
    color: TEXT_PRIMARY,
    letterSpacing: 0.2,
  },
  hint: {
    fontSize: 10,
    fontWeight: '300',
    letterSpacing: 0.3,
    color: TEXT_PRIMARY,
  },
});
