import { Ionicons } from '@expo/vector-icons';
import React from 'react';
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

import { ActivityIcon } from '@/components/ActivityIcon';
import { ACTIVITIES } from '@/constants/activities';
import { LEDGER_TYPE_META } from '@/constants/ledgerTypeMeta';
import { useSheetDragDismiss } from '@/hooks/useSheetDragDismiss';
import type { LedgerFilter, LedgerFilterKey } from '@/lib/ledgerFilters';

const GOLD = '#E8D200';
const CARD_BG = '#141414';
const BORDER = '#222222';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const GREEN = '#00CC66';
const RED = '#ef4444';

/** The bucket's accent — activity colour, or the transaction type's. */
export function filterColour(filter: LedgerFilter): string {
    if (filter.activity) return ACTIVITIES[filter.activity]?.colour ?? GOLD;
    if (filter.type) return LEDGER_TYPE_META[filter.type]?.color ?? GOLD;
    return GOLD; // 'all' and Together
}

export function FilterGlyph({
    filter,
    colour,
    size = 14,
}: {
    filter: LedgerFilter;
    colour: string;
    size?: number;
}) {
    if (filter.activity) {
        const config = ACTIVITIES[filter.activity];
        return config ? <ActivityIcon activity={config} size={size} color={colour} active={false} /> : null;
    }
    if (filter.kind === 'together') return <Ionicons name="people" size={size} color={colour} />;
    if (filter.type) {
        return <Ionicons name={LEDGER_TYPE_META[filter.type].icon as any} size={size} color={colour} />;
    }
    return <Ionicons name="layers-outline" size={size} color={colour} />;
}

function formatSigned(amount: number): string {
    const sign = amount < 0 ? '-' : amount > 0 ? '+' : '';
    return `${sign}${Math.abs(amount).toLocaleString()}`;
}

/**
 * The ledger's filter picker.
 *
 * A vertical sheet rather than a row of pills: the bucket list is unbounded (ten
 * activities plus Together plus six transaction types) and a horizontal rail made
 * the member swipe through three screens of chips to reach one. Here the control
 * costs the same width whatever the member's history looks like.
 *
 * Each row carries its own count and net POWR, so the picker doubles as the
 * per-bucket breakdown — "how much has the gym ever paid me" is answered for
 * every bucket at once, without selecting any of them.
 *
 * Chrome mirrors PointsBreakdownSheet / TransferDeviceSheet so the moment reads
 * as one system.
 */
