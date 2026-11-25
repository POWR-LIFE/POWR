/**
 * ONE definition of where a member is relative to a venue, and ONE rule for
 * when a reading may start a visit.
 *
 * WHY THIS FILE EXISTS (review 2026-11-25). The engine had grown three
 * different meanings of "inside", each written for its own incident:
 *
 *   check-in   d <= radius
 *   proof      d <= radius + accuracy            (unbounded: blur bought range)
 *   leaving    d >  radius + 50 + min(acc, 30)
 *
 * A sharp fix 37 m from a 30 m pin failed the proof test where a blurry one
 * from the same spot passed, and a member standing between ~radius and
 * radius + 50 could neither prove presence nor leave — the server timed them
 * out after 20 quiet minutes and told them "Session complete" mid-workout
 * (ONE LDN, 2026-09-07; 12 of the fleet's 14 refused-but-present answers in
 * the 30 days to 11-25 were at that venue). A fourth rule, in the Home screen
 * poll, closed live visits at radius + accuracy on a single reading.
 *
 * The bands below partition the line with no gap between them, so every
 * reading lands in exactly one:
 *
 *   inside   proves presence — the only band that bills time
 *   near     keeps a visit alive, bills nothing
 *   gone     counts toward a departure
 *
 * Check-in is deliberately a STRICTER test than `inside`: the configured
 * radius and nothing else. A 25 m circle means 25 m (Jamie, 2026-06-12 —
 * precision is the moat). Nothing here widens it.
 *
 * Pure: no native or Supabase imports, so it is unit-testable and the server
 * mirror (SQL `_gym_visit_band`) can be checked against the same table.
 */

/** A fix coarser than this cannot support any geometric decision. */
export const TRUSTED_FIX_ACCURACY_M = 100;

/** How much of a fix's own error bar may extend the PROOF bound. Same figure,
 *  and the same argument, as the exit bound's cap (gymPresence
 *  EXIT_ACCURACY_CREDIT_CAP_M): past this, the less the device knows the more
 *  it would be allowed to claim. */
export const PROOF_ACCURACY_CAP_M = 30;

/** Width of the `near` band beyond the radius. Equal to the exit hysteresis
 *  (GeofenceContext LOCATION_EXIT_HYSTERESIS_M) — they are the same idea. */
export const NEAR_BAND_M = 50;

/** As PROOF_ACCURACY_CAP_M, for the outer edge of `near`. */
export const NEAR_ACCURACY_CAP_M = 30;

export type VenueBand = 'inside' | 'near' | 'gone';

const capped = (accuracyM: number | null | undefined, capM: number): number =>
  Math.min(Math.max(accuracyM ?? 0, 0), capM);

/** Furthest a fix may sit from the pin and still PROVE presence. */
export function proofBoundM(radiusM: number, accuracyM: number | null | undefined): number {
  return radiusM + capped(accuracyM, PROOF_ACCURACY_CAP_M);
}

/** Furthest a fix may sit from the pin before it counts toward a departure.
 *  Identical to gymPresence.exitBoundM(radius, NEAR_BAND_M, accuracy). */
export function goneBoundM(radiusM: number, accuracyM: number | null | undefined): number {
  return radiusM + NEAR_BAND_M + capped(accuracyM, NEAR_ACCURACY_CAP_M);
}

/** Which band a reading falls in. Says nothing about whether the fix is
 *  trusted or fresh — callers apply those separately, because "stay open" and
 *  "bill" have opposite tolerances for a bad fix. */
export function venueBand(distanceM: number, radiusM: number, accuracyM: number | null | undefined): VenueBand {
  if (distanceM <= proofBoundM(radiusM, accuracyM)) return 'inside';
  if (distanceM <= goneBoundM(radiusM, accuracyM)) return 'near';
  return 'gone';
}

// ─── Check-in ────────────────────────────────────────────────────────────────

/** A reading older than this describes where the phone WAS. The background
 *  sweep used to hand over a cached position up to ten minutes old, and the
 *  foreground check one of any age at all. */
