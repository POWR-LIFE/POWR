import i18n from '@/lib/i18n';

/**
 * The trophies (Sorine's brief, 27 Oct 2026): seven things a member earns by
 * moving, shown as small icons under their name on the Series board and kept
 * for good. The server decides who holds what (award_honours,
 * 20261027180000_honours.sql); this is how they look, sort and read, and the
 * same thresholds so the cabinet can say "34 of 40 weeks to gold".
 */
export type HonourKind = 'king' | 'on_fire' | 'power' | 'diamond' | 'wings' | 'hive' | 'strength';
export type HonourTier = 'bronze' | 'silver' | 'gold' | 'platinum';
export type Honour = {
    kind: HonourKind;
    tier: HonourTier;
    /** The main number (weeks, rounds, places, friends, sessions, wins). */
    count: number;
    /** The rest: power w5/w6, hive active, wings top. */
    detail?: Record<string, number | boolean>;
    earned_at?: string;
};

export const TIERS: HonourTier[] = ['bronze', 'silver', 'gold', 'platinum'];
export const TIER_RANK: Record<HonourTier, number> = { bronze: 1, silver: 2, gold: 3, platinum: 4 };

/** The metal a set of numbers earns; the same ladder as the server's _honour_tier. */
export function honourTier(kind: HonourKind, count: number, detail: Record<string, number | boolean> = {}): HonourTier | null {
    const n = (k: string) => Number(detail[k] ?? 0);
    const ladder = (b: number, s: number, g: number, p: number) => (count >= p ? 'platinum' : count >= g ? 'gold' : count >= s ? 'silver' : count >= b ? 'bronze' : null);
    switch (kind) {
        case 'king': return count >= 1 ? 'gold' : null;
        case 'power': return n('w6') >= 30 ? 'platinum' : n('w5') >= 25 ? 'gold' : count >= 10 ? 'silver' : count >= 5 ? 'bronze' : null;
        case 'on_fire': return ladder(10, 20, 40, 60);
        case 'diamond': return ladder(1, 3, 6, 12);
        case 'wings': return detail.top ? 'platinum' : count >= 30 ? 'gold' : count >= 20 ? 'silver' : count >= 10 ? 'bronze' : null;
        case 'hive': return n('active') >= 30 ? 'platinum' : n('active') >= 12 ? 'gold' : n('active') >= 6 ? 'silver' : count >= 3 ? 'bronze' : null;
        case 'strength': return ladder(4, 30, 60, 100);
    }
}

/**
 * What's left to the next metal, for the cabinet: "34 of 40 weeks to gold".
 * Null once there's nothing above (platinum, or the King).
 */
export function honourNext(h: Honour): { tier: HonourTier; have: number; need: number; unit: string } | null {
    const d = h.detail ?? {};
    const n = (k: string) => Number(d[k] ?? 0);
    const up = TIERS[TIER_RANK[h.tier]];
    if (!up || h.kind === 'king') return null;
    const step = (have: number, need: number, unit: string) => ({ tier: up, have, need, unit });
    switch (h.kind) {
        case 'power': return up === 'silver' ? step(h.count, 10, 'weeks4') : up === 'gold' ? step(n('w5'), 25, 'weeks5') : step(n('w6'), 30, 'weeks6');
        case 'on_fire': return step(h.count, { silver: 20, gold: 40, platinum: 60 }[up as 'silver' | 'gold' | 'platinum'], 'weeks');
        case 'diamond': return step(h.count, { silver: 3, gold: 6, platinum: 12 }[up as 'silver' | 'gold' | 'platinum'], 'rounds');
        case 'wings': return up === 'platinum' ? step(0, 1, 'top') : step(h.count, { silver: 20, gold: 30 }[up as 'silver' | 'gold'], 'places');
        case 'hive': return step(n('active'), { silver: 6, gold: 12, platinum: 30 }[up as 'silver' | 'gold' | 'platinum'], 'friends');
        case 'strength': return step(h.count, { silver: 30, gold: 60, platinum: 100 }[up as 'silver' | 'gold' | 'platinum'], 'sessions');
        default: return null;
    }
}

/** The board's order: the King first, then platinum, gold, silver, bronze, newest first. */
export function sortHonours(list: Honour[]): Honour[] {
    return [...list].sort((a, b) => {
        if ((a.kind === 'king') !== (b.kind === 'king')) return a.kind === 'king' ? -1 : 1;
        const t = TIER_RANK[b.tier] - TIER_RANK[a.tier];
        if (t !== 0) return t;
        return (b.earned_at ?? '').localeCompare(a.earned_at ?? '');
    });
}

export const honourName = (kind: HonourKind) => i18n.t(`series:honours.${kind}.name`);
export const honourLine = (kind: HonourKind) => i18n.t(`series:honours.${kind}.line`);
export const tierName = (tier: HonourTier) => i18n.t(`series:honours.tier.${tier}`);
