import i18n from '@/lib/i18n';

/**
 * Honours: the seven things a member earns by moving, shown as small line
 * icons under their name on the Series board. The server decides who holds
 * what (award_honours, 20261027180000_honours.sql); this is how they look
 * and read. Tiers only ever go up.
 */
export type HonourKind = 'king' | 'on_fire' | 'power' | 'diamond' | 'wings' | 'hive' | 'strength';
export type HonourTier = 'bronze' | 'silver' | 'gold';
export type Honour = { kind: HonourKind; tier: HonourTier; count: number };

/** Heaviest first: what shows when a row only has room for three. */
export const HONOUR_ORDER: HonourKind[] = ['king', 'diamond', 'wings', 'strength', 'hive', 'power', 'on_fire'];

export const TIER_RANK: Record<HonourTier, number> = { bronze: 1, silver: 2, gold: 3 };

/** The tier a count earns; the same thresholds as the server's _honour_tier. */
export function honourTier(kind: HonourKind, count: number): HonourTier | null {
    const at = (b: number, s: number, g: number) => (count >= g ? 'gold' : count >= s ? 'silver' : count >= b ? 'bronze' : null);
    switch (kind) {
        case 'king': return count >= 1 ? 'gold' : null;
        case 'on_fire': return at(4, 8, 12);
        case 'power': return at(1, 4, 8);
        case 'hive': return at(1, 3, 5);
        default: return at(1, 2, 3);
    }
}

/** Heaviest first, then by tier, so the gold pieces lead. */
export function sortHonours(list: Honour[]): Honour[] {
    return [...list].sort((a, b) => {
        const o = HONOUR_ORDER.indexOf(a.kind) - HONOUR_ORDER.indexOf(b.kind);
        return o !== 0 ? o : TIER_RANK[b.tier] - TIER_RANK[a.tier];
    });
}

export const honourName = (kind: HonourKind) => i18n.t(`series:honours.${kind}.name`);
export const honourLine = (kind: HonourKind) => i18n.t(`series:honours.${kind}.line`);
