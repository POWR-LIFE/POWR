import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DayCaption, addDays } from '@/components/progress/DayCaption';
import { HeatmapLegend, MonthHeatmap } from '@/components/progress/MonthHeatmap';
import PointsBreakdownSheet from '@/components/progress/PointsBreakdownSheet';
import { StalePanel } from '@/components/progress/StalePanel';
import { TimeStepper } from '@/components/progress/TimeStepper';
import { useHealthData } from '@/hooks/useHealthData';
import { useHealthProviders } from '@/hooks/useHealthProviders';
import {
    fetchMonthlySleepData,
    fetchRecentSleepHistory,
    fetchSleepDayDetail,
    fetchWeeklySleepHours,
    localDateStr,
    type DailySleepEntry,
    type DailySleepHistory,
    type MonthlySleepData,
    type SleepDayDetail,
} from '@/lib/api/activity';
import { getProvider } from '@/lib/health/providers';
import { ProviderAuthExpiredError } from '@/lib/health/providers/types';
import { dayAnchor, monthLabel, rangeLabel, weekAnchorMonday } from '@/lib/progressLookback';

// ─── Design tokens (match progress.tsx) ──────────────────────────────────────

const INDIGO = '#818cf8';
const GOLD   = '#E8D200';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';

const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EMPTY_WEEK_HRS: number[] = [0, 0, 0, 0, 0, 0, 0];
const EMPTY_WEEK_BEDTIMES: (string | null)[] = [null, null, null, null, null, null, null];
const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
const SLEEP_BAR_H = 56;

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

// ─── Helper: format time ─────────────────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function avgBedtimeFromTimestamps(bedtimes: (string | null)[]): string {
  const valid = bedtimes.filter((b): b is string => b !== null);
  if (valid.length === 0) return '—';
  const totalMinutes = valid.reduce((sum, bt) => {
    const d = new Date(bt);
    let mins = d.getHours() * 60 + d.getMinutes();
    if (mins < 720) mins += 1440;
    return sum + mins;
  }, 0);
  let avgMins = Math.round(totalMinutes / valid.length) % 1440;
  const h = Math.floor(avgMins / 60);
  const m = avgMins % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

// ─── Day View ────────────────────────────────────────────────────────────────

