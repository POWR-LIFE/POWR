import * as Haptics from 'expo-haptics';
import { useEffect, useSyncExternalStore } from 'react';

import { getDropState, seriesDoubleLeft, useDropPrototype } from '@/lib/dev/dropPrototype';
import {
    type ActKey,
    ACTS,
    BLIND_HIDES,
    cityRanked,
    type CityRow,
    courtRanked,
    type CourtRow,
    createModel,
    createTabs,
    drawDays,
    type Duel,
    type DuelResult,
    firstName,
    fmt,
    GOLDEN_FINDERS,
    GOLDEN_MINUTES,
    isDark,
    known,
    lastWeekDuels,
    type LensKey,
    type Model,
    multOf,
    ordinal,
    type Person,
    pickAct,
    rebalance,
    rivalOf,
    type RaceView,
    sampleInviteBoard,
    sampleRace,
    type Row,
    type Scale,
    type SeriesState,
    sortBoard,
    STATE_INFO,
    type TabGames,
    type TitleKey,
    TITLES,
    titlesFor,
    visibleRows,
    youOf,
} from '@/lib/dev/seriesPrototype';

/** A session that just landed on a lane: drives the green "+N" and the row flash. */
export type Hit = { key: number; pts: number; old: number; x2: boolean };
export type Toast = { key: number; text: string; tone: 'gold' | 'ember' };
export type RecapLine = { icon: string; text: string; tone: 'green' | 'red' | 'gold' | 'muted' };
type LaneRow = Extract<Row, { type: 'lane' }>;

/**
 * DEV ONLY. The sample Series, shared by every screen that shows it (League's
 * tab, Home's rival card), so a session that lands moves both. In-memory like
 * the Drop and Pitch prototypes; a session lands every second or two while any
 * of those screens is in view.
 *
 * The race always runs on the Overall board. The League tab's other three
 * tabs are their own games (City clash, The crown, Duels) and tick alongside.
 */
const model0 = createModel('pitch');
const S = {
    scale: 'pitch' as Scale,
    state: 'day3' as SeriesState,
    /** Which game the League tab shows. */
    tab: 'overall' as LensKey,
    /** The race: the five around you on the big board, or its top. */
    view: 'around' as RaceView,
    paused: false,
    /** A round is running. Off = the off-season: Home falls back to Beat Me. */
    inRound: true,
    /** With no round running, which side of one Home shows: starts soon, or just ended. */
    offPhase: 'soon' as 'soon' | 'ended',
    /** Before the round: your friends in (worked out) and joining (signed up, not yet moved). */
    invite: { friends: 1, joining: 1 },
    model: model0 as Model,
    tabs: createTabs(model0, 'pitch') as TabGames,
    /** A gold dot on a tab when something happened there while you were elsewhere. */
    pings: {} as Partial<Record<LensKey, boolean>>,
    hits: {} as Record<string, Hit>,
    toast: null as Toast | null,
    ...loopStart(),
};

/** The daily loop's state at the start of the sample (morning 0). */
function loopStart() {
    const won = titlesFor(0).filter((x) => x.you).map((x) => x.key);
    return {
        /** Which sample morning it is: NEW DAY steps it. */
        morning: 0,
        tickets: won.length,
        ticketLog: won.map((k) => TITLES[k].label) as string[],
        titlesWon: won as TitleKey[],
        recapOpen: true,
        results: null as DuelResult[] | null,
        rematched: [] as string[],
        /** The Golden P: hidden → showing (somewhere in the app) → found → accepted. */
        golden: 'hidden' as 'hidden' | 'showing' | 'found' | 'accepted',
        /** Active minutes on the clock when you took its challenge. */
        goldenStartMin: 0,
    };
}
let version = 0;
let seq = 0;
let watchers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
    version += 1;
    listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => { listeners.delete(l); };
};

const race = () => S.model.boards.overall;

