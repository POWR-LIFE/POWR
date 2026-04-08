import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Stop } from 'react-native-svg';
import type { LevelDef } from '@/constants/levels';

const GOLD   = '#E8D200';
const ORANGE = '#f97316';
const GREEN  = '#4ade80';

const SIZE   = 160;
const CX     = SIZE / 2;
const CY     = SIZE / 2;
const RING_R = 62;
const STROKE = 9;

function circumference(r: number) {
  return 2 * Math.PI * r;
}

function strokeDashoffset(r: number, pct: number) {
  const c = circumference(r);
  return c - pct * c;
}

interface RingMetric {
  label: string;
  icon: string;
  value: string;
  max: string;
  pct: number;
  colour: string;
  gradId: string;
  gradStart: string;
  gradEnd: string;
  iconLib?: string;
}

interface CombinedProgressRingProps {
  levelNumber: number;
  levelName: string;
  xp: number;
  xpMax: number;
  metrics: [RingMetric, RingMetric, RingMetric];
  nextLevelHint: string;
  currentLevel: LevelDef;
}

export function CombinedProgressRing({
  levelNumber,
  levelName,
  xp,
  xpMax,
  metrics,
  nextLevelHint,
  currentLevel,
}: CombinedProgressRingProps) {
  const xpPct = Math.min(xp / xpMax, 1);
  const pill  = currentLevel.pill;

  const TICK_INNER_R = RING_R + STROKE / 2 + 4;

  return (
    <View style={styles.card}>
      {/* Ring */}
      <View style={styles.ringWrap}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <Defs>
            <LinearGradient id="cpr-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%"   stopColor={GOLD}   />
              <Stop offset="50%"  stopColor={ORANGE} />
              <Stop offset="100%" stopColor={GREEN}  />
            </LinearGradient>
          </Defs>

          {/* Clock tick marks */}
          {Array.from({ length: 60 }, (_, i) => {
            const angle          = (i * 6 - 90) * (Math.PI / 180);
            const isMajor        = i % 5 === 0;
            const tickLen        = isMajor ? 9 : 5;
            const r1             = TICK_INNER_R;
            const r2             = r1 + tickLen;
            const withinProgress = i / 60 < xpPct;
            const tickColor      = isMajor
              ? '#FFFFFF'
              : withinProgress
              ? GOLD
              : 'rgba(255,255,255,0.1)';
            return (
              <Line
                key={i}
                x1={CX + r1 * Math.cos(angle)}
                y1={CY + r1 * Math.sin(angle)}
                x2={CX + r2 * Math.cos(angle)}
                y2={CY + r2 * Math.sin(angle)}
                stroke={tickColor}
                strokeWidth={isMajor ? 1.5 : 1}
                strokeLinecap="round"
              />
            );
          })}

          {/* Track */}
          <Circle
            cx={CX} cy={CY} r={RING_R}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={STROKE}
          />

          {/* Progress arc */}
          <Circle
            cx={CX} cy={CY} r={RING_R}
            fill="none"
            stroke="url(#cpr-grad)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference(RING_R)}
            strokeDashoffset={strokeDashoffset(RING_R, xpPct)}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        </Svg>

        {/* Center: P1, P2… */}
        <View style={styles.center}>
          <Text style={styles.phase}>P{levelNumber}</Text>
          <Text style={styles.phaseLabel}>{levelName.toUpperCase()}</Text>
        </View>
      </View>

      {/* XP row */}
      <View style={styles.xpRow}>
        <Text style={styles.xpVal}>{xp.toLocaleString()}</Text>
        <Text style={styles.xpMax}>/ {xpMax.toLocaleString()} XP</Text>
      </View>

      {/* Three metrics side by side */}
      <View style={styles.metricsRow}>
        {metrics.map((m) => (
          <View key={m.gradId} style={styles.metricCol}>
            {m.iconLib === 'material-community'
              ? <MaterialCommunityIcons name={m.icon as any} size={16} color={m.colour} />
              : <Ionicons name={m.icon as any} size={16} color={m.colour} />
            }
            <Text style={[styles.metricVal, { color: m.colour }]}>{m.value}</Text>
            <Text style={styles.metricMax}>/{m.max}</Text>
            <View style={styles.barWrap}>
              <View style={[styles.bar, { width: `${m.pct * 100}%` as any, backgroundColor: m.colour }]} />
            </View>
          </View>
        ))}
      </View>

      {/* Next level hint */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>{nextLevelHint}</Text>
        <View style={[styles.pill, { backgroundColor: pill.bg, borderColor: pill.border }]}>
          <Text style={[styles.pillText, { color: pill.text }]}>{currentLevel.name.toUpperCase()}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    gap: 10,
  },
  ringWrap: {
    width: SIZE,
    height: SIZE,
    position: 'relative',
    alignSelf: 'center',
  },
  center: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  phase: {
    fontSize: 28,
    fontWeight: '100',
    color: '#F2F2F2',
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  phaseLabel: {
    fontSize: 7,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: '#F2F2F2',
    textTransform: 'uppercase',
  },
  xpRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    alignSelf: 'center',
    gap: 3,
  },
  xpVal: {
    fontSize: 16,
    fontWeight: '200',
    color: GOLD,
  },
  xpMax: {
    fontSize: 10,
    fontWeight: '300',
    color: '#F2F2F2',
  },
  metricsRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: 8,
  },
  metricCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  metricVal: {
    fontSize: 13,
    fontWeight: '300',
  },
  metricMax: {
    fontSize: 9,
    fontWeight: '300',
    color: '#F2F2F2',
  },
  barWrap: {
    alignSelf: 'stretch',
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: 'rgba(135,135,135,0.07)',
    alignSelf: 'stretch',
  },
  footerText: {
    fontSize: 9,
    fontWeight: '300',
    color: '#F2F2F2',
  },
  pill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  pillText: {
    fontSize: 8,
    fontWeight: '400',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