function SleepDayView({
  data, offset, authExpired, sleepTracked = true,
}: {
  data: SleepDayDetail | null;
  offset: number;
  authExpired?: boolean;
  /** False when the wearable has sent no sleep in 30 days — it isn't worn to bed. */
  sleepTracked?: boolean;
}) {
  const [history, setHistory] = useState<DailySleepHistory[]>([]);
  const isToday = offset === 0;

  useEffect(() => {
    fetchRecentSleepHistory(5, isToday ? undefined : dayAnchor(offset)).then(setHistory).catch(() => {});
  }, [offset, isToday]);

  const hasHistory = history.some(d => d.hours > 0);

  if (!data) {
    return (
      <View style={styles.tabPanel}>
        <View style={styles.emptyState}>
          <Ionicons name="moon-outline" size={28} color={MUTED} />
          {authExpired ? (
            <>
              <Text style={styles.emptyText}>Wearable connection expired</Text>
              <Text style={styles.emptySubtext}>
                Reconnect your wearable in Settings to resume sleep tracking.
              </Text>
            </>
          ) : !sleepTracked ? (
            // Connected and syncing, but never a night: the device isn't worn
            // to bed. "Will appear once synced" was a promise it could never
            // keep — say what would actually make sleep land here.
            <>
              <Text style={styles.emptyText}>No sleep recorded in the last 30 days.</Text>
              <Text style={styles.emptySubtext}>Wear your device to bed and your nights will land here.</Text>
            </>
          ) : (
            <>
              <Text style={styles.emptyText}>
                No sleep data for {isToday ? 'last night' : rangeLabel('D', offset)}.
              </Text>
              <Text style={styles.emptySubtext}>Sleep will appear once synced from your wearable.</Text>
            </>
          )}
        </View>

        {hasHistory && (
          <>
            <View style={styles.tabSep} />
            <Text style={styles.tabSubLabel}>{isToday ? 'RECENT NIGHTS' : 'PREVIOUS NIGHTS'}</Text>
            {history.map(night => (
              <SleepHistoryRow key={night.date} night={night} />
            ))}
          </>
        )}
      </View>
    );
  }

  const hasStages = data.deepHours != null && data.remHours != null && data.lightHours != null;
  const totalStageH = hasStages ? (data.deepHours! + data.remHours! + data.lightHours!) : 0;

  return (
    <View style={styles.tabPanel}>
      {/* Metrics */}
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>TOTAL SLEEP</Text>
          <Text style={[styles.bigMetricVal, { color: INDIGO }]}>{data.totalHours.toFixed(1)}h</Text>
          <Text style={styles.bigMetricMax}>/ 8h goal</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(Math.min(data.totalHours / 8, 1) * 100)}%` as any, backgroundColor: INDIGO }]} />
          </View>
        </View>
        <View style={styles.bigMetricDivider} />
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>BEDTIME / WAKE</Text>
          <Text style={[styles.bigMetricVal, { color: INDIGO, fontSize: 28 }]}>
            {formatTime(data.bedtime)}
          </Text>
          <Text style={styles.bigMetricMax}>{formatTime(data.wakeTime)}</Text>
        </View>
      </View>

      <View style={styles.tabSep} />

      {/* Sleep stages */}
      <Text style={styles.tabSubLabel}>SLEEP STAGES</Text>
      {hasStages && totalStageH > 0 ? (
        <>
          <View style={styles.stagesBar}>
            <View style={[styles.stageSegment, { flex: data.deepHours!, backgroundColor: '#4338ca' }]} />
            <View style={[styles.stageSegment, { flex: data.remHours!, backgroundColor: INDIGO }]} />
            <View style={[styles.stageSegment, { flex: data.lightHours!, backgroundColor: '#a5b4fc' }]} />
          </View>
          <View style={styles.stageLegend}>
            <View style={styles.stageLegendItem}>
              <View style={[styles.stageDot, { backgroundColor: '#4338ca' }]} />
              <Text style={styles.stageLegendText}>Deep {data.deepHours!.toFixed(1)}h</Text>
            </View>
            <View style={styles.stageLegendItem}>
              <View style={[styles.stageDot, { backgroundColor: INDIGO }]} />
              <Text style={styles.stageLegendText}>REM {data.remHours!.toFixed(1)}h</Text>
            </View>
            <View style={styles.stageLegendItem}>
              <View style={[styles.stageDot, { backgroundColor: '#a5b4fc' }]} />
              <Text style={styles.stageLegendText}>Light {data.lightHours!.toFixed(1)}h</Text>
            </View>
          </View>
        </>
      ) : (
        <View style={styles.stagesBar}>
          <View style={[styles.stageSegment, { flex: 1, backgroundColor: INDIGO }]} />
        </View>
      )}
      {!hasStages && (
        <Text style={[styles.emptySubtext, { marginTop: 4 }]}>Stage breakdown unavailable</Text>
      )}

      {/* Insight */}
      <View style={styles.insightRow}>
        <Ionicons name="moon-outline" size={12} color={INDIGO} />
        <Text style={[styles.insightText, { color: DIM }]}>
          {data.totalHours >= 7.5
            ? 'Great recovery night. Keep it consistent.'
            : `${(8 - data.totalHours).toFixed(1)}h below target — try an earlier bedtime.`}
        </Text>
      </View>

      {/* Recent nights history */}
      {hasHistory && (
        <>
          <View style={styles.tabSep} />
          <Text style={styles.tabSubLabel}>{isToday ? 'RECENT NIGHTS' : 'PREVIOUS NIGHTS'}</Text>
          {history.map(night => (
            <SleepHistoryRow key={night.date} night={night} />
          ))}
        </>
      )}
    </View>
  );
}

function SleepHistoryRow({ night }: { night: DailySleepHistory }) {
  const d = new Date(night.date + 'T00:00:00');
  const dayName = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const dayNum  = d.getDate();
  const hasData = night.hours > 0;
  const pct     = Math.min(night.hours / 8, 1);
  const hrColor = night.hours >= 7 ? INDIGO : night.hours >= 5 ? '#a5b4fc' : MUTED;
  return (
    <View style={styles.historyRow}>
      <Text style={styles.historyDayLabel}>{dayName} {dayNum}</Text>
      <View style={styles.historyBarWrap}>
        {hasData && <View style={[styles.historyBarFill, { width: `${Math.round(pct * 100)}%` as any, backgroundColor: hrColor }]} />}
      </View>
      <Text style={[styles.historyHrs, !hasData && { color: MUTED }]}>
        {hasData ? `${night.hours.toFixed(1)}h` : '—'}
      </Text>
    </View>
  );
}

// ─── Week View (existing chart, moved verbatim) ──────────────────────────────

function SleepWeekView({
  sleepHrs, sleepBedtimes, isCurrentWeek, weekStart, perDayPoints, onSelectDay,
}: {
  sleepHrs: number[];
  sleepBedtimes: (string | null)[];
  isCurrentWeek: boolean;
  /** Local-midnight Monday of the week on screen — bars are offsets from here. */
  weekStart: Date;
  /** Mon=0…Sun=6 POWR, bucketed by the same wake-day rule as `sleepHrs`. */
  perDayPoints: number[] | null;
  onSelectDay: (day: Date) => void;
}) {
  // A past week has no "today" column to highlight — TODAY_INDEX is the current
  // weekday, so using it unguarded would accent an arbitrary bar.
  const todayIndex = isCurrentWeek ? TODAY_INDEX : -1;

  // Which bar is selected, as a Mon=0 index — matching WorkoutsTab rather than
  // the month grid's date-keyed state, because a bar only knows its offset.
  const [selected, setSelected] = useState<number | null>(null);
  // Compare by time value: the parent builds a fresh Date each render, so
  // depending on the object identity would clear the selection every render.
  const weekKey = weekStart.getTime();
  useEffect(() => { setSelected(null); }, [weekKey]);
  const daysWithSleep = sleepHrs.filter(h => h > 0).length;
  const avg = daysWithSleep > 0
    ? (sleepHrs.reduce((s, v) => s + v, 0) / daysWithSleep).toFixed(1)
    : '—';
  const avgNum = Number(avg) || 0;
  const avgPct = Math.min(avgNum / 8, 1);
  const hasData = daysWithSleep > 0;
  const avgBedtime = avgBedtimeFromTimestamps(sleepBedtimes);

  // Best night this week
  const bestIdx = sleepHrs.indexOf(Math.max(...sleepHrs));
  const hasBest = sleepHrs[bestIdx] > 0;

  return (
    <View style={styles.tabPanel}>
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>AVG / NIGHT</Text>
          <Text style={[styles.bigMetricVal, { color: INDIGO }]}>{hasData ? `${avg}h` : '—'}</Text>
          <Text style={styles.bigMetricMax}>/ 8h goal</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(avgPct * 100)}%` as any, backgroundColor: INDIGO }]} />
          </View>
        </View>
        <View style={styles.bigMetricDivider} />
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>AVG BEDTIME</Text>
          <Text style={[styles.bigMetricVal, { color: INDIGO }]}>
            {avgBedtime.replace(/(am|pm)$/i, '')}
            <Text style={{ fontSize: 22, fontWeight: '100', letterSpacing: -0.5 }}>{avgBedtime.match(/(am|pm)$/i)?.[0] ?? ''}</Text>
          </Text>
          <Text style={styles.bigMetricMax}>goal: 10:30pm</Text>
          <View style={styles.metricBar}>
            {hasData ? (
              <View style={[styles.metricBarFill, { width: `${Math.round(Math.max(0, 1 - Math.abs(avgNum - 7.5) / 4) * 100)}%` as any, backgroundColor: INDIGO }]} />
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.tabSep} />

      <Text style={styles.tabSubLabel}>{isCurrentWeek ? 'THIS WEEK' : 'NIGHTLY SLEEP'}</Text>
      <View style={styles.sleepChart}>
        {sleepHrs.map((hrs, i) => {
          const isToday = i === todayIndex;
          const fillH   = hrs > 0 ? Math.round((hrs / 10) * SLEEP_BAR_H) : 0;
          const isBest  = hasBest && i === bestIdx;
          // Only nights that actually recorded sleep respond to a tap — a blank
          // bar that reacts teaches people the chart isn't interactive.
          const hasNight = hrs > 0;
          const Col: any = hasNight ? Pressable : View;
          return (
            <Col
              key={i}
              style={[styles.sleepBarCol, selected === i && styles.sleepBarColSelected]}
              {...(hasNight ? {
                onPress: () => setSelected(prev => (prev === i ? null : i)),
                hitSlop: 8,
                accessibilityRole: 'button',
                accessibilityLabel: `${DAY_LABELS[i]} — see what you earned`,
              } : {})}
            >
              <Text style={[styles.sleepBarHrs, isToday && { color: INDIGO }, isBest && { color: GOLD }]}>
                {hrs > 0 ? (hrs % 1 === 0 ? `${hrs}h` : `${hrs.toFixed(1)}h`) : '—'}
              </Text>
              <View style={styles.sleepBarTrack}>
                {hrs > 0 && (
                  <View style={[
                    styles.sleepBarFill,
                    { height: fillH, backgroundColor: isBest ? GOLD : isToday ? INDIGO : `${INDIGO}60` },
                  ]} />
                )}
              </View>
              <Text style={[
                styles.sleepBarDay,
                isToday && { color: TEXT, fontWeight: '600' },
                selected === i && { color: GOLD, fontWeight: '600' },
              ]}>
                {DAY_LABELS[i].charAt(0)}
              </Text>
            </Col>
          );
        })}
      </View>

      {selected !== null && (
        <DayCaption
          date={addDays(weekStart, selected)}
          sessions={0}
          durationMin={Math.round((sleepHrs[selected] ?? 0) * 60)}
          points={perDayPoints?.[selected] ?? 0}
          onPress={() => onSelectDay(addDays(weekStart, selected))}
        />
      )}

      {hasBest && (
        <View style={styles.insightRow}>
          <Ionicons name="trophy-outline" size={12} color={GOLD} />
          <Text style={styles.insightText}>
            Best night: {DAY_LABELS[bestIdx]} — {sleepHrs[bestIdx].toFixed(1)}h
          </Text>
        </View>
      )}

      <View style={styles.insightRow}>
        <Ionicons name="moon-outline" size={12} color={INDIGO} />
        <Text style={[styles.insightText, { color: DIM }]}>
          {!hasData
            ? 'Connect a wearable to track your sleep automatically.'
            : avgNum >= 7.5
            ? 'Good recovery. Keep your sleep schedule consistent.'
            : `You're ${(8 - avgNum).toFixed(1)}h below target — aim for an earlier bedtime.`}
        </Text>
      </View>
    </View>
  );
}

