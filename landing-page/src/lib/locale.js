// The portal user's language, read from their browser — never asked for.
//
// Same rules as the app (shared/locale.ts): the app reads the phone, the reward
// and gym portals read navigator.languages, and both resolve to one shape with
// an English fallback. Detection only — the portals aren't translated yet, so
// nothing renders differently until a page asks for this.

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
