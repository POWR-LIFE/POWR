import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DayCaption, addDays } from '@/components/progress/DayCaption';
import PointsBreakdownSheet, { PointsInfoDot } from '@/components/progress/PointsBreakdownSheet';
import { TimeStepper } from '@/components/progress/TimeStepper';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import {
    fetchMonthlyActivityData,
    fetchRecentWorkoutHistory,
    fetchTodayActivityDetail,
    fetchWeekActivityData,
    localDateStr,
    type DailyActivityEntry,
    type DailyWorkoutHistory,
    type MonthlyActivityData,
    type TodayActivityDetail,
    type WeekActivityData,
} from '@/lib/api/activity';
import { dayAnchor, monthAnchorEnd, weekAnchorMonday } from '@/lib/progressLookback';

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

function WorkoutDayView({ type, data, offset, onInfo }: { type: ActivityType; data: TodayActivityDetail | null; offset: number; onInfo: () => void }) {
  const config = ACTIVITIES[type];
  const isToday = offset === 0;
  const [history, setHistory] = useState<DailyWorkoutHistory[]>([]);

  useEffect(() => {
    fetchRecentWorkoutHistory(type, 5, offset === 0 ? undefined : dayAnchor(offset)).then(setHistory).catch(() => {});
  }, [type, offset]);

  const hasToday = data && data.sessionCount > 0;
  const hasHistory = history.some(d => d.sessions > 0);

  return (
    <View style={styles.tabPanel}>
      {!hasToday ? (
        <View style={styles.emptyState}>
          <Ionicons name={config.icon as any} size={28} color={MUTED} />
          <Text style={styles.emptyText}>No {config.label.toLowerCase()} session {isToday ? 'today' : 'on this day'}.</Text>
          <Text style={styles.emptySubtext}>
            {isToday ? 'Complete a session to see your daily stats.' : 'Nothing was logged on this date.'}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.bigMetricRow}>
            <View style={styles.bigMetric}>
              <Text style={styles.bigMetricSup}>{isToday ? "TODAY'S " : ''}{config.labelShort.toUpperCase()}</Text>
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
              <View style={styles.bigMetricSupRow}>
                <Text style={styles.bigMetricSup}>POWR EARNED</Text>
                <PointsInfoDot onPress={onInfo} label={`How you earned this ${config.label} POWR`} />
              </View>
              <Text style={[styles.bigMetricVal, { color: GOLD }]}>
                {data!.totalPoints > 0 ? data!.totalPoints : '—'}
              </Text>
              <Text style={styles.bigMetricMax}>{isToday ? 'today' : 'this day'}</Text>
            </View>
          </View>

          <View style={styles.insightRow}>
            <Ionicons name={config.iconActive as any} size={12} color={config.colour} />
            <Text style={[styles.insightText, { color: DIM }]}>
              {data!.totalDurationMin >= 45
                ? `Great ${config.label.toLowerCase()} session${isToday ? ' today' : ''}.`
                : isToday
                ? `${config.label} session logged — keep the momentum going.`
                : `${config.label} session logged.`}
            </Text>
          </View>
        </>
      )}

      {hasHistory && (
        <>
          <View style={styles.tabSep} />
          <Text style={styles.tabSubLabel}>{isToday ? 'RECENT DAYS' : 'PREVIOUS DAYS'}</Text>
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
                  {hasData ? formatDuration(day.totalDurationMin) : '—'}
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
  type, count, weekActiveDays, weeklyEarned, isCurrentWeek, onInfo, weekStart, perDay, onSelectDay,
}: {
  type: ActivityType;
  count: number;
  weekActiveDays: boolean[];
  weeklyEarned: number;
  isCurrentWeek: boolean;
  onInfo: () => void;
  /** Local-midnight Monday of the week on screen — days are offsets from here. */
  weekStart: Date;
  perDay: WeekActivityData | null;
  onSelectDay: (day: Date) => void;
}) {
  const config = ACTIVITIES[type];
  // Which bar is selected, as a Mon=0 index. Cleared when the week changes.
  const [selected, setSelected] = useState<number | null>(null);
  // Compare by time value — callers build a fresh Date each render, so the
  // object identity would clear the selection on every re-render.
  const weekKey = weekStart.getTime();
  useEffect(() => { setSelected(null); }, [weekKey, type]);
  const sessionPct = Math.min(count / 5, 1);
  const capPct = config.dailyCap > 0 ? Math.min(weeklyEarned / (config.dailyCap * 5), 1) : sessionPct;

  // Compute current streak (consecutive active days ending at today) — only
  // meaningful when looking at the current week.
  let streak = 0;
  if (isCurrentWeek) {
    for (let i = TODAY_INDEX; i >= 0; i--) {
      if (weekActiveDays[i]) streak++;
      else break;
    }
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
          <View style={styles.bigMetricSupRow}>
            <Text style={styles.bigMetricSup}>POWR EARNED</Text>
            <PointsInfoDot onPress={onInfo} label={`How you earned this ${config.label} POWR`} />
          </View>
          <Text style={[styles.bigMetricVal, { color: GOLD }]}>{weeklyEarned > 0 ? weeklyEarned : '—'}</Text>
          <Text style={styles.bigMetricMax}>from {isCurrentWeek ? 'this' : 'that'} week</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(capPct * 100)}%` as any, backgroundColor: GOLD }]} />
          </View>
        </View>
      </View>

      <View style={styles.tabSep} />

      <Text style={styles.tabSubLabel}>{isCurrentWeek ? 'THIS WEEK' : 'DAY BY DAY'}</Text>
      <View style={styles.weekBarChart}>
        {DAY_LABELS.map((day, i) => {
          const active   = weekActiveDays[i];
          const isToday  = isCurrentWeek && i === TODAY_INDEX;
          const isFuture = isCurrentWeek && i > TODAY_INDEX;
          const barColor = isToday ? config.colour : `${config.colour}80`;
          const hasData  = active && !isFuture;
          // Only days with something to say respond — a blank day that reacts
          // teaches people the chart isn't interactive.
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
                {hasData && (
                  <View style={[styles.weekBarFill, { height: '100%', backgroundColor: barColor }]} />
                )}
              </View>
              <Text style={[
                styles.weekBarLabel,
                isToday && { color: TEXT, fontWeight: '600' },
                selected === i && { color: GOLD, fontWeight: '600' },
              ]}>
                {day.charAt(0)}
              </Text>
            </Col>
          );
        })}
      </View>

      {selected !== null && (
        <DayCaption
          date={addDays(weekStart, selected)}
          sessions={perDay?.sessionsPerDay[selected] ?? 0}
          durationMin={perDay?.durationPerDay[selected] ?? 0}
          points={perDay?.pointsPerDay[selected] ?? 0}
          onPress={() => onSelectDay(addDays(weekStart, selected))}
        />
      )}

      {streak >= 2 && (
        <View style={styles.insightRow}>
          <Ionicons name="flash" size={12} color={GOLD} />
          <Text style={styles.insightText}>{streak} day streak — keep it going!</Text>
        </View>
      )}

      {activeDays > 0 && streak < 2 && (
        <View style={styles.insightRow}>
          <Ionicons name={config.iconActive as any} size={12} color={config.colour} />
          <Text style={styles.insightText}>{activeDays} day{activeDays !== 1 ? 's' : ''} active {isCurrentWeek ? 'this' : 'that'} week.</Text>
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
            ? isCurrentWeek ? 'Solid effort — keep going to hit your goal.' : 'Solid week of training.'
            : isCurrentWeek
            ? `${5 - count} more sessions to hit your target.`
            : `${count} of 5 sessions that week.`}
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

function WorkoutMonthView({
  type, data, onSelectDay,
}: {
  type: ActivityType;
  data: MonthlyActivityData | null;
  onSelectDay: (day: Date) => void;
}) {
  const config = ACTIVITIES[type];
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { setSelected(null); }, [type, data]);

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

  // Carry the whole entry, not just the count — the caption needs duration and
  // POWR, and the cell is the only place that knows which date was tapped.
  const lookup = new Map<string, DailyActivityEntry>();
  for (const e of data.entries) lookup.set(e.date, e);

  const rows: { date: string; count: number; inRange: boolean }[][] = [];
  let cursor = new Date(gridStart);
  const lastEntry = new Date(data.entries[data.entries.length - 1].date + 'T00:00:00');

  while (cursor <= lastEntry) {
    const row: { date: string; count: number; inRange: boolean }[] = [];
    for (let col = 0; col < 7; col++) {
      // localDateStr, NOT toISOString: cursor is at local midnight, which in any
      // UTC+ zone converts to the previous UTC day and shifted the whole grid.
      const dateKey = localDateStr(cursor);
      const inRange = lookup.has(dateKey);
      row.push({ date: dateKey, count: lookup.get(dateKey)?.sessionCount ?? 0, inRange });
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
          {row.map((cell, ci) => {
            // Only days that actually earned something respond to a tap.
            const hasData = cell.inRange && cell.count > 0;
            const Cell: any = hasData ? Pressable : View;
            return (
              <Cell
                key={ci}
                style={styles.heatmapCellCompact}
                {...(hasData ? {
                  // Cells are ~50x26 — below the touch minimum vertically, so the
                  // slop does the work rather than a taller, sparser grid.
                  onPress: () => setSelected(prev => (prev === cell.date ? null : cell.date)),
                  hitSlop: 8,
                  accessibilityRole: 'button',
                  accessibilityLabel: `${cell.date} — see what you earned`,
                } : {})}
              >
                {cell.inRange ? (
                  <View style={[
                    styles.heatmapDot,
                    { backgroundColor: heatmapColorForType(cell.count, config.colour) },
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
        // toISOString keys are UTC-dated; parse back at local noon so the caption
        // can't render the neighbouring day in a negative-offset timezone.
        const day = new Date(`${selected}T12:00:00`);
        return (
          <DayCaption
            date={day}
            sessions={entry?.sessionCount ?? 0}
            durationMin={entry?.totalDurationMin ?? 0}
            points={entry?.points ?? 0}
            onPress={() => onSelectDay(day)}
          />
        );
      })()}

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
  offset,
  onOffsetChange,
}: {
  type: ActivityType;
  count: number;
  weekActiveDays: boolean[];
  weeklyEarned: number;
  period: Period;
  onPeriodChange: (p: Period) => void;
  offset: number;
  onOffsetChange: (offset: number) => void;
}) {
  const config = ACTIVITIES[type];
  const isCurrent = offset === 0;
  const [dayData, setDayData] = useState<TodayActivityDetail | null>(null);
  const [weekData, setWeekData] = useState<WeekActivityData | null>(null);
  const [monthData, setMonthData] = useState<MonthlyActivityData | null>(null);
  const [dayLoaded, setDayLoaded] = useState(false);
  const [weekLoaded, setWeekLoaded] = useState(false);
  const [monthLoaded, setMonthLoaded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  // Reset loaded state when type or lookback offset changes
  useEffect(() => {
    setDayLoaded(false);
    setWeekLoaded(false);
    setMonthLoaded(false);
    setDayData(null);
    setWeekData(null);
    setMonthData(null);
  }, [type, offset]);

  // Load day data reactively
  useEffect(() => {
    if (period !== 'D' || dayLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchTodayActivityDetail(type, offset === 0 ? undefined : dayAnchor(offset));
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
  }, [period, dayLoaded, type, offset]);

  // Week data is now fetched for the CURRENT week too, not just past ones: the
  // live hooks give a week total but no per-day split, and the tappable bars
  // need one. The headline POWR EARNED still comes from the prop, so the number
  // that was already verified doesn't change source.
  useEffect(() => {
    if (period !== 'W' || weekLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchWeekActivityData(type, weekAnchorMonday(offset));
        if (!cancelled) {
          setWeekData(result);
          setWeekLoaded(true);
        }
      } catch (err) {
        console.error('[WorkoutsTab] Error loading week data:', err);
        if (!cancelled) {
          setWeekData(null);
          setWeekLoaded(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [period, weekLoaded, type, offset]);

  // Load month data reactively
  useEffect(() => {
    if (period !== 'M' || monthLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchMonthlyActivityData(type, offset === 0 ? undefined : monthAnchorEnd(offset));
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
  }, [period, monthLoaded, type, offset]);

  return (
    <View style={styles.tabPanel}>
      <PillToggle value={period} onChange={onPeriodChange} colour={config.colour} />
      <TimeStepper period={period} offset={offset} onOffsetChange={onOffsetChange} />

      {period === 'D' && (
        <WorkoutDayView type={type} data={dayData} offset={offset} onInfo={() => setInfoOpen(true)} />
      )}
      {period === 'W' && (
        <WorkoutWeekView
          type={type}
          count={isCurrent ? count : weekData?.sessionCount ?? 0}
          weekActiveDays={isCurrent ? weekActiveDays : weekData?.activeDays ?? [false, false, false, false, false, false, false]}
          weeklyEarned={isCurrent ? weeklyEarned : weekData?.points ?? 0}
          isCurrentWeek={isCurrent}
          onInfo={() => setInfoOpen(true)}
          weekStart={weekAnchorMonday(offset)}
          perDay={weekData}
          onSelectDay={setSelectedDay}
        />
      )}
      {period === 'M' && (
        <WorkoutMonthView type={type} data={monthData} onSelectDay={setSelectedDay} />
      )}

      <PointsBreakdownSheet
        visible={infoOpen}
        onClose={() => setInfoOpen(false)}
        type={type}
        period={period}
        offset={offset}
      />

      {/* Same sheet, pinned to a single tapped day. Kept separate from the (i)
          so closing one can't clear the other's state mid-animation. */}
      <PointsBreakdownSheet
        visible={selectedDay !== null}
        onClose={() => setSelectedDay(null)}
        type={type}
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
  // Holds the sup-label + its (i). The label keeps its own marginBottom, so the
  // row aligns on the text baseline rather than the icon's box.
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
  // Selection has to be a BORDER: these charts already spend their two other
  // emphasis signals — full-vs-80%-alpha means "today" and gold means "best" —
  // so re-using either would collide. Matches tokens' card.activeBorder.
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
    // 'stretch', not 'flex-end': flex-end leaves each column content-sized, so
    // weekBarTrack's flex:1 has no free space and the bars collapse to 0 on web.
    // Native has always hidden this — RN configures Yoga with YGErrataAll, whose
    // StretchFlexBasis errata keeps the pre-CSS-conformant behaviour, so the
    // track resolves to the row's height there. Real browser CSS does not.
    // The fill is bottom-anchored by justifyContent on the track, not by this.
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
  // Tint the whole COLUMN rather than ring the track: the track is filled with
  // the activity colour, so a border inside it is invisible on exactly the days
  // worth selecting. Matches tokens' components.card.activeBackground.
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
});
