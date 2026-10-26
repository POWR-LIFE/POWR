import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import type { SeriesMoment } from '@/lib/api/series';
import { type DailyTitle, fmt, ordinal, ROUND_MOMENTS, roundDate, TITLES } from '@/lib/dev/seriesPrototype';
import i18n, { getFormatLocale } from '@/lib/i18n';
import { CARD_BG, CARD_BORDER, GOLD, GREEN, HAIR, MoveChip, ORANGE, RollNumber, TEXT, TEXT_2, TEXT_3, YOU_LINE, YOU_TINT } from './SeriesLane';
import { BUTTER, hexA, mixHex, SeriesLockup, useSeason, useSeasonCard } from './season';
import type { SeriesView } from './seriesView';
import type { RecapLine } from './useSeriesSim';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const RED = '#f87171';
const NEWS_TONE = { green: GREEN, red: RED, gold: GOLD, muted: '#9a9a9a' };

/** The moment's clock: a live countdown for Power Hour, else the band's own words. */
function useClock(running: boolean) {
    const [secs, setSecs] = useState(41 * 60 + 20);
    useEffect(() => {
        if (!running) return undefined;
        const tm = setInterval(() => setSecs((x) => Math.max(0, x - 1)), 1000);
        return () => clearInterval(tm);
    }, [running]);
    return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

/** The Series card's height once it has folded down to a bar. */
export const SERIES_BAR_H = 60;

/**
 * The Series card at the top of the League tab. The season's lockup sits on a
 * band of its colour that fades into the app's dark card; what you read (your
 * rank, the days, the moment) stays in POWR gold. Between rounds it carries
 * your finish and when the next round starts.
 *
 * It stays pinned at the top. As the page scrolls (`scrollY`) it folds down to
 * a slim bar (the mark, your rank, the day) so the lists have the room.
 */
export function SeriesCard({
    v, onMoment, scrollY, onHeight, moments,
}: {
    v: SeriesView;
    /** The round's real moments (live data); the sample uses its own calendar. */
    moments?: MomentCard[];
    onMoment: () => void;
    scrollY?: SharedValue<number>;
    /** Its full height, so the page can start below it. */
    onHeight?: (h: number) => void;
}) {
    const { t } = useTranslation();
    const { def, tint } = useSeason();
    const card = tint?.card ?? CARD_BG;
    const h = v.hero;
    const band = v.band;
    const clock = useClock(!!band && !band.right);
    const running = v.phase === 'running';
    const next = ROUND_MOMENTS.find((m) => m.day > h.day);
    const f = v.finish;
    const away = h.pb != null ? h.rank - h.pb : null;
    // Your heat leads: your place in it, the next line, then the big board.
    const heat = v.headline === 'heat' ? v.heat : null;
    const [fullH, setFullH] = useState(0);
    const zero = useSharedValue(0);
    const y = scrollY ?? zero;
    // 0 at rest, 1 once the card has folded into the bar.
    const shell = useAnimatedStyle(() => (fullH ? { height: Math.max(SERIES_BAR_H, fullH - Math.max(0, y.value)) } : {}));
    const fullFade = useAnimatedStyle(() => {
        const p = fullH ? Math.min(1, Math.max(0, y.value / Math.max(1, fullH - SERIES_BAR_H))) : 0;
        return { opacity: 1 - Math.min(1, p * 1.6) };
    });
    const barFade = useAnimatedStyle(() => {
        const p = fullH ? Math.min(1, Math.max(0, y.value / Math.max(1, fullH - SERIES_BAR_H))) : 0;
        return { opacity: Math.max(0, (p - 0.55) / 0.45) };
    });
    return (
        <Animated.View style={[s.card, { borderColor: tint?.border ?? CARD_BORDER }, shell]}>
            <LinearGradient
                colors={[def.ground, def.ground, mixHex(def.ground, card, 0.45), card]}
                locations={[0, 0.23, 0.38, 0.85]}
                style={StyleSheet.absoluteFill}
            />
            <Animated.View
                style={[s.full, fullFade]}
                onLayout={(e) => {
                    const hh = Math.round(e.nativeEvent.layout.height) + 2;
                    if (hh !== fullH) { setFullH(hh); onHeight?.(hh); }
                }}
            >
                <View style={s.top}>
                    <SeriesLockup height={34} def={def} />
                    <View style={s.timeLeft}>
                        <Ionicons name="time-outline" size={13} color={TEXT_2} />
                        <Text style={s.timeText}>{running ? t('series:round.timeLeft', { left: h.left }) : f ? t('series:round.final') : v.next.starts}</Text>
                    </View>
                </View>

                {/* Your position, in three: where you are, last round, your best.
                    With heats: your heat, its next line, the big board. */}
                <View style={s.pos}>
                    {running && heat ? (
                        <>
                            <View style={s.posMain}>
                                <Text style={s.label} numberOfLines={1}>HEAT · DIV {heat.meta.div}</Text>
                                <View style={s.posRank}>
                                    {h.blind ? <Text style={s.posNum}>?</Text> : <RollNumber value={heat.rank} style={s.posNum} />}
                                    {!h.blind && <Text style={[s.posHash, s.posSuffix]}>{ordinal(heat.rank).replace(/^\d+/, '')}</Text>}
                                </View>
                                <Text style={[s.posToday, { color: h.blind || !heat.move ? TEXT_3 : heat.move > 0 ? GREEN : RED }]}>
                                    {h.blind ? 'hidden today' : heat.move ? `${heat.move > 0 ? '▲' : '▼'} ${Math.abs(heat.move)} today` : `of ${heat.meta.size}`}
                                </Text>
                            </View>
                            <View style={s.posRule} />
                            <View style={s.posStat}>
                                {h.blind ? (
                                    <>
                                        <Text style={s.label}>RANKS BACK</Text>
                                        <Text style={s.statVal}>{v.live ? moments?.find((m) => m.kind === 'blind' && m.state === 'live')?.back ?? 'Soon' : 'Thu 08:00'}</Text>
                                        <Text style={s.statSub}>keep moving</Text>
                                    </>
                                ) : heat.status === 'up' ? (
                                    <>
                                        <Text style={s.label}>MOVING UP</Text>
                                        <Text style={[s.statVal, { color: GREEN }]}>+{fmt(heat.clear ?? 0)}</Text>
                                        <Text style={s.statSub} numberOfLines={1}>pts clear of {ordinal(heat.meta.up + 1)}</Text>
                                    </>
                                ) : heat.status === 'drop' ? (
                                    <>
                                        <Text style={s.label}>TO GET CLEAR</Text>
                                        <Text style={[s.statVal, { color: ORANGE }]}>{fmt(heat.toSafe ?? 0)} pts</Text>
                                        <Text style={s.statSub} numberOfLines={1}>out of the bottom {heat.meta.down}</Text>
                                    </>
                                ) : (
                                    <>
                                        <Text style={s.label}>{heat.meta.div > 1 ? 'TO MOVE UP' : 'TO 1ST'}</Text>
                                        <Text style={s.statVal}>{heat.toUp == null ? '—' : `${fmt(heat.toUp)} pts`}</Text>
                                        <Text style={s.statSub} numberOfLines={1}>{heat.meta.div > 1 ? `to the top ${heat.meta.up}` : 'in your heat'}</Text>
                                    </>
                                )}
                            </View>
                            <View style={s.posRule} />
                            <View style={s.posStat}>
                                <Text style={s.label}>OVERALL</Text>
                                <Text style={s.statVal}>{h.blind ? '#?' : `#${fmt(h.rank)}`}</Text>
                                <Text style={[s.statSub, !h.blind && h.move > 0 && { color: GREEN }, !h.blind && h.move < 0 && { color: RED }]}>
                                    {h.blind || !h.move ? `of ${fmt(h.total)}` : `${h.move > 0 ? '▲' : '▼'} ${fmt(Math.abs(h.move))} today`}
                                </Text>
                            </View>
                        </>
                    ) : running ? (
                        <>
                            <View style={s.posMain}>
                                <Text style={s.label}>{t('series:round.yourPosition')}</Text>
                                <View style={s.posRank}>
                                    <Text style={s.posHash}>#</Text>
                                    {h.blind ? <Text style={s.posNum}>?</Text> : <RollNumber value={h.rank} style={s.posNum} />}
                                </View>
                                <Text style={[s.posToday, { color: h.blind || !h.move ? TEXT_3 : h.move > 0 ? GREEN : RED }]}>
                                    {h.blind ? t('series:round.hiddenToday') : h.move ? t('series:round.moveToday', { arrow: h.move > 0 ? '▲' : '▼', n: Math.abs(h.move) }) : t('series:round.noMoveToday')}
                                </Text>
                            </View>
                            <View style={s.posRule} />
                            <View style={s.posStat}>
                                <Text style={s.label}>{t('series:round.lastRound')}</Text>
                                <Text style={s.statVal}>{h.last == null ? t('series:round.new') : `#${fmt(h.last)}`}</Text>
                                <Text style={s.statSub}>
                                    {h.last == null ? t('series:round.firstRound')
                                        : h.blind ? ''
                                            : h.last > h.rank ? t('series:round.placesUp', { count: h.last - h.rank, n: fmt(h.last - h.rank) })
                                                : h.last < h.rank ? t('series:round.placesDown', { count: h.rank - h.last, n: fmt(h.rank - h.last) })
                                                    : t('series:round.samePlace')}
                                </Text>
                            </View>
                            <View style={s.posRule} />
                            <View style={s.posStat}>
                                <Text style={s.label}>{h.blind ? t('series:round.ranksBack') : t('series:round.yourBest')}</Text>
                                <Text style={s.statVal}>
                                    {h.blind
                                        ? (v.live ? moments?.find((m) => m.kind === 'blind' && m.state === 'live')?.back ?? t('series:round.soon') : 'Thu 08:00')
                                        : h.pb != null ? `#${fmt(h.pb)}` : '—'}
                                </Text>
                                <Text style={[s.statSub, away != null && away <= 0 && !h.blind && { color: GREEN }]}>
                                    {h.blind ? t('series:round.keepMoving') : away == null ? '' : away <= 0 ? t('series:round.newBest') : t('series:round.placesAway', { count: away, n: fmt(away) })}
                                </Text>
                            </View>
                        </>
                    ) : !f ? (
                        // Before the round: when it starts, how long it runs, what gets you in The Draw.
                        <>
                            <View style={s.posMain}>
                                <Text style={s.label}>{t('series:round.startsIn')}</Text>
                                <View style={s.posRank}><Text style={s.posNum}>{v.next.inDays}</Text></View>
                                <Text style={[s.posToday, { color: TEXT_3 }]}>{t('series:round.daysToGo', { count: v.next.inDays })}</Text>
                            </View>
                            <View style={s.posRule} />
                            <View style={s.posStat}>
                                <Text style={s.label}>{t('series:round.theRound')}</Text>
                                <Text style={s.statVal}>{t('series:round.days', { count: v.round.days })}</Text>
                                <Text style={s.statSub} numberOfLines={1}>{t('series:round.toDate', { date: v.round.lastDay })}</Text>
                            </View>
                            <View style={s.posRule} />
                            <View style={s.posStat}>
                                <Text style={s.label}>THE DRAW</Text>
                                <Text style={s.statVal}>{t('series:round.days', { count: h.need })}</Text>
                                <Text style={s.statSub} numberOfLines={1}>{t('series:round.toGetIn')}</Text>
                            </View>
                        </>
                    ) : (
                        <>
                            <View style={s.posMain}>
                                <Text style={s.label}>{f ? t('series:round.finish', { round: v.round.name.toUpperCase() }) : v.next.label.toUpperCase()}</Text>
                                <View style={s.posRank}>
                                    {f && <Text style={s.posHash}>#</Text>}
                                    <Text style={s.posNum}>{f ? fmt(f.rank) : v.next.inDays}</Text>
                                </View>
                                <Text style={[s.posToday, { color: f?.climb ? GREEN : TEXT_3 }]}>
                                    {f ? (f.climb ? t('series:round.climb', { n: f.climb }) : t('series:round.topPct', { pct: f.pct })) : t('series:round.daysToGo', { count: v.next.inDays })}
                                </Text>
                            </View>
                            <View style={s.posRule} />
                            <View style={s.posStat}>
                                <Text style={s.label}>THE DRAW</Text>
                                <Text style={s.statVal}>{f ? (f.inDraw ? t('series:round.drawIn') : t('series:round.drawOut')) : t('series:round.drawOpen')}</Text>
                                <Text style={s.statSub}>{t('series:round.drawnOn', { on: v.round.prizesOn })}</Text>
                            </View>
                            <View style={s.posRule} />
                            <View style={s.posStat}>
                                <Text style={s.label}>{t('series:round.nextRound')}</Text>
                                <Text style={s.statVal}>{v.next.starts}</Text>
                                <Text style={s.statSub}>{t('series:round.startsLevel')}</Text>
                            </View>
                        </>
                    )}
                </View>

                {/* Live: the moment that's on, else the next one, else The Draw. */}
                {running && (() => {
                    const on = v.live ? moments?.find((m) => m.state === 'live') : undefined;
                    const nx = v.live ? moments?.find((m) => m.state === 'next') : undefined;
                    const text = v.live
                        ? on ? t('series:round.footOnNow', { name: on.name })
                            : nx ? t('series:round.footNext', { name: nx.name, when: (nx.soon ?? nx.when).toUpperCase() })
                                : h.logged >= h.need ? t('series:round.footDrawIn') : t('series:round.footDrawDays', { logged: h.logged, need: h.need })
                        : band ? band.text : next ? `NEXT · ${next.name} · ${roundDate(next.day).toUpperCase()}` : 'THE LAST DAYS OF THE ROUND';
                    const icon: IconName = v.live ? on?.icon ?? nx?.icon ?? 'ticket-outline' : band?.icon ?? next?.icon ?? 'flag-outline';
                    const gold = v.live ? !!on : !!band;
                    const dayOfRound = t('series:round.dayOf', { day: h.day, days: v.round.days });
                    const right = v.live ? on?.until?.toUpperCase() ?? dayOfRound : band ? band.right ?? clock : dayOfRound;
                    return (
                        <Pressable
                            onPress={onMoment}
                            hitSlop={8}
                            style={({ pressed }) => [s.foot, pressed && { opacity: 0.6 }]}
                            accessibilityRole="button"
                            accessibilityLabel={t('series:round.footA11y', { text, day: h.day, days: v.round.days })}
                        >
                            <Ionicons name={icon} size={12} color={GOLD} />
                            <Text style={[s.footText, gold && { color: GOLD }]} numberOfLines={1}>{text}</Text>
                            <Text style={s.footRight}>{right}</Text>
                        </Pressable>
                    );
                })()}
            </Animated.View>

            {/* Folded: the mark, your rank and the day, in one bar. */}
            <Animated.View pointerEvents="none" style={[s.bar, { backgroundColor: mixHex(def.ground, card, 0.55) }, barFade]}>
                <SeriesLockup height={24} def={def} words={false} />
                <View style={s.barRank}>
                    <Text style={s.barNum}>
                        {running
                            ? (h.blind ? '#?' : heat ? ordinal(heat.rank) : `#${fmt(h.rank)}`)
                            : f ? `#${fmt(f.rank)}` : t('series:round.days', { count: v.next.inDays })}
                    </Text>
                    {running && heat && !h.blind && <Text style={s.barTag}>IN HEAT</Text>}
                    {running && !h.blind && <MoveChip delta={heat ? heat.move : h.move} />}
                </View>
                <Text style={s.barDay}>{running ? t('series:round.dayOf', { day: h.day, days: v.round.days }) : f ? t('series:round.finalCaps') : t('series:round.toGo')}</Text>
            </Animated.View>
        </Animated.View>
    );
}

/** What changed since yesterday, on the page: up to three lines, no tap to find out. */
export function NewsLines({ lines }: { lines: RecapLine[] }) {
    if (!lines.length) return null;
    return (
        <View style={s.news}>
            {lines.map((l) => {
                const c = NEWS_TONE[l.tone];
                return (
                    <View key={l.text} style={s.newsRow}>
                        <View style={[s.newsIcon, { borderColor: hexA(c.startsWith('#') ? c : '#9a9a9a', 0.4) }]}>
                            <Ionicons name={l.icon as IconName} size={12} color={c} />
                        </View>
                        <Text style={[s.newsText, l.tone === 'gold' && s.newsGold]} numberOfLines={1}>{l.text}</Text>
                    </View>
                );
            })}
        </View>
    );
}

/** A moment as the round card and the strip show it. */
export type MomentCard = {
    key: string;
    name: string;
    what: string;
    icon: IconName;
    /** "Wed 18 Nov", "18:00–19:00 · Sat 28 Nov", "Sat 28–Mon 30 Nov"; '' for a secret one. */
    when: string;
    state: 'past' | 'live' | 'next' | 'later';
    /** Never announced: no name or date until it starts. */
    secret?: boolean;
    /** The moment's kind on the server (live only). */
    kind?: string;
    /** While it's on: when it ends, "until 19:00" / "until Mon". */
    until?: string;
    /** When it starts, short: "Sat 24 Oct", "Thu 22 18:00" (for "NEXT · …"). */
    soon?: string;
    /** While it's on, when it's over, shortest: "19:00" today, else "Sat 24". */
    back?: string;
};

export const MOMENT_ICON: Record<string, IconName> = {
    gun: 'flag-outline', double_down: 'flash-outline', event_night: 'location-outline', power_hour: 'timer-outline',
    all_in: 'flame-outline', blind: 'eye-off-outline', plague: 'people-outline', secret: 'help-outline',
};

/** The sample round's moments (ROUND_MOMENTS), by the sample's day. */
export function sampleMomentCards(day: number): MomentCard[] {
    const next = ROUND_MOMENTS.find((m) => m.day > day);
    return ROUND_MOMENTS.map((m) => {
        const end = m.day + (m.days ?? 1) - 1;
        const state = end < day ? 'past' : day >= m.day ? 'live' : m === next ? 'next' : 'later';
        return {
            key: m.key, name: m.name, what: m.what, icon: m.icon, state,
            when: m.days ? `${roundDate(m.day).replace(' Nov', '')}–${end} Nov` : roundDate(m.day),
        };
    });
}

const LON = 'Europe/London';
const dayOf = (d: Date) => d.toLocaleDateString(getFormatLocale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: LON }).replace(',', '');
const timeOf = (d: Date) => d.toLocaleTimeString(getFormatLocale(), { hour: '2-digit', minute: '2-digit', timeZone: LON });
/** A check, not copy: read in one fixed locale, since "00:00" is "00 h 00" or "12:00 a.m." in others. */
const isMidnight = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LON }) === '00:00';
/** "Thu 22" */
const dayShort = (d: Date) => dayOf(d).split(' ').slice(0, 2).join(' ');

