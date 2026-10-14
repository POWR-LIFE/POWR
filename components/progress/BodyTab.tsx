import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ZONE_TINTS } from '@/components/progress/zoneTints';
import { RangeDotChart, Sparkline } from '@/components/progress/Sparkline';
import { useActivityRevision } from '@/hooks/useActivityRevision';
import { useHrvAccessPrompt } from '@/hooks/useHrvAccessPrompt';
import { localDateStr } from '@/lib/api/activity';
import {
    deriveBodySignals,
    fetchBodyTrends,
    isEmptyTrends,
    LOAD_DAYS,
    readinessOf,
    SLEEP_GOAL_H,
    TREND_DAYS,
    type BasisSignal,
    type BodySignals,
    type BodyTrends,
    type TrendPoint,
} from '@/lib/api/bodyTrends';
import i18n, { getFormatLocale } from '@/lib/i18n';

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
/** Sleep bars scale against 10h, same rule as SleepTab's week chart. */
const SLEEP_SCALE_H = 10;
/**
 * HRV drawn as a line needs this many readings in the window — below it the
 * device is measuring per workout, not per night, and the dots-on-a-band form
 * is the honest one (a line would invent a trend across unmeasured days).
 */
const HRV_LINE_MIN_READINGS = 10;

/**
 * BODY — the trends behind the sessions: resting heart rate, HRV, sleep and
 * training load, from data the app already collects. Fixed windows (30-day
 * trends, 7-day load) rather than the D/W/M stepper: this tab answers "how am
 * I trending", not "what happened on the 12th" — the other tabs own that.
 *
 * Each metric wears its OWN visual form, on purpose: resting HR is a filled
 * trend line (a continuous daily signal), HRV is the same line once the device
 * measures it nightly and stem-and-dot marks while it is per-workout, sleep
 * is nightly bars against a goal line (the same visual language as SleepTab),
 * and load is stacked day columns. A stack of identical line charts read as
 * one grey wall; the form is what makes each number recognisable at a glance.
 *
 * Every block renders only when it has real data (HRV needs 3+ readings before
 * a trend means anything), so a phone-only user sees a small tab, not a wall
 * of empty cards. The signals row + insight line are plain language from the
 * user's own baselines. The one number allowed near the verdict is a provider's
 * own recovery score (Whoop's, Oura's) — computed from the overnight signal we
 * only hold summaries of, so relayed rather than re-derived. We never invent
 * a percentage of our own.
 */
