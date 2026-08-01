import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
    Animated,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { useSheetDragDismiss } from '@/hooks/useSheetDragDismiss';
import {
    breakdownWindow,
    fetchPointsBreakdown,
    type PointsBreakdown,
    type PointsLedgerRow,
    type SessionVitals,
} from '@/lib/api/pointsBreakdown';
import { sleepDayWindow } from '@/lib/api/activity';
import { getGymDwellMinutes, getGymUpgradeMinutes } from '@/lib/gymDwellConfig';
import { rangeLabel, type LookbackPeriod } from '@/lib/progressLookback';

const GOLD = '#E8D200';
const CARD_BG = '#141414';
const BORDER = '#222222';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM = 'rgba(255,255,255,0.45)';
/**
 * The one accent in the stats row, on the heart glyph only. Heart rate is the
 * marquee number here and the rose makes it findable at a glance; every other
 * glyph stays neutral ink so GOLD keeps meaning "POWR" alone.
 *
 * Validated against this sheet's surface (#141414 + the tile's 2.5% white):
 * contrast passes ≥3:1, and against GOLD it separates by ΔE 27.8 normal /
 * 18.1 deutan / 20.9 tritan — comfortably clear of the 15 floor, so the two
 * never read as the same colour. Rose + orange was the first attempt and FAILED
 * at ΔE 12.5; don't reintroduce a second warm hue here.
 */
const HEART = '#FB7185';

/**
 * "Where did this number come from?" for the POWR EARNED metric on Progress.
 *
 * Deliberately shows the user's OWN ledger rows rather than a rate card. POWR's
 * four earn paths disagree on what a session is worth and the gym thresholds are
 * admin-tunable, so published tier tables rot; the rows the user was actually
 * paid cannot. See lib/api/pointsBreakdown.ts.
 *
 * Chrome mirrors TransferDeviceSheet / the Prime sheet family so the moment
 * reads as one system — with a scrolling body, since the row count is unbounded.
 */
