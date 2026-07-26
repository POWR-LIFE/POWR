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
} from '@/lib/api/pointsBreakdown';
import { getGymDwellMinutes, getGymUpgradeMinutes } from '@/lib/gymDwellConfig';
import { rangeLabel, type LookbackPeriod } from '@/lib/progressLookback';

const GOLD = '#E8D200';
const CARD_BG = '#141414';
const BORDER = '#222222';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM = 'rgba(255,255,255,0.45)';

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

        const { start, end } = day ? singleDayWindow(day) : breakdownWindow(period, offset);
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
                                    <Text style={styles.groupMeta}>
                                        {verificationLabel(group.verification)}
                                        {sessionMetrics(type, group).length > 0 && (
                                            <Text style={styles.groupMetric}>
                                                {'  '}{sessionMetrics(type, group).join(' · ')}
                                            </Text>
                                        )}
                                    </Text>
                                </View>
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
                                            {[formatSessionDate(s.startedAt), ...sessionMetrics(type, s)].join(' · ')}
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function verificationLabel(verification: string): string {
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
    // Sits inside groupMeta but reads at the ledger's own weight — a number the
    // user opened the sheet to find shouldn't be dimmer than the rows it explains.
    groupMetric: {
        fontSize: 11.5,
        fontWeight: '400',
        color: DIM,
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
