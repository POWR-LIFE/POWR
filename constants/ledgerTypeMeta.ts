import type { PointTransaction } from '@/lib/api/points';

const GOLD = '#E8D200';
const GREEN = '#00CC66';
const RED = '#ef4444';
const ORANGE = '#FF9944';
const DIM = 'rgba(255,255,255,0.5)';

/**
 * How each kind of ledger row presents when there's no activity to name it by:
 * the glyph, the accent, and the label to fall back to when the row carries no
 * description of its own.
 *
 * Shared by the ledger list and its filter sheet — they must agree, or a bucket
 * would wear one icon in the picker and another in the rows it selects.
 */
export const LEDGER_TYPE_META: Record<
    PointTransaction['type'],
    { icon: string; color: string; fallbackLabel: string }
> = {
    earn: { icon: 'flash', color: GREEN, fallbackLabel: 'Activity' },
    bonus: { icon: 'star', color: GOLD, fallbackLabel: 'Bonus' },
    streak: { icon: 'flame', color: ORANGE, fallbackLabel: 'Streak Bonus' },
    adjustment: { icon: 'swap-horizontal', color: DIM, fallbackLabel: 'Adjustment' },
    redeem: { icon: 'bag-handle', color: RED, fallbackLabel: 'Reward Redeemed' },
    penalty: { icon: 'warning', color: RED, fallbackLabel: 'Penalty' },
};
