import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, type StyleProp, StyleSheet, Text, type TextStyle, View } from 'react-native';

import { crowdAt, type SeriesInviteBoard, seriesNum, seriesOrdinal } from '@/lib/api/series';
import i18n from '@/lib/i18n';
import type { SquadPrize } from '@/lib/seriesInvite';
import { storageImage } from '@/lib/storageImage';
import { CARD_BG, CARD_BORDER, GOLD, HAIR, MoreLine, TEXT, TEXT_2, TEXT_3, YOU_LINE, YOU_TINT } from './SeriesLane';
import { useSeasonCard } from './season';

/** "1 more friend passes Tom", "You lead the invite race", "Bring friends to race for Squad Builder". */
export function inviteNext(b: SeriesInviteBoard): string {
    const me = b.me;
    if (me.rank == null) return i18n.t('series:invite.bringOne');
    if (me.rank === 1) return i18n.t('series:invite.youLead');
    const above = b.rows.find((r) => r.rank === me.rank! - 1);
    if (!above) return i18n.t('series:invite.youAre', { place: seriesOrdinal(me.rank) });
    // Level on friends goes to whoever got there first: passing takes one more than theirs.
    const need = Math.max(1, above.friends - me.friends + 1);
    return i18n.t('series:invite.passes', { count: need, name: above.name.split(' ')[0] });
}

/**
 * Before a round: the invite race. Ranked on friends brought in (joined with
 * your code AND logged a workout); the ones still to work out show as joining.
 * Everyone with none yet is on the start line, never given a place among
 * people tied on zero. The top of it when the round starts is on course for
 * Squad Builder. The rows are real members only; the start-line count is the
 * whole crowd (members and the pacers filling it), the number Home shows.
 */
export function InviteBoardCard({ board: b, you, onInvite }: { board: SeriesInviteBoard; you: string; onInvite: () => void }) {
    const { t } = useTranslation();
    const sc = useSeasonCard();
    // The crowd fills on a ramp towards the gun: re-read the clock now and then.
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(id);
    }, []);
    // The top five, then you if you're further down.
    const top = b.rows.filter((r) => r.rank <= 5);
    const mine = b.rows.find((r) => r.you && r.rank > 5);
    const gap = mine ? mine.rank - 6 : 0;
    return (
        <View style={[s.card, sc]}>
            <View style={s.head}>
                <Text style={[s.headText, { width: 30, textAlign: 'center' }]}>#</Text>
                <Text style={[s.headText, { flex: 1 }]}>{t('series:invite.member')}</Text>
                <Text style={s.headText}>{t('series:invite.friendsIn')}</Text>
            </View>
            {top.map((r, i) => <Row key={`${r.rank}-${r.name}`} r={r} you={you} first={i === 0} />)}
            {mine && gap > 0 && <MoreLine text={t('series:invite.more', { n: seriesNum(gap) })} />}
            {mine && <Row r={mine} you={you} first={gap > 0} />}
            <View style={s.start}>
                <View style={s.startLine} />
                <Text style={s.startText}>{t('series:invite.startLine', { n: seriesNum(crowdAt(b, now)) })}</Text>
                <View style={s.startLine} />
            </View>

            <View style={s.foot}>
                {/* Two lines beside the button: "Bring friends to race for Squad
                    Builder" is wider than the room left by INVITE on a phone. */}
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.next} numberOfLines={2}>{inviteNext(b)}</Text>
                    {b.me.joining > 0 && (
                        <Text style={s.joining} numberOfLines={2}>
                            {t('series:invite.joining', { n: b.me.joining })}
                        </Text>
                    )}
                </View>
                <Pressable
                    onPress={() => { void Haptics.selectionAsync(); onInvite(); }}
                    style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('series:invite.inviteA11y')}
                >
                    <Ionicons name="person-add-outline" size={14} color="#0a0a0a" />
                    <Text style={s.btnText}>{t('series:invite.invite')}</Text>
                </Pressable>
            </View>
        </View>
    );
}

/**
 * The line under the invite race: what counts as a friend, and what the most
 * friends wins. The real prize's name once /admin/series has one, else the
 * prize's title (Squad Builder) so it never reads "wins Prize to be announced".
 */