function markHit(id: string, hit: Hit, ms: number) {
    S.hits = { ...S.hits, [id]: hit };
    setTimeout(() => {
        if (S.hits[id]?.key !== hit.key) return;
        const next = { ...S.hits };
        delete next[id];
        S.hits = next;
        emit();
    }, ms);
}

// Background movement never interrupts the screen: a crown changing hands, a
// city moving, your climb. The numbers, the rows and the tab dots show it. A
// line only appears for something you just set off (a tap, a dev moment).
let tapUntil = 0;
const fromTap = (ms = 3500) => { tapUntil = Date.now() + ms; };
const tapped = () => Date.now() < tapUntil;

function showToast(text: string, tone: Toast['tone'] = 'gold') {
    const key = ++seq;
    S.toast = { key, text, tone };
    emit();
    setTimeout(() => { if (S.toast?.key === key) { S.toast = null; emit(); } }, 2600);
}

/** The same person on every board (you are `you` on all four): one person, one score. */
function twins(p: Person): Person[] {
    const out: Person[] = [];
    Object.values(S.model.boards).forEach((b) => b.segs.forEach((sg) => sg.people.forEach((x) => {
        if (p.you ? x.you : !x.you && x.name === p.name) out.push(x);
    })));
    return out;
}

// ── The three tab games ─────────────────────────────────────

function ping(tab: LensKey) {
    if (S.tab !== tab) S.pings = { ...S.pings, [tab]: true };
}

function cityCheck(before: CityRow[]) {
    const london = S.tabs.city.find((r) => r.you)!;
    const rows = cityRanked(S.tabs);
    const i = rows.indexOf(london);
    const was = before.indexOf(london);
    if (i === was) return;
    if (S.tab !== 'city') { ping('city'); return; }
    if (tapped()) showToast(i < was ? `LONDON PASSED ${before[i].name.toUpperCase()} · NOW ${ordinal(i + 1).toUpperCase()}` : `${rows[i - 1].name.toUpperCase()} PASSED LONDON`);
}

function gymCheck(kingBefore: CourtRow) {
    const king = courtRanked(S.tabs)[0];
    if (king === kingBefore) return;
    S.tabs.gym.held = 0;
    if (king.you) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (S.tab !== 'gym') { ping('gym'); return; }
    if (tapped()) showToast(king.you ? `YOU TOOK THE CROWN AT ${S.tabs.gym.name.toUpperCase()}` : `THE CROWN CHANGED HANDS · ${king.name.toUpperCase()}`);
}

function duelCheck(d: Duel, was: number) {
    const is = S.tabs.duel.you - d.them;
    if ((was >= 0) === (is >= 0)) return;
    if (S.tab !== 'friends') { ping('friends'); return; }
    const who = firstName(d.name).toUpperCase();
    if (tapped()) showToast(is >= 0 ? `YOU’RE BACK IN FRONT OF ${who}` : `${who} TOOK THE LEAD · ${fmt(-is)} IN IT`);
}

/** Everyone else's movement in the three games: city averages drift, the court and duels move. */
function tabTick() {
    const T = S.tabs;
    const { k, rnd } = S.model;
    const before = cityRanked(T);
    T.city.forEach((c) => { c.avg += (0.2 + rnd() * (c.you ? 1.9 : 1.6)) * k; });
    cityCheck(before);
    const king = courtRanked(T)[0];
    const g = rnd();
    if (g < 0.2 && T.gym.inNow != null) T.gym.inNow = Math.min(12, Math.max(2, T.gym.inNow + (rnd() < 0.5 ? -1 : 1)));
    else if (g < 0.45) {
        const others = T.gym.court.filter((x) => !x.you);
        others[Math.floor(rnd() * others.length)].pts += Math.round((120 + rnd() * 140) * k);
    }
    gymCheck(king);
    if (rnd() < 0.5) {
        const d = T.duel.active[Math.floor(rnd() * T.duel.active.length)];
        const was = T.duel.you - d.them;
        d.them += Math.round((60 + rnd() * 120) * k);
        duelCheck(d, was);
    }
}