export function BodyTab({ initialTrends, deviceName, onTrendsStale }: {
    initialTrends?: BodyTrends | null;
    /** The connected wearable as the user knows it ("WHOOP"); omit for phone-only. */
    deviceName?: string;
    /** With initialTrends: asks the parent to re-fetch (after new HRV access lands rows). */
    onTrendsStale?: () => void;
}) {
    const { t } = useTranslation();
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

    // Phone-only users who connected Apple Health before HRV was read have never
    // been asked for it. Ask here, where HRV shows — only while there isn't
    // enough HRV to draw, and never for a cloud wearable (Terra sends its own).
    const hrvAccess = useHrvAccessPrompt(
        !deviceName && !!trends && !isEmptyTrends(trends) && trends.hrv.length < 3,
        initialTrends !== undefined ? onTrendsStale : load,
    );

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
                <Text style={styles.emptyText}>{t('progress:body.failed')}</Text>
                <Text style={styles.emptySubtext}>{t('progress:body.failedHint')}</Text>
            </View>
        );
    }

    if (!trends) {
        return (
            <View style={styles.emptyState}>
                <Text style={styles.emptySubtext}>{t('progress:loading')}</Text>
            </View>
        );
    }

    if (isEmptyTrends(trends)) {
        return (
            <View style={styles.emptyState}>
                <Ionicons name="pulse-outline" size={28} color={MUTED} />
                <Text style={styles.emptyText}>{t('progress:body.empty')}</Text>
                <Text style={styles.emptySubtext}>
                    {t('progress:body.emptyHint')}
                </Text>
            </View>
        );
    }

    const d = deriveBodySignals(trends);
    const rhr = latest(trends.restingHr);
    const showHrv = trends.hrv.length >= 3;
    const hrvAsLine = trends.hrv.length >= HRV_LINE_MIN_READINGS;
    const hrv = latest(trends.hrv);
    const weekMin = trends.load.reduce((s, day) => s + day.activeMin, 0);
    // The load section stays once the user has trained at all in the last
    // four weeks: a quiet week reads as seven empty columns against the usual
    // week, not as a section that has silently disappeared.
    const hasLoad = weekMin > 0 || trends.loadNormWeekMin != null;

    const loadSection = hasLoad && (
        <>
            <Text style={styles.tabSubLabel}>{t('progress:body.load.title', { days: LOAD_DAYS })}</Text>
            <View style={styles.metricHead}>
                <Text style={styles.metricVal}>
                    {weekMin > 0 ? formatMin(weekMin) : '—'}
                    <Text style={styles.metricUnit}>
                        {' '}{weekMin > 0 ? t('progress:body.load.ofExercise') : t('progress:body.load.none')}
                    </Text>
                </Text>
                <Text style={styles.metricDelta}>{loadSummary(trends, d)}</Text>
            </View>
            <LoadChart trends={trends} />
        </>
    );

    const effortSection = trends.week.zoneMixSec.length > 0 && (
        <>
            <Text style={styles.tabSubLabel}>{t('progress:body.effort.title')}</Text>
            <View style={styles.metricHead}>
                <Text style={styles.metricVal}>
                    {formatMin(trends.week.zoneMixSec.reduce((s, v) => s + v, 0) / 60)}
                    <Text style={styles.metricUnit}> {t('progress:body.effort.raised')}</Text>
                </Text>
                {trends.week.peakHr != null && (
                    <Text style={styles.metricDelta}>{t('progress:body.effort.peak', { bpm: Math.round(trends.week.peakHr) })}</Text>
                )}
            </View>
            <EffortMixBar zoneMixSec={trends.week.zoneMixSec} />
        </>
    );

    // The device has gone quiet. Everything that judged TODAY — the lamps,
    // the insight, "68 bpm · 11 Sep", charts that stop a third short of the
    // right edge — was a page about a week that is over, and it read as dead
    // (Jamie, eight days off the wrist). So the tab re-forms around what is
    // still true: one plain statement of the gap and how to end it, the
    // training that POWR sees without a wearable, and the usual the first
    // morning back will be read against. The charts return with the data.
    if (d.quiet) {
        return (
            <View style={styles.tabPanel}>
                <QuietCard d={d} deviceName={deviceName} hasBaselines={hasBaselines(d)} />
                {loadSection && (
                    <>
                        <View style={styles.tabSep} />
                        {loadSection}
                    </>
                )}
                {effortSection && (
                    <>
                        <View style={styles.tabSep} />
                        {effortSection}
                    </>
                )}
                {hasBaselines(d) && (
                    <>
                        <View style={styles.tabSep} />
                        <Baselines d={d} trends={trends} />
                    </>
                )}
            </View>
        );
    }

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
                    <Text style={styles.tabSubLabel}>{t('progress:body.rhr.title', { days: TREND_DAYS })}</Text>
                    <View style={styles.metricHead}>
                        <Text style={styles.metricVal}>
                            {Math.round(rhr!.value)}
                            <Text style={styles.metricUnit}> {t('progress:body.rhr.unitWhen', { when: whenLabel(rhr!.date) })}</Text>
                        </Text>
                        <Text style={styles.metricDelta}>
                            {vitalDelta(rhr!, d.rhrAvg, d.rhrBaselineReady, 'bpm', t('progress:body.rhr.tip'))}
                        </Text>
                    </View>
                    <View style={styles.chartBlock}>
                        <Sparkline points={trends.restingHr} days={TREND_DAYS} height={RHR_CHART_H} goodDirection="down" />
                        {/* No legend: the baseline is the average the headline
                            already names, and the high/low now sit on their own
                            dots inside the chart. */}
                        <AxisRow left={t('progress:body.axis.daysAgo', { days: TREND_DAYS })} right={t('progress:body.axis.today')} />
                    </View>
                </>
            )}

            {!showHrv && hrvAccess.show && (
                <>
                    <View style={styles.tabSep} />
                    <Text style={styles.tabSubLabel}>{t('progress:body.hrv.prompt.title')}</Text>
                    <Pressable
                        style={styles.insightRow}
                        disabled={hrvAccess.busy}
                        onPress={hrvAccess.allow}
                        accessibilityRole="button"
                    >
                        <Ionicons name="pulse" size={12} color={TEAL} />
                        <Text style={[styles.insightText, styles.insightAction]}>
                            {hrvAccess.busy ? t('progress:body.hrv.prompt.asking') : t('progress:body.hrv.prompt.share')}
                        </Text>
                    </Pressable>
                </>
            )}

            {showHrv && (
                <>
                    <View style={styles.tabSep} />
                    <Text style={styles.tabSubLabel}>{t('progress:body.hrv.title', { days: TREND_DAYS })}</Text>
                    <View style={styles.metricHead}>
                        <Text style={styles.metricVal}>
                            {Math.round(hrv!.value)}
                            <Text style={styles.metricUnit}> {t('progress:body.hrv.unitWhen', { when: whenLabel(hrv!.date) })}</Text>
                        </Text>
                        <Text style={styles.metricDelta}>
                            {vitalDelta(hrv!, d.hrvAvg, d.hrvBaselineReady, 'ms', t('progress:body.hrv.tip'))}
                        </Text>
                    </View>
                    <View style={styles.chartBlock}>
                        {/* Nightly HRV is a signal like resting HR and wears
                            the same deviation line; a per-workout series stays
                            as dots on the band of the user's typical range. */}
                        {hrvAsLine
                            ? <Sparkline points={trends.hrv} days={TREND_DAYS} height={RHR_CHART_H} goodDirection="up" />
                            : <RangeDotChart points={trends.hrv} days={TREND_DAYS} height={HRV_CHART_H} color={TEAL} goodDirection="up" />}
                        <AxisRow left={t('progress:body.axis.daysAgo', { days: TREND_DAYS })} right={t('progress:body.axis.today')} />
                        {!hrvAsLine && (
                            <ChartLegend items={[
                                { swatch: 'box', color: 'rgba(45,212,191,0.3)', label: t('progress:body.legend.typicalRange') },
                                { swatch: 'dash', color: 'rgba(255,255,255,0.35)', label: t('progress:body.legend.average') },
                            ]} />
                        )}
                    </View>
                </>
            )}

            {effortSection && (
                <>
                    <View style={styles.tabSep} />
                    {effortSection}
                </>
            )}

            {trends.sleepHours.length > 0 && (
                <>
                    <View style={styles.tabSep} />
                    <Text style={styles.tabSubLabel}>{t('progress:body.sleep.title', { nights: SLEEP_NIGHTS })}</Text>
                    <View style={styles.metricHead}>
                        <Text style={styles.metricVal}>
                            {d.sleepAvg7 != null ? formatMin(d.sleepAvg7 * 60) : '—'}
                            <Text style={styles.metricUnit}>
                                {' '}{d.sleepAvg7 != null ? t('progress:body.sleep.avgPerNight') : t('progress:body.sleep.noNights')}
                            </Text>
                        </Text>
                        <Text style={styles.metricDelta}>{sleepSummary(d, trends)}</Text>
                    </View>
                    <SleepBars points={trends.sleepHours} />
                </>
            )}

            {loadSection && (
                <>
                    <View style={styles.tabSep} />
                    {loadSection}
                </>
            )}
        </View>
    );
}

