import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { kit } from '@/components/drop/cardKit';
import { HomeCard, HomeNote, type HomeStat, HomeStats } from '@/components/home/HomeCard';
import { trackTap } from '@/lib/analytics';
import { fmt, ordinal } from '@/lib/dev/seriesPrototype';
import { inviteCodeLine } from '@/lib/eventInviteLink';
import { friendInviteLink } from '@/lib/social/friendCode';
import { inviteNext } from './SeriesInvite';
import { useSeriesDress } from './SeriesRoundCard';
import { CARD_BG, CARD_BORDER, GOLD, GREEN, HAIR, RED, TEXT, TEXT_2, TEXT_3 } from './SeriesLane';
import type { PrizeState } from './SeriesPrizes';
import type { Around, SeriesComing, SeriesToday } from './SeriesToday';
import { useSeasonCard } from './season';
import type { RecapLine } from './useSeriesSim';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/*
 * The Series cards Home shows around the round itself: the countdown before a
 * round (and how the last one went, between rounds), what changed since you
 * last looked, and what you're playing for. They read Home's one Series source
 * (useSeriesHome in ./SeriesToday).
 */

const LON = 'Europe/London';
const timeOf = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LON });
const dateKey = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { timeZone: LON });
const first = (name: string) => name.split(' ')[0];

const openLeague = (from: string) => {
    void Haptics.selectionAsync();
    trackTap('series_home_open', { from });
    router.push('/(tabs)/league');
};

/** "23d 04h", "14h 05m", "38m". */
export function countdown(ms: number): string {
    const m = Math.max(0, Math.floor(ms / 60_000));
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h`;
    if (h > 0) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
    return `${m}m`;
}

/* ── Before a round, and between rounds ──────────────────────────────── */

/**
 * The Series on Home when no round is running, in Home's one layout: before
 * one, when it starts and what gets you in the Draw; between rounds, where
 * you finished, whether you made the Draw, and the countdown to the next.
 *
 * While a round's invite period is on, it's the invite race instead: your
 * place, your friends in, the countdown, and INVITE A FRIEND as the one
 * button. Just the card: picking a city is left to the League for now.
 */
export function SeriesComingCard({ coming: c }: { coming: SeriesComing }) {
    const { t } = useTranslation();
    const [now, setNow] = useState(Date.now());
    const near = c.next != null && c.next.startsAt - now < 3_600_000;
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), near ? 15_000 : 60_000);
        return () => clearInterval(t);
    }, [near]);
    const upcoming = c.phase === 'upcoming';
    // Gold is for your own numbers: the countdown stays white.
    const clock: HomeStat = c.next
        ? { value: countdown(c.next.startsAt - now), label: upcoming ? `To ${c.roundName}` : `To ${c.next.name}` }
        : { value: '—', label: 'Next round soon' };
    const inv = upcoming ? c.invite : null;
    const shareInvite = async () => {
        const code = inv?.me.code;
        if (!code) return;
        trackTap('series_invite', { from: 'home' });
        const link = friendInviteLink(code);
        try {
            await Share.share({ message: `${t('events:invite.joinMe', { codeLine: inviteCodeLine(code) })}\n${link}`, url: link });
        } catch {
            // dismissed
        }
    };
    const items: HomeStat[] = inv
        ? [
            inv.me.rank != null ? { value: ordinal(inv.me.rank), label: 'Your place', tone: 'gold' } : { value: '—', label: 'Not on it yet' },
            {
                value: `${inv.me.friends}`,
                label: `${inv.me.friends === 1 ? 'Friend in' : 'Friends in'}${inv.me.joining > 0 ? ` · +${inv.me.joining} joining` : ''}`,
            },
            clock,
        ]
        : upcoming
        ? [clock, { value: `${c.days}`, label: 'Days in the round' }, { value: `${c.need}`, label: 'Days for the draw' }]
        : [
            c.finish ? { value: `#${fmt(c.finish.rank)}`, label: `Finished · of ${fmt(c.finish.total)}`, tone: 'gold' } : { value: '—', label: 'Finished' },
            c.finish ? { value: c.finish.inDraw ? 'In' : 'Out', label: 'The draw', tone: c.finish.inDraw ? 'green' : undefined } : { value: '—', label: 'The draw' },
            clock,
        ];
    const dress = useSeriesDress(c.season, inv ? `Invite race · ${c.roundName} next` : upcoming ? `${c.roundName} · starting soon` : `${c.roundName} · finished`);
    return (
        <HomeCard
            {...dress}
            title={inv ? `${c.season} · invite race` : upcoming ? `${c.season} · ${c.roundName}` : `${c.roundName} · finished`}
            onPress={() => openLeague(upcoming ? 'coming' : 'finished')}
            label={`${c.season}. ${items.map((x) => `${x.value} ${x.label}`).join('. ')}. Opens the League.`}
            action={inv && inv.me.code
                ? { icon: 'person-add-outline', label: 'Invite a friend', onPress: () => { void shareInvite(); }, primary: true }
                : !upcoming && c.winners ? { icon: 'trophy-outline', label: 'See the winners', onPress: () => openLeague('winners') } : undefined}
        >
            <HomeStats items={items} />
            {inv && <HomeNote icon="people-outline" lead="Next" text={inviteNext(inv)} />}
        </HomeCard>
    );
}

