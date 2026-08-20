import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily } from '@/constants/tokens';
import type { RecapChallenge, RecapData } from '@/hooks/useWeeklyRecap';

// ─── Palette — Home's inks + the BODY tab's domain hues ──────────────────────
// Gold stays POWR's alone (points); rose = heart, indigo = sleep, orange =
// training load. Same assignments as BodyTab so the two surfaces read as kin.

const GOLD = '#E8D200';
const GREEN = '#4ade80';
const ROSE = '#FB7185';
const INDIGO = '#818cf8';
const ORANGE = '#fb923c';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const FAINT = '#444444';

const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const BAR_H = 64;

function CatIcon({ spec, size, color }: { spec: { lib: 'ion' | 'mc'; name: string }; size: number; color: string }) {
    if (spec.lib === 'mc') return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
    return <Ionicons name={spec.name as any} size={size} color={color} />;
}

/** 35,000 → "35k"; small values verbatim — same convention as the board. */
function fmtNum(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
    return String(Math.round(n));
}

function fmtDuration(min: number): string {
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Points per day as gold columns — the week's shape at a glance. */
function PointsBars({ points }: { points: { date: string; value: number }[] }) {
    const max = Math.max(...points.map((p) => p.value), 1);
    const bestIdx = points.findIndex((p) => p.value === max);
    return (
        <View style={styles.barsBlock}>
            <View style={styles.barsRow}>
                {points.map((p, i) => {
                    const best = i === bestIdx && p.value > 0;
                    return (
                        <View key={p.date} style={styles.barCol}>
                            {best && <Text style={styles.barValue}>{p.value}</Text>}
                            <View style={styles.barTrack}>
                                <View
                                    style={[
                                        styles.barFill,
                                        best && styles.barFillBest,
                                        { height: Math.max(Math.round((p.value / max) * BAR_H), p.value > 0 ? 4 : 2) },
                                    ]}
                                />
                            </View>
                            <Text style={[styles.barDay, best && styles.barDayBest]}>{DAY_INITIALS[i]}</Text>
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

function SectionLabel({ label, meta }: { label: string; meta?: string }) {
    return (
        <>
            <View style={styles.sep} />
            <View style={styles.sectionLabelRow}>
                <Text style={styles.sectionLabel}>{label}</Text>
                {!!meta && <Text style={styles.sectionMeta}>{meta}</Text>}
            </View>
        </>
    );
}

function ChallengeRecapRow({ c, last }: { c: RecapChallenge; last: boolean }) {
    return (
        <View style={[styles.row, !last && styles.rowDivider]}>
            <View style={[styles.rowIcon, c.completed && styles.rowIconDone]}>
                <CatIcon spec={c.icon} size={14} color={c.completed ? GREEN : SECONDARY} />
            </View>
            <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>{c.title}</Text>
                <Text style={styles.rowSub}>
                    {c.completed ? 'Completed' : `${fmtNum(c.displayValue)} of ${fmtNum(c.displayGoal)} ${c.unit}`}
                </Text>
            </View>
            {c.completed ? (
                <View style={styles.rowRight}>
                    <Ionicons name="checkmark-circle" size={15} color={GREEN} />
                    <Text style={[styles.rowPts, { color: GREEN }]}>+{c.points}</Text>
                </View>
            ) : (
                <Text style={[styles.rowPts, { color: c.fraction >= 0.75 ? SECONDARY : FAINT }]}>
                    {Math.round(c.fraction * 100)}%
                </Text>
            )}
        </View>
    );
}

/** One body metric: big light numeral over a micro label, hue = its domain. */
function BodyTile({ value, unit, label, tint }: { value: string; unit?: string; label: string; tint: string }) {
    return (
        <View style={styles.tile}>
            <Text style={[styles.tileValue, { color: tint }]}>
                {value}
                {!!unit && <Text style={styles.tileUnit}> {unit}</Text>}
            </Text>
            <Text style={styles.tileLabel}>{label}</Text>
        </View>
    );
}

/**
 * The full "Your Week" story behind WeeklyRecapCard: points day by day, last
 * week's challenge board with final standings, what the week cost the body
 * (time, burn, peak effort) and gave back (sleep), then per-activity totals.
 * Flowing borderless sections with hairline separators — the BODY tab's form,
 * not a stack of boxed cards.
 */
export function WeeklyRecapSheet({
    visible,
    data,
    onClose,
    onStartWeek,
}: {
    visible: boolean;
    data: RecapData | null;
    onClose: () => void;
    /** "Start this week" — closes the sheet AND retires the recap card. */
    onStartWeek: () => void;
}) {
    const insets = useSafeAreaInsets();
    if (!data) return null;

    const delta = data.pointsWeekBefore != null ? data.pointsEarned - data.pointsWeekBefore : null;
    const activeDayCount = data.activeDays.filter(Boolean).length;
    const { body } = data;
    const hasEffort = body.activeMin > 0 || body.kcal > 0 || body.peakHr != null;
    const hasAnyPoints = data.pointsByDay.some((p) => p.value > 0);

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable style={styles.scrim} onPress={onClose} />
                <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
                    <View style={styles.handle} />
                    <View style={styles.headerRow}>
                        <View>
                            <Text style={styles.title}>Your week</Text>
                            <Text style={styles.subtitle}>{data.weekLabel}</Text>
                        </View>
                        <Pressable hitSlop={10} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
                            <Ionicons name="close" size={18} color={MUTED} />
                        </Pressable>
                    </View>

                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                        {/* Points hero */}
                        <View style={styles.hero}>
                            <View style={styles.heroPtsWrap}>
                                <Text style={styles.heroPts}>{data.pointsEarned.toLocaleString()}</Text>
                                <Text style={styles.heroPtsUnit}>pts</Text>
                            </View>
                            <Text style={styles.heroLabel}>POWR EARNED</Text>
                            {delta != null && delta !== 0 && (
                                <View style={styles.deltaRow}>
                                    <Ionicons
                                        name={delta > 0 ? 'trending-up' : 'trending-down'}
                                        size={12}
                                        color={delta > 0 ? GREEN : SECONDARY}
                                    />
                                    <Text style={[styles.deltaText, delta > 0 && { color: GREEN }]}>
                                        {delta > 0 ? `${delta.toLocaleString()} more` : `${Math.abs(delta).toLocaleString()} fewer`} than the week before
                                    </Text>
                                </View>
                            )}
                        </View>

                        {hasAnyPoints && (
                            <>
                                <PointsBars points={data.pointsByDay} />
                                {data.bestDay && (
                                    <Text style={styles.bestDayLine}>
                                        Biggest day <Text style={styles.bestDayStrong}>{data.bestDay.label}</Text>
                                        {' · '}{activeDayCount} of 7 days active
                                    </Text>
                                )}
                            </>
                        )}

                        {/* Challenge board — final standings */}
                        {data.challenges.length > 0 && (
                            <>
                                <SectionLabel
                                    label="CHALLENGES"
                                    meta={`${data.challengesCompleted} of ${data.challenges.length} completed`}
                                />
                                {data.challenges.map((c, i) => (
                                    <ChallengeRecapRow key={c.id} c={c} last={i === data.challenges.length - 1} />
                                ))}
                            </>
                        )}

                        {/* What the week cost — and gave back */}
                        {hasEffort && (
                            <>
                                <SectionLabel label="YOUR BODY" meta="from your device" />
                                <View style={styles.tileRow}>
                                    {body.activeMin > 0 && (
                                        <BodyTile value={fmtDuration(body.activeMin)} label="TIME TRAINING" tint={ORANGE} />
                                    )}
                                    {body.hardMin > 0 && (
                                        <BodyTile value={fmtDuration(body.hardMin)} label="HIGH INTENSITY" tint={ORANGE} />
                                    )}
                                    {body.kcal > 0 && (
                                        <BodyTile value={body.kcal.toLocaleString()} unit="kcal" label="ACTIVE BURN" tint={ROSE} />
                                    )}
                                    {body.peakHr != null && (
                                        <BodyTile value={String(Math.round(body.peakHr))} unit="bpm" label="PEAK HEART RATE" tint={ROSE} />
                                    )}
                                    {body.sleepAvgH != null && (
                                        <BodyTile value={body.sleepAvgH.toFixed(1)} unit="h" label="SLEEP / NIGHT" tint={INDIGO} />
                                    )}
                                </View>
                            </>
                        )}

                        {/* Per-activity totals */}
                        {data.perCategory.length > 0 && (
                            <>
                                <SectionLabel
                                    label="ACTIVITY"
                                    meta={`${data.totalSessions} session${data.totalSessions === 1 ? '' : 's'}`}
                                />
                                {data.perCategory.map((cat, i) => (
                                    <View
                                        key={cat.category}
                                        style={[styles.row, i < data.perCategory.length - 1 && styles.rowDivider]}
                                    >
                                        <View style={styles.rowIcon}>
                                            <CatIcon spec={cat.icon} size={14} color={SECONDARY} />
                                        </View>
                                        <View style={styles.rowBody}>
                                            <Text style={styles.rowTitle}>{cat.label}</Text>
                                            <Text style={styles.rowSub}>
                                                {cat.category === 'walking' && data.steps > 0
                                                    ? `${data.steps.toLocaleString()} steps`
                                                    : cat.distanceKm != null && cat.distanceKm > 0
                                                        ? `${cat.distanceKm} km`
                                                        : cat.totalMin != null && cat.totalMin > 0
                                                            ? `${fmtDuration(cat.totalMin)} total`
                                                            : cat.category === 'gym' ? 'check-ins' : 'sessions'}
                                            </Text>
                                        </View>
                                        <Text style={styles.activityCount}>{cat.sessions}×</Text>
                                    </View>
                                ))}
                            </>
                        )}
                    </ScrollView>

                    <Pressable
                        style={({ pressed }) => [styles.startBtn, pressed && { opacity: 0.85 }]}
                        onPress={onStartWeek}
                        accessibilityRole="button"
                    >
                        <Text style={styles.startBtnText}>START THIS WEEK</Text>
                        <Ionicons name="arrow-forward" size={14} color="#0a0a0a" />
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    scrim: { flex: 1 },
    sheet: {
        backgroundColor: '#0d0d0d',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 20,
        paddingTop: 12,
        maxHeight: '88%',
    },
    handle: {
        width: 40,
        height: 4,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 12,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    title: { fontFamily: fontFamily.extraLight, fontSize: 26, color: TEXT, letterSpacing: -0.5 },
    subtitle: { fontFamily: fontFamily.regular, fontSize: 12, color: MUTED, marginTop: 2 },
    scrollContent: { paddingTop: 6, paddingBottom: 10 },

    hero: { alignItems: 'center', paddingTop: 16, paddingBottom: 6 },
    heroPtsWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
    heroPts: { fontFamily: fontFamily.extraLight, fontSize: 60, color: GOLD, letterSpacing: -2, lineHeight: 62 },
    heroPtsUnit: { fontFamily: fontFamily.semiBold, fontSize: 15, color: GOLD, opacity: 0.7, marginBottom: 9 },
    heroLabel: { fontFamily: fontFamily.regular, fontSize: 9, color: SECONDARY, letterSpacing: 2.5, marginTop: 6 },
    deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
    deltaText: { fontFamily: fontFamily.regular, fontSize: 11, color: SECONDARY },

    barsBlock: { paddingTop: 18, paddingHorizontal: 12 },
    barsRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
    barCol: { alignItems: 'center', gap: 5, flex: 1 },
    barValue: { fontFamily: fontFamily.medium, fontSize: 9, color: GOLD },
    barTrack: { height: BAR_H, justifyContent: 'flex-end' },
    barFill: { width: 14, borderRadius: 4, backgroundColor: 'rgba(232,210,0,0.35)' },
    barFillBest: { backgroundColor: GOLD },
    barDay: { fontFamily: fontFamily.regular, fontSize: 8, color: FAINT },
    barDayBest: { color: SECONDARY },
    bestDayLine: {
        fontFamily: fontFamily.regular,
        fontSize: 10.5,
        color: MUTED,
        textAlign: 'center',
        marginTop: 12,
    },
    bestDayStrong: { color: SECONDARY, fontFamily: fontFamily.semiBold },

    sep: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: 'rgba(255,255,255,0.07)',
        marginTop: 20,
        marginBottom: 16,
    },
    sectionLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    sectionLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 2, color: 'rgba(255,255,255,0.35)' },
    sectionMeta: { fontFamily: fontFamily.regular, fontSize: 10, color: MUTED },

    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.05)' },
    rowIcon: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: 'rgba(255,255,255,0.05)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    rowIconDone: { backgroundColor: 'rgba(74,222,128,0.08)' },
    rowBody: { flex: 1, gap: 2 },
    rowTitle: { fontFamily: fontFamily.regular, fontSize: 14, color: TEXT, letterSpacing: -0.2 },
    rowSub: { fontFamily: fontFamily.regular, fontSize: 10.5, color: MUTED },
    rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rowPts: { fontFamily: fontFamily.semiBold, fontSize: 12, letterSpacing: 0.2 },
    activityCount: { fontFamily: fontFamily.light, fontSize: 15, color: TEXT },

    tileRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 18, paddingTop: 8 },
    tile: { width: '33.33%', gap: 3 },
    tileValue: { fontFamily: fontFamily.extraLight, fontSize: 24, letterSpacing: -0.5 },
    tileUnit: { fontFamily: fontFamily.regular, fontSize: 12, color: SECONDARY, letterSpacing: 0 },
    tileLabel: { fontFamily: fontFamily.regular, fontSize: 7.5, color: MUTED, letterSpacing: 1.3 },

    startBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: GOLD,
        borderRadius: 100,
        paddingVertical: 15,
        marginTop: 10,
    },
    startBtnText: { fontFamily: fontFamily.bold, fontSize: 11, color: '#0a0a0a', letterSpacing: 1.5 },
});
