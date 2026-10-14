/**
 * Distance units for workout figures — one place, so the radial, the breakdown
 * sheet, the feed and the recap never disagree about the same ride.
 *
 * The unit follows what each SPORT uses in the reader's REGION, not a single
 * metric/imperial switch:
 *   - swimming is metres everywhere (nobody swims a 0.9 mile set);
 *   - cycling is miles where the roads are (UK, US), km elsewhere;
 *   - running is km everywhere except the US — UK runners think in 5k/10k and
 *     parkrun even though their road signs are in miles.
 *
 * Region comes from the device locale through Intl, which needs no native
 * module (expo-localization would mean a new EAS build, not an OTA).
 *
 * Settings › Distance units can override that per device: 'auto' (the default)
 * is the per-sport, per-region table above; 'mi' or 'km' puts every land sport
 * in that unit. Swimming stays in metres whatever the setting.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { ActivityType } from '@/constants/activities';

export type DistanceUnit = 'km' | 'mi' | 'm';

/** Settings › Distance units. 'auto' is what everyone had before the setting existed. */
export type DistancePreference = 'auto' | 'mi' | 'km';

export const METRES_PER_MILE = 1609.344;

/** Regions that ride in miles. */
const MILES_CYCLING = new Set(['GB', 'US', 'LR', 'MM']);
/** Regions that run in miles. */
const MILES_RUNNING = new Set(['US', 'LR', 'MM']);

let cachedRegion: string | null | undefined;
let regionOverride: string | null | undefined;

/**
 * Pin the region every formatter reads, or pass undefined to go back to the
 * device locale. Tests use it because Jest's locale is whatever the host
 * machine has. It only feeds the 'auto' rules: a 'mi' or 'km' preference wins
 * over any region.
 */
export function setRegionOverride(region: string | null | undefined): void {
    regionOverride = region;
}

/** Upper-case ISO region of the device locale ("GB"), or null when unknown. */
export function deviceRegion(): string | null {
    if (regionOverride !== undefined) return regionOverride;
    if (cachedRegion !== undefined) return cachedRegion;
    try {
        const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
        // "en-GB", "en_GB", "zh-Hant-TW" — the region is the 2-letter subtag.
        const region = locale.split(/[-_]/).slice(1).find(part => /^[A-Za-z]{2}$/.test(part));
        // A bare language tag ("en") carries no region; the UK is most of the
        // user base and its timezone is unambiguous, so read it from there.
        const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
        cachedRegion = region ? region.toUpperCase() : timeZone === 'Europe/London' ? 'GB' : null;
    } catch {
        cachedRegion = null;
    }
    return cachedRegion;
}

// ─── The member's preference ─────────────────────────────────────────────────

const PREFERENCE_KEY = 'powr:distanceUnit';

let preference: DistancePreference = 'auto';
/** Set once the member picks in this session, so a slow first read can't undo it. */
let pickedThisSession = false;
const listeners = new Set<() => void>();

function parsePreference(value: string | null | undefined): DistancePreference {
    return value === 'mi' || value === 'km' ? value : 'auto';
}

function commitPreference(next: DistancePreference): void {
    if (next === preference) return;
    preference = next;
    listeners.forEach(listener => listener());
}

async function readSavedPreference(): Promise<void> {
    try {
        const saved = await AsyncStorage.getItem(PREFERENCE_KEY);
        if (!pickedThisSession) commitPreference(parsePreference(saved));
    } catch {
        // Storage unreadable: stay on 'auto', which is what everyone had before.
    }
}

/**
 * Resolves once the saved preference (if any) is applied. Never rejects. Until
 * then every formatter uses 'auto', so nothing waits on storage to render.
 */
export const distancePreferenceReady: Promise<void> = readSavedPreference();

export function getDistancePreference(): DistancePreference {
    return preference;
}