/** Your session counts in your duels, and at your gym when it was a gym session. */
function onYou(act: ActKey, pts: number) {
    const T = S.tabs;
    const king = courtRanked(T)[0];
    const was = T.duel.active.map((d) => T.duel.you - d.them);
    T.duel.you += pts;
    T.duel.active.forEach((d, i) => duelCheck(d, was[i]));
    if (act === 'gym') {
        T.gym.court.find((x) => x.you)!.pts += pts;
        gymCheck(king);
    }
}

// ── The race ────────────────────────────────────────────────

function land(p: Person, o: { act?: ActKey; min?: number; pts?: number } = {}) {
    const m0 = S.model;
    const b = race();
    const st = S.state;
    const before = known(b);
    const meBefore = before.find((k) => k.p.you)!.rank;
    const rankBefore = before.find((k) => k.p === p)?.rank ?? 0;
    const act = o.act ?? pickAct(m0, p);
    const A = ACTS[act];
    const min = o.min ?? Math.round(A.min[0] + m0.rnd() * (A.min[1] - A.min[0]));
    // Your Drop's 2× Series points, for an hour after you open it: on top of
    // what you hold, still capped at ×2.
    const dropDouble = p.you && seriesDoubleLeft(getDropState()) > 0;
    const m = Math.min(2, multOf(p, rankBefore, st, act) * (dropDouble ? 2 : 1));
    const pts = o.pts ?? Math.max(1, Math.round(min * A.ppm * m0.k * m));
    const tw = twins(p).map((x) => ({ x, old: x.pts }));
    tw.forEach(({ x }) => { x.pts += pts; x.today += pts; x.totalEarned += pts; });
    Object.values(m0.boards).forEach((bb) => { sortBoard(bb); rebalance(m0, bb); });
    m0.hour += 1;
    const after = known(b);
    const meAfter = after.find((k) => k.p.you)!.rank;
    // A big session can carry someone out of the window held around you.
    const rankAfter = after.find((k) => k.p === p)?.rank ?? rankBefore;
    const sealed = isDark(st, rankAfter, p);
    const key = ++seq;
    if (!sealed) tw.forEach(({ x, old }) => markHit(x.id, { key, pts, old, x2: m >= 2 }, 1800));
    if (p.you) {
        void Haptics.selectionAsync();
        onYou(act, pts);
        if (dropDouble && tapped()) showToast(`DROP 2× · +${fmt(pts)} ON YOUR ${ACTS[act].label.toUpperCase()}`);
    }
    if (p.you && meAfter < meBefore) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Said on the race only: on another tab it would name a board you can't see.
        if (S.tab === 'overall' && tapped()) {
            const passed = after.find((k) => k.rank === meAfter + 1);
            const n = meBefore - meAfter;
            showToast(`+${n} PLACE${n > 1 ? 'S' : ''} · YOU PASSED ${(passed?.p.name ?? '').toUpperCase()}`);
        }
    }
    emit();
}

function tick() {
    tabTick();
    const m0 = S.model;
    const b = race();
    const me = youOf(b);
    // On your gym's tab you're often the one training there.
    if (S.tab === 'gym' && m0.rnd() < 0.15) { land(me.p, { act: 'gym' }); return; }
    const rows = visibleRows(b, S.state).filter((r): r is LaneRow => r.type === 'lane');
    const all = known(b);
    const front = rows.filter((x) => !x.p.you && (x.rank <= 5 || x.dark));
    const pack = rows.filter((x) => !x.p.you && !front.includes(x));
    const pickFrom = <T,>(xs: T[]) => xs[Math.floor(m0.rnd() * xs.length)];
    const r = m0.rnd();
    let p: Person;
    if (r < 0.2) p = me.p;
    else if (r < 0.55 && front.length) p = pickFrom(front).p;
    else if (r < 0.85 && pack.length) p = pickFrom(pack).p;
    else p = pickFrom(all.filter((k) => !k.p.you)).p;
    land(p);
}

