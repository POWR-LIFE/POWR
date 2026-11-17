import { type Honour, type HonourKind, type HonourTier, honourNext, TIER_RANK } from '@/constants/honours';

/**
 * What the Series share card says about you once you're on the board
 * (components/share/SeriesStandingCard.tsx): your place, your climb, three
 * numbers from the round and the trophy cabinet. Pure, so the choices (which
 * rank, which stats, which trophy is next) are pinned by
 * __tests__/seriesShareCard.test.ts. Every number here comes from the server:
 * get_series_board, get_honours and your own activity_sessions rows.
 */

/** The cabinet's columns, left to right, as on the card. */
export const CABINET_KINDS: HonourKind[] = ['king', 'power', 'on_fire', 'diamond', 'wings', 'hive', 'strength'];
/** The cabinet's rows, top to bottom. The King has one piece (gold), in the top row. */
export const CABINET_TIERS: HonourTier[] = ['platinum', 'gold', 'silver', 'bronze'];
/** Every piece there is: the King, and four metals for each of the other six. */
export const CABINET_TOTAL = 1 + (CABINET_KINDS.length - 1) * CABINET_TIERS.length;

export type CabinetColumn = {
    kind: HonourKind;
    /** The row slots top to bottom; null = no piece in that slot (the King's lower three). */
    slots: ({ tier: HonourTier; earned: boolean } | null)[];
    /** Holds at least one piece: the name reads bright. */
    any: boolean;
};

/**
 * The cabinet from what you hold. Metals never drop and each is earned on the
 * way up, so holding gold lights bronze, silver and gold. Earned = pieces lit.
 */
export function cabinet(honours: Honour[]): { columns: CabinetColumn[]; earned: number; total: number } {
    const held = new Map<HonourKind, HonourTier>();
    for (const h of honours) {
        const was = held.get(h.kind);
        if (!was || TIER_RANK[h.tier] > TIER_RANK[was]) held.set(h.kind, h.tier);
    }
    let earned = 0;
    const columns = CABINET_KINDS.map((kind): CabinetColumn => {
        const top = held.get(kind);
        if (kind === 'king') {
            if (top) earned += 1;
            return { kind, slots: [{ tier: 'gold', earned: !!top }, null, null, null], any: !!top };
        }
        const rank = top ? TIER_RANK[top] : 0;
        earned += rank;
        return { kind, slots: CABINET_TIERS.map((tier) => ({ tier, earned: TIER_RANK[tier] <= rank })), any: rank > 0 };
    });
    return { columns, earned, total: CABINET_TOTAL };
}

/**
 * The trophy to chase next. With pieces in hand: the one nearest its next
 * metal (have ÷ need), the lower metal on a tie. With none: the first bronze
 * in FIRST_ORDER (easiest first), shown with its rule, not a count, since the
 * server only keeps numbers for trophies you hold. Null when all are maxed.
 */
export type NextUp =
    | { kind: HonourKind; tier: HonourTier; have: number; need: number; unit: string }
    | { kind: HonourKind; tier: 'bronze'; have: null; need: null; unit: null };

const FIRST_ORDER: HonourKind[] = ['on_fire', 'strength', 'power', 'wings', 'hive', 'diamond'];

export function nextHonour(honours: Honour[]): NextUp | null {
    const steps = honours
        .filter((h) => h.kind !== 'king')
        .map((h) => ({ h, n: honourNext(h) }))
        .filter((x): x is { h: Honour; n: NonNullable<ReturnType<typeof honourNext>> } => x.n !== null);
    if (steps.length > 0) {
        steps.sort((a, b) => {
            const r = Math.min(1, b.n.have / b.n.need) - Math.min(1, a.n.have / a.n.need);
            if (r !== 0) return r;
            const t = TIER_RANK[a.n.tier] - TIER_RANK[b.n.tier];
            if (t !== 0) return t;
            return CABINET_KINDS.indexOf(a.h.kind) - CABINET_KINDS.indexOf(b.h.kind);
        });
        const { h, n } = steps[0];
        return { kind: h.kind, tier: n.tier, have: n.have, need: n.need, unit: n.unit };
    }
    const heldKinds = new Set(honours.map((h) => h.kind));
    const first = FIRST_ORDER.find((k) => !heldKinds.has(k));
    return first ? { kind: first, tier: 'bronze', have: null, need: null, unit: null } : null;
}

/** Your round so far, from your own sessions since the round started (fetchSeriesRoundTotals). */
export type RoundTotals = {
    steps: number;
    runKm: number;
    gym: number;
    rideKm: number;
    /** Sessions that aren't a walk, run, ride or gym visit (HIIT, yoga, sports…). */
    workouts: number;
};

export type CardStatKey = 'steps' | 'run' | 'gym' | 'ride' | 'workouts' | 'points' | 'daysLeft';
export type CardStat = { key: CardStatKey; value: number };

/**
 * The three numbers under your place: steps, run and gym visits, as on the
 * design. A stat you haven't got (0) gives its cell to the next real one
 * (ride, workouts, Series points), never a 0 on the card. Fewer than two
 * real ones: the days left in the round fill in, so one number never stands
 * alone (how many are racing already sits beside your place, cardClimb).
 */
export function cardStats(totals: RoundTotals | null, extra: { points: number; daysLeft: number }): CardStat[] {
    const t = totals ?? { steps: 0, runKm: 0, gym: 0, rideKm: 0, workouts: 0 };
    const all: CardStat[] = [
        { key: 'steps', value: Math.round(t.steps) },
        { key: 'run', value: Math.round(t.runKm * 10) / 10 },
        { key: 'gym', value: t.gym },
        { key: 'ride', value: Math.round(t.rideKm * 10) / 10 },
        { key: 'workouts', value: t.workouts },
        { key: 'points', value: Math.round(extra.points) },
    ];
    const real = all.filter((x) => x.value > 0).slice(0, 3);
    if (real.length < 2 && extra.daysLeft > 0) real.push({ key: 'daysLeft', value: extra.daysLeft });
    return real;
}

/**
 * The number beside your place. Places climbed since the start of today (the
 * board's ▲) when you've climbed; otherwise how many are racing, so it reads
 * "#612 … 1,512 racing". Never a 0 or a ▼ on a card you're proud to send.
 * (Your points sit in the stats, cardStats, so they never show twice.)
 */
export type CardClimb = { key: 'climb' | 'racing'; value: number };

export function cardClimb(me: { rank: number; rank_mid: number }, total: number): CardClimb {
    const up = me.rank_mid - me.rank;
    return up > 0 ? { key: 'climb', value: up } : { key: 'racing', value: total };
}

/** Your place in your city when you have one (pacers count, as on My city), else on the whole board. */
export function cardRank(board: {
    me: { rank: number } | null;
    city?: { you: { name: string } | null; rank: number | null } | null;
}): { rank: number; city: string | null } | null {
    if (!board.me) return null;
    const c = board.city;
    if (c?.you?.name && c.rank && c.rank > 0) return { rank: c.rank, city: c.you.name };
    return { rank: board.me.rank, city: null };
}
