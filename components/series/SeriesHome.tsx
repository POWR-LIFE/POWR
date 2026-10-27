import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown, FadeOut, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Trans, useTranslation } from 'react-i18next';
import { router } from 'expo-router';

import { DropReveal } from '@/components/drop/DropReveal';
import { trackTap } from '@/lib/analytics';
import type { LiveEvent } from '@/lib/api/liveEvents';
import {
    challengeFriend, NAMED_PRIZES, pickSeriesCity, respondToDuel, seriesDate, type SeriesInviteBoard, useSeriesBoard, useSeriesExtras, useSeriesInviteBoard,
} from '@/lib/api/series';
import { fetchProfile, type Profile } from '@/lib/api/user';
import { dropSim, todayTarget, useDropPrototype } from '@/lib/dev/dropPrototype';
import {
    cityRanked, firstName, fmt, heatFromLine, type HeatInfo, type HeatMeta, type LensKey, ordinal, type RaceView, ROUND_MOMENTS, SERIES_PROTOTYPE, type SeriesState, STATE_INFO, youOf,
} from '@/lib/dev/seriesPrototype';
import { DROP_SERIES_POOL, dropProgress, formatSteps } from '@/lib/drop';
import { inviteCodeLine } from '@/lib/eventInviteLink';
import { scoringLine } from '@/lib/liveEventDisplay';
import { memberInitials, memberLabel } from '@/lib/memberName';
import { friendInviteLink } from '@/lib/social/friendCode';
import {
    CARD_BG,
    CARD_BORDER,
    EMBER,
    GOLD,
    GREEN,
    HAIR,
    ORANGE,
    MoreLine,
    ROW_LAYOUT,
    SectionLabel,
    RaceHeader,
    SeriesLane,
    TEXT,
    TEXT_2,
    TEXT_3,
} from './SeriesLane';
import { DuelResults, GoldenPMark, GoldenPSheet, TodayReadouts } from './SeriesDaily';
import { NAMED, PrizeDetailSheet, type PrizeKey, PrizesSheet, prizeSetFrom, SAMPLE_PRIZES, type PrizeState, WaysToWin, WinnersCard } from './SeriesPrizes';
import { liveMomentCards, MomentStrip, sampleMomentCards, SERIES_BAR_H, SeriesCard } from './SeriesRound';
import { hexA, LOCKUP_LINES, type LockupLine, SEASON_ORDER, SEASONS, seasonDev, useSeason, useSeasonCard } from './season';
import { RulesSheet, ShareSheet, Sheet, SheetHead, YourFile } from './SeriesSheets';
import { InviteBoardCard } from './SeriesInvite';
import { type JoinRound, joinRoundOf, JoinRoundScreen, openSeriesJoin, roundDays } from './SeriesJoin';
import { StartLine } from './StartLine';
import { CityClash, CityPicker, Duels, GameTabs, GymCrown, LockedGame } from './SeriesTabs';
import { fromLive, fromSim, type SeriesView } from './seriesView';
import { useAlerts } from './useAlerts';
import { useSeriesSim } from './useSeriesSim';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** The games, in tab order (their labels are translated in the component). */
/** Picking a city is hidden on the League for now (Jamie, 26 Oct): the start line's link and the City tab's picker. */
const SHOW_CITY_PICK = false;

const TABS: LensKey[] = ['overall', 'city', 'gym', 'friends'];
/** Between rounds only the games that run all year stay open. */
const ALL_YEAR: LensKey[] = ['gym', 'friends'];
const STATES: SeriesState[] = ['day3', 'doubleDown', 'eventNight', 'plague', 'blind', 'powerHour', 'allIn'];

type Sim = ReturnType<typeof useSeriesSim>;
type You = { name: string; initials: string; avatarUrl: string | null };
type Push = { key: number; title: string; body: string };
type PushKind = 'morning' | 'passed' | 'results' | 'moment' | 'golden';
/** The push each calendar moment sends (a scheduled broadcast, for real). */
const MOMENT_PUSH: Record<string, { title: string; body: string }> = {
    gun: { title: 'The Gun', body: 'The Series is live. Every verified session counts from now.' },
    doubleDown: { title: 'Double Down', body: 'Runs count 2× today, until midnight.' },
    eventNight: { title: 'Event night', body: 'It’s on at ONE LDN. Check in for ×2 Series points until midnight.' },
    plague: { title: 'The Plague', body: 'For two days, every friend who joins with your code counts for Patient Zero.' },
    blind: { title: 'Blind Mode', body: 'The board just went dark. Every rank is hidden for 48 hours.' },
    powerHour: { title: 'Power Hour in 15 minutes', body: 'Every session from 18:00 to 19:00 counts 2×.' },
    allIn: { title: 'All In', body: 'The board is back. Everyone can see exactly what they need.' },
};

/**
 * DEV ONLY (SERIES_PROTOTYPE). The League tab's home for the Autumn Series:
 * the focused screen from the approved mock (claude.ai artifact "Autumn Series
 * Board"). The tab wears the season (components/series/season): the Series card
 * with the season's lockup, what changed since yesterday, today's move and
 * numbers; then the games, the prizes, today's titles and the round's moments,
 * all on the page. Each tab is its own game: Overall is the race, My city is city
 * against city, My gym is the crown, Friends is duels. A game only opens where
 * enough people are in it. Between rounds the race rests and the all-year games
 * carry on. A live event is not a board here: it opens as the real event page.
 *
 * Fed by the live board (get_series_board) when the server has the Series, and
 * by the sample sim otherwise; the dev panel can switch back to the sample.
 */
