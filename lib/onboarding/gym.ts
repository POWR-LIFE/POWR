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