/** The round's real moments (get_series_moments), placed against now. */
export function liveMomentCards(moments: SeriesMoment[], now = Date.now()): MomentCard[] {
    let nextSeen = false;
    return moments.map((m, i) => {
        if (m.kind === 'secret' || !m.starts_at || !m.ends_at) {
            return { key: m.id ?? `secret-${i}`, name: i18n.t('series:round.sealed'), what: i18n.t('series:round.secretWhat'), icon: 'help-outline', when: '', state: 'later', secret: true };
        }
        const a = new Date(m.starts_at);
        const b = new Date(m.ends_at);
        const last = new Date(b.getTime() - 1);
        const live = now >= a.getTime() && now < b.getTime();
        const past = now >= b.getTime();
        const isNext = !live && !past && !nextSeen;
        if (isNext) nextSeen = true;
        const whole = isMidnight(a) && isMidnight(b);
        const sameDay = dayOf(a) === dayOf(last);
        const sameClockDay = dayOf(a) === dayOf(b) || (isMidnight(b) && sameDay);
        const when = whole
            ? (sameDay ? dayOf(a) : `${dayShort(a)}–${dayOf(last)}`)
            : sameClockDay ? `${dayShort(a)} · ${timeOf(a)}–${timeOf(b)}` : `${dayShort(a)} ${timeOf(a)} → ${dayShort(b)}`;
        const until = live
            ? (isMidnight(b) && !sameDay ? i18n.t('series:round.untilDay', { day: dayOf(last).split(' ')[0] })
                : isMidnight(b) ? i18n.t('series:round.untilMidnight')
                    : sameClockDay ? i18n.t('series:round.untilTime', { time: timeOf(b) })
                        : i18n.t('series:round.untilDayTime', { day: dayShort(b), time: timeOf(b) }))
            : undefined;
        const soon = isMidnight(a) ? dayOf(a) : `${dayShort(a)} ${timeOf(a)}`;
        const back = live ? (dayOf(b) === dayOf(new Date(now)) ? timeOf(b) : dayShort(b)) : undefined;
        return {
            key: m.id, name: (m.name ?? '').toUpperCase(), what: m.line ?? '', icon: MOMENT_ICON[m.kind] ?? 'flag-outline',
            when, state: past ? 'past' : live ? 'live' : isNext ? 'next' : 'later', until, soon, back, kind: m.kind,
        };
    });
}