export function InviteRaceNote({ prize, style }: { prize: SquadPrize | null; style?: StyleProp<TextStyle> }) {
    const { t } = useTranslation();
    return <Text style={style}>{t('series:league.inviteRace.note', { prize: prize?.name ?? 'Squad Builder' })}</Text>;
}

/** What the invite race is for, big: the Squad Builder prize's photo and name. Only with a photo. */
export function PrizeHero({ prize }: { prize: SquadPrize }) {
    const { t } = useTranslation();
    if (!prize.imageUrl) return null;
    return (
        <View style={s.hero}>
            <Image
                source={{ uri: storageImage(prize.imageUrl, 720, 720) ?? prize.imageUrl }}
                style={s.heroPic}
                contentFit="cover"
                accessibilityLabel={prize.name}
            />
            <View style={s.heroText}>
                <Text style={s.heroEyebrow}>{t('series:start.prizeEyebrow')}</Text>
                <Text style={s.heroName} numberOfLines={2}>{prize.name}</Text>
            </View>
        </View>
    );
}

function Row({ r, you, first }: { r: SeriesInviteBoard['rows'][number]; you: string; first: boolean }) {
    const { t } = useTranslation();
    return (
        <View style={[s.row, r.you && s.rowMe]}>
            {r.you && <LinearGradient colors={YOU_TINT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />}
            {!first && !r.you && <View style={s.hair} />}
            <Text style={[s.rank, r.you && { color: GOLD, fontWeight: '500' }, r.rank === 1 && !r.you && { color: GOLD }]}>{r.rank}</Text>
            <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[s.name, r.you && { color: TEXT, fontWeight: '400' }]} numberOfLines={1}>{r.you ? you : r.name}</Text>
                {r.joining > 0 && <Text style={s.tag}>{t('series:invite.joiningTag', { n: r.joining })}</Text>}
            </View>
            <Text style={[s.count, r.you && { color: GOLD }]}>{r.friends}</Text>
        </View>
    );
}

const s = StyleSheet.create({
    card: { marginHorizontal: 16, borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, overflow: 'hidden', paddingTop: 6 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIR },
    headText: { fontSize: 8, fontWeight: '600', letterSpacing: 1.2, color: TEXT_3 },
    row: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
    rowMe: { marginHorizontal: 6, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: YOU_LINE, overflow: 'hidden' },
    hair: { position: 'absolute', left: 58, right: 16, top: 0, height: StyleSheet.hairlineWidth, backgroundColor: HAIR },
    rank: { width: 30, textAlign: 'center', fontSize: 15, fontWeight: '300', color: TEXT_3, fontVariant: ['tabular-nums'] },
    name: { flexShrink: 1, fontSize: 14, fontWeight: '300', color: 'rgba(255,255,255,0.8)' },
    tag: { fontSize: 8.5, fontWeight: '700', letterSpacing: 0.8, color: TEXT_3 },
    count: { minWidth: 40, textAlign: 'right', fontSize: 17, fontWeight: '300', color: TEXT, fontVariant: ['tabular-nums'] },
    hero: { marginBottom: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER },
    heroPic: { width: '100%', aspectRatio: 16 / 10, maxHeight: 220, backgroundColor: '#0b0b0b' },
    heroText: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14 },
    heroEyebrow: { fontSize: 8, fontWeight: '700', letterSpacing: 1.4, color: TEXT_3 },
    heroName: { marginTop: 3, fontSize: 20, fontWeight: '300', color: TEXT, letterSpacing: -0.2 },
    start: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    startLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: HAIR },
    startText: { fontSize: 9, fontWeight: '600', letterSpacing: 1.8, color: TEXT_3 },
    foot: {
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14,
        borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR,
    },
    next: { fontSize: 14, lineHeight: 18, fontWeight: '400', color: TEXT },
    joining: { marginTop: 2, fontSize: 11, lineHeight: 14, fontWeight: '300', color: TEXT_2 },
    btn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: GOLD },
    btnText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: '#0a0a0a' },
});