/** Runs while any Series screen is in view and the board isn't paused. */
function schedule() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (watchers <= 0 || S.paused) return;
    const fast = S.state === 'powerHour' || S.state === 'eventNight';
    const gap = fast ? 800 + Math.random() * 500 : 1500 + Math.random() * 900;
    timer = setTimeout(() => {
        timer = null;
        try { tick(); } finally { schedule(); }
    }, gap);
}

/** "While you were away": what changed since you last looked (sample: since midnight). */
function recapFor(): RecapLine[] {
    const b = race();
    const all = known(b);
    const me = youOf(b);
    const above = all.find((k) => k.rank === me.rank - 1);
    const below = all.find((k) => k.rank === me.rank + 1);
    const move = me.p.mid - me.rank;
    const lines: RecapLine[] = [];
    const blind = S.state === 'blind';
    // Blind Mode: the band already says it, and places are what it hides.
    if (blind) { /* no place lines */ } else if (move > 0) lines.push({ icon: 'caret-up', tone: 'green', text: `Up ${move} place${move > 1 ? 's' : ''} overnight · you’re #${fmt(me.rank)}` });
    else if (move < 0) lines.push({ icon: 'caret-down', tone: 'red', text: `Down ${-move} place${move < -1 ? 's' : ''} overnight · you’re #${fmt(me.rank)}` });
    titlesFor(S.morning).filter((x) => x.you && !(blind && BLIND_HIDES.includes(x.key))).forEach((x) => {
        lines.push({ icon: TITLES[x.key].icon, tone: 'gold', text: `You’re today’s ${TITLES[x.key].label.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())} · +1 Draw ticket` });
    });
    if (below && !blind) lines.push({ icon: 'trending-up-outline', tone: 'muted', text: `You passed ${below.p.name}` });
    if (above && !blind) lines.push({ icon: 'locate-outline', tone: 'muted', text: `${above.p.name} is ${fmt(above.p.pts - me.p.pts)} pts ahead` });
    const lead = S.tabs.duel.active.map((d) => ({ d, gap: S.tabs.duel.you - d.them })).sort((x, y) => y.gap - x.gap)[0];
    if (lead && lead.gap > 0) lines.push({ icon: 'people-outline', tone: 'muted', text: `You lead ${firstName(lead.d.name)} by ${fmt(lead.gap)} in your duel` });
    return lines.slice(0, 4);
}

/** Home's one-line Pulse: the recap's facts, short. Always there while a round runs. */
function pulseFor(): RecapLine[] {
    const b = race();
    const all = known(b);
    const me = youOf(b);
    const above = all.find((k) => k.rank === me.rank - 1);
    const below = all.find((k) => k.rank === me.rank + 1);
    const move = me.p.mid - me.rank;
    const bits: RecapLine[] = [];
    if (S.state === 'blind') bits.push({ icon: 'eye-off-outline', tone: 'muted', text: 'Blind Mode · ranks back Thu' });
    else if (move > 0) bits.push({ icon: 'caret-up', tone: 'green', text: `${fmt(move)} overnight` });
    else if (move < 0) bits.push({ icon: 'caret-down', tone: 'red', text: `${fmt(-move)} overnight` });
    titlesFor(S.morning).filter((x) => x.you && !(S.state === 'blind' && BLIND_HIDES.includes(x.key))).slice(0, 1).forEach((x) => {
        bits.push({ icon: TITLES[x.key].icon, tone: 'gold', text: `today’s ${TITLES[x.key].label.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())}` });
    });
    if (S.state !== 'blind') {
        if (below && bits.length < 2) bits.push({ icon: 'trending-up-outline', tone: 'muted', text: `you passed ${firstName(below.p.name)}` });
        if (above && bits.length < 2) bits.push({ icon: 'locate-outline', tone: 'muted', text: `${firstName(above.p.name)} ${fmt(above.p.pts - me.p.pts)} ahead` });
    }
    return bits;
}

