/**
 * "Is the user standing in a partner venue RIGHT NOW?" — answered from the
 * foreground, with foreground permission only.
 *
 * WHY. Background location stays a mandatory onboarding ask for everyone
 * (Jamie, 2026-08-28: "if they do step into a gym, how would we know?"), but
 * plenty of people still land on "While Using". For them the geofence engine
 * arms nothing (armNativeRegions returns before building a single fence), so
 * a gym trip earns nothing — silently. The one moment we CAN see it is when
 * they open the app inside the venue: a one-shot foreground fix against the
 * cached partner map says "you're at X". That is the consequence-anchored
 * evidence the re-ask sheet (LocationPrimeSheet) needs — "this visit won't
 * count by itself" — instead of a calendar-paced generic nag.
 *
 * Deliberately NOT a check-in path: a While-Using device has no mechanism to
 * close a visit it opened, which is exactly why the sweep hard-returns on
 * no_permission. This module only detects; it never opens anything.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

/** Mirror of PARTNER_MAP_KEY in context/GeofenceContext.tsx — the full active
 *  partner geometry set that context maintains. Read-only here; importing the
 *  context would drag the whole geofence engine into every consumer. */
export const PARTNER_MAP_STORAGE_KEY = '@powr/partner_map';

export interface VenueEntry {
    id: string;
    name: string;
    dbId?: string;
    lat?: number | null;
    lng?: number | null;
    radius?: number | null;
}

export interface VenueFix { lat: number; lng: number; accuracy: number | null }

export interface VenuePresence {
    partnerId: string;
    partnerName: string;
    distanceM: number;
}

/** A fix coarser than this cannot place someone inside a 25–50 m venue. */
export const MAX_FIX_ACCURACY_M = 100;
/** Smallest "inside" radius we accept — a 25 m fence plus typical GPS wobble. */
export const MIN_INSIDE_RADIUS_M = 50;
/** A cached position older than this is a different place. */
export const LAST_KNOWN_MAX_AGE_MS = 60 * 1000;
/** Fresh-fix budget: this runs on Home mount, it must not stall the screen. */
export const FRESH_FIX_TIMEOUT_MS = 8 * 1000;

export function haversineMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6_371_000;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Pure: the nearest venue whose inside-radius contains the fix, or null. A fix
 * coarser than MAX_FIX_ACCURACY_M never matches — a wrong "you're at X" on a
 * permission sheet is worse than no sheet.
 */
export function nearestVenueInside(
    entries: ReadonlyArray<VenueEntry>,
    fix: VenueFix,
): VenuePresence | null {
    if (fix.accuracy != null && fix.accuracy > MAX_FIX_ACCURACY_M) return null;
    let best: VenuePresence | null = null;
    for (const e of entries) {
        if (e.lat == null || e.lng == null || !Number.isFinite(e.lat) || !Number.isFinite(e.lng)) continue;
        if (e.lat === 0 && e.lng === 0) continue;
        const d = haversineMetres(fix.lat, fix.lng, e.lat, e.lng);
        const inside = Math.max(e.radius ?? 0, MIN_INSIDE_RADIUS_M);
        if (d > inside) continue;
        if (!best || d < best.distanceM) best = { partnerId: e.dbId ?? e.id, partnerName: e.name, distanceM: Math.round(d) };
    }
    return best;
}

async function readVenueEntries(): Promise<VenueEntry[]> {
    try {
        const raw = await AsyncStorage.getItem(PARTNER_MAP_STORAGE_KEY);
        if (!raw) return [];
        const map = JSON.parse(raw) as Record<string, Omit<VenueEntry, 'id'>>;
        return Object.entries(map).map(([id, e]) => ({ id, ...e }));
    } catch {
        return [];
    }
}

async function currentFix(): Promise<VenueFix | null> {
    const last = await Location.getLastKnownPositionAsync().catch(() => null);
    if (last && Date.now() - last.timestamp <= LAST_KNOWN_MAX_AGE_MS
        && (last.coords.accuracy == null || last.coords.accuracy <= MAX_FIX_ACCURACY_M)) {
        return { lat: last.coords.latitude, lng: last.coords.longitude, accuracy: last.coords.accuracy ?? null };
    }
    const fresh = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
        new Promise<null>(resolve => setTimeout(() => resolve(null), FRESH_FIX_TIMEOUT_MS)),
    ]);
    if (!fresh) return null;
    return { lat: fresh.coords.latitude, lng: fresh.coords.longitude, accuracy: fresh.coords.accuracy ?? null };
}

/**
 * Foreground-only probe. Returns the venue the user is inside, or null on
 * anything less than certainty (no fg permission, no map, coarse fix, timeout).
 * Never throws.
 */
export async function probeVenuePresence(): Promise<VenuePresence | null> {
    try {
        const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
        if (!fg || fg.status !== 'granted') return null;
        const entries = await readVenueEntries();
        if (entries.length === 0) return null;
        const fix = await currentFix();
        if (!fix) return null;
        return nearestVenueInside(entries, fix);
    } catch {
        return null;
    }
}