/* ── Since you last looked ───────────────────────────────────────────── */

/** What Home remembers between visits (live). */
export type Seen = { slug: string; at: number; rank: number; points: number; logged: number; need: number; around: Around[] };

const SEEN_KEY = '@powr/series_seen_v1';
/** Away at least this long before Home says what changed. */
const AWAY_MS = 3 * 3_600_000;

/** "SINCE 09:14" today, "SINCE YESTERDAY", else "SINCE TUE". */
export function sinceLabel(at: number, now: number): string {
    if (dateKey(at) === dateKey(now)) return `SINCE ${timeOf(at)}`;
    if (dateKey(at) === dateKey(now - 86_400_000)) return 'SINCE YESTERDAY';
    return `SINCE ${new Date(at).toLocaleDateString('en-GB', { weekday: 'short', timeZone: LON }).toUpperCase()}`;
}

/**
 * What changed between two looks at the board, in up to three lines: places,
 * who you passed and who passed you (only people the board showed both times,
 * so it never guesses), the Draw, then where your rival stands.
 */
export function sinceLines(seen: Seen, t: SeriesToday): RecapLine[] {
    const lines: RecapLine[] = [];
    const names = (xs: Around[]) => {
        const f = xs.map((x) => first(x.name));
        return f.length <= 2 ? f.join(' and ') : `${f[0]}, ${f[1]} and ${f.length - 2} more`;
    };
    if (!t.blind) {
        const places = seen.rank - t.rank;
        if (places > 0) lines.push({ icon: 'caret-up', tone: 'green', text: `Up ${fmt(places)} ${places === 1 ? 'place' : 'places'} · you’re #${fmt(t.rank)}` });
        else if (places < 0) lines.push({ icon: 'caret-down', tone: 'red', text: `Down ${fmt(-places)} ${places === -1 ? 'place' : 'places'} · you’re #${fmt(t.rank)}` });
        const now = new Map(t.around.map((a) => [a.id, a.pts]));
        const passed = seen.around.filter((a) => a.pts > seen.points && (now.get(a.id) ?? Infinity) < t.points);
        const passedYou = seen.around.filter((a) => a.pts < seen.points && (now.get(a.id) ?? -Infinity) > t.points);
        if (passed.length) lines.push({ icon: 'trending-up-outline', tone: 'muted', text: `You passed ${names(passed)}` });
        if (passedYou.length) lines.push({ icon: 'trending-down-outline', tone: 'muted', text: `${names(passedYou)} passed you` });
    }
    if (seen.logged < seen.need && t.draw.logged >= t.draw.need) lines.push({ icon: 'ticket-outline', tone: 'gold', text: 'You’re in the Draw' });
    if (!lines.length) return lines;
    const r = t.rival;
    if (r && !t.blind && lines.length < 3) {
        const gap = `${fmt(r.gap)} ${r.gap === 1 ? 'pt' : 'pts'}`;
        lines.push({ icon: 'locate-outline', tone: 'muted', text: r.ahead ? `${first(r.p.name)} is ${gap} behind you` : `${first(r.p.name)} is ${gap} ahead` });
    }
    return lines.slice(0, 3);
}

