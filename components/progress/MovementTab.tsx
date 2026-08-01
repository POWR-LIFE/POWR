import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DayCaption, addDays } from '@/components/progress/DayCaption';
import { HeatmapLegend, MonthHeatmap } from '@/components/progress/MonthHeatmap';
import PointsBreakdownSheet, { PointsInfoDot } from '@/components/progress/PointsBreakdownSheet';
import { StalePanel } from '@/components/progress/StalePanel';
import { TimeStepper } from '@/components/progress/TimeStepper';
import { useActivityRevision } from '@/hooks/useActivityRevision';
import { type useWalkingProgress } from '@/hooks/useWalkingProgress';
import {
    fetchMonthlyActivityData,
    fetchRecentWalkingHistory,
    fetchTodayActivityDetail,
    fetchWeekActivityData,
    fetchWeeklyStepsPerDay,
    localDateStr,
    type DailyActivityEntry,
    type DailyWalkingHistory,
    type MonthlyActivityData,
    type TodayActivityDetail,
    type WeekActivityData,
} from '@/lib/api/activity';
import { dayAnchor, monthLabel, weekAnchorMonday } from '@/lib/progressLookback';

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
  // isAvailable first, mirroring WalkingProgressCard: with no health platform
  // present (Expo Go, web, Health Connect not installed) requestPermissions()
  // can only return false, so the prompt would be a dead-end tap.
  if (walking.isAvailable && !walking.isAuthorized) {
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

function MovementDayView({ walking, offset, onInfo }: { walking: ReturnType<typeof useWalkingProgress>; offset: number; onInfo: () => void }) {
  const isToday = offset === 0;
  const [pastDay, setPastDay] = useState<TodayActivityDetail | null>(null);
  // Today's figures come from the walking hook, which already reloads on
  // foreground; revision covers the past-day and history reads beside them so
  // the whole panel moves together — see lib/activityRevision.
  const revision = useActivityRevision();

  useEffect(() => {
    if (offset === 0) { setPastDay(null); return; }
    let cancelled = false;
    fetchTodayActivityDetail('walking', dayAnchor(offset))
      .then(r => { if (!cancelled) setPastDay(r); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [offset, revision]);

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
  }, [offset, revision]);

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
          <View style={styles.bigMetricSupRow}>
            <Text style={styles.bigMetricSup}>POWR EARNED</Text>
            <PointsInfoDot onPress={onInfo} label="How you earned this walking POWR" />
          </View>
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
  walking, totalSteps, stepsF, weekActiveDays, offset, onInfo, onSelectDay,
}: {
  walking: ReturnType<typeof useWalkingProgress>;
  totalSteps: number;
  stepsF: string;
  weekActiveDays: boolean[];
  offset: number;
  onInfo: () => void;
  onSelectDay: (day: Date) => void;
}) {
  const isCurrent  = offset === 0;
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => { setSelected(null); }, [offset]);
  const todaySteps = walking.stepsToday ?? 0;
  const todayPct   = Math.min(todaySteps / 10000, 1);
  const remaining  = Math.max(0, 10000 - todaySteps);

  const [weekSteps, setWeekSteps] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [pastWeek, setPastWeek] = useState<WeekActivityData | null>(null);
  const [weekLoaded, setWeekLoaded] = useState(false);
  // These are the "day bars" that must not disagree with the radials — see
  // lib/activityRevision.
  const revision = useActivityRevision();

  useEffect(() => {
    let cancelled = false;
    // Deliberately NOT clearing weekSteps/pastWeek here: zeroing the array
    // collapsed every bar to 0px for one round trip on each arrow tap. The old
    // week stays up — dimmed, see StalePanel below — until the new one lands.
    setWeekLoaded(false);
    if (offset === 0) {
      fetchWeeklyStepsPerDay().then(s => { if (!cancelled) setWeekSteps(s); }).catch(() => {});
      // Steps come from the live hook above, but the tappable bars also need the
      // per-day POWR split, which only the session query carries.
      fetchWeekActivityData('walking', weekAnchorMonday(0))
        .then(d => { if (!cancelled) { setPastWeek(d); setWeekLoaded(true); } })
        .catch(() => { if (!cancelled) setWeekLoaded(true); });
    } else {
      fetchWeekActivityData('walking', weekAnchorMonday(offset))
        .then(d => { if (!cancelled) { setWeekSteps(d.stepsPerDay); setPastWeek(d); setWeekLoaded(true); } })
        .catch(() => { if (!cancelled) setWeekLoaded(true); });
    }
    return () => { cancelled = true; };
  }, [offset, revision]);

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
    <StalePanel stale={!weekLoaded && pastWeek !== null}>
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
            <View style={styles.bigMetricSupRow}>
              <Text style={styles.bigMetricSup}>POWR EARNED</Text>
              <PointsInfoDot onPress={onInfo} label="How you earned this walking POWR" />
            </View>
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
          // Only days that actually recorded steps respond to a tap.
          const hasData = !isFuture && steps > 0;
          const Col: any = hasData ? Pressable : View;
          return (
            <Col
              key={i}
              style={[styles.weekBarCol, selected === i && styles.weekBarColSelected]}
              {...(hasData ? {
                onPress: () => setSelected(prev => (prev === i ? null : i)),
                hitSlop: 8,
                accessibilityRole: 'button',
                accessibilityLabel: `${DAY_LABELS[i]} — see what you earned`,
              } : {})}
            >
              <View style={styles.weekBarTrack}>
                {!isFuture && barPct > 0 && (
                  <View style={[
                    styles.weekBarFill,
                    { height: `${Math.round(barPct * 100)}%` as any, backgroundColor: barColor },
                  ]} />
                )}
              </View>
              <Text style={[
                styles.weekBarLabel,
                isToday && { color: TEXT, fontWeight: '600' },
                selected === i && { color: GOLD, fontWeight: '600' },
              ]}>
                {day.charAt(0)}
              </Text>
              {steps > 0 && !isFuture && (
                <Text style={[styles.weekBarSteps, isBest && { color: GOLD }]}>
                  {formatSteps(steps)}
                </Text>
              )}
            </Col>
          );
        })}
      </View>

      {selected !== null && (
        <DayCaption
          date={addDays(weekAnchorMonday(offset), selected)}
          sessions={pastWeek?.sessionsPerDay[selected] ?? 0}
          durationMin={0}
          points={pastWeek?.pointsPerDay[selected] ?? 0}
          onPress={() => onSelectDay(addDays(weekAnchorMonday(offset), selected))}
        />
      )}

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
    </StalePanel>
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