export default function PointsBreakdownSheet({
    visible,
    onClose,
    type,
    period,
    offset,
    day,
}: {
    visible: boolean;
    onClose: () => void;
    type: ActivityType;
    period: LookbackPeriod;
    offset: number;
    /**
     * Pin the sheet to one local calendar day, overriding period/offset. Used by
     * the tappable week bars and month heatmap cells, which identify a specific
     * date the D/W/M stepper can't address directly.
     */
    day?: Date | null;
}) {
    const config = ACTIVITIES[type];
    const [data, setData] = useState<PointsBreakdown | null>(null);
    const [failed, setFailed] = useState(false);

    /**
     * Pull-down-to-dismiss + the animated close, shared with LedgerFilterSheet
     * (which held a byte-identical copy). See hooks/useSheetDragDismiss.
     *
     * `dismiss` is why Close doesn't feel sluggish: the delay was never the
     * Modal, it's that `onClose` sets state on ProgressScreen / WorkoutsTab and
     * re-renders the carousel and every breakdown page before the sheet visually
     * moves, so the tap looked ignored (worst in dev builds). The 200ms exit
     * runs first, on the UI thread, and the re-render happens behind it. Both
     * exits — the button and the drag — go through it, so they match.
     */
    const { dragY, backdropOpacity, panHandlers, dismiss } = useSheetDragDismiss(onClose, visible);

    useEffect(() => {
        if (!visible) return;
        let cancelled = false;
        setData(null);
        setFailed(false);

        // Sleep runs on its own clock — see sleepDayWindow. Using the plain
        // midnight window here opened the wrong night for any evening bedtime.
        const { start, end } = day
            ? (type === 'sleep' ? sleepDayWindow(day) : singleDayWindow(day))
            : breakdownWindow(period, offset);
        fetchPointsBreakdown(type, start, end)
            .then(result => { if (!cancelled) setData(result); })
            .catch(err => {
                console.error('[PointsBreakdownSheet] load failed:', err);
                if (!cancelled) setFailed(true);
            });

        return () => { cancelled = true; };
        // day is compared by time value: callers build a fresh Date each render,
        // so depending on the object identity would refetch on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, type, period, offset, day ? day.getTime() : null]);

    // Keep the early return: RN's Modal is NOT guaranteed to unrender on
    // visible=false (react-native-web notably does not), and the backdrop is an
    // absoluteFill Pressable — a lingering one silently eats every touch on the
    // screen behind it. Verified: removing this made Progress untappable after
    // the first close.
    if (!visible) return null;

    const groups = data ? groupBySession(data.rows) : [];
    const whenLabel = day
        ? (isSameLocalDay(day, new Date()) ? 'today' : 'that day')
        : period === 'D' ? 'today'
        : period === 'W' ? 'this week'
        : 'in this period';

    // Walking and sleep are daily AGGREGATES, not discrete efforts: a day
    // routinely carries a second zero-point session (a trust-0.85 companion to
    // the 0.90 auto-sync — ~11% of walking days in prod). Listing those as
    // "earned nothing" reads as a phantom failed workout when it's a sync
    // artefact. The list only means something for real sessions.
    const showUnpaid = type !== 'walking' && type !== 'sleep';
    const unpaid = showUnpaid ? data?.unpaid ?? [] : [];

    return (
        // animationType="none" on purpose: Modal's own "slide" moves the entire
        // container, so the scrim rode down the screen behind the sheet as a
        // second dark rectangle on close. The hook drives both halves instead —
        // the sheet slides, the scrim fades.
        <Modal visible transparent animationType="none" onRequestClose={dismiss}>
            <View style={styles.backdrop}>
                <Animated.View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, styles.scrim, { opacity: backdropOpacity }]}
                />
                <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
                <Animated.View style={[styles.sheet, { transform: [{ translateY: dragY }] }]}>
                    {/* Header owns the drag gesture; the body below keeps its scroll. */}
                    <View style={styles.dragHeader} {...panHandlers}>
                        <View style={styles.handle} />

                        <Text style={styles.eyebrow}>WHERE IT CAME FROM</Text>
                        <Text style={styles.headline}>
                            {config.label}{' '}
                            <Text style={styles.headlineGold}>
                                {data ? `${data.total} POWR` : '—'}
                            </Text>
                        </Text>
                        <Text style={styles.rangeLabel}>
                            {day ? formatFullDate(day) : rangeLabel(period, offset)}
                        </Text>
                        {/* Hold the slot while loading so the sheet doesn't jump. */}
                        <Text style={styles.summary}>
                            {data || failed ? summaryLine(type, whenLabel, data, groups) : ' '}
                        </Text>
                    </View>

                    <ScrollView
                        style={styles.body}
                        contentContainerStyle={styles.bodyContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {failed && (
                            <Text style={styles.stateText}>
                                Couldn&apos;t load your breakdown. Pull to refresh and try again.
                            </Text>
                        )}

                        {!failed && !data && <Text style={styles.stateText}>Loading…</Text>}

                        {groups.map(group => (
                            <View key={group.sessionId} style={styles.group}>
                                <View style={styles.groupHeader}>
                                    <Text style={styles.groupDate}>
                                        {formatSessionDate(group.startedAt)}
                                    </Text>
                                    {/* Source label stays a quiet chip; the metric is
                                        the thing worth reading, so it gets its own size. */}
                                    {/* Naming the actual device beats "Wearable":
                                        it tells the user which app to check the
                                        numbers below against. */}
                                    <Text style={styles.groupMeta}>
                                        {verificationLabel(group.verification, group.vitals?.source)}
                                    </Text>
                                </View>
                                <SessionStatsRow type={type} session={group} />
                                {group.rows.map(row => (
                                    <View key={row.id} style={styles.ledgerRow}>
                                        <Ionicons
                                            name={row.kind === 'streak' ? 'flash' : 'add'}
                                            size={11}
                                            color={row.amount >= 0 ? GOLD : '#EF4444'}
                                        />
                                        <Text style={styles.ledgerLabel} numberOfLines={2}>
                                            {row.label}
                                        </Text>
                                        <Text
                                            style={[
                                                styles.ledgerAmount,
                                                row.amount < 0 && { color: '#EF4444' },
                                            ]}
                                        >
                                            {row.amount > 0 ? `+${row.amount}` : row.amount}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        ))}

                        {unpaid.length > 0 && (
                            <View style={styles.group}>
                                <Text style={styles.groupDate}>EARNED NOTHING</Text>
                                {unpaid.map(s => (
                                    <View key={s.id} style={styles.ledgerRow}>
                                        <Ionicons name="remove" size={11} color={MUTED} />
                                        <Text style={[styles.ledgerLabel, { color: MUTED }]} numberOfLines={2}>
                                            {[
                                                formatSessionDate(s.startedAt),
                                                ...sessionMetrics(type, s),
                                                ...vitalsMetrics(s.vitals),
                                            ].join(' · ')}
                                        </Text>
                                        <Text style={[styles.ledgerAmount, { color: MUTED }]}>0</Text>
                                    </View>
                                ))}
                                <Text style={styles.unpaidNote}>
                                    A session earns nothing if it&apos;s below the minimum, if the
                                    day&apos;s cap is already met, or if the same time is already
                                    counted by a check-in or your device.
                                </Text>
                            </View>
                        )}

                        {/* Deliberately not "connect a wearable" — most people seeing
                            this already have one; what's missing is a wearable-tracked
                            version of THIS session. */}
                        {showVitalsPrompt(type, groups) && (
                            <Text style={styles.vitalsPrompt}>
                                Heart rate and calories show here when a wearable tracks
                                the session.
                            </Text>
                        )}

                        <View style={styles.rulesBlock}>
                            {rulesFor(type).map(line => (
                                <View key={line} style={styles.ruleRow}>
                                    <View style={styles.ruleDot} />
                                    <Text style={styles.ruleText}>{line}</Text>
                                </View>
                            ))}
                        </View>
                    </ScrollView>

                    <Pressable
                        style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.5 }]}
                        onPress={dismiss}
                        hitSlop={{ top: 8, bottom: 8, left: 24, right: 24 }}
                        accessibilityRole="button"
                        accessibilityLabel="Close"
                    >
                        <Text style={styles.closeLabel}>Close</Text>
                    </Pressable>
                </Animated.View>
            </View>
        </Modal>
    );
}

/**
 * The small (i) that opens the sheet. Sized for touch via hitSlop — the glyph
 * itself is deliberately quiet so it doesn't compete with the metric it annotates.
 */
export function PointsInfoDot({ onPress, label }: { onPress: () => void; label: string }) {
    return (
        <Pressable
            onPress={onPress}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={styles.infoDot}
        >
            <Ionicons name="information-circle-outline" size={12} color={MUTED} />
        </Pressable>
    );
}

/**
 * What the session actually was, as a row of stat tiles — time and distance
 * alongside the heart rate and burn the user would otherwise open their watch
 * app to read.
 *
 * A KPI row of tiles, deliberately not a chart: these are a handful of single
 * scalars with no series and no time axis, and the number IS the story. There is
 * no meter here either — a meter needs a real limit to fill against, and we
 * don't know anyone's max heart rate, so a gauge would be inventing its own
 * scale.
 *
 * Colour carries meaning or it isn't used: the heart is the one accent (it's the
 * marquee number and reads instantly), every other glyph is neutral ink, and
 * GOLD stays reserved for POWR amounts so the currency keeps its hue. Values
 * wear text tokens, never an accent.
 *
 * Vitals tiles are absent for day-wide sources — `vitals` arrives null for those
 * (see DAY_WIDE_VITAL_SOURCES in lib/api/pointsBreakdown.ts), so a HealthKit
 * session can't show the day's average heart rate under a HIIT workout. Time and
 * distance still render, which is why gym and manual sessions get a tile row too.
 */
function SessionStatsRow({
    type,
    session,
}: {
    type: ActivityType;
    session: { durationMin: number; steps: number | null; distanceM: number | null; vitals: SessionVitals | null };
}) {
    const tiles = sessionStats(type, session);
    if (tiles.length === 0) return null;

    return (
        <View style={styles.statsRow}>
            {tiles.map(tile => (
                <View key={tile.key} style={styles.statTile}>
                    <View style={styles.statHead}>
                        <Ionicons name={tile.icon} size={11} color={tile.tint ?? MUTED} />
                        <Text style={styles.statLabel}>{tile.label}</Text>
                    </View>
                    <Text style={styles.statValue}>
                        {tile.value}
                        {tile.unit && <Text style={styles.statUnit}> {tile.unit}</Text>}
                    </Text>
                </View>
            ))}
        </View>
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 'whoop' → 'Whoop'. Falls back to title-casing an unknown provider slug. */
function providerLabel(source: string): string {
    switch (source) {
        case 'whoop':        return 'Whoop';
        case 'garmin':       return 'Garmin';
        case 'fitbit':       return 'Fitbit';
        case 'oura':         return 'Oura';
        case 'polar':        return 'Polar';
        case 'strava':       return 'Strava';
        case 'peloton':      return 'Peloton';
        case 'coros':        return 'Coros';
        case 'suunto':       return 'Suunto';
        case 'wahoo':        return 'Wahoo';
        case 'withings':     return 'Withings';
        case 'zwift':        return 'Zwift';
        case 'underarmour':  return 'Under Armour';
        case 'healthkit':    return 'Apple Health';
        case 'health_connect': return 'Health Connect';
        default:
            return source.charAt(0).toUpperCase() + source.slice(1).replace(/_/g, ' ');
    }
}

type StatTile = {
    key: string;
    icon: 'time-outline' | 'navigate-outline' | 'footsteps-outline' | 'heart'
        | 'flame-outline' | 'speedometer-outline' | 'trending-up-outline'
        | 'flash-outline' | 'repeat-outline' | 'pulse-outline' | 'moon-outline';
    label: string;
    value: string;
    unit?: string;
    /** Accent for the glyph only. Reserved for heart rate — see SessionStatsRow. */
    tint?: string;
};

/**
 * Plausible speed range (km/h) per activity, outside which a derived pace is
 * treated as garbage rather than shown.
 *
 * Duration doesn't always describe the effort: prod holds gym sessions of 8-12
 * HOURS (a check-in that never closed) and swims whose duration covers the whole
 * pool visit, which derive a pace near zero — 9 sessions in the last 90 days sit
 * under 1 km/h. Printing "58:20 /km" under a run is worse than printing nothing,
 * the same rule the heart rate follows.
 *
 * Only activities where pace MEANS something appear here: a stray distance on a
 * gym or HIIT session must not produce a pace tile.
 */
const PACE_BANDS: Partial<Record<ActivityType, [min: number, max: number]>> = {
    running: [3, 30],
    walking: [1.5, 10],
    cycling: [3, 80],
    swimming: [0.5, 8],
};

/** Seconds → "6:04". */
function clockFromSeconds(totalSec: number): string {
    const mins = Math.floor(totalSec / 60);
    const secs = Math.round(totalSec % 60);
    return secs === 60 ? `${mins + 1}:00` : `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Pace (or speed, for cycling) derived from distance ÷ duration.
 *
 * Derived rather than ingested on purpose: it needs no new Terra fields and no
 * schema change, so it works on every historic session the moment this ships —
 * 73 of 108 runs and 14 of 15 swims in the last 90 days can show one.
 *
 * Units follow what each sport actually uses: min/km for running and walking,
 * min/100m for swimming, km/h for cycling.
 */
function paceTile(
    type: ActivityType,
    distanceM: number | null,
    durationMin: number,
): StatTile | null {
    const band = PACE_BANDS[type];
    if (!band || !distanceM || distanceM <= 0 || durationMin <= 0) return null;

    const kmh = (distanceM / 1000) / (durationMin / 60);
    if (kmh < band[0] || kmh > band[1]) return null;

    const base = { key: 'pace', icon: 'speedometer-outline' as const };

    if (type === 'cycling') {
        return { ...base, label: 'SPEED', value: kmh.toFixed(1), unit: 'km/h' };
    }
    if (type === 'swimming') {
        // Swimmers read per-100m, not per-km.
        return { ...base, label: 'PACE', value: clockFromSeconds(360 / kmh), unit: '/100m' };
    }
    return { ...base, label: 'PACE', value: clockFromSeconds(3600 / kmh), unit: '/km' };
}

/**
 * Which tiles are worth showing for each activity, in reading order.
 *
 * A tile still only renders if the session HAS that field — this decides what's
 * MEANINGFUL, which is a different question. Steps on a swim, climb on a rowing
 * machine or pace on a yoga class are noise even when a provider reports them,
 * and prod bears that out: running carries steps on 1 session in 108, so
 * printing a steps tile there was clutter dressed as detail.
 *
 * Order leads with what defines the activity — steps for a walk, distance for a
 * run, stages for a night's sleep — then intensity, then output.
 */
const TILES_BY_ACTIVITY: Record<ActivityType, string[]> = {
    walking:  ['steps', 'distance', 'time', 'pace', 'climb', 'hr', 'kcal'],
    running:  ['time', 'distance', 'pace', 'climb', 'hr', 'hrmax', 'kcal', 'hard'],
    cycling:  ['time', 'distance', 'pace', 'climb', 'hr', 'hrmax', 'power', 'kcal'],
    swimming: ['time', 'distance', 'pace', 'laps', 'hr', 'kcal'],
    // Indoor efforts: no distance worth trusting, so intensity is the whole story.
    gym:      ['time', 'hr', 'hrmax', 'kcal', 'hard'],
    hiit:     ['time', 'hr', 'hrmax', 'kcal', 'hard'],
    sports:   ['time', 'hr', 'hrmax', 'kcal', 'hard'],
    dance:    ['time', 'hr', 'kcal'],
    yoga:     ['time', 'hr', 'kcal'],
    // Sleep's story is entirely its stages; heart rate and burn mean nothing here.
    sleep:    ['time', 'deep', 'rem', 'light'],
};

/**
 * The session as stat tiles, filtered and ordered by what the activity is.
 *
 * Which fields EXIST varies by source rather than activity — walking carries
 * steps on 97% of sessions but distance on 3%, running the reverse, and gym only
 * ever has duration — so each tile is built defensively and simply omitted when
 * its field is absent. TILES_BY_ACTIVITY then decides which of the survivors are
 * worth a reader's attention.
 */
function sessionStats(
    type: ActivityType,
    session: { durationMin: number; steps: number | null; distanceM: number | null; vitals: SessionVitals | null },
): StatTile[] {
    const { vitals } = session;

    const duration: StatTile | null = session.durationMin > 0
        ? { key: 'time', icon: 'time-outline', label: 'TIME', value: formatDuration(session.durationMin) }
        : null;

    const steps: StatTile | null = session.steps && session.steps > 0
        ? { key: 'steps', icon: 'footsteps-outline', label: 'STEPS', value: session.steps.toLocaleString() }
        : null;

    const distance: StatTile | null = session.distanceM && session.distanceM > 0
        ? {
            key: 'distance',
            icon: 'navigate-outline',
            label: 'DISTANCE',
            // Sub-kilometre efforts are real (pool lengths average ~830 m in
            // prod), so they keep metres rather than rounding to "0.8 km".
            ...(session.distanceM >= 1000
                ? { value: (session.distanceM / 1000).toFixed(1), unit: 'km' }
                : { value: `${Math.round(session.distanceM)}`, unit: 'm' }),
        }
        : null;

    const hrAvg: StatTile | null = vitals?.hrAvg != null && vitals.hrAvg > 0
        ? { key: 'hr', icon: 'heart', label: 'AVG HR', value: `${Math.round(vitals.hrAvg)}`, unit: 'bpm', tint: HEART }
        : null;

    // Its own tile rather than a "avg · 167 max" suffix, so both read at tile
    // size. Terra sends no max for most providers, so this is usually absent.
    const hrMax: StatTile | null = vitals?.hrMax != null && vitals.hrMax > 0
        ? { key: 'hrmax', icon: 'heart', label: 'MAX HR', value: `${Math.round(vitals.hrMax)}`, unit: 'bpm', tint: HEART }
        : null;

    const calories: StatTile | null = vitals?.caloriesActive != null && vitals.caloriesActive > 0
        ? {
            key: 'kcal',
            icon: 'flame-outline',
            label: 'ACTIVE',
            value: Math.round(vitals.caloriesActive).toLocaleString(),
            unit: 'kcal',
        }
        : null;

    const pace = paceTile(type, session.distanceM, session.durationMin);

    // Provider extras. Each is absent unless that device actually reported it —
    // Whoop sends no elevation, only bike computers send power — so these are
    // sparse by nature and simply don't render when missing.
    const x = vitals?.extras ?? {};

    const elevation: StatTile | null = x.elevationGainM != null && x.elevationGainM >= 1
        ? { key: 'elev', icon: 'trending-up-outline', label: 'CLIMB', value: `${Math.round(x.elevationGainM)}`, unit: 'm' }
        : null;

    const power: StatTile | null = x.avgWatts != null && x.avgWatts > 0
        ? { key: 'power', icon: 'flash-outline', label: 'POWER', value: `${Math.round(x.avgWatts)}`, unit: 'w' }
        : null;

    const laps: StatTile | null = x.swimLaps != null && x.swimLaps > 0
        ? { key: 'laps', icon: 'repeat-outline', label: 'LAPS', value: `${Math.round(x.swimLaps)}` }
        : null;

    const hardMinutes: StatTile | null = x.highIntensityMin != null && x.highIntensityMin > 0
        ? { key: 'hard', icon: 'pulse-outline', label: 'HARD', value: `${Math.round(x.highIntensityMin)}`, unit: 'min' }
        : null;

    // Sleep stages, shown in the same h/m form as duration so the four read as
    // one set. Present on every provider — 926 nights carry them.
    const stage = (key: string, label: string, hours: number | null | undefined): StatTile | null =>
        hours != null && hours > 0
            ? { key, icon: 'moon-outline', label, value: formatDuration(Math.round(hours * 60)) }
            : null;

    const byKey: Record<string, StatTile | null> = {
        time: duration,
        distance,
        pace,
        steps,
        climb: elevation,
        laps,
        power,
        hr: hrAvg,
        hrmax: hrMax,
        kcal: calories,
        hard: hardMinutes,
        deep: stage('deep', 'DEEP', vitals?.sleepDeepH),
        rem: stage('rem', 'REM', vitals?.sleepRemH),
        light: stage('light', 'LIGHT', vitals?.sleepLightH),
    };

    return (TILES_BY_ACTIVITY[type] ?? ['time'])
        .map(key => byKey[key])
        .filter((t): t is StatTile => t != null);
}

/** Compact vitals for a single muted line — "142 bpm", "354 kcal". */
function vitalsMetrics(vitals: SessionVitals | null): string[] {
    if (!vitals) return [];
    const out: string[] = [];
    if (vitals.hrAvg != null && vitals.hrAvg > 0) out.push(`${Math.round(vitals.hrAvg)} bpm`);
    if (vitals.caloriesActive != null && vitals.caloriesActive > 0) {
        out.push(`${Math.round(vitals.caloriesActive).toLocaleString()} kcal`);
    }
    return out;
}

/**
 * Only mention vitals to someone who trained, got none, and COULD have.
 *
 * Never on an empty sheet (nothing to enrich), never on walking or sleep (daily
 * aggregates with no per-effort heart rate), and — the non-obvious one — never
 * for a gym check-in. A geofence session can't ever carry vitals: terra-webhook
 * drops the wearable workout that overlaps a check-in so the same hour isn't
 * paid twice (overlapsGeofenceGym), so the wearable's version of that session is
 * never stored. Prompting there asks the user for something the system won't do,
 * and lands in front of people already wearing a Whoop.
 */
function showVitalsPrompt(type: ActivityType, groups: SessionGroup[]): boolean {
    if (type === 'walking' || type === 'sleep') return false;
    if (groups.length === 0) return false;
    if (!groups.every(g => g.vitals === null)) return false;
    return groups.some(g => g.verification !== 'geofence');
}

/** Local-midnight to next local-midnight around `day`. */
function singleDayWindow(day: Date): { start: Date; end: Date } {
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
}

type SessionGroup = {
    sessionId: string;
    startedAt: string;
    durationMin: number;
    steps: number | null;
    distanceM: number | null;
    verification: string;
    vitals: SessionVitals | null;
    rows: PointsLedgerRow[];
};

/** Rows arrive newest-session-first and already ordered within a session. */
function groupBySession(rows: PointsLedgerRow[]): SessionGroup[] {
    const groups: SessionGroup[] = [];
    const index = new Map<string, SessionGroup>();
    for (const row of rows) {
        let group = index.get(row.sessionId);
        if (!group) {
            group = {
                sessionId: row.sessionId,
                startedAt: row.sessionStartedAt,
                durationMin: row.sessionDurationMin,
                steps: row.sessionSteps,
                distanceM: row.sessionDistanceM,
                verification: row.verification,
                vitals: row.vitals,
                rows: [],
            };
            index.set(row.sessionId, group);
            groups.push(group);
        }
        group.rows.push(row);
    }
    return groups;
}

function isSameLocalDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

/** "Friday 24 July" — the header when the sheet is pinned to one day. */
function formatFullDate(d: Date): string {
    if (isSameLocalDay(d, new Date())) return 'Today';
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatSessionDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatDuration(mins: number): string {
    if (mins >= 60) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    return `${mins}m`;
}

function formatDistance(metres: number): string {
    // Sub-kilometre efforts are real (pool lengths average ~830 m in prod), so
    // don't round them all to "0.8 km".
    return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

/**
 * What the session actually recorded, next to what it paid — the "8,156 steps"
 * or "7.1 km" that makes a +2 legible instead of arbitrary.
 *
 * Which fields exist varies by source, not by activity: walking carries steps on
 * 97% of sessions but distance on 3%, running the reverse, and gym/yoga/sleep
 * only ever have duration. So this prints whatever the row holds rather than
 * assuming a per-type shape, and leads with the metric the points came from —
 * steps for walking, duration everywhere else.
 */
function sessionMetrics(
    type: ActivityType,
    session: { durationMin: number; steps: number | null; distanceM: number | null },
): string[] {
    const duration = session.durationMin > 0 ? formatDuration(session.durationMin) : null;
    const steps = session.steps && session.steps > 0
        ? `${session.steps.toLocaleString()} steps`
        : null;
    const distance = session.distanceM && session.distanceM > 0
        ? formatDistance(session.distanceM)
        : null;

    const parts = type === 'walking'
        ? [steps, distance, duration]
        : [duration, distance, steps];
    return parts.filter((p): p is string => p !== null);
}

/** Sentence-case noun for prose, vs verificationLabel's chip-style title. */
function sourceNoun(verification: string): string {
    switch (verification) {
        case 'geofence': return 'check-in';
        case 'wearable': return 'tracked session';
        case 'health':   return 'synced session';
        case 'manual':   return 'manual log';
        default:         return 'session';
    }
}

/**
 * The at-a-glance line under the total: what this number is, in one sentence,
 * before the per-row receipt below it.
 *
 * With data it describes the user's ACTUAL sessions, so it can't go stale. With
 * none it falls back to the plain "what does this activity get you" answer —
 * built only from facts that are single-sourced (daily cap, minimum duration,
 * walking's step tiers) and reading gym's gate from config, never a constant.
 * It deliberately never quotes a per-session amount: that is the one number the
 * four earn paths disagree on. See lib/api/pointsBreakdown.ts.
 */
function summaryLine(
    type: ActivityType,
    when: string,
    data: PointsBreakdown | null,
    groups: SessionGroup[],
): string {
    const config = ACTIVITIES[type];
    const name = config.label.toLowerCase();

    // Just state the absence — the rules block directly below already answers
    // "what would earn me some", and saying it twice reads as padding.
    if (!data || data.total <= 0 || groups.length === 0) {
        return `Nothing earned from ${name} ${when}.`;
    }

    // Walking and sleep are daily aggregates; "a session" is meaningless there.
    if (type === 'walking') {
        return 'Earned in steps as your daily total passed each tier.';
    }
    if (type === 'sleep') {
        return 'Earned from your nightly sleep, scaled by how restorative it was.';
    }

    const total = (g: SessionGroup) => g.rows.reduce((s, r) => s + r.amount, 0);
    const top = groups.reduce((best, g) => (total(g) > total(best) ? g : best), groups[0]);
    const day = new Date(top.startedAt).toLocaleDateString('en-GB', { weekday: 'long' });
    const dur = top.durationMin > 0 ? `${formatDuration(top.durationMin)} ` : '';
    const noun = sourceNoun(top.verification);

    const lead = groups.length === 1
        ? `All of it from ${day}'s ${dur}${noun}.`
        : `Across ${groups.length} sessions — most from ${day}'s ${dur}${noun}.`;

    return data.rows.some(r => r.kind === 'streak')
        ? `${lead} Includes a streak bonus.`
        : lead;
}

/**
 * The chip above a session's stats. Prefers the device that measured it —
 * "Whoop" is both more specific than "Wearable" and tells the user which app to
 * check these numbers against.
 */
function verificationLabel(verification: string, source?: string | null): string {
    if (source) return providerLabel(source);
    switch (verification) {
        case 'geofence': return 'Gym check-in';
        case 'wearable': return 'Wearable';
        case 'health':   return 'Phone health';
        case 'manual':   return 'Manual log';
        default:         return 'Tracked';
    }
}

/**
 * Only facts that are single-sourced and stable enough to publish. Deliberately
 * omits the per-tier ladders (running 5/6/8/10 etc): those are real for a manual
 * log but wrong for a wearable-delivered session, which is most of the volume.
 * The gym thresholds are read from config, never hardcoded — they are actively
 * retuned by admins and the copy has to follow.
 */
function rulesFor(type: ActivityType): string[] {
    const config = ACTIVITIES[type];
    const lines: string[] = [`Up to ${config.dailyCap} POWR a day from ${config.label.toLowerCase()}.`];

    if (type === 'gym') {
        lines.push(
            `Stay ${getGymDwellMinutes()} minutes to earn a check-in, ` +
            `${getGymUpgradeMinutes()} to reach the higher tier.`,
        );
        lines.push('Consecutive gym days multiply what a check-in pays.');
    } else if (config.minDuration > 0) {
        lines.push(`Sessions under ${config.minDuration} minutes don't earn.`);
    }

    if (type === 'walking') {
        lines.push('Points step up as the day\'s total passes 4,000 / 6,000 / 8,000 / 10,000 steps.');
    }

    // Only for types the manual-log picker actually offers. Dance and sleep have
    // no branch in its calcBasePoints, so they were removed from the picker —
    // promising them an 80% manual rate here would be the same phantom promise.
    if (type !== 'sleep' && type !== 'dance') {
        lines.push('Manual logs earn 80% of a tracked session, one a day.');
    }
    return lines;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    // Its own layer, never a parent of the sheet: a fading ancestor would take
    // the sheet's opacity with it.
    scrim: {
        backgroundColor: 'rgba(0,0,0,0.6)',
    },
    sheet: {
        backgroundColor: CARD_BG,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: BORDER,
        paddingHorizontal: 24,
        paddingTop: 12,
        paddingBottom: Platform.OS === 'ios' ? 40 : 28,
        alignItems: 'center',
        maxHeight: '85%',
    },
    // Full-width so the whole header is a grab target, not just the 4px handle.
    dragHeader: {
        alignSelf: 'stretch',
        alignItems: 'center',
    },
    handle: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.15)',
        marginBottom: 22,
    },
    eyebrow: {
        color: 'rgba(255,255,255,0.22)',
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
        marginBottom: 12,
    },
    headline: {
        color: TEXT,
        fontSize: 28,
        fontWeight: '200',
        letterSpacing: -0.8,
        lineHeight: 34,
        textAlign: 'center',
    },
    headlineGold: {
        color: GOLD,
        fontWeight: '700',
    },
    rangeLabel: {
        color: MUTED,
        fontSize: 11,
        fontWeight: '300',
        marginTop: 4,
        marginBottom: 10,
    },
    // The one-sentence answer. Brighter than the rules footer — it is the thing
    // most people open this sheet for and then close again.
    summary: {
        color: DIM,
        fontSize: 12.5,
        fontWeight: '300',
        lineHeight: 19,
        textAlign: 'center',
        marginBottom: 18,
        paddingHorizontal: 4,
    },

    body: { alignSelf: 'stretch' },
    bodyContent: { paddingBottom: 4 },

    stateText: {
        color: DIM,
        fontSize: 13,
        fontWeight: '300',
        textAlign: 'center',
        paddingVertical: 20,
    },

    group: {
        marginBottom: 18,
    },
    groupHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    groupDate: {
        fontSize: 8,
        fontWeight: '500',
        letterSpacing: 1.5,
        color: MUTED,
        textTransform: 'uppercase',
    },
    groupMeta: {
        fontSize: 9,
        fontWeight: '300',
        color: MUTED,
    },
    // Sits between the session header and its ledger rows: what the effort was,
    // before what it paid. No surface of its own — the tiles float on the sheet,
    // held together by the grid rather than a box, which keeps the panel from
    // reading as a second card stacked inside the first.
    //
    // A fixed 4-up grid, not content-width tiles with gaps: percentage columns
    // line up vertically across wrapped rows, so 8 tiles read as 4×2 instead of a
    // ragged flow. It wraps rather than truncating — hiding a metric the user
    // opened this sheet to find would be the worst outcome.
    statsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        rowGap: 18,
        marginTop: 4,
        marginBottom: 16,
    },
    statTile: {
        width: '25%',
        gap: 4,
        paddingRight: 8,
    },
    statHead: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    statLabel: {
        fontSize: 8,
        fontWeight: '500',
        letterSpacing: 1,
        color: MUTED,
        textTransform: 'uppercase',
    },
    // Proportional figures on purpose: tabular-nums gives every digit a '0' width,
    // which reads loose at display size. These are standalone values, not a column.
    statValue: {
        fontSize: 18,
        fontWeight: '300',
        letterSpacing: -0.5,
        color: TEXT,
    },
    statUnit: {
        fontSize: 10,
        fontWeight: '300',
        color: DIM,
    },
    vitalsPrompt: {
        fontSize: 11,
        fontWeight: '300',
        lineHeight: 17,
        color: MUTED,
        marginBottom: 14,
    },
    ledgerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 5,
    },
    ledgerLabel: {
        flex: 1,
        fontSize: 12.5,
        fontWeight: '300',
        color: DIM,
    },
    ledgerAmount: {
        fontSize: 13,
        fontWeight: '600',
        color: GOLD,
        letterSpacing: -0.2,
    },
    unpaidNote: {
        fontSize: 11,
        fontWeight: '300',
        lineHeight: 17,
        color: MUTED,
        marginTop: 6,
    },

    rulesBlock: {
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.06)',
        paddingTop: 14,
        gap: 8,
    },
    ruleRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    ruleDot: {
        width: 3,
        height: 3,
        borderRadius: 2,
        backgroundColor: MUTED,
        marginTop: 7,
    },
    ruleText: {
        flex: 1,
        fontSize: 11.5,
        fontWeight: '300',
        lineHeight: 18,
        color: MUTED,
    },

    closeButton: {
        alignItems: 'center',
        paddingTop: 14,
        paddingBottom: 2,
    },
    closeLabel: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 13,
        fontWeight: '300',
        letterSpacing: 0.3,
    },

    infoDot: {
        paddingLeft: 4,
        justifyContent: 'center',
    },
});
