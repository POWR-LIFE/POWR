import fs from 'fs';
import path from 'path';

import { DRAFT_LANGUAGES, PORTAL_LANGUAGES, resolveLanguage } from '../shared/i18n';
import en from '../shared/i18n/en/portal.json';
import es from '../shared/i18n/es/portal.json';

// Every catalog the portals load. Adding a language = add it here and in
// landing-page/src/lib/i18n.js.
const CATALOGS: Record<string, unknown> = { en, es };

/** "gym.nav.overview" → "Overview", for every leaf string. */
function flatten(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node };
  return Object.entries(node as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [key, child]) => ({ ...acc, ...flatten(child, prefix ? `${prefix}.${key}` : key) }),
    {},
  );
}

const placeholders = (text: string) => (text.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map(p => p.replace(/\s/g, '')).sort();

const english = flatten(en);

describe('portal catalogs', () => {
  it('has a catalog for every language a portal can show or preview', () => {
    for (const lang of [...PORTAL_LANGUAGES, ...DRAFT_LANGUAGES]) expect(CATALOGS[lang]).toBeDefined();
  });

  it.each(Object.keys(CATALOGS).filter(l => l !== 'en'))('%s has no keys English lacks, and keeps every {{placeholder}}', lang => {
    const strings = flatten(CATALOGS[lang]);
    for (const [key, text] of Object.entries(strings)) {
      expect(english[key]).toBeDefined();
      expect(placeholders(text)).toEqual(placeholders(english[key]));
    }
  });

  it('only switches on languages that cover every English string', () => {
    // A loop, not it.each: today the list is just English, and it.each refuses an empty table.
    for (const lang of PORTAL_LANGUAGES.filter(l => l !== 'en')) {
      const strings = flatten(CATALOGS[lang]);
      const missing = Object.keys(english).filter(key => !strings[key]?.trim());
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
  });

  it('keeps drafts out of what real users see', () => {
    for (const lang of DRAFT_LANGUAGES) expect(PORTAL_LANGUAGES).not.toContain(lang);
  });
});

describe('portal source', () => {
  // The converted portal files: every key they reference must exist in English,
  // or i18next would render the raw key to a gym's staff.
  const FILES = [
    'landing-page/src/pages/venue/VenueLayout.jsx',
    'landing-page/src/pages/venue/VenueLogin.jsx',
    'landing-page/src/pages/partner/PartnerLayout.jsx',
    'landing-page/src/components/portal/PortalShell.jsx',
  ];
  const KEY = /['"]((?:common|gym|brand)\.[a-zA-Z.]+)['"]/g;

  it.each(FILES)('%s only uses keys that exist', file => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const keys = [...source.matchAll(KEY)].map(m => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter(key => english[key] === undefined)).toEqual([]);
  });
});

describe('resolveLanguage', () => {
  it('shows a supported preference', () => {
    expect(resolveLanguage('es', ['en', 'es'])).toBe('es');
  });

  it('falls back to English for anything the surface does not speak yet', () => {
    expect(resolveLanguage('es', ['en'])).toBe('en');
    expect(resolveLanguage('fr', ['en', 'es'])).toBe('en');
    expect(resolveLanguage(null, ['en'])).toBe('en');
  });
});
