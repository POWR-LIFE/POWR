// Portal translations. The catalogs live in shared/i18n so the app and the
// portals are translated from one place; this file only wires them into
// i18next for the reward and gym portals.
//
// What a portal user sees: their browser language when the portal speaks it
// (PORTAL_LANGUAGES in shared/i18n), otherwise English. Translators preview a
// drafted language by adding ?lang=es to any portal URL — it sticks for the tab
// (sessionStorage) and ?lang=off clears it.
//
// Admin-only screens (the "view portal as" pickers, preview banners) stay in
// English on purpose: only POWR staff see them.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../../shared/i18n/en/portal.json';
import es from '../../../shared/i18n/es/portal.json';
import { DRAFT_LANGUAGES, PORTAL_LANGUAGES, resolveLanguage } from '../../../shared/i18n/index.ts';
import { getBrowserLanguage } from './locale';

const PREVIEW_KEY = 'powr:portal:previewLang';
const PREVIEWABLE = [...PORTAL_LANGUAGES, ...DRAFT_LANGUAGES];

function previewLanguage() {
    try {
        const asked = new URLSearchParams(window.location.search).get('lang');
        if (asked === 'off') sessionStorage.removeItem(PREVIEW_KEY);
        else if (asked && PREVIEWABLE.includes(asked)) sessionStorage.setItem(PREVIEW_KEY, asked);
        const stored = sessionStorage.getItem(PREVIEW_KEY);
        return stored && PREVIEWABLE.includes(stored) ? stored : null;
    } catch {
        return null; // storage blocked — a preview just doesn't stick
    }
}

i18n.use(initReactI18next).init({
    resources: { en: { portal: en }, es: { portal: es } },
    lng: previewLanguage() ?? resolveLanguage(getBrowserLanguage(), PORTAL_LANGUAGES),
    fallbackLng: 'en',
    ns: ['portal'],
    defaultNS: 'portal',
    interpolation: { escapeValue: false }, // React already escapes
    initAsync: false,                      // resources are inline, so no first-render flash
    react: { useSuspense: false },
});

export default i18n;