/** Pick a unit for this device, or 'auto' to follow sport and region again. */
export async function setDistancePreference(next: DistancePreference): Promise<void> {
    pickedThisSession = true;
    commitPreference(parsePreference(next));
    try {
        if (preference === 'auto') await AsyncStorage.removeItem(PREFERENCE_KEY);
        else await AsyncStorage.setItem(PREFERENCE_KEY, preference);
    } catch {
        // Applies for this session; next launch falls back to what was saved.
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/**
 * The current preference, re-rendering the caller when it changes. Any screen
 * that formats distances while it can stay mounted under Settings (a tab)
 * should call it, even if it ignores the value, so its figures switch too.
 */
export function useDistancePreference(): DistancePreference {
    return useSyncExternalStore(subscribe, getDistancePreference, getDistancePreference);
}

/**
 * Discover's place distances. Discover has always been in miles, and
 * Automatic keeps it there; only an explicit 'km' changes it.
 */
export function discoverDistanceUnit(pref: DistancePreference = preference): 'mi' | 'km' {
    return pref === 'km' ? 'km' : 'mi';
}

// ─── Units per sport ─────────────────────────────────────────────────────────

/**
 * The long unit a sport's distances are read in. Swims are always metres; a
 * 'mi' or 'km' preference covers every other sport; 'auto' follows the region
 * table, and an unknown region → km.
 */
export function distanceUnitFor(
    type: ActivityType | string,
    region: string | null = deviceRegion(),
    pref: DistancePreference = preference,
): DistanceUnit {
    if (type === 'swimming') return 'm';
    if (pref !== 'auto') return pref;
    if (!region) return 'km';
    if (type === 'cycling') return MILES_CYCLING.has(region) ? 'mi' : 'km';
    return MILES_RUNNING.has(region) ? 'mi' : 'km';
}

/** 1 decimal under 100, whole numbers from there, so figures stay short. */
function compact(n: number): string {
    return n >= 100 ? String(Math.round(n)) : n.toFixed(1);
}

/**
 * A distance split into figure and unit, for surfaces that style them apart.
 *
 * Sub-kilometre efforts keep metres in every region (pool lengths average
 * ~830 m in prod) rather than rounding to "0.8 km" / "0.5 mi".
 */
export function distanceParts(
    metres: number,
    type: ActivityType | string,
    region: string | null = deviceRegion(),
): { value: string; unit: DistanceUnit } {
    const unit = distanceUnitFor(type, region);
    if (unit === 'm' || metres < 1000) {
        return { value: Math.round(metres).toLocaleString('en-GB'), unit: 'm' };
    }
    return { value: compact(metres / (unit === 'mi' ? METRES_PER_MILE : 1000)), unit };
}

/** "81.3 km" / "50.5 mi" / "830 m". */
export function formatDistance(
    metres: number,
    type: ActivityType | string,
    region: string | null = deviceRegion(),
): string {
    const { value, unit } = distanceParts(metres, type, region);
    return `${value} ${unit}`;
}

/** km/h → the speed figure for the sport's long unit ("23.2" + "km/h" | "mph"). */
export function speedParts(
    kmh: number,
    type: ActivityType | string,
    region: string | null = deviceRegion(),
): { value: string; unit: 'km/h' | 'mph' } {
    return distanceUnitFor(type, region) === 'mi'
        ? { value: (kmh * 1000 / METRES_PER_MILE).toFixed(1), unit: 'mph' }
        : { value: kmh.toFixed(1), unit: 'km/h' };
}

/** km/h → seconds per long unit and its suffix, for a running/walking pace. */
export function paceParts(
    kmh: number,
    type: ActivityType | string,
    region: string | null = deviceRegion(),
): { secondsPerUnit: number; unit: '/km' | '/mi' } {
    return distanceUnitFor(type, region) === 'mi'
        ? { secondsPerUnit: 3600 / (kmh * 1000 / METRES_PER_MILE), unit: '/mi' }
        : { secondsPerUnit: 3600 / kmh, unit: '/km' };
}
