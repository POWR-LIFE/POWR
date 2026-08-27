import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ZONE_TINTS } from '@/components/progress/zoneTints';
import { RangeDotChart, Sparkline } from '@/components/progress/Sparkline';
import { useActivityRevision } from '@/hooks/useActivityRevision';
import { localDateStr } from '@/lib/api/activity';
import {
    deriveBodySignals,
    fetchBodyTrends,
    isEmptyTrends,
    LOAD_DAYS,
    readinessOf,
    TREND_DAYS,
    type BodySignals,
    type BodyTrends,
    type TrendPoint,
} from '@/lib/api/bodyTrends';

// ─── Design tokens (match progress.tsx / SleepTab) ───────────────────────────

const TEXT  = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM   = 'rgba(255,255,255,0.5)';
/**
 * One hue per domain, so each section is recognisable by colour alone:
 * rose = heart (resting HR, and the zone ramp the sheet already uses),
 * teal = recovery (HRV), indigo = sleep (the app-wide sleep colour),
 * orange = training load (from the radials' effort gradients). GOLD stays
 * POWR's alone and never appears here.
 */
const ROSE  = '#FB7185';
const TEAL  = '#2DD4BF';
const INDIGO = '#818cf8';
const ORANGE = '#fb923c';
/** "In a good place" — the green Home already uses for streaks and walking. */
const GREEN = '#4ade80';

/** Trend chart heights — taller than the v1 sparklines so the day-to-day
 *  movement is legible (Jamie's pass; a scrollable window was tried and
 *  reverted — it fought the tab carousel for the horizontal gesture). */
const RHR_CHART_H = 84;
const HRV_CHART_H = 120;

const LOAD_BAR_H = 56;
const SLEEP_BAR_H = 44;
const SLEEP_NIGHTS = 14;
const SLEEP_GOAL_H = 8;
/** Sleep bars scale against 10h, same rule as SleepTab's week chart. */
const SLEEP_SCALE_H = 10;

/**
 * BODY — the trends behind the sessions: resting heart rate, HRV, sleep and
 * training load, from data the app already collects. Fixed windows (30-day
 * trends, 7-day load) rather than the D/W/M stepper: this tab answers "how am
 * I trending", not "what happened on the 12th" — the other tabs own that.
 *
 * Each metric wears its OWN visual form, on purpose: resting HR is a filled
 * trend line (a continuous daily signal), HRV is stem-and-dot marks (per-
 * workout events — a line would invent a trend across unmeasured days), sleep
 * is nightly bars against a goal line (the same visual language as SleepTab),
 * and load is stacked day columns. A stack of identical line charts read as
 * one grey wall; the form is what makes each number recognisable at a glance.
 *
 * Every block renders only when it has real data (HRV needs 3+ readings before
 * a trend means anything), so a phone-only user sees a small tab, not a wall
 * of empty cards. The signals row + insight line are plain language derived
 * from the user's own baselines — never a percentage score, because we can't
 * compute one honestly without continuous overnight data.
 */
