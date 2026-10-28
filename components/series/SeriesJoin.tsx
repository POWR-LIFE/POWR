import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeStats } from '@/components/home/HomeCard';
import { useSheetDragDismiss } from '@/hooks/useSheetDragDismiss';
import { trackTap } from '@/lib/analytics';
import { fetchSeriesPrizes, joinSeries, type SeriesBoard, seriesDate, seriesJoined, seriesNum } from '@/lib/api/series';
import { fetchProfile } from '@/lib/api/user';
import { seriesInviteLink, seriesInviteMessage } from '@/lib/seriesInvite';
import { GOLD, TEXT, TEXT_2, TEXT_3 } from './SeriesLane';
import { type PrizeSet, prizeSetFrom } from './SeriesPrizes';
import { BUTTER, hexA, SeriesLockup, useSeason } from './season';

/*
 * Joining the Series (20261027120000_series_join), as live events do it: the
 * Series asks, nobody is put on a board without saying yes. One tap a season
 * and you're in every round of it; join late and every session since the
 * round's first day still counts. Home's card and the League both open the
 * same sheet, so there's one way in.
 */

/** The round a JOIN puts you in, as the sheet shows it. */
export type JoinRound = { slug: string; name: string; startsAt: number; endsAt: number; need: number };

/** A London calendar day, for counting days: fixed format, never shown. */
const londonDay = (ms: number) => Date.parse(new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }));
/** Days in a round, and which of them today is (1 = its first). */
export function roundDays(r: Pick<JoinRound, 'startsAt' | 'endsAt'>, now = Date.now()) {
    const days = Math.round((londonDay(r.endsAt) - londonDay(r.startsAt)) / 86_400_000);
    const day = Math.min(days, Math.max(1, Math.round((londonDay(now) - londonDay(r.startsAt)) / 86_400_000) + 1));
    return { days, day };
}

/** The round to join from a live board, or null when you're in (or there's nothing to join). */
export function joinRoundOf(b: SeriesBoard | null | undefined): JoinRound | null {
    const j = b && !seriesJoined(b) ? b.join : null;
    return j ? { slug: j.slug, name: j.name, startsAt: Date.parse(j.starts_at), endsAt: Date.parse(j.ends_at), need: j.draw_days } : null;
}

/** The server's refusals (English, P0001), in the language on screen. */
function joinError(e: { code?: string; message?: string }, t: (k: string) => string): string {
    if (e?.code === 'P0001' && /open yet/.test(e.message ?? '')) return t('series:join.errorNotOpen');
    if (e?.code === 'P0001' && /no round/.test(e.message ?? '')) return t('series:join.errorNoRound');
    return t('series:join.errorBody');
}

/*
 * One sheet for the whole app, mounted once beside the tabs (SeriesJoinHost):
 * joining swaps the card that opened it (Home's join card becomes the round
 * card), so a sheet living inside that card would vanish before "You're in".
 */
let asked: { round: JoinRound; from: 'home' | 'league' } | null = null;
const askedSubs = new Set<() => void>();
const setAsked = (x: typeof asked) => { asked = x; askedSubs.forEach((f) => f()); };

/** Open the join sheet for `round`. */
export function openSeriesJoin(round: JoinRound, from: 'home' | 'league') {
    trackTap('series_join_open', { from });
    setAsked({ round, from });
}

/** Mounted once (app/(tabs)/_layout): the join sheet, whoever opened it. */
export function SeriesJoinHost() {
    const open = useSyncExternalStore(
        (f) => { askedSubs.add(f); return () => { askedSubs.delete(f); }; },
        () => asked,
    );
    // The last one opened stays rendered while the sheet slides away.
    const last = useRef(open);
    if (open) last.current = open;
    if (!last.current) return null;
    return <SeriesJoinSheet visible={!!open} onClose={() => setAsked(null)} round={last.current.round} from={last.current.from} />;
}

/**
 * The sheet, two stages in one Modal (EventRegisterFlow's pattern: a second
 * Modal is silently dropped on iOS):
 *
 *   pitch    what the Series is (the round, its prizes, how it works), the
 *            consent line and ONE gold JOIN.
 *   success  you're in, and the optional extra: invite friends for Squad Builder.
 *
 * From Home, Done goes on to the League, where the round lives.
 */
