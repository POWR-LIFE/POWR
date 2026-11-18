import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { type SeriesBounty, seriesNum, timeLeft } from '@/lib/api/series';
import i18n from '@/lib/i18n';
import { storageImage } from '@/lib/storageImage';
import { CARD_BG, EMBER, GOLD, HAIR, TEXT, TEXT_2 } from './SeriesLane';

/**
 * The Overall tab's bounties (20261118160000): an admin puts one on a member,
 * with a prize; the first member who was below them then and climbs above
 * them wins it. One row per bounty, live ones first, then any claimed in the
 * last day. Everything is on the row (who, what, how far): nothing to tap.
 */
export function BountyCard({ bounties }: { bounties: SeriesBounty[] }) {
    if (bounties.length === 0) return null;
    const live = bounties.some((b) => b.status === 'live');
    return (
        <View style={[s.card, live && s.cardLive]}>
            {bounties.map((b, i) => <BountyRow key={b.id} b={b} first={i === 0} />)}
        </View>
    );
}

/** What a bounty's row says, for whoever is looking (pure, for the tests). */
export function bountyCopy(b: SeriesBounty, now = Date.now()): { eyebrow: string; line: string; ends: string | null; mine: boolean } {
    const t = i18n.t.bind(i18n);
    const name = b.target.name;
    const claimed = b.status === 'claimed';
    const eyebrow = claimed
        ? t('series:bounty.claimed')
        : b.target.you
            ? t('series:bounty.onYou')
            : t('series:bounty.on', { name: name.toUpperCase() });
    const line = (() => {
        if (claimed) {
            const who = b.claimer?.name ?? '';
            if (b.claimer?.you) return t('series:bounty.wonByYou', { name });
            if (b.target.you) return t('series:bounty.wonOffYou', { name: who });
            return t('series:bounty.won', { claimer: who, name });
        }
        if (b.target.you) return t('series:bounty.you');
        if (!b.you) return t('series:bounty.chase', { name });
        if (!b.you.can_claim) return t('series:bounty.ahead', { name });
        if (b.you.gap == null) return t('series:bounty.blind', { name });
        if (b.you.gap <= 0) return t('series:bounty.claiming', { name });
        return t('series:bounty.chaseGap', { name, gap: seriesNum(b.you.gap) });
    })();
    const ends = !claimed && b.ends_at ? t('series:bounty.endsIn', { left: timeLeft(b.ends_at, now) }) : null;
    return { eyebrow, line, ends, mine: claimed && !!b.claimer?.you };
}

function BountyRow({ b, first }: { b: SeriesBounty; first: boolean }) {
    // Re-render when the language changes.
    useTranslation();
    const claimed = b.status === 'claimed';
    const { eyebrow, line, ends, mine } = bountyCopy(b);
    const tone = mine ? GOLD : EMBER;
    const img = b.image_url ? storageImage(b.image_url, 160, 160) ?? b.image_url : null;

    return (
        <View style={[s.row, !first && s.rowRule]}>
            <View style={[s.tile, { borderColor: `${tone}55` }]}>
                {img
                    ? <Image source={{ uri: img }} style={s.img} contentFit="cover" accessibilityIgnoresInvertColors />
                    : <Ionicons name={claimed ? 'checkmark' : 'locate-outline'} size={19} color={tone} />}
            </View>
            <View style={s.body}>
                <View style={s.eyebrowRow}>
                    <Ionicons name="locate-outline" size={10} color={tone} />
                    <Text style={[s.eyebrow, { color: tone }]} numberOfLines={1}>{eyebrow}</Text>
                    {ends && <Text style={s.ends} numberOfLines={1}>{ends}</Text>}
                </View>
                <Text style={s.prize} numberOfLines={2}>
                    {b.prize}
                    {b.sponsor ? <Text style={s.sponsor}>{` · ${b.sponsor}`}</Text> : null}
                </Text>
                <Text style={s.line} numberOfLines={2}>{line}</Text>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    card: { marginHorizontal: 16, marginBottom: 10, borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: 'rgba(229,138,58,0.18)', overflow: 'hidden' },
    cardLive: { borderColor: 'rgba(229,138,58,0.38)' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
    rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR },
    tile: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, backgroundColor: 'rgba(229,138,58,0.08)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    img: { width: '100%', height: '100%' },
    body: { flex: 1, minWidth: 0 },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    eyebrow: { flexShrink: 1, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.1 },
    ends: { marginLeft: 'auto', paddingLeft: 8, fontSize: 9.5, fontWeight: '600', letterSpacing: 0.8, color: TEXT_2 },
    prize: { marginTop: 3, fontSize: 15, fontWeight: '400', color: TEXT },
    sponsor: { color: TEXT_2, fontWeight: '300' },
    line: { marginTop: 2, fontSize: 12, fontWeight: '300', color: TEXT_2 },
});
