import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { ACTIVITIES } from '@/constants/activities';

const GOLD   = '#E8D200';
const ORANGE = '#f97316';
const GREEN  = '#4ade80';

const SIZE   = 240;
const SVG_W  = SIZE + 60;          // extra horizontal room for values
const PAD    = 30;                  // horizontal padding each side
const CX     = SVG_W / 2;
const CY     = SIZE / 2;
const RING_R = 65;
const STROKE = 8;

const TICK_COUNT    = 60;
const TICK_OUTER_R  = RING_R - STROKE / 2 + 1;   // just touching inner edge
const TICK_INNER_R  = RING_R - STROKE / 2 - 4;    // 5px tick length
const TICK_WIDTH    = 1;
const GLOW_R1       = TICK_INNER_R - 12;           // first glow layer
const GLOW_R2       = TICK_INNER_R - 24;           // second glow layer

function circumference(r: number) {
  return 2 * Math.PI * r;
}

function strokeDashoffset(r: number, pct: number) {
  const c = circumference(r);
  return c - pct * c;
}

function lerpColor(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}

function gradientColor(pct: number): string {
  if (pct <= 0.5) return lerpColor(GOLD, ORANGE, pct / 0.5);
  return lerpColor(ORANGE, GREEN, (pct - 0.5) / 0.5);
}

export interface ArmMetric {
  label: string;
  value: string | number;
  /** If true, renders label + value in gold to signal week completion */
  completed?: boolean;
}

export interface TickOverlayData {
  dayNum: number;
  types: string[];
  isFuture: boolean;
  ringScreenX: number;
  ringScreenY: number;
  ringHeight: number;
  ringSvgWidth: number;
}

interface CombinedProgressRingProps {
  /** Active days logged so far this month */
  activeDays: number;
  /** Number of days elapsed in the current month (today's date, 1-based) */
  daysElapsed: number;
  /** Total days in the current month (28-31) */
  daysInMonth: number;
  /** Map of day-of-month (1-based) → activity types logged that day, most-done first */
  activeDayTypes: Record<number, string[]>;
  /** Current month name, e.g. "APRIL" */
  monthlyLabel: string;
  /** [top-left, top-right, bottom-right, bottom-left] — weekly quarters */
  armMetrics?: [ArmMetric, ArmMetric, ArmMetric, ArmMetric];
  /** Called when the user's finger moves over a tick. Null when released. */
  onTickActive?: (data: TickOverlayData | null) => void;
}