export const seriesSim = {
    setView(v: RaceView) {
        S.view = v;
        emit();
    },
    setTab(t: LensKey) {
        S.tab = t;
        if (S.pings[t]) {
            const next = { ...S.pings };
            delete next[t];
            S.pings = next;
        }
        emit();
    },
    setState(s: SeriesState) {
        S.state = s;
        S.hits = {};
        emit();
        schedule();
    },
    setScale(sc: Scale) {
        S.model = createModel(sc);
        S.tabs = createTabs(S.model, sc);
        S.scale = sc;
        S.hits = {};
        S.pings = {};
        Object.assign(S, loopStart());
        emit();
    },
    dismissRecap() {
        S.recapOpen = false;
        emit();
    },
    /** The next sample morning: new titles and a new recap (the Drop has its own NEW DAY). */
    newDay() {
        S.morning += 1;
        S.recapOpen = true;
        S.results = null;
        S.rematched = [];
        const won = titlesFor(S.morning).filter((x) => x.you).map((x) => x.key);
        S.tickets += won.length;
        S.ticketLog = [...S.ticketLog, ...won.map((k) => TITLES[k].label)];
        S.titlesWon = [...S.titlesWon, ...won].filter((k, i, a) => a.indexOf(k) === i);
        // Overnight: the board moved; the "since midnight" arrows start again.
        Object.values(S.model.boards).forEach((bb) => bb.segs.forEach((sg) => sg.people.forEach((x, i) => {
            x.mid = sg.base + i + Math.round((S.model.rnd() - 0.4) * 6);
            x.today = x.you ? 0 : Math.round(S.model.rnd() * 60);
        })));
        S.tab = 'overall';
        emit();
    },
    /** Six people pass you: what "X passed you" is for. */
    slip() {
        if (S.tab !== 'overall') seriesSim.setTab('overall');
        const b = race();
        const me = youOf(b);
        const behind = known(b).filter((k) => k.rank > me.rank).slice(0, 6);
        behind.forEach((k, i) => twins(k.p).forEach((x) => { x.pts = me.p.pts + 3 + (6 - i) * 2; x.today += 40; }));
        Object.values(S.model.boards).forEach((bb) => { sortBoard(bb); rebalance(S.model, bb); });
        emit();
    },
    /** The Golden P turns up somewhere in the app, unannounced. */
    showGoldenP() {
        if (S.golden !== 'hidden') { showToast('IT’S ALREADY OUT · RESET TO REPLAY'); return; }
        S.golden = 'showing';
        S.tab = 'overall';
        emit();
    },
    findGoldenP() {
        if (S.golden !== 'showing') return;
        S.golden = 'found';
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        emit();
    },
    acceptGolden() {
        S.golden = 'accepted';
        S.goldenStartMin = getDropState().minutes;
        showToast(`CHALLENGE ON · ${GOLDEN_MINUTES} ACTIVE MIN BEFORE MIDNIGHT`);
    },
    /** Monday: last week's duels are in. Each one you won is a Draw ticket. */
    mondayResults() {
        S.results = lastWeekDuels(S.model.k);
        S.rematched = [];
        const wins = S.results.filter((r) => r.you > r.them);
        S.tickets += wins.length;
        S.ticketLog = [...S.ticketLog, ...wins.map((r) => `BEAT ${firstName(r.name).toUpperCase()}`)];
        S.tab = 'friends';
        emit();
    },
    rematch(id: string) {
        if (S.rematched.includes(id)) return;
        S.rematched = [...S.rematched, id];
        void Haptics.selectionAsync();
        const name = S.results?.find((r) => r.id === id)?.name ?? id;
        showToast(`REMATCH SENT TO ${firstName(name).toUpperCase()}`);
    },
    setPaused(v: boolean) {
        S.paused = v;
        emit();
        schedule();
    },
    setInRound(v: boolean) {
        S.inRound = v;
        emit();
    },
    /** Dev: before the round (the invite board) or just after one. */
    setOffPhase(p: 'soon' | 'ended') {
        S.inRound = false;
        S.offPhase = p;
        emit();
    },
    /** A friend signs up with your code: joining, not counted yet. */
    friendJoins() {
        S.invite = { ...S.invite, joining: S.invite.joining + 1 };
        showToast('A FRIEND JOINED WITH YOUR CODE · COUNTS AFTER THEIR FIRST WORKOUT');
    },
    /** A joining friend logs their first workout: now they count. */
    friendWorksOut() {
        if (S.invite.joining === 0) { showToast('NOBODY JOINING · A FRIEND HAS TO SIGN UP FIRST'); return; }
        S.invite = { friends: S.invite.friends + 1, joining: S.invite.joining - 1 };
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast('YOUR FRIEND WORKED OUT · THEY COUNT NOW');
    },
    /** Dev: ROUND: ON → STARTS SOON → JUST ENDED → ON. */
    cycleRound() {
        if (S.inRound) { S.inRound = false; S.offPhase = 'soon'; } else if (S.offPhase === 'soon') S.offPhase = 'ended';
        else S.inRound = true;
        emit();
    },
    showToast,
    overtake() {
        fromTap();
        if (S.tab !== 'overall') seriesSim.setTab('overall');
        // Pass the one above you on whatever the race is showing.
        const all = known(race());
        const me = all.find((k) => k.p.you)!;
        const above = all.find((k) => k.rank === me.rank - 1);
        if (!above) { showToast('YOU’RE ALREADY TOP OF THIS BOARD'); return; }
        if (isDark(S.state, above.rank, above.p)) { showToast('THE ONE ABOVE YOU IS SEALED'); return; }
        land(me.p, { act: 'walk', min: 34, pts: above.p.pts - me.p.pts + Math.round((3 + S.model.rnd() * 15) * S.model.k * 2) + 1 });
    },
    acceptDuel() {
        const iv = S.tabs.duel.invite;
        if (!iv) return;
        S.tabs.duel.active.unshift({ id: iv.id, name: iv.name, them: iv.them, w: 0, l: 0 });
        S.tabs.duel.invite = null;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(`DUEL ON · YOU VS ${iv.name.toUpperCase()} · ENDS SUNDAY`);
    },
    challenge(id: string) {
        if (S.tabs.duel.sent.includes(id)) return;
        const name = S.tabs.duel.open.find((x) => x.id === id)?.name ?? id;
        S.tabs.duel.sent = [...S.tabs.duel.sent, id];
        void Haptics.selectionAsync();
        showToast(`CHALLENGE SENT TO ${firstName(name).toUpperCase()}`);
    },
    /** London closes on the city above, then passes it. */
    cityMovesUp() {
        fromTap();
        seriesSim.setTab('city');
        const london = S.tabs.city.find((r) => r.you)!;
        const rows = cityRanked(S.tabs);
        const i = rows.indexOf(london);
        if (i === 0) { showToast('LONDON IS ALREADY THE TOP CITY'); return; }
        const above = rows[i - 1];
        london.avg = above.avg - 3 * S.model.k;
        emit();
        setTimeout(() => {
            const before = cityRanked(S.tabs);
            london.avg = above.avg + 5 * S.model.k;
            cityCheck(before);
            emit();
        }, 1100);
    },
    /** You close in on the crown, then a gym session takes it. */
    takeCrown() {
        fromTap();
        seriesSim.setTab('gym');
        const c = courtRanked(S.tabs);
        const me = c.find((r) => r.you)!;
        if (c[0] === me) { showToast('YOU ALREADY HOLD THE CROWN'); return; }
        me.pts = c[0].pts - Math.round(60 * S.model.k);
        emit();
        setTimeout(() => land(youOf(race()).p, { act: 'gym', min: 52, pts: Math.round(180 * S.model.k) }), 1100);
    },
    /** Tom draws level in your duel, then edges ahead. */
    duelSlips() {
        fromTap();
        seriesSim.setTab('friends');
        const D = S.tabs.duel;
        const d = D.active.find((x) => x.name === 'Tom Fitzgerald') ?? D.active[0];
        d.them = D.you - Math.round(6 * S.model.k);
        emit();
        setTimeout(() => {
            const was = D.you - d.them;
            d.them += Math.round(45 * S.model.k);
            duelCheck(d, was);
            emit();
        }, 1100);
    },
    reset() {
        seriesSim.setScale(S.scale);
    },
};