export function SeriesHome({
    events,
    eventRank,
    onOpenEvent,
    onHeader,
    focus,
    focusAt,
    bottomInset,
    onUnavailable,
}: {
    events: LiveEvent[];
    eventRank?: number | null;
    onOpenEvent: (slug: string) => void;
    /** The line under the screen title: which Series, which day. */
    onHeader?: (sub: string) => void;
    /** 'rival' = arrived from Home's rival card: bring your next move into view. */
    focus?: string;
    focusAt?: string;
    bottomInset: number;
    /** A member build with no live board to show: the tab goes back to the League it had. */
    onUnavailable?: () => void;
}) {
    const { t } = useTranslation();
    const scrollRef = useAnimatedRef<Animated.ScrollView>();
    // The Series card stays pinned at the top and folds into a bar as the page scrolls.
    const scrollY = useSharedValue(0);
    const onScroll = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });
    const [cardH, setCardH] = useState(0);
    const { tint: seasonTint, def: seasonDef } = useSeason();
    const pinDeep = seasonTint?.deep ?? '#0d0d0d';
    const pinFade = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, scrollY.value / 24)) }));
    const [lit, setLit] = useState(false);
    useEffect(() => {
        if (focus !== 'rival') return undefined;
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        setLit(true);
        const tm = setTimeout(() => setLit(false), 1800);
        return () => clearTimeout(tm);
    }, [focus, focusAt, scrollRef]);
    const focused = useIsFocused();
    const live = useSeriesBoard(focused);
    const [sample, setSample] = useState(false);
    // Not on the board (20261027120000): you haven't joined, or you joined
    // between rounds. `offRound` is the round you'd race (the one on now, else
    // the next); before it starts, its start line; while it runs, the screen
    // that asks you to join. JOIN puts you in `toJoin`.
    const lb = sample ? null : live.board;
    const toJoin = joinRoundOf(lb);
    const offRound: JoinRound | null = lb && !lb.me && lb.join && (toJoin || lb.state !== 'running')
        ? toJoin ?? { slug: lb.join.slug, name: lb.join.name, startsAt: Date.parse(lb.join.starts_at), endsAt: Date.parse(lb.join.ends_at), need: lb.join.draw_days }
        : null;
    const offBefore = !!offRound && offRound.startsAt > Date.now();
    // The sample sim only ticks while it's what's on screen, or its sessions
    // would toast over the live board.
    const showLive = !sample && (!!live.board?.me || !!offRound);
    const sim = useSeriesSim(focused && !showLive);
    // Before a round: the invite race (live once the invite period opens; the sample's otherwise).
    const inviteLive = useSeriesInviteBoard(focused && !sample && (live.board?.state === 'upcoming' || offBefore));
    const alerts = useAlerts();
    const [forceAlerts, setForceAlerts] = useState(false);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [sheet, setSheet] = useState<'rules' | 'share' | 'file' | 'golden' | 'prizes' | 'prize' | 'race' | 'dev' | 'city' | null>(null);
    // Dev: fire the gun in a few seconds, to see the start line break.
    const [gunAt, setGunAt] = useState<number | null>(null);
    // Dev: run the start line's crowd ahead, to watch it fill.
    const [crowdShift, setCrowdShift] = useState(0);
    const [prizeFocus, setPrizeFocus] = useState<PrizeKey | null>(null);
    // Every prize at once (from the rules), or one prize on its own (from Ways to win).
    const openPrizes = (k: PrizeKey) => { setPrizeFocus(k); setSheet('prizes'); };
    const openPrize = (k: PrizeKey) => { setPrizeFocus(k); setSheet('prize'); };
    const roundY = useRef(0);
    const todayCard = useSeasonCard();
    const [revealing, setRevealing] = useState(false);
    const drop = useDropPrototype();
    const [push, setPush] = useState<Push | null>(null);
    useEffect(() => { fetchProfile().then(setProfile).catch(() => undefined); }, []);
    useEffect(() => {
        if (!push) return undefined;
        const tm = setTimeout(() => setPush(null), 5000);
        return () => clearTimeout(tm);
    }, [push]);
    const you: You = {
        name: memberLabel(profile?.display_name, profile?.username),
        initials: memberInitials(profile?.display_name, profile?.username),
        avatarUrl: profile?.avatar_url ?? null,
    };
    const youLabel = `${you.name}${t('events:board.youSuffix')}`;

    const liveBase = live.board ? fromLive(live.board, seasonDef.name) : null;
    // The round's prizes and moments from /admin/series, and its winners once announced.
    const extras = useSeriesExtras(!sample && liveBase ? liveBase.round.slug : null, !sample && liveBase?.phase === 'between');
    const liveCards = useMemo(() => liveMomentCards(extras.moments), [extras.moments]);
    // Blind Mode on: the same board, ranks hidden.
    const blindCard = liveCards.find((m) => m.kind === 'blind' && m.state === 'live');
    const blindNow = !!blindCard;
    const liveView = live.board ? (blindNow ? fromLive(live.board, seasonDef.name, true) : liveBase) : null;
    // Sample data is for design work: only dev builds ever fall back to it.
    const v: SeriesView = (!sample && liveView) || fromSim(sim, seasonDef.name);
    const unavailable = !SERIES_PROTOTYPE && !liveView && !offRound;
    useEffect(() => { if (unavailable && live.loaded) onUnavailable?.(); }, [unavailable, live.loaded, onUnavailable]);
    const momentCards = v.live ? liveCards : sampleMomentCards(v.hero.day);
    const inviteBoard: SeriesInviteBoard | null = v.live || offRound ? (inviteLive?.open ? inviteLive : null) : sim.inviteBoard;
    const prizeSet = useMemo(() => (v.live ? prizeSetFrom(extras.prizes) : SAMPLE_PRIZES), [v.live, extras.prizes]);
    const running = v.phase === 'running';
    // Before the first round: every game shows, and Overall says what's coming.
    const upcoming = v.phase === 'upcoming';
    // Never the sample's header in release: "Day 3 of 15" while the board loads.
    const header = offRound && lb
        ? (offBefore
            ? t('series:view.headerNext', { name: seasonDef.name, round: offRound.name, date: seriesDate(new Date(offRound.startsAt).toISOString()) })
            : t('series:view.headerDay', { name: seasonDef.name, ...roundDays(offRound) }))
        : v.header;
    useEffect(() => { onHeader?.(unavailable ? '' : header); }, [onHeader, header, unavailable]);

    // Today's Drop: Home's Drop, the app's one daily reveal. Here it's a row and
    // opens with the same hold; during a round it can hold Series prizes.
    const target = todayTarget(drop);
    const dropPct = dropProgress(target, drop.steps, drop.minutes);
    const dropPhase: 'sealed' | 'ready' | 'opened' = drop.opened ? 'opened' : dropPct >= 1 ? 'ready' : 'sealed';
    const openDrop = () => { trackTap('series_drop_open'); dropSim.prepare(running ? DROP_SERIES_POOL : undefined); setRevealing(true); };

    // Every game keeps its tab, locked until enough people are in it, so the
    // ones still opening are on show. Between rounds only the all-year ones.
    const tabLabel: Record<LensKey, string> = {
        overall: t('series:league.tabs.overall'),
        city: t('series:league.tabs.city'),
        gym: t('series:league.tabs.gym'),
        friends: t('series:league.tabs.friends'),
    };
    const tabs = TABS.filter((k) => running || upcoming || ALL_YEAR.includes(k)).map((k) => ({ key: k, label: tabLabel[k], locked: !v.open[k] }));
    const tabShown = tabs.some((x) => x.key === sim.tab);
    const onOverall = running && (tabShown ? sim.tab : tabs[0]?.key) === 'overall';
    const setTab = sim.setTab;
    useEffect(() => {
        if (!tabShown) setTab(running || upcoming ? 'overall' : 'friends');
    }, [running, upcoming, setTab, tabShown]);

    const ev = events[0];
    // On event night the event is the news, so its card moves up under your rank.
    const evTop = !!ev && (v.eventNight || (ev.is_locked && !ev.revealed_at));
    const eventCard = ev
        ? <EventCard event={ev} rank={eventRank ?? null} onPress={() => { trackTap('series_event_open', { slug: ev.slug }); onOpenEvent(ev.slug); }} />
        : null;

    const cityPos = v.open.city ? cityRanked(v.tabs).findIndex((r) => r.you) : -1;
    const prizeState: PrizeState = {
        day: v.hero.day,
        logged: v.hero.logged,
        tickets: v.loop?.tickets ?? 0,
        ticketLog: v.loop?.ticketLog ?? [],
        rank: v.hero.rank,
        total: v.hero.total,
        blind: v.hero.blind,
        golden: v.loop ? { state: v.loop.golden.state, minutes: v.loop.golden.minutes, need: v.loop.golden.need, done: v.loop.golden.done } : null,
        race: v.live ? extras.race : sim.race,
        cityPos: cityPos >= 0 ? cityPos : null,
        cityName: v.city?.name ?? null,
        notYet: upcoming,
        event: ev ? { name: ev.name, rank: eventRank ?? null, over: ev.status === 'revealed' || ev.status === 'settled' } : null,
        prizes: prizeSet,
        live: v.live,
        need: v.hero.need,
        drawDots: v.hero.days,
        roundName: v.round.name,
        prizesOn: v.round.prizesOn,
    };

    const shared = () => {
        setSheet(null);
        if (!v.live) { sim.showToast('OPENS THE PHONE’S SHARE SHEET'); return; }
        Share.share({ message: `${seasonDef.name} · ${v.round.name}\n${share.big} ${share.line}\nhttps://powr.life` }).catch(() => {});
    };
    // The race is showing your heat (sample only: the server has no heats yet).
    const inHeat = v.view === 'heat' && !!v.heat;
    // What gets shared never leads with a place on the big board (pacers fill
    // it): your place in your heat, else the places you climbed, else your points.
    const myPts = youOf(v.board).p.pts;
    const dayLine = t('series:league.share.day', { day: v.hero.day, days: v.round.days });
    // The heat headline is sample-only (the live board has no heats yet).
    const share = v.hero.blind
        ? { big: fmt(myPts), line: t('series:league.share.points', { dayLine }) }
        : v.headline === 'heat' && v.heat
            ? { big: ordinal(v.heat.rank).toUpperCase(), line: `IN MY HEAT · DIVISION ${v.heat.meta.div}${v.heat.move > 0 ? ` · ▲${v.heat.move} TODAY` : ''}` }
            : v.hero.move > 0
                ? { big: `▲${v.hero.move}`, line: t('series:league.share.climbed', { count: v.hero.move, points: fmt(myPts), dayLine }) }
                : { big: fmt(myPts), line: t('series:league.share.points', { dayLine }) };
    const showAlerts = forceAlerts || alerts.needed;

    // What the Series pushes say, previewed in-app. One morning push carries the
    // sealed boost and the rival; the rest are moments, each capped once a day.
    const previewPush = (kind: PushKind) => {
        const r = v.rival;
        if (!r && kind === 'passed') { sim.showToast('NO RIVAL YET · NOBODY ABOVE YOU'); return; }
        const who = firstName(r?.p.name ?? '');
        const gapLine = r ? (r.ahead ? `${who} is ${fmt(r.gap)} pts behind you.` : `${who} is ${fmt(r.gap)} pts ahead.`) : '';
        const copy: Record<PushKind, { title: string; body: string }> = {
            morning: { title: 'Today’s Drop is set', body: `${formatSteps(target.steps)} steps or ${target.minutes} active min opens it. ${gapLine}`.trim() },
            passed: { title: `${who} just passed you`, body: `You’re #${fmt(r?.meRank ?? 0)} in the ${seasonDef.name}, ${fmt(r?.gap ?? 0)} pts behind. ${r?.how}.` },
            results: { title: 'Your duels are in', body: '2 won, 1 lost. Rematch Amara before the week starts.' },
            moment: MOMENT_PUSH[(ROUND_MOMENTS.find((m) => v.hero.day >= m.day && v.hero.day < m.day + (m.days ?? 1))
                ?? ROUND_MOMENTS.find((m) => m.day > v.hero.day) ?? ROUND_MOMENTS[0]).key],
            golden: { title: 'The Golden P is live', body: 'Somewhere inside POWR. The first 10 to find it get tonight’s challenge.' },
        };
        setPush({ key: Date.now(), ...copy[kind] });
    };

    // A friend brought in counts for your city, opens your gym's crown and is
    // someone to duel. The same smart-link as My QR: the code survives a store install.
    const invite = async () => {
        trackTap('series_invite', { tab: sim.tab });
        const code = profile?.referral_code;
        if (!code) { sim.showToast(t('series:league.toast.codeLoading')); return; }
        const link = friendInviteLink(code);
        try {
            await Share.share({ message: `${t('events:invite.joinMe', { codeLine: inviteCodeLine(code) })}\n${link}`, url: link });
        } catch {
            // dismissed
        }
    };
    const onLockAction = (a: 'invite' | 'pickGym') => {
        if (a === 'invite') { void invite(); return; }
        trackTap('series_set_gym');
        router.push('/(tabs)/discover');
    };
    const pickCity = async (city: string) => {
        trackTap('series_city_pick');
        try {
            const got = await pickSeriesCity(city);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            sim.showToast(t('series:league.toast.cityPicked', { city: got.toUpperCase() }));
            await live.refresh();
        } catch {
            sim.showToast(t('series:league.toast.cityFailed'));
        }
    };

    // Duels: live ones go to the server; the sample ones stay in the sim.
    const acceptDuel = () => {
        trackTap('series_duel_accept');
        const iv = v.tabs.duel.invite;
        if (!v.live || !iv) { sim.acceptDuel(); return; }
        respondToDuel(iv.id, true)
            .then(() => { sim.showToast(t('series:league.toast.duelOn', { name: iv.name.toUpperCase() })); return live.refresh(); })
            .catch(() => sim.showToast(t('series:league.toast.acceptFailed')));
    };
    const challenge = (id: string) => {
        trackTap('series_duel_challenge');
        if (!v.live) { sim.challenge(id); return; }
        const name = v.tabs.duel.open.find((o) => o.id === id)?.name ?? '';
        challengeFriend(id)
            .then(() => { void Haptics.selectionAsync(); sim.showToast(t('series:league.toast.challengeSent', { name: firstName(name).toUpperCase() })); return live.refresh(); })
            .catch(() => sim.showToast(t('series:league.toast.sendFailed')));
    };

    const alertsCardEl = showAlerts
        ? <AlertsCard onEnable={() => { trackTap('series_alerts_enable'); setForceAlerts(false); void alerts.enable(); }} />
        : null;
    const tabBody = (
        <>
            {tabs.length > 0 && (
                <GameTabs
                    items={tabs}
                    value={tabShown ? sim.tab : tabs[0].key}
                    dots={v.live ? {} : sim.pings}
                    onChange={(k) => { trackTap('series_tab', { tab: k }); sim.setTab(k); }}
                />
            )}
            {sim.tab === 'overall' && running && (
                <>
                    {!v.live && (
                        <ViewSwitch
                            value={v.view}
                            heat={!!v.heat}
                            onChange={(x) => { trackTap('series_view', { view: x }); sim.setView(x); }}
                            accessory={v.loop?.golden.state === 'showing'
                                ? <GoldenPMark onFind={() => { trackTap('series_golden_found'); sim.findGoldenP(); setSheet('golden'); }} />
                                : null}
                        />
                    )}
                    {inHeat && v.heat ? (
                        <HeatRow
                            h={v.heat}
                            blind={v.hero.blind}
                            lit={lit}
                            onRules={() => { trackTap('series_rules_open', { from: 'heat' }); setSheet('rules'); }}
                        />
                    ) : (
                        <RivalRow
                            v={v}
                            lit={lit}
                            onRules={() => { trackTap('series_rules_open'); setSheet('rules'); }}
                            blindBack={blindCard?.back
                                ? (/^\d/.test(blindCard.back)
                                    ? t('series:league.rival.backAt', { time: blindCard.back })
                                    : t('series:league.rival.backOn', { day: blindCard.back }))
                                : undefined}
                        />
                    )}
                    <Race v={v} hits={v.live ? {} : sim.hits} you={you} heat={inHeat ? v.heat : null} />
                    {!v.live && (inHeat ? (
                        <Pressable
                            onPress={() => { trackTap('series_heat_full', { full: !v.heat?.full }); sim.setHeatFull(!v.heat?.full); }}
                            style={({ pressed }) => [s.linkRow, pressed && { opacity: 0.6 }]}
                            accessibilityRole="button"
                        >
                            <Text style={s.linkText}>{v.heat?.full ? 'Show less' : 'View your whole heat'}</Text>
                            <Ionicons name={v.heat?.full ? 'arrow-up' : 'arrow-down'} size={15} color={TEXT} />
                        </Pressable>
                    ) : (
                        <Pressable
                            onPress={() => { trackTap('series_view', { view: v.view === 'around' ? 'top' : 'around' }); sim.setView(v.view === 'around' ? 'top' : 'around'); }}
                            style={({ pressed }) => [s.linkRow, pressed && { opacity: 0.6 }]}
                            accessibilityRole="button"
                        >
                            <Text style={s.linkText}>{v.view === 'around' ? 'View full rankings' : 'Back to around me'}</Text>
                            <Ionicons name={v.view === 'around' ? 'arrow-forward' : 'arrow-up'} size={15} color={TEXT} />
                        </Pressable>
                    ))}
                    {inHeat && v.heat && <Text style={s.roundNote}>{heatCaption(v.heat.meta)}</Text>}
                </>
            )}
            {sim.tab === 'city' && running && (
                <>
                    {SHOW_CITY_PICK && v.cityPick && <CityPicker options={v.cityPick} onPick={pickCity} />}
                    {v.open.city
                        ? <CityClash tabs={v.tabs} city={v.city} forming={v.cityForming} />
                        : v.locks.city && <LockedGame title={t('series:tabs.city.title')} lock={v.locks.city} onAction={onLockAction} />}
                </>
            )}
            {sim.tab === 'gym' && tabShown && (v.open.gym
                ? <GymCrown tabs={v.tabs} youLabel={youLabel} sessionPts={v.gymSessionPts} />
                : v.locks.gym && <LockedGame title={t('series:tabs.crown.title')} lock={v.locks.gym} onAction={onLockAction} />)}
            {sim.tab === 'friends' && v.loop?.results && (
                <DuelResults results={v.loop.results} rematched={v.loop.rematched} onRematch={(id) => { trackTap('series_rematch'); sim.rematch(id); }} />
            )}
            {sim.tab === 'friends' && <Duels tabs={v.tabs} onAccept={acceptDuel} onChallenge={challenge} onInvite={() => { void invite(); }} />}
        </>
    );
    const alertsCard = alertsCardEl;
    const rulesRow = (
        <View style={s.links}>
            <Pressable
                style={({ pressed }) => [s.linkRow, pressed && { opacity: 0.6 }]}
                onPress={() => { trackTap('series_rules_open'); setSheet('rules'); }}
                accessibilityRole="button"
            >
                <Text style={s.linkText}>{t('series:league.links.howItWorks')}</Text>
                <Ionicons name="arrow-forward" size={15} color={TEXT} />
            </Pressable>
        </View>
    );

    if (unavailable) return <View style={{ flex: 1 }} />;

    // A round on that you're not in: one screen that asks you to join.
    if (lb && offRound && toJoin && !offBefore) {
        return (
            <View style={{ flex: 1, paddingBottom: bottomInset }}>
                <JoinRoundScreen
                    board={lb}
                    round={toJoin}
                    onJoin={() => openSeriesJoin(toJoin, 'league')}
                    dev={SERIES_PROTOTYPE ? (
                        <Pressable onPress={() => setSample(true)} style={s.devChip} accessibilityRole="button" accessibilityLabel="Series sample data">
                            <Text style={s.devChipText}>SAMPLE DATA</Text>
                        </Pressable>
                    ) : undefined}
                />
            </View>
        );
    }

    // Before a round: The Start Line, one screen with no scrolling (the
    // countdown, the crowd at the line, your three numbers, one button).
    // Not joined yet, it's the start line of the round you'd join, and the
    // button is JOIN.
    if (upcoming || offBefore) {
        const pre = offBefore ? offRound : null;
        const startsAt = gunAt ?? (pre ? pre.startsAt : Date.parse(inviteBoard?.round.starts_at ?? live.board?.round.starts_at ?? '')) ?? Date.now();
        return (
            <View style={{ flex: 1, paddingBottom: bottomInset }}>
                <StartLine
                    startsAt={Number.isFinite(startsAt) ? startsAt : Date.now()}
                    roundName={pre ? pre.name : v.round.name}
                    invite={inviteBoard}
                    days={pre ? roundDays(pre).days : v.round.days}
                    need={pre ? pre.need : v.hero.need}
                    shift={crowdShift}
                    onJoin={toJoin ? () => openSeriesJoin(toJoin, 'league') : undefined}
                    onInvite={() => { void invite(); }}
                    onRace={() => { trackTap('series_invite_race_open'); setSheet('race'); }}
                    onCity={SHOW_CITY_PICK && !pre && v.cityPick ? () => setSheet('city') : undefined}
                    onStarted={() => {
                        setGunAt(null);
                        if (v.live || pre) void live.refresh(); else sim.setInRound(true);
                    }}
                    dev={SERIES_PROTOTYPE ? (
                        <Pressable onPress={() => setSheet('dev')} style={s.devChip} accessibilityRole="button" accessibilityLabel="Series dev controls">
                            <Text style={s.devChipText}>DEV</Text>
                        </Pressable>
                    ) : undefined}
                />
                {sim.toast && (
                    <Animated.View key={sim.toast.key} entering={FadeInDown.duration(300)} exiting={FadeOut.duration(250)} style={[s.toast, { bottom: bottomInset + 14 }]}>
                        <View style={s.toastDot} />
                        <Text style={s.toastText} numberOfLines={1}>{sim.toast.text}</Text>
                    </Animated.View>
                )}
                <Sheet visible={sheet === 'race'} onClose={() => setSheet(null)}>
                    <SheetHead light={t('series:league.inviteRace.light')} bold={t('series:league.inviteRace.bold')} onClose={() => setSheet(null)} />
                    {inviteBoard && <View style={{ marginHorizontal: -16 }}><InviteBoardCard board={inviteBoard} you={youLabel} onInvite={() => { void invite(); }} /></View>}
                    <Text style={[s.roundNote, { marginTop: 12 }]}>
                        {t('series:league.inviteRace.note')}
                    </Text>
                </Sheet>
                <Sheet visible={sheet === 'city'} onClose={() => setSheet(null)}>
                    <SheetHead light={t('series:league.citySheet.light')} bold={t('series:league.citySheet.bold')} onClose={() => setSheet(null)} />
                    {v.cityPick && (
                        <View style={{ marginHorizontal: -16 }}>
                            <CityPicker options={v.cityPick} onPick={async (c) => { await pickCity(c); setSheet(null); }} />
                        </View>
                    )}
                </Sheet>
                <Sheet visible={sheet === 'dev'} onClose={() => setSheet(null)}>
                    <SheetHead light="Start line " bold="dev" onClose={() => setSheet(null)} />
                    <View style={[s.devRow, { marginTop: 12 }]}>
                        {[
                            ['A FRIEND JOINS', sim.friendJoins],
                            ['THEY WORK OUT', sim.friendWorksOut],
                            ['+1 DAY (CROWD FILLS)', () => { setSheet(null); setCrowdShift((x) => x + 86_400_000); }],
                            ['THE GUN (IN 4 S)', () => { setSheet(null); setGunAt(Date.now() + 4000); }],
                            ['ROUND ON', () => { setSheet(null); sim.setInRound(true); }],
                            ['BETWEEN ROUNDS', () => { setSheet(null); sim.setOffPhase('ended'); }],
                            ...(liveView || offRound || sample ? [[sample ? 'LIVE DATA' : 'SAMPLE DATA', () => setSample(!sample)] as [string, () => void]] : []),
                        ].map(([label, run]) => (
                            <Pressable key={label as string} onPress={run as () => void} style={s.devChip}>
                                <Text style={s.devChipText}>{label as string}</Text>
                            </Pressable>
                        ))}
                    </View>
                </Sheet>
            </View>
        );
    }

    return (
        <View style={{ flex: 1 }}>
            <Animated.ScrollView
                ref={scrollRef}
                onScroll={onScroll}
                scrollEventThrottle={16}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingTop: (cardH || 290) + 16, paddingBottom: bottomInset + 28, gap: 10 }}
                showsVerticalScrollIndicator={false}
            >
                {running ? (
                    <>
                        {evTop && eventCard}
                        {tabBody}
                        {onOverall && (
                            <>
                        <View style={[s.today, todayCard]}>
                            <View style={s.todayHead}>
                                <View style={{ flex: 1, gap: 4 }}>
                                    <Text style={s.todayTitle}>
                                        <Trans
                                            i18nKey="series:league.today.title"
                                            values={{ points: fmt(v.hero.today) }}
                                            components={{ green: <Text style={{ color: GREEN }} /> }}
                                        />
                                    </Text>
                                    <Pressable
                                        onPress={() => { trackTap('series_activity_open'); router.push('/(tabs)/progress'); }}
                                        hitSlop={8}
                                        style={({ pressed }) => [s.inlineLink, pressed && { opacity: 0.6 }]}
                                        accessibilityRole="button"
                                    >
                                        <Text style={s.inlineLinkText}>{t('series:league.today.viewActivity')}</Text>
                                        <Ionicons name="arrow-forward" size={13} color={TEXT} />
                                    </Pressable>
                                </View>
                                {!v.live && (
                                    <View style={s.synced}>
                                        <Ionicons name="checkmark-circle-outline" size={16} color={GREEN} />
                                        <Text style={s.syncedText}>Synced 2 min ago</Text>
                                    </View>
                                )}
                            </View>
                            {/* The Drop and tickets are sample-only: live, it's The Draw and the day. */}
                            <TodayReadouts
                                drop={v.live ? null : { phase: dropPhase, progress: dropPct, reward: drop.reward, doubleLeft: sim.dropDoubleLeft }}
                                logged={v.hero.logged}
                                need={v.hero.need}
                                tickets={v.live ? null : v.loop?.tickets ?? 0}
                                golden={v.loop?.golden.state === 'accepted' ? v.loop.golden : null}
                                onOpenDrop={openDrop}
                                onDraw={() => { trackTap('series_draw_open'); openPrize('draw'); }}
                                drawnOn={v.round.prizesDay}
                                round={{ day: v.hero.day, days: v.round.days }}
                            />
                        </View>
                        <SectionLabel text={t('series:league.waysToWin')} right={t('series:league.prizesLand', { date: v.round.prizesDay })} />
                        <WaysToWin state={prizeState} onOpen={openPrize} />
                        {/* The round's moments, as set in /admin/series (the sample has its own). */}
                        {momentCards.length > 0 && (
                            <>
                                <View onLayout={(e) => { roundY.current = e.nativeEvent.layout.y; }}>
                                    <SectionLabel text={t('series:league.round.title')} right={t('series:league.round.right', { name: v.round.name, count: v.round.days })} />
                                </View>
                                <MomentStrip cards={momentCards} />
                                <Text style={s.roundNote}>
                                    {!v.live || momentCards.some((m) => m.secret) ? t('series:league.round.noteSecret') : t('series:league.round.note')}
                                </Text>
                            </>
                        )}
                        {!evTop && eventCard && <View style={{ marginTop: 6 }}>{eventCard}</View>}
                        {alertsCard}
                            </>
                        )}
                        <View style={s.links}>
                            <Pressable
                                style={({ pressed }) => [s.linkRow, pressed && { opacity: 0.6 }]}
                                onPress={() => { void Haptics.selectionAsync(); trackTap('series_share_open'); setSheet('share'); }}
                                accessibilityRole="button"
                            >
                                <Text style={s.linkText}>{t('series:league.links.share')}</Text>
                                <Ionicons name="arrow-up" size={15} color={TEXT} style={{ transform: [{ rotate: '45deg' }] }} />
                            </Pressable>
                            <View style={[s.linkRule, todayCard && { backgroundColor: todayCard.borderColor }]} />
                            <Pressable
                                style={({ pressed }) => [s.linkRow, pressed && { opacity: 0.6 }]}
                                onPress={() => { trackTap('series_rules_open'); setSheet('rules'); }}
                                accessibilityRole="button"
                            >
                                <Text style={s.linkText}>{t('series:league.links.rules')}</Text>
                                <Ionicons name="arrow-forward" size={15} color={TEXT} />
                            </Pressable>
                        </View>
                    </>
                ) : (
                    <>
                        {v.live && extras.results && <WinnersCard results={extras.results} />}
                        {v.finish && !v.live && (
                            <Pressable
                                onPress={() => setSheet('file')}
                                style={({ pressed }) => [s.today, todayCard, s.fileRow, pressed && { opacity: 0.7 }]}
                                accessibilityRole="button"
                            >
                                <Ionicons name="document-text-outline" size={14} color={GOLD} />
                                <Text style={s.fileLabel}>YOUR FILE · ROUND 01</Text>
                                <Text style={s.fileLink}>Open</Text>
                                <Ionicons name="chevron-forward" size={14} color={GOLD} />
                            </Pressable>
                        )}
                        {alertsCard}
                        {tabBody}
                        {rulesRow}
                    </>
                )}
                {SERIES_PROTOTYPE && <DevPanel
                    sim={sim}
                    onSlip={() => { sim.slip(); setTimeout(() => previewPush('passed'), 700); }}
                    hasLive={!!liveView}
                    showingLive={v.live}
                    onSample={setSample}
                    onFile={() => setSheet('file')}
                    onPush={previewPush}
                    alertsShown={showAlerts}
                    onToggleAlerts={() => setForceAlerts((x) => !x)}
                />}
            </Animated.ScrollView>

            {/* Pinned: the Series card, over a strip of the season's colour once the page moves. */}
            <View style={s.pin} pointerEvents="box-none">
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, pinFade]}>
                    <LinearGradient colors={[pinDeep, pinDeep, hexA(pinDeep, 0)]} locations={[0, 0.8, 1]} style={StyleSheet.absoluteFill} />
                </Animated.View>
                <SeriesCard
                    v={v}
                    moments={v.live ? liveCards : undefined}
                    scrollY={scrollY}
                    onHeight={setCardH}
                    onMoment={() => {
                        // A round with no moments: the foot is The Draw.
                        if (momentCards.length === 0) { trackTap('series_draw_open'); openPrize('draw'); return; }
                        trackTap('series_round_jump');
                        const go = () => scrollRef.current?.scrollTo({ y: Math.max(0, roundY.current - (SERIES_BAR_H + 44)), animated: true });
                        if (onOverall) go(); else { sim.setTab('overall'); setTimeout(go, 250); }
                    }}
                />
            </View>

            {sim.toast && (
                <Animated.View
                    key={sim.toast.key}
                    entering={FadeInDown.duration(300)}
                    exiting={FadeOut.duration(250)}
                    style={[s.toast, { bottom: bottomInset + 14 }]}
                >
                    <View style={[s.toastDot, sim.toast.tone === 'ember' && { backgroundColor: EMBER }]} />
                    <Text style={s.toastText} numberOfLines={1}>{sim.toast.text}</Text>
                </Animated.View>
            )}
            {push && <PushPreview push={push} onPress={() => setPush(null)} />}

            <RulesSheet
                visible={sheet === 'rules'}
                onClose={() => setSheet(null)}
                live={v.live}
                days={v.round.days}
                need={v.hero.need}
                when={v.round.prizesDay}
                boosts={extras.moments.some((m) => (m.multiplier ?? 1) > 1)}
                blindMode={extras.moments.some((m) => m.kind === 'blind')}
                mostWanted={!v.live || prizeSet.named.most_wanted != null}
                heat={v.heat?.meta ?? null}
                onPrizes={running ? () => { setSheet(null); setTimeout(() => openPrizes('top3'), 350); } : undefined}
            />
            <ShareSheet
                visible={sheet === 'share'}
                onClose={() => setSheet(null)}
                big={share.big}
                line={share.line}
                onShare={shared}
            />
            <YourFile
                visible={sheet === 'file'}
                onClose={() => setSheet(null)}
                scale={sim.scale}
                onShare={shared}
                prizes={NAMED_PRIZES.map((k) => ({ key: k, label: NAMED[k].title, icon: NAMED[k].icon, won: k === 'hot_streak' }))}
            />
            <GoldenPSheet
                visible={sheet === 'golden'}
                finder={sim.golden.finder}
                of={sim.golden.of}
                need={sim.golden.need}
                onAccept={() => { trackTap('series_golden_accept'); setSheet(null); sim.acceptGolden(); }}
                onClose={() => setSheet(null)}
            />
            <PrizesSheet visible={sheet === 'prizes'} focus={prizeFocus} state={prizeState} onClose={() => setSheet(null)} />
            <PrizeDetailSheet
                visible={sheet === 'prize'}
                prize={prizeFocus}
                state={prizeState}
                onClose={() => setSheet(null)}
                onOpenEvent={ev ? () => { setSheet(null); setTimeout(() => onOpenEvent(ev.slug), 300); } : undefined}
            />
            <DropReveal
                visible={revealing}
                kicker="TODAY’S DROP"
                subtitle="Opened by moving"
                reward={drop.reward}
                onOpened={dropSim.markOpened}
                onClose={() => setRevealing(false)}
            />
        </View>
    );
}

