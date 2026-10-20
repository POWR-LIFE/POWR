import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { SegmentBar } from '@/components/league/SegmentBar';
import type { LiveEvent } from '@/lib/api/liveEvents';
import { fetchProfile, type Profile } from '@/lib/api/user';
import {
    ACTS,
    type Board,
    fmt,
    isDark,
    known,
    leaderPts,
    type LensKey,
    multLabel,
    multOf,
    type Row,
    type SeriesState,
    STATE_INFO,
    titleOf,
    youOf,
} from '@/lib/dev/seriesPrototype';
import { scoringLine } from '@/lib/liveEventDisplay';
import { memberInitials, memberLabel } from '@/lib/memberName';
import {
    BORDER,
    CARD_BG,
    CARD_BORDER,
    DIM,
    EMBER,
    GOLD,
    GREEN,
    type LaneMeta,
    MoveChip,
    MUTED,
    RollNumber,
    ROW_LAYOUT,
    SeriesLane,
    TEXT,
} from './SeriesLane';
import { GoldenTicket, RulesSheet, ShareSheet, YourFile } from './SeriesSheets';
import { type FeedItem, useSeriesSim } from './useSeriesSim';

const RAIN = '#A9C3DE';
const LENSES: { key: LensKey; label: string }[] = [
    { key: 'overall', label: 'Overall' },
    { key: 'city', label: 'My city' },
    { key: 'gym', label: 'My gym' },
    { key: 'friends', label: 'Friends' },
];
const STATES: SeriesState[] = ['day3', 'eventNight', 'day9', 'rain', 'flash', 'final48'];

/** An event that hasn't been revealed yet: still worth a way in from the Series. */
const RUNNING: LiveEvent['status'][] = ['scheduled', 'live', 'locked'];

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * DEV ONLY (SERIES_PROTOTYPE). The League tab's home while the Autumn Series
 * is being designed: the Series board on sample data, built from the tab's own
 * pieces (SegmentBar, standings card, level pills, move chips). A live event
 * is NOT a board on this screen: it opens as the real event page
 * (`onOpenEvent`), from one card under your rank when you're in it, or a tile
 * in This round when you're not.
 */