export function SeriesJoinSheet({ visible, onClose, round, from }: {
    visible: boolean;
    onClose: () => void;
    round: JoinRound;
    from: 'home' | 'league';
}) {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const { def } = useSeason();
    const [stage, setStage] = useState<'pitch' | 'success'>('pitch');
    const [busy, setBusy] = useState(false);
    const [prizes, setPrizes] = useState<PrizeSet | null>(null);
    const [code, setCode] = useState<string | null>(null);
    const after = useRef<(() => void) | null>(null);
    const { dragY, backdropOpacity, panHandlers, dismiss } = useSheetDragDismiss(() => {
        onClose();
        const go = after.current;
        after.current = null;
        go?.();
    }, visible);

    useEffect(() => {
        if (!visible) return undefined;
        setStage('pitch');
        let live = true;
        void fetchSeriesPrizes(round.slug).then((rows) => { if (live) setPrizes(prizeSetFrom(rows)); });
        fetchProfile().then((p) => { if (live) setCode(p?.referral_code ?? null); }).catch(() => undefined);
        return () => { live = false; };
    }, [visible, round.slug]);

    const now = Date.now();
    const running = now >= round.startsAt;
    const { days, day } = roundDays(round, now);
    const date = seriesDate(new Date(round.startsAt).toISOString());

    const join = async () => {
        if (busy) return;
        void Haptics.selectionAsync();
        setBusy(true);
        try {
            await joinSeries();
            trackTap('series_join', { from, round: round.slug });
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setStage('success');
        } catch (e) {
            Alert.alert(t('series:join.errorTitle'), joinError(e as { code?: string; message?: string }, t));
        } finally {
            setBusy(false);
        }
    };

    const invite = async () => {
        if (!code) return;
        void Haptics.selectionAsync();
        trackTap('series_invite', { from: 'join' });
        // The same invite the League's invite card sends: the Series link
        // (its preview is the Series card) and the day the round starts.
        const link = seriesInviteLink(code);
        try {
            await Share.share({ message: seriesInviteMessage({ seasonName: def.name, link, startsAt: round.startsAt }), url: link });
        } catch {
            // dismissed
        }
    };

    const done = () => {
        after.current = from === 'home' ? () => router.push('/(tabs)/league') : null;
        dismiss();
    };

    // What you're playing for: 1st place and the Draw, then how many more.
    const P = prizes;
    const top = P?.places[0];
    const shown = (top ? 1 : 0) + (P?.draw ? 1 : 0);
    const all = P ? P.places.length + (P.draw ? 1 : 0) + Object.keys(P.named).length + (P.city ? 1 : 0) : 0;
    const more = all - shown;

    return (
        <Modal visible={visible} transparent animationType="none" onRequestClose={() => dismiss()}>
            <View style={s.container}>
                <Animated.View style={[s.scrim, { opacity: backdropOpacity }]} />
                <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss()} accessibilityLabel={t('series:join.closeA11y')} />
                <Animated.View style={[s.sheet, { paddingBottom: insets.bottom + 20, transform: [{ translateY: dragY }] }]}>
                    {/* The header owns the drag (see EventRegisterFlow): text only in here. */}
                    <View style={s.dragHeader} {...panHandlers}>
                        <View style={s.handle} />
                        {stage === 'pitch' ? (
                            <>
                                <Text style={s.eyebrow}>{t('series:join.eyebrow')}</Text>
                                <Text style={s.name}>{def.name}</Text>
                                <Text style={s.dates}>
                                    {running
                                        ? t('series:join.onNow', { round: round.name, day, days })
                                        : t('series:join.startsOn', { round: round.name, date })}
                                </Text>
                            </>
                        ) : (
                            <>
                                <View style={s.inRow}>
                                    <Ionicons name="checkmark-circle" size={22} color={GOLD} />
                                    <Text style={s.inText}>{t('series:join.youreIn')}</Text>
                                </View>
                                <Text style={s.dates}>{t('series:join.inSub', { season: def.name, round: round.name })}</Text>
                            </>
                        )}
                    </View>

                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.body} bounces={false}>
                        {stage === 'pitch' ? (
                            <>
                                <View style={s.block}>
                                    <Text style={s.blockEyebrow}>{t('series:join.playingFor')}</Text>
                                    {top && <PrizeLine icon="trophy-outline" lead={t('series:join.place1')} name={top.name} />}
                                    {P?.draw && (
                                        <PrizeLine icon="ticket-outline" lead={t('series:join.drawWinners', { count: P.draw.winners })} name={P.draw.name} />
                                    )}
                                    {more > 0 && <Text style={s.more}>{t('series:join.morePrizes', { count: more })}</Text>}
                                    {P && shown === 0 && <Text style={s.more}>{t('series:join.prizesSoon')}</Text>}
                                </View>

                                <View style={s.block}>
                                    <Text style={s.blockEyebrow}>{t('series:join.how')}</Text>
                                    {[
                                        t('series:join.howPoints'),
                                        t('series:join.howDraw', { need: round.need, days }),
                                        running ? t('series:join.howLate', { date }) : t('series:join.howGun', { date }),
                                        t('series:join.howSeason', { season: def.name }),
                                    ].map((line) => (
                                        <View key={line} style={s.ruleRow}>
                                            <Text style={s.ruleBullet}>•</Text>
                                            <Text style={s.ruleText}>{line}</Text>
                                        </View>
                                    ))}
                                </View>

                                <Text style={s.consent}>{t('series:join.consent')}</Text>

                                <Pressable
                                    style={({ pressed }) => [s.primary, (pressed || busy) && { opacity: 0.85 }]}
                                    disabled={busy}
                                    onPress={() => { void join(); }}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('series:join.ctaA11y', { season: def.name })}
                                >
                                    <Text style={s.primaryText}>{busy ? t('series:join.joining') : t('series:join.cta')}</Text>
                                </Pressable>
                                <Pressable style={s.skip} onPress={() => dismiss()} accessibilityRole="button">
                                    <Text style={s.skipText}>{t('series:join.notNow')}</Text>
                                </Pressable>
                            </>
                        ) : (
                            <>
                                <View style={s.block}>
                                    <Text style={s.blockEyebrow}>{t('series:join.squadEyebrow')}</Text>
                                    <Text style={s.ruleText}>{t('series:join.squadText')}</Text>
                                </View>
                                <Pressable
                                    style={({ pressed }) => [s.primary, s.primaryRow, (pressed || !code) && { opacity: 0.85 }]}
                                    disabled={!code}
                                    onPress={() => { void invite(); }}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('series:start.inviteA11y')}
                                >
                                    <Ionicons name="person-add-outline" size={15} color="#0a0a0a" />
                                    <Text style={s.primaryText}>{t('series:join.invite')}</Text>
                                </Pressable>
                                <Pressable style={s.skip} onPress={done} accessibilityRole="button">
                                    <Text style={s.skipText}>{t('series:join.done')}</Text>
                                </Pressable>
                            </>
                        )}
                    </ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
}