function MovementMonthView({
  data, offset, onSelectDay,
}: {
  data: MonthlyActivityData | null;
  offset: number;
  onSelectDay: (day: Date) => void;
}) {
  // "This Month" / "June" — see WorkoutMonthView.
  const label = monthLabel(offset);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { setSelected(null); }, [data]);

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
        <Text style={styles.emptyText}>
          No walking data {offset === 0 ? 'this month' : `in ${label}`}.
        </Text>
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

  // Keep the whole entry — the caption needs POWR, which the steps-only map dropped.
  const lookup = new Map<string, DailyActivityEntry>();
  for (const e of data.entries) lookup.set(e.date, e);

  const rows: { date: string; steps: number; inRange: boolean }[][] = [];
  let cursor = new Date(gridStart);
  const lastEntry = new Date(data.entries[data.entries.length - 1].date + 'T00:00:00');

  while (cursor <= lastEntry) {
    const row: { date: string; steps: number; inRange: boolean }[] = [];
    for (let col = 0; col < 7; col++) {
      // See WorkoutsTab: local-midnight cursor + toISOString shifted every cell
      // one column right in UTC+ zones.
      const dateKey = localDateStr(cursor);
      const inRange = lookup.has(dateKey);
      row.push({ date: dateKey, steps: lookup.get(dateKey)?.steps ?? 0, inRange });
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

      <Text style={styles.tabSubLabel}>{label.toUpperCase()}</Text>

      <MonthHeatmap
        rows={rows.map(row => row.map(c => ({ date: c.date, inRange: c.inRange, value: c.steps })))}
        fill={heatmapColor}
        // The top two stops are near-solid #4ade80; below that the fill is dark
        // enough that light ink is the readable one.
        isSolid={steps => steps >= 6000}
        selected={selected}
        onSelect={setSelected}
      />

      {selected && (() => {
        const entry = lookup.get(selected);
        // Grid keys are UTC-dated via toISOString; parse at local noon so the
        // caption can't show the neighbouring day west of Greenwich.
        const day = new Date(`${selected}T12:00:00`);
        return (
          <DayCaption
            date={day}
            sessions={0}
            durationMin={0}
            points={entry?.points ?? 0}
            onPress={() => onSelectDay(day)}
          />
        );
      })()}

      <HeatmapLegend colours={HEATMAP_COLORS} />
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
  const [infoOpen, setInfoOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  // Invalidate on offset change, but KEEP monthData: clearing it dropped
  // MovementMonthView to its "Loading monthly walking data..." placeholder,
  // collapsing the panel and jumping the page on every arrow tap. See StalePanel.
  //
  // revision refreshes the heatmap on the same signal that invalidates the
  // radials — see lib/activityRevision.
  const revision = useActivityRevision();
  useEffect(() => {
    setMonthLoaded(false);
  }, [offset, revision]);

  // Load month data reactively
  useEffect(() => {
    if (period !== 'M' || monthLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchMonthlyActivityData('walking', offset);
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
        <MovementDayView walking={walking} offset={offset} onInfo={() => setInfoOpen(true)} />
      )}
      {period === 'W' && (
        <MovementWeekView
          walking={walking}
          totalSteps={totalSteps}
          stepsF={stepsF}
          weekActiveDays={weekActiveDays}
          offset={offset}
          onInfo={() => setInfoOpen(true)}
          onSelectDay={setSelectedDay}
        />
      )}
      {period === 'M' && (
        <StalePanel stale={!monthLoaded && monthData !== null}>
          <MovementMonthView data={monthData} offset={offset} onSelectDay={setSelectedDay} />
        </StalePanel>
      )}

      <PointsBreakdownSheet
        visible={infoOpen}
        onClose={() => setInfoOpen(false)}
        type="walking"
        period={period}
        offset={offset}
      />

      {/* Same sheet pinned to one tapped day; separate state from the (i). */}
      <PointsBreakdownSheet
        visible={selectedDay !== null}
        onClose={() => setSelectedDay(null)}
        type="walking"
        period="D"
        offset={0}
        day={selectedDay}
      />
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
  // Holds the sup-label + its (i) — mirrors WorkoutsTab.
  bigMetricSupRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
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


  // Insight
  insightRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  insightText: { fontSize: 12, fontWeight: '300', color: MUTED, flex: 1 },
  insightAction: { color: GOLD, fontWeight: '500', textDecorationLine: 'underline' },

  // Week bar chart
  weekBarChart: {
    // See WorkoutsTab's copy of this style — 'flex-end' collapsed the bars to 0
    // on web (RN's Yoga errata masked it on native). Kept in sync deliberately.
    flexDirection: 'row', alignItems: 'stretch', gap: 4, height: 72,
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
  // See WorkoutsTab: tint the column, not the track — a border inside a filled
  // track is invisible on precisely the days worth selecting.
  weekBarColSelected: {
    backgroundColor: 'rgba(232,210,0,0.08)',
    borderRadius: 6,
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
