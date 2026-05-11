import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

const GOLD_RGB = [232, 210, 0] as const;
const ORANGE_RGB = [249, 115, 22] as const;
const GREEN_RGB = [74, 222, 128] as const;
const TEXT_PRIMARY = '#F2F2F2';

function accentFromUrgency(u: number) {
  const t = Math.max(0, Math.min(1, u));
  const r = Math.round(GOLD_RGB[0] + (ORANGE_RGB[0] - GOLD_RGB[0]) * t);
  const g = Math.round(GOLD_RGB[1] + (ORANGE_RGB[1] - GOLD_RGB[1]) * t);
  const b = Math.round(GOLD_RGB[2] + (ORANGE_RGB[2] - GOLD_RGB[2]) * t);
  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  const rgba = (a: number) => `rgba(${r},${g},${b},${a})`;
  return { hex, rgba };
}

const GREEN_HEX = `#${GREEN_RGB[0].toString(16)}${GREEN_RGB[1].toString(16)}${GREEN_RGB[2].toString(16)}`;
const greenRgba = (a: number) => `rgba(${GREEN_RGB[0]},${GREEN_RGB[1]},${GREEN_RGB[2]},${a})`;

type CompletionInfo = { pointsAwarded: number; activityType: string };

interface ChallengeCardProps {
  title: string;
  description: string;
  bonus: string;
  expiresIn: string;
  powrRewardText?: string;
  urgency?: number;
  completed?: CompletionInfo;
  sessionsCompleted?: number;
  sessionsRequired?: number;
  // kept for API compat, unused in this layout
  imageUri?: string;
  imageOffsetY?: number;
  hint?: string;
}

export function ChallengeCard({
  title,
  description,
  bonus,
  expiresIn,
  powrRewardText = '3× POWR',
  urgency = 0,
  completed,
  sessionsCompleted = 0,
  sessionsRequired = 1,
}: ChallengeCardProps) {
  const dotAnim = useRef(new Animated.Value(0.4)).current;
  const accent = useMemo(() => accentFromUrgency(urgency), [urgency]);

  useEffect(() => {
    if (completed) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(dotAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(dotAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [dotAnim, completed]);

  const progressPct = completed
    ? 1
    : Math.min(sessionsCompleted / Math.max(sessionsRequired, 1), 1);

  const sessionLabel = completed
    ? `${sessionsRequired}/${sessionsRequired} sessions`
    : `${sessionsCompleted}/${sessionsRequired} sessions`;

  const fillColor = completed ? GREEN_HEX : accent.hex;
  const trackColor = completed ? greenRgba(0.15) : accent.rgba(0.15);

  return (
    <View style={styles.card}>
      {/* Row 1: badge + countdown */}
      <View style={styles.topRow}>
        {completed ? (
          <View style={[styles.badge, { backgroundColor: greenRgba(0.10), borderColor: greenRgba(0.30) }]}>
            <Text style={[styles.badgeText, { color: GREEN_HEX }]}>COMPLETED</Text>
          </View>
        ) : (
          <View style={[styles.badge, { backgroundColor: accent.rgba(0.10), borderColor: accent.rgba(0.28) }]}>
            <Text style={[styles.badgeText, { color: accent.hex }]}>WEEKLY CHALLENGE</Text>
          </View>
        )}
        <View style={styles.timerRow}>
          {!completed && (
            <Animated.View style={[styles.timerDot, { opacity: dotAnim, backgroundColor: accent.hex }]} />
          )}
          <Text style={styles.timerText}>{expiresIn}</Text>
        </View>
      </View>

      {/* Row 2: challenge name */}
      <Text style={styles.title}>{title}</Text>

      {/* Row 3: description */}
      <Text style={styles.description}>{description}</Text>

      {/* Row 4: bonus badge + points descriptor */}
      {completed ? (
        <View style={styles.rewardRow}>
          <View style={[styles.bonusBadge, { backgroundColor: greenRgba(0.10), borderColor: greenRgba(0.28) }]}>
            <Text style={[styles.bonusText, { color: GREEN_HEX }]}>EARNED</Text>
          </View>
          <Text style={styles.rewardSep}>·</Text>
          <Text style={styles.rewardDetail}>+{completed.pointsAwarded} POWR</Text>
        </View>
      ) : (
        <View style={styles.rewardRow}>
          <View style={[styles.bonusBadge, { backgroundColor: accent.rgba(0.10), borderColor: accent.rgba(0.22) }]}>
            <Text style={[styles.bonusText, { color: accent.hex }]}>{bonus}</Text>
          </View>
          <Text style={styles.rewardSep}>·</Text>
          <Text style={styles.rewardDetail}>{powrRewardText}</Text>
        </View>
      )}

      {/* Row 5: thin progress bar + session counter */}
      <View style={styles.progressRow}>
        <View style={[styles.progressTrack, { backgroundColor: trackColor }]}>
          <LinearGradient
            colors={completed ? [GREEN_HEX, '#86efac'] : [accent.hex, accent.rgba(0.7)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.progressFill, { width: `${Math.round(progressPct * 100)}%` as any }]}
          />
        </View>
        <Text style={[styles.sessionCounter, { color: completed ? greenRgba(0.7) : accent.rgba(0.7) }]}>
          {sessionLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 16,
    gap: 10,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#111111',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  timerDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  timerText: {
    fontSize: 12,
    fontWeight: '300',
    color: TEXT_PRIMARY,
    letterSpacing: -0.2,
  },
  title: {
    fontSize: 22,
    fontWeight: '200',
    color: TEXT_PRIMARY,
    letterSpacing: -0.4,
  },
  description: {
    fontSize: 12,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 17,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    color: 'rgba(255,255,255,0.25)',
  },
  rewardDetail: {
    fontSize: 10,
    fontWeight: '300',
    color: TEXT_PRIMARY,
    letterSpacing: 0.2,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  progressTrack: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 1,
  },
  sessionCounter: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 0.3,
    flexShrink: 0,
  },
});
