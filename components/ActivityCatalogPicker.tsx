import {
    ACTIVITY_CATALOG,
    CATALOG_GROUPS,
    searchCatalog,
    toSelection,
    type ActivitySelection,
    type CatalogActivity,
} from '@/constants/activityCatalog';
import { type ActivityType } from '@/constants/activities';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

const GOLD = '#E8D200';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';
const FONT_LIGHT = 'Outfit_300Light';
const FONT_MEDIUM = 'Outfit_500Medium';
const FONT_SEMIBOLD = 'Outfit_600SemiBold';
const FONT_BOLD = 'Outfit_700Bold';

// Uniform 3-column grid — fixed chip width keeps the long list visually even
// regardless of label length. GRID_PAD must match the parent's horizontal
// content padding.
const GRID_GAP = 8;
const GRID_PAD = 20;
const CHIP_W = Math.floor((Dimensions.get('window').width - GRID_PAD * 2 - GRID_GAP * 2) / 3);

/**
 * Picker over the specific-activity catalog (Padel, Boxing, Zumba…), used by
 * onboarding and the settings Activity Focus screen. Search field + grouped
 * uniform chips. Selection rules:
 * - up to `maxPicks` selections;
 * - one pick per scoring bucket — picking a second activity in the same bucket
 *   swaps out the first (each pick powers one tracking ring, so two picks in
 *   one bucket would collapse into a single ring anyway).
 *
 * Trackability is marked, never hidden (manual logging is a supported earn
 * path, and a pick is an identity statement either way): when browsing, the
 * catalog splits into "COUNTS AUTOMATICALLY" (buckets in `autoBuckets`) and
 * "LOG IT YOURSELF" sections so a wearable-less user sees exactly what their
 * setup tracks; search results fall back to a LOG tag per chip.
 */
