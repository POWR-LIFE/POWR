// The gym and partner portals' language.
//
// The words live in shared/i18n/<lang>/portal/<namespace>.json, beside the
// app's. Every key is written with its namespace first (common:actions.save).
// See shared/i18n/README.md (Portals) for the rules.
//
// What a portal user sees:
//   1. a translator preview, `?lang=fr` on any portal URL (sticks for the tab,
//      `?lang=off` clears it) — drafts are only ever reachable this way;
//   2. else the language they picked (Settings, or the sidebar), kept per browser;
//   3. else their browser's language when the portal speaks it;
//   4. else English.
//
// English is bundled; French and Spanish load on demand so the marketing site
// doesn't carry them. Loading starts when this file is first imported (the
// portals are in the main bundle), so it's in by the time sign-in resolves.
//
// Admin-only screens (the "view portal as" pickers, preview banners) stay in
// English: only POWR staff see them.

import i18n from 'i18next';
import { useSyncExternalStore } from 'react';
import { initReactI18next } from 'react-i18next';
import { formatLocaleFor, PORTAL_DRAFT_LANGUAGES, PORTAL_LANGUAGES, resolveLanguage } from '../../../shared/i18n/index.ts';
import { getBrowserLanguage, getBrowserLocale } from './locale';

const PICK_KEY = 'powr:portal:language';
const PREVIEW_KEY = 'powr:portal:previewLang';
const SYNCED_KEY = 'powr:portal:languageSynced';

// shared/i18n/<lang>/portal/<ns>.json → { lang, ns }
const fileOf = (p) => p.match(/\/i18n\/([^/]+)\/portal\/([^/]+)\.json$/);

const englishFiles = import.meta.glob('../../../shared/i18n/en/portal/*.json', { eager: true, import: 'default' });
const otherFiles = import.meta.glob(['../../../shared/i18n/*/portal/*.json', '!../../../shared/i18n/en/portal/*.json'], { import: 'default' });

const english = {};
for (const [p, json] of Object.entries(englishFiles)) english[fileOf(p)[2]] = json;
const NAMESPACES = Object.keys(english);

const loaders = {}; // lang → [[ns, () => Promise<json>]]
for (const [p, load] of Object.entries(otherFiles)) {
    const [, lang, ns] = fileOf(p);
    (loaders[lang] ??= []).push([ns, load]);
}

const loading = {};
/** Fetch a language's catalogs once; resolves when they're in i18next. */
function loadLanguage(lang) {
    if (lang === 'en' || !loaders[lang]) return Promise.resolve();
    loading[lang] ??= Promise.all(
        loaders[lang].map(([ns, load]) => load().then((json) => i18n.addResourceBundle(lang, ns, json, true, true))),
    ).catch(() => { delete loading[lang]; }); // a failed chunk retries next time; English shows meanwhile
    return loading[lang];
}

function readStorage(store, key) {
    try { return store.getItem(key); } catch { return null; }
}
function writeStorage(store, key, value) {
    try { value == null ? store.removeItem(key) : store.setItem(key, value); } catch { /* storage blocked */ }
}

/** The translator preview language, from ?lang= or this tab's earlier ?lang=. */
function readPreview() {
    const previewable = [...PORTAL_LANGUAGES, ...PORTAL_DRAFT_LANGUAGES];
    let asked = null;
    try { asked = new URLSearchParams(window.location.search).get('lang'); } catch { /* no window */ }
    if (asked === 'off') { writeStorage(sessionStorage, PREVIEW_KEY, null); return null; }
    if (asked && previewable.includes(asked)) { writeStorage(sessionStorage, PREVIEW_KEY, asked); return asked; }
    const stored = readStorage(sessionStorage, PREVIEW_KEY);
    return stored && previewable.includes(stored) ? stored : null;
}

function compute() {
    const preview = readPreview();
    const pick = readStorage(localStorage, PICK_KEY) || null;
    const browser = getBrowserLanguage();
    const available = preview ? [...PORTAL_LANGUAGES, ...PORTAL_DRAFT_LANGUAGES] : [...PORTAL_LANGUAGES];
    const wanted = preview ?? (pick && available.includes(pick) ? pick : browser);
    return { language: resolveLanguage(wanted, available), pick, browser, preview, available };
}

let state = compute();
const listeners = new Set();
function publish(next) {
    state = next;
    for (const fn of listeners) fn();
}

i18n.use(initReactI18next).init({
    resources: { en: english },
    lng: 'en',
    fallbackLng: 'en',
    ns: NAMESPACES,
    defaultNS: 'common', // never relied on: every key names its namespace (the test enforces it)
    nsSeparator: ':',
    keySeparator: '.',
    interpolation: { escapeValue: false }, // React already escapes
    returnEmptyString: false, // an untranslated "" shows English, never a blank
    initAsync: false, // English is inline, so the first render has words
    react: { useSuspense: false, bindI18n: 'languageChanged loaded' },
});

/** Resolves once the portal is showing the language it should. */
export const portalLanguageReady = loadLanguage(state.language).then(() => i18n.changeLanguage(state.language));

/** Show `lang` (or follow the browser again with null), and remember it. */
export async function setPortalLanguage(lang) {
    writeStorage(localStorage, PICK_KEY, lang);
    const next = compute();
    await loadLanguage(next.language);
    await i18n.changeLanguage(next.language);
    publish(next);
}

/** { language, pick, browser, preview, available } — re-renders on change. */
export function usePortalLanguage() {
    return useSyncExternalStore(
        (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
        () => state,
    );
}

/**
 * The tag to give Intl / toLocale*String for what's on screen. English stays
 * en-GB, so swapping a hard-coded 'en-GB' for formatLocale() changes nothing
 * for English readers.
 */
export function formatLocale() {
    return formatLocaleFor(i18n.language || 'en', getBrowserLocale().tag);
}

/**
 * Keep profiles.language current for the signed-in portal user, so what POWR
 * sends them (gym recap, brand report) can follow it. Saves what they READ —
 * their pick, else their browser — even a language the portal can't show yet.
 * Writes only when it changed since this browser last saved it; best-effort.
 */
export async function rememberProfileLanguage(supabase, userId) {
    if (!userId) return;
    const language = state.pick || state.browser;
    const marker = `${userId}:${language}`;
    if (readStorage(localStorage, SYNCED_KEY) === marker) return;
    const { error } = await supabase.from('profiles').update({ language }).eq('id', userId);
    if (!error) writeStorage(localStorage, SYNCED_KEY, marker);
}

export default i18n;
