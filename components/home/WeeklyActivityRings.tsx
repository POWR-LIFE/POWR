import type { ActivityType } from '@/constants/activities';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

/* ── Public interface ──────────────────────────────────────────────── */

export interface WeeklyRingData {
  type: ActivityType;
  label: string;
  icon: string;
  iconLib: 'ionicons' | 'material-community';
  colour: string;
  current: number;
  target: number;
  /** 0 → 2 (capped) */
  pct: number;
  overachieving: boolean;
  /** Future day preview state (used when month tick points to an upcoming day). */
  isGetReady?: boolean;
  /** Optional supporting copy shown under the ring in get-ready mode. */
  hintText?: string;
  /** Activity detected by health data but not in user's focus preferences. */
  isBonus?: boolean;
}

interface WeeklyActivityBarsProps {
  rings: WeeklyRingData[];
  onPressRing?: (type: string) => void;
}

/* ── Overflow colour map ───────────────────────────────────────────── */

const OVERFLOW_COLOURS: Record<string, string> = {
  '#E8D200': '#FFF44F', // gym
  '#FF9944': '#FFB870', // running
  '#4AF2A1': '#80FFD0', // walking
  '#0EA5E9': '#60CFFF', // cycling
  '#38BDF8': '#80DDFF', // swimming
  '#EF4444': '#FF7070', // hiit
  '#7C3AED': '#A78BFA', // sports
  '#88CC28': '#B0FF50', // yoga
  '#EC4899': '#FF80C0', // dance
  '#6366F1': '#9090FF', // sleep
};

/* ── Helpers ────────────────────────────────────────────────────────── */

function fmtSteps(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function formatCount(d: WeeklyRingData): string {
  if (d.type === 'walking') return `${fmtSteps(d.current)} / ${fmtSteps(d.target)}`;
  return `${d.current} / ${d.target}`;
}

/* ── Single bar row ─────────────────────────────────────────────────── */

function ActivityBar({ data, onPress }: { data: WeeklyRingData; onPress?: () => void }) {
  const fillPct = Math.min(data.pct, 1) * 100;
  const barColour = data.overachieving
    ? (OVERFLOW_COLOURS[data.colour] ?? data.colour)
    : data.colour;
  const IconComp = data.iconLib === 'material-community' ? MaterialCommunityIcons : Ionicons;

  return (
    <Pressable style={styles.barRow} onPress={onPress}>
      <View style={styles.iconWrap}>
        <IconComp name={data.icon as any} size={16} color="#F2F2F2" />
      </View>

      <View style={styles.barBody}>
        <Text style={[styles.barCount, { color: barColour }]}>
          {formatCount(data)}
          {data.overachieving && <Text style={styles.checkMark}> ✓</Text>}
        </Text>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round(fillPct)}%` as any, backgroundColor: barColour },
            ]}
          />
        </View>
      </View>

    </Pressable>
  );
}

/* ── Exported component ────────────────────────────────────────────── */

export function WeeklyActivityBars({ rings, onPressRing }: WeeklyActivityBarsProps) {
  return (
    <View style={styles.wrapper}>
      {rings.map((d) => (
        <ActivityBar key={d.type} data={d} onPress={() => onPressRing?.(d.type)} />
      ))}
    </View>
  );
}

/* ── Circle progress variant ───────────────────────────────────────── */

const CIRCLE_SIZE = 80;
const CIRCLE_R = 32;
const CIRCLE_SW = 5;

function ActivityCircle({ data, onPress }: { data: WeeklyRingData; onPress?: () => void }) {
  const isGetReady = !!data.isGetReady;
  const pct = isGetReady ? 0.2 : Math.min(data.pct, 1);
  const circ = 2 * Math.PI * CIRCLE_R;
  const offset = circ - pct * circ;
  const barColour = data.overachieving
    ? (OVERFLOW_COLOURS[data.colour] ?? data.colour)
    : data.colour;
  const ringTrackColour = isGetReady ? `${data.colour}30` : 'rgba(255,255,255,0.07)';
  const countText = isGetReady ? 'GET READY' : `${formatCount(data)}${data.overachieving ? ' ✓' : ''}`;
  const encourageText = isGetReady ? (data.hintText ?? 'Opens this day') : null;
  const encourageOpacity = isGetReady ? 1 : 0;
  const IconComp = data.iconLib === 'material-community' ? MaterialCommunityIcons : Ionicons;

  return (
    <Pressable style={circleStyles.item} onPress={onPress}>
      <View style={circleStyles.circleWrap}>
        <Svg width={CIRCLE_SIZE} height={CIRCLE_SIZE}>
          {/* Track */}
          <Circle
            cx={CIRCLE_SIZE / 2} cy={CIRCLE_SIZE / 2} r={CIRCLE_R}
            fill="none" stroke={ringTrackColour} strokeWidth={CIRCLE_SW}
          />
          {/* Progress arc */}
          <Circle
            cx={CIRCLE_SIZE / 2} cy={CIRCLE_SIZE / 2} r={CIRCLE_R}
            fill="none" stroke={barColour} strokeWidth={CIRCLE_SW}
            strokeLinecap="round"
            strokeDasharray={isGetReady ? `${circ * 0.22} ${circ * 0.78}` : circ}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${CIRCLE_SIZE / 2} ${CIRCLE_SIZE / 2})`}
            opacity={isGetReady ? 0.9 : 1}
          />
        </Svg>
        {/* Center icon */}
        <View style={circleStyles.centerIcon}>
          <IconComp name={data.icon as any} size={20} color="#F2F2F2" />
        </View>
      </View>

      <Text style={circleStyles.label}>{data.label.toUpperCase()}</Text>
      <Text style={[circleStyles.count, { color: barColour }]}>
        {countText}
      </Text>
      {/* Always render to keep height constant — invisible when not applicable */}
      {data.isBonus ? (
        <Text style={[circleStyles.encourage, { color: 'rgba(255,255,255,0.35)', opacity: 1 }]}>
          DETECTED
        </Text>
      ) : encourageText !== null ? (
        <Text style={[circleStyles.encourage, { color: data.colour, opacity: encourageOpacity }]}>
          {encourageText}
        </Text>
      ) : (
        <Text style={[circleStyles.encourage, { opacity: 0 }]}>{' '}</Text>
      )}
    </Pressable>
  );
}

interface WeeklyActivityCirclesProps {
  rings: WeeklyRingData[];
  onPressRing?: (type: string) => void;
}

export function WeeklyActivityCircles({ rings, onPressRing }: WeeklyActivityCirclesProps) {
  return (
    <View style={circleStyles.row}>
      {rings.map((d) => (
        <ActivityCircle key={d.type} data={d} onPress={() => onPressRing?.(d.type)} />
      ))}
    </View>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },

  /* ── Bar column ─────────────────────── */
  barRow: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: 'transparent',
  },
  barBody: {
    width: '100%',
    alignItems: 'center',
    gap: 4,
  },
  barCount: {
    fontSize: 11,
    fontWeight: '300',
  },
  checkMark: {
    fontSize: 10,
  },
  track: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },

});

/* ── Circle styles ──────────────────────────────────────────────────── */

const circleStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
  },
  item: {
    alignItems: 'center',
    gap: 5,
  },
  circleWrap: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    position: 'relative',
  },
  centerIcon: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.45)',
  },
  count: {
    fontSize: 11,
    fontWeight: '300',
  },
  encourage: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 0.5,
    opacity: 0.8,
  },
});
