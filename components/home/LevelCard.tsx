import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import type { LevelDef } from '@/constants/levels';

const GOLD = '#E8D200';
const ORANGE = '#f97316';
const GREEN = '#4ade80';

// Ring geometry
const SIZE = 88;
const CX = SIZE / 2;
const CY = SIZE / 2;
const STROKE = 4;
const RADII = [38, 29, 20] as const; // outer → inner

function ringCircumference(r: number) {
  return 2 * Math.PI * r;
}

function strokeOffset(r: number, pct: number) {
  const c = ringCircumference(r);
  return c - pct * c;
}

interface RingMetric {
  label: string;
  icon: string;
  value: string;
  max: string;
  pct: number; // 0–1
  colour: string;
  gradId: string;
  gradStart: string;
  gradEnd: string;
}

interface LevelCardProps {
  levelNumber: number;
  levelName: string;
  xp: number;
  xpMax: number;
  metrics: [RingMetric, RingMetric, RingMetric];
  nextLevelHint: string;
  currentLevel: LevelDef;
}

export function LevelCard({ levelNumber, levelName, xp, xpMax, metrics, nextLevelHint, currentLevel }: LevelCardProps) {
  const overallPct = Math.min(xp / xpMax, 1);
  const pill = currentLevel.pill;

  return (
    <View style={styles.card}>
      <View style={styles.main}>
        {/* Concentric rings */}
        <View style={styles.ringsWrap}>
          <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <Defs>
              {metrics.map((m) => (
                <LinearGradient key={m.gradId} id={m.gradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <Stop offset="0%" stopColor={m.gradStart} />
                  <Stop offset="100%" stopColor={m.gradEnd} />
                </LinearGradient>
              ))}
            </Defs>

            {RADII.map((r, i) => {
              const m = metrics[i];
              const c = ringCircumference(r);
              return (
                <React.Fragment key={r}>
                  {/* Track */}
                  <Circle
                    cx={CX} cy={CY} r={r}
                    fill="none"
                    stroke="rgba(255,255,255,0.07)"
                    strokeWidth={STROKE}
                  />
                  {/* Progress */}
                  <Circle
                    cx={CX} cy={CY} r={r}
                    fill="none"
                    stroke={`url(#${m.gradId})`}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={strokeOffset(r, m.pct)}
                    transform={`rotate(-90 ${CX} ${CY})`}
                  />
                </React.Fragment>
              );
            })}
          </Svg>

          {/* Center readout */}
          <View style={styles.ringCenter}>
            <Text style={styles.rcPct}>{Math.round(overallPct * 100)}%</Text>
            <Text style={styles.rcSub}>LVL {levelNumber}</Text>
          </View>
        </View>

        {/* Level info */}
        <View style={styles.info}>
          <View style={styles.topRow}>
            <Text style={styles.lvNum}>{levelNumber}</Text>
            <Text style={styles.lvName}>{levelName}</Text>
            <View style={styles.xpBox}>
              <Text style={styles.xpVal}>{xp.toLocaleString()}</Text>
              <Text style={styles.xpMax}>/ {xpMax.toLocaleString()} XP</Text>
            </View>
          </View>

          {/* Legend rows */}
          <View style={styles.legend}>
            {metrics.map((m) => (
              <View key={m.gradId} style={styles.legendRow}>
                <Ionicons
                  name={m.icon as any}
                  size={12}
                  color={m.colour}
                  style={styles.legendIcon}
                />
                <View style={styles.barWrap}>
                  <View style={[styles.bar, { width: `${m.pct * 100}%` as any, backgroundColor: m.colour }]} />
                </View>
                <View style={styles.statBox}>
                  <Text style={[styles.legendVal, { color: m.colour }]}>{m.value}</Text>
                  <Text style={styles.legendMax}>/{m.max}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* Next level hint */}
      <View style={styles.nextLevel}>
        <Text style={styles.nextLevelText}>{nextLevelHint}</Text>
        <View style={[styles.nextLevelBadge, { backgroundColor: pill.bg, borderColor: pill.border }]}>
          <Text style={[styles.nextLevelBadgeText, { color: pill.text }]}>{currentLevel.name.toUpperCase()}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(40,40,40,0.85)',
    padding: 12,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ringsWrap: {
    width: SIZE,
    height: SIZE,
    flexShrink: 0,
    position: 'relative',
  },
  ringCenter: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  rcPct: {
    fontSize: 15,
    fontWeight: '200',
    color: '#F2F2F2',
    lineHeight: 16,
  },
  rcSub: {
    fontSize: 7,
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  lvNum: {
    fontSize: 20,
    fontWeight: '100',
    color: GOLD,
    lineHeight: 20,
  },
  lvName: {
    fontSize: 11,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.5)',
  },
  xpBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginLeft: 'auto',
  },
  xpVal: {
    fontSize: 9,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.75)',
    width: 26,
    textAlign: 'right',
  },
  xpMax: {
    fontSize: 9,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.25)',
    width: 56,
  },
  legend: {
    gap: 7,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendIcon: {
    width: 14,
    flexShrink: 0,
  },
  barWrap: {
    flex: 1,
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 1,
  },
  statBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexShrink: 0,
  },
  legendVal: {
    fontSize: 9,
    fontWeight: '400',
    width: 26,
    textAlign: 'right',
  },
  legendMax: {
    fontSize: 9,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.25)',
    width: 56,
  },
  nextLevel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: 'rgba(135,135,135,0.07)',
  },
  nextLevelText: {
    fontSize: 9,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.5)',
  },
  nextLevelBadge: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  nextLevelBadgeText: {
    fontSize: 8,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
