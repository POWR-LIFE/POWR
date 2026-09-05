/**
 * Pure helpers for the onboarding home-gym step. Free of React/Supabase/maps so
 * the list/marker/request logic can be unit-tested directly.
 */

export type GymCoords = { lat: number; lng: number };

/** A gym can be placed on the map only with finite, non-(0,0) coordinates. */
export function hasGymCoords(p: GymCoords): boolean {
    return Number.isFinite(p.lat) && Number.isFinite(p.lng) && (p.lat !== 0 || p.lng !== 0);
}

/** Search results take over the list when present (non-null); otherwise show nearby. */
export function displayedGyms<T>(searchResults: T[] | null, nearby: T[]): T[] {
    return searchResults !== null ? searchResults : nearby;
}

/** Map markers: only gyms with coords, capped so we never render hundreds of pins. */
export function gymMarkers<T extends GymCoords>(list: T[], max = 25): T[] {
    return list.filter(hasGymCoords).slice(0, max);
}

/**
 * Identity of the DRAWN marker set, for use as a React key prefix so the whole
 * set remounts wholesale whenever its composition or order changes, instead of
 * markers being inserted into / removed from a live native map one by one.
 *
 * Why (Sentry 2026-09-05 15:55Z, a brand-new user on THIS screen mid-search —
 * stack: AIRGoogleMap.m:191 insertReactSubview ← RCTLegacyViewManagerInterop
 * ComponentView finalizeUpdates ← RCTMountingManager performTransaction):
 * react-native-maps 1.20.1 is a legacy view manager running under Fabric's
 * interop layer. That layer attaches a child to the live map immediately ONLY
 * when it is appended at the end (index == count); a keyed-list diff that
 * inserts a marker in the MIDDLE is queued in `_viewsToBeMounted` and replayed
 * on the map's next finalizeUpdates. If the marker is removed again before that
 * replay, Fabric recycles its view (prepareForRecycle → contentView = nil) and
 * the replay hands the map a nil subview → NSInvalidArgumentException. Upstream
 * has no fix in any release to date (react-native-maps #5217/#5345/#5871, RN
 * interop unchanged on main).
 *
 * Remounting the WHOLE set on membership change avoids the queue entirely:
 * Fabric orders a transaction's removes (descending) before its inserts
 * (ascending), so every insert lands at index == count — the immediate path.
 * discover.tsx has done this since its overlay rewrite; this screen had not.
 * Keyed on CONTENT (ordered ids), not on the search string, so a query whose
 * results are the same set as before remounts nothing.
 */
export function gymMarkerSetKey(markers: { id: string }[]): string {
    // djb2 over the ordered id list — short, stable, and identical for identical sets.
    const sig = markers.map(m => m.id).join(',');
    let h = 5381;
    for (let i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

/** Tapping a selected gym deselects it; tapping another selects it. */
export function toggleSelection(currentId: string | null, gymId: string): string | null {
    return currentId === gymId ? null : gymId;
}

/** Primary button label: a chosen gym means "continue", otherwise it's a skip. */
export function continueLabel(selectedId: string | null): string {
    return selectedId ? 'CONTINUE' : 'SKIP FOR NOW';
}

export type GymRequestInput = { name: string; locationText?: string | null; note?: string | null };
export type GymRequestRow = { user_id: string; name: string; location_text: string | null; note: string | null };

/**
 * Builds the gym_requests insert row from user input, trimming and null-coalescing
 * the optional fields. Returns an error message instead of a row when the name is blank.
 */
export function buildGymRequestPayload(
    input: GymRequestInput,
    userId: string,
): { row: GymRequestRow; error: null } | { row: null; error: string } {
    const name = input.name.trim();
    if (!name) return { row: null, error: 'Please enter a gym name.' };
    return {
        row: {
            user_id: userId,
            name,
            location_text: input.locationText?.trim() || null,
            note: input.note?.trim() || null,
        },
        error: null,
    };
}
