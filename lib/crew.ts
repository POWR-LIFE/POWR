/**
 * Crew Charge — 3 to 5 friends filling one battery a day.
 *
 * Everything anyone in the crew does charges it: steps one-for-one, active
 * minutes (a tracked workout or a verified gym visit) at a walking pace's
 * worth. It's pooled, so anyone can finish it. Charged, everyone in the crew
 * gets a Crew Drop. Capacity grows with the crew, so a bigger crew isn't an
 * easier one. Pure derivation, no I/O.
 */

import type { DropReward } from '@/lib/drop';

export const CREW_MIN = 3;
export const CREW_MAX = 5;

/** Each member's share of the battery, in step-equivalents. */
export const CREW_SHARE = 6000;
/** One active minute counts as this many steps (≈ a brisk walking minute). */
export const ACTIVE_MIN_STEPS = 100;
/** Steps in a kilometre — the remaining charge is shown as distance. */
export const STEPS_PER_KM = 1300;

export interface CrewMemberCharge {
    id: string;
    name: string;
    isYou: boolean;
    steps: number;
    minutes: number;
}

export function memberCharge(m: Pick<CrewMemberCharge, 'steps' | 'minutes'>): number {
    return Math.max(0, m.steps) + Math.max(0, m.minutes) * ACTIVE_MIN_STEPS;
}

export interface CrewBattery {
    capacity: number;
    total: number;
    /** 0..1 */
    pct: number;
    charged: boolean;
    /** Step-equivalents still needed. */
    remaining: number;
    remainingKm: number;
    /** Each member's slice of the battery, in crew order, as 0..1 of capacity. */
    slices: { id: string; share: number }[];
    /** Members other than you who haven't moved today — the nudge list. */
    quiet: CrewMemberCharge[];
}

export function crewBattery(members: CrewMemberCharge[]): CrewBattery {
    const capacity = Math.max(1, members.length) * CREW_SHARE;
    const charges = members.map(memberCharge);
    const raw = charges.reduce((a, b) => a + b, 0);
    const total = Math.min(raw, capacity);
    // Slices are scaled down together once the battery overflows, so the bar
    // never draws past full and each slice keeps its proportion.
    const scale = raw > capacity ? capacity / raw : 1;
    const remaining = Math.max(0, capacity - raw);
    return {
        capacity,
        total,
        pct: total / capacity,
        charged: remaining === 0,
        remaining,
        remainingKm: remaining / STEPS_PER_KM,
        slices: members.map((m, i) => ({ id: m.id, share: (charges[i] * scale) / capacity })),
        quiet: members.filter((m, i) => !m.isYou && charges[i] === 0),
    };
}

/** "1.4 km" — one decimal under 10 km, whole km above. */
export function formatKm(km: number): string {
    if (km <= 0) return '0 km';
    if (km < 0.1) return '0.1 km';
    return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** What's in a Crew Drop — everyone in the crew gets the same one. */
export const CREW_POOL: readonly DropReward[] = [
    { kind: 'points', headline: '+15', unit: 'POWR EACH', detail: 'Everyone in the crew gets it.' },
    { kind: 'boost', headline: '2×', unit: 'CREW WORKOUT TOMORROW', detail: 'Train together before noon. Up to +30 each.' },
    { kind: 'partner', headline: '20% OFF', unit: 'PARTNER REWARD', detail: 'One for each of you. In your wallets.' },
];

export function pickCrewReward(roll: number): DropReward {
    const i = Math.min(CREW_POOL.length - 1, Math.max(0, Math.floor(roll * CREW_POOL.length)));
    return CREW_POOL[i];
}
