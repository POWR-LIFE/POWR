import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DayCaption } from '@/components/progress/DayCaption';
import PointsBreakdownSheet from '@/components/progress/PointsBreakdownSheet';
import { useHealthData } from '@/hooks/useHealthData';
import { useHealthProviders } from '@/hooks/useHealthProviders';
import {
    fetchLastNightSleepDetail,
    fetchMonthlySleepData,
    fetchRecentSleepHistory,
    localDateStr,
    type DailySleepEntry,
    type DailySleepHistory,
    type LastNightSleepDetail,
    type MonthlySleepData,
} from '@/lib/api/activity';
import { getProvider } from '@/lib/health/providers';
import { ProviderAuthExpiredError } from '@/lib/health/providers/types';

// ─── Design tokens (match progress.tsx) ──────────────────────────────────────

const INDIGO = '#818cf8';
const GOLD   = '#E8D200';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';

const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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

function SleepDayView({ data, authExpired }: { data: LastNightSleepDetail | null; authExpired?: boolean }) {
  const [history, setHistory] = useState<DailySleepHistory[]>([]);

  useEffect(() => {
    fetchRecentSleepHistory(5).then(setHistory).catch(() => {});
  }, []);

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
          ) : (
            <>
              <Text style={styles.emptyText}>No sleep data for last night.</Text>
              <Text style={styles.emptySubtext}>Sleep will appear once synced from your wearable.</Text>
            </>
          )}
        </View>

        {hasHistory && (
          <>
            <View style={styles.tabSep} />
            <Text style={styles.tabSubLabel}>RECENT NIGHTS</Text>
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
          <Text style={styles.tabSubLabel}>RECENT NIGHTS</Text>
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

function SleepWeekView({ sleepHrs, sleepBedtimes }: { sleepHrs: number[]; sleepBedtimes: (string | null)[] }) {
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

      <Text style={styles.tabSubLabel}>NIGHTLY SLEEP</Text>
      <View style={styles.sleepChart}>
        {sleepHrs.map((hrs, i) => {
          const isToday = i === TODAY_INDEX;
          const fillH   = hrs > 0 ? Math.round((hrs / 10) * SLEEP_BAR_H) : 0;
          const isBest  = hasBest && i === bestIdx;
          return (
            <View key={i} style={styles.sleepBarCol}>
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
              <Text style={[styles.sleepBarDay, isToday && { color: TEXT, fontWeight: '600' }]}>
                {DAY_LABELS[i].charAt(0)}
              </Text>
            </View>
          );
        })}
      </View>

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
  data, onSelectDay,
}: {
  data: MonthlySleepData | null;
  onSelectDay: (day: Date) => void;
}) {
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
        <Text style={styles.emptyText}>No sleep data in the last 30 days.</Text>
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
      <Text style={styles.tabSubLabel}>30-DAY SLEEP</Text>

      {/* Day-of-week headers */}
      <View style={styles.heatmapRow}>
        {DAY_LABELS.map(d => (
          <View key={d} style={styles.heatmapCellCompact}>
            <Text style={styles.heatmapHeaderText}>{d.charAt(0)}</Text>
          </View>
        ))}
      </View>

      {/* Grid rows */}
      {rows.map((row, ri) => (
        <View key={ri} style={styles.heatmapRow}>
          {row.map((cell, ci) => {
            const hasNight = cell.inRange && cell.hours > 0;
            const Cell: any = hasNight ? Pressable : View;
            return (
              <Cell
                key={ci}
                style={styles.heatmapCellCompact}
                {...(hasNight ? {
                  onPress: () => setSelected(prev => (prev === cell.date ? null : cell.date)),
                  hitSlop: 8,
                  accessibilityRole: 'button',
                  accessibilityLabel: `${cell.date} — see what you earned`,
                } : {})}
              >
                {cell.inRange ? (
                  <View style={[
                    styles.heatmapDot,
                    { backgroundColor: heatmapColor(cell.hours) },
                    selected === cell.date && styles.heatmapDotSelected,
                  ]} />
                ) : (
                  <View style={[styles.heatmapDot, { backgroundColor: 'transparent' }]} />
                )}
              </Cell>
            );
          })}
        </View>
      ))}

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

      {/* Legend */}
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

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// ─── Main SleepTab ───────────────────────────────────────────────────────────

export function SleepTab({
  sleepHrs,
  sleepBedtimes,
}: {
  sleepHrs: number[];
  sleepBedtimes: (string | null)[];
}) {
  const [period, setPeriod] = useState<Period>('W');
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [dayData, setDayData] = useState<LastNightSleepDetail | null>(null);
  const [monthData, setMonthData] = useState<MonthlySleepData | null>(null);
  const [dayLoaded, setDayLoaded] = useState(false);
  const [monthLoaded, setMonthLoaded] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);

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
        let result = await fetchLastNightSleepDetail();

        // 2. If the DB has nothing, try fetching live from the active provider
        if (!result) {
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
  }, [period, activeId, isNativeProvider, health.isAuthorized]);

  // Load Month data reactively
  useEffect(() => {
    if (period !== 'M' || monthLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchMonthlySleepData();
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
  }, [period, monthLoaded]);

  return (
    <View style={styles.tabPanel}>
      <PillToggle value={period} onChange={setPeriod} />

      {period === 'D' && (
        <SleepDayView data={dayData} authExpired={authExpired} />
      )}
      {period === 'W' && (
        <SleepWeekView sleepHrs={sleepHrs} sleepBedtimes={sleepBedtimes} />
      )}
      {period === 'M' && (
        <SleepMonthView data={monthData} onSelectDay={setSelectedDay} />
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
  // Border, not colour: the heatmap already spends colour on sleep duration.
  heatmapDotSelected: {
    borderWidth: 1.5, borderColor: GOLD,
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
