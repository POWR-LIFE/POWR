import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { addDays, dayFromKey, useDaySelection } from '@/components/progress/daySelection';
import { MonthHeatmap } from '@/components/progress/MonthHeatmap';
import PointsBreakdownSheet, { PointsInfoDot } from '@/components/progress/PointsBreakdownSheet';
import { StalePanel } from '@/components/progress/StalePanel';
import { TimeStepper } from '@/components/progress/TimeStepper';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { useActivityRevision } from '@/hooks/useActivityRevision';
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
import i18n, { getFormatLocale } from '@/lib/i18n';
import { dayAnchor, monthLabel, weekAnchorMonday } from '@/lib/progressLookback';
import { formatDistance } from '@/lib/units';
import { isDistanceLed } from '@/lib/weeklyActivities';

// ─── Design tokens (match progress.tsx) ──────────────────────────────────────

const GOLD   = '#E8D200';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';

const DAY_KEYS = [
  'progress:days.short.mon', 'progress:days.short.tue', 'progress:days.short.wed', 'progress:days.short.thu',
  'progress:days.short.fri', 'progress:days.short.sat', 'progress:days.short.sun',
] as const;
const DAY_INITIAL_KEYS = [
  'progress:days.initial.mon', 'progress:days.initial.tue', 'progress:days.initial.wed', 'progress:days.initial.thu',
  'progress:days.initial.fri', 'progress:days.initial.sat', 'progress:days.initial.sun',
] as const;
const MONTH_KEYS = [
  'progress:months.short.jan', 'progress:months.short.feb', 'progress:months.short.mar', 'progress:months.short.apr',
  'progress:months.short.may', 'progress:months.short.jun', 'progress:months.short.jul', 'progress:months.short.aug',
  'progress:months.short.sep', 'progress:months.short.oct', 'progress:months.short.nov', 'progress:months.short.dec',
] as const;
const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

// ─── Pill Toggle ─────────────────────────────────────────────────────────────

type Period = 'D' | 'W' | 'M';
const PERIODS: Period[] = ['D', 'W', 'M'];
const PERIOD_KEYS: Record<Period, string> = { D: 'progress:period.D', W: 'progress:period.W', M: 'progress:period.M' };

function PillToggle({ value, onChange, colour }: { value: Period; onChange: (p: Period) => void; colour: string }) {
  const { t } = useTranslation();
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
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{t(PERIOD_KEYS[p])}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return i18n.t('progress:dates.monthDay', { month: i18n.t(MONTH_KEYS[d.getMonth()]), day: d.getDate() });
}

function formatDuration(mins: number): string {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? i18n.t('progress:units.hm', { h, m }) : i18n.t('progress:units.h', { h });
  }
  return i18n.t('progress:units.m', { m: mins });
}

// ─── Day View ────────────────────────────────────────────────────────────────

