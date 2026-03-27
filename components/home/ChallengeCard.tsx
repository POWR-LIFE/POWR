import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

const GOLD = '#E8D200';
const ORANGE = '#f97316';

interface ChallengeCardProps {
  title: string;
  description: string;
  bonus: string;
  expiresIn: string;
  onClaim?: () => void;
}

export function ChallengeCard({ title, description, bonus, expiresIn, onClaim }: ChallengeCardProps) {
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
      {/* Gold accent bar on left edge */}
      <View style={styles.accentBar} />

      <View style={styles.inner}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.bonusBadge}>
            <Text style={styles.bonusText}>{bonus}</Text>
          </View>
        </View>

        {/* Description */}
        <Text style={styles.description}>{description}</Text>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.timer}>
            <Animated.View style={[styles.timerDot, { opacity: dotAnim }]} />
            <Text style={styles.timerText}>{`Expires ${expiresIn}`}</Text>
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
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: 'rgba(40,40,40,0.85)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  accentBar: {
    width: 2,
    backgroundColor: GOLD,
    // Fade to transparent at the bottom via a manual gradient-ish trick
    // (LinearGradient would be ideal here; using a solid for simplicity)
    opacity: 0.9,
  },
  inner: {
    flex: 1,
    padding: 12,
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 13,
    fontWeight: '300',
    color: '#F2F2F2',
  },
  bonusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: 'rgba(232,210,0,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.25)',
  },
  bonusText: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1,
    color: GOLD,
    textTransform: 'uppercase',
  },
  description: {
    fontSize: 11,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 16,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  timerDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: ORANGE,
  },
  timerText: {
    fontSize: 10,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.3)',
  },
  claimBtn: {
    backgroundColor: GOLD,
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 20,
  },
  claimText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0a0a0a',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
