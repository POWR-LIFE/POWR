import React, { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const GOLD = '#E8D200';
const ORANGE = '#f97316';

interface ChallengeCardProps {
  title: string;
  description: string;
  bonus: string;
  expiresIn: string;
  imageUri?: string;
  onClaim?: () => void;
}

export function ChallengeCard({ title, description, bonus, expiresIn, imageUri, onClaim }: ChallengeCardProps) {
  const dotAnim = useRef(new Animated.Value(0.4)).current;

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
      {/* Full-card background image */}
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />
      ) : null}

      {/* Gradient: transparent at top → warm dark at bottom (semi-transparent) */}
      <LinearGradient
        colors={['transparent', 'rgba(18,14,0,0.4)', 'rgba(14,11,0,0.85)']}
        locations={[0, 0.42, 0.85]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Left gold accent bar — the challenge's signature */}
      <View style={styles.accentBar} />

      {/* Content layer */}
      <View style={styles.inner}>
        {/* Top: eyebrow badge + timer */}
        <View style={styles.topRow}>
          <View style={styles.challengeBadge}>
            <Text style={styles.challengeBadgeText}>THIS WEEK'S CHALLENGE</Text>
          </View>
          <View style={styles.timerBadge}>
            <Animated.View style={[styles.timerDot, { opacity: dotAnim }]} />
            <Text style={styles.timerText}>{expiresIn}</Text>
          </View>
        </View>

        {/* Bottom: title → description → pills + CTA */}
        <View style={styles.bottom}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>

          <View style={styles.pillsAndCta}>
            <View style={styles.pills}>
              <View style={[styles.pill, styles.pillGold]}>
                <Text style={[styles.pillText, styles.pillTextGold]}>{bonus}</Text>
              </View>
              <View style={styles.pill}>
                <Text style={styles.pillText}>+150 XP</Text>
              </View>
              <View style={styles.pill}>
                <Text style={styles.pillText}>3× POWR</Text>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [styles.claimBtn, pressed && { opacity: 0.8 }]}
              onPress={onClaim}
            >
              <Text style={styles.claimText}>CLAIM</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    overflow: 'hidden',
    height: 200,
    borderRadius: 16, // Keeping border radius to match the image corners
  },
  accentBar: {
    width: 2,
    backgroundColor: GOLD,
    opacity: 0.9,
  },
  inner: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  challengeBadge: {
    backgroundColor: 'rgba(232,210,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.28)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  challengeBadgeText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: GOLD,
    opacity: 0.85,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  timerDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: ORANGE,
  },
  timerText: {
    fontSize: 9,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.7)',
  },
  bottom: {
    gap: 8,
  },
  title: {
    fontSize: 30,
    fontWeight: '200',
    color: '#F2F2F2',
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  description: {
    fontSize: 11,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.45)',
    lineHeight: 16,
  },
  pillsAndCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pills: {
    flexDirection: 'row',
    gap: 5,
    flex: 1,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  pillGold: {
    backgroundColor: 'rgba(232,210,0,0.10)',
    borderColor: 'rgba(232,210,0,0.25)',
  },
  pillText: {
    fontSize: 9,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.3,
  },
  pillTextGold: {
    color: GOLD,
  },
  claimBtn: {
    backgroundColor: GOLD,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    flexShrink: 0,
  },
  claimText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0a0a0a',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});