/** Push is how a race reaches you when the app is shut, so ask while it's obviously useful. */
function AlertsCard({ onEnable }: { onEnable: () => void }) {
    const { t } = useTranslation();
    const sc = useSeasonCard(true);
    return (
        <View style={[s.alerts, sc]}>
            <View style={s.nextIcon}><Ionicons name="notifications-outline" size={17} color={GOLD} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.alertsTitle}>{t('series:league.alerts.title')}</Text>
                <Text style={s.nextSmall}>{t('series:league.alerts.line')}</Text>
            </View>
            <Pressable
                onPress={() => { void Haptics.selectionAsync(); onEnable(); }}
                style={({ pressed }) => [s.alertsBtn, pressed && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityLabel={t('series:league.alerts.a11y')}
            >
                <Text style={s.alertsBtnText}>{t('series:league.alerts.cta')}</Text>
            </Pressable>
        </View>
    );
}

/** In-app preview of a Series push, drawn like the system banner. */
function PushPreview({ push, onPress }: { push: Push; onPress: () => void }) {
    return (
        <Animated.View key={push.key} entering={FadeInDown.duration(350)} exiting={FadeOut.duration(250)} style={s.push}>
            <Pressable onPress={onPress} style={s.pushInner} accessibilityRole="button" accessibilityLabel={`${push.title}. ${push.body}`}>
                <Image source={require('@/assets/images/powr_p_hollow.png')} style={s.pushIcon} contentFit="contain" />
                <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={s.pushHead}>
                        <Text style={s.pushApp}>POWR</Text>
                        <Text style={s.pushNow}>now</Text>
                    </View>
                    <Text style={s.pushTitle} numberOfLines={1}>{push.title}</Text>
                    <Text style={s.pushBody} numberOfLines={2}>{push.body}</Text>
                </View>
            </Pressable>
        </Animated.View>
    );
}

/** Your heat, around me (the five either side of you on the big board) or its top. */
function ViewSwitch({ value, heat, onChange, accessory }: { value: RaceView; heat: boolean; onChange: (v: RaceView) => void; accessory?: React.ReactNode }) {
    const sc = useSeasonCard();
    const opt = (k: RaceView, label: string) => {
        const on = value === k;
        return (
            <Pressable
                key={k}
                onPress={() => { if (!on) { void Haptics.selectionAsync(); onChange(k); } }}
                style={[s.segBtn, on && s.segOn, on && sc && { backgroundColor: sc.borderColor }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
            >
                <Text style={[s.segText, on && { color: TEXT }]}>{label}</Text>
            </Pressable>
        );
    };
    return (
        <View style={s.segRow}>
            <View style={[s.seg, sc && { borderColor: sc.borderColor }]}>
                {heat && opt('heat', 'My heat')}
                {opt('around', 'Around me')}
                {opt('top', 'Top 100')}
            </View>
            {accessory}
        </View>
    );
}

/** Your heat in one line under the race: who's in it and what the lines mean. */
function heatCaption(m: HeatMeta): string {
    const lines = [
        m.div > 1 ? `the top ${m.up} move up` : null,
        m.down > 0 ? `the bottom ${m.down} drop` : null,
    ].filter(Boolean).join(', ');
    return `Division ${m.div} of ${m.divs}. ${m.size} people at your pace, set for the round.${lines ? ` At the end, ${lines}.` : ''}`;
}

/** Your heat's next line, said as something to do; how heats work a tap away. */
function HeatRow({ h, blind, lit, onRules }: { h: HeatInfo; blind: boolean; lit: boolean; onRules: () => void }) {
    const m = h.meta;
    const walks = h.walks === 1 ? 'a 30-min walk' : `about ${h.walks} walks`;
    const line: { icon: IconName; head: string; tail: string; tone: string } = blind
        ? { icon: 'eye-off-outline', head: 'Ranks are hidden', tail: 'Points still count', tone: TEXT }
        : h.status === 'up'
            ? { icon: 'arrow-up-circle-outline', head: 'In the move-up places', tail: `${fmt(h.clear ?? 0)} pts clear of ${ordinal(m.up + 1)}`, tone: GREEN }
            : h.status === 'drop'
                ? { icon: 'alert-circle-outline', head: `${fmt(h.toSafe ?? 0)} pts out of the drop zone`, tail: `Suggested: ${walks}`, tone: ORANGE }
                : m.div === 1
                    ? { icon: 'trending-up-outline', head: h.toUp == null ? 'Top of your heat' : `${fmt(h.toUp)} pts to 1st`, tail: h.toUp == null ? 'Division 1 is the top' : `Suggested: ${walks}`, tone: TEXT }
                    : { icon: 'trending-up-outline', head: `${fmt(h.toUp ?? 0)} pts to the top ${m.up}`, tail: `Suggested: ${walks}`, tone: TEXT };
    return (
        <View style={[s.rival, lit && { backgroundColor: 'rgba(232,210,0,0.06)', borderColor: 'rgba(232,210,0,0.4)' }]}>
            <View style={[s.rivalIcon, line.tone !== TEXT && { borderColor: line.tone }]}>
                <Ionicons name={line.icon} size={18} color={line.tone} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rivalHead} numberOfLines={1}>{line.head}</Text>
                <Text style={s.rivalTail} numberOfLines={1}>{line.tail}</Text>
            </View>
            <Pressable onPress={onRules} hitSlop={8} style={({ pressed }) => [s.inlineLink, pressed && { opacity: 0.6 }]} accessibilityRole="button">
                <Text style={s.rulesLink}>How heats work</Text>
                <Ionicons name="arrow-forward" size={13} color={TEXT_2} />
            </Pressable>
        </View>
    );
}

/** The one to pass, said as something to do; the earning rules a tap away. */
function RivalRow({ v, lit, onRules, blindBack }: { v: SeriesView; lit: boolean; onRules: () => void; blindBack?: string }) {
    const { t } = useTranslation();
    const r = v.rival;
    if (!r) return null;
    const sealed = v.hero.blind || r.sealed;
    const head = sealed
        ? t('series:league.rival.hidden')
        : r.ahead
            ? t('series:league.rival.clear', { gap: fmt(r.gap), name: r.p.name })
            : t('series:league.rival.toPass', { gap: fmt(r.gap), name: r.p.name });
    // The gap as one activity: "a 30-min walk", "about 3 walks". `how` is matched
    // as the sample writes it; anything else shows as it came.
    const walks = r.how.match(/(\d+) walks?/);
    const tail = sealed
        // 'back Thu' is the sample's (live Blind Mode always says when it's back).
        ? t('series:league.rival.stillCount', { back: blindBack ?? 'back Thu' })
        : r.ahead
            ? r.how
            : r.how.startsWith('One 30-min walk')
                ? t('series:league.rival.suggestWalk')
                : walks ? t('series:league.rival.suggestWalks', { count: Number(walks[1]) }) : r.how;
    return (
        <View style={[s.rival, lit && { backgroundColor: 'rgba(232,210,0,0.06)', borderColor: 'rgba(232,210,0,0.4)' }]}>
            <View style={s.rivalIcon}>
                <Ionicons name={sealed ? 'eye-off-outline' : 'trending-up-outline'} size={18} color={TEXT} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rivalHead} numberOfLines={1}>{head}</Text>
                <Text style={s.rivalTail} numberOfLines={1}>{tail}</Text>
            </View>
            <Pressable onPress={onRules} hitSlop={8} style={({ pressed }) => [s.inlineLink, pressed && { opacity: 0.6 }]} accessibilityRole="button">
                <Text style={s.rulesLink}>{t('series:league.rival.earningRules')}</Text>
                <Ionicons name="arrow-forward" size={13} color={TEXT_2} />
            </Pressable>
        </View>
    );
}

/** Overall: the race. You against everyone (or your heat), on Series points. */
function Race({ v, hits, you, heat }: { v: SeriesView; hits: Sim['hits']; you: You; heat: HeatInfo | null }) {
    const { t } = useTranslation();
    const sc = useSeasonCard();
    return (
        <>
            <View style={[s.raceCard, sc]}>
                <RaceHeader />
                {v.rows.map((r, i) => {
                    if (r.type === 'lane') {
                        return (
                            <SeriesLane
                                key={r.key}
                                p={r.p}
                                rank={r.rank}
                                hit={hits[r.p.id]}
                                title={r.dark || heat ? null : v.title(r.p, r.rank)}
                                bounty={v.bounty}
                                isMe={r.p.you}
                                dark={r.dark}
                                hideRank={r.hideRank}
                                first={i === 0 || v.rows[i - 1].type !== 'lane'}
                                you={you}
                                sub={heat ? heatFromLine(r.p, heat.meta.div) : undefined}
                                zone={heat ? zoneOf(heat.meta, r.rank) : null}
                            />
                        );
                    }
                    if (r.type === 'zone') {
                        const c = r.kind === 'up' ? GREEN : ORANGE;
                        return (
                            <Animated.View key={r.key} layout={ROW_LAYOUT} style={s.prize}>
                                <View style={[s.prizeLine, { backgroundColor: hexA(c, 0.4) }]} />
                                <Ionicons name={r.kind === 'up' ? 'arrow-up' : 'arrow-down'} size={10} color={hexA(c, 0.9)} />
                                <Text style={[s.prizeText, { color: hexA(c, 0.9) }]}>{r.text}</Text>
                                <View style={[s.prizeLine, { backgroundColor: hexA(c, 0.4) }]} />
                            </Animated.View>
                        );
                    }
                    if (r.type === 'sep') {
                        return <Animated.View key={r.key} layout={ROW_LAYOUT}><MoreLine text={t('series:league.race.more', { count: r.n, n: fmt(r.n) })} /></Animated.View>;
                    }
                    if (r.type === 'prize') {
                        return (
                            <Animated.View key={r.key} layout={ROW_LAYOUT} style={s.prize}>
                                <View style={s.prizeLine} />
                                <Text style={s.prizeText}>{t('series:league.race.prizes')}</Text>
                                <View style={s.prizeLine} />
                            </Animated.View>
                        );
                    }
                    return (
                        <Animated.View key={r.key} layout={ROW_LAYOUT} style={s.darkLabel}>
                            {/* Blind Mode is a name (the same in every language); The Dark 10 is sample-only. */}
                            <Text style={s.darkLabelText}>{v.hero.blind ? 'BLIND MODE · A–Z' : 'THE DARK 10 · A–Z'}</Text>
                            <Text style={[s.darkLabelText, { color: TEXT_3 }]}>{t('series:league.race.sealed')}</Text>
                        </Animated.View>
                    );
                })}
            </View>
        </>
    );
}

/** Which part of the heat a place is in: it colours the place number. */
function zoneOf(m: HeatMeta, rank: number): 'up' | 'down' | 'mid' {
    if (m.div > 1 && rank <= m.up) return 'up';
    if (m.down > 0 && rank > m.size - m.down) return 'down';
    return 'mid';
}

function VenueLogo({ event }: { event: LiveEvent }) {
    const ve = event.venue;
    const light = !!ve?.logo_url && ve.logo_bg !== 'dark';
    return (
        <View style={[s.evLogo, light && { backgroundColor: '#fff' }]}>
            {ve?.logo_url
                ? <Image source={{ uri: ve.logo_url }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
                : <Text style={s.evLogoText}>{(ve?.name ?? event.name).slice(0, 3).toUpperCase()}</Text>}
        </View>
    );
}

/** The way into a live event, joined or not. The event keeps its own page. */
function EventCard({ event, rank, onPress }: { event: LiveEvent; rank: number | null; onPress: () => void }) {
    const { t } = useTranslation();
    const venue = event.venue?.name ?? null;
    const sealed = event.is_locked && !event.revealed_at;
    const over = event.status === 'revealed' || event.status === 'settled';
    const joined = event.viewer.joined;
    const eyebrow = over
        ? (joined ? t('series:league.event.finished') : t('series:league.event.results'))
        : sealed ? t('series:league.event.tonight')
            : event.status === 'announced' ? t('series:league.event.comingSoon')
                : joined ? t('series:league.event.alsoIn') : t('series:league.event.open');
    const sub = over
        ? (joined && rank ? t('series:league.event.finishedRank', { rank }) : t('series:league.event.tapResults'))
        : sealed
            ? (venue ? t('series:league.event.revealedAt', { venue }) : t('series:league.event.revealedAtVenue'))
            : joined
                ? (rank ? t('series:league.event.joinedRank', { rank, scoring: scoringLine(event) }) : scoringLine(event))
                : venue
                    ? t('series:league.event.ownBoard', { venue, scoring: scoringLine(event) })
                    : t('series:league.event.ownBoardVenue', { scoring: scoringLine(event) });
    const sc = useSeasonCard();
    return (
        <Pressable
            onPress={() => { void Haptics.selectionAsync(); onPress(); }}
            style={({ pressed }) => [s.evCard, sc, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={t('series:league.event.a11y', { event: event.name })}
        >
            <VenueLogo event={event} />
            <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
                <Text style={s.evEyebrow} numberOfLines={1}>{eyebrow}</Text>
                <Text style={s.evName} numberOfLines={1}>{event.name}</Text>
                <Text style={s.evSub} numberOfLines={2}>{sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={TEXT_3} />
        </Pressable>
    );
}

/** Sample-data controls, clearly not part of the screen. */
function DevPanel({
    sim, onSlip, hasLive, showingLive, onSample, onFile, onPush, alertsShown, onToggleAlerts,
}: {
    sim: Sim;
    onSlip: () => void;
    hasLive: boolean;
    showingLive: boolean;
    onSample: (sample: boolean) => void;
    onFile: () => void;
    onPush: (kind: PushKind) => void;
    alertsShown: boolean;
    onToggleAlerts: () => void;
}) {
    const chip = (label: string, on: boolean, onPress: () => void) => (
        <Pressable key={label} onPress={onPress} style={[s.devChip, on && s.devChipOn]}>
            <Text style={[s.devChipText, on && { color: '#0a0a0a' }]}>{label}</Text>
        </Pressable>
    );
    const season = useSeason();
    return (
        <View style={s.dev}>
            <Text style={s.devTitle}>DEV · SERIES PROTOTYPE · {showingLive ? 'LIVE DATA' : 'SAMPLE DATA'}</Text>
            <Text style={s.devSub}>SEASON (AUTUMN + WINTER FROM THE LOOKBOOK; SPRING + SUMMER PROPOSED)</Text>
            <View style={s.devRow}>
                {chip('FROM ADMIN', season.forced === 'follow', () => seasonDev.set('follow'))}
                {SEASON_ORDER.map((k) => chip(SEASONS[k].name.split(' ')[0].toUpperCase(), season.forced === k, () => seasonDev.set(k)))}
                {chip('NO SEASON LOOK', season.forced === 'none', () => seasonDev.set('none'))}
            </View>
            <Text style={s.devSub}>LOCKUP SECOND LINE (WAS LONDON)</Text>
            <View style={s.devRow}>
                {(Object.keys(LOCKUP_LINES) as LockupLine[]).map((k) => chip(LOCKUP_LINES[k], season.lineKey === k, () => seasonDev.setLine(k)))}
            </View>
            {hasLive && (
                <View style={s.devRow}>
                    {chip('LIVE DATA', showingLive, () => onSample(false))}
                    {chip('SAMPLE DATA', !showingLive, () => onSample(true))}
                </View>
            )}
            {!showingLive && (
                <>
                    <View style={s.devRow}>
                        {chip('ROUND ON', sim.inRound, () => sim.setInRound(true))}
                        {chip('STARTS SOON (INVITES)', !sim.inRound && sim.offPhase === 'soon', () => sim.setOffPhase('soon'))}
                        {chip('BETWEEN ROUNDS', !sim.inRound && sim.offPhase === 'ended', () => sim.setOffPhase('ended'))}
                    </View>
                    {!sim.inRound && sim.offPhase === 'soon' && (
                        <View style={s.devRow}>
                            {chip('A FRIEND JOINS', false, sim.friendJoins)}
                            {chip('THEY WORK OUT', false, sim.friendWorksOut)}
                        </View>
                    )}
                    {sim.inRound && <View style={s.devRow}>{STATES.map((x) => chip(STATE_INFO[x].label, sim.state === x, () => sim.setState(x)))}</View>}
                    <View style={s.devRow}>
                        {chip(sim.scale === 'pitch' ? '5,000 IN' : '130 IN (CITY + GYM SHUT)', false, () => sim.setScale(sim.scale === 'pitch' ? 'today' : 'pitch'))}
                        {chip(sim.paused ? 'PLAY' : 'PAUSE', sim.paused, () => sim.setPaused(!sim.paused))}
                        {chip('RESET', false, sim.reset)}
                    </View>
                </>
            )}
            {!showingLive && sim.inRound && (
                <>
                    <Text style={s.devSub}>DAILY LOOP</Text>
                    <View style={s.devRow}>
                        {chip('NEW DAY', false, sim.newDay)}
                        {chip('6 PEOPLE PASS YOU', false, onSlip)}
                        {chip('MONDAY: DUEL RESULTS', !!sim.results, sim.mondayResults)}
                        {chip('GOLDEN P APPEARS', sim.golden.state !== 'hidden', sim.showGoldenP)}
                    </View>
                    <Text style={s.devSub}>TODAY’S DROP (SAME AS HOME)</Text>
                    <View style={s.devRow}>
                        {chip('+2K STEPS', false, () => dropSim.addSteps(2000))}
                        {chip('+15 ACTIVE MIN', false, () => dropSim.addMinutes(15))}
                        {chip('NEW DROP DAY', false, dropSim.newDay)}
                    </View>
                </>
            )}
            <Text style={s.devSub}>PUSHES</Text>
            <View style={s.devRow}>
                {chip('MORNING', false, () => onPush('morning'))}
                {chip('PASSED YOU', false, () => onPush('passed'))}
                {chip('DUEL RESULTS', false, () => onPush('results'))}
                {chip('TODAY’S MOMENT', false, () => onPush('moment'))}
                {chip('GOLDEN P', false, () => onPush('golden'))}
                {chip('NOTIFICATIONS CARD', alertsShown, onToggleAlerts)}
            </View>
            {!showingLive && sim.inRound && (
                <>
                    <Text style={s.devSub}>HEAT · WHAT LEADS THE CARD AND HOME</Text>
                    <View style={s.devRow}>
                        {chip('HEADLINE: HEAT', sim.headline === 'heat', () => sim.setHeadline('heat'))}
                        {chip('HEADLINE: OVERALL', sim.headline === 'overall', () => sim.setHeadline('overall'))}
                        {chip('INTO THE TOP 5', false, sim.intoTopFive)}
                    </View>
                    <Text style={s.devSub}>OVERALL</Text>
                    <View style={s.devRow}>
                        {chip('YOU OVERTAKE', false, sim.overtake)}
                        {chip('BOUNTY CLAIMED', false, sim.claimBounty)}
                        {chip('YOUR FILE', false, onFile)}
                    </View>
                </>
            )}
            {!showingLive && (
                <>
                    <Text style={s.devSub}>CITY · GYM · FRIENDS</Text>
                    <View style={s.devRow}>
                        {sim.inRound && chip('LONDON MOVES UP', false, sim.cityMovesUp)}
                        {chip('YOU TAKE THE CROWN', false, sim.takeCrown)}
                        {chip('TOM TAKES THE LEAD', false, sim.duelSlips)}
                    </View>
                </>
            )}
        </View>
    );
}

const s = StyleSheet.create({

    today: { marginHorizontal: 16, marginTop: 4, borderRadius: 16, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, overflow: 'hidden' },
    nextRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 12, paddingRight: 14 },
    nextIcon: {
        width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: 'rgba(232,210,0,0.32)', backgroundColor: 'rgba(232,210,0,0.06)',
    },
    nextText: { fontSize: 13, fontWeight: '300', lineHeight: 18, color: TEXT },
    nextGold: { color: GOLD, fontWeight: '500' },
    nextSmall: { marginTop: 2, fontSize: 11, fontWeight: '300', color: TEXT_3 },
    fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
    fileLabel: { flex: 1, fontSize: 9, fontWeight: '700', letterSpacing: 1.8, color: TEXT_3 },
    fileLink: { fontSize: 12, fontWeight: '500', color: GOLD },

    alerts: {
        marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 12, paddingRight: 12,
        borderRadius: 16, backgroundColor: CARD_BG, borderWidth: 1, borderColor: 'rgba(232,210,0,0.28)',
    },
    alertsTitle: { fontSize: 13, fontWeight: '400', color: TEXT },
    alertsBtn: { height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
    alertsBtnText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.3, color: '#0a0a0a' },

    push: {
        position: 'absolute', top: 6, left: 8, right: 8, borderRadius: 22, backgroundColor: 'rgba(40,40,40,0.97)',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
    },
    pushInner: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 12, paddingHorizontal: 13 },
    pushIcon: { width: 38, height: 38 },
    pushHead: { flexDirection: 'row', justifyContent: 'space-between' },
    pushApp: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, color: TEXT_2 },
    pushNow: { fontSize: 11, color: TEXT_3 },
    pushTitle: { marginTop: 2, fontSize: 14, fontWeight: '600', color: TEXT },
    pushBody: { marginTop: 1, fontSize: 13, fontWeight: '300', lineHeight: 18, color: TEXT },

    raceCard: { marginHorizontal: 16, borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, overflow: 'hidden', paddingVertical: 6 },
    prize: { height: 26, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
    prizeLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(232,210,0,0.35)' },
    prizeText: { fontSize: 9, fontWeight: '700', letterSpacing: 2.4, color: 'rgba(232,210,0,0.85)' },
    darkLabel: {
        height: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIR,
    },
    darkLabelText: { fontSize: 9, fontWeight: '700', letterSpacing: 2.2, color: TEXT_2 },

    evCard: {
        marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14,
        borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER,
    },
    evLogo: {
        width: 58, height: 42, borderRadius: 12, overflow: 'hidden', backgroundColor: '#080808', borderWidth: 1, borderColor: CARD_BORDER,
        alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 6,
    },
    evLogoText: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: TEXT },
    evEyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 2, color: GOLD },
    evName: { fontSize: 16, fontWeight: '300', color: TEXT },
    evSub: { fontSize: 12, fontWeight: '300', lineHeight: 16, color: TEXT_3 },

    footer: { marginHorizontal: 16, marginTop: 10, flexDirection: 'row', gap: 10 },
    footBtn: {
        flex: 1, height: 46, borderRadius: 23, borderWidth: 1, borderColor: CARD_BORDER,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    },
    footShare: { borderColor: 'rgba(232,210,0,0.32)' },
    footText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: TEXT_2 },
    linkBtn: { alignSelf: 'center', padding: 10 },
    link: { fontSize: 12, color: TEXT_2, textDecorationLine: 'underline' },
    roundNote: { marginTop: 2, paddingHorizontal: 24, fontSize: 10, lineHeight: 16, color: TEXT_3, textAlign: 'center' },
    preCard: { marginHorizontal: 16, paddingHorizontal: 16, paddingBottom: 6, borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER },

    dev: { marginHorizontal: 16, marginTop: 18, padding: 12, gap: 8, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.18)' },
    devTitle: { fontSize: 8, fontWeight: '700', letterSpacing: 1.6, color: TEXT_3 },
    devSub: { fontSize: 8, fontWeight: '700', letterSpacing: 1.6, color: 'rgba(255,255,255,0.35)', marginTop: 2 },
    devRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    devChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
    devChipOn: { backgroundColor: TEXT, borderColor: TEXT },
    devChipText: { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: TEXT_2 },

    pin: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 14 },
    segRow: { marginHorizontal: 16, marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 10 },
    seg: { flex: 1, flexDirection: 'row', padding: 3, borderRadius: 12, borderWidth: 1, borderColor: CARD_BORDER },
    segBtn: { flex: 1, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    segOn: { backgroundColor: 'rgba(255,255,255,0.08)' },
    segText: { fontSize: 13, fontWeight: '400', color: TEXT_3 },
    rival: { marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
    rivalIcon: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
    rivalHead: { fontSize: 15, fontWeight: '400', color: TEXT },
    rivalTail: { marginTop: 2, fontSize: 12, fontWeight: '300', color: TEXT_2 },
    rulesLink: { fontSize: 12, fontWeight: '400', color: TEXT_2 },
    inlineLink: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
    inlineLinkText: { fontSize: 13, fontWeight: '400', color: TEXT },
    linkRow: { marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 4 },
    linkText: { fontSize: 15, fontWeight: '400', color: TEXT },
    links: { marginTop: 6 },
    linkRule: { marginHorizontal: 20, height: StyleSheet.hairlineWidth, backgroundColor: HAIR },
    todayHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
    todayTitle: { fontSize: 20, fontWeight: '300', color: TEXT, letterSpacing: -0.2 },
    todayRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR },
    synced: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
    syncedText: { fontSize: 12, fontWeight: '300', color: TEXT_2 },
    toast: {
        position: 'absolute', alignSelf: 'center', maxWidth: '92%', flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
        backgroundColor: 'rgba(17,17,17,0.96)', borderWidth: 1, borderColor: CARD_BORDER,
    },
    toastDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD },
    toastText: { flexShrink: 1, fontSize: 9, fontWeight: '600', letterSpacing: 1.3, color: TEXT_2 },
});