export function BodyTab({ initialTrends }: { initialTrends?: BodyTrends | null }) {
    const [trends, setTrends] = useState<BodyTrends | null>(initialTrends ?? null);
    const [failed, setFailed] = useState(false);
    // Re-fetches on pull-to-refresh, which bumps the shared activity revision.
    const revision = useActivityRevision();

    const load = useCallback(async () => {
        try {
            setTrends(await fetchBodyTrends());
            setFailed(false);
        } catch (err) {
            console.error('[BodyTab] load failed:', err);
            setFailed(true);
        }
    }, []);

    // When a parent passes trends, keep in sync with its refreshes instead of
    // fetching independently — avoids a duplicate Supabase round-trip.
    useEffect(() => {
        if (initialTrends !== undefined) {
            setTrends(initialTrends);
        }
    }, [initialTrends]);

    // Self-fetch only when no parent is providing trends (standalone use).
    useEffect(() => {
        if (initialTrends === undefined) { load(); }
    }, [load, revision]);

    if (failed) {
        return (
            <View style={styles.emptyState}>
                <Ionicons name="pulse-outline" size={28} color={MUTED} />
                <Text style={styles.emptyText}>Couldn&apos;t load your trends.</Text>
                <Text style={styles.emptySubtext}>Pull to refresh and try again.</Text>
            </View>
        );
    }

    if (!trends) {
        return (
            <View style={styles.emptyState}>
                <Text style={styles.emptySubtext}>Loading…</Text>
            </View>
        );
    }

    if (isEmptyTrends(trends)) {
        return (
            <View style={styles.emptyState}>
                <Ionicons name="pulse-outline" size={28} color={MUTED} />
                <Text style={styles.emptyText}>No body data yet.</Text>
                <Text style={styles.emptySubtext}>
                    Resting heart rate, sleep and training load appear here as your
                    device syncs them.
                </Text>
            </View>
        );
    }

    const d = deriveBodySignals(trends);
    const rhr = latest(trends.restingHr);
    const showHrv = trends.hrv.length >= 3;
    const hrv = latest(trends.hrv);
    const hasLoad = trends.load.some(day => day.activeMin > 0);

    return (
        <View style={styles.tabPanel}>
            <SignalsRow d={d} />
            <View style={styles.insightRow}>
                <Ionicons name="pulse" size={12} color={ROSE} />
                <Text style={styles.insightText}>{buildInsight(d)}</Text>
            </View>

            {trends.restingHr.length > 0 && (
                <>
                    <View style={styles.tabSep} />
                    <Text style={styles.tabSubLabel}>RESTING HEART RATE · {TREND_DAYS} DAYS</Text>
                    <View style={styles.metricHead}>
                        <Text style={styles.metricVal}>
                            {Math.round(rhr!.value)}
                            <Text style={styles.metricUnit}> bpm · {whenLabel(rhr!.date)}</Text>
                        </Text>
                        {d.rhrAvg != null && trends.restingHr.length >= 5 && (
                            <Text style={styles.metricDelta}>
                                {deltaLabel(rhr!.value - d.rhrAvg, 'bpm')} vs your average — lower is fitter
                            </Text>
                        )}
                    </View>
                    <View style={styles.chartBlock}>
                        <Sparkline points={trends.restingHr} days={TREND_DAYS} height={RHR_CHART_H} goodDirection="down" />
                        {/* No legend: the baseline is the average the headline
                            already names, and the high/low now sit on their own
                            dots inside the chart. */}
                        <AxisRow left={`${TREND_DAYS} days ago`} right="today" />
                    </View>
                </>
            )}

            {showHrv && (
                <>
                    <View style={styles.tabSep} />
                    <Text style={styles.tabSubLabel}>RECOVERY (HRV) · {TREND_DAYS} DAYS</Text>
                    <View style={styles.metricHead}>
                        <Text style={styles.metricVal}>
                            {Math.round(hrv!.value)}
                            <Text style={styles.metricUnit}> ms · {whenLabel(hrv!.date)}</Text>
                        </Text>
                        <Text style={styles.metricDelta}>one dot per reading — higher is fresher</Text>
                    </View>
                    <View style={styles.chartBlock}>
                        <RangeDotChart points={trends.hrv} days={TREND_DAYS} height={HRV_CHART_H} color={TEAL} goodDirection="up" />
                        <AxisRow left={`${TREND_DAYS} days ago`} right="today" />
                        <ChartLegend items={[
                            { swatch: 'box', color: 'rgba(45,212,191,0.3)', label: 'your typical range' },
                            { swatch: 'dash', color: 'rgba(255,255,255,0.35)', label: 'average' },
                        ]} />
                    </View>
                </>
            )}

            {trends.week.zoneMixSec.length > 0 && (
                <>
                    <View style={styles.tabSep} />
                    <Text style={styles.tabSubLabel}>EFFORT MIX · THIS WEEK</Text>
                    <View style={styles.metricHead}>
                        <Text style={styles.metricVal}>
                            {formatMin(trends.week.zoneMixSec.reduce((s, v) => s + v, 0) / 60)}
                            <Text style={styles.metricUnit}> at raised heart rate</Text>
                        </Text>
                        {trends.week.peakHr != null && (
                            <Text style={styles.metricDelta}>peak heart rate {Math.round(trends.week.peakHr)} bpm</Text>
                        )}
                    </View>
                    <EffortMixBar zoneMixSec={trends.week.zoneMixSec} />
                </>
            )}

            {trends.sleepHours.length > 0 && (
                <>
                    <View style={styles.tabSep} />
                    <Text style={styles.tabSubLabel}>SLEEP · LAST {SLEEP_NIGHTS} NIGHTS</Text>
                    <View style={styles.metricHead}>
                        <Text style={styles.metricVal}>
                            {d.sleepAvg7 != null ? formatMin(d.sleepAvg7 * 60) : '—'}
                            <Text style={styles.metricUnit}> avg per night this week</Text>
                        </Text>
                        <Text style={styles.metricDelta}>{regularityLabel(trends.sleepHours)}</Text>
                    </View>
                    <SleepBars points={trends.sleepHours} />
                </>
            )}

            {hasLoad && (
                <>
                    <View style={styles.tabSep} />
                    <Text style={styles.tabSubLabel}>TRAINING LOAD · LAST {LOAD_DAYS} DAYS</Text>
                    <View style={styles.metricHead}>
                        <Text style={styles.metricVal}>
                            {formatMin(trends.load.reduce((s, day) => s + day.activeMin, 0))}
                            <Text style={styles.metricUnit}> of exercise</Text>
                        </Text>
                        <Text style={styles.metricDelta}>{loadSummary(trends)}</Text>
                    </View>
                    <LoadChart trends={trends} />
                </>
            )}
        </View>
    );
}

