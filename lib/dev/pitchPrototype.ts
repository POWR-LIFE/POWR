import { useSyncExternalStore } from 'react';

import type { PulseScale } from '@/lib/pitch';

/**
 * DESIGN SCAFFOLD — the rest of the engagement pitch (Pulse, Beat Me,
 * Bounties, Hunt, Doors, live-tension pushes), alongside the Drop and Crew
 * prototypes. Same rules: in-memory, behind DROP_PROTOTYPE (false outside
 * __DEV__), driven from the SIM tab. Your own movement is always the Drop
 * prototype's steps and minutes, so one +1K STEPS moves every card at once.
 */

export interface PitchPrototype {
    /** Pulse numbers: prod as it is today, or the pitch's 5k-member picture. */
    scale: PulseScale;
    /** 'yesterday' = the solo version for members with no friends: you vs your own yesterday. */
    beatMe: { phase: 'suggest' | 'live' | 'ended'; rivalSteps: number; rival: 'friend' | 'yesterday' };
    bounty: { claimed: number; partnerClaimed: number };
    /** Index into PITCH_PUSHES of the banner on screen, or null. */
    push: number | null;
}

/** The pitch's notification examples, word for word where they fit the data. */
export const PITCH_PUSHES: readonly { title: string; body: string }[] = [
    { title: 'Sorine just passed you', body: 'You’re one place back today. 400 steps puts you ahead again.' },
    { title: '93 Bounties left', body: 'Battersea Bounty: 30 active minutes before midnight.' },
    { title: 'Your crew is at 94%', body: 'Elliot needs 1.4 km to charge the Crew Drop for everyone.' },
    { title: '8 minutes unlocks your Drop', body: 'A short walk opens today’s Drop.' },
    { title: 'London just took the lead', body: 'Battersea is beating Shoreditch by 24k POWR today.' },
];

const INITIAL: PitchPrototype = {
    scale: 'pitch',
    beatMe: { phase: 'suggest', rivalSteps: 6600, rival: 'friend' },
    bounty: { claimed: 184, partnerClaimed: 412 },
    push: null,
};

let state: PitchPrototype = INITIAL;
const listeners = new Set<() => void>();
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function set(next: Partial<PitchPrototype>) {
    state = { ...state, ...next };
    listeners.forEach(l => l());
}

export function usePitchPrototype(): PitchPrototype {
    return useSyncExternalStore(
        l => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => state,
    );
}

export const pitchSim = {
    toggleScale() {
        set({ scale: state.scale === 'pitch' ? 'today' : 'pitch' });
    },
    toggleRival() {
        set({ beatMe: { ...state.beatMe, phase: 'suggest', rival: state.beatMe.rival === 'friend' ? 'yesterday' : 'friend' } });
    },
    startBeatMe() {
        set({ beatMe: { ...state.beatMe, phase: 'live' } });
    },
    rivalWalks() {
        set({ beatMe: { ...state.beatMe, rivalSteps: state.beatMe.rivalSteps + 800 } });
    },
    endBeatMe() {
        set({ beatMe: { ...state.beatMe, phase: state.beatMe.phase === 'live' ? 'ended' : 'suggest' } });
    },
    claims() {
        set({
            bounty: {
                claimed: Math.min(300, state.bounty.claimed + 20),
                partnerClaimed: Math.min(500, state.bounty.partnerClaimed + 15),
            },
        });
    },
    /** Shows the next pitch push as an in-app banner for a few seconds. */
    nextPush() {
        const next = state.push == null ? 0 : (state.push + 1) % PITCH_PUSHES.length;
        set({ push: next });
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(() => set({ push: null }), 4200);
    },
    reset() {
        set(INITIAL);
    },
};