export const ENTRY_FIX_MAX_AGE_MS = 60 * 1000;

/** Faster than this is a vehicle, not someone arriving on foot. A hard run is
 *  ~4 m/s; 30 mph is 13. Only applied when the platform reports a real speed
 *  (iOS sends -1, Android omits it, when it cannot tell). */
export const ENTRY_MAX_SPEED_MPS = 5;

/** A visit needs a SECOND inside reading at least this long after the first.
 *  One reading cannot tell arriving from passing: 41 % of iPhone visits and
 *  75 % of Android visits in the 30 days to 2026-11-25 lasted under two
 *  minutes. A car clears a 25 m circle in a few seconds; someone walking past
 *  on the pavement in under half a minute.
 *
 *  The gap is measured between the FIXES' own timestamps, never wall clock, so
 *  one cached position read twice can not corroborate itself. */
export const ENTRY_CONFIRM_MIN_GAP_MS = 30 * 1000;

/** Shorter gap for a server wake. iOS gives a silent push roughly thirty
 *  seconds of life; a wake that had to wait the full gap would lose check-ins
 *  the sweep makes today. The wake fires on the server's schedule, not the
 *  member's movement, so it landing during a walk-past is unlikely. */
export const ENTRY_CONFIRM_MIN_GAP_WAKE_MS = 10 * 1000;

/** A first reading older than this no longer vouches for anything. */
export const ENTRY_CANDIDATE_TTL_MS = 10 * 60 * 1000;

/** The visit starts at the FIRST inside reading, not the confirming one, so
 *  the second reading costs the member no minutes — but never further back
 *  than this. Same figure as gymPresence ENTRY_BACKDATE_MARGIN_MS. */
export const ENTRY_BACKDATE_CAP_MS = 5 * 60 * 1000;

export interface VenueGeometry {
  lat?: number | null;
  lng?: number | null;
  radius?: number | null;
}

/** Radius a location falls back to when none is stored. Every live location
 *  has one; this matches the engine's long-standing `?? 100`. */
export const DEFAULT_RADIUS_M = 100;

export function haversineMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface EntryScan<E extends VenueGeometry> {
  /** The NEAREST venue whose circle contains the fix, or null. */
  match: { regionId: string; entry: E; distanceM: number } | null;
  /** Nearest venue of all, inside its circle or not — telemetry. */
  nearestM: number | null;
  nearestId: string | null;
  /** True when the fix is inside at least one venue's wake ring. */
  withinApproach: boolean;
  scanned: number;
}

/**
 * Scans every venue and returns the NEAREST one whose circle contains the fix.
 *
 * ⚠ The engine used to take the FIRST match in map order — partner id order,
 * which is arbitrary. 1,614 of 8,007 locations overlap another's circle and
 * 381 share a pin within 5 m, so which gym a member was checked into could
 * depend on a UUID. Nearest pin wins; an exact tie falls to the smaller
 * circle, then to the lower id, so the answer is the same on every device.
 */
export function scanForEntry<E extends VenueGeometry>(
  map: Record<string, E>,
  fix: { latitude: number; longitude: number },
  approachRadiusM: number,
): EntryScan<E> {
  let match: EntryScan<E>['match'] = null;
  let matchRadius = Infinity;
  let nearestM: number | null = null;
  let nearestId: string | null = null;
  let withinApproach = false;
  let scanned = 0;

  for (const regionId of Object.keys(map)) {
    const entry = map[regionId];
    if (entry.lat == null || entry.lng == null) continue;
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lng)) continue;
    scanned++;
    const dist = haversineMetres(fix.latitude, fix.longitude, entry.lat, entry.lng);
    if (nearestM == null || dist < nearestM) { nearestM = dist; nearestId = regionId; }
    if (dist <= approachRadiusM) withinApproach = true;
    const radius = entry.radius ?? DEFAULT_RADIUS_M;
    if (dist > radius) continue;
    const better =
      match == null
      || dist < match.distanceM
      || (dist === match.distanceM && (radius < matchRadius || (radius === matchRadius && regionId < match.regionId)));
    if (better) { match = { regionId, entry, distanceM: dist }; matchRadius = radius; }
  }

  return { match, nearestM, nearestId, withinApproach, scanned };
}

