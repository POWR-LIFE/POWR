import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ZONE_TINTS } from '@/components/progress/PointsBreakdownSheet';
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
export function BodyTab() {
    const [trends, setTrends] = useState<BodyTrends | null>(null);
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

    useEffect(() => { load(); }, [load, revision]);

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
                            <Text style={styles.metricUnit}> bpm</Text>
                        </Text>
                        {d.rhrAvg != null && trends.restingHr.length >= 5 && (
                            <Text style={styles.metricDelta}>
                                {deltaLabel(rhr!.value - d.rhrAvg, 'bpm')} vs your average — lower is fitter
                            </Text>
                        )}
                    </View>
                    <View style={styles.chartBlock}>
                        <Sparkline points={trends.restingHr} days={TREND_DAYS} color={ROSE} area goodDirection="down" />
                        <AxisRow left={`${TREND_DAYS} days ago`} centre="high · ─ ─ average · low" right="today" />
                    </View>
                </>
            )}

            {showHrv && (
                <>
                    <View style={styles.tabSep} />
                    <Text style={styles.tabSubLabel}>HEART RATE VARIABILITY · PER WORKOUT</Text>
                    <View style={styles.metricHead}>
                        <Text style={styles.metricVal}>
                            {Math.round(hrv!.value)}
                            <Text style={styles.metricUnit}> ms</Text>
                        </Text>
                        <Text style={styles.metricDelta}>one dot per tracked workout — higher is fresher</Text>
                    </View>
                    <View style={styles.chartBlock}>
                        <RangeDotChart points={trends.hrv} days={TREND_DAYS} height={100} color={TEAL} goodDirection="up" />
                        <AxisRow left={`${TREND_DAYS} days ago`} centre="band = your typical range" right="today" />
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
                            <Text style={styles.metricUnit}> in zone</Text>
                        </Text>
                        {trends.week.peakHr != null && (
                            <Text style={styles.metricDelta}>peak {Math.round(trends.week.peakHr)} bpm</Text>
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
                            {d.sleepAvg7 != null ? d.sleepAvg7.toFixed(1) : '—'}
                            <Text style={styles.metricUnit}> h / night this week</Text>
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
                            <Text style={styles.metricUnit}> active</Text>
                        </Text>
                        <Text style={styles.metricDelta}>{loadSummary(trends)}</Text>
                    </View>
                    <LoadChart trends={trends} />
                </>
            )}
        </View>
    );
}

/** "1,850 kcal · 45 hard min this week" — whatever of the pair exists. */
function loadSummary(t: BodyTrends): string {
    const parts: string[] = [];
    if (t.week.kcal > 0) parts.push(`${t.week.kcal.toLocaleString()} kcal`);
    const hard = t.load.reduce((s, day) => s + day.hardMin, 0);
    if (hard > 0) parts.push(`${hard} hard min`);
    return parts.length ? `${parts.join(' · ')} this week` : 'this week';
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

type Signal = {
    label: string;
    value: string;
    /** One quiet word under the value — "rested", "elevated", "big day". */
    state: string;
    tint: string;
};

/**
 * Three at-a-glance states before any chart: last night, a derived READINESS
 * word, and yesterday's load. The dot carries the colour (green = in a good
 * place, rose = worth attention, grey = nothing recent) so the row scans like
 * a status line, not a scorecard.
 *
 * The centre is a WORD, deliberately not a number: a resting HR printed here
 * read as "your heart rate right now", which it is not — and a percentage
 * would be a recovery score we can't compute honestly. "Primed" / "Easy day"
 * is exactly as much as the data supports.
 */
function SignalsRow({ d }: { d: BodySignals }) {
    const r = readinessOf(d);
    const readiness: Signal = {
        label: 'READINESS',
        value: r.word,
        state: r.reason,
        tint: r.level === 'good' ? GREEN : r.level === 'attention' ? ROSE : MUTED,
    };

    const signals: Signal[] = [
        d.nightFresh
            ? {
                label: 'SLEEP',
                value: `${d.nightFresh.value.toFixed(1)}h`,
                state: d.shortNight ? 'short night' : 'rested',
                tint: d.shortNight ? ROSE : GREEN,
            }
            : { label: 'SLEEP', value: '—', state: 'no recent night', tint: MUTED },
        readiness,
        {
            label: 'LOAD',
            value: `${d.yesterdayMin}m`,
            state: d.bigDay ? 'big day' : d.yesterdayMin === 0 ? 'rest day' : 'normal',
            tint: d.bigDay ? ROSE : d.yesterdayMin === 0 ? GREEN : MUTED,
        },
    ];

    return (
        <View style={styles.signalsRow}>
            {signals.map((s, i) => (
                <React.Fragment key={s.label}>
                    {i > 0 && <View style={styles.signalDivider} />}
                    <View style={styles.signal}>
                        <Text style={styles.signalLabel}>{s.label}</Text>
                        <Text style={styles.signalValue}>{s.value}</Text>
                        <View style={styles.signalStateRow}>
                            <View style={[styles.signalDot, { backgroundColor: s.tint }]} />
                            <Text style={styles.signalState}>{s.state}</Text>
                        </View>
                    </View>
                </React.Fragment>
            ))}
        </View>
    );
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
            <AxisRow left={`${SLEEP_NIGHTS} nights ago`} centre={`goal ${SLEEP_GOAL_H}h ─ ─`} right="last night" />
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
            <AxisRow
                left="minutes trained per day"
                centre="line = your average day"
                right={totalHard > 0 ? 'solid = hard effort' : ''}
            />
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

/** "usually within ±0.6h" — spread of nightly hours, as plain language. */
function regularityLabel(series: TrendPoint[]): string {
    if (series.length < 4) return 'trends sharpen as more nights land';
    const m = mean(series)!;
    const sd = Math.sqrt(series.reduce((s, p) => s + (p.value - m) ** 2, 0) / series.length);
    return `usually within ±${sd.toFixed(1)}h of your average`;
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
        return `Resting HR is ${deltaLabel(d.rhrFresh!.value - d.rhrAvg!, 'bpm')} above your usual — worth keeping today steadier.`;
    }
    if (d.shortNight) {
        return `Short night (${d.nightFresh!.value.toFixed(1)}h) — an easy session will do more for you than a hard one today.`;
    }
    if (d.bigDay) {
        return `Big day yesterday (${d.yesterdayMin}m of training) — recovery is part of the work.`;
    }
    if (d.nightFresh && d.rhrFresh && d.rhrAvg != null && d.rhrFresh.value <= d.rhrAvg) {
        return `Slept ${d.nightFresh.value.toFixed(1)}h and resting HR is at or below your average — good day to push.`;
    }
    if (d.nightFresh) {
        return `Slept ${d.nightFresh.value.toFixed(1)}h last night. Trends below build as your device syncs.`;
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
    signal: { flex: 1, alignItems: 'center', gap: 2 },
    signalDivider: {
        width: 1, height: 44, alignSelf: 'center',
        backgroundColor: 'rgba(255,255,255,0.07)',
    },
    signalLabel: {
        fontSize: 8, fontWeight: '500', letterSpacing: 1.5,
        color: MUTED, textTransform: 'uppercase',
    },
    signalValue: { fontSize: 22, fontWeight: '200', letterSpacing: -0.5, color: TEXT },
    signalStateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    signalDot: { width: 5, height: 5, borderRadius: 3 },
    signalState: { fontSize: 9, fontWeight: '300', color: DIM },

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