/* The sample's card, shown until dismissed; the sim's SINCE YESTERDAY chip brings it back. */
let sinceHidden = false;
const sinceListeners = new Set<() => void>();
export const sinceSim = {
    show() { sinceHidden = false; sinceListeners.forEach((l) => l()); },
    hide() { sinceHidden = true; sinceListeners.forEach((l) => l()); },
};
const useSinceHidden = () => useSyncExternalStore(
    (l) => { sinceListeners.add(l); return () => { sinceListeners.delete(l); }; },
    () => sinceHidden,
);

/**
 * Live: compares the board with the last look (kept on the device), once each
 * time Home comes into view, then remembers this look. Shown only after three
 * hours away and only when something changed.
 */
function useLiveSince(t: SeriesToday | null): { label: string; lines: RecapLine[] } | null {
    const focused = useIsFocused();
    const live = t?.source === 'live' ? t : null;
    const [since, setSince] = useState<{ label: string; lines: RecapLine[] } | null>(null);
    const checked = useRef(false);
    useEffect(() => {
        if (!focused) checked.current = false;
    }, [focused]);
    useEffect(() => {
        if (!live || !focused) return undefined;
        let gone = false;
        const look: Seen = {
            slug: live.slug, at: Date.now(), rank: live.rank, points: live.points,
            logged: live.draw.logged, need: live.draw.need, around: live.around,
        };
        void (async () => {
            if (!checked.current) {
                checked.current = true;
                try {
                    const raw = await AsyncStorage.getItem(SEEN_KEY);
                    const seen = raw ? (JSON.parse(raw) as Seen) : null;
                    const lines = seen && seen.slug === live.slug && look.at - seen.at >= AWAY_MS ? sinceLines(seen, live) : [];
                    if (!gone) setSince(lines.length && seen ? { label: sinceLabel(seen.at, look.at), lines } : null);
                } catch {
                    if (!gone) setSince(null);
                }
            }
            await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(look)).catch(() => {});
        })();
        return () => { gone = true; };
    }, [live?.slug, live?.rank, live?.points, live?.draw.logged, focused]); // eslint-disable-line react-hooks/exhaustive-deps
    return since;
}