export function SeriesHome({
    events,
    eventRank,
    onOpenEvent,
    onHeader,
    bottomInset,
}: {
    events: LiveEvent[];
    eventRank?: number | null;
    onOpenEvent: (slug: string) => void;
    /** The line under the screen title: which Series, which day. */
    onHeader?: (sub: string) => void;
    bottomInset: number;
}) {
    const focused = useIsFocused();
    const sim = useSeriesSim(focused);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [sheet, setSheet] = useState<'rules' | 'share' | 'file' | 'ticket' | null>(null);
    useEffect(() => { fetchProfile().then(setProfile).catch(() => undefined); }, []);
    const you = {
        name: memberLabel(profile?.display_name, profile?.username),
        initials: memberInitials(profile?.display_name, profile?.username),
        avatarUrl: profile?.avatar_url ?? null,
    };

    const b = sim.board;
    const st = sim.state;
    const info = STATE_INFO[st];
    const bounty = sim.model.bounty;
    const me = youOf(b);
    const lead = leaderPts(b);
    useEffect(() => {
        onHeader?.(`Autumn Series · Day ${info.day} of 15${st === 'final48' ? ' · Final 48' : ''}`);
    }, [info.day, onHeader, st]);

    const ev = events[0];
    const evCard = !!ev && ev.viewer.joined && RUNNING.includes(ev.status);
    const evTile = !!ev && !evCard;

    const metaFor = (r: Extract<Row, { type: 'lane' }>): LaneMeta => {
        if (r.dark) return { kind: 'sealed' };
        const t = titleOf(r.p, r.rank, b, bounty.live);
        if (t) return { kind: 'title', title: t };
        if (!r.p.you && me.rank > 3 && Math.abs(r.rank - me.rank) <= 2) {
            const g = r.p.pts - me.p.pts;
            return { kind: 'gap', text: `${fmt(Math.abs(g))} ${g >= 0 ? 'ahead of you' : 'behind you'}` };
        }
        return { kind: 'level' };
    };

    const lastShown = sim.rows.reduce((m, r) => (r.type === 'lane' ? Math.max(m, r.rank) : m), 0);
    const below = Math.max(0, b.total - lastShown);
    const overall = youOf(sim.model.boards.overall);
    const shared = () => { setSheet(null); sim.showToast('OPENS THE PHONE’S SHARE SHEET'); };

    return (
        <View style={{ flex: 1 }}>
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: bottomInset + 24, gap: 8 }}
                showsVerticalScrollIndicator={false}
            >
                {info.band && <Band state={st} />}
                <SeriesHero
                    state={st}
                    rank={me.rank}
                    move={me.p.mid - me.rank}
                    total={b.total}
                    target={b.ms ? { label: b.ms.label, gap: b.ms.pts - me.p.pts } : podiumGap(b, me.rank, me.p.pts)}
                />

                {evCard && <EventLink event={ev} rank={eventRank ?? null} onPress={() => onOpenEvent(ev.slug)} />}

                <BountyStrip state={st} b={sim.model.boards.overall} bounty={bounty} />

                <View style={{ marginTop: 4 }}>
                    <SegmentBar items={LENSES} value={sim.lens} onChange={sim.setLens} />
                </View>

                <SectionLabel text="The race" right="Series points" />
                <View style={s.card}>
                    {sim.rows.map((r, i) => {
                        if (r.type === 'lane') {
                            const meta = metaFor(r);
                            return (
                                <SeriesLane
                                    key={r.key}
                                    p={r.p}
                                    rank={r.rank}
                                    lead={lead}
                                    hit={sim.hits[r.p.id]}
                                    meta={meta}
                                    isMe={r.p.you}
                                    wanted={meta.kind === 'title' && meta.title === 'wanted'}
                                    dark={r.dark}
                                    first={i === 0 || sim.rows[i - 1].type === 'dark'}
                                    you={you}
                                />
                            );
                        }
                        if (r.type === 'sep') {
                            return (
                                <Animated.View key={r.key} layout={ROW_LAYOUT} style={s.sep}>
                                    <Text style={s.sepText}>· · ·   {fmt(r.n)} more   · · ·</Text>
                                </Animated.View>
                            );
                        }
                        if (r.type === 'prize') {
                            return (
                                <Animated.View key={r.key} layout={ROW_LAYOUT} style={s.prize}>
                                    <View style={s.dashes}>{DASHES}</View>
                                    <Text style={s.prizeText}>PRIZE BOXES · TOP 3</Text>
                                </Animated.View>
                            );
                        }
                        return (
                            <Animated.View key={r.key} layout={ROW_LAYOUT} style={s.darkLabel}>
                                <Text style={s.darkLabelText}>THE DARK 10 · A–Z</Text>
                                <Text style={[s.darkLabelText, { color: MUTED }]}>POSITIONS SEALED</Text>
                            </Animated.View>
                        );
                    })}
                </View>
                <View style={s.below}>
                    <Text style={s.belowText}>{below > 0 ? <>and <Text style={s.belowStrong}>{fmt(below)}</Text> more below</> : 'That’s everyone'}</Text>
                    <Text style={s.belowText}>You’re <Text style={s.belowStrong}>#{fmt(me.rank)}</Text> of <Text style={s.belowStrong}>{fmt(b.total)}</Text></Text>
                </View>

                <Rival sim={sim} />

                <SectionLabel text="This round" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tiles}>
                    {evTile && <EventTile event={ev} onPress={() => onOpenEvent(ev.slug)} />}
                    {info.logged >= 10
                        ? <Tile icon="gift-outline" status="YOU’RE IN" tone="green" title="The Draw" body="10 of 15 days logged. Drawn on the 16th." />
                        : <Tile icon="gift-outline" status={`${info.logged} OF 10 DAYS`} tone="gold" title="The Draw" body={`${10 - info.logged} more active days and you’re in the draw.`} />}
                    <Tile icon="flash-outline" status={st === 'flash' ? 'LIVE NOW' : '3 A ROUND'} tone={st === 'flash' ? 'gold' : 'muted'} live={st === 'flash' ? 'gold' : undefined} title="Flash Windows" body={info.flash} />
                    <Tile icon="rainy-outline" status={st === 'rain' ? 'LIVE · TILL 18:00' : 'WHEN IT RAINS'} tone={st === 'rain' ? 'rain' : 'muted'} live={st === 'rain' ? 'rain' : undefined} title="Rain Check" body="×1.25 on outdoor sessions. We push you when it’s on." />
                    {sim.ticket
                        ? <Tile icon="ticket-outline" status="FOUND" tone="gold" title="Golden Ticket" body="In your 34-min walk. A prize box is on its way." />
                        : <Tile icon="ticket-outline" status="1 HIDDEN" tone="muted" title="Golden Ticket" body="In one verified session this round. Could be yours." />}
                    <Tile icon="document-text-outline" status="OPENS 16 NOV" tone="muted" title="Your File" body="Your round on one card. Tap to preview." onPress={() => setSheet('file')} />
                </ScrollView>

                <SectionLabel text="Landing now" right={`${fmt(sim.model.hour)} sessions this hour`} />
                <FeedConveyor items={sim.feed} state={st} />

                <Pressable
                    style={({ pressed }) => [s.ghost, pressed && { opacity: 0.6 }]}
                    onPress={() => { void Haptics.selectionAsync(); setSheet('share'); }}
                >
                    <Ionicons name="share-outline" size={15} color={GOLD} />
                    <Text style={s.ghostText}>SHARE MY POSITION</Text>
                </Pressable>
                <Pressable onPress={() => setSheet('rules')} style={s.linkBtn} hitSlop={6}>
                    <Text style={s.link}>How the Series works</Text>
                </Pressable>

                <DevPanel sim={sim} onTicket={() => sim.findTicket(() => setSheet('ticket'))} onFile={() => setSheet('file')} />
            </ScrollView>

            {sim.toast && (
                <Animated.View key={sim.toast.key} entering={FadeInDown.duration(300)} exiting={FadeOut.duration(250)} style={[s.toast, sim.toast.tone === 'ember' && { backgroundColor: EMBER }]}>
                    <Text style={s.toastText} numberOfLines={1}>{sim.toast.text}</Text>
                </Animated.View>
            )}

            <RulesSheet visible={sheet === 'rules'} onClose={() => setSheet(null)} />
            <ShareSheet
                visible={sheet === 'share'}
                onClose={() => setSheet(null)}
                big={`#${fmt(overall.rank)}`}
                line={`${overall.p.mid - overall.rank > 0 ? `▲${overall.p.mid - overall.rank} TODAY · ` : ''}DAY ${info.day} OF 15`}
                onShare={shared}
            />
            <YourFile visible={sheet === 'file'} onClose={() => setSheet(null)} scale={sim.scale} onShare={shared} />
            <GoldenTicket visible={sheet === 'ticket'} onClaim={() => { setSheet(null); sim.showToast('CLAIMED · WE’LL ASK WHERE TO SEND IT'); }} />
        </View>
    );
}