function WorkoutDayView({ type, data, offset, onInfo }: { type: ActivityType; data: TodayActivityDetail | null; offset: number; onInfo: () => void }) {
  const { t } = useTranslation();
  const config = ACTIVITIES[type];
  const isToday = offset === 0;
  const [history, setHistory] = useState<DailyWorkoutHistory[]>([]);

  useEffect(() => {
    fetchRecentWorkoutHistory(type, 5, offset === 0 ? undefined : dayAnchor(offset)).then(setHistory).catch(() => {});
  }, [type, offset]);

  const hasToday = data && data.sessionCount > 0;
  const hasHistory = history.some(d => d.sessions > 0);
  // Distance-led sports lead with how far — when the day's sessions carried one.
  const dayDistance = isDistanceLed(type) && data?.distanceM ? data.distanceM : 0;

  return (
    <View style={styles.tabPanel}>
      {!hasToday ? (
        <View style={styles.emptyState}>
          <Ionicons name={config.icon as any} size={28} color={MUTED} />
          <Text style={styles.emptyText}>
            {isToday
              ? t('progress:workouts.day.noneToday', { activity: config.label.toLowerCase() })
              : t('progress:workouts.day.noneOnDay', { activity: config.label.toLowerCase() })}
          </Text>
          <Text style={styles.emptySubtext}>
            {isToday ? t('progress:workouts.day.noneTodayHint') : t('progress:workouts.day.noneOnDayHint')}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.bigMetricRow}>
            <View style={styles.bigMetric}>
              <Text style={styles.bigMetricSup}>
                {isToday
                  ? t('progress:workouts.day.todays', { activity: config.labelShort.toUpperCase() })
                  : config.labelShort.toUpperCase()}
              </Text>
              <Text style={[styles.bigMetricVal, { color: config.colour }, dayDistance > 0 && { fontSize: 30, lineHeight: 32 }]}>
                {dayDistance > 0 ? formatDistance(dayDistance, type) : data!.sessionCount}
              </Text>
              <Text style={styles.bigMetricMax}>
                {dayDistance > 0
                  ? t('progress:workouts.day.sessionsCounted', { count: data!.sessionCount, duration: formatDuration(data!.totalDurationMin) })
                  : t('progress:workouts.day.sessions', { count: data!.sessionCount, duration: formatDuration(data!.totalDurationMin) })}
              </Text>
              <View style={styles.metricBar}>
                <View style={[styles.metricBarFill, { width: `${Math.round(Math.min(data!.sessionCount / 1, 1) * 100)}%` as any, backgroundColor: config.colour }]} />
              </View>
            </View>
            <View style={styles.bigMetricDivider} />
            <View style={styles.bigMetric}>
              <View style={styles.bigMetricSupRow}>
                <Text style={styles.bigMetricSup}>{t('progress:metric.powrEarned')}</Text>
                <PointsInfoDot onPress={onInfo} label={t('progress:workouts.howEarned', { activity: config.label })} />
              </View>
              <Text style={[styles.bigMetricVal, { color: GOLD }]}>
                {data!.totalPoints > 0 ? data!.totalPoints : '—'}
              </Text>
              <Text style={styles.bigMetricMax}>{isToday ? t('progress:metric.today') : t('progress:metric.thisDay')}</Text>
            </View>
          </View>

          <View style={styles.insightRow}>
            <Ionicons name={config.iconActive as any} size={12} color={config.colour} />
            <Text style={[styles.insightText, { color: DIM }]}>
              {data!.totalDurationMin >= 45
                ? isToday
                  ? t('progress:workouts.day.greatToday', { activity: config.label.toLowerCase() })
                  : t('progress:workouts.day.great', { activity: config.label.toLowerCase() })
                : isToday
                ? t('progress:workouts.day.loggedToday', { activity: config.label })
                : t('progress:workouts.day.logged', { activity: config.label })}
            </Text>
          </View>
        </>
      )}

      {hasHistory && (
        <>
          <View style={styles.tabSep} />
          <Text style={styles.tabSubLabel}>{isToday ? t('progress:workouts.day.recentDays') : t('progress:metric.previousDays')}</Text>
          {history.map((day) => {
            const d = new Date(day.date + 'T00:00:00');
            const dayName = d.toLocaleDateString(getFormatLocale(), { weekday: 'short' });
            const dayNum  = d.getDate();
            const hasData = day.sessions > 0;
            return (
              <View key={day.date} style={styles.historyRow}>
                <Text style={styles.historyDayLabel}>{dayName} {dayNum}</Text>
                <View style={styles.historyBarWrap}>
                  {hasData && <View style={[styles.historyBarFill, { backgroundColor: config.colour }]} />}
                </View>
                <Text style={[styles.historyMeta, !hasData && { color: MUTED }]}>
                  {!hasData
                    ? '—'
                    : isDistanceLed(type) && day.distanceM > 0
                      ? formatDistance(day.distanceM, type)
                      // "45m" beside "5.0 mi" and "830 m" reads as metres — in a
                      // column that mixes the two, spell the minutes out.
                      : isDistanceLed(type) && day.totalDurationMin < 60
                        ? t('progress:units.min', { m: day.totalDurationMin })
                        : formatDuration(day.totalDurationMin)}
                </Text>
                <Text style={[styles.historyPoints, !hasData && { color: MUTED }]}>
                  {hasData && day.points > 0 ? t('progress:units.pt', { points: day.points }) : '—'}
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
  type, count, weekActiveDays, weeklyEarned, isCurrentWeek, onInfo, weekStart, markedKey, onSelectDay, distancePerDay,
}: {
  type: ActivityType;
  count: number;
  /** Mon–Sun metres. Null until the week has loaded, or for a week with no distance. */
  distancePerDay: number[] | null;
  weekActiveDays: boolean[];
  weeklyEarned: number;
  isCurrentWeek: boolean;
  onInfo: () => void;
  /** Local-midnight Monday of the week on screen — days are offsets from here. */
  weekStart: Date;
  /** Local date key of the bar to mark — see useDaySelection. */
  markedKey: string | null;
  /** A tapped day, plus every tappable day this week for the sheet to step through. */
  onSelectDay: (day: Date, days: Date[]) => void;
}) {
  const { t } = useTranslation();
  const config = ACTIVITIES[type];
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
  // Distance-led sports lead with how far, and the day bars scale to it — a
  // 65 km ride and a 5 km spin to the shops shouldn't draw the same bar.
  const weekDistance = distancePerDay?.reduce((sum, m) => sum + m, 0) ?? 0;
  const byDistance = isDistanceLed(type) && weekDistance > 0;
  const maxDayDistance = byDistance ? Math.max(...distancePerDay!) : 0;

  return (
    <View style={styles.tabPanel}>
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>
            {byDistance
              ? t('progress:workouts.week.distance', { activity: config.labelShort.toUpperCase() })
              : t('progress:workouts.week.sessions', { activity: config.labelShort.toUpperCase() })}
          </Text>
          <Text style={[styles.bigMetricVal, { color: config.colour }, byDistance && { fontSize: 30, lineHeight: 32 }]}>
            {byDistance ? formatDistance(weekDistance, type) : count}
          </Text>
          <Text style={styles.bigMetricMax}>
            {byDistance ? t('progress:workouts.week.ofFive', { sessions: count }) : t('progress:workouts.week.goal')}
          </Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(sessionPct * 100)}%` as any, backgroundColor: config.colour }]} />
          </View>
        </View>
        <View style={styles.bigMetricDivider} />
        <View style={styles.bigMetric}>
          <View style={styles.bigMetricSupRow}>
            <Text style={styles.bigMetricSup}>{t('progress:metric.powrEarned')}</Text>
            <PointsInfoDot onPress={onInfo} label={t('progress:workouts.howEarned', { activity: config.label })} />
          </View>
          <Text style={[styles.bigMetricVal, { color: GOLD }]}>{weeklyEarned > 0 ? weeklyEarned : '—'}</Text>
          <Text style={styles.bigMetricMax}>{isCurrentWeek ? t('progress:metric.fromThisWeek') : t('progress:metric.fromThatWeek')}</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(capPct * 100)}%` as any, backgroundColor: GOLD }]} />
          </View>
        </View>
      </View>

      <View style={styles.tabSep} />

      <Text style={styles.tabSubLabel}>{isCurrentWeek ? t('progress:metric.thisWeek') : t('progress:metric.dayByDay')}</Text>
      <View style={styles.weekBarChart}>
        {DAY_INITIAL_KEYS.map((dayKey, i) => {
          const active   = weekActiveDays[i];
          const isToday  = isCurrentWeek && i === TODAY_INDEX;
          const isFuture = isCurrentWeek && i > TODAY_INDEX;
          const barColor = isToday ? config.colour : `${config.colour}80`;
          const hasData  = active && !isFuture;
          const selected = markedKey === localDateStr(addDays(weekStart, i));
          // Only days with something to say respond — a blank day that reacts
          // teaches people the chart isn't interactive.
          const Col: any = hasData ? Pressable : View;
          return (
            <Col
              key={i}
              style={[styles.weekBarCol, selected && styles.weekBarColSelected]}
              {...(hasData ? {
                onPress: () => onSelectDay(
                  addDays(weekStart, i),
                  weekActiveDays.flatMap((a, j) =>
                    a && !(isCurrentWeek && j > TODAY_INDEX) ? [addDays(weekStart, j)] : []),
                ),
                hitSlop: 8,
                accessibilityRole: 'button',
                accessibilityLabel: t('progress:chart.seeEarned', { day: t(DAY_KEYS[i]) }),
              } : {})}
            >
              <View style={styles.weekBarTrack}>
                {hasData && (
                  <View style={[styles.weekBarFill, {
                    // A day with a session but no distance (an indoor ride in
                    // an outdoor week) keeps a visible stub rather than vanishing.
                    height: byDistance
                      ? `${Math.round(Math.max((distancePerDay![i] ?? 0) / maxDayDistance, 0.12) * 100)}%` as any
                      : '100%',
                    backgroundColor: barColor,
                  }]} />
                )}
              </View>
              <Text style={[
                styles.weekBarLabel,
                isToday && { color: TEXT, fontWeight: '600' },
                selected && { color: GOLD, fontWeight: '600' },
              ]}>
                {t(dayKey)}
              </Text>
            </Col>
          );
        })}
      </View>

      {streak >= 2 && (
        <View style={styles.insightRow}>
          <Ionicons name="flash" size={12} color={GOLD} />
          <Text style={styles.insightText}>{t('progress:workouts.week.streak', { days: streak })}</Text>
        </View>
      )}

      {activeDays > 0 && streak < 2 && (
        <View style={styles.insightRow}>
          <Ionicons name={config.iconActive as any} size={12} color={config.colour} />
          <Text style={styles.insightText}>
            {isCurrentWeek
              ? t('progress:workouts.week.activeThis', { count: activeDays })
              : t('progress:workouts.week.activeThat', { count: activeDays })}
          </Text>
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
            ? t('progress:workouts.week.outstanding', { activity: config.label.toLowerCase() })
            : count >= 3
            ? isCurrentWeek ? t('progress:workouts.week.solidThis') : t('progress:workouts.week.solidThat')
            : isCurrentWeek
            ? t('progress:workouts.week.moreToGo', { sessions: 5 - count })
            : t('progress:workouts.week.thatWeek', { sessions: count })}
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
  type, data, offset, markedKey, onSelectDay,
}: {
  type: ActivityType;
  data: MonthlyActivityData | null;
  offset: number;
  markedKey: string | null;
  onSelectDay: (day: Date, days: Date[]) => void;
}) {
  const { t } = useTranslation();
  // "This Month" / "June" — the window is a calendar month, so every label the
  // panel shows has to name it rather than say "30 days".
  const label = monthLabel(offset);
  const config = ACTIVITIES[type];

  if (!data) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name={config.icon as any} size={28} color={MUTED} />
        <Text style={styles.emptyText}>{t('progress:workouts.month.loading')}</Text>
      </View>
    );
  }

  const hasData = data.entries.some(e => e.sessionCount > 0);

  if (!hasData) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name={config.icon as any} size={28} color={MUTED} />
        <Text style={styles.emptyText}>
          {offset === 0
            ? t('progress:workouts.month.noneThisMonth', { activity: config.label.toLowerCase() })
            : t('progress:workouts.month.noneIn', { activity: config.label.toLowerCase(), month: label })}
        </Text>
        <Text style={styles.emptySubtext}>{t('progress:workouts.month.noneHint')}</Text>
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
  const byDistance = data.bestDayMetric === 'distance';

  return (
    <View style={[styles.tabPanel, { gap: 10 }]}>
      <View style={styles.bigMetricRow}>
        {/* Distance-led sports lead with how far, and keep the session count as
            the caption — "2 rides" still matters, it just isn't the headline. */}
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>{byDistance ? t('progress:workouts.month.totalDistance') : t('progress:workouts.month.totalSessions')}</Text>
          <Text style={[styles.bigMetricVal, { color: config.colour, fontSize: 30, lineHeight: 32 }]}>
            {byDistance ? formatDistance(data.totalDistanceM, type) : data.totalSessions}
          </Text>
          <Text style={styles.bigMetricMax}>
            {byDistance
              ? offset === 0
                ? t('progress:workouts.month.sessionsThisMonth', { count: data.totalSessions })
                : t('progress:workouts.month.sessionsIn', { count: data.totalSessions, month: label })
              : offset === 0 ? t('progress:workouts.month.thisMonth') : t('progress:workouts.month.inMonth', { month: label })}
          </Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(Math.min(data.totalSessions / 20, 1) * 100)}%` as any, backgroundColor: config.colour }]} />
          </View>
        </View>
        <View style={styles.bigMetricDivider} />
        {/* Gym ranks the longest visit, not a session count: a geofence check-in
            is one row per day by construction, so "best day: 1" was a constant.
            The metric comes from the data layer so the two can't disagree. */}
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>
            {data.bestDayMetric === 'longestSession' ? t('progress:workouts.month.longestVisit') : t('progress:metric.bestDay')}
          </Text>
          <Text style={[styles.bigMetricVal, { color: config.colour, fontSize: 30, lineHeight: 32 }]}>
            {data.bestDay
              ? data.bestDayMetric === 'longestSession'
                ? formatDuration(data.bestDay.longestSessionMin)
                : byDistance
                  ? formatDistance(data.bestDay.distanceM, type)
                  : data.bestDay.sessionCount
              : '—'}
          </Text>
          <Text style={styles.bigMetricMax}>
            {data.bestDay ? formatShortDate(data.bestDay.date) : ''}
          </Text>
        </View>
      </View>

      <View style={styles.tabSep} />

      <Text style={styles.tabSubLabel}>{label.toUpperCase()}</Text>

      <MonthHeatmap
        rows={rows.map(row => row.map(c => ({ date: c.date, inRange: c.inRange, value: c.count })))}
        fill={count => heatmapColorForType(count, config.colour)}
        // Two states only, so this is a clean binary: a filled day is full brand
        // colour and needs dark ink; an empty one is near-black and needs light.
        isSolid={count => count > 0}
        selected={markedKey}
        onSelect={key => onSelectDay(
          dayFromKey(key),
          // Mirrors MonthHeatmap's own rule for which cells respond to a tap.
          rows.flat().filter(c => c.inRange && c.count > 0).map(c => dayFromKey(c.date)),
        )}
      />

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
  const daySel = useDaySelection(`${type}:${period}:${offset}`);

  // Invalidate on type/offset change, but KEEP the data: clearing it made the
  // period view fall back to its "Loading…" placeholder, collapsing the panel
  // from ~350px to ~105px and jumping the page on every arrow tap. The stale
  // panel stays mounted (dimmed via StalePanel) until the new window lands.
  // A slot is stale exactly when it holds data its guard says isn't loaded.
  //
  // revision is in the deps so a background earn refreshes these charts on the
  // same signal that invalidates the radials above them — see
  // lib/activityRevision. Without it the radials would move and the heatmap
  // beside them would keep pre-claim numbers.
  const revision = useActivityRevision();
  useEffect(() => {
    setDayLoaded(false);
    setWeekLoaded(false);
    setMonthLoaded(false);
  }, [type, offset, revision]);

  const dayStale = !dayLoaded && dayData !== null;
  const weekStale = !weekLoaded && weekData !== null;
  const monthStale = !monthLoaded && monthData !== null;

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
        const result = await fetchMonthlyActivityData(type, offset);
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
        <StalePanel stale={dayStale}>
          <WorkoutDayView type={type} data={dayData} offset={offset} onInfo={() => setInfoOpen(true)} />
        </StalePanel>
      )}
      {period === 'W' && (
        <StalePanel stale={weekStale}>
          <WorkoutWeekView
            type={type}
            count={isCurrent ? count : weekData?.sessionCount ?? 0}
            weekActiveDays={isCurrent ? weekActiveDays : weekData?.activeDays ?? [false, false, false, false, false, false, false]}
            weeklyEarned={isCurrent ? weeklyEarned : weekData?.points ?? 0}
            isCurrentWeek={isCurrent}
            onInfo={() => setInfoOpen(true)}
            weekStart={weekAnchorMonday(offset)}
            markedKey={daySel.markedKey}
            onSelectDay={daySel.open}
            distancePerDay={weekData?.distancePerDay ?? null}
          />
        </StalePanel>
      )}
      {period === 'M' && (
        <StalePanel stale={monthStale}>
          <WorkoutMonthView type={type} data={monthData} offset={offset} markedKey={daySel.markedKey} onSelectDay={daySel.open} />
        </StalePanel>
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
        visible={daySel.day !== null}
        onClose={daySel.close}
        type={type}
        period="D"
        offset={0}
        day={daySel.day}
        days={daySel.days}
        onDayChange={daySel.step}
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