/** Under the top line on the first look after a while: what changed, no tap needed to find out. */
export function SeriesSinceCard({ today }: { today: SeriesToday }) {
    const sc = useSeasonCard();
    const liveSince = useLiveSince(today);
    const hidden = useSinceHidden();
    const [closed, setClosed] = useState<string | null>(null);
    const since = today.source === 'sample'
        ? (hidden || !today.news?.length ? null : { label: 'SINCE YESTERDAY', lines: today.news.slice(0, 3) })
        : liveSince;
    if (!since || closed === since.label + since.lines.map((l) => l.text).join()) return null;
    const close = () => {
        void Haptics.selectionAsync();
        if (today.source === 'sample') sinceSim.hide();
        else setClosed(since.label + since.lines.map((l) => l.text).join());
    };
    // The lines open the League; the × sits beside them, not inside the button (web can't nest buttons).
    return (
        <View style={[s.since, sc]}>
            <View style={s.sinceHead}>
                <Text style={s.kicker}>{since.label}</Text>
                <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Dismiss">
                    <Ionicons name="close" size={15} color={TEXT_3} />
                </Pressable>
            </View>
            <Pressable
                onPress={() => openLeague('since')}
                style={({ pressed }) => [s.sinceBody, pressed && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityLabel={`${since.label.toLowerCase()}: ${since.lines.map((l) => l.text).join('. ')}. Opens the League.`}
            >
                {since.lines.map((l) => {
                    const c = l.tone === 'green' ? GREEN : l.tone === 'red' ? RED : l.tone === 'gold' ? GOLD : TEXT_3;
                    return (
                        <View key={l.text} style={s.sinceRow}>
                            <View style={[s.sinceIcon, { borderColor: `${c.startsWith('#') ? c : '#8a8a8a'}66` }]}>
                                <Ionicons name={l.icon as IconName} size={11} color={c} />
                            </View>
                            <Text style={[s.sinceText, l.tone === 'gold' && { color: GOLD }]} numberOfLines={1}>{l.text}</Text>
                        </View>
                    );
                })}
            </Pressable>
        </View>
    );
}

/* ── What you're playing for ─────────────────────────────────────────── */

/** Where you stand on each prize, for the prizes sheet Home opens. */
export function seriesPrizeState(t: SeriesToday): PrizeState {
    return {
        day: t.day, logged: t.draw.logged, tickets: 0, ticketLog: [], rank: t.rank, total: t.total, blind: t.blind,
        golden: null, race: {}, cityPos: null, cityName: t.cityName, event: null,
        prizes: t.prizes, live: t.source === 'live', need: t.draw.need, drawDots: t.drawDots,
        roundName: t.roundName, prizesOn: t.prizesOn,
    };
}

/**
 * Under the rival card: the prize most people can win (the Draw) and the one
 * at the top, so the race on Home says what it's for. Opens the prizes sheet.
 * Nothing until the round has prizes.
 */
export function SeriesPrizeRow({ today, onOpen }: { today: SeriesToday; onOpen: () => void }) {
    const sc = useSeasonCard();
    const P = today.prizes;
    const draw = P.draw;
    const top = P.places[0];
    const main = draw ?? top;
    if (!main) return null;
    const inDraw = today.draw.logged >= today.draw.need;
    const kicker = draw
        ? `THE DRAW · ${draw.winners} ${draw.winners === 1 ? 'WINNER' : 'WINNERS'}${inDraw ? ' · YOU’RE IN' : ''}`
        : '1ST PLACE';
    const sub = draw && top ? `1st place wins ${top.name}` : draw ? `Drawn ${today.prizesOn}` : P.places.length > 1 ? '2nd and 3rd win too' : `Decided ${today.prizesOn}`;
    return (
        <Pressable
            onPress={() => { void Haptics.selectionAsync(); trackTap('series_home_prizes'); onOpen(); }}
            style={({ pressed }) => [kit.card, s.prize, sc, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`Playing for: ${main.name}. ${sub}. Opens the prizes.`}
        >
            {main.img
                ? <Image source={main.img} style={s.prizeImg} contentFit="cover" />
                : <View style={[s.prizeImg, s.thumbIcon]}><Ionicons name={draw ? 'ticket-outline' : 'trophy-outline'} size={20} color={GOLD} /></View>}
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text style={[s.kicker, inDraw && draw && { color: GREEN }]} numberOfLines={1}>{kicker}</Text>
                <Text style={s.prizeName} numberOfLines={1}>{main.name}</Text>
                <Text style={s.prizeSub} numberOfLines={1}>{sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={TEXT_3} />
        </Pressable>
    );
}

const s = StyleSheet.create({
    kicker: { fontSize: 9, fontWeight: '700', letterSpacing: 1.6, color: GOLD },

    coming: {
        marginBottom: 10, padding: 14, gap: 10,
        borderRadius: 18, borderWidth: 1, borderColor: 'rgba(232,210,0,0.35)', backgroundColor: CARD_BG,
    },
    comingHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    headLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    headLinkText: { fontSize: 12, fontWeight: '600', color: GOLD },
    comingMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    comingTitle: { fontSize: 20, fontWeight: '300', color: TEXT },
    comingSub: { marginTop: 3, fontSize: 12, fontWeight: '300', lineHeight: 16, color: TEXT_2 },
    clock: { alignItems: 'flex-end', minWidth: 70 },
    clockBig: { fontSize: 22, fontWeight: '200', color: TEXT, fontVariant: ['tabular-nums'] },
    clockSmall: { fontSize: 8, fontWeight: '700', letterSpacing: 1.4, color: TEXT_3 },
    comingPrize: {
        flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR,
    },
    thumb: { width: 26, height: 26, borderRadius: 7 },
    thumbIcon: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: CARD_BORDER },
    comingPrizeText: { flex: 1, fontSize: 12, fontWeight: '400', color: TEXT_2 },
    cta: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        height: 36, borderRadius: 18, backgroundColor: GOLD,
    },
    ctaText: { fontSize: 13, fontWeight: '600', color: '#0a0a0a' },

    since: {
        marginBottom: 10, paddingHorizontal: 14, paddingVertical: 12, gap: 8,
        borderRadius: 18, borderWidth: 1, borderColor: CARD_BORDER, backgroundColor: CARD_BG,
    },
    sinceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sinceBody: { gap: 8 },
    sinceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sinceIcon: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    sinceText: { flex: 1, fontSize: 13, fontWeight: '300', color: TEXT },

    prize: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
    prizeImg: { width: 52, height: 52, borderRadius: 12 },
    prizeName: { fontSize: 16, fontWeight: '400', color: TEXT },
    prizeSub: { fontSize: 12, fontWeight: '300', color: TEXT_3 },
});