const FEED_ROW = 56;
const FEED_PITCH = FEED_ROW + 1;

/**
 * Landing now as a conveyor: three fixed slots; a new session slides in at the
 * top, the others step down one slot and the oldest fades out below. (Entering
 * + layout animations let a new row overlap the old one mid-slide.)
 */
function FeedConveyor({ items, state }: { items: FeedItem[]; state: SeriesState }) {
    return (
        <View style={[s.card, { height: FEED_PITCH * 3 + 8 }]}>
            {items.map((f, i) => <FeedRow key={f.key} f={f} index={i} state={state} />)}
        </View>
    );
}

function FeedRow({ f, index, state }: { f: FeedItem; index: number; state: SeriesState }) {
    const y = useSharedValue(f.seed ? index * FEED_PITCH : -FEED_PITCH);
    const o = useSharedValue(f.seed ? 1 : 0);
    useEffect(() => {
        y.value = withTiming(index * FEED_PITCH, { duration: 600, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
        o.value = withTiming(index < 3 ? 1 : 0, { duration: 600 });
    }, [index, o, y]);
    const slide = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: o.value }));
    return (
        <Animated.View style={[s.feedRow, index > 0 && s.feedDivider, f.you && { backgroundColor: 'rgba(232,210,0,0.05)' }, f.ticket && { backgroundColor: 'rgba(232,210,0,0.14)' }, slide]}>
            <View style={[s.feedIcon, f.ticket && { backgroundColor: GOLD }]}>
                <Ionicons name={f.ticket ? 'ticket-outline' : ACTS[f.act].icon} size={15} color={f.ticket ? '#0a0a0a' : GOLD} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.feedWho} numberOfLines={1}>{f.ticket ? 'You found the Golden Ticket' : f.sealed ? 'Someone in the dark 10' : f.you ? 'You' : f.name}</Text>
                <Text style={s.feedSub} numberOfLines={1}>
                    {ACTS[f.act].label}{f.atEvent && !f.sealed ? ' at ONE LDN' : ''} · {f.min} min
                    {f.m > 1 && !f.sealed && !f.ticket
                        ? <Text style={{ color: GOLD, fontWeight: '600' }}> · {multLabel(f.m)}{state === 'rain' && ACTS[f.act].outdoor ? ' rain' : ''}</Text>
                        : null}
                </Text>
            </View>
            <Text style={[s.feedPts, f.sealed && { color: MUTED }, f.ticket && s.feedPrize]}>
                {f.ticket ? 'PRIZE BOX' : f.sealed ? '+ ???' : `+${fmt(f.pts)}`}
            </Text>
        </Animated.View>
    );
}

