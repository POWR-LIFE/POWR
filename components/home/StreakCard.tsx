import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { formatHMS, msUntilMidnight } from '@/lib/journey';

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
  sessionDwellMet?: boolean; // true once the 30-min threshold is hit
  sessionProjectedPts?: number; // 15 or 20 depending on dwell time
  /** When provided, shows a share icon in the header */
  onShare?: () => void;
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

type PillConfig = { label: string; dotColor: string };

function getStreakPill(streak: number): PillConfig {
  if (streak === 0)  return { label: 'JUST STARTED',  dotColor: GOLD };
  if (streak < 3)    return { label: 'SHOWING UP',  dotColor: 'rgba(255,255,255,0.55)' };
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
  onShare,
}: StreakCardProps) {
  const streakWeeks = Math.floor(streak / 7);
  const weekDates = useMemo(() => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - todayIndex);
    monday.setHours(0, 0, 0, 0);

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d.getDate();
    });
  }, [todayIndex]);
  const [countdown, setCountdown] = useState(formatHMS(msUntilMidnight()));
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

  // Countdown to midnight — ticks every second
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown(formatHMS(msUntilMidnight()));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

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
          <Text style={styles.label}>YOUR STREAK</Text>
          <View style={styles.headerRight}>
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
            {onShare && (
              <Pressable
                onPress={onShare}
                hitSlop={10}
                style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="share-outline" size={14} color="rgba(255,255,255,0.55)" />
              </Pressable>
            )}
          </View>
        </View>

        {/* Main row: streak left, day dots right */}
        <View style={styles.mainRow}>
          <View style={styles.streakGroup}>
            <Text style={styles.number} adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.5}>{streakWeeks}</Text>
            <View style={styles.unitCol}>
              <Text style={styles.unit}>
                {`week${streakWeeks !== 1 ? 's' : ''}`}
              </Text>

            </View>
          </View>

          {/* Week strip */}
          <View style={styles.weekStrip}>
            {DAYS.map((day, i) => {
              const done = activeDays[i] ?? false;
              const isToday = i === todayIndex;
              const isFuture = i > todayIndex;
              return (
                <View key={i} style={styles.weekDayCol}>
                  <Text style={[
                    styles.weekDayName,
                    isToday && styles.weekDayNameToday,
                    isFuture && styles.weekDayNameFuture,
                  ]}>{day}</Text>
                  <View style={[
                    styles.weekDateCircle,
                    done && styles.weekDateCircleDone,
                    isToday && styles.weekDateCircleToday,
                    isFuture && styles.weekDateCircleFuture,
                  ]}>
                    <Text style={[
                      styles.weekDateNumber,
                      done && styles.weekDateNumberDone,
                      isToday && styles.weekDateNumberToday,
                    ]}>
                      {weekDates[i]}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Countdown to midnight */}
        <View style={styles.countdownRow}>
          <Text style={styles.countdownTime}>{countdown}</Text>
          <Text style={styles.countdownLabel}>Resets midnight</Text>
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
                  ? (sessionProjectedPts >= 20 ? 'MAX TIER' : 'POINTS LOCKED')
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
                {sessionProjectedPts >= 20
                  ? `+20 pts · max tier`
                  : `+15 pts · stay 40m to unlock +20`}
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  shareBtn: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  streakGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: 108,
    marginRight: 10,
    flexShrink: 0,
  },
  unitCol: {
    alignItems: 'flex-start',
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
  weekStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flex: 1,
  },
  weekDayCol: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  weekDayName: {
    fontSize: 9,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 0.3,
  },
  weekDayNameToday: {
    color: '#ffffff',
  },
  weekDayNameFuture: {
    opacity: 0.4,
  },
  weekDateCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  weekDateCircleDone: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.5)',
  },
  weekDateCircleToday: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  weekDateCircleFuture: {
    opacity: 0.4,
  },
  weekDateNumber: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
  },
  weekDateNumberDone: {
    color: '#ffffff',
  },
  weekDateNumberToday: {
    color: '#ffffff',
  },
  // Countdown to midnight
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 4,
  },
  countdownTime: {
    fontSize: 13,
    fontWeight: '200',
    color: '#F2F2F2',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  countdownLabel: {
    fontSize: 7,
    fontWeight: '400',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
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
