import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import {
    fetchMonthlyActivityData,
    fetchRecentWorkoutHistory,
    fetchTodayActivityDetail,
    type DailyWorkoutHistory,
    type MonthlyActivityData,
    type TodayActivityDetail,
} from '@/lib/api/activity';

// ─── Design tokens (match progress.tsx) ──────────────────────────────────────

const GOLD   = '#E8D200';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';

const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

// ─── Pill Toggle ─────────────────────────────────────────────────────────────

type Period = 'D' | 'W' | 'M';
const PERIODS: Period[] = ['D', 'W', 'M'];

function PillToggle({ value, onChange, colour }: { value: Period; onChange: (p: Period) => void; colour: string }) {
  return (
    <View style={styles.pillRow}>
      {PERIODS.map(p => {
        const active = p === value;
        return (
          <Pressable
            key={p}
            style={[styles.pill, active && { backgroundColor: colour }]}
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

function formatDuration(mins: number): string {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

// ─── Day View ────────────────────────────────────────────────────────────────

function WorkoutDayView({ type, data }: { type: ActivityType; data: TodayActivityDetail | null }) {
  const config = ACTIVITIES[type];
  const [history, setHistory] = useState<DailyWorkoutHistory[]>([]);

  useEffect(() => {
    fetchRecentWorkoutHistory(type, 5).then(setHistory).catch(() => {});
  }, [type]);

  const hasToday = data && data.sessionCount > 0;
  const hasHistory = history.some(d => d.sessions > 0);

  return (
    <View style={styles.tabPanel}>
      {!hasToday ? (
        <View style={styles.emptyState}>
          <Ionicons name={config.icon as any} size={28} color={MUTED} />
          <Text style={styles.emptyText}>No {config.label.toLowerCase()} session today.</Text>
          <Text style={styles.emptySubtext}>Complete a session to see your daily stats.</Text>
        </View>
      ) : (
        <>
          <View style={styles.bigMetricRow}>
            <View style={styles.bigMetric}>
              <Text style={styles.bigMetricSup}>TODAY'S {config.labelShort.toUpperCase()}</Text>
              <Text style={[styles.bigMetricVal, { color: config.colour }]}>
                {data!.sessionCount}
              </Text>
              <Text style={styles.bigMetricMax}>
                {data!.sessionCount === 1 ? 'session' : 'sessions'} · {formatDuration(data!.totalDurationMin)}
              </Text>
              <View style={styles.metricBar}>
                <View style={[styles.metricBarFill, { width: `${Math.round(Math.min(data!.sessionCount / 1, 1) * 100)}%` as any, backgroundColor: config.colour }]} />
              </View>
            </View>
            <View style={styles.bigMetricDivider} />
            <View style={styles.bigMetric}>
              <Text style={styles.bigMetricSup}>POWR EARNED</Text>
              <Text style={[styles.bigMetricVal, { color: GOLD }]}>
                {data!.totalPoints > 0 ? data!.totalPoints : '—'}
              </Text>
              <Text style={styles.bigMetricMax}>today</Text>
            </View>
          </View>

          <View style={styles.insightRow}>
            <Ionicons name={config.iconActive as any} size={12} color={config.colour} />
            <Text style={[styles.insightText, { color: DIM }]}>
              {data!.totalDurationMin >= 45
                ? `Great ${config.label.toLowerCase()} session today.`
                : `${config.label} session logged — keep the momentum going.`}
            </Text>
          </View>
        </>
      )}

      {hasHistory && (
        <>
          <View style={styles.tabSep} />
          <Text style={styles.tabSubLabel}>RECENT DAYS</Text>
          {history.map((day) => {
            const d = new Date(day.date + 'T00:00:00');
            const dayName = d.toLocaleDateString('en-GB', { weekday: 'short' });
            const dayNum  = d.getDate();
            const hasData = day.sessions > 0;
            return (
              <View key={day.date} style={styles.historyRow}>
                <Text style={styles.historyDayLabel}>{dayName} {dayNum}</Text>
                <View style={styles.historyBarWrap}>
                  {hasData && <View style={[styles.historyBarFill, { backgroundColor: config.colour }]} />}
                </View>
                <Text style={[styles.historyMeta, !hasData && { color: MUTED }]}>
                  {hasData ? `${formatDuration(day.totalDurationMin)} · ${day.sessions}` : '—'}
                </Text>
                <Text style={[styles.historyPoints, !hasData && { color: MUTED }]}>
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

function WorkoutWeekView({
  type, count, weekActiveDays, weeklyEarned,
}: {
  type: ActivityType;
  count: number;
  weekActiveDays: boolean[];
  weeklyEarned: number;
}) {
  const config = ACTIVITIES[type];
  const sessionPct = Math.min(count / 5, 1);
  const capPct = config.dailyCap > 0 ? Math.min(weeklyEarned / (config.dailyCap * 5), 1) : sessionPct;

  // Compute current streak (consecutive active days ending at today)
  let streak = 0;
  for (let i = TODAY_INDEX; i >= 0; i--) {
    if (weekActiveDays[i]) streak++;
    else break;
  }
  const activeDays = weekActiveDays.filter(Boolean).length;

  return (
    <View style={styles.tabPanel}>
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>{config.labelShort.toUpperCase()} SESSIONS</Text>
          <Text style={[styles.bigMetricVal, { color: config.colour }]}>{count}</Text>
          <Text style={styles.bigMetricMax}>/ 5 goal</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(sessionPct * 100)}%` as any, backgroundColor: config.colour }]} />
          </View>
        </View>
        <View style={styles.bigMetricDivider} />
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>POWR EARNED</Text>
          <Text style={[styles.bigMetricVal, { color: GOLD }]}>{weeklyEarned > 0 ? weeklyEarned : '—'}</Text>
          <Text style={styles.bigMetricMax}>from this week</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(capPct * 100)}%` as any, backgroundColor: GOLD }]} />
          </View>
        </View>
      </View>

      <View style={styles.tabSep} />

      <Text style={styles.tabSubLabel}>THIS WEEK</Text>
      <View style={styles.weekBarChart}>
        {DAY_LABELS.map((day, i) => {
          const active   = weekActiveDays[i];
          const isToday  = i === TODAY_INDEX;
          const isFuture = i > TODAY_INDEX;
          const barColor = isToday ? config.colour : `${config.colour}80`;
          return (
            <View key={i} style={styles.weekBarCol}>
              <View style={styles.weekBarTrack}>
                {active && !isFuture && (
                  <View style={[styles.weekBarFill, { height: '100%', backgroundColor: barColor }]} />
                )}
              </View>
              <Text style={[styles.weekBarLabel, isToday && { color: TEXT, fontWeight: '600' }]}>
                {day.charAt(0)}
              </Text>
            </View>
          );
        })}
      </View>

      {streak >= 2 && (
        <View style={styles.insightRow}>
          <Ionicons name="flash" size={12} color={GOLD} />
          <Text style={styles.insightText}>{streak} day streak — keep it going!</Text>
        </View>
      )}

      {activeDays > 0 && streak < 2 && (
        <View style={styles.insightRow}>
          <Ionicons name={config.iconActive as any} size={12} color={config.colour} />
          <Text style={styles.insightText}>{activeDays} day{activeDays !== 1 ? 's' : ''} active this week.</Text>
        </View>
      )}

      <View style={styles.insightRow}>
        <Ionicons
          name={config.iconActive as any}
          size={12}
          color={count >= 3 ? config.colour : MUTED}
        />
        <Text style={[styles.insightText, count >= 3 && { color: DIM }]}>
          {count >= 4
            ? `Outstanding ${config.label.toLowerCase()} week.`
            : count >= 3
            ? 'Solid effort — keep going to hit your goal.'
            : `${5 - count} more sessions to hit your target.`}
        </Text>
      </View>
    </View>
  );
}

// ─── Month View ──────────────────────────────────────────────────────────────

function heatmapColorForType(count: number, colour: string): string {
  if (count <= 0) return 'rgba(255,255,255,0.06)';
  return colour;
}

function WorkoutMonthView({ type, data }: { type: ActivityType; data: MonthlyActivityData | null }) {
  const config = ACTIVITIES[type];

  if (!data) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name={config.icon as any} size={28} color={MUTED} />
        <Text style={styles.emptyText}>Loading monthly data...</Text>
      </View>
    );
  }

  const hasData = data.entries.some(e => e.sessionCount > 0);

  if (!hasData) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name={config.icon as any} size={28} color={MUTED} />
        <Text style={styles.emptyText}>No {config.label.toLowerCase()} sessions in 30 days.</Text>
        <Text style={styles.emptySubtext}>Sessions will appear here once logged.</Text>
      </View>
    );
  }

  // Build heatmap grid
  const firstDate = new Date(data.entries[0].date + 'T00:00:00');
  const firstDay = firstDate.getDay();
  const mondayOffset = firstDay === 0 ? -6 : 1 - firstDay;
  const gridStart = new Date(firstDate);
  gridStart.setDate(gridStart.getDate() + mondayOffset);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const lookup = new Map<string, number>();
  for (const e of data.entries) lookup.set(e.date, e.sessionCount);

  const rows: { date: string; count: number; inRange: boolean }[][] = [];
  let cursor = new Date(gridStart);
  const lastEntry = new Date(data.entries[data.entries.length - 1].date + 'T00:00:00');

  while (cursor <= lastEntry || cursor <= today) {
    const row: { date: string; count: number; inRange: boolean }[] = [];
    for (let col = 0; col < 7; col++) {
      const dateKey = cursor.toISOString().split('T')[0];
      const inRange = lookup.has(dateKey);
      row.push({ date: dateKey, count: lookup.get(dateKey) ?? 0, inRange });
      cursor.setDate(cursor.getDate() + 1);
    }
    rows.push(row);
    if (rows.length > 6) break;
  }

  const activeDays = data.entries.filter(e => e.sessionCount > 0).length;

  return (
    <View style={[styles.tabPanel, { gap: 10 }]}>
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>TOTAL SESSIONS</Text>
          <Text style={[styles.bigMetricVal, { color: config.colour, fontSize: 30, lineHeight: 32 }]}>
            {data.totalSessions}
          </Text>
          <Text style={styles.bigMetricMax}>in 30 days</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(Math.min(data.totalSessions / 20, 1) * 100)}%` as any, backgroundColor: config.colour }]} />
          </View>
        </View>
        <View style={styles.bigMetricDivider} />
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>BEST DAY</Text>
          <Text style={[styles.bigMetricVal, { color: config.colour, fontSize: 30, lineHeight: 32 }]}>
            {data.bestDay ? data.bestDay.sessionCount : '—'}
          </Text>
          <Text style={styles.bigMetricMax}>
            {data.bestDay ? formatShortDate(data.bestDay.date) : ''}
          </Text>
        </View>
      </View>

      <View style={styles.tabSep} />

      <Text style={styles.tabSubLabel}>30-DAY ACTIVITY</Text>

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
                <View style={[styles.heatmapDot, { backgroundColor: heatmapColorForType(cell.count, config.colour) }]} />
              ) : (
                <View style={[styles.heatmapDot, { backgroundColor: 'transparent' }]} />
              )}
            </View>
          ))}
        </View>
      ))}

    </View>
  );
}

// ─── Main WorkoutsTab ───────────────────────────────────────────────────────

export function WorkoutsTab({
  type,
  count,
  weekActiveDays,
  weeklyEarned,
  period,
  onPeriodChange,
}: {
  type: ActivityType;
  count: number;
  weekActiveDays: boolean[];
  weeklyEarned: number;
  period: Period;
  onPeriodChange: (p: Period) => void;
}) {
  const config = ACTIVITIES[type];
  const [dayData, setDayData] = useState<TodayActivityDetail | null>(null);
  const [monthData, setMonthData] = useState<MonthlyActivityData | null>(null);
  const [dayLoaded, setDayLoaded] = useState(false);
  const [monthLoaded, setMonthLoaded] = useState(false);

  // Reset loaded state when type changes
  useEffect(() => {
    setDayLoaded(false);
    setMonthLoaded(false);
    setDayData(null);
    setMonthData(null);
  }, [type]);

  // Load day data reactively
  useEffect(() => {
    if (period !== 'D' || dayLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchTodayActivityDetail(type);
        if (!cancelled) {
          setDayData(result);
          setDayLoaded(true);
        }
      } catch (err) {
        console.error('[WorkoutsTab] Error loading day data:', err);
        if (!cancelled) {
          setDayData(null);
          setDayLoaded(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [period, dayLoaded, type]);

  // Load month data reactively
  useEffect(() => {
    if (period !== 'M' || monthLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchMonthlyActivityData(type);
        if (!cancelled) {
          setMonthData(result);
          setMonthLoaded(true);
        }
      } catch (err) {
        console.error('[WorkoutsTab] Error loading month data:', err);
        if (!cancelled) {
          setMonthData(null);
          setMonthLoaded(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [period, monthLoaded, type]);

  return (
    <View style={styles.tabPanel}>
      <PillToggle value={period} onChange={onPeriodChange} colour={config.colour} />

      {period === 'D' && (
        <WorkoutDayView type={type} data={dayData} />
      )}
      {period === 'W' && (
        <WorkoutWeekView
          type={type}
          count={count}
          weekActiveDays={weekActiveDays}
          weeklyEarned={weeklyEarned}
        />
      )}
      {period === 'M' && (
        <WorkoutMonthView type={type} data={monthData} />
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

  // POWR earned row
  powrRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  powrLeft:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  powrLabel: { fontSize: 10, fontWeight: '500', letterSpacing: 1.2, color: MUTED, textTransform: 'uppercase' },
  powrValue: { fontSize: 16, fontWeight: '200', color: GOLD, letterSpacing: -0.5 },

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
    height: '100%', width: '100%', borderRadius: 2,
  },
  historyMeta: {
    fontSize: 11, fontWeight: '400', color: TEXT, width: 64, textAlign: 'right',
  },
  historyPoints: {
    fontSize: 10, fontWeight: '600', color: GOLD, width: 36, textAlign: 'right',
  },

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
});
