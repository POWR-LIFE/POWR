import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import {
    ACTS,
    type ActKey,
    createModel,
    fmt,
    isDark,
    known,
    type LensKey,
    type Model,
    multOf,
    type Person,
    pickAct,
    rebalance,
    type Row,
    type Scale,
    type SeriesState,
    sortBoard,
    visibleRows,
} from '@/lib/dev/seriesPrototype';

/** A session that just landed on a lane: drives the green "+N", the delta on
 *  the bar and the row flash. */
export type Hit = { key: number; pts: number; old: number; x2: boolean; ember?: boolean };
export type FeedItem = {
    key: number; name: string; you: boolean; act: ActKey; min: number; pts: number; m: number;
    sealed: boolean; atEvent: boolean; ticket?: boolean;
    /** Already on screen when the feed was (re)seeded: placed, not slid in. */
    seed?: boolean;
};
export type Toast = { key: number; text: string; tone: 'gold' | 'ember' };
type LaneRow = Extract<Row, { type: 'lane' }>;

/**
 * DEV ONLY. Runs the sample Series board: a session lands every second or two
 * (faster in a Flash Window or on event night) while the League tab is in
 * view. The model is mutable and lives in a ref; `bump` re-renders after each
 * change.
 */
export function useSeriesSim(active: boolean) {
    const [scale, setScaleState] = useState<Scale>('pitch');
    const [state, setStateState] = useState<SeriesState>('day3');
    const [lens, setLensState] = useState<LensKey>('overall');
    const [paused, setPaused] = useState(false);
    const [ticket, setTicket] = useState(false);
    const model = useRef<Model>(createModel('pitch'));
    const [, bump] = useReducer((n: number) => n + 1, 0);
    const [hits, setHits] = useState<Record<string, Hit>>({});
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [toast, setToast] = useState<Toast | null>(null);
    const seq = useRef(0);
    const stateRef = useRef(state);
    const lensRef = useRef(lens);
    stateRef.current = state;
    lensRef.current = lens;
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

    const later = useCallback((fn: () => void, ms: number) => {
        timers.current.push(setTimeout(fn, ms));
    }, []);
    useEffect(() => () => timers.current.forEach(clearTimeout), []);

    const showToast = useCallback((text: string, tone: Toast['tone'] = 'gold') => {
        const key = ++seq.current;
        setToast({ key, text, tone });
        later(() => setToast((t) => (t?.key === key ? null : t)), 2600);
    }, [later]);

    const markHit = useCallback((id: string, hit: Hit, ms: number) => {
        setHits((h) => ({ ...h, [id]: hit }));
        later(() => setHits((h) => {
            if (h[id]?.key !== hit.key) return h;
            const next = { ...h };
            delete next[id];
            return next;
        }), ms);
    }, [later]);

    const seedFeed = useCallback(() => {
        const m0 = model.current;
        const b = m0.boards[lensRef.current];
        const st = stateRef.current;
        const lanes = visibleRows(b, st).filter((r): r is LaneRow => r.type === 'lane' && !r.p.you);
        const items: FeedItem[] = [];
        for (let i = 0; i < 3 && lanes.length; i += 1) {
            const r = lanes[Math.floor(m0.rnd() * lanes.length)];
            const A = ACTS[r.p.act];
            const min = Math.round(A.min[0] + m0.rnd() * (A.min[1] - A.min[0]));
            const m = multOf(r.p, r.rank, b, st, m0.bounty.live);
            items.push({
                key: ++seq.current, name: r.p.name, you: false, act: r.p.act, min,
                pts: Math.round(min * A.ppm * m0.k * m), m, sealed: r.dark, atEvent: st === 'eventNight' && r.p.event, seed: true,
            });
        }
        setFeed(items);
    }, []);
    useEffect(() => { seedFeed(); }, [seedFeed]);

    const land = useCallback((p: Person, o: { act?: ActKey; min?: number; pts?: number } = {}) => {
        const m0 = model.current;
        const b = m0.boards[lensRef.current];
        const st = stateRef.current;
        const before = known(b);
        const meBefore = before.find((k) => k.p.you)!.rank;
        const rankBefore = before.find((k) => k.p === p)?.rank ?? 0;
        const leaderBefore = m0.boards.overall.segs[0].people[0];
        const act = o.act ?? pickAct(m0, p);
        const A = ACTS[act];
        const min = o.min ?? Math.round(A.min[0] + m0.rnd() * (A.min[1] - A.min[0]));
        const m = multOf(p, rankBefore, b, st, m0.bounty.live, act);
        const pts = o.pts ?? Math.max(1, Math.round(min * A.ppm * m0.k * m));
        const old = p.pts;
        p.pts += pts;
        p.today += pts;
        p.totalEarned += pts;
        sortBoard(b);
        rebalance(m0, b);
        m0.hour += 1;
        const after = known(b);
        const meAfter = after.find((k) => k.p.you)!.rank;
        // A big session can carry someone out of the window held around you.
        const rankAfter = after.find((k) => k.p === p)?.rank ?? rankBefore;
        const sealed = isDark(st, rankAfter, p);
        const key = ++seq.current;
        if (!sealed) markHit(p.id, { key, pts, old, x2: m >= 2 }, 1800);
        setFeed((f) => [{
            key, name: p.name, you: p.you, act, min, pts, m, sealed, atEvent: st === 'eventNight' && p.event,
        }, ...f].slice(0, 4));
        if (p.you) void Haptics.selectionAsync();
        if (p.you && meAfter < meBefore) {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            const passed = after.find((k) => k.rank === meAfter + 1);
            const n = meBefore - meAfter;
            showToast(`+${n} PLACE${n > 1 ? 'S' : ''} · YOU PASSED ${(passed?.p.name ?? '').toUpperCase()}`);
        }
        const leaderAfter = m0.boards.overall.segs[0].people[0];
        if (lensRef.current === 'overall' && st !== 'final48' && m0.bounty.live && leaderAfter !== leaderBefore) {
            m0.bounty = { ...m0.bounty, live: false, claimedBy: leaderAfter.name, from: leaderBefore.name };
            leaderAfter.title = 'leader';
            leaderBefore.title = null;
            showToast(`BOUNTY CLAIMED · ${leaderAfter.name.toUpperCase()} +${fmt(m0.bounty.pot)}`, 'ember');
            later(() => {
                const o2 = leaderAfter.pts;
                leaderAfter.pts += m0.bounty.pot;
                sortBoard(m0.boards.overall);
                markHit(leaderAfter.id, { key: ++seq.current, pts: m0.bounty.pot, old: o2, x2: false, ember: true }, 2200);
                bump();
            }, 900);
        }
        bump();
    }, [later, markHit, showToast]);

    const tick = useCallback(() => {
        const m0 = model.current;
        const b = m0.boards[lensRef.current];
        const rows = visibleRows(b, stateRef.current).filter((r): r is LaneRow => r.type === 'lane');
        const all = known(b);
        const me = all.find((k) => k.p.you)!;
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
    }, [land]);

    useEffect(() => {
        if (!active || paused) return undefined;
        let t: ReturnType<typeof setTimeout>;
        const loop = () => {
            const fast = state === 'flash' || state === 'eventNight';
            const gap = fast ? 800 + Math.random() * 500 : 1500 + Math.random() * 900;
            t = setTimeout(() => {
                try { tick(); } finally { loop(); }
            }, gap);
        };
        loop();
        return () => clearTimeout(t);
    }, [active, paused, state, tick]);

    const setLens = useCallback((l: LensKey) => {
        lensRef.current = l;
        setLensState(l);
        setHits({});
        seedFeed();
    }, [seedFeed]);

    const setState = useCallback((s: SeriesState) => {
        stateRef.current = s;
        setStateState(s);
        setHits({});
        seedFeed();
    }, [seedFeed]);

    const setScale = useCallback((sc: Scale) => {
        model.current = createModel(sc);
        setScaleState(sc);
        setTicket(false);
        setHits({});
        seedFeed();
        bump();
    }, [seedFeed]);

    const overtake = useCallback(() => {
        const m0 = model.current;
        const b = m0.boards[lensRef.current];
        const all = known(b);
        const me = all.find((k) => k.p.you)!;
        const above = all.find((k) => k.rank === me.rank - 1);
        if (!above) { showToast('YOU’RE ALREADY TOP OF THIS BOARD'); return; }
        if (isDark(stateRef.current, above.rank, above.p)) { showToast('THE ONE ABOVE YOU IS SEALED'); return; }
        land(me.p, { act: 'walk', min: 34, pts: above.p.pts - me.p.pts + Math.round((3 + m0.rnd() * 15) * m0.k * 2) + 1 });
    }, [land, showToast]);

    const claimBounty = useCallback(() => {
        const m0 = model.current;
        if (stateRef.current === 'final48') { showToast('THE BOUNTY IS SEALED IN THE FINAL 48'); return; }
        if (!m0.bounty.live) { showToast('ALREADY CLAIMED · RESET TO REPLAY'); return; }
        if (lensRef.current !== 'overall') setLens('overall');
        const [a, c] = m0.boards.overall.segs[0].people;
        // Fast-forward a few days: #2 has closed the gap, then lands the session that passes.
        c.pts = a.pts - Math.round(48 * m0.k);
        bump();
        later(() => land(c, { act: 'run', min: 41, pts: Math.round(140 * m0.k) }), 1100);
    }, [land, later, setLens, showToast]);

    /** The Golden Ticket lands on your next session. Resolves once it has. */
    const findTicket = useCallback((onFound: () => void) => {
        if (ticket) { showToast('FOUND ALREADY · RESET TO REPLAY'); return; }
        const me = known(model.current.boards[lensRef.current]).find((k) => k.p.you)!;
        land(me.p, { act: 'walk', min: 34 });
        setTicket(true);
        later(() => {
            setFeed((f) => [{
                key: ++seq.current, name: 'You', you: true, act: 'walk' as ActKey, min: 34, pts: 0, m: 1, sealed: false, atEvent: false, ticket: true,
            }, ...f].slice(0, 4));
            onFound();
        }, 1200);
    }, [land, later, showToast, ticket]);

    const board = model.current.boards[lens];
    return {
        model: model.current,
        board,
        rows: visibleRows(board, state),
        state,
        lens,
        scale,
        paused,
        ticket,
        hits,
        feed,
        toast,
        setLens,
        setState,
        setScale,
        setPaused,
        overtake,
        claimBounty,
        findTicket,
        showToast,
        reset: () => setScale(scale),
    };
}