// ─── Month View (calendar heatmap) ───────────────────────────────────────────

const HEATMAP_COLORS = [
  'rgba(129,140,248,0.06)',  // no data
  'rgba(129,140,248,0.15)',  // < 5h
  'rgba(129,140,248,0.30)',  // 5-6h
  'rgba(129,140,248,0.50)',  // 6-7h
  'rgba(129,140,248,0.75)',  // 7-8h
  '#818cf8',                 // >= 8h
];

function heatmapColor(hours: number): string {
  if (hours <= 0) return HEATMAP_COLORS[0];
  if (hours < 5)  return HEATMAP_COLORS[1];
  if (hours < 6)  return HEATMAP_COLORS[2];
  if (hours < 7)  return HEATMAP_COLORS[3];
  if (hours < 8)  return HEATMAP_COLORS[4];
  return HEATMAP_COLORS[5];
}

function SleepMonthView({
  data, offset, onSelectDay,
}: {
  data: MonthlySleepData | null;
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
        <Ionicons name="moon-outline" size={28} color={MUTED} />
        <Text style={styles.emptyText}>Loading monthly sleep data...</Text>
      </View>
    );
  }

  const hasData = data.entries.some(e => e.hours > 0);

  if (!hasData) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="moon-outline" size={28} color={MUTED} />
        <Text style={styles.emptyText}>
          No sleep data {offset === 0 ? 'this month' : `in ${label}`}.
        </Text>
        <Text style={styles.emptySubtext}>Sleep will appear once synced from your wearable.</Text>
      </View>
    );
  }

  // Build heatmap grid: 7 cols (M-S), variable rows
  // Start on the Monday on or before the first entry date
  const firstDate = new Date(data.entries[0].date + 'T00:00:00');
  const firstDay = firstDate.getDay(); // 0=Sun
  const mondayOffset = firstDay === 0 ? -6 : 1 - firstDay;
  const gridStart = new Date(firstDate);
  gridStart.setDate(gridStart.getDate() + mondayOffset);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Keep the whole entry — the caption needs POWR, not just hours.
  const lookup = new Map<string, DailySleepEntry>();
  for (const e of data.entries) lookup.set(e.date, e);

  // Build rows
  const rows: { date: string; hours: number; inRange: boolean }[][] = [];
  let cursor = new Date(gridStart);
  const lastEntry = new Date(data.entries[data.entries.length - 1].date + 'T00:00:00');

  while (cursor <= lastEntry || cursor <= today) {
    const row: { date: string; hours: number; inRange: boolean }[] = [];
    for (let col = 0; col < 7; col++) {
      // See WorkoutsTab: local-midnight cursor + toISOString shifted every cell
      // one column right in UTC+ zones. Sleep has no day-tap yet, but the grid
      // was mis-dated the same way.
      const dateKey = localDateStr(cursor);
      const inRange = lookup.has(dateKey);
      row.push({ date: dateKey, hours: lookup.get(dateKey)?.hours ?? 0, inRange });
      cursor.setDate(cursor.getDate() + 1);
    }
    rows.push(row);
    if (rows.length > 6) break; // safety cap
  }

  return (
    <View style={[styles.tabPanel, { gap: 10 }]}>
      {/* Metrics */}
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>AVG / NIGHT</Text>
          <Text style={[styles.bigMetricVal, { color: INDIGO, fontSize: 30, lineHeight: 32 }]}>
            {data.avgHours > 0 ? `${data.avgHours}h` : '—'}
          </Text>
          <Text style={styles.bigMetricMax}>/ 8h goal</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(Math.min(data.avgHours / 8, 1) * 100)}%` as any, backgroundColor: INDIGO }]} />
          </View>
        </View>
        <View style={styles.bigMetricDivider} />
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>BEST NIGHT</Text>
          <Text style={[styles.bigMetricVal, { color: INDIGO, fontSize: 30, lineHeight: 32 }]}>
            {data.bestNight ? `${data.bestNight.hours.toFixed(1)}h` : '—'}
          </Text>
          <Text style={styles.bigMetricMax}>
            {data.bestNight ? formatShortDate(data.bestNight.date) : ''}
          </Text>
        </View>
      </View>

      <View style={styles.tabSep} />

      {/* Heatmap */}
      <Text style={styles.tabSubLabel}>{label.toUpperCase()}</Text>

      <MonthHeatmap
        rows={rows.map(row => row.map(c => ({ date: c.date, inRange: c.inRange, value: c.hours })))}
        fill={heatmapColor}
        // 7h+ is where the indigo goes near-solid and light ink stops reading.
        isSolid={hours => hours >= 7}
        selected={selected}
        onSelect={setSelected}
      />

      {selected && (() => {
        const entry = lookup.get(selected);
        const day = new Date(`${selected}T12:00:00`);
        return (
          <DayCaption
            date={day}
            sessions={0}
            durationMin={Math.round((entry?.hours ?? 0) * 60)}
            points={entry?.points ?? 0}
            onPress={() => onSelectDay(day)}
          />
        );
      })()}

      <HeatmapLegend colours={HEATMAP_COLORS} />
    </View>
  );
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// ─── Main SleepTab ───────────────────────────────────────────────────────────

export function SleepTab({
  sleepHrs,
  sleepBedtimes,
  sleepTracked = true,
}: {
  sleepHrs: number[];
  sleepBedtimes: (string | null)[];
  /** See SleepDayView — false swaps the "once synced" promise for the honest copy. */
  sleepTracked?: boolean;
}) {
  const [period, setPeriod] = useState<Period>('W');
  const [offset, setOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [dayData, setDayData] = useState<SleepDayDetail | null>(null);
  const [weekData, setWeekData] = useState<{ hours: number[]; bedtimes: (string | null)[] } | null>(null);
  // Per-day POWR behind the tappable week bars, bucketed by the SAME wake-day
  // rule as the hours (see fetchWeeklySleepHours), so a bar's caption can't
  // disagree with the bar. Fetched for the current week too — the parent supplies
  // hours live but not points, and every bar has to be tappable.
  const [weekPoints, setWeekPoints] = useState<number[] | null>(null);
  const [monthData, setMonthData] = useState<MonthlySleepData | null>(null);
  const [dayLoaded, setDayLoaded] = useState(false);
  const [weekLoaded, setWeekLoaded] = useState(false);
  const [monthLoaded, setMonthLoaded] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);

  const isCurrent = offset === 0;

  // Reset the stepper when switching D/W/M — an offset means a different span
  // per period, so carrying -3 from D into M would silently jump three months
  // back. Matches handlePeriodChange in progress.tsx.
  const handlePeriodChange = (p: Period) => {
    setPeriod(p);
    setOffset(0);
  };

  // Invalidate on offset change but KEEP the data, so StalePanel can hold the
  // previous panel on screen instead of collapsing it. See MovementTab.
  useEffect(() => {
    setDayLoaded(false);
    setWeekLoaded(false);
    setMonthLoaded(false);
  }, [offset]);

  // Dim only while REPLACING a panel that already has data — on a cold load
  // there is nothing to hold on screen, so the placeholder should render plain.
  const dayStale = !dayLoaded && dayData !== null;
  // isCurrent short-circuits: the current week never fetches (it comes from
  // props), so weekLoaded stays false, and without this guard stepping back and
  // then returning left the live week dimmed and untappable for good.
  const weekStale = !isCurrent && !weekLoaded && weekData !== null;
  const monthStale = !monthLoaded && monthData !== null;

  const health = useHealthData();
  const { activeId } = useHealthProviders();
  const isNativeProvider = !activeId || activeId === 'apple-health' || activeId === 'health-connect';

  // Load Day data reactively — retries when activeId resolves
  useEffect(() => {
    if (period !== 'D') return;
    let cancelled = false;

    (async () => {
      try {
        // 1. Try the DB first (synced sessions)
        let result = await fetchSleepDayDetail(offset);

        // 2. If the DB has nothing, try fetching live from the active provider.
        //    Only for the current day: the provider APIs return LAST NIGHT and
        //    nothing else, so using them on a stepped-back day would present
        //    last night's sleep as that day's.
        if (!result && isCurrent) {
          const canFetchLive = isNativeProvider ? health.isAuthorized : !!activeId;
          if (canFetchLive) {
            let lastNight = null;
            if (isNativeProvider) {
              lastNight = await health.getLastNightSleep();
            } else {
              try {
                const provider = getProvider(activeId!);
                lastNight = await provider.getLastNightSleep();
              } catch (e) {
                if (e instanceof ProviderAuthExpiredError) {
                  setAuthExpired(true);
                }
                console.warn('[SleepTab] Live provider fetch failed:', e);
              }
            }
            if (lastNight && lastNight.durationHours >= 1) {
              result = {
                totalHours: lastNight.durationHours,
                bedtime: lastNight.startedAt,
                wakeTime: lastNight.endedAt ?? new Date().toISOString(),
                deepHours: lastNight.deepHours ?? null,
                remHours: lastNight.remHours ?? null,
                lightHours: lastNight.lightHours ?? null,
                source: activeId ?? null,
              };
            }
          }
        }

        if (!cancelled) {
          setDayData(result);
          setDayLoaded(true);
        }
      } catch (err) {
        console.error('[SleepTab] Error loading day data:', err);
        if (!cancelled) {
          setDayData(null);
          setDayLoaded(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [period, offset, isCurrent, activeId, isNativeProvider, health.isAuthorized]);

  // Load Week data reactively. The current week comes from props (the parent
  // already fetched it, and tops it up with a live on-device read); past weeks
  // are fetched here against their Monday anchor.
  useEffect(() => {
    if (period !== 'W' || weekLoaded || isCurrent) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchWeeklySleepHours(weekAnchorMonday(offset));
        if (!cancelled) {
          setWeekData(result);
          setWeekLoaded(true);
        }
      } catch (err) {
        console.error('[SleepTab] Error loading week data:', err);
        if (!cancelled) {
          setWeekData(null);
          setWeekLoaded(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [period, weekLoaded, isCurrent, offset]);

  // Per-day POWR for the week bars' caption. Separate from the hours fetch
  // above because that one skips the current week (the parent supplies it live)
  // while this is needed for every week, including the current one.
  useEffect(() => {
    if (period !== 'W') return;
    let cancelled = false;
    setWeekPoints(null);

    fetchWeeklySleepHours(weekAnchorMonday(offset))
      .then(d => { if (!cancelled) setWeekPoints(d.points); })
      .catch(err => console.error('[SleepTab] Error loading week sleep points:', err));

    return () => { cancelled = true; };
  }, [period, offset]);

  // Load Month data reactively
  useEffect(() => {
    if (period !== 'M' || monthLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchMonthlySleepData(offset);
        if (!cancelled) {
          setMonthData(result);
          setMonthLoaded(true);
        }
      } catch (err) {
        console.error('[SleepTab] Error loading month data:', err);
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
      <PillToggle value={period} onChange={handlePeriodChange} />
      <TimeStepper period={period} offset={offset} onOffsetChange={setOffset} />

      {period === 'D' && (
        <StalePanel stale={dayStale}>
          <SleepDayView data={dayData} offset={offset} authExpired={authExpired} sleepTracked={sleepTracked} />
        </StalePanel>
      )}
      {period === 'W' && (
        <StalePanel stale={weekStale}>
          <SleepWeekView
            sleepHrs={isCurrent ? sleepHrs : weekData?.hours ?? EMPTY_WEEK_HRS}
            sleepBedtimes={isCurrent ? sleepBedtimes : weekData?.bedtimes ?? EMPTY_WEEK_BEDTIMES}
            isCurrentWeek={isCurrent}
            weekStart={weekAnchorMonday(offset)}
            perDayPoints={weekPoints}
            onSelectDay={setSelectedDay}
          />
        </StalePanel>
      )}
      {period === 'M' && (
        <StalePanel stale={monthStale}>
          <SleepMonthView data={monthData} offset={offset} onSelectDay={setSelectedDay} />
        </StalePanel>
      )}

      <PointsBreakdownSheet
        visible={selectedDay !== null}
        onClose={() => setSelectedDay(null)}
        type="sleep"
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
  pillActive: { backgroundColor: INDIGO },
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

  // Big metric pair (duplicated from progress.tsx to keep component self-contained)
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

  // Sleep stages bar (day view)
  stagesBar: {
    flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden',
  },
  stageSegment: {
    height: '100%',
  },
  stageLegend: {
    flexDirection: 'row', justifyContent: 'center', gap: 16,
  },
  stageLegendItem: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  stageDot: {
    width: 6, height: 6, borderRadius: 3,
  },
  stageLegendText: {
    fontSize: 10, fontWeight: '400', color: MUTED,
  },

  // Week bar chart
  sleepChart: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 4,
  },
  // Tint the whole COLUMN, not the bar track: a border inside a filled track is
  // invisible on exactly the nights worth selecting. Mirrors MovementTab.
  sleepBarColSelected: {
    backgroundColor: 'rgba(232,210,0,0.08)',
    borderRadius: 6,
  },
  sleepBarCol: {
    flex: 1, alignItems: 'center', gap: 4,
  },
  sleepBarHrs: {
    fontSize: 8, fontWeight: '400', color: MUTED,
  },
  sleepBarTrack: {
    width: '100%', height: SLEEP_BAR_H,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden',
  },
  sleepBarFill: {
    width: '100%', borderRadius: 4,
  },
  sleepBarDay: {
    fontSize: 9, fontWeight: '400', color: MUTED,
  },


  // Insight
  insightRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  insightText: { fontSize: 12, fontWeight: '300', color: MUTED, flex: 1 },

  // 5-night history (day view)
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
    height: '100%', borderRadius: 2,
  },
  historyHrs: {
    fontSize: 11, fontWeight: '500', color: TEXT, width: 36, textAlign: 'right',
  },
});
