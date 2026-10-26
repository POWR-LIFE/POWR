import { useSyncExternalStore } from 'react';

/**
 * DEV ONLY. Lets the streak card show the rest day without anyone having to
 * miss a day: 'real' reads your own streak (lib/streakRest), 'free' is a week
 * with the rest day still unused and today not moved yet, 'used' is the same
 * week with Tuesday taken as the rest day.
 */
export type RestDayMode = 'real' | 'free' | 'used';
const ORDER: RestDayMode[] = ['real', 'free', 'used'];

let mode: RestDayMode = 'real';
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => { listeners.delete(l); };
};

export const restDaySim = {
    cycle() {
        mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
        listeners.forEach((l) => l());
    },
};

export function useRestDaySim(): RestDayMode {
    return useSyncExternalStore(subscribe, () => mode);
}

/** The sample week for a mode: moved every day before today, but for the rest day. */
export function sampleRestWeek(m: Exclude<RestDayMode, 'real'>, todayIndex: number) {
    const restIndex = m === 'used' ? Math.min(1, Math.max(0, todayIndex - 1)) : null;
    return {
        streak: m === 'used' ? 22 : 23,
        activeDays: Array.from({ length: 7 }, (_, i) => i < todayIndex && i !== restIndex),
        restIndex,
        restFree: m === 'free',
    };
}
