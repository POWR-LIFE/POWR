import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  sessionProjectedPts?: number; // streak-adjusted pts for the current tier
  sessionUpgradeBonus?: number; // extra pts unlocked by staying to the upgrade tier
  sessionUpgradeMinutes?: number; // admin-tunable upgrade-tier threshold (default 40)
  sessionMaxTier?: boolean;     // true once at the top tier (or daily cap reached)
  /** When provided, shows a share icon in the header */
  onShare?: () => void;
  /** Live streak-rescue accents: the missed day glows in the week strip and a
   *  one-line progress readout sits under the countdown. Deliberately quiet —
   *  the loud moment is the one-shot StreakRescueModal, not this card. */
  rescueDayIndex?: number | null;  // Mon–Sun index of the missed day, if in this week's strip
  rescueDone?: number;
  rescueRequired?: number;
  rescueExpiresAt?: string | null;
  /** Tapping the rescue readout re-opens the rescue modal — user-initiated,
   *  so it doesn't violate the one-shot announcement rule. */
  onRescuePress?: () => void;
  /** During a Series round: The Draw, an active day counts for both. */
  seriesDraw?: { text: string; tone: 'done' | 'act' | 'warn' | 'calm' | 'out' };
  /** Tapping the Draw chip: Home opens the Series prizes on the Draw. */
  onSeriesDrawPress?: () => void;
  /** During a Series round and a gym visit: what it's worth there. */
  seriesSession?: string;
  /** One rest day a week (lib/streakRest): the day this week it held the streak, Mon = 0. */
  restDayIndex?: number | null;
  /** This week's rest day is unused, so a day off today won't break the streak. null = no rest days. */
  restFree?: boolean | null;
}

const DAYS = [
  'home:weekdays.mon', 'home:weekdays.tue', 'home:weekdays.wed', 'home:weekdays.thu',
  'home:weekdays.fri', 'home:weekdays.sat', 'home:weekdays.sun',
];

/** `label` is a catalog key, read at render. */
type PillConfig = { label: string; dotColor: string };

