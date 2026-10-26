import { useSyncExternalStore } from 'react';

import { autoTarget, DROP_POOLS, pickFromPool, SERIES_DOUBLE_MS, type AutoTarget, type DayMovement, type DropReward } from '@/lib/drop';

/**
 * DESIGN SCAFFOLD — POWR Drop (+ Next Move, Comeback).
 *
 * No backend yet: the Home card and the reveal run off this in-memory store,
 * driven from the SIM tab (steps, minutes, history) so every state can be
 * walked in Expo Go in a minute. Today's target is set automatically from the
 * member's last two weeks (lib/drop autoTarget). Nothing here ships: every
 * entry point is behind `DROP_PROTOTYPE`, which is false outside __DEV__. A
 * reload resets it. lib/drop.ts is the real, tested derivation; the histories
 * and numbers here are invented.
 */
export const DROP_PROTOTYPE = __DEV__;

/** How a past day's Drop ended, for the week strip. */
export type DropDayResult = 'opened' | 'missed';

/** Invented two-week histories, so the automatic target can be seen adapting. */
export type HistoryPreset = 'new' | 'low' | 'typical' | 'high';
export const HISTORY_PRESETS: HistoryPreset[] = ['new', 'low', 'typical', 'high'];

const PRESET: Record<HistoryPreset, { steps: number; minutes: number; days: number }> = {
    new: { steps: 7000, minutes: 25, days: 2 },
    low: { steps: 4300, minutes: 0, days: 14 },
    typical: { steps: 7600, minutes: 25, days: 14 },
    high: { steps: 12400, minutes: 45, days: 14 },
};

/** Fourteen days around a preset's typical day, with an ordinary wobble. */
export function historyDays(preset: HistoryPreset, bigYesterday: boolean): DayMovement[] {
    const p = PRESET[preset];
    const wobble = [0, 600, -400, 900, -700, 300, -200, 500, -600, 100, 800, -300, 400, -500];
    const days: DayMovement[] = Array.from({ length: 14 }, (_, i) =>
        i < 14 - p.days ? { steps: 0, minutes: 0 } : { steps: Math.max(0, p.steps + wobble[i]), minutes: i % 2 ? p.minutes : 0 },
    );
    if (bigYesterday && p.days >= 1) {
        days[13] = { steps: Math.round(p.steps * 1.9), minutes: Math.round(p.minutes * 2) };
    }
    return days;
}

export interface DropPrototype {
    history: HistoryPreset;
    bigYesterday: boolean;
    steps: number;
    minutes: number;
    /** Decided when the reveal opens — the hold only uncovers it. */
    reward: DropReward | null;
    /** The hold completed. */
    opened: boolean;
    /** When it was opened: a 2× Series reward runs for an hour from here. */
    openedAt: number | null;
    /** Days since the member last moved — non-null switches on Comeback. */
    comebackDays: number | null;
    /** The one-time welcome has been shown for this lapse. */
    comebackSeen: boolean;
    /** Today in the Mon–Sun week, 0 = Monday. NEW DAY moves it on. */
    dayIndex: number;
    /** Mon..yesterday, one entry per day — always `dayIndex` long. */
    week: DropDayResult[];
    /** The Home card shows this sample even when the real Drop is on for you. */
    forceSim: boolean;
}

/** An invented good week so the strip has something in it: one miss mid-week. */
const SAMPLE_WEEK: DropDayResult[] = ['opened', 'opened', 'missed', 'opened', 'opened', 'opened'];

/** The parts of the state that start over each morning. */
const FRESH_DAY = {
    steps: 3200,
    minutes: 0,
    reward: null,
    opened: false,
    openedAt: null,
    comebackDays: null,
    comebackSeen: false,
} satisfies Partial<DropPrototype>;

const todayIndex = (new Date().getDay() + 6) % 7;

const INITIAL: DropPrototype = {
    ...FRESH_DAY,
    history: 'typical',
    bigYesterday: false,
    dayIndex: todayIndex,
    week: SAMPLE_WEEK.slice(0, todayIndex),
    forceSim: false,
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

/** The store as it is now, for code outside React (the Series sim scoring a session). */
export function getDropState(): DropPrototype {
    return state;
}

/** Minutes left on an opened Drop's 2× Series points; 0 when there's none running. */
export function seriesDoubleLeft(d: DropPrototype, now = Date.now()): number {
    if (!d.opened || d.reward?.series !== 'double60' || d.openedAt == null) return 0;
    return Math.max(0, Math.ceil((d.openedAt + SERIES_DOUBLE_MS - now) / 60_000));
}

/** Today's target, set for the member — never picked. */
export function todayTarget(d: DropPrototype): AutoTarget {
    return autoTarget(historyDays(d.history, d.bigYesterday), { comeback: d.comebackDays != null });
}

export const dropSim = {
    toggleForceSim() {
        set({ forceSim: !state.forceSim });
    },
    cycleHistory() {
        const i = HISTORY_PRESETS.indexOf(state.history);
        set({ history: HISTORY_PRESETS[(i + 1) % HISTORY_PRESETS.length] });
    },
    toggleBigYesterday() {
        set({ bigYesterday: !state.bigYesterday });
    },
    addSteps(n: number) {
        set({ steps: state.steps + n });
    },
    addMinutes(n: number) {
        set({ minutes: state.minutes + n });
    },
    /**
     * Roll the reward as the reveal opens (server-side at unlock, for real).
     * `extra` = more for the pool, e.g. the Series prizes while a round is on.
     */
    prepare(extra?: readonly DropReward[]) {
        if (state.reward) return;
        // One Drop size now the target is automatic — the middle pool.
        set({ reward: pickFromPool([...DROP_POOLS.steady, ...(extra ?? [])], Math.random()) });
    },
    markOpened() {
        set({ opened: true, openedAt: Date.now() });
    },
    /** Lapsed member: nothing moved yet today, four days away. */
    comeback() {
        const missed = Math.min(4, state.dayIndex);
        set({
            ...FRESH_DAY,
            steps: 0,
            comebackDays: 4,
            week: [...state.week.slice(0, state.dayIndex - missed), ...Array<DropDayResult>(missed).fill('missed')],
        });
    },
    ackComeback() {
        set({ comebackSeen: true });
    },
    /** Today's result goes into the week; after Sunday a new week starts. */
    newDay() {
        const week: DropDayResult[] = [...state.week, state.opened ? 'opened' : 'missed'];
        const dayIndex = state.dayIndex + 1;
        set(dayIndex > 6 ? { ...FRESH_DAY, dayIndex: 0, week: [] } : { ...FRESH_DAY, dayIndex, week });
    },
};
