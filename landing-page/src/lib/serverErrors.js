// What a portal shows when the database or an edge function says no.
//
// Postgres functions (raise exception '…') and edge functions ({ error: '…' })
// answer in English. Pages pass those errors through serverErrorText() instead
// of reading .message, so a French or Spanish reader gets their own words for
// every message we know. English readers see the server's text exactly as
// before, and an unknown message is shown as it came (English beats a blank).
//
// Keys live in the `serverErrors` namespace (shared/i18n/<lang>/portal/serverErrors.json).

import i18n from './i18n';

/** Exact server messages → key, e.g. Not allowed → serverErrors:notAllowed. */
const EXACT = {
};

/**
 * Messages that carry a value: [pattern, key, groups → interpolation values],
 * e.g. /^Code (\w+) is already in use$/ → serverErrors:codeInUse with { code }.
 */
const PATTERNS = [
];

/** The words to show for a server error (an Error, a Supabase error, or a string). */
export function serverErrorText(err, fallback) {
    const message = (typeof err === 'string' ? err : err?.message) || fallback || '';
    if (!message || (i18n.language || 'en') === 'en') return message;
    const trimmed = message.trim();
    if (EXACT[trimmed]) return i18n.t(EXACT[trimmed]);
    for (const [pattern, key, values] of PATTERNS) {
        const m = trimmed.match(pattern);
        if (m) return i18n.t(key, values(m.slice(1)));
    }
    return message;
}

export const SERVER_ERROR_KEYS = { EXACT, PATTERNS }; // for the catalog test