function podiumGap(b: Board, rank: number, pts: number) {
    if (rank <= 3) return null;
    const third = known(b).find((k) => k.rank === 3);
    return third ? { label: 'the podium', gap: third.p.pts - pts } : null;
}

const DASHES = Array.from({ length: 30 }, (_, i) => <View key={i} style={{ width: 5, height: 1, backgroundColor: 'rgba(232,210,0,0.45)' }} />);

function SectionLabel({ text, right }: { text: string; right?: string }) {
    return (
        <View style={s.sectionRow}>
            <Text style={s.sectionLabel}>{text}</Text>
            <View style={s.sectionLine} />
            {right ? <Text style={s.sectionRight}>{right}</Text> : null}
        </View>
    );
}

/** Flash Window / Rain Check / Event night: the moment, across the top. */
function Band({ state }: { state: SeriesState }) {
    const band = STATE_INFO[state].band!;
    const [secs, setSecs] = useState(41 * 60 + 20);
    useEffect(() => {
        if (band.right) return undefined;
        const t = setInterval(() => setSecs((x) => Math.max(0, x - 1)), 1000);
        return () => clearInterval(t);
    }, [band.right]);
    const c = band.tone === 'rain' ? RAIN : GOLD;
    return (
        <View style={[s.band, { borderColor: `${c}59`, backgroundColor: `${c}14` }]}>
            <Ionicons name={band.icon} size={14} color={c} />
            <Text style={[s.bandText, { color: c }]} numberOfLines={1}>{band.text}</Text>
            <Text style={[s.bandRight, { color: c }, band.right ? s.bandRightSm : null]}>
                {band.right ?? `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`}
            </Text>
        </View>
    );
}

function SeriesHero({
    state, rank, move, total, target,
}: {
    state: SeriesState;
    rank: number;
    move: number;
    total: number;
    target: { label: string; gap: number } | null;
}) {
    const info = STATE_INFO[state];
    const pct = Math.max(1, Math.round((rank / total) * 100));
    const where = total <= 10 ? `#${rank} of ${total}` : `Top ${pct}%`;
    return (
        <View style={s.hero}>
            <View style={s.rankLine}>
                <Text style={s.hash}>#</Text>
                <RollNumber value={rank} style={s.statNum} />
                <View style={{ marginLeft: 8, marginBottom: 12 }}><MoveChip delta={move} size="lg" /></View>
                <View style={{ flex: 1 }} />
                <View style={s.badge}>
                    <Ionicons name={info.mult.icon} size={10} color={GOLD} />
                    <Text style={s.badgeText}>{info.mult.text}</Text>
                </View>
            </View>
            <Text style={s.heroSub}>
                {where}
                {state === 'final48'
                    ? <> · revealed live on Instagram <Text style={s.heroStrong}>16 Nov, 20:00</Text></>
                    : target && target.gap > 0
                        ? <> · <Text style={s.heroStrong}>{fmt(target.gap)} pts</Text> to {target.label} · <Text style={s.heroStrong}>{info.left}</Text> left</>
                        : <> · <Text style={s.heroStrong}>{info.left}</Text> left</>}
            </Text>
        </View>
    );
}

