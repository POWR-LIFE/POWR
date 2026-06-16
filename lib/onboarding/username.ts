/**
 * Pure username helpers for the onboarding profile step (and edit-profile).
 * Kept free of React/Supabase so the rules can be unit-tested directly.
 */

export const MIN_USERNAME = 3;
export const MAX_USERNAME = 20;

export type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

/** Strips a raw string to a valid handle: lowercase, [a-z0-9_], capped length. */
export function normalizeUsername(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, MAX_USERNAME);
}

/** A handle is valid if its (already-normalized) length is in range. */
export function isUsernameValid(username: string): boolean {
    return username.length >= MIN_USERNAME && username.length <= MAX_USERNAME;
}

/** Whether the profile step can advance: name present + valid, available username. */
export function canSubmitProfile(
    displayName: string,
    username: string,
    status: UsernameStatus,
): boolean {
    return displayName.trim().length > 0 && isUsernameValid(username) && status === 'available';
}

/** Best-effort starting handle from the display name, falling back to the email local-part. */
export function suggestUsernameBase(name: string, email?: string | null): string {
    return normalizeUsername(name || (email?.split('@')[0] ?? ''));
}

/**
 * The pure rule behind isUsernameAvailable: a handle is free when no other
 * profile holds it. A row owned by the current user counts as free (re-saving
 * your own handle must not report "taken").
 */
export function isHandleFree(
    found: { id: string } | null | undefined,
    currentUserId: string | null | undefined,
): boolean {
    return !found || found.id === currentUserId;
}
