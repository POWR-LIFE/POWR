import { useSyncExternalStore } from 'react';

import { pickCrewReward } from '@/lib/crew';
import type { DropReward } from '@/lib/drop';
import type { Friend } from '@/lib/social/types';

/**
 * DESIGN SCAFFOLD — Crew Charge. Same rules as lib/dev/dropPrototype: no
 * backend, in-memory, behind DROP_PROTOTYPE (false outside __DEV__). Your own
 * charge is read from the Drop prototype's steps and minutes, so one walk
 * moves both cards. The crew's movement is invented by the DEV strip.
 */

export interface CrewMate {
    friend: Friend;
    joined: boolean;
    steps: number;
    minutes: number;
    nudged: boolean;
}

export interface CrewPrototype {
    phase: 'none' | 'forming' | 'active';
    name: string;
    mates: CrewMate[];
    reward: DropReward | null;
    opened: boolean;
}

const INITIAL: CrewPrototype = { phase: 'none', name: '', mates: [], reward: null, opened: false };

let state: CrewPrototype = INITIAL;
const listeners = new Set<() => void>();

function set(next: Partial<CrewPrototype>) {
    state = { ...state, ...next };
    listeners.forEach(l => l());
}

export function useCrewPrototype(): CrewPrototype {
    return useSyncExternalStore(
        l => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => state,
    );
}

/** Stand-ins when the signed-in member has fewer than two friends. */
export const SAMPLE_FRIENDS: Friend[] = [
    { id: 'sample-elliot', username: 'elliot', displayName: 'Elliot', status: 'accepted', togetherEnabled: true },
    { id: 'sample-sorine', username: 'sorine', displayName: 'Sorine', status: 'accepted', togetherEnabled: true },
    { id: 'sample-james', username: 'james', displayName: 'James', status: 'accepted', togetherEnabled: true },
    { id: 'sample-maya', username: 'maya', displayName: 'Maya', status: 'accepted', togetherEnabled: true },
];

export const crewSim = {
    start(friends: Friend[], name: string) {
        set({
            phase: 'forming',
            name,
            mates: friends.map(f => ({ friend: f, joined: false, steps: 0, minutes: 0, nudged: false })),
            reward: null,
            opened: false,
        });
    },
    /** Everyone accepts; one stays quiet so the nudge has someone to nudge. */
    allJoin() {
        if (state.phase === 'none') return;
        const seeds = [3400, 0, 1900, 2600];
        set({
            phase: 'active',
            mates: state.mates.map((m, i) => ({ ...m, joined: true, steps: m.joined ? m.steps : seeds[i % seeds.length] })),
        });
    },
    /** The crew moves: each joined mate except the first quiet one walks a bit. */
    crewMoves() {
        if (state.phase !== 'active') return;
        let skippedQuiet = false;
        set({
            mates: state.mates.map(m => {
                if (!m.joined) return m;
                if (!skippedQuiet && m.steps === 0 && m.minutes === 0 && !m.nudged) {
                    skippedQuiet = true;
                    return m;
                }
                return { ...m, steps: m.steps + 1200 };
            }),
        });
    },
    nudge(id: string) {
        set({ mates: state.mates.map(m => (m.friend.id === id ? { ...m, nudged: true } : m)) });
    },
    /** A nudged mate answering — so the quiet slot can be seen filling. */
    nudgedMove() {
        set({ mates: state.mates.map(m => (m.nudged && m.steps === 0 ? { ...m, minutes: 25 } : m)) });
    },
    prepare() {
        if (!state.reward) set({ reward: pickCrewReward(Math.random()) });
    },
    markOpened() {
        set({ opened: true });
    },
    reset() {
        set(INITIAL);
    },
};