/** The first inside reading, waiting for a second. Persisted by the engine so
 *  the two readings can straddle a process death. */
export interface EntryCandidate {
  regionId: string;
  /** When the first inside fix was TAKEN — becomes the visit's start. */
  firstSeenAtMs: number;
  /** When the newest inside fix was taken. */
  lastSeenAtMs: number;
  readings: number;
}

export type EntryVerdict =
  /** Second reading landed — open the visit, starting at `startAtMs`. */
  | 'enter'
  /** First (or too-soon) reading — remember it, open nothing. */
  | 'candidate'
  /** The fix is too old to describe the present. */
  | 'stale'
  /** The device is moving at vehicle speed. */
  | 'too_fast';

export interface EntryInput {
  /** Region the fix landed inside (already the nearest — see scanForEntry). */
  regionId: string;
  /** When the fix was taken; null when the producer could not say. */
  fixAtMs: number | null;
  nowMs: number;
  /** Metres per second. Negative, null or undefined = unknown. */
  speedMps?: number | null;
  /** The stored first reading, if any. */
  candidate: EntryCandidate | null;
  /** Override for the wake path. Defaults to ENTRY_CONFIRM_MIN_GAP_MS. */
  minGapMs?: number;
}

export interface EntryDecision {
  verdict: EntryVerdict;
  /** What to persist: the updated candidate, or null to clear it. For `stale`
   *  and `too_fast` the stored candidate is returned untouched. */
  candidate: EntryCandidate | null;
  /** Set on `enter`: the visit's start. */
  startAtMs?: number;
  /** Gap between the first reading and this one, for telemetry. */
  gapMs?: number;
}

/**
 * Decides what ONE inside reading means. Pure.
 *
 * An unknown fix time is treated as "now": the reading may open or extend a
 * candidate (it would have checked in outright before), and its age simply
 * cannot be held against it.
 */
export function entryDecision(i: EntryInput): EntryDecision {
  const fixAt = i.fixAtMs != null && Number.isFinite(i.fixAtMs) ? Math.min(i.fixAtMs, i.nowMs) : i.nowMs;

  if (i.nowMs - fixAt > ENTRY_FIX_MAX_AGE_MS) {
    return { verdict: 'stale', candidate: i.candidate };
  }
  if (i.speedMps != null && Number.isFinite(i.speedMps) && i.speedMps > ENTRY_MAX_SPEED_MPS) {
    return { verdict: 'too_fast', candidate: i.candidate };
  }

  const prior = i.candidate;
  const usable =
    prior != null
    && prior.regionId === i.regionId
    && fixAt >= prior.lastSeenAtMs
    && fixAt - prior.lastSeenAtMs <= ENTRY_CANDIDATE_TTL_MS;

  if (!usable) {
    // No first reading, one for a different venue, or one too old to vouch.
    // An OLDER fix than the stored one (a late-delivered batch) also lands
    // here only when the region differs; same-region older fixes are ignored
    // below by leaving the candidate as it is.
    if (prior != null && prior.regionId === i.regionId && fixAt < prior.lastSeenAtMs) {
      return { verdict: 'candidate', candidate: prior, gapMs: 0 };
    }
    return {
      verdict: 'candidate',
      candidate: { regionId: i.regionId, firstSeenAtMs: fixAt, lastSeenAtMs: fixAt, readings: 1 },
      gapMs: 0,
    };
  }

  const gapMs = fixAt - prior.firstSeenAtMs;
  const next: EntryCandidate = {
    regionId: prior.regionId,
    firstSeenAtMs: prior.firstSeenAtMs,
    lastSeenAtMs: fixAt,
    // The same cached fix read twice is one reading, not two.
    readings: fixAt > prior.lastSeenAtMs ? prior.readings + 1 : prior.readings,
  };
  if (gapMs >= (i.minGapMs ?? ENTRY_CONFIRM_MIN_GAP_MS)) {
    return {
      verdict: 'enter',
      candidate: null,
      startAtMs: Math.max(prior.firstSeenAtMs, i.nowMs - ENTRY_BACKDATE_CAP_MS),
      gapMs,
    };
  }
  return { verdict: 'candidate', candidate: next, gapMs };
}