// ─── Quiet device ────────────────────────────────────────────────────────────

const hasBaselines = (d: BodySignals): boolean =>
    d.rhrAvg != null || d.hrvAvg != null || d.sleepAvg30 != null;

/**
 * The gap, said once. Names the device, how long, and the one thing that ends
 * it — then the other reading of the same silence, because from here a strap
 * on the bedside table and a strap that has stopped syncing look identical.
 */
function QuietCard({ d, deviceName, hasBaselines: withBaselines }: {
    d: BodySignals; deviceName?: string; hasBaselines: boolean;
}) {
    const { t } = useTranslation();
    const days = d.vitalDaysAgo ?? 0;
    const wear = withBaselines
        ? deviceName
            ? t('progress:body.quiet.wearNamedBaselines', { device: deviceName })
            : t('progress:body.quiet.wearBaselines')
        : deviceName
            ? t('progress:body.quiet.wearNamed', { device: deviceName })
            : t('progress:body.quiet.wear');
    const sync = deviceName
        ? t('progress:body.quiet.syncNamed', { device: deviceName })
        : t('progress:body.quiet.sync');
    return (
        <View style={styles.quietCard}>
            <View style={styles.quietIcon}>
                <Ionicons name="watch-outline" size={18} color={DIM} />
            </View>
            <View style={styles.quietBody}>
                <Text style={styles.tabSubLabel}>
                    {t('progress:body.quiet.label', { device: (deviceName ?? t('progress:body.quiet.device')).toUpperCase(), days })}
                </Text>
                <Text style={styles.quietTitle}>
                    {t('progress:body.quiet.title', { when: d.lastVitalDate ? whenLabel(d.lastVitalDate) : t('progress:body.quiet.aWhileBack') })}
                </Text>
                <Text style={styles.insightText}>
                    {wear}
                    {' '}{sync}
                </Text>
            </View>
        </View>
    );
}

