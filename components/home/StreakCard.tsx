import { ResizeMode, Video } from 'expo-av';
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

const GOLD = '#facc15';
const ORANGE = '#f97316';

interface StreakCardProps {
  streak: number;
  multiplier?: number;
  /** 7 booleans Mon–Sun */
  activeDays: boolean[];
  todayIndex: number;
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function StreakCard({ streak, multiplier, activeDays, todayIndex }: StreakCardProps) {
  const videoRef = useRef<Video>(null);
  const dotScale = useSharedValue(1);

  useEffect(() => {
    dotScale.value = withRepeat(
      withSequence(
        withTiming(1.4, { duration: 600 }),
        withTiming(1, { duration: 800 })
      ),
      -1,
      false
    );
  }, [dotScale]);

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: dotScale.value }],
    opacity: dotScale.value * 0.7,
  }));

  const hasStreak = streak > 0;

  return (
    <View style={styles.card}>
      {/* Background video */}
      <Video
        ref={videoRef}
        source={require('@/assets/images/hero_gym_entry.mp4')}
        style={StyleSheet.absoluteFillObject}
        resizeMode={ResizeMode.COVER}
        shouldPlay
        isLooping
        isMuted
        onReadyForDisplay={() => videoRef.current?.playAsync()}
      />

      {/* Dark overlay gradient */}
      <LinearGradient
        colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.75)']}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Content */}
      <View style={styles.content}>
        {/* Header row */}
        <View style={styles.header}>
          <Text style={styles.label}>CURRENT STREAK</Text>
          {hasStreak && (
            <View style={styles.fireBadge}>
              <Animated.View style={[styles.fireDot, dotStyle]} />
              <Text style={styles.fireText}>ON FIRE</Text>
            </View>
          )}
        </View>

        {/* Number */}
        <Text style={styles.number}>{streak}</Text>

        {/* Unit + multiplier */}
        <Text style={styles.unit}>
          {`day${streak !== 1 ? 's' : ''}`}
          {multiplier && multiplier > 1
            ? <Text style={styles.bonus}>{`  ·  ${multiplier}× points`}</Text>
            : null}
        </Text>

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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    minHeight: 168,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
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
  fireBadge: {
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
  fireDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: ORANGE,
  },
  fireText: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: '#ffffff',
    textTransform: 'uppercase',
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
    marginBottom: 10,
  },
  bonus: {
    color: GOLD,
    fontWeight: '400',
  },
  dots: {
    flexDirection: 'row',
    gap: 5,
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
    borderColor: 'rgba(250,204,21,0.5)',
  },
  dotToday: {
    backgroundColor: 'rgba(250,204,21,0.1)',
    borderWidth: 1.5,
    borderColor: GOLD,
  },
  dotFuture: {
    opacity: 0.4,
  },
  dotCheck: {
    fontSize: 7,
    color: GOLD,
    lineHeight: 8,
  },
  dotDay: {
    fontSize: 6,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 7,
  },
  dotDayDone: {
    color: GOLD,
  },
});
