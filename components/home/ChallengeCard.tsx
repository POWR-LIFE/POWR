import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

const GOLD_RGB = [232, 210, 0] as const;
const ORANGE_RGB = [249, 115, 22] as const;
const GREEN_RGB = [74, 222, 128] as const;
const TEXT_PRIMARY = '#F2F2F2';
const TEXT_MUTED = 'rgba(255,255,255,0.4)';

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
  steps?: string[];
  // kept for API compat
  imageUri?: string;
  imageOffsetY?: number;
  hint?: string;
}

// ─── Step row ────────────────────────────────────────────────────────────────

function StepRow({
  label,
  stepIndex,
  sessionsCompleted,
  accent,
  isLast,
}: {
  label: string;
  stepIndex: number;
  sessionsCompleted: number;
  accent: { hex: string; rgba: (a: number) => string };
  isLast: boolean;
}) {
  const stepState: 'done' | 'active' | 'locked' =
    stepIndex < sessionsCompleted ? 'done' :
    stepIndex === sessionsCompleted ? 'active' : 'locked';

  const pulseAnim = useRef(
    new Animated.Value(stepState === 'done' ? 1 : stepState === 'active' ? 0.5 : 0.3)
  ).current;

  useEffect(() => {
    if (stepState === 'active') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.45, duration: 900, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    Animated.timing(pulseAnim, {
      toValue: stepState === 'done' ? 1 : 0.3,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [stepState, pulseAnim]);

  const circleColor =
    stepState === 'done' ? GREEN_HEX :
    stepState === 'active' ? accent.hex : 'rgba(255,255,255,0.18)';

  const circleBg =
    stepState === 'done' ? greenRgba(0.15) :
    stepState === 'active' ? accent.rgba(0.12) : 'rgba(255,255,255,0.04)';

  const labelColor =
    stepState === 'done' ? GREEN_HEX :
    stepState === 'active' ? TEXT_PRIMARY : 'rgba(255,255,255,0.28)';

  const connectorColor =
    stepState === 'done' ? greenRgba(0.35) : 'rgba(255,255,255,0.08)';

  return (
    <View style={stepStyles.row}>
      {/* Left column: circle + connector */}
      <View style={stepStyles.leftCol}>
        <Animated.View
          style={[
            stepStyles.circle,
            { borderColor: circleColor, backgroundColor: circleBg, opacity: pulseAnim },
          ]}
        >
          {stepState === 'done' && (
            <Text style={[stepStyles.checkmark, { color: GREEN_HEX }]}>✓</Text>
          )}
          {stepState === 'active' && (
            <View style={[stepStyles.activeDot, { backgroundColor: accent.hex }]} />
          )}
          {stepState === 'locked' && (
            <Text style={stepStyles.lockDot}>·</Text>
          )}
        </Animated.View>
        {!isLast && <View style={[stepStyles.connector, { backgroundColor: connectorColor }]} />}
      </View>

      {/* Right column: label + inline status */}
      <View style={[stepStyles.contentCol, isLast ? stepStyles.contentColLast : undefined]}>
        <View style={stepStyles.labelRow}>
          <Text style={[stepStyles.stepLabel, { color: labelColor }]} numberOfLines={1}>
            {label}
          </Text>
          {stepState !== 'locked' && (
            <Text style={[
              stepStyles.stepStatus,
              stepState === 'done' && { color: greenRgba(0.6) },
              stepState === 'active' && { color: accent.rgba(0.7) },
            ]}>
              {stepState === 'done' ? 'Done' : 'Up next'}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const stepStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 11,
  },
  leftCol: {
    alignItems: 'center',
    width: 22,
  },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: -1,
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  lockDot: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.2)',
    lineHeight: 14,
    marginTop: -1,
  },
  connector: {
    flex: 1,
    width: 1.5,
    marginVertical: 2,
    borderRadius: 1,
  },
  contentCol: {
    flex: 1,
    paddingTop: 3,
    paddingBottom: 14,
    justifyContent: 'flex-start',
  },
  contentColLast: {
    paddingBottom: 2,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.1,
    flex: 1,
  },
  stepStatus: {
    fontSize: 10,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.28)',
    letterSpacing: 0.2,
    flexShrink: 0,
  },
});

// ─── Main card ───────────────────────────────────────────────────────────────

export function ChallengeCard({
  title,
  description,
  bonus,
  expiresIn,
  powrRewardText = '3× POWR',
  urgency = 0,
  completed,
  sessionsCompleted = 0,
  sessionsRequired = 3,
  steps,
}: ChallengeCardProps) {
  const dotAnim = useRef(new Animated.Value(0.4)).current;
  const accent = useMemo(() => accentFromUrgency(urgency), [urgency]);

  const effectiveDone = completed ? sessionsRequired : sessionsCompleted;
  const allDone = effectiveDone >= sessionsRequired;

  useEffect(() => {
    if (allDone) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(dotAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(dotAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [dotAnim, allDone]);

  const stepLabels: string[] =
    steps?.length === sessionsRequired
      ? steps
      : Array.from({ length: sessionsRequired }, (_, i) =>
          i === 0 ? 'First session' :
          i === sessionsRequired - 1 ? 'Final session' :
          `Session ${i + 1}`
        );

  return (
    <View style={styles.card}>
      {/* Row 1: badge + countdown */}
      <View style={styles.topRow}>
        {allDone ? (
          <View style={[styles.badge, { backgroundColor: greenRgba(0.10), borderColor: greenRgba(0.30) }]}>
            <Text style={[styles.badgeText, { color: GREEN_HEX }]}>COMPLETED</Text>
          </View>
        ) : (
          <View style={[styles.badge, { backgroundColor: accent.rgba(0.10), borderColor: accent.rgba(0.28) }]}>
            <Text style={[styles.badgeText, { color: accent.hex }]}>WEEKLY CHALLENGE</Text>
          </View>
        )}
        {!allDone && (
          <View style={styles.timerRow}>
            <Animated.View style={[styles.timerDot, { opacity: dotAnim, backgroundColor: accent.hex }]} />
            <Text style={styles.timerText}>{expiresIn}</Text>
          </View>
        )}
      </View>

      {/* Title */}
      <Text style={styles.title}>{title}</Text>

      {/* Description */}
      <Text style={styles.description}>{description}</Text>

      {/* Step list */}
      <View style={styles.stepsContainer}>
        {stepLabels.map((label, i) => (
          <StepRow
            key={i}
            label={label}
            stepIndex={i}
            sessionsCompleted={effectiveDone}
            accent={accent}
            isLast={i === stepLabels.length - 1}
          />
        ))}
      </View>

      {/* Reward row */}
      {allDone ? (
        <View style={styles.rewardRow}>
          <View style={[styles.bonusBadge, { backgroundColor: greenRgba(0.10), borderColor: greenRgba(0.28) }]}>
            <Text style={[styles.bonusText, { color: GREEN_HEX }]}>EARNED</Text>
          </View>
          <Text style={styles.rewardSep}>·</Text>
          <Text style={styles.rewardDetail}>+{completed?.pointsAwarded ?? 0} POWR</Text>
        </View>
      ) : (
        <View style={styles.rewardRow}>
          <View style={[styles.bonusBadge, { backgroundColor: accent.rgba(0.10), borderColor: accent.rgba(0.22) }]}>
            <Text style={[styles.bonusText, { color: accent.hex }]}>{bonus}</Text>
          </View>
          <Text style={styles.rewardSep}>·</Text>
          <Text style={styles.rewardDetail}>{powrRewardText}</Text>
          <Text style={styles.rewardSep}>·</Text>
          <Text style={[styles.rewardDetail, { color: accent.rgba(0.6) }]}>
            {effectiveDone}/{sessionsRequired} done
          </Text>
        </View>
      )}
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
    color: TEXT_MUTED,
    lineHeight: 17,
  },
  stepsContainer: {
    marginTop: 4,
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
    color: 'rgba(255,255,255,0.25)',
  },
  rewardDetail: {
    fontSize: 10,
    fontWeight: '300',
    color: TEXT_PRIMARY,
    letterSpacing: 0.2,
  },
});