export default function ActivityCatalogPicker({
    selections,
    onChange,
    maxPicks,
    autoBuckets,
    onConnectWearable,
}: {
    selections: ActivitySelection[];
    onChange: (next: ActivitySelection[]) => void;
    maxPicks: number;
    autoBuckets: Set<ActivityType>;
    /** Makes "Connect a wearable" in the log-it-yourself sub-line tappable. */
    onConnectWearable?: () => void;
}) {
    const [query, setQuery] = useState('');
    const results = useMemo(() => searchCatalog(query), [query]);
    const searching = query.trim().length > 0;
    const full = selections.length >= maxPicks;

    const selectedSlugs = new Set(selections.map(s => s.slug));
    // Catalog order is group order, so filtering preserves a sensible browse
    // sequence (cardio → sports → classes → mind & body → dance) per section.
    const autoEntries = useMemo(
        () => ACTIVITY_CATALOG.filter(a => autoBuckets.has(a.bucket)),
        [autoBuckets],
    );
    const manualEntries = useMemo(
        () => ACTIVITY_CATALOG.filter(a => !autoBuckets.has(a.bucket)),
        [autoBuckets],
    );

    const sortAutoFirst = (entries: CatalogActivity[]) =>
        [...entries].sort((a, b) =>
            Number(autoBuckets.has(b.bucket)) - Number(autoBuckets.has(a.bucket)),
        );

    const toggle = (a: CatalogActivity) => {
        if (selectedSlugs.has(a.slug)) {
            onChange(selections.filter(s => s.slug !== a.slug));
            return;
        }
        const sameBucket = selections.find(s => s.bucket === a.bucket);
        if (sameBucket) {
            // Swap within the bucket — keeps one ring per pick.
            onChange(selections.map(s => (s.bucket === a.bucket ? toSelection(a) : s)));
            return;
        }
        if (full) return;
        onChange([...selections, toSelection(a)]);
    };

    const renderChip = (a: CatalogActivity) => {
        const isSelected = selectedSlugs.has(a.slug);
        const bucketTaken = !isSelected && selections.some(s => s.bucket === a.bucket);
        // Full + different bucket = a dead tap; dim it so the state reads.
        const isDimmed = full && !isSelected && !bucketTaken;
        const isAuto = autoBuckets.has(a.bucket);
        return (
            <Pressable
                key={a.slug}
                style={[styles.chip, isSelected && styles.chipSelected, isDimmed && styles.chipDimmed]}
                onPress={() => toggle(a)}
            >
                {a.iconLib === 'material-community' ? (
                    <MaterialCommunityIcons
                        name={a.icon as any}
                        size={14}
                        color={isSelected ? GOLD : 'rgba(255,255,255,0.45)'}
                    />
                ) : (
                    <Ionicons
                        name={a.icon as any}
                        size={14}
                        color={isSelected ? GOLD : 'rgba(255,255,255,0.45)'}
                    />
                )}
                <Text
                    style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}
                    numberOfLines={1}
                >
                    {a.label}
                </Text>
                {searching && !isAuto && !isSelected && (
                    <Text style={styles.logTag}>LOG</Text>
                )}
                {isSelected && (
                    <View style={styles.chipCheck}>
                        <Ionicons name="checkmark" size={9} color="#0a0a0a" />
                    </View>
                )}
            </Pressable>
        );
    };

    return (
        <View style={styles.wrap}>
            {/* Search */}
            <View style={styles.searchRow}>
                <Ionicons name="search" size={15} color="rgba(255,255,255,0.3)" />
                <TextInput
                    style={styles.searchInput}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search — padel, boxing, zumba…"
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                {searching && (
                    <Pressable onPress={() => setQuery('')} hitSlop={8}>
                        <Ionicons name="close-circle" size={16} color="rgba(255,255,255,0.3)" />
                    </Pressable>
                )}
            </View>

            {searching ? (
                results.length > 0 ? (
                    <View style={styles.chipGrid}>{sortAutoFirst(results).map(renderChip)}</View>
                ) : (
                    <Text style={styles.noResults}>
                        Nothing matching “{query.trim()}” — try another name, or pick the closest match.
                    </Text>
                )
            ) : manualEntries.length === 0 ? (
                // Everything auto-tracks (e.g. full-capability wearable) — plain
                // browse by group, no trackability split needed.
                CATALOG_GROUPS.map(group => {
                    const entries = ACTIVITY_CATALOG.filter(a => group.buckets.includes(a.bucket));
                    if (entries.length === 0) return null;
                    return (
                        <View key={group.key} style={styles.group}>
                            <Text style={styles.groupHeading}>{group.label}</Text>
                            <View style={styles.chipGrid}>{entries.map(renderChip)}</View>
                        </View>
                    );
                })
            ) : (
                <>
                    <View style={styles.group}>
                        <Text style={styles.groupHeading}>COUNTS AUTOMATICALLY</Text>
                        <Text style={styles.groupSub}>
                            With your setup these track on their own.
                        </Text>
                        <View style={styles.chipGrid}>{autoEntries.map(renderChip)}</View>
                    </View>
                    <View style={styles.group}>
                        <Text style={styles.groupHeading}>LOG IT YOURSELF</Text>
                        <Text style={styles.groupSub}>
                            These count too — log them in a tap.{' '}
                            {onConnectWearable ? (
                                <Text style={styles.groupSubLink} onPress={onConnectWearable}>
                                    Connect a wearable
                                </Text>
                            ) : (
                                'Connect a wearable'
                            )}
                            {' '}and they track automatically.
                        </Text>
                        <View style={styles.chipGrid}>{manualEntries.map(renderChip)}</View>
                    </View>
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        gap: 14,
    },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 22,
        paddingHorizontal: 14,
        height: 42,
    },
    searchInput: {
        flex: 1,
        color: '#F2F2F2',
        fontSize: 13,
        fontFamily: FONT_LIGHT,
        fontWeight: '300',
        paddingVertical: 0,
    },
    group: {
        gap: 8,
    },
    groupHeading: {
        color: 'rgba(255,255,255,0.35)',
        fontSize: 10,
        fontFamily: FONT_SEMIBOLD,
        fontWeight: '600',
        letterSpacing: 2,
    },
    groupSub: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 10.5,
        fontFamily: FONT_LIGHT,
        fontWeight: '300',
        marginTop: -4,
        marginBottom: 2,
    },
    groupSubLink: {
        color: GOLD,
        fontFamily: FONT_MEDIUM,
        fontWeight: '500',
    },
    chipGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: GRID_GAP,
    },
    chip: {
        width: CHIP_W,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 14,
        paddingVertical: 10,
        paddingHorizontal: 10,
    },
    chipSelected: {
        borderColor: 'rgba(232,210,0,0.5)',
        backgroundColor: 'rgba(232,210,0,0.08)',
    },
    chipDimmed: {
        opacity: 0.4,
    },
    chipLabel: {
        flex: 1,
        color: 'rgba(255,255,255,0.6)',
        fontSize: 11,
        fontFamily: FONT_MEDIUM,
        fontWeight: '500',
    },
    chipLabelSelected: {
        color: '#F2F2F2',
    },
    logTag: {
        color: 'rgba(255,255,255,0.25)',
        fontSize: 7,
        fontFamily: FONT_BOLD,
        fontWeight: '700',
        letterSpacing: 0.8,
    },
    chipCheck: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
    },
    noResults: {
        color: 'rgba(255,255,255,0.3)',
        fontSize: 12,
        fontFamily: FONT_LIGHT,
        fontWeight: '300',
        textAlign: 'center',
        paddingVertical: 16,
    },
});
