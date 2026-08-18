import { Image as ExpoImage } from 'expo-image';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { LiveEventPrize } from '@/lib/api/liveEvents';
import { prizeImageUri } from '@/lib/storageImage';

const GOLD = '#E8D200';
const DIM = 'rgba(255,255,255,0.5)';
const HAIRLINE = 'rgba(255,255,255,0.08)';

export function rankLabel(rank: number): string {
    return rank === 1 ? '1ST' : rank === 2 ? '2ND' : rank === 3 ? '3RD' : `${rank}TH`;
}

/**
 * The top prizes of a live event, as they appear on the League ticket and the
 * register sheet.
 *
 * Two shapes, chosen from the data rather than the caller:
 *   - text-only (no prize has an image): the original compact rank · label
 *     rows — nothing changes for events configured before images existed;
 *   - with imagery (any prize has an image): each prize becomes a hairline
 *     row with a square tile on the left — the image itself, or, for a prize
 *     without one, a rank monogram in the same slot so the column stays
 *     aligned and no row reads as "missing its picture".
 *
 * `size` only scales type and tiles; the layout is the same on both surfaces
 * so the ticket and the sheet can never drift apart.
 */
export function EventPrizeList({
    prizes,
    size = 'card',
    max = 3,
}: {
    prizes: LiveEventPrize[];
    size?: 'card' | 'sheet';
    max?: number;
}) {
    const rows = prizes.slice(0, max);
    if (rows.length === 0) return null;

    const sheet = size === 'sheet';
    const hasImagery = rows.some((p) => !!p.image_url);

    if (!hasImagery) {
        return (
            <View style={[styles.textBlock, sheet && styles.textBlockSheet]}>
                {rows.map((p) => (
                    <View key={p.rank} style={styles.textRow}>
                        <Text style={[styles.textRank, sheet && styles.textRankSheet]}>{rankLabel(p.rank)}</Text>
                        <Text style={[styles.textLabel, sheet && styles.textLabelSheet]} numberOfLines={1}>
                            {p.label}
                        </Text>
                    </View>
                ))}
            </View>
        );
    }

    const tile = sheet ? 56 : 44;
    return (
        <View style={[styles.block, sheet && styles.blockSheet]}>
            {rows.map((p, i) => {
                const uri = prizeImageUri(p.image_url);
                return (
                    <View
                        key={p.rank}
                        style={[styles.row, i > 0 && styles.rowDivider, sheet && styles.rowSheet]}
                        accessibilityLabel={`${rankLabel(p.rank)} prize: ${p.label}`}
                    >
                        <View style={[styles.tile, { width: tile, height: tile, borderRadius: sheet ? 14 : 11 }]}>
                            {uri ? (
                                <ExpoImage
                                    source={{ uri }}
                                    style={StyleSheet.absoluteFill}
                                    contentFit="cover"
                                    transition={200}
                                    cachePolicy="memory-disk"
                                    accessibilityIgnoresInvertColors
                                />
                            ) : (
                                <Text style={[styles.monogram, sheet && styles.monogramSheet]}>{p.rank}</Text>
                            )}
                        </View>
                        <View style={styles.copy}>
                            <Text style={[styles.rank, sheet && styles.rankSheet]}>{rankLabel(p.rank)}</Text>
                            <Text style={[styles.label, sheet && styles.labelSheet]} numberOfLines={2}>
                                {p.label}
                            </Text>
                        </View>
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    // ── text-only (legacy) shape ──
    textBlock: { marginTop: 12, gap: 5 },
    textBlockSheet: { marginTop: 16, gap: 6 },
    textRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    textRank: { width: 30, fontSize: 9, fontWeight: '700', color: GOLD, opacity: 0.7, letterSpacing: 1 },
    textRankSheet: { width: 32 },
    textLabel: { flex: 1, fontSize: 12, fontWeight: '300', color: DIM },
    textLabelSheet: { fontSize: 13 },

    // ── imagery shape ──
    block: { marginTop: 14 },
    blockSheet: { marginTop: 18 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
    rowSheet: { gap: 14, paddingVertical: 10 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE },
    tile: {
        overflow: 'hidden',
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.28)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    monogram: { fontSize: 16, fontWeight: '200', color: GOLD, letterSpacing: -0.5 },
    monogramSheet: { fontSize: 20 },
    copy: { flex: 1, gap: 2 },
    rank: { fontSize: 9, fontWeight: '700', color: GOLD, opacity: 0.7, letterSpacing: 1.5 },
    rankSheet: { fontSize: 9.5 },
    label: { fontSize: 13, fontWeight: '300', color: '#F2F2F2', lineHeight: 17 },
    labelSheet: { fontSize: 14.5, lineHeight: 19 },
});
