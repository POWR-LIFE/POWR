/**
 * Pure derivations for the engagement-pitch prototypes (Pulse, Next Move's
 * "pass N people", Hunt, Doors). No I/O. Everything here is invented scale
 * except PULSE_TODAY, which mirrors prod on 2026-10-12 (130 real users, 15
 * active that day) so the two scales can be compared side by side.
 */

import { STEPS_PER_KM } from '@/lib/crew';

export type PulseScale = 'today' | 'pitch';

export interface PulseBase {
    movingNow: number;
    cityPowr: number;
    rank: number;
    /** How many are ranked today at all. */
    of: number;
    rankUp: number;
    friendsActive: number;
    /** Two areas racing, or null when there aren't enough people for one. */
    areas: { lead: string; trail: string; gap: number } | null;
    /** Places gained per 1,000 steps you add. */
    placesPer1k: number;
}

export const PULSE_TODAY: PulseBase = {
    movingNow: 2,
    cityPowr: 412,
    rank: 6,
    of: 15,
    rankUp: 1,
    friendsActive: 1,
    areas: null,
    placesPer1k: 0.5,
};

/** The pitch's own numbers — roughly what 5,000+ daily members would look like. */
export const PULSE_PITCH: PulseBase = {
    movingNow: 2814,
    cityPowr: 1_800_000,
    rank: 634,
    of: 9_420,
    rankUp: 81,
    friendsActive: 36,
    areas: { lead: 'Battersea', trail: 'Shoreditch', gap: 24_000 },
    placesPer1k: 23,
};

export function pulseBase(scale: PulseScale): PulseBase {
    return scale === 'pitch' ? PULSE_PITCH : PULSE_TODAY;
}

/** Your rank after `addedSteps` today — never better than #1. */
export function pulseRank(base: PulseBase, addedSteps: number): number {
    return Math.max(1, Math.round(base.rank - (Math.max(0, addedSteps) / 1000) * base.placesPer1k));
}

/** Next Move's "pass N people": who you'd overtake covering `stepsLeft`. */
export function peopleToPass(base: PulseBase, currentRank: number, stepsLeft: number): number {
    if (stepsLeft <= 0) return 0;
    return Math.min(currentRank - 1, Math.max(1, Math.round((stepsLeft / 1000) * base.placesPer1k)));
}

/** "1.8M", "24k", "412". */
export function compact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 10_000) return `${Math.round(n / 1000)}k`;
    return Math.round(n).toLocaleString('en-GB');
}

export function stepsToKm(steps: number): number {
    return Math.max(0, steps) / STEPS_PER_KM;
}

/** Hunt: each clue opens at a distance; returns how many are open and what's next. */
export interface HuntClue {
    atKm: number;
    label: string;
    reveal: string;
}

export const HUNT_CLUES: readonly HuntClue[] = [
    { atKm: 2, label: 'What it is', reveal: 'Two tickets to a sold-out night' },
    { atKm: 5, label: 'Where it is', reveal: 'East London, near the canal' },
    { atKm: 10, label: 'How to claim it', reveal: 'First to the pin on Saturday' },
];

export function huntStage(km: number): { open: number; next: HuntClue | null; pct: number } {
    const open = HUNT_CLUES.filter(c => km >= c.atKm).length;
    const last = HUNT_CLUES[HUNT_CLUES.length - 1];
    return { open, next: HUNT_CLUES[open] ?? null, pct: Math.min(1, Math.max(0, km) / last.atKm) };
}

/** Doors: progress toward each brand's door, 0..1. */
export function doorProgress(done: number, need: number): number {
    return need > 0 ? Math.min(1, Math.max(0, done) / need) : 0;
}