/**
 * What the charts boil down to while there is nothing new to chart: the
 * user's own usual, per domain. Not a consolation prize — these are the
 * numbers the first night back is judged against, which is the only thing
 * about last month's vitals that still matters today.
 */
function Baselines({ d, trends }: { d: BodySignals; trends: BodyTrends }) {
    const { t } = useTranslation();
    const cells = [
        d.rhrAvg != null && {
            key: 'rhr', tint: ROSE, label: t('progress:body.baselines.rhr'),
            value: `${Math.round(d.rhrAvg)}`, unit: ' bpm',
            detail: t('progress:body.baselines.fromReadings', { count: trends.restingHr.length }),
        },
        d.hrvAvg != null && {
            key: 'hrv', tint: TEAL, label: t('progress:body.baselines.hrv'),
            value: `${Math.round(d.hrvAvg)}`, unit: ' ms',
            detail: t('progress:body.baselines.fromReadings', { count: trends.hrv.length }),
        },
        d.sleepAvg30 != null && {
            key: 'sleep', tint: INDIGO, label: t('progress:body.baselines.sleep'),
            value: formatMin(d.sleepAvg30 * 60), unit: '',
            detail: t('progress:body.baselines.fromNights', { count: trends.sleepHours.length }),
        },
    ].filter((c): c is Exclude<typeof c, false> => !!c);

    return (
        <>
            <Text style={styles.tabSubLabel}>{t('progress:body.baselines.title')}</Text>
            <View style={styles.signalsRow}>
                {cells.map((c, i) => (
                    <React.Fragment key={c.key}>
                        {i > 0 && <View style={styles.signalDivider} />}
                        <View style={styles.signal}>
                            <View style={styles.signalLamp}>
                                <View style={[styles.zoneDot, { backgroundColor: c.tint }]} />
                                <Text style={styles.signalLabel}>{c.label}</Text>
                            </View>
                            <Text style={styles.baselineVal}>
                                {c.value}<Text style={styles.metricUnit}>{c.unit}</Text>
                            </Text>
                            <Text style={styles.signalDetail}>{c.detail}</Text>
                        </View>
                    </React.Fragment>
                ))}
            </View>
        </>
    );
}

/** "+40m vs your usual week · 1,850 kcal burned · 45m at hard effort" —
 *  whatever of the three exists. The comparison leads: it is the one figure
 *  that says whether this week is a build or a recovery week. No "this week"
 *  suffix on the rest: the section label already says LAST 7 DAYS. */
function loadSummary(t: BodyTrends, d: BodySignals): string {
    const parts: string[] = [];
    if (d.weekVsUsualMin != null) {
        const diff = Math.round(d.weekVsUsualMin);
        parts.push(Math.abs(diff) < 10
            ? i18n.t('progress:body.load.levelWithUsual')
            : i18n.t('progress:body.load.vsUsual', { delta: `${diff > 0 ? '+' : '−'}${formatMin(Math.abs(diff))}` }));
    }
    if (t.week.kcal > 0) parts.push(i18n.t('progress:body.load.kcal', { kcal: t.week.kcal.toLocaleString() }));
    const hard = t.load.reduce((s, day) => s + day.hardMin, 0);
    if (hard > 0) parts.push(i18n.t('progress:body.load.hard', { duration: formatMin(hard) }));
    return parts.join(' · ');
}

/**
 * The line under a vital's headline: how today sits against the user's own
 * average once there is one — and, when the latest reading is days old, that
 * fact instead. A "+5 bpm vs your average" printed under a four-day-old
 * number reads as today's verdict, and it isn't.
 */
