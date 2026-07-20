import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TimeStepper } from '@/components/progress/TimeStepper';
import { type useWalkingProgress } from '@/hooks/useWalkingProgress';
import {
    fetchMonthlyActivityData,
    fetchRecentWalkingHistory,
    fetchTodayActivityDetail,
    fetchWeekActivityData,
    fetchWeeklyStepsPerDay,
    type DailyWalkingHistory,
    type MonthlyActivityData,
    type TodayActivityDetail,
    type WeekActivityData,
} from '@/lib/api/activity';
import { dayAnchor, monthAnchorEnd, weekAnchorMonday } from '@/lib/progressLookback';

// ─── Design tokens (match progress.tsx) ──────────────────────────────────────

const GREEN  = '#4ade80';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';
const GOLD   = '#E8D200';

const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

// ─── Pill Toggle ─────────────────────────────────────────────────────────────

type Period = 'D' | 'W' | 'M';
const PERIODS: Period[] = ['D', 'W', 'M'];

function PillToggle({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <View style={styles.pillRow}>
      {PERIODS.map(p => {
        const active = p === value;
        return (
          <Pressable
            key={p}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onChange(p)}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{p}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function formatSteps(steps: number): string {
  return steps >= 1000 ? `${(steps / 1000).toFixed(1)}k` : String(steps);
}

// ─── Health-access hint ──────────────────────────────────────────────────────
// The one-line insight under today's steps. When health access is missing it
// becomes a tappable re-prime: "connected" in our records doesn't guarantee the
// OS grant still exists (Health Connect toggles can be off after a reinstall),
// so the fix must be one tap away from where the gap is noticed.

function HealthAccessHint({
  walking, steps, remaining,
}: {
  walking: ReturnType<typeof useWalkingProgress>;
  steps: number;
  remaining: number;
}) {
  if (!walking.isAuthorized) {
    return (
      <Pressable
        style={styles.insightRow}
        disabled={walking.requesting}
        onPress={() => walking.requestPermissions().then(ok => { if (ok) walking.refresh(); })}
      >
        <Ionicons name="alert-circle" size={12} color={GOLD} />
        <Text style={[styles.insightText, styles.insightAction]}>
          {walking.requesting ? 'Requesting Health access…' : 'Enable Health access to track steps'}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.insightRow}>
      <Ionicons name={steps > 5000 ? 'trending-up' : 'footsteps'} size={12} color={GREEN} />
      <Text style={styles.insightText}>
        {steps > 0
          ? `${remaining.toLocaleString()} steps to today's goal`
          : "Start moving to track today's steps"}
      </Text>
    </View>
  );
}

// ─── Day View ────────────────────────────────────────────────────────────────

function MovementDayView({ walking, offset }: { walking: ReturnType<typeof useWalkingProgress>; offset: number }) {
  const isToday = offset === 0;
  const [pastDay, setPastDay] = useState<TodayActivityDetail | null>(null);

  useEffect(() => {
    if (offset === 0) { setPastDay(null); return; }
    let cancelled = false;
    fetchTodayActivityDetail('walking', dayAnchor(offset))
      .then(r => { if (!cancelled) setPastDay(r); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [offset]);

  // stepsToday already falls back to the day's synced session (Terra top-up /
  // earlier sync) when the live health read is unavailable — show it even when
  // health access is currently unauthorized.
  const daySteps = isToday ? (walking.stepsToday ?? 0) : (pastDay?.steps ?? 0);
  const dayPoints = isToday ? walking.pointsEarned : (pastDay?.totalPoints ?? 0);
  const dayPct = Math.min(daySteps / 10000, 1);
  const remaining = Math.max(0, 10000 - daySteps);

  const [history, setHistory] = useState<DailyWalkingHistory[]>([]);

  useEffect(() => {
    fetchRecentWalkingHistory(5, offset === 0 ? undefined : dayAnchor(offset)).then(setHistory).catch(() => {});
  }, [offset]);

  return (
    <View style={styles.tabPanel}>
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>{isToday ? "TODAY'S STEPS" : 'STEPS'}</Text>
          <Text style={[styles.bigMetricVal, { color: GREEN }]}>
            {daySteps > 0 ? daySteps.toLocaleString() : '—'}
          </Text>
          <Text style={styles.bigMetricMax}>/ 10,000 goal</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(dayPct * 100)}%` as any, backgroundColor: GREEN }]} />
          </View>
        </View>
        <View style={styles.bigMetricDivider} />
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>POWR EARNED</Text>
          <Text style={[styles.bigMetricVal, { color: GOLD }]}>
            {dayPoints > 0 ? dayPoints : '—'}
          </Text>
          <Text style={styles.bigMetricMax}>{isToday ? 'today' : 'this day'}</Text>
        </View>
      </View>

      {isToday && walking.nextThreshold && (
        <>
          <View style={styles.tabSep} />
          <View style={styles.nextTierRow}>
            <Ionicons name="trending-up" size={12} color={GREEN} />
            <Text style={styles.nextTierText}>
              {walking.stepsToNext.toLocaleString()} steps to next tier ({walking.nextThreshold.toLocaleString()})
            </Text>
          </View>
        </>
      )}

      {isToday && (
        <HealthAccessHint walking={walking} steps={daySteps} remaining={remaining} />
      )}

      {history.length > 0 && (
        <>
          <View style={styles.tabSep} />
          <Text style={styles.tabSubLabel}>{isToday ? 'PAST 5 DAYS' : 'PREVIOUS DAYS'}</Text>
          {history.map((day) => {
            const d = new Date(day.date + 'T00:00:00');
            const dayName = d.toLocaleDateString('en-GB', { weekday: 'short' });
            const dayNum = d.getDate();
            const pct = Math.min(day.steps / 10000, 1);
            const hasData = day.steps > 0;
            return (
              <View key={day.date} style={styles.historyRow}>
                <Text style={styles.historyDayLabel}>{dayName} {dayNum}</Text>
                <View style={styles.historyBarWrap}>
                  {hasData && (
                    <View style={[styles.historyBarFill, { width: `${Math.round(pct * 100)}%` as any }]} />
                  )}
                </View>
                  <Text style={[styles.historySteps, !hasData && { color: MUTED }]} numberOfLines={1}>
                    {hasData ? formatSteps(day.steps) : '—'}
                </Text>
                  <Text style={[styles.historyPoints, !hasData && { color: MUTED }]} numberOfLines={1}>
                    {hasData && day.points > 0 ? `${day.points}pt` : '—'}
                </Text>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

// ─── Week View ───────────────────────────────────────────────────────────────

function MovementWeekView({
  walking, totalSteps, stepsF, weekActiveDays, offset,
}: {
  walking: ReturnType<typeof useWalkingProgress>;
  totalSteps: number;
  stepsF: string;
  weekActiveDays: boolean[];
  offset: number;
}) {
  const isCurrent  = offset === 0;
  const todaySteps = walking.stepsToday ?? 0;
  const todayPct   = Math.min(todaySteps / 10000, 1);
  const remaining  = Math.max(0, 10000 - todaySteps);

  const [weekSteps, setWeekSteps] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [pastWeek, setPastWeek] = useState<WeekActivityData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWeekSteps([0, 0, 0, 0, 0, 0, 0]);
    setPastWeek(null);
    if (offset === 0) {
      fetchWeeklyStepsPerDay().then(s => { if (!cancelled) setWeekSteps(s); }).catch(() => {});
    } else {
      fetchWeekActivityData('walking', weekAnchorMonday(offset))
        .then(d => { if (!cancelled) { setWeekSteps(d.stepsPerDay); setPastWeek(d); } })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [offset]);

  // Sync today's live step count into the fetched array (current week only)
  const displaySteps = weekSteps.map((s, i) =>
    isCurrent && i === TODAY_INDEX ? Math.max(s, todaySteps) : s
  );

  const weekTotal = isCurrent ? totalSteps : displaySteps.reduce((sum, s) => sum + s, 0);
  const weeklyPct = Math.min(weekTotal / 70000, 1);

  const maxSteps = Math.max(...displaySteps, 1);
  const bestIdx  = displaySteps.indexOf(Math.max(...displaySteps));
  const hasBest  = displaySteps[bestIdx] > 0;

  return (
    <View style={styles.tabPanel}>
      <View style={styles.bigMetricRow}>
        {isCurrent ? (
          <View style={styles.bigMetric}>
            <Text style={styles.bigMetricSup}>TODAY</Text>
            <Text style={[styles.bigMetricVal, { color: GREEN }]}>
              {todaySteps > 0 ? todaySteps.toLocaleString() : '—'}
            </Text>
            <Text style={styles.bigMetricMax}>/ 10,000 steps</Text>
            <View style={styles.metricBar}>
              <View style={[styles.metricBarFill, { width: `${Math.round(todayPct * 100)}%` as any, backgroundColor: GREEN }]} />
            </View>
          </View>
        ) : (
          <View style={styles.bigMetric}>
            <Text style={styles.bigMetricSup}>POWR EARNED</Text>
            <Text style={[styles.bigMetricVal, { color: GOLD }]}>
              {(pastWeek?.points ?? 0) > 0 ? pastWeek!.points : '—'}
            </Text>
            <Text style={styles.bigMetricMax}>from that week</Text>
          </View>
        )}
        <View style={styles.bigMetricDivider} />
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>{isCurrent ? 'THIS WEEK' : 'WEEK TOTAL'}</Text>
          <Text style={[styles.bigMetricVal, { color: GREEN }]}>
            {isCurrent ? stepsF : weekTotal > 0 ? formatSteps(weekTotal) : '—'}
          </Text>
          <Text style={styles.bigMetricMax}>/ 70k goal</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(weeklyPct * 100)}%` as any, backgroundColor: GREEN }]} />
          </View>
        </View>
      </View>

      <View style={styles.tabSep} />

      <Text style={styles.tabSubLabel}>{isCurrent ? 'THIS WEEK' : 'DAY BY DAY'}</Text>
      <View style={styles.weekBarChart}>
        {DAY_LABELS.map((day, i) => {
          const steps   = displaySteps[i];
          const isToday = isCurrent && i === TODAY_INDEX;
          const isBest  = hasBest && i === bestIdx;
          const isFuture = isCurrent && i > TODAY_INDEX;
          const barPct  = isFuture ? 0 : Math.max(steps / maxSteps, steps > 0 ? 0.04 : 0);
          const barColor = isBest ? GOLD : isToday ? GREEN : `${GREEN}80`;
          return (
            <View key={i} style={styles.weekBarCol}>
              <View style={styles.weekBarTrack}>
                {!isFuture && barPct > 0 && (
                  <View style={[
                    styles.weekBarFill,
                    { height: `${Math.round(barPct * 100)}%` as any, backgroundColor: barColor },
                  ]} />
                )}
              </View>
              <Text style={[styles.weekBarLabel, isToday && { color: TEXT, fontWeight: '600' }]}>
                {day.charAt(0)}
              </Text>
              {steps > 0 && !isFuture && (
                <Text style={[styles.weekBarSteps, isBest && { color: GOLD }]}>
                  {formatSteps(steps)}
                </Text>
              )}
            </View>
          );
        })}
      </View>

      {hasBest && (
        <View style={styles.insightRow}>
          <Ionicons name="trophy-outline" size={12} color={GOLD} />
          <Text style={styles.insightText}>
            Best day: {DAY_LABELS[bestIdx]} — {displaySteps[bestIdx].toLocaleString()} steps
          </Text>
        </View>
      )}

      {isCurrent && (
        <HealthAccessHint walking={walking} steps={todaySteps} remaining={remaining} />
      )}
    </View>
  );
}

// ─── Month View ──────────────────────────────────────────────────────────────

const HEATMAP_COLORS = [
  'rgba(74,222,128,0.06)',   // no data
  'rgba(74,222,128,0.15)',   // < 2k
  'rgba(74,222,128,0.30)',   // 2k-4k
  'rgba(74,222,128,0.50)',   // 4k-6k
  'rgba(74,222,128,0.75)',   // 6k-8k
  '#4ade80',                 // >= 8k+
];

function heatmapColor(steps: number): string {
  if (steps <= 0)    return HEATMAP_COLORS[0];
  if (steps < 2000)  return HEATMAP_COLORS[1];
  if (steps < 4000)  return HEATMAP_COLORS[2];
  if (steps < 6000)  return HEATMAP_COLORS[3];
  if (steps < 8000)  return HEATMAP_COLORS[4];
  return HEATMAP_COLORS[5];
}

function MovementMonthView({ data }: { data: MonthlyActivityData | null }) {
  if (!data) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="footsteps-outline" size={28} color={MUTED} />
        <Text style={styles.emptyText}>Loading monthly walking data...</Text>
      </View>
    );
  }

  const hasData = data.entries.some(e => (e.steps ?? 0) > 0);

  if (!hasData) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="footsteps-outline" size={28} color={MUTED} />
        <Text style={styles.emptyText}>No walking data in the last 30 days.</Text>
        <Text style={styles.emptySubtext}>Steps will appear once synced from Health.</Text>
      </View>
    );
  }

  // Build heatmap grid (same pattern as SleepMonthView)
  const firstDate = new Date(data.entries[0].date + 'T00:00:00');
  const firstDay = firstDate.getDay();
  const mondayOffset = firstDay === 0 ? -6 : 1 - firstDay;
  const gridStart = new Date(firstDate);
  gridStart.setDate(gridStart.getDate() + mondayOffset);

  const lookup = new Map<string, number>();
  for (const e of data.entries) lookup.set(e.date, e.steps ?? 0);

  const rows: { date: string; steps: number; inRange: boolean }[][] = [];
  let cursor = new Date(gridStart);
  const lastEntry = new Date(data.entries[data.entries.length - 1].date + 'T00:00:00');

  while (cursor <= lastEntry) {
    const row: { date: string; steps: number; inRange: boolean }[] = [];
    for (let col = 0; col < 7; col++) {
      const dateKey = cursor.toISOString().split('T')[0];
      const inRange = lookup.has(dateKey);
      row.push({ date: dateKey, steps: lookup.get(dateKey) ?? 0, inRange });
      cursor.setDate(cursor.getDate() + 1);
    }
    rows.push(row);
    if (rows.length > 6) break;
  }

  return (
    <View style={[styles.tabPanel, { gap: 10 }]}>
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>AVG STEPS / DAY</Text>
          <Text style={[styles.bigMetricVal, { color: GREEN, fontSize: 30, lineHeight: 32 }]}>
            {data.avgPerDay > 0 ? formatSteps(data.avgPerDay) : '—'}
          </Text>
          <Text style={styles.bigMetricMax}>/ 10k goal</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(Math.min(data.avgPerDay / 10000, 1) * 100)}%` as any, backgroundColor: GREEN }]} />
          </View>
        </View>
        <View style={styles.bigMetricDivider} />
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>BEST DAY</Text>
          <Text style={[styles.bigMetricVal, { color: GREEN, fontSize: 30, lineHeight: 32 }]}>
            {data.bestDay ? formatSteps(data.bestDay.steps ?? 0) : '—'}
          </Text>
          <Text style={styles.bigMetricMax}>
            {data.bestDay ? formatShortDate(data.bestDay.date) : ''}
          </Text>
        </View>
      </View>

      <View style={styles.tabSep} />

      <Text style={styles.tabSubLabel}>30-DAY STEPS</Text>

      <View style={styles.heatmapRow}>
        {DAY_LABELS.map(d => (
          <View key={d} style={styles.heatmapCellCompact}>
            <Text style={styles.heatmapHeaderText}>{d.charAt(0)}</Text>
          </View>
        ))}
      </View>

      {rows.map((row, ri) => (
        <View key={ri} style={styles.heatmapRow}>
          {row.map((cell, ci) => (
            <View key={ci} style={styles.heatmapCellCompact}>
              {cell.inRange ? (
                <View style={[styles.heatmapDot, { backgroundColor: heatmapColor(cell.steps) }]} />
              ) : (
                <View style={[styles.heatmapDot, { backgroundColor: 'transparent' }]} />
              )}
            </View>
          ))}
        </View>
      ))}

      <View style={styles.heatmapLegend}>
        <Text style={styles.heatmapLegendLabel}>Less</Text>
        {HEATMAP_COLORS.map((c, i) => (
          <View key={i} style={[styles.heatmapLegendDot, { backgroundColor: c }]} />
        ))}
        <Text style={styles.heatmapLegendLabel}>More</Text>
      </View>
    </View>
  );
}

// ─── Main MovementTab ───────────────────────────────────────────────────────

export function MovementTab({
  walking,
  totalSteps,
  stepsF,
  weekActiveDays,
  period,
  onPeriodChange,
  offset,
  onOffsetChange,
}: {
  walking: ReturnType<typeof useWalkingProgress>;
  totalSteps: number;
  stepsF: string;
  weekActiveDays: boolean[];
  period: Period;
  onPeriodChange: (p: Period) => void;
  offset: number;
  onOffsetChange: (offset: number) => void;
}) {
  const [monthData, setMonthData] = useState<MonthlyActivityData | null>(null);
  const [monthLoaded, setMonthLoaded] = useState(false);

  // Reset loaded state when the lookback offset changes
  useEffect(() => {
    setMonthLoaded(false);
    setMonthData(null);
  }, [offset]);

  // Load month data reactively
  useEffect(() => {
    if (period !== 'M' || monthLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchMonthlyActivityData('walking', offset === 0 ? undefined : monthAnchorEnd(offset));
        if (!cancelled) {
          setMonthData(result);
          setMonthLoaded(true);
        }
      } catch (err) {
        console.error('[MovementTab] Error loading month data:', err);
        if (!cancelled) {
          setMonthData(null);
          setMonthLoaded(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [period, monthLoaded, offset]);

  return (
    <View style={styles.tabPanel}>
      <PillToggle value={period} onChange={onPeriodChange} />
      <TimeStepper period={period} offset={offset} onOffsetChange={onOffsetChange} />

      {period === 'D' && (
        <MovementDayView walking={walking} offset={offset} />
      )}
      {period === 'W' && (
        <MovementWeekView
          walking={walking}
          totalSteps={totalSteps}
          stepsF={stepsF}
          weekActiveDays={weekActiveDays}
          offset={offset}
        />
      )}
      {period === 'M' && (
        <MovementMonthView data={monthData} />
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  tabPanel: { gap: 16 },

  // Pill toggle
  pillRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 2,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderRadius: 14,
  },
  pillActive: { backgroundColor: GREEN },
  pillText: {
    fontSize: 10, fontWeight: '600', color: MUTED,
  },
  pillTextActive: { color: '#fff' },

  // Empty state
  emptyState: {
    alignItems: 'center', gap: 8, paddingVertical: 28,
  },
  emptyText: {
    fontSize: 13, fontWeight: '400', color: DIM,
  },
  emptySubtext: {
    fontSize: 11, fontWeight: '300', color: MUTED, textAlign: 'center',
  },

  // Big metric pair
  bigMetricRow: {
    flexDirection: 'row', alignItems: 'flex-start',
  },
  bigMetric: {
    flex: 1, alignItems: 'center', gap: 3,
  },
  bigMetricDivider: {
    width: 1, height: 72,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginHorizontal: 14, alignSelf: 'center',
  },
  bigMetricSup: {
    fontSize: 8, fontWeight: '500', letterSpacing: 1.5,
    color: MUTED, textTransform: 'uppercase', marginBottom: 2,
  },
  bigMetricVal: {
    fontSize: 44, fontWeight: '100', letterSpacing: -1.5, lineHeight: 46,
  },
  bigMetricMax: {
    fontSize: 10, fontWeight: '300', color: MUTED,
  },
  metricBar: {
    alignSelf: 'stretch', height: 2,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 1, overflow: 'hidden', marginTop: 6,
  },
  metricBarFill: { height: '100%', borderRadius: 1 },

  tabSep: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  tabSubLabel: {
    fontSize: 8, fontWeight: '500', letterSpacing: 1.5,
    color: MUTED, textTransform: 'uppercase',
  },

  // Day strip
  dayStrip: {
    flexDirection: 'row', justifyContent: 'space-between',
  },
  dayStripCol: { alignItems: 'center', gap: 6 },
  dayStripDot: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  dayStripTodayDot: {
    width: 5, height: 5, borderRadius: 3, backgroundColor: TEXT,
  },
  dayStripLabel: {
    fontSize: 9, fontWeight: '400', color: MUTED,
  },

  // Next tier row (day view)
  nextTierRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
  },
  nextTierText: {
    fontSize: 11, fontWeight: '300', color: DIM, flex: 1,
  },

  // Month heatmap
  heatmapRow: {
    flexDirection: 'row', gap: 4,
  },
  heatmapCell: {
    flex: 1, aspectRatio: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  heatmapCellCompact: {
    flex: 1, height: 26,
    alignItems: 'center', justifyContent: 'center',
  },
  heatmapHeaderText: {
    fontSize: 9, fontWeight: '400', color: MUTED,
  },
  heatmapDot: {
    width: '100%', height: '100%', borderRadius: 4,
  },
  heatmapLegend: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, marginTop: 4,
  },
  heatmapLegendDot: {
    width: 10, height: 10, borderRadius: 2,
  },
  heatmapLegendLabel: {
    fontSize: 9, fontWeight: '400', color: MUTED,
  },

  // Insight
  insightRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  insightText: { fontSize: 12, fontWeight: '300', color: MUTED, flex: 1 },
  insightAction: { color: GOLD, fontWeight: '500', textDecorationLine: 'underline' },

  // Week bar chart
  weekBarChart: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 72,
  },
  weekBarCol: {
    flex: 1, alignItems: 'center', gap: 4,
  },
  weekBarTrack: {
    flex: 1, width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 4, overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  weekBarFill: {
    width: '100%', borderRadius: 4,
  },
  weekBarLabel: {
    fontSize: 9, fontWeight: '400', color: MUTED,
  },
  weekBarSteps: {
    fontSize: 8, fontWeight: '500', color: DIM,
  },

  // 5-day history (day view)
  historyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3,
  },
  historyDayLabel: {
    fontSize: 11, fontWeight: '400', color: DIM, width: 44,
  },
  historyBarWrap: {
    flex: 1, height: 3,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 2, overflow: 'hidden',
  },
  historyBarFill: {
    height: '100%', backgroundColor: GREEN, borderRadius: 2,
  },
  historySteps: {
    fontSize: 11, fontWeight: '500', color: TEXT, width: 44, textAlign: 'right',
  },
  historyPoints: {
    fontSize: 10, fontWeight: '600', color: GOLD, width: 34, textAlign: 'right',
  },
});
