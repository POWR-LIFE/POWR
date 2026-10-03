// The portal user's language, read from their browser — never asked for.
//
// Same rules as the app (shared/locale.ts): the app reads the phone, the reward
// and gym portals read navigator.languages, and both resolve to one shape with
// an English fallback. lib/i18n.js picks the portal's display language from
// this; rememberProfileLanguage saves the preference to profiles.language.

import { useEffect, useState } from 'react';
import { FALLBACK_LANGUAGE, pickLocale } from '../../../shared/locale.ts';

export { FALLBACK_LANGUAGE };

function browserLanguages() {
    if (typeof navigator === 'undefined') return [];
    return navigator.languages?.length ? navigator.languages : [navigator.language];
}

/** { tag, language, region, textDirection } for the browser's top language. */
export function getBrowserLocale() {
    return pickLocale(browserLanguages());
}

/** Shorthand for the browser's primary language ("en"). */
export function getBrowserLanguage() {
    return getBrowserLocale().language;
}

const SYNCED_KEY = 'powr:portal:languageSynced';

/**
 * Keep profiles.language current for the signed-in portal user, so anything
 * sent to them (gym recap, brand report) can follow their language later.
 * Stores the browser's PREFERENCE, not what the portal can show yet. Writes only
 * when the user or their language changed since this browser last saved it;
 * best-effort — a failed write simply retries on the next load.
 */
export async function rememberProfileLanguage(supabase, userId) {
    if (!userId) return;
    const language = getBrowserLanguage();
    const marker = `${userId}:${language}`;
    try {
        if (localStorage.getItem(SYNCED_KEY) === marker) return;
    } catch {
        // storage blocked: write anyway, it's one small update
    }
    const { error } = await supabase.from('profiles').update({ language }).eq('id', userId);
    if (error) return;
    try {
        localStorage.setItem(SYNCED_KEY, marker);
    } catch {
        // can't remember it — the next load just writes again
    }
}

/** The browser locale, re-rendering if the user changes their browser language. */
export function useBrowserLocale() {
    const [locale, setLocale] = useState(getBrowserLocale);

    useEffect(() => {
        const onChange = () => setLocale(getBrowserLocale());
        window.addEventListener('languagechange', onChange);
        return () => window.removeEventListener('languagechange', onChange);
    }, []);

    return locale;
}