function vitalDelta(latest: TrendPoint, avg: number | null, baselineReady: boolean, unit: string, tip: string): string {
    const daysAgo = localDaysAgo(latest.date);
    if (daysAgo > 3) return i18n.t('progress:body.delta.stale', { when: whenLabel(latest.date) });
    if (avg == null || !baselineReady) return i18n.t('progress:body.delta.noBaseline', { tip });
    return i18n.t('progress:body.delta.vsAverage', { delta: deltaLabel(latest.value - avg, unit), tip });
}

/**
 * "1h 20m short of 8h this week · 41% deep + REM · 89% efficient" — the
 * shortfall first, because it is the actionable one, then whatever quality
 * detail the device sends. A week that met the goal every night says so.
 */
function sleepSummary(d: BodySignals, t: BodyTrends): string {
    if (t.sleepHours.length < 3) return i18n.t('progress:body.sleep.sharpen');
    // No nights this week is not "on your goal" — a debt summed over nothing
    // is zero, and zero was being read out as a perfect week.
    if (d.nights7 === 0) return i18n.t('progress:body.sleep.lastRecorded', { when: whenLabel(t.sleepHours[t.sleepHours.length - 1].date) });
    const parts: string[] = [];
    parts.push(d.sleepDebtMin7 >= 15
        ? i18n.t('progress:body.sleep.short', { duration: formatMin(d.sleepDebtMin7), goal: SLEEP_GOAL_H })
        : i18n.t('progress:body.sleep.onGoal', { goal: SLEEP_GOAL_H }));
    if (d.deepRemShare7 != null) parts.push(i18n.t('progress:body.sleep.deepRem', { pct: Math.round(d.deepRemShare7 * 100) }));
    if (d.efficiency7 != null) parts.push(i18n.t('progress:body.sleep.efficiency', { pct: Math.round(d.efficiency7) }));
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
    const { t } = useTranslation();
    const sumZones = (from: number, to: number) =>
        zoneMixSec.reduce((s, sec, zone) => zone >= from && zone <= to ? s + sec : s, 0);
    const groups = [
        { label: t('progress:body.effort.light'), sec: sumZones(1, 2), tint: ZONE_TINTS[2] },
        { label: t('progress:body.effort.hard'), sec: sumZones(3, 4), tint: ZONE_TINTS[4] },
        { label: t('progress:body.effort.max'), sec: sumZones(5, Infinity), tint: ZONE_TINTS[5] },
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
    const { t } = useTranslation();
    const r = readinessOf(d);
    // The word arrives in the language on screen, so "Rest" is recognised by
    // comparing against the same translation rather than the English literal.
    const isRest = r.word === t('progress:readiness.word.rest');

    // With a provider score the word already carries the band (Rest is the
    // red band, Easy the amber). Derived: one thing off (ring ≥ 2/3) is a
    // caution; more than one is a stop.
    const readinessLevel: SignalLevel =
        r.level === 'good' ? 'green'
        : r.level === 'attention'
            ? (d.providerReadiness ? (isRest ? 'red' : 'amber') : (r.ring >= 2 / 3 ? 'amber' : 'red'))
        : 'none';

    // The detail is the RECOMMENDATION, not the cause — the cause is already
    // on the neighbouring lamps and in the insight sentence below, and
    // repeating "short night" here made the row say one thing twice. A thin
    // verdict says what it rests on, so "Primed" from a night alone can't
    // pass for the full read.
    const recommendation =
        r.level === 'good' ? t('progress:body.signals.advice.push')
        : isRest ? t('progress:body.signals.advice.goLight')
        : t('progress:body.signals.advice.easy');
    // The short form, for when the detail has to share its line with a
    // qualifier — "72% recovery · push", "sleep only · take it easy".
    const shortRecommendation =
        r.level === 'good' ? t('progress:body.signals.adviceShort.push')
        : isRest ? t('progress:body.signals.adviceShort.goLight')
        : t('progress:body.signals.adviceShort.easy');
    const readinessDetail =
        r.level === 'unknown' ? r.reason
        : d.providerReadiness ? t('progress:body.signals.recovery', { pct: Math.round(d.providerReadiness.value), advice: shortRecommendation })
        : r.partial ? t('progress:body.signals.basisOnly', { basis: basisLabel(d.basis), advice: shortRecommendation })
        : recommendation;

    const signals: Signal[] = [
        sleepSignal(d),
        {
            label: t('progress:body.signals.readiness'),
            level: readinessLevel,
            verdict: r.word === '—' ? t('progress:body.signals.noData') : r.word,
            detail: readinessDetail,
        },
        {
            label: t('progress:body.signals.yesterday'),
            level: d.bigDay ? 'amber' : 'green',
            verdict: d.bigDay ? t('progress:body.signals.bigDay')
                : d.yesterdayMin === 0 ? t('progress:body.signals.restDay')
                : t('progress:body.signals.trained'),
            detail: d.yesterdayMin === 0
                ? t('progress:body.signals.noTraining')
                : t('progress:body.signals.exercise', { duration: t('progress:units.m', { m: d.yesterdayMin }) }),
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
        return {
            label: i18n.t('progress:body.signals.lastNight'), level: 'none',
            verdict: i18n.t('progress:body.signals.notTracked'), detail: i18n.t('progress:body.signals.wearToBed'),
        };
    }
    if (!d.nightFresh) {
        return {
            label: i18n.t('progress:body.signals.lastNight'), level: 'none',
            verdict: i18n.t('progress:body.signals.notSynced'), detail: i18n.t('progress:body.signals.waiting'),
        };
    }
    const h = d.nightFresh.value;
    const level: SignalLevel = h < 6 ? 'red' : (h < 7 || d.shortNight) ? 'amber' : 'green';
    return {
        label: i18n.t('progress:body.signals.lastNight'),
        level,
        verdict: level === 'red' ? i18n.t('progress:body.signals.shortNight')
            : level === 'amber' ? i18n.t('progress:body.signals.aBitShort')
            : i18n.t('progress:body.signals.rested'),
        // "slept 1h 30m" reads as a sentence under the LAST NIGHT label;
        // "1.5h slept" read as a unit nobody uses.
        detail: i18n.t('progress:body.slept', { duration: formatMin(h * 60) }),
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
    const { t } = useTranslation();
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
            <AxisRow left={t('progress:body.axis.nightsAgo', { nights: SLEEP_NIGHTS })} right={t('progress:body.axis.lastNight')} />
            <ChartLegend items={[
                { swatch: 'dash', color: 'rgba(255,255,255,0.35)', label: t('progress:body.legend.goal', { goal: SLEEP_GOAL_H }) },
                { swatch: 'box', color: INDIGO, label: t('progress:body.legend.goalMet') },
                { swatch: 'box', color: `${INDIGO}60`, label: t('progress:body.legend.shortOfGoal') },
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
    const { t } = useTranslation();
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
                            <Text style={styles.loadMins}>{d.activeMin > 0 ? t('progress:units.m', { m: d.activeMin }) : '—'}</Text>
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
                            {t('progress:body.load.avg', { duration: t('progress:units.m', { m: Math.round(avg) }) })}
                        </Text>
                    </>
                )}
            </View>
            <ChartLegend items={[
                { swatch: 'box', color: 'rgba(251,146,60,0.3)', label: t('progress:body.legend.minutesTrained') },
                ...(totalHard > 0
                    ? [{ swatch: 'box' as const, color: ORANGE, label: t('progress:body.legend.hardEffort') }]
                    : []),
                ...(avg > 0
                    ? [{ swatch: 'line' as const, color: 'rgba(255,255,255,0.35)', label: t('progress:body.legend.averageDay') }]
                    : []),
            ]} />
        </View>
    );
}

// ─── Derivations ─────────────────────────────────────────────────────────────

function latest(series: TrendPoint[]): TrendPoint | null {
    return series.length > 0 ? series[series.length - 1] : null;
}

function deltaLabel(delta: number, unit: string): string {
    const r = Math.round(delta);
    if (r === 0) return i18n.t('progress:body.delta.level');
    return i18n.t('progress:body.delta.value', { sign: r > 0 ? '+' : '−', value: Math.abs(r), unit });
}

/** The signals a verdict rests on, as words — "sleep", "sleep + HRV". */
const BASIS_KEYS: Record<BasisSignal, string> = {
    sleep: 'progress:body.basis.sleep',
    hrv: 'progress:body.basis.hrv',
    rhr: 'progress:body.basis.rhr',
};
function basisLabel(basis: BasisSignal[]): string {
    return basis.map(b => i18n.t(BASIS_KEYS[b])).join(' + ');
}

/** The device behind a score, as the user knows it. */
const PROVIDER_NAMES: Record<string, string> = {
    whoop: 'Whoop', garmin: 'Garmin', oura: 'Oura', fitbit: 'Fitbit', polar: 'Polar', zepp: 'Zepp',
};
function providerName(source: string | null): string {
    return (source && PROVIDER_NAMES[source.toLowerCase()]) || i18n.t('progress:body.yourDevice');
}

function localDaysAgo(date: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((today.getTime() - new Date(`${date}T00:00:00`).getTime()) / 86400000);
}

/**
 * When a reading is from, in words — "today", "yesterday", "Mon", "12 Aug".
 * Sits beside the big latest-value numbers so a days-old reading can never
 * pass as a live one (the same worry that made the readiness chip a word).
 */
function whenLabel(date: string): string {
    const daysAgo = localDaysAgo(date);
    const d = new Date(`${date}T00:00:00`);
    if (daysAgo <= 0) return i18n.t('progress:body.when.today');
    if (daysAgo === 1) return i18n.t('progress:body.when.yesterday');
    if (daysAgo < 7) return d.toLocaleDateString(getFormatLocale(), { weekday: 'short' });
    return d.toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short' });
}

function dayInitial(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString(getFormatLocale(), { weekday: 'narrow' });
}

/** 132 → "2h 12m", 45 → "45m" — same h/m form the breakdown sheet uses. */
function formatMin(mins: number): string {
    const m = Math.round(mins);
    if (m >= 60) {
        const rem = m % 60;
        return rem > 0
            ? i18n.t('progress:units.hm', { h: Math.floor(m / 60), m: rem })
            : i18n.t('progress:units.h', { h: Math.floor(m / 60) });
    }
    return i18n.t('progress:units.m', { m });
}

/** "HRV 68 ms (your usual 74)" — a fresh vital against its baseline, or bare. */
function vitalPhrase(label: string, fresh: TrendPoint, avg: number | null, ready: boolean, unit: string): string {
    const v = i18n.t('progress:body.insight.vital', { label, value: Math.round(fresh.value), unit });
    return ready && avg != null ? i18n.t('progress:body.insight.vitalVsUsual', { vital: v, usual: Math.round(avg) }) : v;
}

/**
 * One or two plain sentences, worst signal first. What the device scored
 * leads when it has scored this morning; otherwise the read comes from the
 * user's own baselines, and says so when it is resting on a single signal.
 * We never invent a percentage — the only score here is the provider's own.
 */
function buildInsight(d: BodySignals): string {
    if (d.providerReadiness) {
        const score = Math.round(d.providerReadiness.value);
        const who = providerName(d.providerReadiness.source);
        const behind: string[] = [];
        if (d.nightFresh) behind.push(i18n.t('progress:body.slept', { duration: formatMin(d.nightFresh.value * 60) }));
        if (d.hrvFresh) behind.push(vitalPhrase(i18n.t('progress:body.insight.hrv'), d.hrvFresh, d.hrvAvg, d.hrvBaselineReady, 'ms'));
        if (d.rhrFresh) behind.push(vitalPhrase(i18n.t('progress:body.insight.rhr'), d.rhrFresh, d.rhrAvg, d.rhrBaselineReady, 'bpm'));
        const advice = score >= 67 ? i18n.t('progress:body.insight.advice.push')
            : score >= 34 ? i18n.t('progress:body.insight.advice.steady')
            : i18n.t('progress:body.insight.advice.rest');
        return behind.length > 0
            ? i18n.t('progress:body.insight.providerWithEvidence', { who, score, evidence: behind.join(', '), advice })
            : i18n.t('progress:body.insight.provider', { who, score, advice });
    }
    if (d.rhrElevated) {
        return i18n.t('progress:body.insight.rhrElevated', { delta: deltaLabel(d.rhrFresh!.value - d.rhrAvg!, 'bpm') });
    }
    if (d.hrvLow) {
        return i18n.t('progress:body.insight.hrvLow', { value: Math.round(d.hrvFresh!.value), usual: Math.round(d.hrvAvg!) });
    }
    if (d.shortNight) {
        return i18n.t('progress:body.insight.shortNight', { duration: formatMin(d.nightFresh!.value * 60) });
    }
    if (d.bigDay) {
        return i18n.t('progress:body.insight.bigDay', { duration: formatMin(d.yesterdayMin) });
    }
    if (d.nightFresh && (d.hrvFresh || d.rhrFresh)) {
        const behind: string[] = [i18n.t('progress:body.insight.slept', { duration: formatMin(d.nightFresh.value * 60) })];
        if (d.hrvFresh) behind.push(vitalPhrase(i18n.t('progress:body.insight.hrv'), d.hrvFresh, d.hrvAvg, d.hrvBaselineReady, 'ms'));
        if (d.rhrFresh) behind.push(vitalPhrase(i18n.t('progress:body.insight.rhr'), d.rhrFresh, d.rhrAvg, d.rhrBaselineReady, 'bpm'));
        return i18n.t('progress:body.insight.ordinary', { evidence: behind.join(', ') });
    }
    if (d.nightFresh) {
        // A night alone. Name what is still to come, in the device's own
        // terms — "trends build as your device syncs" read as broken to a
        // wearer whose device had been syncing for weeks.
        const duration = formatMin(d.nightFresh.value * 60);
        return d.missing.length > 0
            ? i18n.t('progress:body.insight.nightWaiting', { count: d.missing.length, duration, basis: basisLabel(d.missing) })
            : i18n.t('progress:body.insight.night', { duration });
    }
    // No night to speak of — for a wearer who never takes the device to bed,
    // resting heart rate carries the whole read. Speak to what IS there rather
    // than promising trends that "build as your device syncs" to someone whose
    // device has been syncing all along.
    if (d.rhrFresh && d.rhrBaselineReady && d.rhrAvg != null) {
        const diff = Math.round(d.rhrFresh.value - d.rhrAvg);
        return diff < 0 ? i18n.t('progress:body.insight.rhrBelow', { bpm: Math.abs(diff) })
            : diff > 0 ? i18n.t('progress:body.insight.rhrAbove', { bpm: diff })
            : i18n.t('progress:body.insight.rhrOnAverage');
    }
    if (d.rhrFresh) {
        return i18n.t('progress:body.insight.rhrFirst', { bpm: Math.round(d.rhrFresh.value), when: whenLabel(d.rhrFresh.date) });
    }
    if (d.hrvFresh) {
        return d.hrvBaselineReady && d.hrvAvg != null
            ? i18n.t('progress:body.insight.hrvVsUsual', { value: Math.round(d.hrvFresh.value), usual: Math.round(d.hrvAvg) })
            : i18n.t('progress:body.insight.hrvFirst', { value: Math.round(d.hrvFresh.value), when: whenLabel(d.hrvFresh.date) });
    }
    if (d.weekActiveDays > 0) {
        const trained = i18n.t('progress:body.insight.trained', {
            active: d.weekActiveDays, days: LOAD_DAYS, duration: formatMin(d.weekActiveMin),
        });
        if (!d.tracksSleep && !d.tracksRhr && !d.tracksHrv) {
            return `${trained} ${i18n.t('progress:body.insight.needsSignals')}`;
        }
        const last = d.rhrDaysAgo != null ? ` ${i18n.t('progress:body.insight.lastRhr', { days: d.rhrDaysAgo })}` : '';
        return `${trained} ${i18n.t('progress:body.insight.noRecent')}${last}`;
    }
    return i18n.t('progress:body.insight.default');
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

    quietCard: {
        flexDirection: 'row', alignItems: 'flex-start', gap: 12,
        padding: 14, borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    },
    quietIcon: {
        width: 34, height: 34, borderRadius: 17,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.06)',
    },
    quietBody: { flex: 1, gap: 5 },
    quietTitle: { fontSize: 15, fontWeight: '400', letterSpacing: -0.2, color: TEXT },
    baselineVal: { fontSize: 22, fontWeight: '200', letterSpacing: -0.6, color: TEXT },

    insightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
    insightText: { fontSize: 12, fontWeight: '300', color: DIM, flex: 1, lineHeight: 18 },
    // Tappable insight text — the Movement tab's pattern, in teal: gold is POWR's alone.
    insightAction: { color: TEAL, fontWeight: '500', textDecorationLine: 'underline' },

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