function VenueLogo({ event }: { event: LiveEvent }) {
    const v = event.venue;
    const light = !!v?.logo_url && v.logo_bg !== 'dark';
    return (
        <View style={[s.evLogo, light && { backgroundColor: '#fff' }]}>
            {v?.logo_url
                ? <Image source={{ uri: v.logo_url }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
                : <Text style={s.evLogoText}>{(v?.name ?? event.name).slice(0, 3).toUpperCase()}</Text>}
        </View>
    );
}

/** The way into a live event you're in. The event keeps its own page. */
function EventLink({ event, rank, onPress }: { event: LiveEvent; rank: number | null; onPress: () => void }) {
    const sealed = event.is_locked && !event.revealed_at;
    return (
        <Pressable
            onPress={() => { void Haptics.selectionAsync(); onPress(); }}
            style={({ pressed }) => [s.evCard, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={`Open ${event.name}`}
        >
            <VenueLogo event={event} />
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <Text style={s.evEyebrow}>{sealed ? 'EVENT NIGHT · RESULTS AT THE DOORS' : 'YOU’RE ALSO IN A LIVE EVENT'}</Text>
                <Text style={s.evName} numberOfLines={1}>{event.name}</Text>
                <Text style={s.evSub} numberOfLines={1}>{rank ? `#${rank} on its board · ` : ''}{scoringLine(event)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={MUTED} />
        </Pressable>
    );
}

function EventTile({ event, onPress }: { event: LiveEvent; onPress: () => void }) {
    const over = event.status === 'revealed' || event.status === 'settled';
    const joined = event.viewer.joined;
    return (
        <Tile
            icon="location-outline"
            status={over ? 'RESULTS' : joined ? 'YOU’RE IN' : 'OPEN TO JOIN'}
            tone={over ? 'green' : 'gold'}
            title={event.name}
            body={over
                ? 'Live event, revealed at the doors. Tap for the results.'
                : `Its own board at ${event.venue?.name ?? 'the venue'}, separate from the Series. ${scoringLine(event)}.`}
            onPress={onPress}
        />
    );
}

function BountyStrip({
    state, b, bounty,
}: {
    state: SeriesState;
    b: Board;
    bounty: ReturnType<typeof useSeriesSim>['model']['bounty'];
}) {
    if (state === 'final48') {
        return (
            <View style={[s.strip, { borderColor: 'rgba(255,255,255,0.14)' }]}>
                <Ionicons name="eye-off-outline" size={16} color={TEXT} />
                <Text style={s.stripText} numberOfLines={1}><Text style={[s.stripKey, { color: TEXT }]}>FINAL 48  </Text>Top 10 sealed · the bounty is on one of them</Text>
            </View>
        );
    }
    // Series-wide news, so it stays put on every tab (no jump when switching).
    if (!bounty.live) {
        return (
            <View style={[s.strip, { borderColor: CARD_BORDER }]}>
                <Ionicons name="locate-outline" size={16} color={MUTED} />
                <Text style={s.stripText} numberOfLines={1}><Text style={[s.stripKey, { color: DIM }]}>CLAIMED  </Text><Text style={s.heroStrong}>{bounty.claimedBy}</Text> took {fmt(bounty.pot)} off {bounty.from}</Text>
            </View>
        );
    }
    const [a, c] = b.segs[0].people;
    const pct = Math.round(((a.pts - c.pts) / Math.max(1, c.pts)) * 100);
    return (
        <View style={s.strip}>
            <Ionicons name="locate-outline" size={16} color={EMBER} />
            <Text style={s.stripText} numberOfLines={1}><Text style={s.stripKey}>BOUNTY  </Text><Text style={s.heroStrong}>{fmt(bounty.pot)}</Text> on <Text style={s.heroStrong}>{a.name}</Text> · leads by {pct}%</Text>
        </View>
    );
}

function Rival({ sim }: { sim: ReturnType<typeof useSeriesSim> }) {
    const b = sim.board;
    const all = known(b);
    const me = all.find((k) => k.p.you)!;
    const ahead = me.rank === 1;
    const rv = all.find((k) => k.rank === (ahead ? 2 : me.rank - 1));
    if (!rv) return null;
    const sealed = isDark(sim.state, rv.rank, rv.p);
    const gap = Math.abs(rv.p.pts - me.p.pts);
    const walk = Math.max(1, Math.round(ACTS.walk.ppm * sim.model.k * multOf(me.p, me.rank, b, sim.state, sim.model.bounty.live, 'walk') * 30));
    const how = sealed ? 'Sealed until the reveal' : ahead ? `${Math.ceil(gap / walk)} walks in hand` : gap <= walk ? 'One 30-min walk does it' : `About ${Math.ceil(gap / walk)} walks to pass`;
    const share = me.p.today / Math.max(1, me.p.today + rv.p.today);
    return (
        <>
            <SectionLabel text="Your rival" right={ahead ? 'the one chasing you' : 'the one directly above you'} />
            <View style={[s.card, s.rival]}>
                <View style={s.rivalRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.rivalWho}>You · #{fmt(me.rank)}</Text>
                        <RollNumber value={me.p.pts} style={[s.rivalNum, { color: GOLD }]} />
                    </View>
                    <View style={s.rivalGap}>
                        <Text style={s.statLabelSm}>{ahead ? 'LEAD' : 'GAP'}</Text>
                        {sealed ? <Text style={s.rivalGapNum}>?</Text> : <RollNumber value={gap} style={s.rivalGapNum} />}
                        <Text style={s.rivalHow}>{how}</Text>
                    </View>
                    <View style={{ flex: 1, alignItems: 'flex-end', minWidth: 0 }}>
                        <Text style={s.rivalWho} numberOfLines={1}>{rv.p.name} · {sealed ? 'sealed' : `#${fmt(rv.rank)}`}</Text>
                        {sealed ? <Text style={[s.rivalNum, { color: MUTED }]}>—</Text> : <RollNumber value={rv.p.pts} style={s.rivalNum} />}
                    </View>
                </View>
                <View style={s.tugLabels}>
                    <Text style={[s.tugPct, { color: GOLD }]}>{Math.round(share * 100)}%</Text>
                    <Text style={s.statLabelSm}>TODAY SO FAR</Text>
                    <Text style={[s.tugPct, { color: DIM }]}>{100 - Math.round(share * 100)}%</Text>
                </View>
                <View style={s.tug}>
                    <View style={[s.tugA, { flex: share }]} />
                    <View style={s.tugMark} />
                    <View style={[s.tugB, { flex: 1 - share }]} />
                </View>
            </View>
        </>
    );
}

function Tile({
    icon, status, tone, title, body, live, onPress,
}: {
    icon: IconName;
    status: string;
    tone: 'gold' | 'muted' | 'green' | 'rain';
    title: string;
    body: string;
    live?: 'gold' | 'rain';
    onPress?: () => void;
}) {
    const toneColour = { gold: GOLD, muted: MUTED, green: GREEN, rain: RAIN }[tone];
    const inner = (
        <>
            <View style={s.tileTop}>
                <Ionicons name={icon} size={18} color={live === 'rain' ? RAIN : GOLD} />
                <Text style={[s.tileStatus, { color: toneColour }]} numberOfLines={1}>{status}</Text>
            </View>
            <Text style={s.tileTitle} numberOfLines={2}>{title}</Text>
            <Text style={s.tileBody}>{body}</Text>
        </>
    );
    const style = [s.tile, live === 'gold' && s.tileLive, live === 'rain' && s.tileRain];
    return onPress ? (
        <Pressable onPress={() => { void Haptics.selectionAsync(); onPress(); }} style={({ pressed }) => [...style, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            {inner}
        </Pressable>
    ) : (
        <View style={style}>{inner}</View>
    );
}

/** Sample-data controls, clearly not part of the screen. */
function DevPanel({ sim, onTicket, onFile }: { sim: ReturnType<typeof useSeriesSim>; onTicket: () => void; onFile: () => void }) {
    const chip = (label: string, on: boolean, onPress: () => void) => (
        <Pressable key={label} onPress={onPress} style={[s.devChip, on && s.devChipOn]}>
            <Text style={[s.devChipText, on && { color: '#0a0a0a' }]}>{label}</Text>
        </Pressable>
    );
    return (
        <View style={s.dev}>
            <Text style={s.devTitle}>DEV · SERIES PROTOTYPE · SAMPLE DATA</Text>
            <View style={s.devRow}>{STATES.map((x) => chip(STATE_INFO[x].label, sim.state === x, () => sim.setState(x)))}</View>
            <View style={s.devRow}>
                {chip(sim.scale === 'pitch' ? '5,000 IN' : '130 IN', false, () => sim.setScale(sim.scale === 'pitch' ? 'today' : 'pitch'))}
                {chip(sim.paused ? 'PLAY' : 'PAUSE', sim.paused, () => sim.setPaused(!sim.paused))}
                {chip('RESET', false, sim.reset)}
            </View>
            <View style={s.devRow}>
                {chip('YOU OVERTAKE', false, sim.overtake)}
                {chip('BOUNTY CLAIMED', false, sim.claimBounty)}
                {chip('GOLDEN TICKET', false, onTicket)}
                {chip('YOUR FILE', false, onFile)}
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    card: { marginHorizontal: 14, borderRadius: 16, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, overflow: 'hidden', paddingVertical: 4 },
    sectionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 6, gap: 12 },
    sectionLabel: { fontSize: 9, fontWeight: '500', letterSpacing: 2, color: TEXT, textTransform: 'uppercase' },
    sectionLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: BORDER },
    sectionRight: { fontSize: 10, fontWeight: '300', color: DIM },

    band: { marginHorizontal: 14, marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1 },
    bandText: { flex: 1, fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },
    bandRight: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    bandRightSm: { fontSize: 11, fontWeight: '500' },
    hero: { paddingHorizontal: 16, paddingTop: 0, gap: 0 },
    statLabelSm: { fontSize: 8, fontWeight: '500', color: MUTED, letterSpacing: 2 },
    rankLine: { flexDirection: 'row', alignItems: 'flex-end' },
    hash: { fontSize: 28, fontWeight: '200', color: GOLD, marginBottom: 27, marginRight: 2 },
    statNum: { fontSize: 64, fontWeight: '100', color: GOLD, letterSpacing: -2.5, lineHeight: 66, fontVariant: ['tabular-nums'] },
    badge: {
        flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14, paddingHorizontal: 10, paddingVertical: 4,
        borderRadius: 20, backgroundColor: 'rgba(232,210,0,0.10)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.25)',
    },
    badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: GOLD },
    heroSub: { fontSize: 12, fontWeight: '300', color: DIM, lineHeight: 18 },
    heroStrong: { color: TEXT, fontWeight: '500' },

    evCard: {
        marginHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 11,
        borderRadius: 16, backgroundColor: CARD_BG, borderWidth: 1, borderColor: 'rgba(232,210,0,0.35)',
    },
    evLogo: { width: 52, height: 32, borderRadius: 8, overflow: 'hidden', backgroundColor: '#141414', borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', padding: 4 },
    evLogoText: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: TEXT },
    evEyebrow: { fontSize: 8, fontWeight: '700', letterSpacing: 1.8, color: GOLD },
    evName: { fontSize: 15, fontWeight: '500', color: TEXT },
    evSub: { fontSize: 11, fontWeight: '300', color: DIM },

    strip: {
        marginHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12,
        borderRadius: 14, backgroundColor: CARD_BG, borderWidth: 1, borderColor: 'rgba(229,138,58,0.40)',
    },
    stripText: { flex: 1, fontSize: 12, fontWeight: '300', color: DIM },
    stripKey: { fontSize: 9, fontWeight: '700', letterSpacing: 1.8, color: EMBER },

    sep: { alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' },
    sepText: { fontSize: 11, color: MUTED, fontWeight: '300' },
    prize: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 6 },
    dashes: { flex: 1, flexDirection: 'row', gap: 4, overflow: 'hidden' },
    prizeText: { fontSize: 8, fontWeight: '700', letterSpacing: 1.8, color: GOLD },
    darkLabel: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
    darkLabelText: { fontSize: 8, fontWeight: '700', letterSpacing: 1.8, color: DIM },
    below: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18 },
    belowText: { fontSize: 11, fontWeight: '300', color: MUTED },
    belowStrong: { color: DIM, fontWeight: '500' },

    rival: { paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
    rivalRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    rivalWho: { fontSize: 11, fontWeight: '400', color: DIM, marginBottom: 2 },
    rivalNum: { fontSize: 26, fontWeight: '100', color: TEXT, letterSpacing: -1, fontVariant: ['tabular-nums'] },
    rivalGap: { alignItems: 'center', maxWidth: 150, gap: 1 },
    rivalGapNum: { fontSize: 20, fontWeight: '600', color: TEXT, fontVariant: ['tabular-nums'] },
    rivalHow: { fontSize: 10, fontWeight: '300', color: DIM, textAlign: 'center' },
    tugLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    tugPct: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
    tug: { flexDirection: 'row', alignItems: 'center', height: 8 },
    tugA: { height: 6, borderRadius: 3, backgroundColor: GOLD },
    tugB: { height: 6, borderRadius: 3, backgroundColor: 'rgba(242,242,242,0.45)' },
    tugMark: { width: 3, height: 14, borderRadius: 2, backgroundColor: '#fff', marginHorizontal: 2 },

    tiles: { paddingHorizontal: 14, gap: 8, paddingTop: 2 },
    tile: { width: 152, minHeight: 128, padding: 12, gap: 5, borderRadius: 16, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER },
    tileLive: { borderColor: 'rgba(232,210,0,0.45)', backgroundColor: '#1E1D10' },
    tileRain: { borderColor: 'rgba(169,195,222,0.45)', backgroundColor: '#1A1C1D' },
    tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 6 },
    tileStatus: { flexShrink: 1, fontSize: 8, fontWeight: '700', letterSpacing: 1.2 },
    tileTitle: { fontSize: 14, fontWeight: '500', color: TEXT },
    tileBody: { fontSize: 11, fontWeight: '300', color: DIM, lineHeight: 15 },

    feedRow: { position: 'absolute', left: 0, right: 0, top: 4, height: FEED_ROW, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 },
    feedDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' },
    feedIcon: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(232,210,0,0.5)', backgroundColor: 'rgba(232,210,0,0.08)', alignItems: 'center', justifyContent: 'center' },
    feedWho: { fontSize: 13, fontWeight: '400', color: TEXT },
    feedSub: { fontSize: 11, fontWeight: '300', color: MUTED },
    feedPts: { fontSize: 14, fontWeight: '700', color: GREEN, fontVariant: ['tabular-nums'] },
    feedPrize: { color: GOLD, fontSize: 9, letterSpacing: 1.4 },

    ghost: {
        marginHorizontal: 14, marginTop: 10, height: 46, borderRadius: 23, borderWidth: 1, borderColor: 'rgba(232,210,0,0.35)',
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    },
    ghostText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: GOLD },
    linkBtn: { alignSelf: 'center', paddingVertical: 6 },
    link: { fontSize: 12, color: DIM, textDecorationLine: 'underline' },

    dev: { marginHorizontal: 14, marginTop: 18, padding: 12, gap: 8, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.18)' },
    devTitle: { fontSize: 8, fontWeight: '700', letterSpacing: 1.6, color: MUTED },
    devRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    devChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
    devChipOn: { backgroundColor: TEXT, borderColor: TEXT },
    devChipText: { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: DIM },

    toast: {
        position: 'absolute', top: 8, alignSelf: 'center', maxWidth: '92%', paddingHorizontal: 16, paddingVertical: 9,
        borderRadius: 20, backgroundColor: GOLD,
    },
    toastText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: '#0a0a0a' },
});