export default function LedgerFilterSheet({
    visible,
    onClose,
    filters,
    active,
    onSelect,
}: {
    visible: boolean;
    onClose: () => void;
    filters: LedgerFilter[];
    active: LedgerFilterKey;
    onSelect: (key: LedgerFilterKey) => void;
}) {
    // Pull-down-to-dismiss + animated close, shared with PointsBreakdownSheet
    // (which held a byte-identical copy). See hooks/useSheetDragDismiss.
    const { dragY, panHandlers, dismiss, reset } = useSheetDragDismiss(onClose);

    const choose = (key: LedgerFilterKey) => {
        onSelect(key);
        dismiss();
    };

    // Keep the early return: RN's Modal is NOT guaranteed to unrender on
    // visible=false (react-native-web notably does not), and the backdrop is an
    // absoluteFill Pressable — a lingering one silently eats every touch on the
    // screen behind it.
    if (!visible) return null;

    const all = filters.find((f) => f.group === 'all');
    const activities = filters.filter((f) => f.group === 'activity');
    const other = filters.filter((f) => f.group === 'other');

    const renderRow = (filter: LedgerFilter) => {
        const isActive = filter.key === active;
        const colour = filterColour(filter);
        return (
            <Pressable
                key={filter.key}
                onPress={() => choose(filter.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`${filter.label}, ${filter.count} entries`}
                style={({ pressed }) => [
                    styles.row,
                    isActive && { backgroundColor: colour + '14', borderColor: colour + '55' },
                    pressed && { opacity: 0.6 },
                ]}
            >
                <View style={[styles.rowIcon, { backgroundColor: colour + '18' }]}>
                    <FilterGlyph filter={filter} colour={colour} />
                </View>
                <View style={styles.rowBody}>
                    <Text style={[styles.rowLabel, isActive && { color: colour }]} numberOfLines={1}>
                        {filter.label}
                    </Text>
                    <Text style={styles.rowCount}>
                        {filter.count === 1 ? '1 entry' : `${filter.count.toLocaleString()} entries`}
                    </Text>
                </View>
                <Text style={[styles.rowNet, { color: filter.net < 0 ? RED : GREEN }]}>
                    {formatSigned(filter.net)}
                </Text>
                <View style={styles.rowCheck}>
                    {isActive && <Ionicons name="checkmark" size={14} color={colour} />}
                </View>
            </Pressable>
        );
    };

    return (
        <Modal visible transparent animationType="slide" onRequestClose={dismiss} onShow={reset}>
            <View style={styles.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
                <Animated.View style={[styles.sheet, { transform: [{ translateY: dragY }] }]}>
                    {/* Header owns the drag gesture; the body below keeps its scroll. */}
                    <View style={styles.dragHeader} {...panHandlers}>
                        <View style={styles.handle} />
                        <Text style={styles.eyebrow}>FILTER</Text>
                        <Text style={styles.headline}>What do you want to see?</Text>
                    </View>

                    <ScrollView
                        style={styles.body}
                        contentContainerStyle={styles.bodyContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {all && renderRow(all)}

                        {activities.length > 0 && (
                            <>
                                <Text style={styles.sectionLabel}>ACTIVITIES</Text>
                                {activities.map(renderRow)}
                            </>
                        )}

                        {other.length > 0 && (
                            <>
                                <Text style={styles.sectionLabel}>OTHER POINTS</Text>
                                {other.map(renderRow)}
                            </>
                        )}
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
 * The header control that opens the sheet. Idle it is a quiet funnel in the slot
 * the header already reserved; filtered it names the active bucket in that
 * bucket's colour, so the screen never hides what it is showing you.
 */
export function LedgerFilterChip({
    active,
    onPress,
}: {
    active: LedgerFilter | null;
    onPress: () => void;
}) {
    const isFiltered = active != null && active.key !== 'all';
    const colour = isFiltered ? filterColour(active) : MUTED;

    return (
        <Pressable
            onPress={onPress}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={isFiltered ? `Filter: ${active.label}. Change filter` : 'Filter history'}
            style={({ pressed }) => [
                styles.chip,
                isFiltered && { backgroundColor: colour + '18', borderColor: colour + '55' },
                pressed && { opacity: 0.6 },
            ]}
        >
            <Ionicons name="funnel-outline" size={13} color={colour} />
            {isFiltered && (
                <Text style={[styles.chipLabel, { color: colour }]} numberOfLines={1}>
                    {active.shortLabel}
                </Text>
            )}
        </Pressable>
    );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: CARD_BG,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: BORDER,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: Platform.OS === 'ios' ? 40 : 28,
        alignItems: 'center',
        maxHeight: '85%',
    },
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
        marginBottom: 10,
    },
    headline: {
        color: TEXT,
        fontSize: 22,
        fontWeight: '200',
        letterSpacing: -0.5,
        lineHeight: 28,
        textAlign: 'center',
        marginBottom: 16,
    },

    body: { alignSelf: 'stretch' },
    bodyContent: { paddingBottom: 4 },

    sectionLabel: {
        fontSize: 8,
        fontWeight: '600',
        letterSpacing: 2,
        color: MUTED,
        textTransform: 'uppercase',
        marginTop: 16,
        marginBottom: 6,
        paddingHorizontal: 4,
    },

    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 9,
        paddingHorizontal: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    rowIcon: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    rowBody: { flex: 1, gap: 1 },
    rowLabel: {
        fontSize: 14,
        fontWeight: '300',
        color: TEXT,
    },
    rowCount: {
        fontSize: 10,
        fontWeight: '300',
        lineHeight: 14,
        color: MUTED,
    },
    rowNet: {
        fontSize: 13,
        fontWeight: '600',
        letterSpacing: -0.2,
    },
    // Always reserved, tick or not, so the amounts stay in one column.
    rowCheck: {
        width: 14,
        alignItems: 'center',
        flexShrink: 0,
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

    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        maxWidth: 130,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    chipLabel: {
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 0.3,
        lineHeight: 14,
        flexShrink: 1,
    },
});