function getStreakPill(streak: number): PillConfig {
  if (streak === 0)  return { label: 'home:streak.pill.justStarted',  dotColor: GOLD };
  if (streak < 3)    return { label: 'home:streak.pill.showingUp',  dotColor: 'rgba(255,255,255,0.55)' };
  if (streak < 7)    return { label: 'home:streak.pill.building',     dotColor: '#4ade80' };
  if (streak < 14)   return { label: 'home:streak.pill.onARoll',    dotColor: '#22c55e' };
  if (streak < 21)   return { label: 'home:streak.pill.onFire',      dotColor: ORANGE };
  if (streak < 30)   return { label: 'home:streak.pill.unstoppable',  dotColor: '#ef4444' };
  return               { label: 'home:streak.pill.legendary',    dotColor: GOLD };
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
  sessionUpgradeBonus = 0,
  sessionUpgradeMinutes = 40,
  sessionMaxTier = false,
  onShare,
  rescueDayIndex = null,
  rescueDone = 0,
  rescueRequired = 0,
  rescueExpiresAt = null,
  onRescuePress,
  seriesDraw,
  onSeriesDrawPress,
  seriesSession,
  restDayIndex = null,
  restFree = null,
}: StreakCardProps) {
  const { t } = useTranslation();
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
          <Text style={styles.label}>{t('home:streak.title')}</Text>
          <View style={styles.headerRight}>
            <View style={styles.pill}>
              <Animated.View
                style={[
                  styles.pillDot,
                  { backgroundColor: streakPill.dotColor },
                  dotStyle,
                ]}
              />
              <Text style={styles.pillText}>{t(streakPill.label)}</Text>
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
                {t('home:streak.weeks', { count: streakWeeks })}
              </Text>

            </View>
          </View>

          {/* Week strip */}
          <View style={styles.weekStrip}>
            {DAYS.map((day, i) => {
              const done = activeDays[i] ?? false;
              const isToday = i === todayIndex;
              const isFuture = i > todayIndex;
              const isRescue = i === rescueDayIndex && !done;
              const isRest = i === restDayIndex && !done && !isToday && !isRescue;
              return (
                <View key={i} style={styles.weekDayCol}>
                  <Text style={[
                    styles.weekDayName,
                    isToday && styles.weekDayNameToday,
                    isFuture && styles.weekDayNameFuture,
                    isRescue && styles.weekDayNameRescue,
                  ]}>{t(day)}</Text>
                  <View style={[
                    styles.weekDateCircle,
                    done && styles.weekDateCircleDone,
                    isToday && styles.weekDateCircleToday,
                    isFuture && styles.weekDateCircleFuture,
                    isRescue && styles.weekDateCircleRescue,
                    isRest && styles.weekDateCircleRest,
                  ]}>
                    {isRest ? (
                      <Ionicons name="moon" size={12} color="rgba(255,255,255,0.6)" accessibilityLabel={t('home:streak.restDay')} />
                    ) : (
                      <Text style={[
                        styles.weekDateNumber,
                        done && styles.weekDateNumberDone,
                        isToday && styles.weekDateNumberToday,
                        isRescue && styles.weekDateNumberRescue,
                      ]}>
                        {weekDates[i]}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Countdown to midnight */}
        <View style={styles.countdownRow}>
          {/* Not moved yet and the week's rest day is free: nothing resets tonight. */}
          {restFree && !activeDays[todayIndex] ? (
            <>
              <Ionicons name="moon-outline" size={11} color="rgba(255,255,255,0.55)" />
              <Text style={styles.restLabel}>{t('home:streak.restFree')}</Text>
            </>
          ) : (
            <>
              <Text style={styles.countdownTime}>{countdown}</Text>
              <Text style={styles.countdownLabel}>{t('home:streak.resets')}</Text>
            </>
          )}
          {seriesDraw && (() => {
            // What's at stake for The Draw today: green in, gold act now, orange
            // last chance; on track stays quiet so the loud ones mean something.
            const [c, border] = {
              done: ['#4ade80', 'rgba(74,222,128,0.35)'],
              act: [GOLD, 'rgba(232,210,0,0.4)'],
              warn: [ORANGE, 'rgba(249,115,22,0.45)'],
              calm: ['rgba(255,255,255,0.6)', 'rgba(255,255,255,0.14)'],
              out: ['rgba(255,255,255,0.35)', 'rgba(255,255,255,0.1)'],
            }[seriesDraw.tone];
            const icon = seriesDraw.tone === 'done' ? 'checkmark-circle' : seriesDraw.tone === 'warn' ? 'alert-circle-outline' : 'ticket-outline';
            return (
              <Pressable
                onPress={onSeriesDrawPress}
                disabled={!onSeriesDrawPress}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${seriesDraw.text.toLowerCase()}. Opens the Draw prize.`}
                style={({ pressed }) => [styles.drawChip, { borderColor: border }, seriesDraw.tone === 'act' && styles.drawChipAct, seriesDraw.tone === 'warn' && styles.drawChipWarn, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name={icon} size={10} color={c} />
                <Text style={[styles.drawChipText, { color: c }]} numberOfLines={1}>{seriesDraw.text}</Text>
              </Pressable>
            );
          })()}
        </View>

        {/* Live rescue readout — one quiet line, the modal already announced it.
            Shows whenever an offer is live, even when the missed day falls
            outside this week's strip. */}
        {rescueRequired > 0 && (
          <Pressable
            onPress={onRescuePress}
            disabled={!onRescuePress}
            hitSlop={8}
            style={({ pressed }) => [styles.rescueRow, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="bandage-outline" size={11} color={ORANGE} />
            <Text style={styles.rescueText}>
              {rescueExpiresAt
                ? t('home:streak.rescueTimed', {
                    done: Math.min(rescueDone, rescueRequired),
                    required: rescueRequired,
                    count: Math.max(1, Math.floor((new Date(rescueExpiresAt).getTime() - Date.now()) / 3600_000)),
                  })
                : t('home:streak.rescue', { done: Math.min(rescueDone, rescueRequired), required: rescueRequired })}
            </Text>
            {onRescuePress && (
              <Ionicons name="chevron-forward" size={11} color="rgba(249,115,22,0.6)" />
            )}
          </Pressable>
        )}

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
                  ? (sessionMaxTier ? t('home:streak.session.maxTier') : t('home:streak.session.locked'))
                  : t('home:streak.session.label')}
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
                {sessionMaxTier
                  ? t('home:streak.session.hintMax', { points: sessionProjectedPts })
                  : t('home:streak.session.hintUpgrade', { points: sessionProjectedPts, minutes: sessionUpgradeMinutes, bonus: sessionUpgradeBonus })}
              </Text>
            )}
            {seriesSession && (
              <View style={styles.seriesLine}>
                <Ionicons name="trophy-outline" size={10} color={GOLD} />
                <Text style={styles.seriesLineText} numberOfLines={2}>{seriesSession}</Text>
              </View>
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
  // Rescue accents — the missed day "needs saving"
  weekDayNameRescue: {
    color: ORANGE,
    opacity: 1,
  },
  weekDateCircleRescue: {
    borderColor: ORANGE,
    borderWidth: 1.5,
    backgroundColor: 'rgba(249,115,22,0.15)',
  },
  weekDateNumberRescue: {
    color: ORANGE,
    fontWeight: '700',
  },
  weekDateCircleRest: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.35)',
  },
  restLabel: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
  },
  rescueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  rescueText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    color: ORANGE,
    fontVariant: ['tabular-nums'],
  },
  // Countdown to midnight
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 4,
  },
  drawChip: {
    marginLeft: 'auto',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.3)',
  },
  drawChipAct: { backgroundColor: 'rgba(232,210,0,0.10)' },
  drawChipWarn: { backgroundColor: 'rgba(249,115,22,0.12)' },
  drawChipText: { fontSize: 8, fontWeight: '700', letterSpacing: 1, color: GOLD },
  seriesLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  seriesLineText: { flex: 1, fontSize: 10, fontWeight: '400', color: GOLD },
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