/** The round's moments, swipeable: done, on now, next, and the ones still sealed. */
export function MomentStrip({ cards }: { cards: MomentCard[] }) {
    const { t } = useTranslation();
    const sc = useSeasonCard();
    const ref = useRef<ScrollView>(null);
    const focus = Math.max(0, cards.findIndex((c) => c.state === 'live' || c.state === 'next'));
    useEffect(() => {
        const tm = setTimeout(() => ref.current?.scrollTo({ x: Math.max(0, focus * 158), animated: false }), 60);
        return () => clearTimeout(tm);
    }, [focus]);
    return (
        <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip} snapToInterval={158} decelerationRate="fast">
            {cards.map((m) => {
                const past = m.state === 'past';
                const live = m.state === 'live';
                const isNext = m.state === 'next';
                const named = !m.secret && (past || live || isNext);
                return (
                    <View key={m.key} style={[s.mCard, sc, live && s.mLive, isNext && s.mNext, past && { opacity: 0.55 }]}>
                        {live && <LinearGradient colors={['rgba(232,210,0,0.08)', 'rgba(232,210,0,0)']} style={StyleSheet.absoluteFill} />}
                        <View style={s.mTop}>
                            <View style={[s.mIcon, past && s.mIconPast, live && s.mIconLive, !named && s.mIconSealed]}>
                                {named
                                    ? <Ionicons name={past ? 'checkmark' : m.icon} size={13} color={past || live ? '#0a0a0a' : GOLD} />
                                    : <Text style={s.mQ}>?</Text>}
                            </View>
                            <Text style={[s.mState, live && { color: GREEN }, isNext && { color: GOLD }]}>{live ? t('series:round.momentOnNow') : isNext ? t('series:round.momentNext') : past ? t('series:round.momentDone') : t('series:round.sealed')}</Text>
                        </View>
                        <Text style={s.mDate}>{m.secret ? '—' : m.when}</Text>
                        <Text style={[s.mName, !named && { color: TEXT_3 }]}>{named ? m.name : t('series:round.sealed')}</Text>
                        <Text style={s.mWhat}>{m.secret ? m.what : named ? m.what : t('series:round.revealedClose')}</Text>
                    </View>
                );
            })}
        </ScrollView>
    );
}