// ─── Where the member stood, relative to the pin ────────────────────────────

/** Offsets are only ever produced within this distance of a pin. Further out
 *  the reading is not "at the venue" and where the member is, is not ours to
 *  record. Just past the wake ring. */
export const PIN_OFFSET_MAX_DISTANCE_M = 150;

/**
 * A reading's offset from a venue's pin, in whole metres east (dx) and north
 * (dy) — or null when the reading is not at the venue.
 *
 * WHY. 8,001 of 8,007 venues are a 25 m circle round one pin, so everything
 * rides on the pin being right, and until now nothing could tell: the server
 * was sent a DISTANCE, and a distance cannot say which way the pin is off. In
 * the 30 days to 2026-11-25, 38 gym workouts recorded on a watch happened with
 * the phone within 150 m of a pin and earned no visit; at one venue the phone
 * sat a median 90 m from the pin across 18 of them.
 *
 * WHAT IT IS NOT. It is not the member's location. No latitude or longitude
 * leaves the phone: the offset is meaningless without the pin, exists only for
 * readings taken at a venue, and is rounded to the metre. It is the minimum
 * that lets the pin be corrected.
 */
export function pinOffsetM(
  pin: { lat?: number | null; lng?: number | null },
  fix: { latitude: number; longitude: number },
): { dx_m: number; dy_m: number } | null {
  if (pin.lat == null || pin.lng == null || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) return null;
  if (!Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) return null;
  if (haversineMetres(fix.latitude, fix.longitude, pin.lat, pin.lng) > PIN_OFFSET_MAX_DISTANCE_M) return null;
  // Equirectangular: exact to well under a metre at this range.
  const M_PER_DEG = 111_195;
  const dy = (fix.latitude - pin.lat) * M_PER_DEG;
  const dx = (fix.longitude - pin.lng) * M_PER_DEG * Math.cos(pin.lat * (Math.PI / 180));
  // `+ 0` folds -0 into 0 so the JSON is tidy.
  return { dx_m: Math.round(dx) + 0, dy_m: Math.round(dy) + 0 };
}

// ─── Resuming a visit that was closed too early ─────────────────────────────

/** A visit re-entered at the same venue this soon after it closed is the SAME
 *  visit. 21 split episodes in the 30 days to 2026-11-25; one member lost a
 *  52-minute session because it was recorded as 24 + 15½ (11-16). */
export const RESUME_WINDOW_MS = 15 * 60 * 1000;

export interface ClosedVisitSnapshot {
  partnerId: string;
  entryTimestamp: number;
  endedAtMs: number;
  userId?: string | null;
}

/**
 * Where a resumed visit's clock starts, or null when this is a new visit.
 *
 * ⚠ The time away is NOT billed. The start moves forward by the length of the
 * gap, so the visit's age is exactly leg one plus leg two. When the exit was
 * false the member loses a few minutes instead of the whole session; when
 * they really did step out, they gain nothing for it. Never invents time.
 */
export function resumedStartMs(
  prior: ClosedVisitSnapshot | null,
  next: { partnerId: string; startAtMs: number; userId?: string | null },
): number | null {
  if (!prior) return null;
  if (prior.partnerId !== next.partnerId) return null;
  // Both owners known and different → another account's visit. An unowned
  // record behaves as it always did (ownership is best-effort at check-in).
  if (prior.userId && next.userId && prior.userId !== next.userId) return null;
  const gapMs = next.startAtMs - prior.endedAtMs;
  if (!(gapMs >= 0) || gapMs > RESUME_WINDOW_MS) return null;
  if (!(prior.endedAtMs >= prior.entryTimestamp)) return null;
  return prior.entryTimestamp + gapMs;
}
