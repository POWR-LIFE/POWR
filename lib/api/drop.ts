import type { DropReward, TargetBasis } from '@/lib/drop';
import i18n from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

/**
 * POWR Drop, served by the database (supabase/migrations/20261026180000_powr_drop.sql).
 * The server sets today's target, counts the movement, rolls the prize and pays
 * it; the app only shows what it's told.
 */

export type DropPrizeKind = 'points' | 'vault' | 'partner';

/** What an opened Drop held, as the server recorded it. */
export interface DropPrize {
    kind: DropPrizeKind;
    /** POWR for points and Vault prizes; null for a partner code. */
    amount: number | null;
    /** Paid from the fallback pool once the day's budget was spent. */
    fallback: boolean;
    vest_days?: number;
    brand?: string | null;
    title?: string | null;
    value_label?: string | null;
}

/** One of the prizes today's Drop could hold — names only, never odds. */
export interface DropInside {
    kind: DropPrizeKind;
    amount: number | null;
    brand: string | null;
    value_label: string | null;
    title: string | null;
}

export type DropWeekDay = 'opened' | 'missed' | 'none';

export interface MyDrop {
    /** The member's own calendar day, YYYY-MM-DD. */
    day: string;
    status: 'sealed' | 'opened' | 'void';
    target: { steps: number; minutes: number; basis: TargetBasis; typical_steps: number; typical_minutes: number };
    /** Today's movement as the server counts it — what the open is checked against. */
    steps: number;
    minutes: number;
    prize: DropPrize | null;
    opened_at: string | null;
    /** Monday to yesterday. 'none' = before their first Drop. */
    week: DropWeekDay[];
    /** Today in the Mon–Sun week, 0 = Monday. */
    day_index: number;
    comeback: { days_away: number } | null;
    could_be_inside: DropInside[];
    /** Their next local midnight. */
    resets_at: string;
}

/**
 * Today's Drop, or null when it's off for this member (or the server can't be
 * reached, or the Drop isn't in the database yet) — the card just doesn't show.
 */
export async function fetchMyDrop(): Promise<MyDrop | null> {
    const { data, error } = await supabase.rpc('get_my_drop');
    if (error) {
        console.warn('[drop] get_my_drop failed:', error.message);
        return null;
    }
    return (data as MyDrop | null) ?? null;
}

export type OpenDropResult =
    | { ok: true; prize: DropPrize; already: boolean }
    | { ok: false; reason: 'off' | 'void' | 'not_yet' | 'empty' | 'error' };

/** Open today's Drop. Safe to retry: an opened day returns the same prize. */
export async function openMyDrop(): Promise<OpenDropResult> {
    const { data, error } = await supabase.rpc('open_my_drop');
    if (error || !data) {
        if (error) console.warn('[drop] open_my_drop failed:', error.message);
        return { ok: false, reason: 'error' };
    }
    return data as OpenDropResult;
}

/** The reveal's three lines for a prize, in the member's language. */
export function dropRewardFor(prize: DropPrize): DropReward {
    if (prize.kind === 'points') {
        return {
            kind: 'points',
            headline: `+${prize.amount ?? 0}`,
            unit: i18n.t('home:drop.prize.pointsUnit'),
            detail: i18n.t('home:drop.prize.pointsDetail'),
        };
    }
    if (prize.kind === 'vault') {
        return {
            kind: 'vault',
            headline: `+${prize.amount ?? 0}`,
            unit: i18n.t('home:drop.prize.vaultUnit'),
            detail: i18n.t('home:drop.prize.vaultDetail', { count: prize.vest_days ?? 60 }),
        };
    }
    const brand = prize.brand?.trim() || i18n.t('home:drop.prize.partnerFallbackBrand');
    const value = prize.value_label?.trim();
    return {
        kind: 'partner',
        headline: value || brand,
        unit: value ? brand.toUpperCase() : i18n.t('home:drop.prize.partnerUnit'),
        detail: prize.title?.trim()
            ? i18n.t('home:drop.prize.partnerDetail', { title: prize.title.trim() })
            : i18n.t('home:drop.prize.partnerDetailNoTitle'),
    };
}

/** "+20 POWR", "+30 to your Vault", "HUEL 15% OFF" — for the could-be-inside line. */
export function dropInsideLabel(p: DropInside): string {
    if (p.kind === 'points') return i18n.t('home:drop.inside.points', { amount: p.amount ?? 0 });
    if (p.kind === 'vault') return i18n.t('home:drop.inside.vault', { amount: p.amount ?? 0 });
    const brand = p.brand?.trim() ?? '';
    const value = p.value_label?.trim() ?? '';
    return [brand, value].filter(Boolean).join(' ') || (p.title?.trim() ?? i18n.t('home:drop.prize.partnerFallbackBrand'));
}
