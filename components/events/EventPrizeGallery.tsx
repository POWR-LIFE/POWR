import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { EventPrizeList, rankLabel } from '@/components/events/EventPrizeList';
import { EventPrizeViewer } from '@/components/events/EventPrizeViewer';
import type { LiveEventPrize } from '@/lib/api/liveEvents';
import { prizeArtUri } from '@/lib/storageImage';

const GOLD = '#E8D200';
// Home-card surface (see EventTicketCard) for the text-only rows card and
// the imageless gallery card.
const CARD_BG = '#111111';
const BORDER = '#222222';
const TEXT = '#F2F2F2';

/** Card margins match every other League block (14pt gutters). */
const GUTTER = 14;
const GAP = 10;
/** Show most of the lead card and a clear slice of the next — the peek is
 *  the invitation to swipe. */
const CARD_FRACTION = 0.68;
const CARD_MAX = 272;

/**
 * "The prizes" — the block that sits directly under the League hero card.
 *
 * With artwork it is a horizontal, snapping gallery of tall image cards:
 * the picture full-bleed, a soft scrim at the foot, the ordinal as a gold
 * chip and the label in light type. First prize leads. Tapping a card opens
 * the spotlight viewer on that prize. A prize without an image alongside
 * ones that have it gets a dark card with its rank set huge, so the strip
 * stays rhythmic rather than gap-toothed.
 *
 * Text-only events (nothing to show) fall back to a plain card of rank ·
 * label rows — the same shape they had inside the hero, just moved out of
 * it — so nothing regresses for events configured before images existed.
 *
 * Renders nothing at all when the event has no prizes.
 */
export function EventPrizeGallery({ prizes }: { prizes: LiveEventPrize[] }) {
    const { width } = useWindowDimensions();
    const [open, setOpen] = useState<number | null>(null);

    if (prizes.length === 0) return null;

    const hasImagery = prizes.some((p) => !!p.image_url);

    if (!hasImagery) {
        return (
            <View style={styles.rowsCard}>
                <Text style={styles.eyebrow}>THE PRIZES</Text>
                <EventPrizeList prizes={prizes} max={prizes.length} />
            </View>
        );
    }

    const cardW = Math.min(CARD_MAX, Math.round((width - GUTTER * 2) * CARD_FRACTION));
    const cardH = Math.round(cardW * 1.18);

    return (
        <View style={styles.section}>
            <Text style={[styles.eyebrow, styles.eyebrowInset]}>THE PRIZES</Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.strip}
                snapToInterval={cardW + GAP}
                snapToAlignment="start"
                decelerationRate="fast"
                // Cards are the touch targets; the strip itself must not
                // swallow the tap that would otherwise open one.
                directionalLockEnabled
            >
                {prizes.map((p, i) => {
                    const uri = prizeArtUri(p.image_url);
                    return (
                        <Pressable
                            key={p.rank}
                            onPress={() => {
                                Haptics.selectionAsync();
                                setOpen(i);
                            }}
                            style={({ pressed }) => [
                                styles.card,
                                { width: cardW, height: cardH },
                                pressed && { transform: [{ scale: 0.985 }], opacity: 0.94 },
                            ]}
                            accessibilityRole="imagebutton"
                            accessibilityLabel={`${rankLabel(p.rank)} prize: ${p.label}. Opens larger.`}
                        >
                            {uri ? (
                                <ExpoImage
                                    source={{ uri }}
                                    style={StyleSheet.absoluteFill}
                                    contentFit="cover"
                                    transition={220}
                                    cachePolicy="memory-disk"
                                    accessibilityIgnoresInvertColors
                                />
                            ) : (
                                <View style={styles.monogramWrap}>
                                    <Text style={styles.monogram}>{p.rank}</Text>
                                </View>
                            )}
                            {/* Foot scrim: keeps the label legible on any photo
                                without dulling the artwork above it. */}
                            <LinearGradient
                                colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.88)']}
                                locations={[0.45, 0.75, 1]}
                                style={StyleSheet.absoluteFill}
                                pointerEvents="none"
                            />
                            <View style={styles.chip}>
                                <Text style={styles.chipText}>{rankLabel(p.rank)}</Text>
                            </View>
                            <View style={styles.foot}>
                                <Text style={styles.label} numberOfLines={2}>
                                    {p.label}
                                </Text>
                            </View>
                        </Pressable>
                    );
                })}
            </ScrollView>

            <EventPrizeViewer
                prizes={prizes}
                initialIndex={open ?? 0}
                visible={open !== null}
                onClose={() => setOpen(null)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    section: { marginTop: 8 },
    eyebrow: { fontSize: 9, fontWeight: '800', color: GOLD, opacity: 0.7, letterSpacing: 2.5 },
    eyebrowInset: { marginHorizontal: GUTTER + 18, marginBottom: 10 },
    strip: { paddingHorizontal: GUTTER, gap: GAP },

    card: {
        borderRadius: 18,
        overflow: 'hidden',
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
    },
    monogramWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    monogram: { fontSize: 96, fontWeight: '100', color: GOLD, letterSpacing: -3, opacity: 0.9 },
    // Solid gold, black type: the one chip that reads on ANY artwork — a
    // translucent dark pill vanished over light poster copy in the field.
    chip: {
        position: 'absolute',
        top: 12,
        right: 12,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 100,
        backgroundColor: GOLD,
    },
    chipText: { fontSize: 9, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1.5 },
    foot: { position: 'absolute', left: 14, right: 14, bottom: 14 },
    label: { fontSize: 15, fontWeight: '300', color: TEXT, lineHeight: 20, letterSpacing: -0.2 },

    // Text-only fallback: the rows in a card of their own, under the hero.
    rowsCard: {
        marginHorizontal: GUTTER,
        marginTop: 8,
        borderRadius: 18,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 18,
        paddingVertical: 16,
    },
});