function PrizeLine({ icon, lead, name }: { icon: React.ComponentProps<typeof Ionicons>['name']; lead: string; name: string }) {
    return (
        <View style={s.prize}>
            <View style={s.prizeIcon}><Ionicons name={icon} size={14} color={GOLD} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.prizeLead} numberOfLines={1}>{lead.toUpperCase()}</Text>
                <Text style={s.prizeName} numberOfLines={1}>{name}</Text>
            </View>
        </View>
    );
}

/**
 * The League while a round is on and you haven't joined: one screen, like the
 * start line. The round and its day, the top 3, how many are racing, and one
 * gold JOIN. Joining late costs nothing, so the screen says so.
 */
export function JoinRoundScreen({ board: b, round, onJoin, dev }: {
    board: SeriesBoard;
    round: JoinRound;
    onJoin: () => void;
    /** Dev controls, top right. */
    dev?: React.ReactNode;
}) {
    const { t } = useTranslation();
    const { def } = useSeason();
    const { days, day } = roundDays(round);
    const left = Math.max(1, days - day + 1);
    const top = b.rows.filter((r) => r.rank <= 3).slice(0, 3);
    return (
        <View style={s.screen}>
            <View style={s.top}>
                <SeriesLockup height={30} def={def} />
                {dev}
            </View>
            <View style={s.head}>
                <Text style={s.on}>{t('series:join.roundOn', { round: round.name.toUpperCase() })}</Text>
                <Text style={s.dayOf}>{t('series:join.dayOf', { day, days })}</Text>
            </View>
            <View style={s.stage}>
                <Text style={s.blockEyebrow}>{t('series:join.top3')}</Text>
                {top.map((r) => (
                    <View key={r.user_id} style={s.row}>
                        <Text style={s.rank}>{r.rank}</Text>
                        <Text style={s.rowName} numberOfLines={1}>{r.name}</Text>
                        <Text style={s.rowPts}>{t('series:join.pts', { n: seriesNum(r.points) })}</Text>
                    </View>
                ))}
            </View>
            <HomeStats items={[
                { value: seriesNum(b.total), label: t('series:join.racing') },
                { value: seriesNum(left), label: t('series:join.daysLeft', { count: left }) },
                { value: seriesNum(round.need), label: t('series:start.drawDays') },
            ]} />
            <Pressable
                onPress={() => { void Haptics.selectionAsync(); onJoin(); }}
                style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={t('series:join.ctaA11y', { season: def.name })}
            >
                <Ionicons name="flag-outline" size={16} color="#0a0a0a" />
                <Text style={s.btnText}>{t('series:join.cta')}</Text>
            </Pressable>
            <Text style={s.fine}>{t('series:join.fineLate', { date: seriesDate(new Date(round.startsAt).toISOString()) })}</Text>
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, justifyContent: 'flex-end' },
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: {
        backgroundColor: '#141414', borderTopLeftRadius: 24, borderTopRightRadius: 24,
        borderWidth: 1, borderColor: '#222222', maxHeight: '90%',
    },
    dragHeader: { paddingTop: 12, paddingBottom: 4, paddingHorizontal: 24 },
    handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 14 },
    body: { paddingHorizontal: 24, paddingBottom: 4 },

    eyebrow: { fontSize: 9, fontWeight: '800', color: GOLD, opacity: 0.7, letterSpacing: 2.5 },
    name: { fontSize: 28, fontWeight: '200', color: TEXT, letterSpacing: -0.5, marginTop: 4 },
    dates: { fontSize: 13, fontWeight: '300', color: TEXT_2, marginTop: 2 },
    inRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    inText: { fontSize: 24, fontWeight: '200', color: TEXT, letterSpacing: -0.5 },

    block: { marginTop: 18, gap: 8 },
    blockEyebrow: { fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.6, letterSpacing: 2.5 },
    prize: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    prizeIcon: {
        width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: 'rgba(232,210,0,0.35)',
    },
    prizeLead: { fontSize: 8, fontWeight: '700', letterSpacing: 1.4, color: TEXT_3 },
    prizeName: { fontSize: 14, fontWeight: '400', color: TEXT, marginTop: 1 },
    more: { fontSize: 11, fontWeight: '400', color: TEXT_3 },
    ruleRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    ruleBullet: { fontSize: 12, lineHeight: 17, color: GOLD },
    ruleText: { flex: 1, fontSize: 12, fontWeight: '300', color: TEXT_2, lineHeight: 17 },
    consent: { fontSize: 10, fontWeight: '400', color: TEXT_3, marginTop: 16, lineHeight: 14 },

    primary: { marginTop: 18, borderRadius: 100, backgroundColor: GOLD, paddingVertical: 14, alignItems: 'center' },
    primaryRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
    primaryText: { fontSize: 12, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1.5 },
    skip: { alignItems: 'center', paddingVertical: 14 },
    skipText: { fontSize: 13, fontWeight: '400', color: TEXT_2 },

    // The League screen (as the start line: one screen, no scroll)
    screen: { flex: 1, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14, gap: 12 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    head: { alignItems: 'center', marginTop: 18, gap: 6 },
    on: { fontSize: 30, fontWeight: '200', letterSpacing: 1, color: TEXT },
    dayOf: { fontSize: 9, fontWeight: '600', letterSpacing: 2.4, color: hexA(BUTTER, 0.75) },
    stage: { flex: 1, justifyContent: 'center', gap: 10 },
    row: {
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14,
        borderRadius: 14, borderWidth: 1, borderColor: '#222222', backgroundColor: '#111111',
    },
    rank: { width: 18, fontSize: 15, fontWeight: '300', color: TEXT_2, fontVariant: ['tabular-nums'] },
    rowName: { flex: 1, fontSize: 15, fontWeight: '300', color: TEXT },
    rowPts: { fontSize: 12, fontWeight: '500', color: TEXT_2, fontVariant: ['tabular-nums'] },
    btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, height: 50, borderRadius: 25, backgroundColor: GOLD },
    btnText: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5, color: '#0a0a0a' },
    fine: { textAlign: 'center', fontSize: 10, fontWeight: '400', letterSpacing: 0.3, color: TEXT_3 },
});