/** "1,850 kcal burned · 45m at hard effort" — whatever of the pair exists.
 *  No "this week" suffix: the section label already says LAST 7 DAYS. */
function loadSummary(t: BodyTrends): string {
    const parts: string[] = [];
    if (t.week.kcal > 0) parts.push(`${t.week.kcal.toLocaleString()} kcal burned`);
    const hard = t.load.reduce((s, day) => s + day.hardMin, 0);
    if (hard > 0) parts.push(`${formatMin(hard)} at hard effort`);
    return parts.join(' · ');
}

// ─── Effort mix ──────────────────────────────────────────────────────────────

/**
 * The week's time-in-zone as one stacked bar — the same rose ramp as a single
 * session's zone bar in the breakdown sheet, so the two read as one system.
 * Zone 0 (below 50% max) draws for honesty but stays out of the legend; it's
 * rest, not effort.
 *
 * The legend speaks plain words, not zone codes: "Z1 14m" means nothing at
 * first glance (Jamie's call), so the five zones roll up into three efforts —
 * light (Z1–2), hard (Z3–4), max (Z5) — each wearing the ramp tint of its
 * upper zone. The per-zone detail stays visible in the bar's segments and in
 * the day sheet, where the reader is comparing against their watch app.
 */
function EffortMixBar({ zoneMixSec }: { zoneMixSec: number[] }) {
    const sumZones = (from: number, to: number) =>
        zoneMixSec.reduce((s, sec, zone) => zone >= from && zone <= to ? s + sec : s, 0);
    const groups = [
        { label: 'light effort', sec: sumZones(1, 2), tint: ZONE_TINTS[2] },
        { label: 'hard', sec: sumZones(3, 4), tint: ZONE_TINTS[4] },
        { label: 'max', sec: sumZones(5, Infinity), tint: ZONE_TINTS[5] },
    ].filter(g => g.sec >= 60);

    return (
        <View style={styles.zoneBlock}>
            <View style={styles.zoneBar}>
                {zoneMixSec.map((sec, zone) => sec > 0 && (
                    <View
                        key={zone}
                        style={{ flex: sec, backgroundColor: ZONE_TINTS[Math.min(zone, ZONE_TINTS.length - 1)] }}
                    />
                ))}
            </View>
            <View style={styles.zoneLegend}>
                {groups.map(g => (
                    <View key={g.label} style={styles.zoneLegendItem}>
                        <View style={[styles.zoneDot, { backgroundColor: g.tint }]} />
                        <Text style={styles.zoneLegendText}>{formatMin(g.sec / 60)} {g.label}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
}

// ─── Signals row ─────────────────────────────────────────────────────────────

/** A chip's traffic-light state. 'none' = nothing recent to judge. */
type SignalLevel = 'green' | 'amber' | 'red' | 'none';

type Signal = {
    label: string;
    level: SignalLevel;
    /** The verdict, worn in the light's colour — "Short night", "Primed". */
    verdict: string;
    /** The number behind the verdict, quiet — "1.5h slept", "no training". */
    detail: string;
};

const LEVEL_TINTS: Record<SignalLevel, string> = {
    green: GREEN,
    amber: ORANGE,
    red: ROSE,
    none: MUTED,
};

/**
 * Three at-a-glance judgements before any chart: last night, a derived
 * READINESS word, and yesterday's load. Each chip is a traffic light — a
 * green / amber / red lamp everyone already knows how to read — with the
 * verdict in plain words beside it and the number tucked underneath. The
 * light and the word carry the meaning; a first-time reader needs no key.
 *
 * Deliberately words and lights, never a score: a resting HR printed here
 * read as "your heart rate right now", which it is not — and a percentage
 * would be a recovery number we can't compute honestly from this data.
 * Amber wears orange, not true amber — gold is POWR's alone.
 */
function SignalsRow({ d }: { d: BodySignals }) {
    const r = readinessOf(d);

    // One thing off (ring ≥ 2/3) is a caution; more than one is a stop.
    const readinessLevel: SignalLevel =
        r.level === 'good' ? 'green'
        : r.level === 'attention' ? (r.ring >= 2 / 3 ? 'amber' : 'red')
        : 'none';

    // The detail is the RECOMMENDATION, not the cause — the cause is already
    // on the neighbouring lamps and in the insight sentence below, and
    // repeating "short night" here made the row say one thing twice.
    const readinessDetail =
        r.level === 'unknown' ? r.reason
        : r.level === 'good' ? 'good day to push'
        : r.word === 'Rest' ? 'go light today'
        : 'take it easy today';

    const signals: Signal[] = [
        sleepSignal(d),
        {
            label: 'READINESS',
            level: readinessLevel,
            verdict: r.word === '—' ? 'No data' : r.word,
            detail: readinessDetail,
        },
        {
            label: 'YESTERDAY',
            level: d.bigDay ? 'amber' : 'green',
            verdict: d.bigDay ? 'Big day' : d.yesterdayMin === 0 ? 'Rest day' : 'Trained',
            detail: d.yesterdayMin === 0 ? 'no training' : `${d.yesterdayMin}m of exercise`,
        },
    ];

    return (
        <View style={styles.signalsRow}>
            {signals.map((s, i) => (
                <React.Fragment key={s.label}>
                    {i > 0 && <View style={styles.signalDivider} />}
                    <View style={styles.signal}>
                        <Text style={styles.signalLabel}>{s.label}</Text>
                        <View style={styles.signalLamp}>
                            <View style={[styles.signalHalo, { backgroundColor: `${LEVEL_TINTS[s.level]}2E` }]}>
                                <View style={[styles.signalDot, { backgroundColor: LEVEL_TINTS[s.level] }]} />
                            </View>
                            <Text style={[styles.signalVerdict, s.level === 'none' && { color: DIM }]}>
                                {s.verdict}
                            </Text>
                        </View>
                        <Text style={styles.signalDetail}>{s.detail}</Text>
                    </View>
                </React.Fragment>
            ))}
        </View>
    );
}

/**
 * Last night as a traffic light. Red is a genuinely short night (< 6h),
 * amber is shy of a solid one — under 7h, or well below the user's own
 * usual — and green is a proper night. Thresholds sit alongside the
 * shared `shortNight` flag rather than replacing it: readiness and the
 * insight sentence keep their single judgement, this only grades it.
 */
function sleepSignal(d: BodySignals): Signal {
    if (!d.tracksSleep) {
        // Thirty days of other readings and not one night: the device isn't
        // worn to bed. Say so. "Waiting on your device" was a promise that
        // could never be kept, and a promise that never lands reads as a
        // broken page.
        return { label: 'LAST NIGHT', level: 'none', verdict: 'Not tracked', detail: 'wear your device to bed' };
    }
    if (!d.nightFresh) {
        return { label: 'LAST NIGHT', level: 'none', verdict: 'Not synced', detail: 'waiting on your device' };
    }
    const h = d.nightFresh.value;
    const level: SignalLevel = h < 6 ? 'red' : (h < 7 || d.shortNight) ? 'amber' : 'green';
    return {
        label: 'LAST NIGHT',
        level,
        verdict: level === 'red' ? 'Short night' : level === 'amber' ? 'A bit short' : 'Rested',
        // "slept 1h 30m" reads as a sentence under the LAST NIGHT label;
        // "1.5h slept" read as a unit nobody uses.
        detail: `slept ${formatMin(h * 60)}`,
    };
}

/** The quiet caption strip under a chart — its time axis and how to read it. */
function AxisRow({ left, centre, right }: { left: string; centre?: string; right: string }) {
    return (
        <View style={styles.axisRow}>
            <Text style={styles.axisText}>{left}</Text>
            {centre ? <Text style={styles.axisText}>{centre}</Text> : null}
            <Text style={styles.axisText}>{right}</Text>
        </View>
    );
}

// ─── Chart legend ────────────────────────────────────────────────────────────

type LegendItem = {
    /** 'box' = a bar's fill, 'line' = a reference line, 'dash' = a dashed one. */
    swatch: 'box' | 'line' | 'dash';
    color: string;
    label: string;
};

/**
 * Swatch legend under a chart — a little coloured box beside each word, the
 * same language as the effort-mix legend, because "solid = goal met" in prose
 * asks the reader to translate; a swatch they can match by eye doesn't.
 */
function ChartLegend({ items }: { items: LegendItem[] }) {
    return (
        <View style={styles.legendRow}>
            {items.map(item => (
                <View key={item.label} style={styles.legendItem}>
                    {item.swatch === 'box' && (
                        <View style={[styles.legendBox, { backgroundColor: item.color }]} />
                    )}
                    {item.swatch === 'line' && (
                        <View style={[styles.legendLine, { backgroundColor: item.color }]} />
                    )}
                    {item.swatch === 'dash' && (
                        <View style={styles.legendDash}>
                            <View style={[styles.legendDashSeg, { backgroundColor: item.color }]} />
                            <View style={[styles.legendDashSeg, { backgroundColor: item.color }]} />
                        </View>
                    )}
                    <Text style={styles.zoneLegendText}>{item.label}</Text>
                </View>
            ))}
        </View>
    );
}

// ─── Sleep bars ──────────────────────────────────────────────────────────────

/**
 * One bar per night against a dashed 8h goal line — the same bars-and-goal
 * language as SleepTab's week chart, at trend density. Missing nights keep
 * their empty track so a patchy fortnight looks patchy.
 */
function SleepBars({ points }: { points: TrendPoint[] }) {
    const byDate = new Map(points.map(p => [p.date, p.value]));
    const nights: { date: string; hours: number }[] = [];
    for (let i = SLEEP_NIGHTS - 1; i >= 0; i--) {
        const day = new Date();
        day.setHours(0, 0, 0, 0);
        day.setDate(day.getDate() - i);
        const date = localDateStr(day);
        nights.push({ date, hours: byDate.get(date) ?? 0 });
    }

    return (
        <View>
            <View style={styles.sleepChart}>
                {nights.map(n => {
                    const h = n.hours > 0
                        ? Math.max(3, Math.round((Math.min(n.hours, SLEEP_SCALE_H) / SLEEP_SCALE_H) * SLEEP_BAR_H))
                        : 0;
                    const metGoal = n.hours >= SLEEP_GOAL_H - 0.25;
                    return (
                        <View key={n.date} style={styles.sleepTrack}>
                            {h > 0 && (
                                <View style={[
                                    styles.sleepFill,
                                    { height: h, backgroundColor: metGoal ? INDIGO : `${INDIGO}60` },
                                ]} />
                            )}
                        </View>
                    );
                })}
                <View style={styles.sleepGoalLine} pointerEvents="none" />
            </View>
            <AxisRow left={`${SLEEP_NIGHTS} nights ago`} right="last night" />
            <ChartLegend items={[
                { swatch: 'dash', color: 'rgba(255,255,255,0.35)', label: `${SLEEP_GOAL_H}h goal` },
                { swatch: 'box', color: INDIGO, label: 'goal met' },
                { swatch: 'box', color: `${INDIGO}60`, label: 'short of goal' },
            ]} />
        </View>
    );
}

// ─── Load chart ──────────────────────────────────────────────────────────────

/** Height of a load column's footer: day-initial line plus the column gap. */
const LOAD_FOOTER_H = 16;

/**
 * 7 columns of minutes trained per day. Load wears orange, and intensity is
 * DEPTH of the same hue — the solid base of a bar is its hard time —
 * mirroring the zone ramp's one-hue rule rather than adding a fifth colour.
 * The reference line is the user's own average day, so a heavy or light day
 * reads against THEIR week, and the caption strip says what each mark means.
 */
function LoadChart({ trends }: { trends: BodyTrends }) {
    const max = Math.max(60, ...trends.load.map(d => d.activeMin));
    const totalHard = trends.load.reduce((s, d) => s + d.hardMin, 0);
    const avg = trends.load.reduce((s, d) => s + d.activeMin, 0) / trends.load.length;
    const avgBottom = LOAD_FOOTER_H + Math.round((avg / max) * LOAD_BAR_H);

    return (
        <View style={styles.chartBlock}>
            <View style={styles.loadChart}>
                {trends.load.map(d => {
                    const h = d.activeMin > 0 ? Math.max(3, Math.round((d.activeMin / max) * LOAD_BAR_H)) : 0;
                    const hardH = d.hardMin > 0 ? Math.max(2, Math.round((d.hardMin / max) * LOAD_BAR_H)) : 0;
                    const isToday = d === trends.load[trends.load.length - 1];
                    return (
                        <View key={d.date} style={styles.loadCol}>
                            <Text style={styles.loadMins}>{d.activeMin > 0 ? `${d.activeMin}m` : '—'}</Text>
                            <View style={styles.loadTrack}>
                                {h > 0 && (
                                    <View style={[styles.loadFill, { height: h, backgroundColor: isToday ? 'rgba(251,146,60,0.5)' : 'rgba(251,146,60,0.28)' }]}>
                                        {hardH > 0 && <View style={[styles.loadHard, { height: hardH }]} />}
                                    </View>
                                )}
                            </View>
                            <Text style={[styles.loadDay, isToday && { color: TEXT, fontWeight: '600' }]}>
                                {dayInitial(d.date)}
                            </Text>
                        </View>
                    );
                })}
                {avg > 0 && (
                    <>
                        <View style={[styles.loadAvgLine, { bottom: avgBottom }]} pointerEvents="none" />
                        <Text style={[styles.loadAvgLabel, { bottom: avgBottom + 2 }]}>
                            avg {Math.round(avg)}m
                        </Text>
                    </>
                )}
            </View>
            <ChartLegend items={[
                { swatch: 'box', color: 'rgba(251,146,60,0.3)', label: 'minutes trained' },
                ...(totalHard > 0
                    ? [{ swatch: 'box' as const, color: ORANGE, label: 'hard effort' }]
                    : []),
                ...(avg > 0
                    ? [{ swatch: 'line' as const, color: 'rgba(255,255,255,0.35)', label: 'your average day' }]
                    : []),
            ]} />
        </View>
    );
}

// ─── Derivations ─────────────────────────────────────────────────────────────

function latest(series: TrendPoint[]): TrendPoint | null {
    return series.length > 0 ? series[series.length - 1] : null;
}

function mean(series: TrendPoint[]): number | null {
    if (series.length === 0) return null;
    return series.reduce((s, p) => s + p.value, 0) / series.length;
}

function deltaLabel(delta: number, unit: string): string {
    const r = Math.round(delta);
    if (r === 0) return 'level';
    return `${r > 0 ? '+' : '−'}${Math.abs(r)} ${unit}`;
}

/** Spread of nightly hours as plain language — minutes, not "±0.6h". */
function regularityLabel(series: TrendPoint[]): string {
    if (series.length < 4) return 'trends sharpen as more nights land';
    const m = mean(series)!;
    const sd = Math.sqrt(series.reduce((s, p) => s + (p.value - m) ** 2, 0) / series.length);
    return `most nights within ${formatMin(sd * 60)} of your average`;
}

/**
 * When a reading is from, in words — "today", "yesterday", "Mon", "12 Aug".
 * Sits beside the big latest-value numbers so a days-old reading can never
 * pass as a live one (the same worry that made the readiness chip a word).
 */
function whenLabel(date: string): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(`${date}T00:00:00`);
    const daysAgo = Math.round((today.getTime() - d.getTime()) / 86400000);
    if (daysAgo <= 0) return 'today';
    if (daysAgo === 1) return 'yesterday';
    if (daysAgo < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function dayInitial(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'narrow' });
}

/** 132 → "2h 12m", 45 → "45m" — same h/m form the breakdown sheet uses. */
function formatMin(mins: number): string {
    const m = Math.round(mins);
    if (m >= 60) {
        const rem = m % 60;
        return rem > 0 ? `${Math.floor(m / 60)}h ${rem}m` : `${Math.floor(m / 60)}h`;
    }
    return `${m}m`;
}

/**
 * One plain sentence from the user's own baselines. Deliberately NOT a score:
 * a "Recovery 60%" needs continuous overnight measurement we don't have, so
 * this says only what the data genuinely supports, worst signal first.
 */
function buildInsight(d: BodySignals): string {
    if (d.rhrElevated) {
        return `Resting heart rate is ${deltaLabel(d.rhrFresh!.value - d.rhrAvg!, 'bpm')} above your usual — worth keeping today steadier.`;
    }
    if (d.shortNight) {
        return `Short night (${formatMin(d.nightFresh!.value * 60)}) — an easy session will do more for you than a hard one today.`;
    }
    if (d.bigDay) {
        return `Big day yesterday (${formatMin(d.yesterdayMin)} of training) — recovery is part of the work.`;
    }
    if (d.nightFresh && d.rhrFresh && d.rhrAvg != null && d.rhrFresh.value <= d.rhrAvg) {
        return `Slept ${formatMin(d.nightFresh.value * 60)} and resting heart rate is at or below your average — good day to push.`;
    }
    if (d.nightFresh) {
        return `Slept ${formatMin(d.nightFresh.value * 60)} last night. Trends below build as your device syncs.`;
    }
    // No night to speak of — for a wearer who never takes the device to bed,
    // resting heart rate carries the whole read. Speak to what IS there rather
    // than promising trends that "build as your device syncs" to someone whose
    // device has been syncing all along.
    if (d.rhrFresh && d.rhrBaselineReady && d.rhrAvg != null) {
        const diff = Math.round(d.rhrFresh.value - d.rhrAvg);
        const vs = diff < 0 ? `${Math.abs(diff)} bpm below your average`
            : diff > 0 ? `${diff} bpm above your average`
            : 'right on your average';
        return `Resting heart rate is ${vs} — good day to push.`;
    }
    if (d.rhrFresh) {
        return `Resting heart rate ${Math.round(d.rhrFresh.value)} bpm ${whenLabel(d.rhrFresh.date)}. A few more days and you'll see how that compares to your usual.`;
    }
    if (d.weekActiveDays > 0) {
        const trained = `Trained ${d.weekActiveDays} of the last ${LOAD_DAYS} days (${formatMin(d.weekActiveMin)}).`;
        return !d.tracksSleep && !d.tracksRhr
            ? `${trained} Readiness needs sleep or resting heart rate from your device.`
            : `${trained} No recent sleep or heart-rate reading to judge recovery.`;
    }
    return 'Your trends build here as your device syncs — the more days, the sharper the picture.';
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    tabPanel: { gap: 16 },

    emptyState: { alignItems: 'center', gap: 8, paddingVertical: 28 },
    emptyText: { fontSize: 13, fontWeight: '400', color: DIM },
    emptySubtext: {
        fontSize: 11, fontWeight: '300', color: MUTED,
        textAlign: 'center', paddingHorizontal: 24,
    },

    signalsRow: { flexDirection: 'row', alignItems: 'flex-start' },
    signal: { flex: 1, alignItems: 'center', gap: 4 },
    signalDivider: {
        width: 1, height: 52, alignSelf: 'center',
        backgroundColor: 'rgba(255,255,255,0.07)',
    },
    signalLabel: {
        fontSize: 8, fontWeight: '500', letterSpacing: 1.5,
        color: MUTED, textTransform: 'uppercase',
    },
    signalLamp: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    // The lamp: a solid light inside a soft halo of its own colour, so the
    // green / amber / red reads even at a glance on a bright screen.
    signalHalo: {
        width: 16, height: 16, borderRadius: 8,
        alignItems: 'center', justifyContent: 'center',
    },
    signalDot: { width: 8, height: 8, borderRadius: 4 },
    signalVerdict: { fontSize: 14, fontWeight: '400', letterSpacing: -0.2, color: TEXT },
    signalDetail: { fontSize: 9, fontWeight: '300', color: DIM },

    insightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
    insightText: { fontSize: 12, fontWeight: '300', color: DIM, flex: 1, lineHeight: 18 },

    tabSep: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
    tabSubLabel: {
        fontSize: 8, fontWeight: '500', letterSpacing: 1.5,
        color: MUTED, textTransform: 'uppercase',
    },

    metricHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
    metricVal: { fontSize: 30, fontWeight: '100', letterSpacing: -1, color: TEXT },
    metricUnit: { fontSize: 11, fontWeight: '300', color: MUTED, letterSpacing: 0 },
    metricDelta: { fontSize: 10, fontWeight: '300', color: MUTED, flexShrink: 1 },

    sleepChart: {
        flexDirection: 'row', alignItems: 'flex-end', gap: 3,
        height: SLEEP_BAR_H, position: 'relative',
    },
    sleepTrack: {
        flex: 1, height: SLEEP_BAR_H,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 2, justifyContent: 'flex-end', overflow: 'hidden',
    },
    sleepFill: { width: '100%', borderRadius: 2 },
    // 8h of a 10h-tall track = 80% up.
    sleepGoalLine: {
        position: 'absolute', left: 0, right: 0,
        bottom: (SLEEP_GOAL_H / SLEEP_SCALE_H) * SLEEP_BAR_H,
        height: 1, backgroundColor: 'rgba(255,255,255,0.18)',
    },
    chartBlock: { gap: 4 },
    axisRow: {
        flexDirection: 'row', justifyContent: 'space-between', marginTop: 4,
    },
    axisText: { fontSize: 8, fontWeight: '300', color: MUTED },

    loadChart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, position: 'relative' },
    loadAvgLine: {
        position: 'absolute', left: 0, right: 0,
        height: 1, backgroundColor: 'rgba(255,255,255,0.22)',
    },
    loadAvgLabel: {
        position: 'absolute', right: 0,
        fontSize: 7, fontWeight: '300', color: 'rgba(255,255,255,0.35)',
    },
    loadCol: { flex: 1, alignItems: 'center', gap: 4 },
    loadMins: { fontSize: 8, fontWeight: '400', color: MUTED },
    loadTrack: {
        width: '100%', height: LOAD_BAR_H,
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden',
    },
    loadFill: {
        width: '100%', borderRadius: 4,
        justifyContent: 'flex-end', overflow: 'hidden',
    },
    loadHard: { width: '100%', backgroundColor: ORANGE },
    loadDay: { fontSize: 9, fontWeight: '400', color: MUTED },

    legendRow: {
        flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4,
        justifyContent: 'center', marginTop: 2,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    legendBox: { width: 8, height: 8, borderRadius: 2 },
    legendLine: { width: 12, height: 2, borderRadius: 1 },
    legendDash: { flexDirection: 'row', gap: 2 },
    legendDashSeg: { width: 5, height: 1.5, borderRadius: 1 },

    zoneBlock: { gap: 8 },
    zoneBar: {
        flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden',
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    zoneLegend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 },
    zoneLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    zoneDot: { width: 6, height: 6, borderRadius: 3 },
    zoneLegendText: { fontSize: 9, fontWeight: '300', color: MUTED },
});