/** The Series as a screen sees it. `active` = this screen is in view. */
export function useSeriesSim(active: boolean) {
    useSyncExternalStore(subscribe, () => version);
    const drop = useDropPrototype();
    useEffect(() => {
        if (!active) return undefined;
        watchers += 1;
        schedule();
        return () => { watchers -= 1; schedule(); };
    }, [active]);
    const board = race();
    const me = youOf(board);
    // Draw tickets from the Drop and the Golden P join the ones from titles and duels.
    const goldenMin = Math.max(0, drop.minutes - S.goldenStartMin);
    const goldenDone = S.golden === 'accepted' && goldenMin >= GOLDEN_MINUTES;
    const dropTicket = drop.opened && drop.reward?.series === 'ticket';
    const extraLog = [...(dropTicket ? ['TODAY’S DROP'] : []), ...(goldenDone ? ['GOLDEN P'] : [])];
    return {
        ...seriesSim,
        model: S.model,
        board,
        rows: visibleRows(board, S.state, S.view),
        view: S.view,
        pb: S.model.pb,
        state: S.state,
        tab: S.tab,
        tabs: S.tabs,
        pings: S.pings,
        scale: S.scale,
        paused: S.paused,
        inRound: S.inRound,
        offPhase: S.offPhase,
        /** The invite board before the round (sample). */
        inviteBoard: sampleInviteBoard(S.invite.friends, S.invite.joining),
        hits: S.hits,
        toast: S.toast,
        rival: rivalOf(S.model, S.state),
        /** Who's on course for each named prize (the live app reads get_series_prize_race). */
        race: sampleRace(S.model, STATE_INFO[S.state].day, drawDays(STATE_INFO[S.state].day, STATE_INFO[S.state].logged)),
        morning: S.morning,
        tickets: S.tickets + extraLog.length,
        ticketLog: [...S.ticketLog, ...extraLog],
        titlesToday: titlesFor(S.morning),
        titlesWon: S.titlesWon,
        recap: S.recapOpen ? recapFor() : null,
        pulse: pulseFor(),
        /** What changed since yesterday, always shown on the League tab (up to three lines). */
        news: recapFor().slice(0, 3),
        rank: me.rank,
        results: S.results,
        rematched: S.rematched,
        golden: { state: S.golden, minutes: goldenMin, need: GOLDEN_MINUTES, done: goldenDone, finder: 7, of: GOLDEN_FINDERS },
        /** Minutes left on an opened Drop's 2× Series points. */
        dropDoubleLeft: seriesDoubleLeft(drop),
        /** Series points `minutes` of walking (steps route) or training (active minutes) would earn you now. */
        gainFor: (minutes: number, route: 'steps' | 'minutes') => {
            const act: ActKey = route === 'steps' ? 'walk' : 'run';
            const m = Math.min(2, multOf(me.p, me.rank, S.state, act) * (seriesDoubleLeft(drop) > 0 ? 2 : 1));
            return Math.round(ACTS[act].ppm * S.model.k * m * minutes);
        },
    };
}

/** Just whether a round is running (Home picks its head-to-head card by it). */
export function useSeriesInRound() {
    useSyncExternalStore(subscribe, () => version);
    return S.inRound;
}

/** Dev: on, or which side of a round Home shows with none running. */
export function useSeriesRoundPhase(): 'on' | 'soon' | 'ended' {
    useSyncExternalStore(subscribe, () => version);
    return S.inRound ? 'on' : S.offPhase;
}