/** Today's titles, all of them, yours first. Each one is a Draw ticket. */
export function TitlesList({ titles }: { titles: DailyTitle[] }) {
    const sc = useSeasonCard();
    const sorted = [...titles].sort((a, c) => Number(c.you) - Number(a.you));
    return (
        <View style={[s.tCard, sc]}>
            {sorted.map((t, i) => {
                const d = TITLES[t.key];
                return (
                    <View key={t.key} style={[s.tRow, t.you && s.tRowYou]}>
                        {t.you && <LinearGradient colors={YOU_TINT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />}
                        {i > 0 && !t.you && !sorted[i - 1].you && <View style={s.tHair} />}
                        <View style={[s.tIcon, t.you && s.tIconYou]}>
                            <Ionicons name={d.icon} size={15} color={t.you ? GOLD : TEXT_2} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[s.tLabel, t.you && { color: GOLD }]}>{d.label}</Text>
                            <Text style={s.tWho} numberOfLines={1}>
                                <Text style={{ color: TEXT, fontWeight: t.you ? '500' : '400' }}>{t.you ? 'You' : t.who}</Text> · {t.why}
                            </Text>
                        </View>
                        {t.you && (
                            <View style={s.ticket}>
                                <Ionicons name="ticket-outline" size={11} color={GOLD} />
                                <Text style={s.ticketText}>+1</Text>
                            </View>
                        )}
                    </View>
                );
            })}
        </View>
    );
}

