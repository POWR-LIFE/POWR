import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const GOLD = '#E8D200';
const ORANGE = '#f97316';

interface StreakCardProps {
  streak: number;
  multiplier?: number;
  /** 7 booleans Mon–Sun */
  activeDays: boolean[];
  todayIndex: number;
  sessionActive?: boolean;
  sessionPartnerName?: string;
  sessionElapsed?: string;
  sessionProgress?: number;  // 0–1
  sessionDwellMet?: boolean; // true once the 20-min threshold is hit
  sessionProjectedPts?: number; // 10 or 15 depending on dwell time
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

type PillConfig = { label: string; dotColor: string };

function getStreakPill(streak: number): PillConfig {
  if (streak === 0)  return { label: 'START TODAY',  dotColor: GOLD };
  if (streak < 3)    return { label: 'WARMING UP',  dotColor: 'rgba(255,255,255,0.55)' };
  if (streak < 7)    return { label: 'BUILDING',     dotColor: '#4ade80' };
  if (streak < 14)   return { label: 'ON A ROLL',    dotColor: '#22c55e' };
  if (streak < 21)   return { label: 'ON FIRE',      dotColor: ORANGE };
  if (streak < 30)   return { label: 'UNSTOPPABLE',  dotColor: '#ef4444' };
  return               { label: 'LEGENDARY',    dotColor: GOLD };
}

export function StreakCard({
  streak,
  multiplier,
  activeDays,
  todayIndex,
  sessionActive,
  sessionPartnerName,
  sessionElapsed,
  sessionProgress = 0,
  sessionDwellMet = false,
  sessionProjectedPts = 10,
}: StreakCardProps) {
  const dotScale = useSharedValue(1);
  const sessionPulse = useSharedValue(0.3);

  // Streak pill dot pulse
  useEffect(() => {
    dotScale.value = withRepeat(
      withSequence(
        withTiming(1.4, { duration: 600 }),
        withTiming(1,   { duration: 800 })
      ),
      -1,
      false
    );
  }, [dotScale]);

  // Session dot pulse — pulses while waiting for dwell, solid once points are locked
  useEffect(() => {
    if (sessionActive && !sessionDwellMet) {
      sessionPulse.value = withRepeat(
        withSequence(
          withTiming(1,   { duration: 600 }),
          withTiming(0.3, { duration: 800 })
        ),
        -1,
        false
      );
    } else {
      sessionPulse.value = withTiming(sessionDwellMet ? 1 : 0.3, { duration: 300 });
    }
  }, [sessionActive, sessionDwellMet, sessionPulse]);

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: dotScale.value }],
    opacity: dotScale.value * 0.7,
  }));

  const sessionDotStyle = useAnimatedStyle(() => ({
    opacity: sessionPulse.value,
  }));

  const streakPill = getStreakPill(streak); // always defined

  return (
    <View style={styles.card}>




      {/* Content */}
      <View style={styles.content}>
        {/* Header row */}
        <View style={styles.header}>
          <Text style={styles.label}>CURRENT STREAK</Text>
          <View style={styles.pill}>
              <Animated.View
                style={[
                  styles.pillDot,
                  { backgroundColor: streakPill.dotColor },
                  dotStyle,
                ]}
              />
              <Text style={styles.pillText}>{streakPill.label}</Text>
            </View>
        </View>

        {/* Main row: Everything on one line */}
        <View style={styles.mainRow}>
          {/* Number */}
          <Text style={styles.number}>{streak}</Text>

          {/* Unit + multiplier */}
          <View style={styles.unitCol}>
            <Text style={styles.unit}>
              {`day${streak !== 1 ? 's' : ''}`}
            </Text>
            {multiplier && multiplier > 1 && (
              <Text style={styles.bonus}>{multiplier}×</Text>
            )}
          </View>

          {/* Day dots */}
          <View style={styles.dots}>
            {DAYS.map((day, i) => {
              const done = activeDays[i] ?? false;
              const isToday = i === todayIndex;
              const isFuture = i > todayIndex;
              return (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    done && styles.dotDone,
                    isToday && styles.dotToday,
                    isFuture && styles.dotFuture,
                  ]}
                >
                  {done && !isFuture && (
                    <Text style={styles.dotCheck}>✓</Text>
                  )}
                  <Text style={[styles.dotDay, done && styles.dotDayDone]}>{day}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Session active section */}
        {sessionActive && (
          <View style={styles.sessionRow}>
            <View style={styles.sessionSep} />
            <View style={styles.sessionInfo}>
              <Animated.View
                style={[
                  styles.sessionDot,
                  sessionDotStyle,
                  sessionDwellMet && { backgroundColor: GOLD },
                ]}
              />
              <Text style={[styles.sessionLabel, sessionDwellMet && styles.sessionLabelLocked]}>
                {sessionDwellMet
                  ? (sessionProjectedPts >= 15 ? 'MAX TIER' : 'POINTS LOCKED')
                  : 'SESSION'}
              </Text>
              {sessionPartnerName ? (
                <Text style={styles.sessionPartner} numberOfLines={1}>
                  {sessionPartnerName}
                </Text>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              <Text style={styles.sessionElapsed}>{sessionElapsed}</Text>
            </View>
            <View style={styles.sessionTrack}>
              <View
                style={[
                  styles.sessionFill,
                  { width: `${Math.round(sessionProgress * 100)}%` as any },
                  sessionDwellMet && styles.sessionFillLocked,
                ]}
              />
            </View>
            {sessionDwellMet && (
              <Text style={styles.sessionHint}>
                {sessionProjectedPts >= 15
                  ? `+15 pts · max tier`
                  : `+10 pts · stay 45m to unlock +15`}
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
  },
  content: {
    padding: 14,
    zIndex: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  label: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 2,
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  pillDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 8,
  },
  unitCol: {
    alignItems: 'flex-start',
    marginRight: 4,
  },
  number: {
    fontSize: 64,
    fontWeight: '100',
    lineHeight: 66,
    letterSpacing: -2,
    color: GOLD,
  },
  unit: {
    fontSize: 11,
    fontWeight: '300',
    color: '#ffffff',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  bonus: {
    fontSize: 9,
    color: GOLD,
    fontWeight: '600',
    marginTop: -2,
  },
  dots: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  dotDone: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.5)',
  },
  dotToday: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  dotFuture: {
    opacity: 0.4,
  },
  dotCheck: {
    fontSize: 7,
    color: '#ffffff',
    lineHeight: 8,
  },
  dotDay: {
    fontSize: 6,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 7,
  },
  dotDayDone: {
    color: '#ffffff',
  },
  // Session section (appears below day dots when active)
  sessionRow: {
    marginTop: 10,
    gap: 6,
  },
  sessionSep: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  sessionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sessionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GOLD,
    flexShrink: 0,
  },
  sessionLabel: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    flexShrink: 0,
  },
  sessionPartner: {
    fontSize: 9,
    fontWeight: '400',
    color: GOLD,
    flex: 1,
  },
  sessionElapsed: {
    fontSize: 9,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.4)',
    flexShrink: 0,
  },
  sessionLabelLocked: {
    color: GOLD,
  },
  sessionTrack: {
    height: 2,
    backgroundColor: 'rgba(232,210,0,0.12)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  sessionFill: {
    height: '100%',
    backgroundColor: GOLD,
    borderRadius: 1,
  },
  sessionFillLocked: {
    backgroundColor: GOLD,
    opacity: 1,
  },
  sessionHint: {
    fontSize: 9,
    fontWeight: '400',
    color: GOLD,
    opacity: 0.7,
    marginTop: 2,
  },
});
