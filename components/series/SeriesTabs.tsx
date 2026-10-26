import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import {
    cityRanked,
    courtRanked,
    type Duel,
    firstName,
    fmt,
    initialsOf,
    type LensKey,
    ordinal,
    type TabGames,
} from '@/lib/dev/seriesPrototype';
import {
    AVATAR_BG,
    CARD_BG,
    CARD_BORDER,
    GOLD,
    GREEN,
    HAIR,
    MoreLine,
    SectionLabel,
    TEXT,
    TEXT_2,
    TEXT_3,
    YOU_LINE,
    YOU_TINT,
} from './SeriesLane';
import { useSeasonCard } from './season';
import type { GameLock } from './seriesView';

/**
 * The League tab's switch for the Series: four games, not four filters.
 * Equal-width labels, a short gold underline under the active one, and a gold
 * dot on a tab where something happened while you were elsewhere. A game that
 * isn't open yet keeps its tab, with a lock, so everyone can see it's coming.
 */
export function GameTabs({
    items, value, dots, onChange,
}: {
    items: { key: LensKey; label: string; locked?: boolean }[];
    value: LensKey;
    dots: Partial<Record<LensKey, boolean>>;
    onChange: (key: LensKey) => void;
}) {
    const [w, setW] = useState(0);
    const tabW = w / Math.max(1, items.length);
    const index = Math.max(0, items.findIndex((i) => i.key === value));
    const x = useSharedValue(0);
    useEffect(() => { x.value = withTiming(index * tabW, { duration: 220 }); }, [index, tabW, x]);
    const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
    return (
        <View style={s.tabs} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
            {items.map((it) => {
                const on = it.key === value;
                return (
                    <Pressable
                        key={it.key}
                        style={s.tab}
                        onPress={() => { if (on) return; void Haptics.selectionAsync(); onChange(it.key); }}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: on }}
                    >
                        <View style={s.tabInner}>
                            <Text style={[s.tabLabel, on && s.tabLabelOn]}>{it.label}</Text>
                            {it.locked && <Ionicons name="lock-closed" size={8} color={on ? TEXT : TEXT_3} style={s.tabLock} />}
                            {dots[it.key] && !on && <View style={s.ping} />}
                        </View>
                    </Pressable>
                );
            })}
            {w > 0 && (
                <Animated.View pointerEvents="none" style={[s.ind, { width: tabW }, slide]}>
                    <View style={s.indBar} />
                </Animated.View>
            )}
        </View>
    );
}

function Crown({ size }: { size: number }) {
    return (
        <Svg width={size} height={Math.round((size * 32) / 44)} viewBox="0 0 44 32">
            <Path d="M3 9l9 8 10-14 10 14 9-8-4 19H7z" fill="none" stroke={GOLD} strokeWidth={size > 20 ? 1.6 : 3} strokeLinejoin="round" />
        </Svg>
    );
}

function Breath() {
    const o = useSharedValue(1);
    useEffect(() => { o.value = withRepeat(withTiming(0.3, { duration: 1200, easing: Easing.inOut(Easing.ease) }), -1, true); }, [o]);
    const st = useAnimatedStyle(() => ({ opacity: o.value }));
    return <Animated.View style={[s.breath, st]} />;
}

function Disc({ name }: { name: string }) {
    return (
        <View style={s.ring}>
            <View style={s.disc}><Text style={s.discText}>{initialsOf(name)}</Text></View>
        </View>
    );
}

function Tug({ share }: { share: number }) {
    return (
        <View style={s.tug}>
            <View style={[s.tugA, { flex: share }]} />
            <View style={s.tugMark} />
            <View style={[s.tugB, { flex: 1 - share }]} />
        </View>
    );
}

