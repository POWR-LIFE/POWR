import { useSyncExternalStore } from 'react';

import { pickDropReward, type DropReward, type DropTier } from '@/lib/drop';

/**
 * DESIGN SCAFFOLD — POWR Drop (+ Lock In, Next Move, Comeback).
 *
 * No backend yet: the Home card and the reveal run off this in-memory store,
 * with a DEV strip under the card to add steps and minutes so every state can
 * be walked in Expo Go in a minute. Nothing here ships: every entry point is
 * behind `DROP_PROTOTYPE`, which is false outside __DEV__. A reload resets it.
 * lib/drop.ts is the real, tested derivation; the numbers here are invented.
 */
export const DROP_PROTOTYPE = __DEV__;

export interface DropPrototype {
    tier: DropTier | null;
    lockedAt: Date | null;
    steps: number;
    minutes: number;
    /** Decided when the reveal opens — the hold only uncovers it. */
    reward: DropReward | null;
    /** The hold completed. */
    opened: boolean;
    /** Days since the member last moved — non-null switches on Comeback. */
    comebackDays: number | null;
    /** The one-time welcome has been shown for this lapse. */
    comebackSeen: boolean;
}

const INITIAL: DropPrototype = {
    tier: null,
    lockedAt: null,
    steps: 3200,
    minutes: 0,
    reward: null,
    opened: false,
    comebackDays: null,
    comebackSeen: false,
};

let state: DropPrototype = INITIAL;
const listeners = new Set<() => void>();

function set(next: Partial<DropPrototype>) {
    state = { ...state, ...next };
    listeners.forEach(l => l());
}

export function useDropPrototype(): DropPrototype {
    return useSyncExternalStore(
        l => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => state,
    );
}

export const dropSim = {
    lockIn(tier: DropTier) {
        set({ tier, lockedAt: new Date() });
    },
    addSteps(n: number) {
        set({ steps: state.steps + n });
    },
    addMinutes(n: number) {
        set({ minutes: state.minutes + n });
    },
    /** Roll the reward as the reveal opens (server-side at unlock, for real). */
    prepare() {
        if (!state.tier || state.reward) return;
        set({ reward: pickDropReward(state.tier, Math.random()) });
    },
    markOpened() {
        set({ opened: true });
    },
    /** Lapsed member: nothing moved yet today, four days away. */
    comeback() {
        set({ ...INITIAL, steps: 0, comebackDays: 4 });
    },
    ackComeback() {
        set({ comebackSeen: true });
    },
    newDay() {
        set(INITIAL);
    },
};