export function CombinedProgressRing({
  activeDays,
  daysElapsed,
  daysInMonth,
  activeDayTypes,
  monthlyLabel,
  armMetrics = [
    { label: 'WEEK 1', value: '0/7' },
    { label: 'WEEK 2', value: '0/7' },
    { label: 'WEEK 3', value: '0/7' },
    { label: 'WEEK 4', value: '0/7' },
  ],
  onTickActive,
}: CombinedProgressRingProps) {
  // Arc fill = days elapsed out of the full month ("how far through the month")
  const pct = Math.min(Math.max(daysElapsed / Math.max(daysInMonth, 1), 0), 1);

  const RING_OUTER = RING_R + STROKE / 2;

  // ─── Interactive tick state ─────────────────────────────────────────────
  const [activeTick, setActiveTick] = useState<number | null>(null);
  const ringRef = useRef<View>(null);
  const ringScreenPosRef = useRef({ x: 0, y: 0 });
  // Keep latest callback in a ref so panResponder doesn't need to rebuild
  const onTickActiveRef = useRef(onTickActive);
  onTickActiveRef.current = onTickActive;

  const updateActiveTick = useCallback((lx: number, ly: number) => {
    const dx = lx - CX;
    const dy = ly - CY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < RING_R - STROKE / 2 - 20 || dist > RING_R + STROKE / 2 + 20) {
      setActiveTick(null);
      onTickActiveRef.current?.(null);
      return;
    }
    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
    const normalized = ((angleDeg + 135) % 360 + 360) % 360;
    const idx = Math.round((normalized / 360) * daysInMonth) % daysInMonth;
    const clamped = Math.max(0, Math.min(daysInMonth - 1, idx));
    setActiveTick(clamped);
    const dayNum = clamped + 1;
    onTickActiveRef.current?.({
      dayNum,
      types: activeDayTypes[dayNum] ?? [],
      isFuture: dayNum > daysElapsed,
      ringScreenX: ringScreenPosRef.current.x,
      ringScreenY: ringScreenPosRef.current.y,
      ringHeight: SIZE,
      ringSvgWidth: SVG_W,
    });
  }, [daysInMonth, activeDayTypes, daysElapsed]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (evt) => {
      const dx = evt.nativeEvent.locationX - CX;
      const dy = evt.nativeEvent.locationY - CY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return Math.abs(dist - RING_R) < 28;
    },
    onMoveShouldSetPanResponder: () => false,
    onPanResponderGrant: (evt) => {
      const { locationX, locationY } = evt.nativeEvent;
      ringRef.current?.measureInWindow((x, y) => {
        ringScreenPosRef.current = { x, y };
        updateActiveTick(locationX, locationY);
      });
    },
    onPanResponderMove: (evt) => {
      updateActiveTick(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
    },
    onPanResponderRelease: () => {
      setActiveTick(null);
      onTickActiveRef.current?.(null);
    },
    onPanResponderTerminate: () => {
      setActiveTick(null);
      onTickActiveRef.current?.(null);
    },
  }), [updateActiveTick]);

  return (
    <View style={styles.card}>
      {/* Ring — centered */}
      <View style={styles.ringSection}>
        <View ref={ringRef} style={styles.ringWrap} {...panResponder.panHandlers}>
          <Svg width={SVG_W} height={SIZE} viewBox={`0 0 ${SVG_W} ${SIZE}`}>
            <Defs>
              <LinearGradient id="cpr-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%"   stopColor={GOLD}   />
                <Stop offset="50%"  stopColor={ORANGE} />
                <Stop offset="100%" stopColor={GREEN}  />
              </LinearGradient>
            </Defs>

            {/* Wings — angled line from circle to elbow, then horizontal tail + metric */}
            {([
              { deg: -135, metric: armMetrics[0] },
              { deg: -45,  metric: armMetrics[1] },
              { deg: 45,   metric: armMetrics[2] },
              { deg: 135,  metric: armMetrics[3] },
            ] as const).map(({ deg, metric }) => {
              const elbowR = 104;
              const angle = deg * (Math.PI / 180);
              const sx = CX + RING_OUTER * Math.cos(angle);
              const sy = CY + RING_OUTER * Math.sin(angle);
              const ex = CX + elbowR * Math.cos(angle);
              const ey = CY + elbowR * Math.sin(angle);

              const isRight = deg === -45 || deg === 45;
              const anchor = isRight ? 'end' : 'start';
              const tailX = isRight ? SVG_W - PAD : PAD;
              const labelX = isRight ? tailX - 2 : tailX + 2;
              const valueX = isRight ? SVG_W - 3 : 3;
              const valueAnchor = isRight ? 'end' : 'start';

              const wingStroke = metric.completed ? GOLD : "rgba(255,255,255,0.2)";
              const labelFill = metric.completed ? GOLD : "rgba(255,255,255,0.4)";
              const valueFill = metric.completed ? GOLD : "#FFFFFF";

              return (
                <React.Fragment key={`wing-${deg}`}>
                  <Line x1={sx} y1={sy} x2={ex} y2={ey}
                    stroke={wingStroke} strokeWidth={1.5} strokeLinecap="round" />
                  <Line x1={ex} y1={ey} x2={tailX} y2={ey}
                    stroke={wingStroke} strokeWidth={1.5} strokeLinecap="round" />
                  <SvgText
                    x={labelX} y={ey - 6}
                    fill={labelFill}
                    fontSize={7}
                    fontWeight={metric.completed ? '600' : '400'}
                    textAnchor={anchor}
                    letterSpacing={1}
                  >
                    {metric.label}
                  </SvgText>
                  <SvgText
                    x={valueX} y={ey + 4}
                    fill={valueFill}
                    fontSize={11}
                    fontWeight={metric.completed ? '700' : '500'}
                    textAnchor={valueAnchor}
                  >
                    {String(metric.value)}
                  </SvgText>
                </React.Fragment>
              );
            })}

            {/* Inner tick marks — one per day of the month */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dayNum = i + 1; // 1-based
              const tickPct = i / daysInMonth;
              const angleDeg = -135 + tickPct * 360;
              const angleRad = angleDeg * (Math.PI / 180);
              const cosA = Math.cos(angleRad);
              const sinA = Math.sin(angleRad);
              const x1 = CX + TICK_INNER_R * cosA;
              const y1 = CY + TICK_INNER_R * sinA;
              const x2 = CX + TICK_OUTER_R * cosA;
              const y2 = CY + TICK_OUTER_R * sinA;

              const types = activeDayTypes[dayNum] ?? [];
              const isActive = types.length > 0;
              const isMissed = !isActive && dayNum < daysElapsed;
              const isHighlighted = activeTick === i;
              const isDimmed = activeTick !== null && !isHighlighted;

              // One colour per natural band, falling back to first type
              const col = (n: number) => {
                const t = types[n] ?? types[0];
                return t
                  ? (ACTIVITIES[t as keyof typeof ACTIVITIES]?.colour ?? gradientColor(tickPct))
                  : gradientColor(tickPct);
              };

              // Highlighted tick — bright white, slightly longer
              if (isHighlighted) {
                const x1h = CX + (TICK_INNER_R - 3) * cosA;
                const y1h = CY + (TICK_INNER_R - 3) * sinA;
                const x2h = CX + (TICK_OUTER_R + 3) * cosA;
                const y2h = CY + (TICK_OUTER_R + 3) * sinA;
                return (
                  <React.Fragment key={`tick-${i}`}>
                    <Line x1={x1h} y1={y1h} x2={x2h} y2={y2h}
                      stroke="#FFFFFF" strokeWidth={2.5} opacity={1}
                      strokeLinecap="round" />
                  </React.Fragment>
                );
              }

              return (
                <React.Fragment key={`tick-${i}`}>
                  {isActive && (
                    <>
                      {/* Deep inner glow — type[2] colour */}
                      <Line
                        x1={CX + GLOW_R2 * cosA} y1={CY + GLOW_R2 * sinA}
                        x2={CX + GLOW_R1 * cosA} y2={CY + GLOW_R1 * sinA}
                        stroke={col(2)} strokeWidth={TICK_WIDTH * 2}
                        opacity={isDimmed ? 0.04 : 0.12}
                      />
                      {/* Inner glow — type[1] colour */}
                      <Line
                        x1={CX + GLOW_R1 * cosA} y1={CY + GLOW_R1 * sinA}
                        x2={x1} y2={y1}
                        stroke={col(1)} strokeWidth={TICK_WIDTH * 2}
                        opacity={isDimmed ? 0.08 : 0.25}
                      />
                      {/* Main tick — type[0] colour (most done) */}
                      <Line
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke={col(0)}
                        strokeWidth={TICK_WIDTH * 1.5}
                        opacity={isDimmed ? 0.2 : 0.95}
                      />
                    </>
                  )}
                  {!isActive && (
                    <Line
                      x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={isMissed ? 'rgba(239,68,68,0.35)' : 'rgba(255,255,255,0.06)'}
                      strokeWidth={TICK_WIDTH}
                      opacity={isDimmed ? 0.3 : 1}
                    />
                  )}
                </React.Fragment>
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
              strokeDashoffset={strokeDashoffset(RING_R, pct)}
              transform={`rotate(-135 ${CX} ${CY})`}
            />
          </Svg>

          {/* Center: active days this month */}
          <View style={styles.center}>
            <View style={styles.centerRow}>
              <Text style={styles.pctNumber}>{activeDays}</Text>
              <Text style={styles.pctSign}>/{daysElapsed}</Text>
            </View>
            <Text style={styles.pctLabel}>DAYS ACTIVE</Text>
          </View>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>{activeDays === 0 ? 'No activity logged yet this month' : `${activeDays} of ${daysElapsed} days active`}</Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{monthlyLabel}</Text>
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
  ringSection: {
    alignItems: 'center',
    gap: 4,
  },
  ringWrap: {
    width: SIZE + 60,
    height: SIZE,
    position: 'relative',
  },
  center: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 1,
  },
  pctNumber: {
    fontSize: 36,
    fontWeight: '100',
    fontStyle: 'italic',
    color: '#F2F2F2',
    letterSpacing: -1,
    lineHeight: 40,
  },
  pctSign: {
    fontSize: 16,
    fontWeight: '200',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: -0.5,
    lineHeight: 40,
  },
  pctLabel: {
    fontSize: 6,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
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
    borderColor: 'rgba(232,210,0,0.3)',
    backgroundColor: 'rgba(232,210,0,0.06)',
  },
  pillText: {
    fontSize: 8,
    fontWeight: '400',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: GOLD,
  },
});