/** One line of a ranked table: rank (or crown), name with an optional tag and note, value. */
function TableRow({
    rank, name, tag, sub, value, me, divider,
}: {
    rank: React.ReactNode;
    name: string;
    tag?: string;
    sub?: string;
    value: string;
    me: boolean;
    divider: boolean;
}) {
    return (
        <View style={[s.tr, me && s.trMe]}>
            {me && <LinearGradient colors={YOU_TINT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />}
            {divider && <View style={s.hair} />}
            <View style={s.trRankCol}>{rank}</View>
            <View style={{ flex: 1, minWidth: 0 }}>
                <View style={s.trNameRow}>
                    <Text style={[s.trName, me && { fontWeight: '400' }]} numberOfLines={1}>{name}</Text>
                    {tag ? <Text style={s.trTag}>{tag}</Text> : null}
                </View>
                {sub ? <Text style={s.trSub}>{sub}</Text> : null}
            </View>
            <Text style={[s.trVal, me && { color: GOLD }]}>{value}</Text>
        </View>
    );
}

const rankText = (n: number, me: boolean) => <Text style={[s.trRank, me && { color: GOLD, fontWeight: '500' }]}>{n}</Text>;

/** My city: you're on a team. Cities ranked on average Series points per member. */
export function CityClash({
    tabs, city, forming = 0,
}: {
    tabs: TabGames;
    city: { name: string; rank: number; members: number } | null;
    /** Cities not ranked yet. */
    forming?: number;
}) {
    const sc = useSeasonCard();
    const rows = cityRanked(tabs);
    const i = rows.findIndex((r) => r.you);
    const me = i >= 0 ? rows[i] : null;
    const ahead = i === 0;
    const rv = me && rows.length > 1 ? rows[ahead ? 1 : i - 1] : null;
    const gap = me && rv ? Math.max(1, Math.abs(rv.avg - me.avg)) : 0;
    const hidden = Math.max(0, rows.length - 6);
    const more = [hidden ? `${hidden} more cities` : null, forming ? `${forming} forming` : null].filter(Boolean).join(' · ');
    return (
        <>
            <SectionLabel text="City clash" right="avg points per member" />
            {me && rv ? (
                <View style={[s.card, s.versus, sc]}>
                    <View style={s.vsRow}>
                        <View style={s.vsSide}>
                            <Text style={s.vsWho} numberOfLines={1}>{me.name} · {ordinal(i + 1)}</Text>
                            <Text style={[s.vsNum, { color: GOLD }]}>{fmt(me.avg)}</Text>
                        </View>
                        <View style={s.vsGap}>
                            <Text style={s.vsGapLabel}>{ahead ? 'LEAD' : 'GAP'}</Text>
                            <Text style={s.vsGapNum}>{fmt(gap)}</Text>
                            <Text style={s.vsGapSub}>per member</Text>
                        </View>
                        <View style={[s.vsSide, { alignItems: 'flex-end' }]}>
                            <Text style={s.vsWho} numberOfLines={1}>{rv.name} · {ordinal(ahead ? 2 : i)}</Text>
                            <Text style={s.vsNum}>{fmt(rv.avg)}</Text>
                        </View>
                    </View>
                    <Tug share={me.avg / Math.max(1, me.avg + rv.avg)} />
                    <Text style={s.body}>
                        {ahead
                            ? `${me.name} is the top city. Hold ${rv.name} off until the round closes.`
                            : `Pass ${rv.name} and ${me.name} ${i === 1 ? 'tops the round' : `moves up to ${ordinal(i)}`}. Every session logged in ${me.name} lifts the average.`}
                    </Text>
                </View>
            ) : city ? (
                <View style={[s.card, s.versus, sc]}>
                    <Text style={s.body}>{city.name} joins the table once more of its members are moving. Every session you log brings it closer.</Text>
                </View>
            ) : null}
            {city && (
                <Text style={s.yourPart}>
                    You’re <Text style={s.yourPartGold}>#{fmt(city.rank)}</Text> of {fmt(city.members)} in {city.name}. Every point you log counts for the city too.
                </Text>
            )}
            <SectionLabel text="The table" right={`${rows.length} cities`} />
            <View style={[s.card, s.table, sc]}>
                {rows.slice(0, 6).map((r, j) => (
                    <TableRow
                        key={r.name}
                        rank={rankText(j + 1, r.you)}
                        name={r.name}
                        tag={r.you ? 'YOUR CITY' : undefined}
                        sub={`${fmt(r.members)} members`}
                        value={fmt(r.avg)}
                        me={r.you}
                        divider={j > 0 && !r.you && !rows[j - 1].you}
                    />
                ))}
                {more ? <MoreLine text={more} /> : null}
            </View>
            <Text style={s.note}>Ranked per member, so a small city can beat a big one. When the round closes, 5 members of the top city win a Nutrition Reset.</Text>
        </>
    );
}

/** A game that isn't open yet: what opens it, who's on the way, and your part in it. */
export function LockedGame({
    title, lock, onAction,
}: {
    title: string;
    lock: GameLock;
    onAction: (action: NonNullable<GameLock['action']>) => void;
}) {
    const sc = useSeasonCard();
    const action = lock.action;
    return (
        <>
            <SectionLabel text={title} right="opening soon" />
            <View style={[s.card, s.lock, sc]}>
                <View style={s.lockHead}>
                    <View style={s.lockIcon}><Ionicons name="lock-closed" size={12} color={GOLD} /></View>
                    <Text style={s.lockRule}>{lock.rule}</Text>
                </View>
                {lock.items.length > 0 && (
                    <View>
                        {lock.items.map((it, j) => (
                            <View key={it.label} style={[s.lockItem, j > 0 && s.lockItemLine]}>
                                <View style={s.trNameRow}>
                                    <Text style={[s.lockName, it.you && { color: TEXT }]} numberOfLines={1}>{it.label}</Text>
                                    {it.you ? <Text style={s.trTag}>YOU</Text> : null}
                                </View>
                                {it.ready ? (
                                    <Text style={s.lockReady}>READY</Text>
                                ) : it.progress != null ? (
                                    <View style={s.lockBar}><View style={[s.lockFill, { width: `${Math.round(it.progress * 100)}%` }]} /></View>
                                ) : (
                                    <Text style={s.lockForming}>FORMING</Text>
                                )}
                            </View>
                        ))}
                    </View>
                )}
                {lock.more ? <Text style={s.lockMore}>{lock.more}</Text> : null}
                <Text style={s.body}>{lock.note}</Text>
                {action && (
                    <Pressable
                        style={({ pressed }) => [s.lockBtn, pressed && { opacity: 0.8 }]}
                        onPress={() => onAction(action)}
                        accessibilityRole="button"
                    >
                        <Ionicons name={action === 'invite' ? 'person-add-outline' : 'location-outline'} size={14} color="#0a0a0a" />
                        <Text style={s.lockBtnText}>{action === 'invite' ? 'INVITE A FRIEND' : 'SET YOUR GYM'}</Text>
                    </Pressable>
                )}
            </View>
        </>
    );
}

/**
 * No gym, so no city yet: pick the one you move in. It locks for the round, so
 * the pick takes two taps (choose, then confirm).
 */
export function CityPicker({ options, onPick }: { options: string[]; onPick: (city: string) => Promise<void> }) {
    const sc = useSeasonCard();
    const [chosen, setChosen] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const pick = async () => {
        if (!chosen || busy) return;
        setBusy(true);
        try { await onPick(chosen); } finally { setBusy(false); }
    };
    return (
        <>
            <SectionLabel text="Your city" right="locks for the round" />
            <View style={[s.card, s.lock, sc]}>
                <Text style={s.lockRule}>Which city do you move in?</Text>
                <View style={s.pickWrap}>
                    {options.slice(0, 9).map((c) => {
                        const on = c === chosen;
                        return (
                            <Pressable
                                key={c}
                                style={({ pressed }) => [s.pickChip, on && s.pickChipOn, pressed && { opacity: 0.7 }]}
                                onPress={() => { void Haptics.selectionAsync(); setChosen(on ? null : c); }}
                                accessibilityRole="button"
                                accessibilityState={{ selected: on }}
                            >
                                <Text style={[s.pickName, on && { color: '#0a0a0a', fontWeight: '600' }]}>{c}</Text>
                            </Pressable>
                        );
                    })}
                </View>
                {chosen ? (
                    <Pressable
                        style={({ pressed }) => [s.lockBtn, (pressed || busy) && { opacity: 0.8 }]}
                        onPress={() => { void pick(); }}
                        disabled={busy}
                        accessibilityRole="button"
                    >
                        <Text style={s.lockBtnText}>{`MOVE FOR ${chosen.toUpperCase()}`}</Text>
                    </Pressable>
                ) : null}
                <Text style={s.body}>Your points count for its team until the round ends. Set your gym on POWR and it picks for you.</Text>
            </View>
        </>
    );
}

/** My gym: the crown. King of the hill on sessions verified at your gym, rolling 7 days. */
export function GymCrown({ tabs, youLabel, sessionPts }: { tabs: TabGames; youLabel: string; sessionPts: number }) {
    const sc = useSeasonCard();
    const scFill = useSeasonCard(true);
    const g = tabs.gym;
    const c = courtRanked(tabs);
    const king = c[0];
    const i = c.findIndex((r) => r.you);
    const me = i >= 0 ? c[i] : null;
    const mine = !!me && king === me;
    const behind = me ? king.pts - me.pts : king?.pts ?? 0;
    const n = Math.max(1, Math.ceil((behind + 1) / Math.max(1, sessionPts)));
    const where = g.area ? `${g.name} · ${g.area}` : g.name;
    if (!king) {
        return (
            <>
                <SectionLabel text="The crown" right={where} />
                <View style={[s.crown, scFill]}>
                    <Crown size={44} />
                    <Text style={s.crownEyebrow}>THE CROWN IS FREE</Text>
                    <Text style={s.crownSub}>Nobody has checked in at {g.name} this week. One session takes it.</Text>
                </View>
            </>
        );
    }
    return (
        <>
            <SectionLabel text="The crown" right={where} />
            <View style={[s.crown, scFill, mine && { borderColor: 'rgba(232,210,0,0.5)' }]}>
                <LinearGradient colors={['rgba(232,210,0,0.10)', 'rgba(232,210,0,0)']} style={[StyleSheet.absoluteFill, { bottom: '45%' }]} />
                <Crown size={44} />
                <Text style={s.crownEyebrow}>{mine ? 'YOU HOLD THE CROWN' : 'HOLDS THE CROWN'}</Text>
                <Text style={s.crownName} numberOfLines={1}>{mine ? youLabel : king.name}</Text>
                <Text style={s.crownSub}>
                    {fmt(king.pts)} pts at {g.name} this week{g.held == null ? '' : ` · ${g.held ? `held ${g.held} day${g.held > 1 ? 's' : ''}` : 'taken just now'}`}
                </Text>
                <View style={s.crownYou}>
                    {mine && c[1] ? (
                        <Text style={s.crownYouText}>
                            <Text style={s.gold}>{fmt(king.pts - c[1].pts)} pts</Text> clear of {c[1].name}. They can take it back any day.
                        </Text>
                    ) : mine ? (
                        <Text style={s.crownYouText}>Nobody else has checked in at {g.name} this week. Yet.</Text>
                    ) : me ? (
                        <Text style={s.crownYouText}>
                            You’re {ordinal(i + 1)} here · <Text style={s.gold}>{fmt(behind)} pts</Text> behind the crown{'\n'}
                            About {n} gym session{n > 1 ? 's' : ''} at {g.name} takes it
                        </Text>
                    ) : (
                        <Text style={s.crownYouText}>
                            You haven’t checked in at {g.name} this week{'\n'}
                            About {n} gym session{n > 1 ? 's' : ''} takes the crown
                        </Text>
                    )}
                </View>
            </View>
            {g.inNow != null && (
                <View style={s.inNow}>
                    <Breath />
                    <Text style={s.inNowText}>
                        <Text style={s.inNowStrong}>{g.inNow} in now</Text>{g.friendIn ? ` · including ${firstName(g.friendIn)}, a friend` : ''}
                    </Text>
                </View>
            )}
            <SectionLabel text="The court" right={`this week at ${g.name}`} />
            <View style={[s.card, s.table, sc]}>
                {c.slice(0, 5).map((r, j) => (
                    <TableRow
                        key={r.name}
                        rank={j === 0 ? <Crown size={16} /> : rankText(j + 1, r.you)}
                        name={r.you ? youLabel : r.name}
                        value={fmt(r.pts)}
                        me={r.you}
                        divider={j > 0 && !r.you && !c[j - 1].you}
                    />
                ))}
            </View>
            <Text style={s.note}>Only sessions verified at {g.name} count, over a rolling 7 days, so the crown can change hands any day.</Text>
        </>
    );
}

function DuelRow({ d, you, first }: { d: Duel; you: number; first: boolean }) {
    const lead = you - d.them;
    const share = you / Math.max(1, you + d.them);
    const rec = d.w + d.l
        ? `${d.w}–${d.l} ${d.w > d.l ? 'to you' : d.w < d.l ? `to ${firstName(d.name)}` : 'all square'}`
        : 'first duel';
    return (
        <View style={s.duel}>
            {!first && <View style={[s.hair, { left: 66 }]} />}
            <Disc name={d.name} />
            <View style={s.duelMid}>
                <View style={s.duelNameRow}>
                    <Text style={s.duelVs} numberOfLines={1}>vs {d.name}</Text>
                    <Text style={s.duelRec}>{rec}</Text>
                </View>
                <View style={s.dbar}>
                    <View style={[s.dbarA, { flex: share }]} />
                    <View style={[s.dbarB, { flex: 1 - share }]} />
                </View>
            </View>
            <View style={s.duelGap}>
                <Text style={[s.duelGapNum, lead >= 0 && { color: GOLD }]}>{lead >= 0 ? '+' : '−'}{fmt(Math.abs(lead))}</Text>
                <Text style={s.duelGapLabel}>{lead >= 0 ? 'AHEAD' : 'BEHIND'}</Text>
            </View>
        </View>
    );
}

/** Friends: duels. You vs one friend on this week's points; everyone starts level on Monday. */
export function Duels({
    tabs, onAccept, onChallenge, onInvite,
}: {
    tabs: TabGames;
    onAccept: () => void;
    onChallenge: (id: string) => void;
    onInvite: () => void;
}) {
    const sc = useSeasonCard();
    const scFill = useSeasonCard(true);
    const D = tabs.duel;
    const winning = D.active.filter((d) => D.you >= d.them).length;
    const none = D.active.length === 0 && !D.invite && D.open.length === 0;
    return (
        <>
            {(D.active.length > 0 || none) && (
                <SectionLabel text="Duels" right={D.active.length ? `winning ${winning} of ${D.active.length} · ends ${D.ends}` : `ends ${D.ends}`} />
            )}
            {D.active.length > 0 && (
                <View style={[s.card, { paddingVertical: 2 }, sc]}>
                    {D.active.map((d, j) => <DuelRow key={d.id} d={d} you={D.you} first={j === 0} />)}
                </View>
            )}
            {none && (
                <View style={[s.card, s.versus, sc]}>
                    <Text style={s.body}>Duels are you against one friend on this week’s points. Add friends on POWR and they’ll show up here to challenge.</Text>
                    <Pressable style={({ pressed }) => [s.lockBtn, pressed && { opacity: 0.8 }]} onPress={onInvite} accessibilityRole="button">
                        <Ionicons name="person-add-outline" size={14} color="#0a0a0a" />
                        <Text style={s.lockBtnText}>INVITE A FRIEND</Text>
                    </Pressable>
                </View>
            )}
            {D.invite && (
                <View style={[s.invite, scFill]}>
                    <Disc name={D.invite.name} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.inviteText} numberOfLines={1}><Text style={s.inviteStrong}>{D.invite.name}</Text> challenged you</Text>
                        <Text style={s.inviteSub}>7 days on this week’s points</Text>
                    </View>
                    <Pressable style={({ pressed }) => [s.accept, pressed && { opacity: 0.8 }]} onPress={onAccept} accessibilityRole="button">
                        <Text style={s.acceptText}>ACCEPT</Text>
                    </Pressable>
                </View>
            )}
            {D.open.length > 0 && (
                <>
                    <SectionLabel text="Start a duel" right={D.active.length ? undefined : `ends ${D.ends}`} />
                    {/* Two even columns, so the friends line up however long their names are. */}
                    <View style={s.grid}>
                        {Array.from({ length: Math.ceil(D.open.length / 2) }, (_, r) => D.open.slice(r * 2, r * 2 + 2)).map((pair) => (
                            <View key={pair[0].id} style={s.gridRow}>
                                {pair.map(({ id, name: n }) => {
                                    const sent = D.sent.includes(id);
                                    return (
                                        <Pressable
                                            key={id}
                                            style={({ pressed }) => [s.chip, sc, sent && { opacity: 0.55 }, pressed && { opacity: 0.7 }]}
                                            onPress={() => onChallenge(id)}
                                            disabled={sent}
                                            accessibilityRole="button"
                                            accessibilityLabel={sent ? `Challenge sent to ${n}` : `Challenge ${n} to a duel`}
                                        >
                                            <View style={s.chipDisc}><Text style={s.chipInit}>{initialsOf(n)}</Text></View>
                                            <Text style={s.chipName} numberOfLines={1}>{firstName(n)}</Text>
                                            <Text style={[s.chipEm, sent && { color: TEXT_2 }]}>{sent ? 'SENT' : 'DUEL'}</Text>
                                        </Pressable>
                                    );
                                })}
                                {pair.length === 1 && <View style={s.gridGap} />}
                            </View>
                        ))}
                    </View>
                </>
            )}
            <Text style={s.note}>You vs one friend on this week’s points. Everyone starts at zero on Monday, so anyone can win.</Text>
        </>
    );
}