const s = StyleSheet.create({
    card: { marginHorizontal: 16, marginTop: 6, borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
    full: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 14 },
    timeLeft: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
    timeText: { fontSize: 12, fontWeight: '400', color: TEXT, fontVariant: ['tabular-nums'] },
    pos: { flexDirection: 'row', alignItems: 'stretch', gap: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR },
    posMain: { flex: 1.15, gap: 3 },
    posRank: { flexDirection: 'row', alignItems: 'flex-start' },
    posHash: { fontSize: 16, lineHeight: 22, fontWeight: '200', color: GOLD, opacity: 0.75, marginRight: 1 },
    posSuffix: { marginRight: 0, marginLeft: 2 },
    posNum: { fontSize: 32, lineHeight: 36, fontWeight: '200', color: GOLD, letterSpacing: -1, fontVariant: ['tabular-nums'] },
    posToday: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
    posRule: { width: StyleSheet.hairlineWidth, backgroundColor: HAIR },
    posStat: { flex: 1, gap: 3, justifyContent: 'flex-start' },
    statVal: { marginTop: 4, fontSize: 17, lineHeight: 22, fontWeight: '300', color: TEXT, fontVariant: ['tabular-nums'] },
    statSub: { fontSize: 10, fontWeight: '300', color: TEXT_3 },
    bar: { position: 'absolute', left: 0, right: 0, top: 0, height: SERIES_BAR_H - 2, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16 },
    barRank: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
    barNum: { fontSize: 22, fontWeight: '200', color: GOLD, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
    barTag: { fontSize: 8, fontWeight: '600', letterSpacing: 1.4, color: TEXT_3 },
    barDay: { fontSize: 9, fontWeight: '600', letterSpacing: 1.6, color: TEXT_2 },
    top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
    meta: { fontSize: 8, fontWeight: '600', letterSpacing: 1.8, lineHeight: 14, textAlign: 'right', color: hexA(BUTTER, 0.6) },
    labels: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
    label: { fontSize: 8, fontWeight: '600', letterSpacing: 1.4, color: TEXT_3 },
    rankLine: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 2 },
    hash: { fontSize: 28, lineHeight: 30, fontWeight: '100', color: GOLD, opacity: 0.7, marginBottom: 40, marginRight: 3 },
    num: { fontSize: 76, lineHeight: 80, fontWeight: '100', color: GOLD, letterSpacing: -3.5, fontVariant: ['tabular-nums'] },
    move: { marginLeft: 12, marginBottom: 13 },
    sub: { marginTop: 4, fontSize: 13, fontWeight: '300', lineHeight: 18, color: TEXT_2 },
    subStrong: { color: TEXT, fontWeight: '500' },
    bottom: { gap: 10, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR },
    days: { flexDirection: 'row', gap: 3 },
    dayCell: { flex: 1, alignItems: 'center' },
    daySeg: { alignSelf: 'stretch', height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)' },
    dayPast: { backgroundColor: 'rgba(232,210,0,0.45)' },
    dayNow: { backgroundColor: GOLD },
    dayDot: { width: 3, height: 3, borderRadius: 2, marginTop: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
    foot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    footText: { flex: 1, fontSize: 9, fontWeight: '700', letterSpacing: 1.6, color: TEXT_2 },
    footRight: { fontSize: 11, fontWeight: '500', color: TEXT, fontVariant: ['tabular-nums'] },

    news: { marginHorizontal: 20, gap: 9, marginTop: 4 },
    newsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    newsIcon: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    newsText: { flex: 1, fontSize: 13, fontWeight: '300', lineHeight: 18, color: TEXT_2 },
    newsGold: { color: TEXT, fontWeight: '400' },

    strip: { paddingHorizontal: 16, gap: 8 },
    mCard: { width: 150, padding: 14, gap: 4, borderRadius: 16, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, overflow: 'hidden' },
    mLive: { borderColor: 'rgba(232,210,0,0.45)' },
    mNext: { borderColor: 'rgba(232,210,0,0.22)' },
    mTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    mIcon: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(232,210,0,0.45)', alignItems: 'center', justifyContent: 'center' },
    mIconPast: { backgroundColor: 'rgba(232,210,0,0.85)', borderColor: GOLD },
    mIconLive: { backgroundColor: GOLD, borderColor: GOLD },
    mIconSealed: { borderColor: 'rgba(255,255,255,0.2)', borderStyle: 'dashed' },
    mQ: { fontSize: 9, fontWeight: '700', color: TEXT_3 },
    mState: { fontSize: 8, fontWeight: '700', letterSpacing: 1.4, color: TEXT_3 },
    mDate: { fontSize: 10, color: TEXT_3, fontVariant: ['tabular-nums'] },
    mName: { fontSize: 11, fontWeight: '700', letterSpacing: 1.6, color: TEXT },
    mWhat: { fontSize: 12, fontWeight: '300', lineHeight: 16, color: TEXT_3 },

    tCard: { marginHorizontal: 16, borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6 },
    tRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingVertical: 8 },
    tRowYou: { paddingHorizontal: 10, marginBottom: 4, borderRadius: 14, borderWidth: 1, borderColor: YOU_LINE, overflow: 'hidden' },
    tHair: { position: 'absolute', left: 46, right: 4, top: 0, height: StyleSheet.hairlineWidth, backgroundColor: HAIR },
    tIcon: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
    tIconYou: { borderColor: 'rgba(232,210,0,0.5)', backgroundColor: 'rgba(232,210,0,0.08)' },
    tLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.8, color: TEXT_3 },
    tWho: { marginTop: 2, fontSize: 12, fontWeight: '300', color: TEXT_3 },
    ticket: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(232,210,0,0.32)' },
    ticketText: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: GOLD },
});
