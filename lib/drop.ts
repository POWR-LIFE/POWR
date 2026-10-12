/**
 * POWR Drop — the daily sealed reward that movement opens.
 *
 * Each morning the member sets a target (Lock In), the Home card shows the
 * one move that opens it (Next Move), and once it's open they hold the P to
 * reveal what's inside. This file is the pure derivation: tiers, progress and
 * the Next Move line. No I/O, no clock reads — callers pass everything in.
 *
 * A tier can be opened two ways, whichever comes first: steps (walkers) or
 * active minutes (a tracked workout or a verified gym visit). Next Move picks
 * the quicker of the two, so it's always the shortest honest route.
 */

export type DropTier = 'light' | 'steady' | 'long';

export interface DropTierDef {
    id: DropTier;
    /** Sentence case — shown as written in the sheet, uppercased in kickers. */
    label: string;
    steps: number;
    minutes: number;
    /** What's inside, by size — never a number of points. */
    size: string;
}

export const DROP_TIERS: readonly DropTierDef[] = [
    { id: 'light', label: 'Light', steps: 5000, minutes: 20, size: 'Small' },
    { id: 'steady', label: 'Steady', steps: 10000, minutes: 30, size: 'Medium' },
    { id: 'long', label: 'Long', steps: 15000, minutes: 60, size: 'Large' },
];

export function dropTier(id: DropTier): DropTierDef {
    return DROP_TIERS.find(t => t.id === id) ?? DROP_TIERS[0];
}

/** Brisk walking pace used to turn a step gap into minutes. */
export const STEPS_PER_MIN = 100;

/** 0..1 — the further along of the two routes. */
export function dropProgress(tier: DropTierDef, steps: number, minutes: number): number {
    const bySteps = tier.steps > 0 ? Math.max(0, steps) / tier.steps : 0;
    const byMinutes = tier.minutes > 0 ? Math.max(0, minutes) / tier.minutes : 0;
    return Math.min(1, Math.max(bySteps, byMinutes));
}

export interface NextMove {
    /** Minutes until the Drop opens on the quicker route; 0 once it's open. */
    minutes: number;
    route: 'steps' | 'minutes';
    /** What's left on the quicker route: "1,800 steps", "12 active min". */
    left: string;
    /** "1,800 steps opens it" */
    line: string;
    /** The other route, for the members it suits better — null once open. */
    alt: string | null;
}

export function formatSteps(n: number): string {
    return Math.round(n).toLocaleString('en-GB');
}

export function nextMove(tier: DropTierDef, steps: number, minutes: number): NextMove {
    const stepsLeft = Math.max(0, tier.steps - Math.max(0, steps));
    const minsLeft = Math.max(0, tier.minutes - Math.max(0, minutes));

    if (stepsLeft === 0 || minsLeft === 0) {
        return { minutes: 0, route: stepsLeft === 0 ? 'steps' : 'minutes', left: '', line: 'Your Drop is open', alt: null };
    }

    const walkMins = Math.ceil(stepsLeft / STEPS_PER_MIN);
    const stepsLine = `${formatSteps(stepsLeft)} steps opens it`;
    const minsLine = `${minsLeft} active min opens it`;

    // Ties go to steps: a walk needs no kit and no venue.
    if (walkMins <= minsLeft) {
        return { minutes: walkMins, route: 'steps', left: `${formatSteps(stepsLeft)} steps`, line: stepsLine, alt: `or ${minsLeft} active min` };
    }
    return { minutes: minsLeft, route: 'minutes', left: `${minsLeft} active min`, line: minsLine, alt: `or ${formatSteps(stepsLeft)} steps` };
}

/** What can be inside. Sized under the daily earn caps — see POWR_Points_Logic. */
export type DropRewardKind = 'points' | 'vault' | 'boost' | 'partner' | 'event';

export interface DropReward {
    kind: DropRewardKind;
    /** The big gold line: "+20", "2×", "15% OFF". */
    headline: string;
    /** The label under it: "POWR", "ON YOUR NEXT WORKOUT". */
    unit: string;
    /** One plain sentence. */
    detail: string;
}

export const DROP_POOLS: Record<DropTier, readonly DropReward[]> = {
    light: [
        { kind: 'points', headline: '+10', unit: 'POWR', detail: 'Added to your balance now.' },
        { kind: 'vault', headline: '+15', unit: 'POWR TO YOUR VAULT', detail: 'Yours in 60 days.' },
    ],
    steady: [
        { kind: 'points', headline: '+20', unit: 'POWR', detail: 'Added to your balance now.' },
        { kind: 'boost', headline: '2×', unit: 'ON YOUR NEXT WORKOUT', detail: 'Up to +30 POWR. Use it by midnight.' },
        { kind: 'vault', headline: '+30', unit: 'POWR TO YOUR VAULT', detail: 'Yours in 60 days.' },
    ],
    long: [
        { kind: 'points', headline: '+40', unit: 'POWR', detail: 'Added to your balance now.' },
        { kind: 'partner', headline: '15% OFF', unit: 'PARTNER REWARD', detail: 'At a POWR partner. In your wallet.' },
        { kind: 'event', headline: 'FREE ENTRY', unit: 'NEXT LIVE EVENT', detail: 'Your place is held. No code needed.' },
    ],
};

/** Deterministic pick so a given roll always gives the same reward (tests, replays). */
export function pickDropReward(tier: DropTier, roll: number): DropReward {
    const pool = DROP_POOLS[tier];
    const i = Math.min(pool.length - 1, Math.max(0, Math.floor(roll * pool.length)));
    return pool[i];
}

/** Comeback: days away before the welcome-back offer shows. */
export const COMEBACK_AFTER_DAYS = 3;
/** Comeback doubles the first N POWR of the day — sized to one capped gym day. */
export const COMEBACK_DOUBLE_UP_TO = 30;