const s = StyleSheet.create({
    tabs: { marginHorizontal: 16, marginTop: 6, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIR },
    tab: { flex: 1, paddingTop: 14, paddingBottom: 13, alignItems: 'center' },
    tabLabel: { fontSize: 10, fontWeight: '500', letterSpacing: 1.5, color: TEXT_3, textTransform: 'uppercase' },
    tabLabelOn: { color: TEXT },
    tabInner: { flexDirection: 'row', alignItems: 'center' },
    tabLock: { marginLeft: 4 },
    ping: { position: 'absolute', right: -9, top: 0, width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD },
    ind: { position: 'absolute', left: 0, bottom: -1, height: 2, alignItems: 'center' },
    indBar: { width: 24, height: 2, borderRadius: 1, backgroundColor: GOLD },

    card: { marginHorizontal: 16, borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, overflow: 'hidden' },
    hair: { position: 'absolute', left: 58, right: 16, top: 0, height: StyleSheet.hairlineWidth, backgroundColor: HAIR },
    note: { paddingHorizontal: 24, marginTop: 2, fontSize: 10, lineHeight: 16, color: TEXT_3, textAlign: 'center' },
    gold: { color: GOLD, fontWeight: '600' },
    body: { fontSize: 12, fontWeight: '300', lineHeight: 18, color: TEXT_2 },

    versus: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 16, gap: 14 },
    vsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    vsSide: { flex: 1, minWidth: 0 },
    vsWho: { fontSize: 11, fontWeight: '400', color: TEXT_3, marginBottom: 2 },
    vsNum: { fontSize: 30, fontWeight: '100', letterSpacing: -1.2, color: TEXT, fontVariant: ['tabular-nums'] },
    vsGap: { alignItems: 'center', gap: 1 },
    vsGapLabel: { fontSize: 9, fontWeight: '500', letterSpacing: 2.2, color: TEXT_3 },
    vsGapNum: { fontSize: 18, fontWeight: '400', color: GOLD, fontVariant: ['tabular-nums'] },
    vsGapSub: { fontSize: 11, fontWeight: '300', color: TEXT_3 },
    tug: { flexDirection: 'row', alignItems: 'center', height: 10 },
    tugA: { height: 3, borderRadius: 2, backgroundColor: GOLD },
    tugB: { height: 3, borderRadius: 2, backgroundColor: 'rgba(242,242,242,0.45)' },
    tugMark: { width: 2, height: 10, borderRadius: 1, backgroundColor: '#fff', marginHorizontal: 2 },
    yourPart: { marginHorizontal: 20, marginTop: 2, fontSize: 12, fontWeight: '300', lineHeight: 18, color: TEXT_3 },
    yourPartGold: { color: GOLD, fontWeight: '500' },

    table: { paddingVertical: 6 },
    tr: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
    trMe: { marginHorizontal: 6, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: YOU_LINE, overflow: 'hidden' },
    trRankCol: { width: 30, alignItems: 'center' },
    trRank: { fontSize: 15, fontWeight: '300', color: TEXT_3, fontVariant: ['tabular-nums'] },
    trNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
    trName: { flexShrink: 1, fontSize: 14, fontWeight: '300', color: TEXT },
    trTag: { fontSize: 8, fontWeight: '700', letterSpacing: 1.8, color: GOLD },
    trSub: { marginTop: 2, fontSize: 11, fontWeight: '300', color: TEXT_3 },
    trVal: { fontSize: 15, fontWeight: '300', color: TEXT_2, fontVariant: ['tabular-nums'] },

    crown: {
        marginHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(232,210,0,0.22)', backgroundColor: CARD_BG, overflow: 'hidden',
        paddingTop: 26, paddingHorizontal: 20, paddingBottom: 18, alignItems: 'center', gap: 6,
    },
    crownEyebrow: { marginTop: 6, fontSize: 9, fontWeight: '700', letterSpacing: 2.4, color: GOLD },
    crownName: { fontSize: 28, fontWeight: '200', letterSpacing: -0.5, color: TEXT },
    crownSub: { fontSize: 12, fontWeight: '300', lineHeight: 17, color: TEXT_3, textAlign: 'center' },
    crownYou: { alignSelf: 'stretch', marginTop: 8, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR },
    crownYouText: { fontSize: 12, fontWeight: '300', lineHeight: 18, color: TEXT_2, textAlign: 'center' },
    inNow: { marginHorizontal: 20, marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 8 },
    breath: { width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN },
    inNowText: { fontSize: 12, fontWeight: '300', color: TEXT_2 },
    inNowStrong: { color: TEXT, fontWeight: '500' },

    ring: { width: 36, height: 36, borderRadius: 18, padding: 2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
    disc: { flex: 1, borderRadius: 16, backgroundColor: AVATAR_BG, alignItems: 'center', justifyContent: 'center' },
    discText: { fontSize: 12, fontWeight: '500', color: TEXT_2 },
    duel: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
    duelMid: { flex: 1, minWidth: 0, gap: 9 },
    duelNameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, minWidth: 0 },
    duelVs: { flexShrink: 1, fontSize: 14, fontWeight: '300', color: TEXT },
    duelRec: { fontSize: 11, fontWeight: '300', color: TEXT_3 },
    dbar: { flexDirection: 'row', gap: 2, height: 3 },
    dbarA: { borderRadius: 2, backgroundColor: GOLD },
    dbarB: { borderRadius: 2, backgroundColor: 'rgba(242,242,242,0.3)' },
    duelGap: { alignItems: 'flex-end', minWidth: 54 },
    duelGapNum: { fontSize: 18, fontWeight: '200', letterSpacing: -0.4, color: TEXT_2, fontVariant: ['tabular-nums'] },
    duelGapLabel: { fontSize: 8, fontWeight: '700', letterSpacing: 1.8, color: TEXT_3 },

    invite: {
        marginHorizontal: 16, marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14,
        borderRadius: 18, borderWidth: 1, borderColor: 'rgba(232,210,0,0.28)', backgroundColor: CARD_BG,
    },
    inviteText: { fontSize: 13, fontWeight: '300', color: TEXT },
    inviteStrong: { fontWeight: '500' },
    inviteSub: { marginTop: 1, fontSize: 11, fontWeight: '300', color: TEXT_3 },
    accept: { height: 34, paddingHorizontal: 16, borderRadius: 17, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
    acceptText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: '#0a0a0a' },
    grid: { paddingHorizontal: 16, gap: 8 },
    gridRow: { flexDirection: 'row', gap: 8 },
    // Same padding and border as a cell: flex counts them on top of the even share.
    gridGap: { flex: 1, flexBasis: 0, paddingLeft: 6, paddingRight: 14, borderWidth: 1, borderColor: 'transparent' },
    chip: {
        flex: 1, flexBasis: 0, minWidth: 0, height: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 6, paddingRight: 14,
        borderRadius: 16, borderWidth: 1, borderColor: CARD_BORDER, backgroundColor: CARD_BG,
    },
    chipDisc: { width: 32, height: 32, borderRadius: 16, backgroundColor: AVATAR_BG, alignItems: 'center', justifyContent: 'center' },
    chipInit: { fontSize: 10, fontWeight: '500', color: TEXT_2 },
    chipName: { flex: 1, fontSize: 13, color: TEXT },
    chipEm: { fontSize: 9, fontWeight: '700', letterSpacing: 1.4, color: GOLD },

    lock: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 16, gap: 14 },
    lockHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    lockIcon: {
        width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: 'rgba(232,210,0,0.35)',
    },
    lockRule: { flex: 1, fontSize: 14, fontWeight: '300', lineHeight: 20, color: TEXT },
    lockItem: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    lockItemLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR },
    lockName: { flexShrink: 1, fontSize: 13, fontWeight: '300', color: TEXT_2 },
    lockReady: { fontSize: 9, fontWeight: '700', letterSpacing: 1.8, color: GOLD },
    lockForming: { fontSize: 9, fontWeight: '600', letterSpacing: 1.8, color: TEXT_3 },
    lockBar: { width: 96, height: 3, borderRadius: 2, backgroundColor: 'rgba(242,242,242,0.15)', overflow: 'hidden' },
    lockFill: { height: 3, borderRadius: 2, backgroundColor: GOLD },
    lockMore: { marginTop: -6, fontSize: 11, fontWeight: '300', color: TEXT_3 },
    lockBtn: {
        height: 40, borderRadius: 20, backgroundColor: GOLD, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    },
    lockBtnText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: '#0a0a0a' },
    pickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pickChip: { height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: CARD_BORDER, justifyContent: 'center' },
    pickChipOn: { backgroundColor: GOLD, borderColor: GOLD },
    pickName: { fontSize: 12, color: TEXT },
});
