/**
 * Which venues the phone asks the OS to watch.
 *
 * iOS watches at most 20 regions per app; one is the travel sentinel, leaving 19.
 * The engine used to fill all 19 with whatever was NEAREST to the last place the
 * app armed from. In a dense city that set is small: 2,120 of 8,007 venues have
 * 19 or more others within 2 km (max 43, 2026-11-25), while the sentinel that
 * triggers a re-arm is floored at 2 km. So a member whose own gym ranked 20th or
 * lower from where they last opened the app had no wake ring on it at all, and
 * the only backstop was a server sweep every four hours.
 *
 * The fix is not a smaller sentinel (every re-arm relaunches the app and fires a
 * 20-region state burst) — it is to stop treating the member's own gym as just
 * another pin. A few slots are reserved for venues that are THEIRS: the home gym
 * they chose, and the places they have actually checked in. The rest still go to
 * the nearest.
 *
 * Pure, so the selection is unit-testable. Storage helpers are at the bottom.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { haversineMetres } from '@/lib/geofence/zone';

export interface ArmEntry {
  dbId?: string;
  lat?: number;
  lng?: number;
  radius?: number;
}

export interface ArmPriority {
  /** profiles.preferred_gym_id — a partner id, which may have several locations. */
  homeGymId: string | null;
  /** regionId → when the member last checked in there. */
  visited: Record<string, number>;
}

/** Reserved slots at most — the rest of the set must still follow the member
 *  around, or a priority list would freeze the watch list in place. */
export const PRIORITY_SLOTS_MAX = 6;
/** A check-in older than this no longer earns a reserved slot. */
export const VISITED_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** A priority venue further than this is not worth a slot today: the sentinel
 *  re-arms long before the member could reach it (SENTINEL_MAX_RADIUS_M). */
export const PRIORITY_MAX_DISTANCE_M = 50_000;
/** How many visited regions are remembered. */
export const VISITED_KEEP = 12;

export interface ArmedPick<E extends ArmEntry> {
  chosen: Array<{ id: string; e: E; dist: number; priority: boolean }>;
  /** Distance to the furthest NEAREST-fill venue. The sentinel is sized from
   *  this alone: a home gym 30 km away must not stretch the envelope to 30 km,
   *  or the nearest set would never be refreshed. */
  envelopeM: number | null;
  priorityCount: number;
}

/**
 * Chooses up to `slots` venues: the member's own first, then the nearest.
 *
 * Priority order: the home gym's nearest location, then visited regions, most
 * recent first. Each must be within PRIORITY_MAX_DISTANCE_M of the fix.
 */
export function pickArmedSet<E extends ArmEntry>(
  entries: Array<[string, E]>,
  fix: { latitude: number; longitude: number },
  slots: number,
  priority: ArmPriority | null,
  nowMs: number = Date.now(),
): ArmedPick<E> {
  const all = entries
    .filter(([, e]) => e.lat != null && e.lng != null && Number.isFinite(e.lat) && Number.isFinite(e.lng))
    .map(([id, e]) => ({ id, e, dist: haversineMetres(fix.latitude, fix.longitude, e.lat!, e.lng!) }))
    .sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (slots <= 0 || all.length === 0) return { chosen: [], envelopeM: null, priorityCount: 0 };

  const reserved: typeof all = [];
  const taken = new Set<string>();
  const cap = Math.min(PRIORITY_SLOTS_MAX, Math.max(0, Math.floor(slots / 3)));

  if (priority && cap > 0) {
    // 1. Home gym — its nearest location (`all` is already sorted by distance).
    if (priority.homeGymId) {
      const home = all.find(x => x.e.dbId === priority.homeGymId);
      if (home && home.dist <= PRIORITY_MAX_DISTANCE_M) { reserved.push(home); taken.add(home.id); }
    }
    // 2. Places they have checked in, most recent first.
    const byId = new Map(all.map(x => [x.id, x] as const));
    const recent = Object.entries(priority.visited ?? {})
      .filter(([, at]) => typeof at === 'number' && nowMs - at <= VISITED_MAX_AGE_MS)
      .sort((a, b) => b[1] - a[1]);
    for (const [regionId] of recent) {
      if (reserved.length >= cap) break;
      if (taken.has(regionId)) continue;
      const hit = byId.get(regionId);
      if (!hit || hit.dist > PRIORITY_MAX_DISTANCE_M) continue;
      reserved.push(hit);
      taken.add(regionId);
    }
  }

  const fill = all.filter(x => !taken.has(x.id)).slice(0, Math.max(0, slots - reserved.length));
  const envelopeM = fill.length > 0
    ? fill[fill.length - 1].dist
    : (reserved.length > 0 ? Math.max(...reserved.map(x => x.dist)) : null);

  return {
    chosen: [
      ...reserved.map(x => ({ ...x, priority: true })),
      ...fill.map(x => ({ ...x, priority: false })),
    ],
    envelopeM,
    priorityCount: reserved.length,
  };
}

// ─── Storage ─────────────────────────────────────────────────────────────────
// AsyncStorage, because arming also runs headlessly (sentinel exit, boot) where
// there is no React state and no network worth waiting on.

export const HOME_GYM_KEY = '@powr/home_gym_id';
export const VISITED_REGIONS_KEY = '@powr/visited_regions';

/** Cache the member's home gym for the headless arm. null clears it. */
export async function rememberHomeGym(partnerId: string | null | undefined): Promise<void> {
  try {
    if (partnerId) await AsyncStorage.setItem(HOME_GYM_KEY, partnerId);
    else await AsyncStorage.removeItem(HOME_GYM_KEY);
  } catch { /* the next foreground refresh writes it again */ }
}

/** Pure: the visited map after one more check-in, trimmed to the newest VISITED_KEEP. */
export function withVisit(
  visited: Record<string, number>,
  regionId: string,
  atMs: number,
): Record<string, number> {
  const next = { ...visited, [regionId]: atMs };
  const kept = Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, VISITED_KEEP);
  return Object.fromEntries(kept);
}

/** Record a check-in so this venue keeps a reserved slot. */
export async function noteVisitedRegion(regionId: string, atMs: number = Date.now()): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(VISITED_REGIONS_KEY);
    const current = raw ? JSON.parse(raw) as Record<string, number> : {};
    await AsyncStorage.setItem(VISITED_REGIONS_KEY, JSON.stringify(withVisit(current ?? {}, regionId, atMs)));
  } catch { /* costs a reserved slot, never a check-in */ }
}

export async function readArmPriority(): Promise<ArmPriority> {
  try {
    const [home, raw] = await Promise.all([
      AsyncStorage.getItem(HOME_GYM_KEY),
      AsyncStorage.getItem(VISITED_REGIONS_KEY),
    ]);
    const visited = raw ? JSON.parse(raw) as Record<string, number> : {};
    return { homeGymId: home || null, visited: visited && typeof visited === 'object' ? visited : {} };
  } catch {
    return { homeGymId: null, visited: {} };
  }
}

/** Sign-out: these describe a person, not a phone. */
export async function clearArmPriority(): Promise<void> {
  await AsyncStorage.removeItem(HOME_GYM_KEY).catch(() => {});
  await AsyncStorage.removeItem(VISITED_REGIONS_KEY).catch(() => {});
}
