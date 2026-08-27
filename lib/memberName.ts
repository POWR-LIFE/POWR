/**
 * One rule for what a member is called on social surfaces, and the initials
 * that go in their avatar when there is no photo.
 *
 * Initials come from the SAME label we render — never from a raw field —
 * so a member with no name gets "PM" for "POWR member", not "?". (FNL x
 * POWR, 2026-08-27: a signup who skipped the name step sat at #1 as "?".)
 */
export const MEMBER_FALLBACK = 'POWR member';

export function memberLabel(displayName?: string | null, username?: string | null): string {
    return displayName?.trim() || username?.trim() || MEMBER_FALLBACK;
}

export function memberInitials(displayName?: string | null, username?: string | null): string {
    return memberLabel(displayName, username)
        .split(/\s+/)
        .map(w => w[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase();
}
